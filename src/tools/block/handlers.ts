import type { SiYuanClient } from '../../api/client';
import * as attributeApi from '../../api/block';
import * as blockApi from '../../api/block';
import * as transactionApi from '../../api/transaction';
import type { BlockAction } from '../../core/config';
import { normalizeKramdownResult, stripZeroWidthChars } from '../../core/normalize';
import {
    BlockAddToDailyNoteSchema,
    BlockAppendSchema,
    BlockBatchKramdownSchema,
    BlockBreadcrumbSchema,
    BlockDeleteSchema,
    BlockDomSchema,
    BlockDocsInfoSchema,
    BlockSetFoldStateSchema,
    BlockGetAttrsSchema,
    BlockGetChildrenSchema,
    BlockGetKramdownSchema,
    BlockInfoSchema,
    BlockInsertSchema,
    BlockMoveSchema,
    BlockPrependSchema,
    BlockRecentUpdatedSchema,
    BlockReplaceSchema,
    BlockSetAttrsSchema,
    BlockTransferReferencesSchema,
    BlockUpdateSchema,
    BlockWordCountSchema,
} from '../../core/types';
import { isMissingBlockError } from '../internal/errorTranslation';
import { createResultResolutionCache, ensurePermissionForDocumentId, ensurePermissionForNotebook, resolveDocumentContextById, resolveResultItemContext } from '../internal/context';
import type { ToolActionHandler } from '../internal/define-tool';
import { filterItemsByPermission } from '../search';
import { createJsonResult, createPaginatedResult, createWriteSuccessResult, paginate, type ToolResult } from '../internal/shared';
import { applyUiRefresh } from '../internal/ui-refresh';
import { createFootnoteReferenceHint, createSiyuanBlockLinkHint, createUnresolvedBlockRefHint, hasBlockRefIdFallbackAnchors, hasFootnoteReferences, hasSiyuanBlockLinks, normalizeDomInlineRefsAndTags, replaceEditTouchesIndexedInline, replaceSingleKramdownBlockContentInDom } from '../internal/kramdown-safe';
import { normalizeMarkdownInputRefs, normalizeReplaceEditsRefs } from '../internal/markdown-input';


type RecentUpdatedDocumentSummary = {
    documentId: string;
    notebook: string;
    path: string;
    hPath?: string;
    name?: string;
    updatedBlockCount: number;
    sampleBlocks: Array<{
        id?: string;
        type?: string;
        subtype?: string;
        content?: string;
        path?: string;
    }>;
};

type BlockActionHandler = ToolActionHandler;

async function getBlockType(client: SiYuanClient, id: string): Promise<string | undefined> {
    if (typeof (client as { request?: unknown }).request !== 'function') {
        return undefined;
    }

    try {
        const rows = await client.requestRead<unknown[]>('/api/query/sql', {
            stmt: `SELECT type FROM blocks WHERE id = '${String(id).replace(/\0/g, '').replace(/'/g, "''")}' LIMIT 1`,
        });
        const first = Array.isArray(rows) ? rows[0] : undefined;
        return first && typeof first === 'object' && typeof (first as Record<string, unknown>).type === 'string'
            ? (first as Record<string, string>).type
            : undefined;
    } catch {
        return undefined;
    }
}

function createDatabaseBlockHint(actionName: string): Record<string, unknown> {
    return {
        databaseBlock: true,
        warning: `${actionName} operated on a database/attribute-view block container. To read or edit database rows, columns, or cells, use av(action="get"|"render"|"add_rows"|"remove_rows"|"add_column"|"remove_column"|"set_cells") with the attribute view ID instead of editing the block as markdown.`,
        avToolHint: {
            read: 'av(action="get", id="<av-id>") or av(action="render", id="<av-id>", blockID="<database-block-id>")',
            write: 'av(action="set_cells"|"add_rows"|"remove_rows"|"add_column"|"remove_column", avID="<av-id>", ...)',
        },
    };
}

