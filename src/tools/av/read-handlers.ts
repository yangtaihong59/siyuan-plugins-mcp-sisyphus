/* av read actions: get, search, query and primary-key lookup. */
import { ZodError } from 'zod';
import { viewFields } from './view-config';
import { availableReadSteps, type ReadStep } from '../internal/read-guidance';
import { databaseContext, viewReadState } from './read-context';
import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import type { PermissionManager } from '../../core/permissions';
import { AvGetSchema, AvQuerySchema, AvSearchSchema } from './schemas';
import { createResultResolutionCache, resolveDocumentContextById, resolveResultItemContext } from '../internal/context';
import { computePageCount } from '../internal/pagination';
import type { ToolHandlerContext } from '../internal/define-tool';
import { createJsonResult, type ToolResult } from '../internal/shared';
import { toCanonicalAvCell } from './cell-shape';
import { ATTRIBUTE_VIEW_DIR, ATTRIBUTE_VIEW_ID_PATTERN, type AvQueryCell, type AvQueryColumn, type AvQueryRow, type AvViewItems, asRecord, extractAttributeViewKeysFromData, getStringField, pickString } from './definition';
import { ensurePermissionForAvId, listVerifiedAvCarrierBlockIds, readViewSelection } from './carrier';
import { extractAvRowLookup, extractSourceBlockIdFromBlockValue } from './rows';

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

function extractAvQueryColumns(responseObj: Record<string, unknown>): AvQueryColumn[] {
    const candidates = [responseObj.columns, responseObj.keys, responseObj.keyValues, responseObj.attributeViewKeys];
    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        const columns = candidate.flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
            const record = item as Record<string, unknown>;
            const keyRecord = record.key && typeof record.key === 'object' && !Array.isArray(record.key)
                ? record.key as Record<string, unknown>
                : record;
            const columnID = pickString(keyRecord, ['id', 'keyID', 'columnID']);
            if (!columnID) return [];
            const name = pickString(keyRecord, ['name', 'title']);
            const type = pickString(keyRecord, ['type']);
            return [{ columnID, ...(name ? { name } : {}), ...(type ? { type } : {}) }];
        });
        if (columns.length > 0) return columns;
    }
    return [];
}

function extractAvQueryRows(
    rows: unknown[],
    groupIDs: Array<string | undefined> = [],
    projectedFields?: ReadonlySet<string>,
    columnTypes: ReadonlyMap<string, string> = new Map(),
): AvQueryRow[] {
    return rows.flatMap((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
        const record = row as Record<string, unknown>;
        // Resolve the row identity before projecting cells. A view that hides
        // or does not select columns still has valid rows; dropping them would
        // make rows[] disagree with total and pagination.
        const rowID = pickString(record, ['id', 'rowID', 'blockID']);
        const values = Array.isArray(record.values)
            ? record.values
            : Array.isArray(record.cells)
                ? record.cells
                : [];
        const cells: Record<string, AvQueryCell> = {};
        for (const value of values) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const cell = value as Record<string, unknown>;
            // Kernel rendered cell: { id: valueID, value: { keyID: columnID, ... }, valueType }.
            // The top-level id is a cell value ID; the column identity is value.keyID.
            const inner = cell.value && typeof cell.value === 'object' && !Array.isArray(cell.value)
                ? cell.value as Record<string, unknown>
                : undefined;
            const keyObj = cell.key && typeof cell.key === 'object' && !Array.isArray(cell.key)
                ? cell.key as Record<string, unknown>
                : {};
            const columnID = (inner ? pickString(inner, ['keyID']) : undefined)
                ?? pickString(keyObj, ['id', 'keyID'])
                ?? pickString(cell, ['keyID', 'columnID'])
                ?? pickString(cell, ['id']);
            if (!columnID) continue;
            // `fields` is a projection over stable columnIDs. Row identity is
            // resolved before this loop, so filtering cells never drops rows.
            if (projectedFields && !projectedFields.has(columnID)) continue;
            // Pass the complete rendered cell, not only its inner value, so
            // wrapper-level formattedContent survives projection.
            cells[columnID] = toCanonicalAvCell(cell, columnTypes.get(columnID));
        }
        if (!rowID && Object.keys(cells).length === 0) return [];
        const groupID = groupIDs[index];
        return [{
            ...(rowID ? { rowID } : {}),
            ...(groupID ? { groupID } : {}),
            cells,
        }];
    });
}

