/* av row actions: add_rows (incl. composite), remove_rows, set_cells, duplicate_rows. */
import { BATCH_HINTS } from '../internal/batch-hints';
import { generateSiYuanNodeId } from '../../shared/siyuan-id';
import { AV_ADD_ROWS_CONTEXT, assertAvAddRowsStructure, type AvAddRowsContext } from './add-rows-plan';
import { verifyAvCellsReadback } from './cell-readback';
import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import * as transactionApi from '../../api/transaction';
import type { TransactionOperation } from '../../api/transaction';
import { AvAddRowsSchema, AvDuplicateRowsSchema, AvRemoveRowsSchema, AvSetCellsSchema } from './schemas';
import type { ToolHandlerContext } from '../internal/define-tool';
import { createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { AV_TOOL_NAME, type StrongCellValueInput, asRecord, buildCellValueForColumn, buildStrongCellValue, createAvValidationErrorResult, primaryKeyCellIssue, extractKeyValueEntries, getStringField } from './definition';
import { avWriteSuccess, dispatchAvTransaction, resolveAvTransactionBlockId, withUpdatedOperation } from './transaction';
import { createAddRowsSyncTimeoutResult, createAvRowIdErrorResult, createDuplicateRowsValidationResult, extractAvRowLookup, validateRowIdForAv, verifyDuplicateRowsRelationDestinations, waitForAddedRows } from './rows';
import { ensurePermissionForAvId, resolveDuplicateRowsRelationDestinations } from './carrier';

function normalizeCopiedRowValue(value: Record<string, unknown>): unknown {
    const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    delete clone.id;
    delete clone.blockID;
    delete clone.isDetached;
    delete clone.isRenderAutoFill;
    delete clone.createdAt;
    delete clone.updatedAt;
    const block = asRecord(clone.block);
    if (block) {
        delete block.id;
        delete block.updated;
        delete block.created;
    }
    const relation = asRecord(clone.relation);
    if (relation) delete relation.contents;
    return clone;
}

function topLevelViewItemIDs(avData: unknown): Set<string> {
    const itemIDs = new Set<string>();
    const views = asRecord(avData)?.views;
    if (!Array.isArray(views)) return itemIDs;
    for (const view of views) {
        const record = asRecord(view);
        // Raw getAttributeView serializes this persisted top-level membership
        // as itemIds (lowercase d). Keep the historical itemIDs spelling as a
        // compatibility fallback for older kernel payloads/test fixtures; using
        // only the latter rejects a valid canonical row before dispatch.
        const rows = Array.isArray(record?.itemIds)
            ? record.itemIds
            : Array.isArray(record?.itemIDs)
                ? record.itemIDs
                : [];
        for (const rowID of rows) {
            if (typeof rowID === 'string' && rowID) itemIDs.add(rowID);
        }
    }
    return itemIDs;
}

function collectItemIDSnapshots(value: unknown, snapshots: string[][] = []): string[][] {
    if (Array.isArray(value)) {
        for (const item of value) collectItemIDSnapshots(item, snapshots);
        return snapshots;
    }
    const record = asRecord(value);
    if (!record) return snapshots;
    const itemIDs = Array.isArray(record.itemIds)
        ? record.itemIds
        : Array.isArray(record.itemIDs)
            ? record.itemIDs
            : undefined;
    if (itemIDs && itemIDs.every((id) => typeof id === 'string')) {
        snapshots.push(itemIDs as string[]);
    }
    for (const [key, nested] of Object.entries(record)) {
        if (key !== 'itemIds' && key !== 'itemIDs') collectItemIDSnapshots(nested, snapshots);
    }
    return snapshots;
}

function verifyDuplicateRowsSourceReadback(
    before: unknown,
    after: unknown,
    sourceRowIDs: string[],
    copiedRowIDs: string[],
    previousID?: string,
): string | undefined {
    const beforeEntries = extractKeyValueEntries(before);
    const afterEntries = extractKeyValueEntries(after);
    const afterLookup = extractAvRowLookup(after);

    for (let index = 0; index < copiedRowIDs.length; index += 1) {
        const copiedRowID = copiedRowIDs[index];
        const sourceRowID = sourceRowIDs[index];
        const copied = afterLookup.rows.find((row) => row.rowID === copiedRowID);
        if (!copied || copied.isDetached !== true || copied.sourceBlockID) {
            return `Copied row "${copiedRowID}" was not observed as a detached AV row.`;
        }
        for (const entry of beforeEntries) {
            const keyID = getStringField(entry.key, ['id']);
            const keyType = getStringField(entry.key, ['type']);
            if (['rollup', 'created', 'updated'].includes(keyType ?? '')) continue;
            const afterEntry = keyID
                ? afterEntries.find((candidate) => getStringField(candidate.key, ['id']) === keyID)
                : afterEntries.find((candidate) => getStringField(candidate.key, ['type']) === keyType);
            const sourceValue = entry.values.find((value) => getStringField(value, ['blockID']) === sourceRowID);
            if (!sourceValue) continue;
            const copiedValue = afterEntry?.values.find((value) => getStringField(value, ['blockID']) === copiedRowID);
            if (!copiedValue) {
                return `Copied row "${copiedRowID}" did not preserve source row "${sourceRowID}" value for key "${keyID ?? keyType ?? 'unknown'}".`;
            }
            if (keyType === 'block') {
                const sourceContent = getStringField(asRecord(sourceValue.block), ['content']) ?? '';
                const copiedContent = getStringField(asRecord(copiedValue.block), ['content']) ?? '';
                if (sourceContent !== copiedContent) {
                    return `Copied row "${copiedRowID}" primary key text does not match source row "${sourceRowID}".`;
                }
                continue;
            }
            if (JSON.stringify(normalizeCopiedRowValue(sourceValue)) !== JSON.stringify(normalizeCopiedRowValue(copiedValue))) {
                return `Copied row "${copiedRowID}" did not preserve source row "${sourceRowID}" value for key "${keyID ?? keyType ?? 'unknown'}".`;
            }
        }
    }

    const afterItemLists = collectItemIDSnapshots(after);
    const hasExpectedPlacement = afterItemLists.some((itemIDs) => {
        if (!copiedRowIDs.every((rowID) => itemIDs.includes(rowID))) return false;
        if (previousID) {
            const start = itemIDs.indexOf(previousID) + 1;
            return start > 0 && copiedRowIDs.every((rowID, index) => itemIDs[start + index] === rowID);
        }
        return copiedRowIDs.every((rowID, index) => itemIDs[itemIDs.length - copiedRowIDs.length + index] === rowID);
    });
    if (!hasExpectedPlacement) {
        return previousID
            ? `Copied rows were not observed immediately after previousID "${previousID}" in AV item ordering.`
            : 'Copied rows were not observed at the append position in AV item ordering.';
    }
    return undefined;
}

export async function handleAddRows({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvAddRowsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'add_rows' });
    if (denied) return denied;

    if (parsed.rows) {
        return handleCompositeAddRows(client, rawArgs, parsed, avData);
    }

    const blockIDs = parsed.blockIDs ?? [];
    const primaryKeyTexts = parsed.primaryKeyTexts ?? [];
    if (blockIDs.length === 0 && primaryKeyTexts.length === 0) {
        return createWriteSuccessResult({
            action: 'add_rows',
            avID: parsed.avID,
            blockIDs: [],
            primaryKeyTexts: [],
            rows: [],
            added: 0,
            skipped: true,
            message: 'No blockIDs or primaryKeyTexts were provided, so no rows were added.',
        });
    }

    const detachedRows = primaryKeyTexts.map((primaryKeyText) => ({
        primaryKeyText,
        rowID: generateSiYuanNodeId(),
        srcID: generateSiYuanNodeId(),
    }));

    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const srcs = [
        ...blockIDs.map((id) => ({ itemID: generateSiYuanNodeId(), id, isDetached: false })),
        ...detachedRows.map((row) => ({
            itemID: row.rowID,
            id: row.srcID,
            isDetached: true,
            content: row.primaryKeyText,
        })),
    ];
    const updatedOps = withUpdatedOperation([{
        action: 'insertAttrViewBlock',
        avID: parsed.avID,
        blockID: transactionBlockID,
        viewID: parsed.viewID,
        groupID: parsed.groupID,
        previousID: parsed.previousID,
        ignoreDefaultFill: parsed.ignoreDefaultFill,
        srcs,
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: [
            {
                action: 'removeAttrViewBlock',
                srcIDs: [
                    ...blockIDs,
                    ...detachedRows.map((row) => row.rowID),
                ],
                avID: parsed.avID,
            },
            ...updatedOps.undoOperations,
        ],
    }]);

    const resolution = await waitForAddedRows(
        client,
        parsed.avID,
        blockIDs,
        detachedRows.map((row) => ({ primaryKeyText: row.primaryKeyText, rowID: row.rowID })),
    );
    if (resolution.unresolvedBlockIDs.length > 0 || (resolution.unresolvedRowIDs && resolution.unresolvedRowIDs.length > 0)) {
        return createAddRowsSyncTimeoutResult(parsed.avID, blockIDs, resolution, primaryKeyTexts);
    }

    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'add_rows',
        avID: parsed.avID,
        ...(blockIDs.length > 0 ? { blockIDs } : {}),
        ...(primaryKeyTexts.length > 0 ? { primaryKeyTexts } : {}),
        rows: resolution.rows,
        added: blockIDs.length + primaryKeyTexts.length,
        // Detached rows created without cells: the composite rows form adds them with cells in one call.
        ...(primaryKeyTexts.length > 0 ? { batchHint: BATCH_HINTS.avAddRows } : {}),
    });
}