function withReferenceSemanticsHints(payload: Record<string, unknown>, data: string): Record<string, unknown> {
    return {
        ...payload,
        ...(hasSiyuanBlockLinks(data) ? createSiyuanBlockLinkHint() : {}),
        ...(hasFootnoteReferences(data) ? createFootnoteReferenceHint() : {}),
        ...(hasBlockRefIdFallbackAnchors(data) ? createUnresolvedBlockRefHint() : {}),
    };
}

function hasReferenceSemanticsHints(data: string): boolean {
    return hasSiyuanBlockLinks(data) || hasFootnoteReferences(data) || hasBlockRefIdFallbackAnchors(data);
}

function createReferenceSemanticsHints(data: string): Record<string, unknown> {
    return withReferenceSemanticsHints({}, data);
}

function isLowLevelRecentBlockType(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return value !== 'd';
}

function createRecentUpdatedSampleBlock(item: unknown): {
    id?: string;
    type?: string;
    subtype?: string;
    content?: string;
    path?: string;
} {
    if (!item || typeof item !== 'object') return {};
    const typed = item as Record<string, unknown>;
    return {
        ...(typeof typed.id === 'string' ? { id: typed.id } : {}),
        ...(typeof typed.type === 'string' ? { type: typed.type } : {}),
        ...(typeof typed.subtype === 'string' ? { subtype: typed.subtype } : {}),
        ...(typeof typed.content === 'string' ? { content: typed.content } : {}),
        ...(typeof typed.path === 'string' ? { path: typed.path } : {}),
    };
}

async function aggregateRecentUpdatedDocuments(
    client: SiYuanClient,
    items: unknown[],
): Promise<{ documents: RecentUpdatedDocumentSummary[]; containsLowLevelBlocks: boolean }> {
    const cache = createResultResolutionCache();
    const grouped = new Map<string, RecentUpdatedDocumentSummary>();
    let containsLowLevelBlocks = false;

    for (const item of items) {
        if (item && typeof item === 'object') {
            const typedItem = item as Record<string, unknown>;
            if (isLowLevelRecentBlockType(typedItem.type)) {
                containsLowLevelBlocks = true;
            }
        }

        const context = await resolveResultItemContext(client, item, cache);
        if (!context?.documentId || !context.notebook || !context.path) continue;

        let group = grouped.get(context.documentId);
        if (!group) {
            let name: string | undefined;
            let hPath: string | undefined;
            try {
                const resolved = await resolveDocumentContextById(client, context.documentId);
                name = resolved.name;
                hPath = resolved.hPath;
            } catch {
                name = undefined;
                hPath = undefined;
            }

            group = {
                documentId: context.documentId,
                notebook: context.notebook,
                path: context.path,
                ...(hPath ? { hPath } : {}),
                ...(name ? { name } : {}),
                updatedBlockCount: 0,
                sampleBlocks: [],
            };
            grouped.set(context.documentId, group);
        }

        group.updatedBlockCount += 1;
        if (group.sampleBlocks.length < 3) {
            group.sampleBlocks.push(createRecentUpdatedSampleBlock(item));
        }
    }

    return {
        documents: [...grouped.values()],
        containsLowLevelBlocks,
    };
}