function extractViewItems(view: Record<string, unknown> | undefined): AvViewItems {
    if (!view) return { items: [], total: 0, groupIDs: [], groups: [] };
    const rows = Array.isArray(view.rows) ? view.rows
        : Array.isArray(view.cards) ? view.cards
            : [];
    const total = typeof view.rowCount === 'number' ? view.rowCount as number
        : typeof view.cardCount === 'number' ? view.cardCount as number
            : rows.length;
    if (rows.length > 0 || !Array.isArray(view.groups)) {
        return { items: rows, total, groupIDs: rows.map(() => undefined), groups: [] };
    }
    // Grouped views move rows into view.groups[].rows/cards and clear the top
    // level. Flatten exactly once while retaining the source group identity.
    const items: unknown[] = [];
    const groupIDs: Array<string | undefined> = [];
    const groups: AvViewItems['groups'] = [];
    for (const group of view.groups) {
        if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
        const groupView = group as Record<string, unknown>;
        const groupRows = Array.isArray(groupView.rows) ? groupView.rows
            : Array.isArray(groupView.cards) ? groupView.cards
                : [];
        const groupID = pickString(groupView, ['id']);
        if (groupID) {
            const name = pickString(groupView, ['name']);
            const rowCount = typeof groupView.rowCount === 'number' ? groupView.rowCount as number
                : typeof groupView.cardCount === 'number' ? groupView.cardCount as number
                    : undefined;
            groups.push({ groupID, ...(name ? { name } : {}), ...(rowCount === undefined ? {} : { rowCount }) });
        }
        for (const row of groupRows) {
            items.push(row);
            groupIDs.push(groupID);
        }
    }
    return { items, total, groupIDs, groups };
}

function computeRenderPageCount(view: Record<string, unknown> | undefined, total: number, effectivePageSize: number): number {
    const base = computePageCount(total, effectivePageSize);
    if (!Array.isArray(view?.groups)) return base;
    // 分组视图的每组独立分页，hasNextPage 以组内最大页数为准
    let count = 1;
    let foundGroupTotal = false;
    for (const group of view.groups) {
        if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
        const groupView = group as Record<string, unknown>;
        const groupTotal = typeof groupView.rowCount === 'number' ? groupView.rowCount as number
            : typeof groupView.cardCount === 'number' ? groupView.cardCount as number
                : undefined;
        if (groupTotal === undefined) continue;
        foundGroupTotal = true;
        count = Math.max(count, computePageCount(groupTotal, effectivePageSize));
    }
    // 如果内核没有提供组内总数，才退回顶层总数；不能把各组总数相加后
    // 当作单一列表分页，否则多个不足一页的分组会误报 hasNextPage。
    return foundGroupTotal ? count : base;
}

