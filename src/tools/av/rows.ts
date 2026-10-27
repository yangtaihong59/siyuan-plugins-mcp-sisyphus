/* AV row lookup: row/source-block binding, added-row polling, row-id validation, duplicate-row relations. */
import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import { type ToolResult } from '../internal/shared';
import { sleep } from '../../shared/async';
import { AV_TOOL_NAME, type AttributeViewDefinition, asRecord, extractKeyValueEntries, getAvKeyEntry, getNestedStringField, getStringField, relationBlockIDs } from './definition';

type AvRowBinding = {
    rowID?: string;
    sourceBlockID?: string;
    isDetached?: boolean;
    valueIDs: string[];
};

type AvRowLookup = {
    rows: AvRowBinding[];
    rowIDs: Set<string>;
    sourceBlockToRowIDs: Map<string, string[]>;
    valueIdToRowIDs: Map<string, string[]>;
};

export type DuplicateRowsRelationDestination = {
    avID: string;
    backKeyID: string;
    destinationRowIDs: string[];
    carrierBlockID: string;
    preimage: unknown;
};

type AddRowsResolution = {
    rows: Array<{ blockID?: string; primaryKeyText?: string; rowID?: string; rowIDs?: string[]; status?: 'resolved' | 'missing' | 'ambiguous' }>;
    unresolvedBlockIDs: string[];
    unresolvedRowIDs?: string[];
};

const ADD_ROWS_POLL_ATTEMPTS = 6;

const ADD_ROWS_POLL_DELAY_MS = 500;

export function extractRelationCellItemIDs(
    definition: AttributeViewDefinition,
    keyID: string,
    itemID: string,
    context: string,
): string[] {
    const entry = getAvKeyEntry(definition, keyID, context);
    if (entry.key.type !== 'relation') throw new Error(`${context}: keyID "${keyID}" is not a relation key.`);
    if (entry.values === undefined) {
        // KeyValues.Values is `omitempty` in SiYuan v3.8. A configured
        // relation with no cells is therefore serialized as only `{ key }`.
        // The native setAttributeViewBlockAttr endpoint creates the first cell
        // for an existing AV item; accepting this exact shape is necessary for
        // first writes, but never treats null/malformed lists or unknown rows
        // as empty relation state.
        if (!extractAvRowLookup(definition).rowIDs.has(itemID)) {
            throw new Error(`${context}: relation keyID "${keyID}" has no value list for unknown AV itemID "${itemID}".`);
        }
        return [];
    }
    if (!Array.isArray(entry.values)) throw new Error(`${context}: keyID "${keyID}" has no value list.`);
    const matches = (entry.values as Array<Record<string, unknown>>).filter((value) => value.blockID === itemID);
    if (matches.length > 1) throw new Error(`${context}: relation cell ${keyID}/${itemID} resolves more than once.`);
    if (matches.length === 0) return [];
    const relation = matches[0].relation;
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) {
        throw new Error(`${context}: relation cell ${keyID}/${itemID} has no relation payload.`);
    }
    const blockIDs = (relation as Record<string, unknown>).blockIDs;
    if (blockIDs === null || blockIDs === undefined) return [];
    if (!Array.isArray(blockIDs) || blockIDs.some((id) => typeof id !== 'string')) {
        throw new Error(`${context}: relation cell ${keyID}/${itemID} has an invalid blockIDs payload.`);
    }
    return blockIDs as string[];
}

function extractRowIdFromValue(value: unknown): string | undefined {
    return getStringField(value, ['blockID', 'itemId', 'itemID', 'rowID'])
        ?? getNestedStringField(value, ['block', 'blockID']);
}

export function extractSourceBlockIdFromBlockValue(value: unknown): string | undefined {
    return getNestedStringField(value, ['block', 'id'])
        ?? getStringField(value, ['srcID', 'srcId']);
}

function extractValueIdFromValue(value: unknown): string | undefined {
    return getStringField(value, ['id']);
}