function createSlimWriteResult(
    rawResult: unknown,
    context: {
        action: 'insert' | 'prepend' | 'append';
        dataType: string;
        parentID?: string;
        previousID?: string;
        nextID?: string;
    } & Record<string, unknown>,
): ToolResult {
    const operationBatch = Array.isArray(rawResult) ? rawResult[0] : rawResult;
    const firstOperation = operationBatch && typeof operationBatch === 'object' && Array.isArray((operationBatch as { doOperations?: unknown[] }).doOperations)
        ? (operationBatch as { doOperations: Array<Record<string, unknown>> }).doOperations[0]
        : undefined;

    const id = typeof firstOperation?.id === 'string' ? firstOperation.id : undefined;
    const parentID = typeof firstOperation?.parentID === 'string' ? firstOperation.parentID : context.parentID;
    const previousID = typeof firstOperation?.previousID === 'string' ? firstOperation.previousID : context.previousID;
    const nextID = typeof firstOperation?.nextID === 'string' ? firstOperation.nextID : context.nextID;

    const payload: Record<string, unknown> = {
        action: context.action,
        ...(id ? { id } : {}),
        ...(parentID ? { parentID } : {}),
        ...(previousID ? { previousID } : {}),
        ...(nextID ? { nextID } : {}),
        dataType: context.dataType,
    };
    for (const [key, value] of Object.entries(context)) {
        if (!['action', 'dataType', 'parentID', 'previousID', 'nextID'].includes(key)) {
            payload[key] = value;
        }
    }

    return createWriteSuccessResult(payload);
}

function createUpdateResult(
    rawResult: unknown,
    context: {
        id: string;
        dataType: 'markdown' | 'dom';
        data: string;
    } & Record<string, unknown>,
): ToolResult {
    const payload: Record<string, unknown> = {
        success: true,
        id: context.id,
        dataType: context.dataType,
    };
    for (const [key, value] of Object.entries(context)) {
        if (!['id', 'dataType', 'data'].includes(key)) {
            payload[key] = value;
        }
    }

    if (context.dataType === 'markdown') {
        payload.markdown = stripZeroWidthChars(context.data);
    }

    Object.assign(payload, createReferenceSemanticsHints(context.data));

    if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) {
        const updated = (rawResult as Record<string, unknown>).updated;
        if (updated !== undefined) {
            payload.updated = updated;
        }
    }

    if (context.dataType === 'markdown' && /[\r\n]/.test(context.data)) {
        payload.warning = 'block(update) is best for single-block replacement. Multi-line markdown may be truncated to the first line by SiYuan; use block(append), block(prepend), or block(insert) when you need multiple blocks or tables.';
    }

    return createJsonResult(payload);
}

function createBatchInsertAnchorValidationResult(itemIndex: number): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: 'block',
                    action: 'insert',
                    message: 'Invalid arguments for block(action="insert").',
                    fields: [{
                        path: `blocks[${itemIndex}].previousID`,
                        message: 'Provide nextID, previousID, or parentID for each block, or set a batch-level parentID/previousID/nextID.',
                    }],
                },
            }, null, 2),
        }],
        isError: true,
    };
}

async function normalizeBatchInsertBlocks(
    client: SiYuanClient,
    blocks: Array<{
        dataType: 'markdown' | 'dom';
        data: string;
        nextID?: string;
        previousID?: string;
        parentID?: string;
    }>,
    defaults: {
        nextID?: string;
        previousID?: string;
        parentID?: string;
    },
): Array<{
    dataType: 'markdown' | 'dom';
    data: string;
    nextID?: string;
    previousID?: string;
    parentID?: string;
}> {
    return Promise.all(blocks.map(async (block) => ({
        ...block,
        data: await normalizeWriteData(client, block.dataType, block.data, 'block.insert'),
        nextID: block.nextID ?? defaults.nextID,
        previousID: block.previousID ?? defaults.previousID,
        parentID: block.parentID ?? defaults.parentID,
    })));
}

async function normalizeWriteData(client: SiYuanClient, dataType: 'markdown' | 'dom', data: string, actionName: string): Promise<string> {
    if (dataType === 'dom') {
        return normalizeDomInlineRefsAndTags(data, actionName);
    }

    return normalizeMarkdownInputRefs(client, data, actionName);
}

async function normalizeBatchUpdateItems(
    client: SiYuanClient,
    items: Array<{
        id: string;
        dataType: 'markdown' | 'dom';
        data: string;
    }>,
): Array<{
    id: string;
    dataType: 'markdown' | 'dom';
    data: string;
}> {
    return Promise.all(items.map(async (item) => ({
        ...item,
        data: await normalizeWriteData(client, item.dataType, item.data, 'block.update'),
    })));
}

