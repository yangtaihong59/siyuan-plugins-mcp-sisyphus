import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import * as blockApi from '../../api/block';
import * as searchApi from '../../api/search';
import * as transactionApi from '../../api/transaction';
import type { TransactionOperation } from '../../api/transaction';
import type { AvAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import {
    AvAddColumnSchema,
    AvAddRowsSchema,
    AvDuplicateSchema,
    AvGetAttributeViewFilterSortSchema,
    AvGetAttributeViewKeysSchema,
    AvGetPrimaryKeyValuesSchema,
    AvGetSchema,
    AvRenderSchema,
    AvRemoveColumnSchema,
    AvRemoveRowsSchema,
    AvSearchSchema,
    AvSetCellsSchema,
} from '../../core/types';
import { createResultResolutionCache, ensurePermissionForDocumentId, escapeSqlString, resolveDocumentContextById, resolveResultItemContext } from '../internal/context';
import type { ToolActionHandler, ToolHandlerContext } from '../internal/define-tool';
import { isMissingBlockError, translateError } from '../internal/errorTranslation';
import { createJsonResult, createPaginatedResult, createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { applyUiRefresh, type UiRefreshOperation } from '../internal/ui-refresh';
import { sleep } from '../../shared/async';

const AV_TOOL_NAME = 'av';

function generateSiYuanNodeId(now = new Date()): string {
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    const timestamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('');
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let index = 0; index < 7; index += 1) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${timestamp}-${suffix}`;
}

type AvContextResolution = {
    avData: unknown;
    blockID?: string;
};

type AvRowBinding = {
    rowID?: string;
    sourceBlockID?: string;
    valueIDs: string[];
};

type AvRowLookup = {
    rows: AvRowBinding[];
    rowIDs: Set<string>;
    sourceBlockToRowIDs: Map<string, string[]>;
    valueIdToRowIDs: Map<string, string[]>;
};

type AddRowsResolution = {
    rows: Array<{ blockID?: string; primaryKeyText?: string; rowID?: string; rowIDs?: string[]; status?: 'resolved' | 'missing' | 'ambiguous' }>;
    unresolvedBlockIDs: string[];
    unresolvedRowIDs?: string[];
};

type StrongCellValueInput = {
    valueType: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multi_select' | 'relation' | 'url' | 'email' | 'phone' | 'mAsset';
    text?: string;
    number?: number;
    numberFormat?: string;
    date?: string | number;
    endDate?: string | number;
    includeTime?: boolean;
    checked?: boolean;
    option?: string;
    options?: string[];
    relationBlockIDs?: string[];
    url?: string;
    email?: string;
    phone?: string;
    assets?: Array<{ type: 'image' | 'file'; content: string; name?: string }>;
};

interface AvTableView {
    columns: Array<{ id: string; name?: string; type?: string }>;
    rows: Array<{ id?: string; cells: Record<string, unknown> }>;
    rowCount: number;
}

const ADD_ROWS_POLL_ATTEMPTS = 6;
const ADD_ROWS_POLL_DELAY_MS = 500;
const AV_MATERIALIZATION_POLL_ATTEMPTS = 6;
const AV_MATERIALIZATION_POLL_DELAY_MS = 300;
const ATTRIBUTE_VIEW_DIR = '/data/storage/av';
const ATTRIBUTE_VIEW_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

function extractFirstRowBlockId(avData: unknown): string | undefined {
    if (!avData || typeof avData !== 'object') return undefined;
    const keyValues = (avData as { keyValues?: unknown }).keyValues;
    if (!Array.isArray(keyValues)) return undefined;

    for (const entry of keyValues) {
        if (!entry || typeof entry !== 'object') continue;
        const typedEntry = entry as {
            key?: { type?: string };
            values?: Array<{ block?: { id?: string } }>;
        };
        if (typedEntry.key?.type !== 'block' || !Array.isArray(typedEntry.values)) continue;
        const blockValue = typedEntry.values.find((value) => typeof value?.block?.id === 'string' && value.block.id.length > 0);
        if (blockValue?.block?.id) return blockValue.block.id;
    }
    return undefined;
}

function extractAttributeViewKeysFromData(avData: unknown): unknown[] {
    if (!avData || typeof avData !== 'object') return [];
    const keyValues = (avData as { keyValues?: unknown }).keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues
        .map((entry) => (entry && typeof entry === 'object' ? (entry as { key?: unknown }).key : undefined))
        .filter((key): key is Record<string, unknown> => Boolean(key && typeof key === 'object'));
}

function getStringField(value: unknown, fieldNames: string[]): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const fieldName of fieldNames) {
        const fieldValue = record[fieldName];
        if (typeof fieldValue === 'string' && fieldValue.length > 0) {
            return fieldValue;
        }
    }
    return undefined;
}

function getNestedStringField(value: unknown, path: string[]): string | undefined {
    let current = value;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === 'string' && current.length > 0 ? current : undefined;
}

function extractRowIdFromValue(value: unknown): string | undefined {
    return getStringField(value, ['blockID', 'itemId', 'itemID', 'rowID'])
        ?? getNestedStringField(value, ['block', 'blockID']);
}

function extractSourceBlockIdFromBlockValue(value: unknown): string | undefined {
    return getNestedStringField(value, ['block', 'id'])
        ?? getStringField(value, ['srcID', 'srcId']);
}

function extractValueIdFromValue(value: unknown): string | undefined {
    return getStringField(value, ['id']);
}

function extractAvRowLookup(avData: unknown): AvRowLookup {
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
            if (sourceBlockID) row.sourceBlockID = sourceBlockID;
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

function createAvRowIdErrorResult(
    action: 'set_cells',
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

function createAddRowsSyncTimeoutResult(
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

async function waitForAddedRows(
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

function validateRowIdForAv(
    avID: string,
    action: 'set_cells',
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

async function resolveAvContext(
    _client: SiYuanClient,
    avData: unknown,
): Promise<AvContextResolution> {
    // Attribute-view payloads carry id=avID, which is not a document/block ID.
    // Avoid feeding the AV object to the generic result resolver; otherwise it
    // falls back to /api/block/getDocInfo(avID), causing noisy SiYuan
    // "load tree by root id [...] failed" logs. Owning database blocks are
    // resolved from row bindings, mirror refs, or blocks-table SQL candidates.
    const blockID = extractFirstRowBlockId(avData);
    return { avData, blockID };
}

function extractMirrorDatabaseBlockIds(mirrors: { refDefs?: Array<{ refID?: string; defIDs?: string[] }> }): string[] {
    const blockIDs: string[] = [];
    for (const entry of mirrors.refDefs ?? []) {
        const refID = typeof entry?.refID === 'string' && entry.refID.length > 0 ? entry.refID : undefined;
        if (refID && !blockIDs.includes(refID)) {
            blockIDs.push(refID);
        }
    }
    return blockIDs;
}

async function getAvMirrorDatabaseBlockIds(client: SiYuanClient, avID: string): Promise<string[]> {
    try {
        return extractMirrorDatabaseBlockIds(await avApi.getMirrorDatabaseBlocks(client, avID));
    } catch (error) {
        if (isMissingBlockError(error)) {
            return [];
        }
        throw error;
    }
}

async function findAvDatabaseBlockIdsBySql(client: SiYuanClient, avID: string): Promise<string[]> {
    const escapedAvID = escapeSqlString(avID);
    const rows = await searchApi.querySQL(
        client,
        `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${escapedAvID}%' OR ial LIKE '%${escapedAvID}%' OR content LIKE '%${escapedAvID}%') ORDER BY updated DESC LIMIT 20`,
    );
    const blockIDs: string[] = [];
    for (const row of rows) {
        const id = row && typeof row === 'object' ? (row as Record<string, unknown>).id : undefined;
        if (typeof id === 'string' && id.length > 0 && !blockIDs.includes(id)) {
            blockIDs.push(id);
        }
    }
    return blockIDs;
}