export function extractAvRowLookup(avData: unknown): AvRowLookup {
    const rowsById = new Map<string, AvRowBinding>();
    const rowsInOrder: AvRowBinding[] = [];
    if (!avData || typeof avData !== 'object') {
        return { rows: [], rowIDs: new Set<string>(), sourceBlockToRowIDs: new Map<string, string[]>(), valueIdToRowIDs: new Map<string, string[]>() };
    }

    const keyValues = (avData as { keyValues?: unknown }).keyValues;
    if (!Array.isArray(keyValues)) {
        return { rows: [], rowIDs: new Set<string>(), sourceBlockToRowIDs: new Map<string, string[]>(), valueIdToRowIDs: new Map<string, string[]>() };
    }

    for (const entry of keyValues) {
        if (!entry || typeof entry !== 'object') continue;
        const typedEntry = entry as { key?: { type?: string }; values?: unknown };
        const values = typedEntry.values;
        if (!Array.isArray(values)) continue;

        values.forEach((value) => {
            const rowID = extractRowIdFromValue(value);
            if (!rowID) return;

            let row = rowsById.get(rowID);
            if (!row) {
                row = { rowID, valueIDs: [] };
                rowsById.set(rowID, row);
                rowsInOrder.push(row);
            }

            const valueID = extractValueIdFromValue(value);
            const sourceBlockID = typedEntry.key?.type === 'block' ? extractSourceBlockIdFromBlockValue(value) : undefined;
            const isDetached = typedEntry.key?.type === 'block' && (value as { isDetached?: unknown }).isDetached === true;
            if (sourceBlockID) row.sourceBlockID = sourceBlockID;
            if (isDetached) row.isDetached = true;
            if (valueID && !row.valueIDs.includes(valueID)) row.valueIDs.push(valueID);
        });
    }

    const rows = rowsInOrder.filter((row) => row.rowID || row.sourceBlockID || row.valueIDs.length > 0);
    const rowIDs = new Set<string>();
    const sourceBlockToRowIDs = new Map<string, string[]>();
    const valueIdToRowIDs = new Map<string, string[]>();

    for (const row of rows) {
        if (row.rowID) rowIDs.add(row.rowID);
        if (row.sourceBlockID && row.rowID) {
            const matches = sourceBlockToRowIDs.get(row.sourceBlockID) ?? [];
            if (!matches.includes(row.rowID)) {
                matches.push(row.rowID);
                sourceBlockToRowIDs.set(row.sourceBlockID, matches);
            }
        }
        if (!row.rowID) continue;
        for (const valueID of row.valueIDs) {
            const matches = valueIdToRowIDs.get(valueID) ?? [];
            if (!matches.includes(row.rowID)) {
                matches.push(row.rowID);
                valueIdToRowIDs.set(valueID, matches);
            }
        }
    }

    return { rows, rowIDs, sourceBlockToRowIDs, valueIdToRowIDs };
}

function getRowValue(entries: Array<{ key: Record<string, unknown>; values: Array<Record<string, unknown>> }>, keyID: string, rowID: string): Record<string, unknown> | undefined {
    return entries.find((entry) => getStringField(entry.key, ['id']) === keyID)?.values
        .find((value) => getStringField(value, ['blockID']) === rowID);
}

export function collectDuplicateRowsRelationDestinations(
    avData: unknown,
    sourceRowIDs: string[],
): Array<Omit<DuplicateRowsRelationDestination, 'carrierBlockID' | 'preimage'>> {
    const destinations = new Map<string, Omit<DuplicateRowsRelationDestination, 'carrierBlockID' | 'preimage'>>();
    for (const entry of extractKeyValueEntries(avData)) {
        if (getStringField(entry.key, ['type']) !== 'relation') continue;
        const relation = asRecord(entry.key.relation);
        const avID = getStringField(relation, ['avID']);
        const backKeyID = getStringField(relation, ['backKeyID']);
        if (relation?.isTwoWay !== true || !avID || !backKeyID) continue;
        const destination = destinations.get(`${avID}:${backKeyID}`) ?? {
            avID,
            backKeyID,
            destinationRowIDs: [],
        };
        for (const sourceRowID of sourceRowIDs) {
            for (const destinationRowID of relationBlockIDs(entry.values.find((value) => getStringField(value, ['blockID']) === sourceRowID))) {
                if (!destination.destinationRowIDs.includes(destinationRowID)) {
                    destination.destinationRowIDs.push(destinationRowID);
                }
            }
        }
        // A two-way key without a selected source-to-destination link does
        // not mutate its reverse AV. Do not turn metadata alone into an
        // unnecessary cross-notebook permission dependency.
        if (destination.destinationRowIDs.length > 0) {
            destinations.set(`${avID}:${backKeyID}`, destination);
        }
    }
    return [...destinations.values()];
}

export function createDuplicateRowsValidationResult(
    avID: string,
    sourceRowID: string,
    message: string,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: AV_TOOL_NAME,
                    action: 'duplicate_rows',
                    avID,
                    sourceRowID,
                    message,
                },
            }, null, 2),
        }],
        isError: true,
    };
}

export function createAvRowIdErrorResult(
    action: 'set_cells' | 'duplicate_rows' | 'remove_rows',
    payload: Record<string, unknown>,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: AV_TOOL_NAME,
                    action,
                    ...payload,
                },
            }, null, 2),
        }],
        isError: true,
    };
}