/**
 * Composite add_rows is intentionally two native phases: rows are inserted
 * first, then their initial cells are written with updateAttrViewCell. The
 * kernel does not expose an atomic row+cell creation operation, so the
 * coordinator persists reserved row IDs before this function runs and every
 * stage is checkpointed. A failure after rows exist is reported as partial
 * with exact rowIDs; it is never retried as a second add_rows.
 */
async function handleCompositeAddRows(
    client: SiYuanClient,
    rawArgs: Record<string, unknown>,
    parsed: ReturnType<typeof AvAddRowsSchema.parse>,
    avData: unknown,
): Promise<ToolResult> {
    const context = (rawArgs as Record<symbol, unknown>)[AV_ADD_ROWS_CONTEXT] as AvAddRowsContext | undefined;
    if (!context) {
        throw new Error('Composite add_rows requires a coordinator-issued stage context; run validateOnly preflight first.');
    }
    try {
        assertAvAddRowsStructure(avData, parsed.rows, parsed.viewID, parsed.groupID, parsed.previousID);
    } catch (error) {
        return createAvValidationErrorResult('add_rows', {
            reason: 'batch_validation_failed',
            message: error instanceof Error ? error.message : String(error),
            hint: 'Inspect av(action="get", scope="columns"|"view") for current column IDs, types, view, and group. No rows were added.',
        });
    }

    const plan = context.plan;
    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const srcs = plan.rows.map((row) => ({
        itemID: row.rowID,
        id: row.srcID,
        isDetached: true,
        content: row.primaryKeyText,
    }));
    const insertOps = withUpdatedOperation([{
        action: 'insertAttrViewBlock',
        avID: parsed.avID,
        blockID: transactionBlockID,
        viewID: parsed.viewID,
        groupID: parsed.groupID,
        previousID: parsed.previousID,
        ignoreDefaultFill: parsed.ignoreDefaultFill,
        srcs,
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: insertOps.doOperations,
        undoOperations: [
            { action: 'removeAttrViewBlock', srcIDs: plan.rows.map((row) => row.rowID), avID: parsed.avID },
            ...insertOps.undoOperations,
        ],
    }]);

    // The rows were acknowledged. Persist the exact generated rowIDs before
    // attempting any cell write or, later, verification.
    await context.checkpoint({ stage: 'rows_created', currentStep: 'resolve_rows', rows: plan.rows.map((row) => ({
        index: row.index, clientKey: row.clientKey, rowID: row.rowID, cellCount: row.cells.length,
    })) });

    const resolution = await waitForAddedRows(
        client,
        parsed.avID,
        [],
        plan.rows.map((row) => ({ primaryKeyText: row.primaryKeyText, rowID: row.rowID })),
    );
    if (resolution.unresolvedRowIDs && resolution.unresolvedRowIDs.length > 0) {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'api_error',
                        tool: AV_TOOL_NAME,
                        action: 'add_rows',
                        reason: 'row_id_sync_timeout',
                        message: `Rows were inserted into attribute view "${parsed.avID}", but MCP could not observe every writable rowID before the sync timeout expired. No initial cells were written.`,
                        avID: parsed.avID,
                        rows: plan.rows.map((row) => ({
                            index: row.index,
                            clientKey: row.clientKey,
                            rowID: row.rowID,
                            primaryKeyText: row.primaryKeyText,
                            cellCount: row.cells.length,
                            rowResolved: !resolution.unresolvedRowIDs!.includes(row.rowID),
                        })),
                        unresolvedRowIDs: resolution.unresolvedRowIDs,
                        hint: 'Inspect av(action="query") for the exact rowIDs, then use set_cells for any missing cells. Do not re-run add_rows with the same rows.',
                    },
                }, null, 2),
            }],
            isError: true,
        };
    }

    await context.checkpoint({ stage: 'rows_created', currentStep: 'write_cells', rows: plan.rows.map((row) => ({
        index: row.index, clientKey: row.clientKey, rowID: row.rowID, cellCount: row.cells.length, rowResolved: true,
    })) });

    const cells: Array<Record<string, unknown> & { rowID: string }> = plan.rows.flatMap((row) => (
        row.cells.map((cell) => ({ ...cell, rowID: row.rowID }))
    ));
    if (cells.length > 0) {
        const cellOps = cells.map((cell) => ({
            action: 'updateAttrViewCell',
            avID: parsed.avID,
            keyID: String(cell.columnID),
            rowID: String(cell.rowID),
            data: buildStrongCellValue(String(cell.columnID), String(cell.rowID), cell as unknown as StrongCellValueInput),
        }));
        const cellTransaction = withUpdatedOperation(cellOps, transactionBlockID);
        await transactionApi.performTransactions(client, [{
            doOperations: cellTransaction.doOperations,
            undoOperations: cellTransaction.undoOperations,
        }]);
        await context.checkpoint({ stage: 'cells_written', currentStep: 'verify_cells', rows: plan.rows.map((row) => ({
            index: row.index, clientKey: row.clientKey, rowID: row.rowID, cellCount: row.cells.length, rowResolved: true,
        })) });
        const readback = await avApi.getAttributeView(client, parsed.avID);
        const definition = (readback as { av?: Record<string, unknown> })?.av;
        if (!definition || definition.id !== parsed.avID) {
            throw new Error('Composite add_rows could not read back the attribute view after writing cells.');
        }
        verifyAvCellsReadback({ cells }, definition);
    }
    await context.checkpoint({ stage: 'verified', currentStep: 'complete', rows: plan.rows.map((row) => ({
        index: row.index, clientKey: row.clientKey, rowID: row.rowID, cellCount: row.cells.length, rowResolved: true,
    })) });

    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'add_rows',
        avID: parsed.avID,
        rows: plan.rows.map((row) => ({
            index: row.index,
            clientKey: row.clientKey,
            rowID: row.rowID,
            primaryKeyText: row.primaryKeyText,
            cellCount: row.cells.length,
        })),
        added: plan.rows.length,
        cellsWritten: cells.length,
        stage: 'verified',
        ...(plan.rows.length === 1 ? { batchHint: BATCH_HINTS.avAddRows } : {}),
    });
}