async function collectAvDatabaseBlockCandidates(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
): Promise<string[]> {
    const candidateBlockIDs: string[] = [];
    const resolved = await resolveAvContext(client, avData);
    if (resolved.blockID) {
        candidateBlockIDs.push(resolved.blockID);
    }

    const mirrors = await getAvMirrorDatabaseBlockIds(client, avID);
    for (const blockID of mirrors) {
        if (!candidateBlockIDs.includes(blockID)) {
            candidateBlockIDs.push(blockID);
        }
    }

    const sqlMatches = await findAvDatabaseBlockIdsBySql(client, avID);
    for (const blockID of sqlMatches) {
        if (!candidateBlockIDs.includes(blockID)) {
            candidateBlockIDs.push(blockID);
        }
    }

    return candidateBlockIDs;
}

async function isExplicitAvDatabaseBlock(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    blockID: string,
): Promise<boolean> {
    const candidateBlockIDs = await collectAvDatabaseBlockCandidates(client, avID, avData);

    if (candidateBlockIDs.includes(blockID)) {
        return true;
    }

    try {
        const response = await blockApi.getBlockDOM(client, blockID);
        const dom = typeof response?.dom === 'string' ? response.dom : '';
        return dom.includes('data-type="NodeAttributeView"') && dom.includes(`data-av-id="${avID}"`);
    } catch (error) {
        if (isMissingBlockError(error)) {
            return false;
        }
        throw error;
    }
}

function createAvBlockContextErrorResult(
    action: AvAction,
    avID: string,
    blockID: string,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: AV_TOOL_NAME,
                    action,
                    message: `blockID "${blockID}" is not a database block for attribute view "${avID}".`,
                    fields: [{
                        path: 'blockID',
                        message: `blockID "${blockID}" does not belong to attribute view "${avID}".`,
                    }],
                    hint: 'Pass the materialized database block for this AV, or omit blockID and let MCP resolve a registered mirror block automatically.',
                },
            }, null, 2),
        }],
        isError: true,
    };
}