function extractBatchInsertCreatedBlockIds(rawResult: unknown): string[] {
    const batches = Array.isArray(rawResult) ? rawResult : [rawResult];
    const ids: string[] = [];

    for (const batch of batches) {
        if (!batch || typeof batch !== 'object') continue;
        const doOperations = (batch as { doOperations?: unknown }).doOperations;
        if (!Array.isArray(doOperations)) continue;

        for (const operation of doOperations) {
            if (!operation || typeof operation !== 'object') continue;
            const id = (operation as { id?: unknown }).id;
            if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) {
                ids.push(id);
            }
        }
    }

    return ids;
}

function createBatchInsertVerificationErrorResult(
    blockCount: number,
    transactions: unknown,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'api_error',
                    tool: 'block',
                    action: 'insert',
                    reason: 'empty_transaction_result',
                    message: `SiYuan accepted insert for ${blockCount} block(s), but returned no created block IDs.`,
                    hint: 'Check that each item includes nextID, previousID, or parentID, or provide one batch-level parentID/previousID/nextID, then retry. MCP now rejects no-op insert responses instead of reporting success.',
                    transactions,
                },
            }, null, 2),
        }],
        isError: true,
    };
}

const handleInsert: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockInsertSchema.parse(rawArgs);
    if (parsed.blocks) {
        const normalizedBlocks = await normalizeBatchInsertBlocks(client, parsed.blocks, {
            parentID: parsed.parentID,
            previousID: parsed.previousID,
            nextID: parsed.nextID,
        });
        const reloadIds = new Set<string>();
        for (const [index, block] of normalizedBlocks.entries()) {
            const refId = block.nextID || block.previousID || block.parentID;
            if (!refId) return createBatchInsertAnchorValidationResult(index);
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, refId, 'write');
            if (denied) return denied;
            reloadIds.add(context.documentId);
        }
        const result = await blockApi.batchInsertBlock(client, normalizedBlocks);
        const createdBlockIds = extractBatchInsertCreatedBlockIds(result);
        if (createdBlockIds.length === 0) {
            return createBatchInsertVerificationErrorResult(normalizedBlocks.length, result);
        }
        return applyUiRefresh(client, createJsonResult({
            success: true,
            action: 'insert',
            count: normalizedBlocks.length,
            createdBlockIDs: createdBlockIds,
            transactions: result,
            ...(normalizedBlocks.some((block) => hasReferenceSemanticsHints(block.data)) ? createReferenceSemanticsHints(normalizedBlocks.map((block) => block.data).join('\n')) : {}),
        }), [...reloadIds].map((id) => ({ type: 'reloadProtyle' as const, id })));
    }
    const refId = parsed.nextID || parsed.previousID || parsed.parentID;
    let targetDocumentId: string | undefined;
    if (refId) {
        const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, refId, 'write');
        if (denied) return denied;
        targetDocumentId = context.documentId;
    }
    const data = await normalizeWriteData(client, parsed.dataType!, parsed.data!, 'block.insert');
    const result = await blockApi.insertBlock(client, parsed.dataType!, data, parsed.nextID, parsed.previousID, parsed.parentID);
    return applyUiRefresh(client, createSlimWriteResult(result, withReferenceSemanticsHints({
        action: 'insert',
        dataType: parsed.dataType!,
        parentID: parsed.parentID,
        previousID: parsed.previousID,
        nextID: parsed.nextID,
    }, data)), targetDocumentId ? [{ type: 'reloadProtyle', id: targetDocumentId }] : []);
};

const handlePrepend: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockPrependSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.parentID, 'write');
    if (denied) return denied;
    const data = await normalizeWriteData(client, parsed.dataType, parsed.data, 'block.prepend');
    const result = await blockApi.prependBlock(client, parsed.dataType, data, parsed.parentID);
    return applyUiRefresh(client, createSlimWriteResult(result, withReferenceSemanticsHints({
        action: 'prepend',
        dataType: parsed.dataType,
        parentID: parsed.parentID,
    }, data)), [{ type: 'reloadProtyle', id: context.documentId }]);
};