export async function handleRemoveRows({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvRemoveRowsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'remove_rows' });
    if (denied) return denied;

    // rowIDs is the canonical entry point: every ID must resolve to exactly
    // one current AV row item before the native removal can be dispatched.
    // srcIDs remains the explicitly native escape hatch and is never
    // silently reinterpreted as a rowID alias.
    let nativeSrcIDs: string[];
    if (parsed.rowIDs) {
        const rowLookup = extractAvRowLookup(avData);
        const missing = parsed.rowIDs.filter((rowID) => !rowLookup.rowIDs.has(rowID));
        if (missing.length > 0) {
            return createAvRowIdErrorResult('remove_rows', {
                reason: 'row_id_not_canonical',
                message: `rowIDs ${missing.join(', ')} are not canonical AV row item IDs in attribute view "${parsed.avID}". No rows were removed.`,
                avID: parsed.avID,
                rowIDs: missing,
                hint: 'Use rowID values returned by av(action="query"|"add_rows"). Never pass source block IDs or cell value IDs.',
            });
        }
        nativeSrcIDs = parsed.rowIDs;
    } else {
        nativeSrcIDs = parsed.srcIDs!;
    }

    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, [{
        action: 'removeAttrViewBlock',
        srcIDs: nativeSrcIDs,
        avID: parsed.avID,
    }]);
    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'remove_rows',
        avID: parsed.avID,
        ...(parsed.rowIDs ? { rowIDs: parsed.rowIDs } : { srcIDs: parsed.srcIDs }),
        srcIDs: nativeSrcIDs,
        removed: nativeSrcIDs.length,
    });
}