async function ensurePermissionForAvId(
    client: SiYuanClient,
    permMgr: PermissionManager,
    avID: string,
    required: 'read' | 'write',
    options?: {
        blockID?: string;
        action?: AvAction;
    },
): Promise<{ denied: ToolResult | null; avData: unknown }> {
    const response = await avApi.getAttributeView(client, avID);
    const avData = response.av;

    if (options?.blockID) {
        const { denied } = await ensurePermissionForDocumentId(client, permMgr, options.blockID, required);
        if (denied) return { denied, avData };
        const matchesAv = await isExplicitAvDatabaseBlock(client, avID, avData, options.blockID);
        if (!matchesAv) {
            return {
                denied: createAvBlockContextErrorResult(options.action ?? 'get', avID, options.blockID),
                avData,
            };
        }
        return { denied: null, avData };
    }
    const candidateBlockIDs = await collectAvDatabaseBlockCandidates(client, avID, avData);

    for (const candidateBlockID of candidateBlockIDs) {
        try {
            const { denied } = await ensurePermissionForDocumentId(client, permMgr, candidateBlockID, required);
            return { denied, avData };
        } catch (error) {
            if (isMissingBlockError(error)) continue;
            throw error;
        }
    }

    if (candidateBlockIDs.length === 0) {
        throw new Error(`Unable to resolve notebook permission scope for attribute view "${avID}". The database may have no rows yet; AV writes require a resolvable owning block context.`);
    }
    throw new Error(`Unable to resolve notebook permission scope for attribute view "${avID}" because all known owning block references are stale or missing.`);
}

function isUnresolvedAvPermissionScopeError(error: unknown): boolean {
    return error instanceof Error &&
        error.message.includes('The database may have no rows yet; AV writes require a resolvable owning block context.');
}

function isMissingAttributeViewError(error: unknown): boolean {
    return error instanceof Error && translateError(error)?.code === 'av_not_found';
}

async function ensurePermissionForRender(
    client: SiYuanClient,
    permMgr: PermissionManager,
    parsed: {
        id?: string;
        blockID?: string;
        createIfNotExist?: boolean;
    },
    effectiveAvID: string,
    idWasGenerated: boolean,
): Promise<{
    denied: ToolResult | null;
    shouldMaterialize: boolean;
    targetDocumentId?: string;
}> {
    if (parsed.createIfNotExist === true) {
        if (!parsed.blockID) {
            throw new Error(`Unable to create or render attribute view "${effectiveAvID}" because createIfNotExist=true requires blockID to resolve notebook permission scope.`);
        }

        if (idWasGenerated) {
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.blockID, 'write');
            return { denied, shouldMaterialize: true, targetDocumentId: context.documentId };
        }

        try {
            const { denied } = await ensurePermissionForAvId(client, permMgr, effectiveAvID, 'read');
            return { denied, shouldMaterialize: false };
        } catch (error) {
            const canFallBackToBlockContext = isUnresolvedAvPermissionScopeError(error) || isMissingAttributeViewError(error);
            if (!canFallBackToBlockContext) {
                throw error;
            }
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.blockID, 'write');
            return { denied, shouldMaterialize: true, targetDocumentId: context.documentId };
        }
    }

    if (!parsed.id) {
        throw new Error('av(action="render") requires id unless createIfNotExist=true is provided.');
    }

    try {
        const { denied } = await ensurePermissionForAvId(client, permMgr, effectiveAvID, 'read');
        return { denied, shouldMaterialize: false };
    } catch (error) {
        throw error;
    }
}

async function resolveAvOwningBlockId(
    client: SiYuanClient,
    avID: string,
    avData?: unknown,
): Promise<string | undefined> {
    const effectiveAvData = avData ?? (await avApi.getAttributeView(client, avID)).av;
    const candidateBlockIDs = await collectAvDatabaseBlockCandidates(client, avID, effectiveAvData);

    return candidateBlockIDs[0];
}

async function resolveAvWriteRefreshOperations(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID?: string,
): Promise<UiRefreshOperation[]> {
    const candidateBlockIDs: string[] = [];
    if (explicitBlockID) {
        candidateBlockIDs.push(explicitBlockID);
    }

    try {
        const owningBlockID = await resolveAvOwningBlockId(client, avID, avData);
        if (owningBlockID && !candidateBlockIDs.includes(owningBlockID)) {
            candidateBlockIDs.push(owningBlockID);
        }
    } catch {
        // Keep refresh best-effort even if owning-block discovery fails.
    }

    for (const candidateBlockID of candidateBlockIDs) {
        try {
            const context = await resolveDocumentContextById(client, candidateBlockID);
            if (context.documentId) {
                return [{ type: 'reloadProtyle', id: context.documentId }];
            }
        } catch {
            // Best-effort only: fall back to AV-scoped refresh if the owning document
            // cannot be resolved after a successful write.
        }
    }

    return [{ type: 'reloadAttributeView', id: avID }];
}

async function filterAvSearchResultsByPermission(
    client: SiYuanClient,
    permMgr: PermissionManager,
    results: unknown[],
): Promise<{
    results: unknown[];
    unresolvedResults: unknown[];
    filteredOutCount: number;
    rawResultCount: number;
    unresolvedCount: number;
    permissionFilteredOutCount: number;
    partial?: boolean;
    reason?: string;
}> {
    const cache = createResultResolutionCache();
    await permMgr.reload();

    const filtered: unknown[] = [];
    const unresolvedResults: unknown[] = [];
    let filteredOutCount = 0;
    let unresolvedCount = 0;
    let permissionFilteredOutCount = 0;

    for (const result of results) {
        const context = await resolveResultItemContext(client, result, cache);
        if (!context?.notebook) {
            filteredOutCount += 1;
            unresolvedCount += 1;
            unresolvedResults.push(result);
            continue;
        }
        if (!permMgr.canRead(context.notebook)) {
            filteredOutCount += 1;
            permissionFilteredOutCount += 1;
            continue;
        }
        filtered.push(result);
    }

    return {
        results: filtered,
        unresolvedResults,
        rawResultCount: results.length,
        filteredOutCount,
        unresolvedCount,
        permissionFilteredOutCount,
        ...(filteredOutCount > 0 ? { partial: true, reason: permissionFilteredOutCount > 0 ? 'permission_filtered' : 'context_unresolved' } : {}),
    };
}