const handleAppend: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockAppendSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.parentID, 'write');
    if (denied) return denied;
    const data = await normalizeWriteData(client, parsed.dataType, parsed.data, 'block.append');
    const result = await blockApi.appendBlock(client, parsed.dataType, data, parsed.parentID);
    return applyUiRefresh(client, createSlimWriteResult(result, withReferenceSemanticsHints({
        action: 'append',
        dataType: parsed.dataType,
        parentID: parsed.parentID,
    }, data)), [{ type: 'reloadProtyle', id: context.documentId }]);
};

const handleUpdate: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockUpdateSchema.parse(rawArgs);
    if (parsed.items) {
        const items = await normalizeBatchUpdateItems(client, parsed.items);
        const reloadIds = new Set<string>();
        const databaseBlockIds: string[] = [];
        for (const block of items) {
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, block.id, 'write');
            if (denied) return denied;
            if (await getBlockType(client, block.id) === 'av') {
                databaseBlockIds.push(block.id);
            }
            reloadIds.add(context.documentId);
        }
        const result = await blockApi.batchUpdateBlock(client, items);
        return applyUiRefresh(client, createJsonResult({
            success: true,
            action: 'update',
            count: parsed.items.length,
            transactions: result,
            ...(items.some((item) => hasReferenceSemanticsHints(item.data)) ? createReferenceSemanticsHints(items.map((item) => item.data).join('\n')) : {}),
            ...(databaseBlockIds.length > 0 ? {
                databaseBlockIds,
                ...createDatabaseBlockHint('block.update'),
            } : {}),
        }), [...reloadIds].map((id) => ({ type: 'reloadProtyle' as const, id })));
    }
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id!, 'write');
    if (denied) return denied;
    const isDatabaseBlock = await getBlockType(client, parsed.id!) === 'av';
    const data = await normalizeWriteData(client, parsed.dataType!, parsed.data!, 'block.update');
    const result = await blockApi.updateBlock(client, parsed.dataType!, data, parsed.id!);
    return applyUiRefresh(client, createUpdateResult(result, {
        id: parsed.id!,
        dataType: parsed.dataType!,
        data,
        ...(isDatabaseBlock ? createDatabaseBlockHint('block.update') : {}),
    }), [{ type: 'reloadProtyle', id: context.documentId }]);
};

const handleReplace: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockReplaceSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'write');
    if (denied) return denied;

    const current = normalizeKramdownResult(await blockApi.getBlockKramdown(client, parsed.id));
    const originalContent = typeof current.kramdown === 'string' ? current.kramdown : '';
    const dom = await blockApi.getBlockDOM(client, parsed.id);
    const originalDom = typeof dom.dom === 'string' ? dom.dom : '';
    const edits = await normalizeReplaceEditsRefs(client, Array.isArray(parsed.edit) ? parsed.edit : [parsed.edit], 'block.replace');
    const { kramdown: nextContent, markdown: nextMarkdown, dom: nextDom, summary } = replaceSingleKramdownBlockContentInDom(originalContent, originalDom, edits, 'block.replace');
    const changed = nextContent !== originalContent;

    if (changed) {
        const shouldReparseIndexedInline = edits.some(replaceEditTouchesIndexedInline);
        await blockApi.updateBlock(
            client,
            shouldReparseIndexedInline ? 'markdown' : 'dom',
            shouldReparseIndexedInline ? nextMarkdown : nextDom,
            parsed.id,
        );
    }

    return applyUiRefresh(client, createJsonResult({
        success: true,
        action: 'replace',
        id: parsed.id,
        changed,
        editsApplied: summary.length,
        replacements: summary,
        ...(hasReferenceSemanticsHints(nextContent) ? createReferenceSemanticsHints(nextContent) : {}),
    }), changed ? [{ type: 'reloadProtyle', id: context.documentId }] : []);
};