export async function handleGet({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'read', { blockID: parsed.blockID, action: 'get' });
    if (denied) return denied;
    const definition: any = avData;
    const scope = parsed.scope ?? 'structure';
    const columns = extractAttributeViewKeysFromData(avData).map((key: any) => ({ ...key, columnID: key.id }));
    const { view, ...selection } = scope === 'view' || parsed.viewID || definition?.views?.length
        ? await readViewSelection(client, parsed.avID, definition, parsed.blockID, parsed.viewID)
        : { view: undefined, viewID: undefined, selectionSource: undefined, selectionFallback: false };
    const steps: ReadStep[] = [{ purpose: 'read_view', tool: 'av', arguments: { action: 'query', avID: parsed.avID, viewID: selection.viewID, ...(parsed.blockID ? { blockID: parsed.blockID } : {}) } }];
    if (columns.some((key: any) => key.type === 'relation')) steps.push({ purpose: 'relation_help', tool: 'av', arguments: { action: 'help', topic: 'set_relation' } });
    const nextSteps = await availableReadSteps(client, steps);
    const content = scope === 'raw' ? { av: avData, resolvedRows: extractAvRowLookup(avData).rows }
        : scope === 'columns' ? { columns }
        : scope === 'view' ? { view: { id: view.id, name: view.name, type: view.type, filters: view.filters ?? [], sorts: view.sorts ?? [], group: view.group ?? null,
            columnVisibility: viewFields(view).map(field => ({ columnID: field.id, hidden: field.hidden === true })), columnOrder: viewFields(view).map(field => field.id) } }
        : { name: definition?.name, columns, views: (definition?.views ?? []).map((item: any) => ({ viewID: item.id, name: item.name, type: item.type })) };
    return createJsonResult({ avID: parsed.avID, ...(parsed.blockID ? { blockID: parsed.blockID } : {}), scope, ...selection, ...content,
        databaseContext: databaseContext(parsed.avID, { blockID: parsed.blockID, carrierBlockIDs: await listVerifiedAvCarrierBlockIds(client, parsed.avID, avData, permMgr), viewID: selection.viewID, columns: scope === 'raw' ? 'av.keyValues[].key' : scope === 'view' ? 'view.columnVisibility' : 'columns' }),
        readInfo: { scope: scope === 'columns' ? 'database_columns' : 'database', coverage: Array.isArray(definition?.keyValues) ? 'complete' : 'unknown', representation: scope === 'raw' ? 'database_raw' : scope === 'view' ? 'view_configuration' : 'database_structure', limitations: scope === 'raw' ? ['bound_block_bodies_not_included'] : ['row_values_not_included'] },
        ...(nextSteps.length ? { nextSteps } : {}),
    });
}