async function listAllAttributeViewIDs(client: SiYuanClient): Promise<string[]> {
    const entries = await client.requestRead<Array<{ isDir?: boolean; name?: string }>>('/api/file/readDir', { path: ATTRIBUTE_VIEW_DIR });
    return (Array.isArray(entries) ? entries : [])
        .filter((entry) => !entry?.isDir && typeof entry?.name === 'string' && entry.name.endsWith('.json'))
        .map((entry) => entry.name!.slice(0, -5))
        .filter((name) => ATTRIBUTE_VIEW_ID_PATTERN.test(name));
}

function extractPrimaryKeyMatchedValues(rows: unknown): Array<Record<string, unknown>> {
    if (!rows || typeof rows !== 'object') return [];
    const values = (rows as { values?: unknown }).values;
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'));
}

async function searchAttributeViewPrimaryKeys(
    client: SiYuanClient,
    keyword: string,
    excludes?: string[],
): Promise<unknown[]> {
    if (!keyword.trim()) return [];
    if (typeof client.request !== 'function') return [];
    const excludeSet = new Set(excludes ?? []);
    const avIDs = await listAllAttributeViewIDs(client);
    const results: unknown[] = [];

    for (const avID of avIDs) {
        if (excludeSet.has(avID)) continue;
        try {
            const response = await avApi.getAttributeViewPrimaryKeyValues(client, {
                id: avID,
                keyword,
                page: 1,
                pageSize: 3,
            });
            const matchedRows = extractPrimaryKeyMatchedValues(response.rows);
            if (matchedRows.length === 0) continue;
            const blockIDs = Array.isArray(response.blockIDs) ? response.blockIDs.filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
            if (blockIDs.length === 0) continue;
            results.push({
                avID,
                avName: response.name,
                blockID: blockIDs[0],
                blockIDs,
                rows: response.rows,
                matchedRowCount: matchedRows.length,
                matchSource: 'primary_key',
            });
        } catch {
            // Ignore unreadable or incompatible AVs during fallback search.
        }
    }

    return results;
}

function parseDateMillis(value: string | number, fieldName: string): number {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a finite epoch millisecond value.`);
        return value;
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        throw new Error(`${fieldName} must be a valid ISO date string or epoch milliseconds.`);
    }
    return parsed;
}

function buildDuplicateAvBlockDom(blockID: string, avID: string): string {
    return `<div class="av" data-node-id="${blockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="table"></div>`;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

function normalizeAvValue(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    for (const key of ['content', 'text', 'number', 'isChecked', 'date', 'mSelect', 'select', 'block']) {
        if (key in record) return record[key];
    }
    return value;
}

function extractAvTableColumns(responseObj: Record<string, unknown>): AvTableView['columns'] {
    const candidates = [responseObj.columns, responseObj.keys, responseObj.keyValues, responseObj.attributeViewKeys];
    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        const columns = candidate.flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
            const record = item as Record<string, unknown>;
            const keyRecord = record.key && typeof record.key === 'object' && !Array.isArray(record.key)
                ? record.key as Record<string, unknown>
                : record;
            const id = pickString(keyRecord, ['id', 'keyID', 'columnID']);
            if (!id) return [];
            const name = pickString(keyRecord, ['name', 'title']);
            const type = pickString(keyRecord, ['type']);
            return [{ id, ...(name ? { name } : {}), ...(type ? { type } : {}) }];
        });
        if (columns.length > 0) return columns;
    }
    return [];
}

function extractAvTableRows(rows: unknown[]): AvTableView['rows'] {
    return rows.flatMap((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
        const record = row as Record<string, unknown>;
        const values = Array.isArray(record.values)
            ? record.values
            : Array.isArray(record.cells)
                ? record.cells
                : [];
        const cells: Record<string, unknown> = {};
        for (const value of values) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const cell = value as Record<string, unknown>;
            const keyObj = cell.key && typeof cell.key === 'object' && !Array.isArray(cell.key)
                ? cell.key as Record<string, unknown>
                : {};
            const columnID = pickString(cell, ['keyID', 'columnID', 'id']) ?? pickString(keyObj, ['id', 'keyID']);
            if (!columnID) continue;
            cells[columnID] = normalizeAvValue(cell);
        }
        if (Object.keys(cells).length === 0) return [];
        const id = pickString(record, ['id', 'rowID', 'blockID']);
        return [{ ...(id ? { id } : {}), cells }];
    });
}

function buildAvTableView(responseObj: Record<string, unknown>, rows: unknown[], total: number): AvTableView | undefined {
    const columns = extractAvTableColumns(responseObj);
    const tableRows = extractAvTableRows(rows);
    if (columns.length === 0 && tableRows.length === 0) return undefined;
    return { columns, rows: tableRows, rowCount: total };
}