export function createAddRowsSyncTimeoutResult(
    avID: string,
    blockIDs: string[],
    resolution: AddRowsResolution,
    primaryKeyTexts: string[] = [],
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'api_error',
                    tool: AV_TOOL_NAME,
                    action: 'add_rows',
                    reason: 'row_id_sync_timeout',
                    message: `Added rows to attribute view "${avID}", but MCP could not observe writable row item IDs before the sync timeout expired.`,
                    avID,
                    ...(blockIDs.length > 0 ? { blockIDs } : {}),
                    ...(primaryKeyTexts.length > 0 ? { primaryKeyTexts } : {}),
                    rows: resolution.rows,
                    ...(resolution.unresolvedBlockIDs.length > 0 ? { unresolvedBlockIDs: resolution.unresolvedBlockIDs } : {}),
                    ...(resolution.unresolvedRowIDs && resolution.unresolvedRowIDs.length > 0 ? { unresolvedRowIDs: resolution.unresolvedRowIDs } : {}),
                    hint: 'Retry av(action="add_rows") or wait briefly and re-read the database. Only call set_cells after add_rows returns rows[].rowID.',
                },
            }, null, 2),
        }],
        isError: true,
    };
}

function resolveAddedRows(rowLookup: AvRowLookup, blockIDs: string[]): AddRowsResolution {
    const rows = blockIDs.map((blockID) => {
        const matchedRowIDs = rowLookup.sourceBlockToRowIDs.get(blockID) ?? [];
        if (matchedRowIDs.length === 1) {
            return { blockID, rowID: matchedRowIDs[0] };
        }
        if (matchedRowIDs.length > 1) {
            return { blockID, rowIDs: matchedRowIDs, status: 'ambiguous' as const };
        }
        return { blockID, status: 'missing' as const };
    });
    const unresolvedBlockIDs = rows
        .filter((row) => !('rowID' in row))
        .map((row) => row.blockID);
    return { rows, unresolvedBlockIDs };
}

function resolveDetachedRows(
    rowLookup: AvRowLookup,
    rows: Array<{ primaryKeyText: string; rowID: string }>,
): AddRowsResolution {
    const resolvedRows = rows.map((row) => (
        rowLookup.rowIDs.has(row.rowID)
            ? row
            : { ...row, status: 'missing' as const }
    ));
    const unresolvedRowIDs = resolvedRows
        .filter((row) => 'status' in row && row.status === 'missing')
        .map((row) => row.rowID);
    return { rows: resolvedRows, unresolvedBlockIDs: [], unresolvedRowIDs };
}

export async function waitForAddedRows(
    client: SiYuanClient,
    avID: string,
    blockIDs: string[],
    detachedRows: Array<{ primaryKeyText: string; rowID: string }> = [],
): Promise<AddRowsResolution> {
    let lastResolution: AddRowsResolution = {
        rows: [
            ...blockIDs.map((blockID) => ({ blockID })),
            ...detachedRows,
        ],
        unresolvedBlockIDs: [...blockIDs],
        unresolvedRowIDs: detachedRows.map((row) => row.rowID),
    };

    for (let attempt = 0; attempt < ADD_ROWS_POLL_ATTEMPTS; attempt += 1) {
        const refreshed = await avApi.getAttributeView(client, avID);
        const rowLookup = extractAvRowLookup(refreshed.av);
        const boundResolution = resolveAddedRows(rowLookup, blockIDs);
        const detachedResolution = resolveDetachedRows(rowLookup, detachedRows);
        lastResolution = {
            rows: [...boundResolution.rows, ...detachedResolution.rows],
            unresolvedBlockIDs: boundResolution.unresolvedBlockIDs,
            unresolvedRowIDs: detachedResolution.unresolvedRowIDs,
        };
        if (lastResolution.unresolvedBlockIDs.length === 0 && (!lastResolution.unresolvedRowIDs || lastResolution.unresolvedRowIDs.length === 0)) {
            return lastResolution;
        }
        if (attempt < ADD_ROWS_POLL_ATTEMPTS - 1) {
            await sleep(ADD_ROWS_POLL_DELAY_MS);
        }
    }

    return lastResolution;
}