export async function handleSearch({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
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
    const normalizedResults = await Promise.all(filtered.results.map(async (item) => {
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
            nextSteps: await availableReadSteps(client, [{ purpose: 'read_database', tool: 'av', arguments: { action: 'get', avID } }]),
        };
    }));
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

export async function handleQuery(context: ToolHandlerContext): Promise<ToolResult> {
    const { client, permMgr, rawArgs } = context;
    const parsed = AvQuerySchema.parse(rawArgs);
    if (parsed.mode === 'primary_keys') return handleGetPrimaryKeyValues(context);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'read', { blockID: parsed.blockID, action: 'query' });
    if (denied) return denied;
    const { view: selectedView, ...selection } = await readViewSelection(client, parsed.avID, avData, parsed.blockID, parsed.viewID);
    const effectiveAvID = parsed.avID;
    const response = await avApi.renderAttributeView(client, {
        id: parsed.avID, blockID: parsed.blockID, viewID: selection.viewID,
        page: parsed.page, pageSize: parsed.pageSize, query: parsed.keyword,
        groupPaging: parsed.groupPaging, createIfNotExist: false,
    });
    const responseObj = (response && typeof response === 'object' && !Array.isArray(response))
        ? response as Record<string, unknown>
        : {};
    // SiYuan kernel nests the rendered view under `view`：
    // 表格 { pageSize, columns, rows, rowCount }（分组时行移入 view.groups[].rows），
    // 画廊/看板 { pageSize, cards, cardCount }
    const view = (responseObj.view && typeof responseObj.view === 'object' && !Array.isArray(responseObj.view))
        ? responseObj.view as Record<string, unknown>
        : undefined;
    const { items: rawRows, total, groupIDs, groups } = extractViewItems(view);
    const page = parsed.page ?? 1;
    // 内核分页：请求 pageSize<1（含 -1）时使用视图默认页大小（view.pageSize）
    const effectivePageSize = (typeof parsed.pageSize === 'number' && parsed.pageSize > 0)
        ? parsed.pageSize
        : (typeof view?.pageSize === 'number' && view.pageSize > 0)
            ? view.pageSize
            : (rawRows.length || 1);
    const kernelPageCount = computeRenderPageCount(view, total, effectivePageSize);
    const columns = extractAvQueryColumns(view ?? responseObj);
    const projectedFields = parsed.fields ? new Set(parsed.fields) : undefined;
    if (projectedFields) {
        // Validate field projection against the columns the kernel actually
        // returned for this view. Silently returning an empty cell map would
        // make a typo or a view-hidden column look like missing data.
        const available = new Set(columns.map((column) => column.columnID));
        const missing = parsed.fields!.filter((columnID) => !available.has(columnID));
        if (available.size === 0 || missing.length > 0) {
            throw new ZodError([{
                code: 'custom',
                path: ['fields'],
                message: missing.length > 0
                    ? `Unknown field(s) for this view: ${missing.join(', ')}. Use get(scope="columns") to read valid columnIDs.`
                    : 'This view returned no readable columns, so fields cannot be projected. Call query without fields or inspect get(scope="columns").',
            }]);
        }
    }
    const columnTypes = new Map(columns.flatMap((column) => column.type ? [[column.columnID, column.type] as [string, string]] : []));
    const rows = extractAvQueryRows(rawRows, groupIDs, projectedFields, columnTypes);
    const projectedColumns = projectedFields
        ? columns.filter((column) => projectedFields.has(column.columnID))
        : columns;
    const selectedViewID = getStringField(view, ['id']) ?? getStringField(responseObj, ['viewID']);
    if (selectedViewID && selectedViewID !== selection.viewID) throw new Error('Kernel returned a different view');
    const readArgs = { ...parsed, viewID: selection.viewID };
    const state = viewReadState(view, readArgs, effectivePageSize);
    const steps: ReadStep[] = [];
    if (state.next) steps.push({ purpose: 'continue_read', tool: 'av', arguments: state.next });
    steps.push({ purpose: 'read_database', tool: 'av', arguments: { action: 'get', avID: effectiveAvID, ...(parsed.blockID ? { blockID: parsed.blockID } : {}) } });
    const nextSteps = await availableReadSteps(client, steps);
    // One canonical rows array. Cells are projected by stable columnID as
    // { type, value, formatted } (see cell-shape.ts). The complete native
    // payload remains available through get(scope="raw").
    return createJsonResult({
        avID: effectiveAvID,
        id: effectiveAvID,
        structureVersion: 3,
        ...(pickString(selectedView, ['type']) ?? getStringField(responseObj, ['viewType'])
            ? { viewType: pickString(selectedView, ['type']) ?? getStringField(responseObj, ['viewType']) }
            : {}),
        rows,
        ...(parsed.includeColumns === false ? {} : { columns: projectedColumns }),
        ...(groups.length > 0 ? { groups } : {}),
        total,
        page,
        pageSize: effectivePageSize,
        pageCount: kernelPageCount,
        hasNextPage: state.hasNextPage,
        readInfo: {
            ...state.readInfo,
            representation: 'database_rows',
            limitations: [
                ...state.readInfo.limitations.filter((item) => item !== 'view_filters_and_hidden_columns'),
                'cells_projected_by_columnID',
                'complete_native_payload_requires_get_scope_raw',
            ],
        },
        databaseContext: databaseContext(effectiveAvID, {
            ...(parsed.blockID ? { blockID: parsed.blockID } : {}),
            carrierBlockIDs: await listVerifiedAvCarrierBlockIds(client, parsed.avID, avData, permMgr),
            ...(selectedViewID ? { viewID: selectedViewID } : {}),
            columns: 'columns',
            rows: 'rows',
        }),
        ...(nextSteps.length ? { nextSteps } : {}),
        ...selection,
    });
}