function formatSiYuanUpdatedStamp(date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
}

async function resolveAvTransactionBlockId(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID?: string,
): Promise<string | undefined> {
    return explicitBlockID ?? await resolveAvOwningBlockId(client, avID, avData);
}

function withUpdatedOperation(
    operations: TransactionOperation[],
    blockID?: string,
    previousUpdated?: unknown,
): {
    doOperations: TransactionOperation[];
    undoOperations: TransactionOperation[];
} {
    if (!blockID) {
        return { doOperations: operations, undoOperations: [] };
    }

    const updated = formatSiYuanUpdatedStamp();
    return {
        doOperations: [
            ...operations,
            {
                action: 'doUpdateUpdated',
                id: blockID,
                data: updated,
            },
        ],
        undoOperations: [{
            action: 'doUpdateUpdated',
            id: blockID,
            data: typeof previousUpdated === 'string' ? previousUpdated : '',
        }],
    };
}

function buildStrongCellValue(
    columnID: string,
    rowID: string,
    input: StrongCellValueInput,
): Record<string, unknown> {
    const base: Record<string, unknown> = {
        keyID: columnID,
        blockID: rowID,
    };

    switch (input.valueType) {
        case 'text':
            return { ...base, type: 'text', text: { content: input.text } };
        case 'number':
            return {
                ...base,
                type: 'number',
                number: {
                    content: input.number,
                    isNotEmpty: true,
                    format: input.numberFormat ?? '',
                    formattedContent: '',
                },
            };
        case 'date': {
            const content = parseDateMillis(input.date!, 'date');
            const content2 = input.endDate === undefined ? 0 : parseDateMillis(input.endDate, 'endDate');
            return {
                ...base,
                type: 'date',
                date: {
                    content,
                    isNotEmpty: true,
                    hasEndDate: input.endDate !== undefined,
                    isNotTime: input.includeTime === false,
                    content2,
                    isNotEmpty2: input.endDate !== undefined,
                    formattedContent: '',
                },
            };
        }
        case 'checkbox':
            return { ...base, type: 'checkbox', checkbox: { checked: Boolean(input.checked) } };
        case 'select':
            return { ...base, type: 'select', mSelect: [{ content: input.option, color: '' }] };
        case 'multi_select':
            return { ...base, type: 'mSelect', mSelect: (input.options ?? []).map((option) => ({ content: option, color: '' })) };
        case 'relation':
            return { ...base, type: 'relation', relation: { blockIDs: input.relationBlockIDs ?? [], contents: [] } };
        case 'url':
            return { ...base, type: 'url', url: { content: input.url } };
        case 'email':
            return { ...base, type: 'email', email: { content: input.email } };
        case 'phone':
            return { ...base, type: 'phone', phone: { content: input.phone } };
        case 'mAsset': {
            const assets = (input.assets ?? []).map((asset) => ({
                type: asset.type,
                name: asset.name ?? '',
                content: asset.content,
            }));
            const markdown = input.text
                ?? assets.map((asset) => asset.type === 'image'
                    ? `![](${asset.content})`
                    : `[${asset.name || asset.content}](${asset.content})`).join('\n');
            return {
                ...base,
                type: 'mAsset',
                text: { content: markdown },
                mAsset: assets,
            };
        }
        default:
            throw new Error(`Unsupported AV valueType: ${(input as { valueType: string }).valueType}`);
    }
}

async function handleGet({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.id, 'read', { blockID: parsed.blockID, action: 'get' });
    if (denied) return denied;
    const rowLookup = extractAvRowLookup(avData);
    return createJsonResult({
        id: parsed.id,
        av: avData,
        ...(rowLookup.rows.length > 0 ? {
            resolvedRows: rowLookup.rows.map((row) => ({
                rowID: row.rowID,
                ...(row.sourceBlockID ? { sourceBlockID: row.sourceBlockID } : {}),
                ...(row.valueIDs.length > 0 ? { valueIDs: row.valueIDs } : {}),
            })),
        } : {}),
    });
}

async function handleSearch({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSearchSchema.parse(rawArgs);
    const response = await avApi.searchAttributeView(client, parsed.keyword, parsed.excludes);
    const kernelResults = Array.isArray(response.results) ? response.results : [];
    const primaryKeyResults = await searchAttributeViewPrimaryKeys(client, parsed.keyword, parsed.excludes);
    const dedupedResults: unknown[] = [...kernelResults];
    const seenAvIDs = new Set(
        dedupedResults
            .map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).avID : undefined)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
    );
    for (const result of primaryKeyResults) {
        const avID = (result as Record<string, unknown>).avID;
        if (typeof avID === 'string' && seenAvIDs.has(avID)) continue;
        if (typeof avID === 'string') seenAvIDs.add(avID);
        dedupedResults.push(result);
    }
    const filtered = await filterAvSearchResultsByPermission(client, permMgr, dedupedResults);
    const normalizedResults = filtered.results.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const record = item as Record<string, unknown>;
        const avID = typeof record.avID === 'string' && record.avID.length > 0
            ? record.avID
            : typeof record.id === 'string' && record.id.length > 0
                ? record.id
                : undefined;
        if (!avID) return record;
        return {
            ...record,
            id: avID,
            avID,
            renderArgs: { action: 'render', id: avID },
        };
    });
    return createJsonResult({
        keyword: parsed.keyword,
        searchScope: {
            kernel: 'attribute_view_name_or_kernel_candidates',
            fallback: 'primary_key_values',
        },
        ...filtered,
        results: normalizedResults,
        ...(filtered.filteredOutCount > 0 ? {
            emptyReason: normalizedResults.length === 0
                ? (filtered.unresolvedCount > 0 && filtered.permissionFilteredOutCount === 0 ? 'no_verified_results_unresolved_candidates_available'
                    : filtered.permissionFilteredOutCount > 0 && filtered.unresolvedCount === 0 ? 'all_results_permission_filtered'
                        : 'all_results_filtered')
                : undefined,
            unresolvedHint: filtered.unresolvedResults.length > 0
                ? 'unresolvedResults contains kernel search candidates that matched, but MCP could not verify notebook context yet.'
                : undefined,
        } : {}),
        ...(parsed.keyword.trim().length > 0 && filtered.results.length === 0 ? {
            warning: 'No verified AV matches were found. AV search primarily covers database names and primary-key values; non-primary-key cell text may not be searchable immediately after writes.',
        } : {}),
    });
}