export async function handleSetCells({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetCellsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'set_cells' });
    if (denied) return denied;
    const rowLookup = extractAvRowLookup(avData);
    const isSingleCellCall = !parsed.cells && !parsed.items;
    const singleItem: NonNullable<typeof parsed.cells>[number] = {
        rowID: parsed.rowID!,
        columnID: parsed.columnID!,
        valueType: parsed.valueType!,
        text: parsed.text,
        number: parsed.number,
        numberFormat: parsed.numberFormat,
        date: parsed.date,
        endDate: parsed.endDate,
        includeTime: parsed.includeTime,
        checked: parsed.checked,
        option: parsed.option,
        options: parsed.options,
        relationBlockIDs: parsed.relationBlockIDs,
        url: parsed.url,
        email: parsed.email,
        phone: parsed.phone,
        assets: parsed.assets,
    };
    const items = parsed.cells ?? parsed.items ?? [singleItem];

    if (items.some((item) => item.valueType === 'relation')) {
        // updateAttrViewCell alone authorizes only the source AV, while a
        // relation may mutate a reverse cell in another AV. Keep relation
        // writes on the dedicated action so it can preflight both carriers and
        // read back the complete relation graph instead of a scalar cell.
        return createAvValidationErrorResult('set_cells', {
            reason: 'relation_requires_set_relation',
            message: 'Relation cells must use av(action="set_relation").',
            hint: 'Pass source itemID, relation keyID, complete relatedItemIDs, and the verified source database block to set_relation. An empty relatedItemIDs array clears the relation.',
        });
    }

    const values: TransactionOperation[] = [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const validatedRowID = validateRowIdForAv(parsed.avID, 'set_cells', rowLookup, item.rowID, isSingleCellCall ? undefined : index);
        if (validatedRowID.ok === false) return validatedRowID.result;
        const primaryKeyIssue = primaryKeyCellIssue(avData, item);
        if (primaryKeyIssue) {
            return createAvValidationErrorResult('set_cells', { reason: 'primary_key_cell', message: `${isSingleCellCall ? '' : `cells[${index}]: `}${primaryKeyIssue} No cell was written.` });
        }
        if (isSingleCellCall) {
            await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, [{
                action: 'updateAttrViewCell',
                avID: parsed.avID,
                keyID: item.columnID,
                rowID: validatedRowID.rowID,
                data: buildCellValueForColumn(avData, item.columnID, validatedRowID.rowID, item),
            }]);
            return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
                action: 'set_cells',
                avID: parsed.avID,
                rowID: item.rowID,
                columnID: item.columnID,
                valueType: item.valueType,
                batchHint: BATCH_HINTS.avSetCells,
            });
        }
        values.push({
            action: 'updateAttrViewCell',
            avID: parsed.avID,
            keyID: item.columnID,
            rowID: validatedRowID.rowID,
            data: buildCellValueForColumn(avData, item.columnID, validatedRowID.rowID, item),
        });
    }
    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, values);

    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'set_cells',
        avID: parsed.avID,
        updated: items.length,
        ...(items.length === 1 ? { batchHint: BATCH_HINTS.avSetCells } : {}),
    });
}