export function validateRowIdForAv(
    avID: string,
    action: 'set_cells' | 'duplicate_rows',
    rowLookup: AvRowLookup,
    requestedRowID: string,
    itemIndex?: number,
): { ok: true; rowID: string } | { ok: false; result: ToolResult } {
    if (rowLookup.rowIDs.has(requestedRowID)) {
        return { ok: true, rowID: requestedRowID };
    }

    const matchedValueRowIDs = rowLookup.valueIdToRowIDs.get(requestedRowID);
    if (matchedValueRowIDs && matchedValueRowIDs.length === 1) {
        return {
            ok: false,
            result: createAvRowIdErrorResult(action, {
                reason: 'row_id_alias_detected',
                message: `rowID "${requestedRowID}" is a cell value ID in attribute view "${avID}", not the database row item ID.`,
                avID,
                rowID: requestedRowID,
                detectedValueID: requestedRowID,
                suggestedRowID: matchedValueRowIDs[0],
                ...(itemIndex === undefined ? {} : { itemIndex }),
                hint: 'Use the AV row item ID stored in each value.blockID, or the rowID returned by av(action="add_rows"). Do not reuse value.id from set_cells responses as rowID.',
            }),
        };
    }

    if (matchedValueRowIDs && matchedValueRowIDs.length > 1) {
        return {
            ok: false,
            result: createAvRowIdErrorResult(action, {
                reason: 'row_id_alias_ambiguous',
                message: `rowID "${requestedRowID}" matches multiple cell value records in attribute view "${avID}". Pass a concrete row item ID instead.`,
                avID,
                rowID: requestedRowID,
                detectedValueID: requestedRowID,
                candidateRowIDs: matchedValueRowIDs,
                ...(itemIndex === undefined ? {} : { itemIndex }),
                hint: 'Use the row item ID stored in value.blockID, not value.id.',
            }),
        };
    }

    const matchingRowIDs = rowLookup.sourceBlockToRowIDs.get(requestedRowID);
    if (matchingRowIDs && matchingRowIDs.length === 1) {
        return {
            ok: false,
            result: createAvRowIdErrorResult(action, {
                reason: 'row_id_required',
                message: `rowID "${requestedRowID}" is a source block ID in attribute view "${avID}". Use the row item ID instead.`,
                avID,
                rowID: requestedRowID,
                detectedSourceBlockID: requestedRowID,
                suggestedRowID: matchingRowIDs[0],
                ...(itemIndex === undefined ? {} : { itemIndex }),
                hint: 'Use the row item ID stored in value.blockID, or the rowID returned by av(action="add_rows"). The source block ID lives in block.id and is not writable as rowID.',
            }),
        };
    }

    if (matchingRowIDs && matchingRowIDs.length > 1) {
        return {
            ok: false,
            result: createAvRowIdErrorResult(action, {
                reason: 'row_id_ambiguous',
                message: `rowID "${requestedRowID}" matches multiple rows in attribute view "${avID}". Pass a concrete row item ID instead of the source block ID.`,
                avID,
                rowID: requestedRowID,
                detectedSourceBlockID: requestedRowID,
                candidateRowIDs: matchingRowIDs,
                ...(itemIndex === undefined ? {} : { itemIndex }),
                hint: 'Use the exact row item ID returned by av(action="add_rows"), or inspect the AV payload to choose the intended row binding.',
            }),
        };
    }

    return {
        ok: false,
        result: createAvRowIdErrorResult(action, {
            reason: 'row_id_not_canonical',
            message: `rowID "${requestedRowID}" is not a valid database row item ID in attribute view "${avID}". Pass the canonical row item ID stored in value.blockID.`,
            avID,
            rowID: requestedRowID,
            ...(itemIndex === undefined ? {} : { itemIndex }),
            hint: 'Use the rowID returned by av(action="add_rows"), or inspect the block column in av(action="get"): value.blockID is the writable row item ID, while value.id is only the cell value ID.',
        }),
    };
}

export function verifyDuplicateRowsRelationDestinations(
    destinations: DuplicateRowsRelationDestination[],
    copiedRowIDs: string[],
    readbacks: Map<string, unknown>,
): string | undefined {
    for (const destination of destinations) {
        const beforeEntries = extractKeyValueEntries(destination.preimage);
        const after = readbacks.get(destination.avID);
        const afterEntries = extractKeyValueEntries(after);
        for (const destinationRowID of destination.destinationRowIDs) {
            const beforeValue = getRowValue(beforeEntries, destination.backKeyID, destinationRowID);
            const afterValue = getRowValue(afterEntries, destination.backKeyID, destinationRowID);
            const beforeIDs = relationBlockIDs(beforeValue);
            const afterIDs = relationBlockIDs(afterValue);
            const missing = copiedRowIDs.filter((rowID) => !afterIDs.includes(rowID));
            const unexpected = afterIDs.filter((rowID) => !beforeIDs.includes(rowID) && !copiedRowIDs.includes(rowID));
            if (missing.length > 0 || unexpected.length > 0) {
                return `Two-way relation readback drifted in destination AV "${destination.avID}" row "${destinationRowID}".`;
            }
        }
    }
    return undefined;
}