async function handleRender({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvRenderSchema.parse(rawArgs);
    const creationTime = new Date();
    const idWasGenerated = !parsed.id;
    const effectiveAvID = parsed.id ?? generateSiYuanNodeId(creationTime);
    const permission = await ensurePermissionForRender(client, permMgr, parsed, effectiveAvID, idWasGenerated);
    if (permission.denied) return permission.denied;

    const response = await avApi.renderAttributeView(client, {
        id: effectiveAvID,
        blockID: parsed.blockID,
        viewID: parsed.viewID,
        page: parsed.page,
        pageSize: parsed.pageSize,
        query: parsed.query,
        groupPaging: parsed.groupPaging,
        createIfNotExist: parsed.createIfNotExist,
    });

    let materializedBlockID: string | undefined;
    let materializedBlockRegistered: boolean | undefined;
    if (permission.shouldMaterialize) {
        materializedBlockID = generateSiYuanNodeId(creationTime);
        let data = buildDuplicateAvBlockDom(materializedBlockID, effectiveAvID);
        try {
            const spun = await avApi.spinBlockDOM(client, data);
            if (typeof spun.dom === 'string' && spun.dom.length > 0) {
                data = spun.dom;
            }
        } catch {
            // Keep materialization compatible with kernels that do not expose
            // /api/lute/spinBlockDOM; transaction insert can still parse the
            // minimal AV block DOM.
        }
        await transactionApi.performTransactions(client, [{
            doOperations: [{
                action: 'insert',
                id: materializedBlockID,
                data,
                parentID: parsed.blockID!,
            }],
            undoOperations: [{
                action: 'delete',
                id: materializedBlockID,
            }],
        }]);
        materializedBlockRegistered = false;
        for (let attempt = 0; attempt < AV_MATERIALIZATION_POLL_ATTEMPTS; attempt += 1) {
            const mirrorBlockIDs = await getAvMirrorDatabaseBlockIds(client, effectiveAvID);
            if (mirrorBlockIDs.includes(materializedBlockID)) {
                materializedBlockRegistered = true;
                break;
            }
            if (attempt === AV_MATERIALIZATION_POLL_ATTEMPTS - 1) {
                break;
            }
            await sleep(AV_MATERIALIZATION_POLL_DELAY_MS);
        }
    }

    const responseObj = (response && typeof response === 'object' && !Array.isArray(response))
        ? response as Record<string, unknown>
        : {};
    const rows = Array.isArray(responseObj.rows) ? responseObj.rows as unknown[] : [];
    const page = parsed.page ?? 1;
    const pageSize = parsed.pageSize ?? (rows.length || 1);
    const kernelPageCount = typeof responseObj.pageCount === 'number'
        ? responseObj.pageCount as number
        : 1;
    const total = typeof responseObj.rowCount === 'number'
        ? responseObj.rowCount as number
        : rows.length;
    const table = buildAvTableView(responseObj, rows, total);
    const { rows: _ignoredRows, pageCount: _ignoredPageCount, rowCount: _ignoredRowCount, ...restResponse } = responseObj;
    void _ignoredRows;
    void _ignoredPageCount;
    void _ignoredRowCount;
    const result = createPaginatedResult(rows, {
        total,
        page,
        pageSize,
        pageCount: kernelPageCount,
        hasNextPage: page < kernelPageCount,
    }, {
        ...restResponse,
        avID: effectiveAvID,
        id: effectiveAvID,
        ...(table ? { table } : {}),
        ...(parsed.createIfNotExist === true ? { generatedAvID: idWasGenerated } : {}),
        ...(permission.shouldMaterialize ? {
            materialized: true,
            blockID: materializedBlockID,
            parentID: parsed.blockID,
            databaseBlockRegistrationVerified: materializedBlockRegistered === true,
            ...(materializedBlockRegistered === false ? {
                warning: `Created attribute view "${effectiveAvID}" and materialized database block "${materializedBlockID}", but MCP could not verify mirror registration before the timeout. If the next AV write cannot resolve by avID yet, retry shortly or pass this blockID as explicit database-block context.`,
            } : {}),
        } : {}),
    });
    return permission.shouldMaterialize
        ? applyUiRefresh(client, result, [
            { type: 'reloadAttributeView', id: effectiveAvID },
            ...(permission.targetDocumentId ? [{ type: 'reloadProtyle' as const, id: permission.targetDocumentId }] : []),
        ])
        : result;
}

async function handleGetAttributeViewKeys({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetAttributeViewKeysSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;

    const raw = await avApi.getAttributeViewKeys(client, parsed.id);
    const keysArray =
        raw && typeof raw === 'object' && !Array.isArray(raw) &&
        Array.isArray((raw as Record<string, unknown>).keys)
            ? (raw as Record<string, unknown>).keys
            : Array.isArray(raw) && raw.length > 0
                ? raw
                : extractAttributeViewKeysFromData(avData);
    return createJsonResult({
        avID: parsed.id,
        keys: keysArray,
    });
}

async function handleGetAttributeViewFilterSort({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetAttributeViewFilterSortSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForAvId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;

    const response = await avApi.getAttributeViewFilterSort(client, {
        id: parsed.id,
        blockID: parsed.blockID ?? '',
    });

    return createJsonResult({
        avID: parsed.id,
        ...(parsed.blockID ? { blockID: parsed.blockID } : {}),
        ...response,
    });
}

async function handleAddRows({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvAddRowsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'add_rows' });
    if (denied) return denied;

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

    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'add_rows',
        avID: parsed.avID,
        ...(blockIDs.length > 0 ? { blockIDs } : {}),
        ...(primaryKeyTexts.length > 0 ? { primaryKeyTexts } : {}),
        rows: resolution.rows,
        added: blockIDs.length + primaryKeyTexts.length,
    }), refreshOperations);
}