const handleDelete: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockDeleteSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'delete');
    if (denied) return denied;
    const isDatabaseBlock = await getBlockType(client, parsed.id) === 'av';
    await blockApi.deleteBlock(client, parsed.id);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        id: parsed.id,
        ...(isDatabaseBlock ? createDatabaseBlockHint('block.delete') : {}),
    }), [{ type: 'reloadProtyle', id: context.documentId }]);
};

const handleMove: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockMoveSchema.parse(rawArgs);
    const sourceIds = parsed.ids ?? [parsed.id!];
    const sourceDocumentIds = new Set<string>();
    for (const id of sourceIds) {
        const source = await ensurePermissionForDocumentId(client, permMgr, id, 'write');
        if (source.denied) return source.denied;
        sourceDocumentIds.add(source.context.documentId);
    }
    if (parsed.parentID) {
        const destination = await ensurePermissionForDocumentId(client, permMgr, parsed.parentID, 'write');
        if (destination.denied) return destination.denied;
    }
    if (parsed.previousID) {
        const sibling = await ensurePermissionForDocumentId(client, permMgr, parsed.previousID, 'write');
        if (sibling.denied) return sibling.denied;
    }
    const movedResults = [];
    const apiCallOrder = [...sourceIds].reverse();
    for (const id of apiCallOrder) {
        movedResults.push(await blockApi.moveBlock(client, id, parsed.previousID, parsed.parentID));
    }
    const result = parsed.ids ? movedResults : movedResults[0];
    const operations = [...sourceDocumentIds].map((id) => ({ type: 'reloadProtyle' as const, id }));
    if (parsed.parentID) {
        const destination = await ensurePermissionForDocumentId(client, permMgr, parsed.parentID, 'write');
        if (destination.denied) return destination.denied;
        operations.push({ type: 'reloadProtyle', id: destination.context.documentId });
    }
    if (parsed.previousID) {
        const sibling = await ensurePermissionForDocumentId(client, permMgr, parsed.previousID, 'write');
        if (sibling.denied) return sibling.denied;
        operations.push({ type: 'reloadProtyle', id: sibling.context.documentId });
    }
    return applyUiRefresh(client, createWriteSuccessResult({
        ...(parsed.ids ? {
            ids: parsed.ids,
            finalOrder: parsed.ids,
            apiCallOrder,
            count: parsed.ids.length,
        } : { id: parsed.id }),
        ...(parsed.previousID ? { previousID: parsed.previousID } : {}),
        ...(parsed.parentID ? { parentID: parsed.parentID } : {}),
    }, result), operations);
};

const handleSetFoldState: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockSetFoldStateSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'write');
    if (denied) return denied;
    if (parsed.folded) {
        await blockApi.foldBlock(client, parsed.id);
    } else {
        await blockApi.unfoldBlock(client, parsed.id);
    }
    return applyUiRefresh(client, createJsonResult({ success: true, id: parsed.id, folded: parsed.folded }), [{ type: 'reloadProtyle', id: context.documentId }]);
};

const handleGetKramdown: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockGetKramdownSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = normalizeKramdownResult(await blockApi.getBlockKramdown(client, parsed.id));
    return createJsonResult(result);
};