async function handleGetPrimaryKeyValues({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvQuerySchema.parse(rawArgs);
    const { denied } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'read', { blockID: parsed.blockID });
    if (denied) return denied;

    const response = await avApi.getAttributeViewPrimaryKeyValues(client, {
        id: parsed.avID,
        keyword: parsed.keyword,
        page: parsed.page,
        pageSize: parsed.pageSize,
    });

    // blockIDs are database carriers, not an array parallel to rows.values.
    await permMgr.reload();
    const cache = createResultResolutionCache();
    async function readableBlock(id: string): Promise<boolean> {
        const context = await resolveResultItemContext(client, { id }, cache)
            ?? await resolveDocumentContextById(client, id).catch(() => null);
        return Boolean(context && 'notebook' in context && permMgr.canRead(context.notebook));
    }
    const blockIDs: string[] = [];
    for (const id of response.blockIDs ?? []) if (await readableBlock(id)) blockIDs.push(id);
    const keyValues = asRecord(response.rows);
    if (!keyValues || (keyValues.values != null && !Array.isArray(keyValues.values))) {
        throw new Error('Primary-key response has no valid rows.values structure.');
    }
    const values = Array.isArray(keyValues.values) ? keyValues.values : [];
    const visibleValues: unknown[] = [];
    for (const value of values) {
        const sourceBlockID = extractSourceBlockIdFromBlockValue(value);
        if (asRecord(value)?.isDetached === true || (sourceBlockID && await readableBlock(sourceBlockID))) visibleValues.push(value);
    }
    const filteredOutCount = values.length - visibleValues.length;
    const page = parsed.page ?? 1;
    const pageSize = parsed.pageSize ?? 16;
    const total = response.total;
    const totalKnown = typeof total === 'number' && Number.isFinite(total) && total >= 0;
    const hasNextPage = totalKnown && page * pageSize < total;
    const steps: ReadStep[] = hasNextPage
        ? [{ purpose: 'continue_read', tool: 'av', arguments: { ...parsed, page: page + 1, pageSize } }]
        : [];
    const nextSteps = await availableReadSteps(client, steps);
    const key = asRecord(keyValues.key);
    const columnID = key ? pickString(key, ['id']) : undefined;
    const lookup = new Map(extractAvRowLookup({ keyValues: [{ ...keyValues, values: visibleValues }] }).rows.map((row) => [row.rowID, row]));
    // Same canonical row shape as query(mode="rows"): one cell per row for the primary key column.
    const rows = visibleValues.flatMap((value) => {
        const rowID = pickString(asRecord(value) ?? {}, ['blockID']);
        if (!rowID) return [];
        const binding = lookup.get(rowID);
        return [{
            rowID,
            ...(binding?.sourceBlockID ? { sourceBlockID: binding.sourceBlockID } : {}),
            ...(binding?.isDetached ? { isDetached: true } : {}),
            cells: columnID ? { [columnID]: toCanonicalAvCell(value, 'block') } : {},
        }];
    });
    const name = key ? pickString(key, ['name']) : undefined;
    return createJsonResult({
        avID: parsed.avID, name: response.name, blockIDs, rows,
        ...(parsed.includeColumns === false || !columnID ? {} : { columns: [{ columnID, ...(name ? { name } : {}), type: 'block' }] }),
        ...(totalKnown ? { total, page, pageSize, hasNextPage } : {}),
        databaseContext: databaseContext(parsed.avID, { columns: 'columns', rows: 'rows' }),
        readInfo: {
            scope: 'primary_key_query', representation: 'primary_key_values',
            coverage: filteredOutCount || page > 1 || hasNextPage ? 'partial' : !totalKnown ? 'unknown' : 'complete',
            limitations: ['primary_key_only', ...(page > 1 || hasNextPage ? ['pagination'] : []), ...(filteredOutCount ? ['permission_filtered'] : []), ...(!totalKnown ? ['unknown_total'] : [])],
        },
        ...(nextSteps.length ? { nextSteps } : {}),
        ...(filteredOutCount > 0 ? { filteredOutCount, partial: true, reason: 'permission_filtered' } : {}),
    });
}