async function handleRemoveRows({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvRemoveRowsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'remove_rows' });
    if (denied) return denied;

    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'removeAttrViewBlock',
        srcIDs: parsed.srcIDs,
        avID: parsed.avID,
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: updatedOps.undoOperations,
    }]);
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'remove_rows',
        avID: parsed.avID,
        srcIDs: parsed.srcIDs,
        removed: parsed.srcIDs.length,
    }), refreshOperations);
}

async function handleAddColumn({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvAddColumnSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'add_column' });
    if (denied) return denied;

    const keyID = parsed.keyID ?? generateSiYuanNodeId();
    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'addAttrViewCol',
        name: parsed.keyName,
        avID: parsed.avID,
        type: parsed.keyType,
        id: keyID,
        data: parsed.keyIcon ?? '',
        previousID: parsed.previousKeyID ?? '',
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: [
            {
                action: 'removeAttrViewCol',
                id: keyID,
                avID: parsed.avID,
            },
            ...updatedOps.undoOperations,
        ],
    }]);
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'add_column',
        avID: parsed.avID,
        keyID,
        keyName: parsed.keyName,
        keyType: parsed.keyType,
    }), refreshOperations);
}

async function handleRemoveColumn({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvRemoveColumnSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'remove_column' });
    if (denied) return denied;
    const keyID = parsed.keyID ?? parsed.columnID!;

    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'removeAttrViewCol',
        id: keyID,
        avID: parsed.avID,
        removeDest: parsed.removeRelationDest ?? false,
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: updatedOps.undoOperations,
    }]);
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'remove_column',
        avID: parsed.avID,
        keyID,
        removeRelationDest: parsed.removeRelationDest ?? false,
    }), refreshOperations);
}

async function handleSetCells({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetCellsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'set_cells' });
    if (denied) return denied;
    const rowLookup = extractAvRowLookup(avData);
    const isSingleCellCall = !parsed.cells && !parsed.items;
    const items = parsed.cells ?? parsed.items ?? [{
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
    }];

    const values: TransactionOperation[] = [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const validatedRowID = validateRowIdForAv(parsed.avID, 'set_cells', rowLookup, item.rowID, isSingleCellCall ? undefined : index);
        if (validatedRowID.ok === false) return validatedRowID.result;
        if (isSingleCellCall) {
            const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
            const updatedOps = withUpdatedOperation([{
                action: 'updateAttrViewCell',
                avID: parsed.avID,
                keyID: item.columnID,
                rowID: validatedRowID.rowID,
                data: buildStrongCellValue(item.columnID, validatedRowID.rowID, item),
            }], transactionBlockID);
            await transactionApi.performTransactions(client, [{
                doOperations: updatedOps.doOperations,
                undoOperations: updatedOps.undoOperations,
            }]);
            const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
            return applyUiRefresh(client, createWriteSuccessResult({
                action: 'set_cells',
                avID: parsed.avID,
                rowID: item.rowID,
                columnID: item.columnID,
                valueType: item.valueType,
            }), refreshOperations);
        }
        values.push({
            action: 'updateAttrViewCell',
            avID: parsed.avID,
            keyID: item.columnID,
            rowID: validatedRowID.rowID,
            data: buildStrongCellValue(item.columnID, validatedRowID.rowID, item),
        });
    }
    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation(values, transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: updatedOps.undoOperations,
    }]);

    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'set_cells',
        avID: parsed.avID,
        updated: items.length,
    }), refreshOperations);
}