const handleBatchKramdown: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockBatchKramdownSchema.parse(rawArgs);
    const mode = parsed.mode ?? 'md';
    await permMgr.reload();

    const resolutions: Array<{
        id: string;
        readable: boolean;
        error?: Record<string, unknown>;
    }> = [];

    for (const id of parsed.ids) {
        try {
            const context = await resolveDocumentContextById(client, id);
            if (!permMgr.canRead(context.notebook)) {
                const currentPermission = permMgr.get(context.notebook);
                resolutions.push({
                    id,
                    readable: false,
                    error: {
                        type: 'permission_denied',
                        message: `Notebook "${context.notebook}" has permission "${currentPermission}", read access is required.`,
                        notebook: context.notebook,
                        currentPermission,
                        requiredPermission: 'read',
                    },
                });
                continue;
            }
            resolutions.push({ id, readable: true });
        } catch (error) {
            resolutions.push({
                id,
                readable: false,
                error: isMissingBlockError(error)
                    ? {
                        type: 'not_found',
                        message: `Block not found: ${id}`,
                    }
                    : {
                        type: 'resolution_error',
                        message: error instanceof Error ? error.message : String(error),
                    },
            });
        }
    }

    const readableIds = Array.from(new Set(
        resolutions.filter((item) => item.readable).map((item) => item.id),
    ));
    let kramdowns: Record<string, string> = {};
    let requestError: Record<string, unknown> | undefined;
    if (readableIds.length > 0) {
        try {
            kramdowns = await blockApi.getBlockKramdowns(client, readableIds, mode);
        } catch (error) {
            requestError = {
                type: 'api_error',
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    const items = resolutions.map((resolution) => {
        if (!resolution.readable) {
            return { id: resolution.id, ok: false, error: resolution.error };
        }
        if (requestError) {
            return { id: resolution.id, ok: false, error: requestError };
        }
        if (!Object.prototype.hasOwnProperty.call(kramdowns, resolution.id)) {
            return {
                id: resolution.id,
                ok: false,
                error: {
                    type: 'not_found',
                    message: `Block not found: ${resolution.id}`,
                },
            };
        }
        return {
            id: resolution.id,
            ok: true,
            kramdown: stripZeroWidthChars(kramdowns[resolution.id]),
        };
    });
    const succeeded = items.filter((item) => item.ok).length;
    const failed = items.length - succeeded;

    return createJsonResult({
        items,
        requested: items.length,
        succeeded,
        failed,
        partial: failed > 0 && succeeded > 0,
    });
};

const handleGetChildren: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockGetChildrenSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = await blockApi.getChildBlocks(client, parsed.id);
    const children = Array.isArray(result) ? result : [];
    const paged = paginate(children, parsed.page ?? 1, parsed.pageSize ?? 50);
    return createPaginatedResult(paged.items, paged, {
        ...(paged.truncated ? {
            hint: 'Use page/pageSize to paginate. For focused reads, use block(action="get_kramdown") or search(action="query_sql") with a parent_id filter.',
        } : {}),
    });
};

const handleTransferReferences: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockTransferReferencesSchema.parse(rawArgs);
    const source = await ensurePermissionForDocumentId(client, permMgr, parsed.fromID, 'write');
    if (source.denied) return source.denied;
    const target = await ensurePermissionForDocumentId(client, permMgr, parsed.toID, 'write');
    if (target.denied) return target.denied;
    await blockApi.transferBlockRef(client, parsed.fromID, parsed.toID, parsed.refIDs);
    return applyUiRefresh(client, createJsonResult({ success: true, fromID: parsed.fromID, toID: parsed.toID }), [
        { type: 'reloadProtyle', id: source.context.documentId },
        { type: 'reloadProtyle', id: target.context.documentId },
    ]);
};

const handleSetAttrs: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockSetAttrsSchema.parse(rawArgs);
    const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'write');
    if (denied) return denied;
    await transactionApi.performTransactions(client, [{
        doOperations: [{
            action: 'setAttrs',
            id: parsed.id,
            data: JSON.stringify(parsed.attrs),
        }],
        undoOperations: [],
    }]);
    return applyUiRefresh(client, createJsonResult({ success: true, id: parsed.id, attrs: parsed.attrs }), [{ type: 'reloadProtyle', id: context.documentId }]);
};

const handleGetAttrs: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockGetAttrsSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = await attributeApi.getBlockAttrs(client, parsed.id);
    return createJsonResult(result);
};