export async function handleDuplicateRows({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvDuplicateRowsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'duplicate_rows' });
    if (denied) return denied;

    const rowLookup = extractAvRowLookup(avData);
    const persistentTopLevelRows = topLevelViewItemIDs(avData);
    for (let index = 0; index < parsed.sourceRowIDs.length; index += 1) {
        const sourceRowID = parsed.sourceRowIDs[index];
        const checked = validateRowIdForAv(parsed.avID, 'duplicate_rows', rowLookup, sourceRowID, index);
        if (checked.ok === false) return checked.result;
        const row = rowLookup.rows.find((candidate) => candidate.rowID === sourceRowID);
        if (!row || !row.sourceBlockID || row.isDetached === true) {
            return createDuplicateRowsValidationResult(parsed.avID, sourceRowID,
                `sourceRowID "${sourceRowID}" must be a bound AV row. SiYuan duplicateAttrViewRow creates a detached text record and is not exposed for detached source rows.`);
        }
        if (!persistentTopLevelRows.has(sourceRowID)) {
            return createDuplicateRowsValidationResult(parsed.avID, sourceRowID,
                `sourceRowID "${sourceRowID}" is not present in a persistent top-level AV view and cannot be copied safely.`);
        }
    }
    if (parsed.previousID) {
        const checked = validateRowIdForAv(parsed.avID, 'duplicate_rows', rowLookup, parsed.previousID);
        if (checked.ok === false) return checked.result;
    }

    const relationDestinations = await resolveDuplicateRowsRelationDestinations(
        client,
        permMgr,
        parsed.avID,
        avData,
        parsed.sourceRowIDs,
    );
    if (relationDestinations.denied) return relationDestinations.denied;

    let previousID = parsed.previousID ?? '';
    const createdRowIDs: string[] = [];
    const operations: TransactionOperation[] = [];
    for (const sourceRowID of parsed.sourceRowIDs) {
        const rowID = generateSiYuanNodeId();
        createdRowIDs.push(rowID);
        operations.push({
            action: 'duplicateAttrViewRow',
            avID: parsed.avID,
            id: rowID,
            srcIDs: [sourceRowID],
            previousID,
        });
        previousID = rowID;
    }
    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, operations, [
        {
            action: 'removeAttrViewBlock',
            avID: parsed.avID,
            srcIDs: createdRowIDs,
        },
    ]);

    // A transport error intentionally reaches the single strict coordinator:
    // it records outcome_unknown and never resends duplicateAttrViewRow. Only
    // a normal transaction response reaches this bounded, exact source and
    // reverse-relation readback.
    const sourceReadback = await avApi.getAttributeView(client, parsed.avID);
    const sourceError = verifyDuplicateRowsSourceReadback(
        avData,
        sourceReadback.av,
        parsed.sourceRowIDs,
        createdRowIDs,
        parsed.previousID,
    );
    if (sourceError) throw new Error(sourceError);
    const destinationReadbacks = new Map<string, unknown>();
    for (const destination of relationDestinations.destinations) {
        destinationReadbacks.set(destination.avID, (await avApi.getAttributeView(client, destination.avID)).av);
    }
    const relationError = verifyDuplicateRowsRelationDestinations(
        relationDestinations.destinations,
        createdRowIDs,
        destinationReadbacks,
    );
    if (relationError) throw new Error(relationError);

    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'duplicate_rows',
        avID: parsed.avID,
        sourceRowIDs: parsed.sourceRowIDs,
        rowIDs: createdRowIDs,
        copied: createdRowIDs.length,
        relationDestinationAVIDs: relationDestinations.destinations.map((destination) => destination.avID),
        semantics: 'detached_row_copies_with_verified_source_and_two_way_relation_readback',
    });
}