async function handleDuplicate({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvDuplicateSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'duplicate' });
    if (denied) return denied;

    const response = await avApi.duplicateAttributeViewBlock(client, parsed.avID);
    if (!response.avID || !response.blockID) {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'internal_error',
                        tool: AV_TOOL_NAME,
                        action: 'duplicate',
                        reason: 'duplicate_identifiers_missing',
                        message: `Duplicate AV returned incomplete identifiers for source "${parsed.avID}".`,
                        sourceAvID: parsed.avID,
                        duplicatedAvID: response.avID,
                        duplicatedBlockID: response.blockID,
                    },
                }, null, 2),
            }],
            isError: true,
        };
    }

    const insertedAfter = parsed.previousID ?? parsed.blockID ?? await resolveAvOwningBlockId(client, parsed.avID, avData);
    if (!insertedAfter) {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'internal_error',
                        tool: AV_TOOL_NAME,
                        action: 'duplicate',
                        reason: 'duplicate_insert_target_unresolved',
                        message: `Duplicated AV identifiers were prepared for source "${parsed.avID}", but MCP could not resolve a database block insertion target.`,
                        sourceAvID: parsed.avID,
                        duplicatedAvID: response.avID,
                        duplicatedBlockID: response.blockID,
                        hint: 'SiYuan kernel duplicateAttributeViewBlock only prepares the duplicated AV definition. Provide previousID or ensure the source AV has a resolvable owning database block in the document tree.',
                    },
                }, null, 2),
            }],
            isError: true,
        };
    }

    const destination = await ensurePermissionForDocumentId(client, permMgr, insertedAfter, 'write');
    if (destination.denied) return destination.denied;

    let data = buildDuplicateAvBlockDom(response.blockID, response.avID);
    try {
        const spun = await avApi.spinBlockDOM(client, data);
        if (typeof spun.dom === 'string' && spun.dom.length > 0) {
            data = spun.dom;
        }
    } catch {
        // Keep parity with SiYuan's frontend when available; fall back to the
        // minimal AV block DOM for older kernels that lack /api/lute/spinBlockDOM.
    }

    try {
        await transactionApi.performTransactions(client, [{
            doOperations: [{
                action: 'insert',
                id: response.blockID,
                data,
                previousID: insertedAfter,
            }],
            undoOperations: [{
                action: 'delete',
                id: response.blockID,
            }],
        }]);
    } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'internal_error',
                        tool: AV_TOOL_NAME,
                        action: 'duplicate',
                        reason: 'duplicate_insert_failed',
                        message: normalized.message,
                        sourceAvID: parsed.avID,
                        duplicatedAvID: response.avID,
                        duplicatedBlockID: response.blockID,
                        insertedAfter,
                        hint: 'The duplicate AV definition was prepared, but MCP failed while inserting the duplicated database block into the document tree.',
                    },
                }, null, 2),
            }],
            isError: true,
        };
    }

    return createWriteSuccessResult({
        action: 'duplicate',
        sourceAvID: parsed.avID,
        prepared: true,
        materialized: true,
        insertedAfter,
        semantics: parsed.previousID ? 'siyuan_duplicate_mirror_with_override' : 'siyuan_duplicate_mirror',
    }, response);
}

async function handleGetPrimaryKeyValues({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetPrimaryKeyValuesSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'read');
    if (denied) return denied;

    const response = await avApi.getAttributeViewPrimaryKeyValues(client, {
        id: parsed.avID,
        keyword: parsed.keyword,
        page: parsed.page,
        pageSize: parsed.pageSize,
    });

    const blockIDs = response.blockIDs ?? [];
    if (blockIDs.length > 0) {
        const cache = createResultResolutionCache();
        await permMgr.reload();
        const filteredBlockIDs: string[] = [];
        const filteredRows: unknown[] = [];
        let filteredOutCount = 0;
        for (let index = 0; index < blockIDs.length; index += 1) {
            const blockID = blockIDs[index];
            const context = await resolveResultItemContext(client, { id: blockID }, cache)
                ?? await resolveDocumentContextById(client, blockID).catch(() => null);
            const notebook = context && 'notebook' in context ? context.notebook : undefined;
            if (!notebook || !permMgr.canRead(notebook)) {
                filteredOutCount += 1;
                continue;
            }
            filteredBlockIDs.push(blockID);
            filteredRows.push(response.rows[index]);
        }

        return createJsonResult({
            avID: parsed.avID,
            name: response.name,
            blockIDs: filteredBlockIDs,
            rows: filteredRows,
            ...(filteredOutCount > 0 ? { filteredOutCount, partial: true, reason: 'permission_filtered' } : {}),
        });
    }

    return createJsonResult({
        avID: parsed.avID,
        ...response,
    });
}

export const AV_ACTION_HANDLERS: Record<AvAction, ToolActionHandler> = {
    get: handleGet,
    render: handleRender,
    get_attribute_view_keys: handleGetAttributeViewKeys,
    get_attribute_view_filter_sort: handleGetAttributeViewFilterSort,
    search: handleSearch,
    add_rows: handleAddRows,
    remove_rows: handleRemoveRows,
    add_column: handleAddColumn,
    remove_column: handleRemoveColumn,
    set_cells: handleSetCells,
    duplicate: handleDuplicate,
    get_primary_key_values: handleGetPrimaryKeyValues,
};
