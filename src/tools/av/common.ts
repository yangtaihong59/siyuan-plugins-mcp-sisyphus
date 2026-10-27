/*
 * Shared AV tool infrastructure: definition/row lookup, carrier and permission
 * resolution, and the transaction/refresh helpers every write handler uses.
 */
import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import * as blockApi from '../../api/block';
import * as searchApi from '../../api/search';
import * as transactionApi from '../../api/transaction';
import type { TransactionOperation } from '../../api/transaction';
import type { AvAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import { ensurePermissionForDocumentId, resolveDocumentContextById } from '../internal/context';
import { escapeSqlString } from '../../shared/sql';
import { isExactAvCarrierDom } from '../../shared/av-carrier-dom';
import { isMissingBlockError } from '../internal/errorTranslation';
import { createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { applyUiRefresh, type UiRefreshOperation } from '../internal/ui-refresh';
import { sleep } from '../../shared/async';

export const AV_TOOL_NAME = 'av';

type AvContextResolution = {
    avData: unknown;
    blockID?: string;
};

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

type DuplicateRowsRelationDestination = {
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

export type StrongCellValueInput = {
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

export interface AvQueryColumn {
    columnID: string;
    name?: string;
    type?: string;
}

export interface AvQueryCell {
    value: unknown;
    formatted?: string;
}

export interface AvQueryRow {
    rowID?: string;
    groupID?: string;
    cells: Record<string, AvQueryCell>;
}

export interface AvViewItems {
    items: unknown[];
    total: number;
    groupIDs: Array<string | undefined>;
    groups: Array<{ groupID: string; name?: string; rowCount?: number }>;
}

const ADD_ROWS_POLL_ATTEMPTS = 6;

const ADD_ROWS_POLL_DELAY_MS = 500;

export const AV_MATERIALIZATION_POLL_ATTEMPTS = 6;

export const AV_MATERIALIZATION_POLL_DELAY_MS = 300;

export const ATTRIBUTE_VIEW_DIR = '/data/storage/av';

export const ATTRIBUTE_VIEW_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

export type AvKeyDefinition = Record<string, unknown>;

type AvKeyEntryDefinition = { key: AvKeyDefinition; values?: unknown };

export type AvKeyValueDefinition = { key: AvKeyDefinition; values: Array<Record<string, unknown>> };

export type AttributeViewDefinition = Record<string, unknown> & { keyValues?: unknown[]; newItemTemplates?: unknown[] };

export type RelationMetadata = Record<string, unknown> & { avID?: string; backKeyID?: string; isTwoWay?: boolean };

/**
 * Persistence-sensitive actions use only raw getAttributeView. Rendering can
 * materialize or normalize an AV, so using it for template/relation/rollup
 * readback would turn an observation into an undocumented side effect.
 */
export function asAttributeViewDefinition(value: unknown, avID: string): AttributeViewDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Attribute view "${avID}" returned no raw definition.`);
    }
    const definition = value as AttributeViewDefinition;
    if (definition.id !== avID || !Array.isArray(definition.keyValues)) {
        throw new Error(`Attribute view "${avID}" returned an incomplete or mismatched raw definition.`);
    }
    return definition;
}

function getAvKeyEntry(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyEntryDefinition {
    const matches = (definition.keyValues ?? []).filter((entry): entry is AvKeyEntryDefinition => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const value = entry as { key?: unknown; values?: unknown };
        return Boolean(value.key && typeof value.key === 'object' && !Array.isArray(value.key)
            && (value.key as Record<string, unknown>).id === keyID);
    });
    if (matches.length !== 1) throw new Error(`${context}: keyID "${keyID}" did not resolve exactly once.`);
    return matches[0];
}

export function getAvKeyValue(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyValueDefinition {
    const entry = getAvKeyEntry(definition, keyID, context);
    // SiYuan encodes a newly added key with no cells as { key: ... }, because
    // KeyValues.Values has omitempty. Key metadata remains valid for template
    // validation, but row/cell readers must still reject the absent value list.
    if (!Array.isArray(entry.values)) throw new Error(`${context}: keyID "${keyID}" has no value list.`);
    return { key: entry.key, values: entry.values as Array<Record<string, unknown>> };
}

export function getAvKey(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyDefinition {
    return getAvKeyEntry(definition, keyID, context).key;
}

export function normalizeIdSet(ids: string[]): string[] {
    return [...new Set(ids)].sort();
}

export function sameIdSet(left: string[], right: string[]): boolean {
    const normalizedLeft = normalizeIdSet(left);
    const normalizedRight = normalizeIdSet(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

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

export function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function createAvValidationErrorResult(action: AvAction, payload: Record<string, unknown>): ToolResult {
    return { content: [{ type: 'text', text: JSON.stringify({ error: { type: 'validation_error', tool: AV_TOOL_NAME, action, ...payload } }, null, 2) }], isError: true };
}

export async function requireWritableRelationDestinations(
    client: SiYuanClient,
    permMgr: PermissionManager,
    definition: AttributeViewDefinition,
    keyID: string,
    relatedItemIDs: string[],
    context: string,
): Promise<{ destinationAvID: string; backKeyID?: string; destination: AttributeViewDefinition }> {
    const key = getAvKey(definition, keyID, context);
    if (key.type !== 'relation' || !key.relation || typeof key.relation !== 'object' || Array.isArray(key.relation)) {
        throw new Error(`${context}: keyID "${keyID}" is not a configured relation key.`);
    }
    const relation = key.relation as Record<string, unknown>;
    const destinationAvID = relation.avID;
    if (typeof destinationAvID !== 'string' || !ATTRIBUTE_VIEW_ID_PATTERN.test(destinationAvID)) {
        throw new Error(`${context}: relation key "${keyID}" has no valid destination AV ID.`);
    }
    const destination = asAttributeViewDefinition((await avApi.getAttributeView(client, destinationAvID)).av, destinationAvID);
    const backKeyID = typeof relation.backKeyID === 'string' && relation.backKeyID ? relation.backKeyID : undefined;
    if (relation.isTwoWay === true) {
        if (!backKeyID) throw new Error(`${context}: two-way relation key "${keyID}" has no backKeyID.`);
        const backKey = getAvKey(destination, backKeyID, context);
        if (backKey.type !== 'relation' || !backKey.relation || typeof backKey.relation !== 'object'
            || (backKey.relation as Record<string, unknown>).avID !== definition.id) {
            throw new Error(`${context}: destination reverse relation metadata does not match the source AV.`);
        }
    }
    // A relation can mutate reverse cells. The destination's first bound row
    // is not proof of a carrier, so permission is established only through a
    // verified NodeAttributeView before this cross-AV write is dispatched.
    const destinationCarrier = await resolveVerifiedAvCarrier(client, destinationAvID, destination);
    if (!destinationCarrier) throw new Error(`${context}: destination AV "${destinationAvID}" has no verified database carrier.`);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, destinationCarrier, 'write');
    if (denied) throw new Error(`${context}: destination AV write permission was denied.`);
    const destinationLookup = extractAvRowLookup(destination);
    for (const itemID of relatedItemIDs) {
        if (!destinationLookup.rowIDs.has(itemID)) throw new Error(`${context}: relatedItemID "${itemID}" is not a canonical destination AV item ID.`);
    }
    return { destinationAvID, backKeyID, destination };
}

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

export function extractAttributeViewKeysFromData(avData: unknown): unknown[] {
    if (!avData || typeof avData !== 'object') return [];
    const keyValues = (avData as { keyValues?: unknown }).keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues
        .map((entry) => (entry && typeof entry === 'object' ? (entry as { key?: unknown }).key : undefined))
        .filter((key): key is Record<string, unknown> => Boolean(key && typeof key === 'object'));
}

export function getStringField(value: unknown, fieldNames: string[]): string | undefined {
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

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

export function extractKeyValueEntries(avData: unknown): Array<{ key: Record<string, unknown>; values: Array<Record<string, unknown>> }> {
    const keyValues = asRecord(avData)?.keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues.flatMap((entry) => {
        const record = asRecord(entry);
        const key = asRecord(record?.key);
        const values = Array.isArray(record?.values)
            ? record.values.flatMap((value) => asRecord(value) ? [value] : [])
            : [];
        return key ? [{ key, values }] : [];
    });
}

function getRowValue(entries: Array<{ key: Record<string, unknown>; values: Array<Record<string, unknown>> }>, keyID: string, rowID: string): Record<string, unknown> | undefined {
    return entries.find((entry) => getStringField(entry.key, ['id']) === keyID)?.values
        .find((value) => getStringField(value, ['blockID']) === rowID);
}

export function relationBlockIDs(value: Record<string, unknown> | undefined): string[] {
    const relation = asRecord(value?.relation);
    return Array.isArray(relation?.blockIDs)
        ? relation.blockIDs.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
}

function collectDuplicateRowsRelationDestinations(
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
    // A bound row's content block is useful for ordinary AV permission
    // discovery, but it is not a carrier. Mirror registrations are not proof
    // either: SiYuan can register a parent document there. Like the strict
    // coordinator, accept only the block's own NodeAttributeView opening tag;
    // otherwise a source document could authorize another AV.
    try {
        const response = await blockApi.getBlockDOM(client, blockID);
        const dom = typeof response?.dom === 'string' ? response.dom : '';
        return isExactAvCarrierDom(dom, blockID, avID);
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

export type AvDefinition = {
    id?: unknown;
    views?: unknown;
};

export type AvViewDefinition = {
    id?: unknown;
    type?: unknown;
    name?: unknown;
    filters?: unknown;
    sorts?: unknown;
    group?: unknown;
    table?: { columns?: unknown };
    gallery?: { fields?: unknown };
    kanban?: { fields?: unknown };
};

function resolveExactCarrierView(
    avID: string,
    definition: unknown,
    attrs: Record<string, string>,
    blockID: string,
    expectedViewID: string,
): AvViewDefinition {
    const actualViewID = attrs['custom-sy-av-view'];
    if (actualViewID !== expectedViewID) {
        throw new Error(`Carrier "${blockID}" no longer selects requested view "${expectedViewID}" for attribute view "${avID}". Refusing kernel fallback.`);
    }
    const views = (definition as AvDefinition | undefined)?.views;
    if (!Array.isArray(views)) throw new Error(`Attribute view "${avID}" has no readable views array.`);
    const matches = views.filter((view): view is AvViewDefinition => (
        Boolean(view) && typeof view === 'object' && (view as AvViewDefinition).id === expectedViewID
    ));
    if (matches.length !== 1) throw new Error(`Requested view "${expectedViewID}" must resolve exactly once in attribute view "${avID}".`);
    return matches[0];
}

export async function verifyExactAvCarrier(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    blockID: string,
    viewID: string,
): Promise<AvViewDefinition> {
    const matchesAv = await isExplicitAvDatabaseBlock(client, avID, avData, blockID);
    if (!matchesAv) throw new Error(`blockID "${blockID}" is not a database block for attribute view "${avID}".`);

    const [attrs, dom] = await Promise.all([
        blockApi.getBlockAttrs(client, blockID),
        blockApi.getBlockDOM(client, blockID),
    ]);
    if (attrs['custom-sy-av-view'] !== viewID) {
        throw new Error(`Carrier "${blockID}" does not select view "${viewID}". Refusing kernel fallback.`);
    }
    if (!dom.dom.includes('data-type="NodeAttributeView"') || !dom.dom.includes(`data-av-id="${avID}"`)) {
        throw new Error(`Carrier "${blockID}" DOM does not prove NodeAttributeView ownership of "${avID}".`);
    }
    return resolveExactCarrierView(avID, avData, attrs, blockID, viewID);
}

export function assertKanbanHasExistingSelectKey(avID: string, avData: unknown): void {
    const keys = extractAttributeViewKeysFromData(avData);
    if (!keys.some((key) => key && typeof key === 'object' && (key as { type?: unknown }).type === 'select')) {
        // Kernel `addAttrViewView` synthesizes a Select key when a Kanban view
        // has no grouping key, and adds it to every existing view. This action
        // owns view structure only, so require the caller to add that schema
        // field through the explicit column action first instead of smuggling a
        // cross-view schema write into an apparently additive view operation.
        throw new Error(`Kanban view creation for attribute view "${avID}" requires an existing select column; add it through av.add_column before creating the view.`);
    }
}

export async function ensurePermissionForAvId(
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

export async function resolveAvOwningBlockId(
    client: SiYuanClient,
    avID: string,
    avData?: unknown,
): Promise<string | undefined> {
    const effectiveAvData = avData ?? (await avApi.getAttributeView(client, avID)).av;
    const candidateBlockIDs = await collectAvDatabaseBlockCandidates(client, avID, effectiveAvData);

    return candidateBlockIDs[0];
}

async function resolveVerifiedAvCarrierBlockId(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
): Promise<string | undefined> {
    // A row's source block is a useful permission fallback for normal AV
    // writes, but it is not proof that it is the database carrier. A copied
    // two-way relation can mutate a different AV, so accepting that fallback
    // here could authorize a cross-notebook write against the wrong document.
    // Require the rendered carrier marker before dispatch and fail closed when
    // SiYuan cannot expose one.
    const candidates = await collectAvDatabaseBlockCandidates(client, avID, avData);
    for (const candidate of candidates) {
        try {
            const response = await blockApi.getBlockDOM(client, candidate);
            const dom = typeof response?.dom === 'string' ? response.dom : '';
            if (isExactAvCarrierDom(dom, candidate, avID)) {
                return candidate;
            }
        } catch (error) {
            if (isMissingBlockError(error)) continue;
            throw error;
        }
    }
    return undefined;
}

export async function resolveVerifiedAvCarrier(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID?: string,
): Promise<string | undefined> {
    if (explicitBlockID) return (await isExplicitAvDatabaseBlock(client, avID, avData, explicitBlockID)) ? explicitBlockID : undefined;
    const candidates = [
        ...await getAvMirrorDatabaseBlockIds(client, avID),
        ...await findAvDatabaseBlockIdsBySql(client, avID),
    ];
    for (const candidate of candidates) {
        if (await isExplicitAvDatabaseBlock(client, avID, avData, candidate)) return candidate;
    }
    return undefined;
}

export async function resolveDuplicateRowsRelationDestinations(
    client: SiYuanClient,
    permMgr: PermissionManager,
    sourceAvID: string,
    avData: unknown,
    sourceRowIDs: string[],
): Promise<{ denied: ToolResult | null; destinations: DuplicateRowsRelationDestination[] }> {
    const discovered = collectDuplicateRowsRelationDestinations(avData, sourceRowIDs);
    const destinations: DuplicateRowsRelationDestination[] = [];
    for (const destination of discovered) {
        // A copied two-way relation writes the reverse key in this AV. Resolve
        // a real database carrier before dispatch so a source-only permission
        // check cannot authorize a cross-notebook mutation by accident.
        const response = await avApi.getAttributeView(client, destination.avID);
        const carrierBlockID = await resolveVerifiedAvCarrierBlockId(client, destination.avID, response.av);
        if (!carrierBlockID) {
            return {
                denied: createDuplicateRowsValidationResult(sourceAvID, destination.avID,
                    `Could not resolve a database carrier for two-way relation destination AV "${destination.avID}".`),
                destinations: [],
            };
        }
        const permission = await ensurePermissionForDocumentId(client, permMgr, carrierBlockID, 'write');
        if (permission.denied) return { denied: permission.denied, destinations: [] };
        destinations.push({ ...destination, carrierBlockID, preimage: response.av });
    }
    return { denied: null, destinations };
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

export function buildDuplicateAvBlockDom(blockID: string, avID: string): string {
    return `<div class="av" data-node-id="${blockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="table"></div>`;
}

export function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
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

export async function resolveAvTransactionBlockId(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID?: string,
): Promise<string | undefined> {
    return explicitBlockID ?? await resolveAvOwningBlockId(client, avID, avData);
}

export function withUpdatedOperation(
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

/**
 * Dispatch AV operations as one native transaction that also stamps the
 * carrier block's `updated`. `undoOperations` run before the stamp restore.
 */
export async function dispatchAvTransaction(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID: string | undefined,
    operations: TransactionOperation[],
    undoOperations: TransactionOperation[] = [],
): Promise<void> {
    const transactionBlockID = await resolveAvTransactionBlockId(client, avID, avData, explicitBlockID);
    const updatedOps = withUpdatedOperation(operations, transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: [...undoOperations, ...updatedOps.undoOperations],
    }]);
}

/** Success result plus a best-effort UI refresh of the database blocks showing this AV. */
export async function avWriteSuccess(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID: string | undefined,
    payload: Record<string, unknown>,
): Promise<ToolResult> {
    const refreshOperations = await resolveAvWriteRefreshOperations(client, avID, avData, explicitBlockID);
    return applyUiRefresh(client, createWriteSuccessResult(payload), refreshOperations);
}

export function buildStrongCellValue(
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

export function getAvKeyById(avData: unknown, keyID: string): Record<string, unknown> | undefined {
    return extractAttributeViewKeysFromData(avData)
        .find((key): key is Record<string, unknown> => getStringField(key, ['id']) === keyID);
}

export function createAvFieldValidationResult(
    action: 'set_column_options',
    avID: string,
    keyID: string,
    message: string,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: AV_TOOL_NAME,
                    action,
                    avID,
                    keyID,
                    message,
                },
            }, null, 2),
        }],
        isError: true,
    };
}

/** Read selection never writes carrier attrs, including when viewID overrides its selection. */
export async function readViewSelection(client: SiYuanClient, avID: string, definition: any, blockID?: string, viewID?: string) {
    const views: any[] = Array.isArray(definition?.views) ? definition.views.filter((view: any) => typeof view?.id === 'string' && view.id) : [];
    if (viewID) {
        const matches = views.filter(view => view.id === viewID);
        if (matches.length !== 1) throw new Error(`Unknown or ambiguous viewID: ${viewID}`);
        return { view: matches[0], viewID, selectionSource: 'explicit', selectionFallback: false };
    }
    if (blockID) {
        const attrs = await blockApi.getBlockAttrs(client, blockID);
        const selected = views.find(view => view.id === attrs['custom-sy-av-view']);
        if (selected) return { view: selected, viewID: selected.id, selectionSource: 'carrier', selectionFallback: false };
    }
    if (!views.length) throw new Error(`Database ${avID} has no readable view`);
    return { view: views[0], viewID: views[0].id, selectionSource: 'kernel_default', selectionFallback: Boolean(blockID) };
}