const handleInfo: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockInfoSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = await blockApi.getBlockInfo(client, parsed.id);
    return createJsonResult(result);
};

const handleBreadcrumb: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockBreadcrumbSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = await blockApi.getBlockBreadcrumb(client, parsed.id, parsed.excludeTypes);
    return createJsonResult(result);
};

const handleDom: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockDomSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = await blockApi.getBlockDOM(client, parsed.id);
    return createJsonResult(result);
};

const handleRecentUpdated: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockRecentUpdatedSchema.parse(rawArgs);
    const result = await blockApi.getRecentUpdatedBlocks(client);
    const items = Array.isArray(result) ? result : [];
    const filtered = await filterItemsByPermission(client, items, permMgr);
    const count = typeof parsed.count === 'number' ? parsed.count : undefined;
    const truncatedItems = typeof count === 'number' ? filtered.items.slice(0, count) : filtered.items;
    const aggregated = await aggregateRecentUpdatedDocuments(client, truncatedItems);
    return createJsonResult({
        documents: aggregated.documents,
        documentCount: aggregated.documents.length,
        count: truncatedItems.length,
        containsLowLevelBlocks: aggregated.containsLowLevelBlocks,
        grouping: 'document',
        primaryView: 'documents',
        items: truncatedItems,
        hint: 'documents is the user-facing summary grouped by root document; items remains the raw recent block stream for advanced consumers.',
        ...(filtered.removedCount > 0 ? {
            partial: true,
            filteredOutCount: filtered.removedCount,
            reason: 'permission_filtered',
        } : {}),
    });
};

const handleWordCount: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockWordCountSchema.parse(rawArgs);
    for (const id of parsed.ids) {
        const { denied } = await ensurePermissionForDocumentId(client, permMgr, id, 'read');
        if (denied) return denied;
    }
    const result = await blockApi.getBlocksWordCount(client, parsed.ids);
    return createJsonResult(result);
};

const handleAddToDailyNote: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockAddToDailyNoteSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'write');
    if (denied) return denied;
    const data = await normalizeWriteData(client, parsed.dataType, parsed.data, 'block.add_to_daily_note');
    const result = parsed.position === 'append'
        ? await blockApi.appendDailyNoteBlock(client, parsed.notebook, parsed.dataType, data)
        : await blockApi.prependDailyNoteBlock(client, parsed.notebook, parsed.dataType, data);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        action: 'add_to_daily_note',
        notebook: parsed.notebook,
        dataType: parsed.dataType,
        position: parsed.position,
        transactions: result,
    }), [{ type: 'reloadFiletree' }]);
};

const handleDocsInfo: BlockActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = BlockDocsInfoSchema.parse(rawArgs);
    const ids = parsed.ids ?? [parsed.id!];
    for (const id of ids) {
        const { denied } = await ensurePermissionForDocumentId(client, permMgr, id, 'read');
        if (denied) return denied;
    }
    const result = await blockApi.getDocsInfo(client, ids, parsed.refCount ?? false, parsed.av ?? false);
    return createJsonResult(result);
};

export const BLOCK_ACTION_HANDLERS: Record<BlockAction, BlockActionHandler> = {
    insert: handleInsert,
    prepend: handlePrepend,
    append: handleAppend,
    update: handleUpdate,
    replace: handleReplace,
    delete: handleDelete,
    move: handleMove,
    set_fold_state: handleSetFoldState,
    get_kramdown: handleGetKramdown,
    batch_kramdown: handleBatchKramdown,
    get_children: handleGetChildren,
    transfer_references: handleTransferReferences,
    set_attrs: handleSetAttrs,
    get_attrs: handleGetAttrs,
    info: handleInfo,
    breadcrumb: handleBreadcrumb,
    dom: handleDom,
    recent_updated: handleRecentUpdated,
    word_count: handleWordCount,
    add_to_daily_note: handleAddToDailyNote,
    docs_info: handleDocsInfo,
};
