import * as searchApi from '../../api/search';
import type { SearchAction } from '../../core/config';
import {
    expandTypeShortcodes,
    getAssetContentSortName,
    getFulltextSortName,
    getSearchMethodName,
    normalizeSearchBlocksForAi,
    resolveAssetContentSortAlias,
    resolveSearchMethod,
    resolveSortAlias,
    resolveTypeRecord,
} from '../../core/normalize';
import {
    SearchAssetsSchema,
    SearchFindReplaceSchema,
    SearchFulltextAssetContentSchema,
    SearchFulltextSchema,
    SearchGetBacklinksSchema,
    SearchListInvalidRefsSchema,
    SearchQuerySqlSchema,
    SearchRefsSchema,
    SearchSemanticSchema,
} from '../../core/types';
import { isSiYuanVersionAtLeast } from '../../shared/siyuan-version';
import { ensurePermissionForDocumentId, ensurePermissionForNotebook, resolveNotebookForPath } from '../internal/context';
import type { ToolActionHandler } from '../internal/define-tool';
import { enrichItemsWithNotebookNames } from '../internal/helpers/notebook-names';
import { listDocumentBlocksInTreeOrder } from '../internal/document-kramdown';
import { getCachedSiYuanVersion } from '../internal/siyuan-version';
import { applyTruncation, createErrorResult, createJsonResult, createPaginatedResult, type ToolResult, type TruncationMeta } from '../internal/shared';
import {
    createPartialMetadata,
    filterBacklinkResultByPermission,
    filterFullTextSearchResultByPermission,
    filterItemsByPermission,
    isPermissionRelatedApiError,
} from './permission-filter';
import { assertReadOnlySql, getBacklinkDocWithFallback, getBackmentionDocWithFallback } from './sql-builder';

const SEARCH_TOOL_NAME = 'search';

type SearchFulltextArgs = ReturnType<(typeof SearchFulltextSchema)['parse']>;
type SearchSemanticArgs = ReturnType<(typeof SearchSemanticSchema)['parse']>;
type SearchFulltextAssetContentArgs = ReturnType<(typeof SearchFulltextAssetContentSchema)['parse']>;
type SearchFindReplaceArgs = ReturnType<(typeof SearchFindReplaceSchema)['parse']>;
type SearchMethodArgs = {
    method?: number;
    methodName?: string;
};

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function resolveAliasString(primary: string | undefined, alias: string | undefined): string | undefined {
    return isNonEmptyString(alias) ? alias : primary;
}

function buildResolvedArgs(values: Record<string, unknown>): { resolvedArgs?: Record<string, unknown> } {
    const filteredEntries = Object.entries(values).filter(([, value]) => value !== undefined);
    if (filteredEntries.length === 0) return {};
    return { resolvedArgs: Object.fromEntries(filteredEntries) };
}

function buildTruncationSummary(itemCount: number, meta?: TruncationMeta): { showing: number; truncated: boolean; hint?: string } {
    return meta
        ? {
            showing: meta.showing,
            truncated: meta.truncated,
            hint: meta.hint,
        }
        : {
            showing: itemCount,
            truncated: false,
        };
}

function normalizeReferencedBlocks(items: unknown[] | undefined): unknown[] {
    if (!Array.isArray(items)) return [];
    return normalizeSearchBlocksForAi(items);
}

function resolveFulltextTypes(parsed: SearchFulltextArgs): Record<string, boolean> | undefined {
    let resolvedTypes = parsed.types ? resolveTypeRecord(parsed.types) : parsed.types;
    if (parsed.typeShortcodes && parsed.typeShortcodes.length > 0) {
        const expanded = expandTypeShortcodes(parsed.typeShortcodes);
        resolvedTypes = { ...expanded, ...resolvedTypes };
    }
    return resolvedTypes as Record<string, boolean> | undefined;
}

function resolveSemanticTypes(parsed: SearchSemanticArgs): Record<string, boolean> | undefined {
    const resolved = parsed.types ? resolveTypeRecord(parsed.types) : {};
    const expanded = parsed.typeShortcodes ? expandTypeShortcodes(parsed.typeShortcodes) : {};
    const merged = { ...resolved, ...expanded };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function resolveFulltextRequestPageSize(parsed: SearchFulltextArgs): number | undefined {
    return parsed.parentId
        ? Math.min((parsed.pageSize ?? 32) * 3, 128)
        : parsed.pageSize;
}

function applyFulltextParentIdFilter(normalizedObj: Record<string, unknown>, parentId: string): void {
    if (!Array.isArray(normalizedObj.blocks)) return;
    const pid = parentId;
    normalizedObj.blocks = (normalizedObj.blocks as Array<Record<string, unknown>>).filter((block) =>
        block.rootID === pid || block.root_id === pid || block.parent_id === pid || block.parentID === pid,
    );
    normalizedObj.matchedBlockCount = (normalizedObj.blocks as unknown[]).length;
    normalizedObj.parentIdFilter = pid;
}

function applyFulltextHasTagsFilter(normalizedObj: Record<string, unknown>, hasTags: boolean): void {
    if (!Array.isArray(normalizedObj.blocks)) return;
    normalizedObj.blocks = (normalizedObj.blocks as Array<Record<string, unknown>>).filter((block) => {
        const tagField = typeof block.tag === 'string' ? (block.tag as string).trim() : '';
        const hasTag = tagField.length > 0;
        return hasTags ? hasTag : !hasTag;
    });
    normalizedObj.matchedBlockCount = (normalizedObj.blocks as unknown[]).length;
}

function resolveSearchMethodMeta(parsed: SearchMethodArgs): { method?: number; methodName?: string } {
    const method = resolveSearchMethod(parsed.methodName, parsed.method);
    return {
        ...(method !== undefined ? { method } : {}),
        ...(method !== undefined ? { methodName: getSearchMethodName(method) } : {}),
    };
}

function createFulltextPaginatedResult(
    normalizedObj: Record<string, unknown>,
    parsed: Pick<SearchFulltextArgs, 'page' | 'pageSize' | 'parentId' | 'hasTags'>,
    kernelMeta: { matchedBlockCount?: number; matchedRootCount?: number; pageCount?: number },
    resolvedArgs?: Record<string, unknown>,
    emptyWarning?: string,
): ToolResult {
    const blocks = Array.isArray(normalizedObj.blocks)
        ? normalizedObj.blocks as unknown[]
        : [];
    const page = parsed.page ?? 1;
    const pageSize = parsed.pageSize ?? 32;
    const truncated = applyTruncation(blocks, 20, `Use page/pageSize parameters to paginate. Current page: ${page}.`);
    const returnedTotal = blocks.length;
    const kernelPageCount = typeof kernelMeta.pageCount === 'number' ? kernelMeta.pageCount : 1;
    const permissionFilteredCount = typeof normalizedObj.filteredOutBlockCount === 'number'
        ? normalizedObj.filteredOutBlockCount as number
        : 0;
    const postFiltered = permissionFilteredCount > 0 || !!parsed.parentId || parsed.hasTags !== undefined;
    const total = postFiltered
        ? returnedTotal
        : (typeof kernelMeta.matchedBlockCount === 'number' ? kernelMeta.matchedBlockCount : returnedTotal);
    const pagination = {
        total,
        page,
        pageSize,
        pageCount: postFiltered ? 1 : kernelPageCount,
        hasNextPage: postFiltered ? false : page < kernelPageCount,
    };
    const { blocks: _ignoredBlocks, pageCount: _ignoredPageCount, ...restRaw } = normalizedObj;
    void _ignoredBlocks;
    void _ignoredPageCount;

    return createPaginatedResult(truncated.items, pagination, {
        ...restRaw,
        ...createPartialMetadata(permissionFilteredCount),
        ...buildTruncationSummary(returnedTotal, truncated.meta),
        returnedTotal,
        returnedPageCount: 1,
        returnedHasNextPage: false,
        ...(kernelMeta.matchedBlockCount !== undefined ? { kernelMatchedBlockCount: kernelMeta.matchedBlockCount } : {}),
        ...(kernelMeta.matchedRootCount !== undefined ? { kernelMatchedRootCount: kernelMeta.matchedRootCount } : {}),
        kernelPageCount,
        kernelHasNextPage: page < kernelPageCount,
        ...(postFiltered ? {
            paginationMode: 'post_filtered_window',
            pagingHint: 'kernel* pagination fields describe the raw SiYuan search page before permission and parent/tag post-filtering.',
        } : {}),
        ...(parsed.parentId && returnedTotal === 0 ? {
            warning: 'No matching blocks were found in the requested document subtree. If the content was just created or updated, SiYuan full-text indexing may still be catching up; retry shortly.',
        } : {}),
        ...(!parsed.parentId && returnedTotal === 0 && emptyWarning ? { warning: emptyWarning } : {}),
        ...(resolvedArgs ? { resolvedArgs } : {}),
    });
}

function createSqlQueryResult(rows: unknown[], removedCount: number, resolvedArgs?: Record<string, unknown>): ToolResult {
    const truncated = applyTruncation(rows, 50, 'Add LIMIT and OFFSET to your SQL for pagination.');
    const total = rows.length;
    return createJsonResult({
        data: truncated.items,
        total,
        totalRows: total,
        ...buildTruncationSummary(total, truncated.meta),
        ...createPartialMetadata(removedCount),
        ...(resolvedArgs ? { resolvedArgs } : {}),
    });
}

function createFulltextAssetContentResult(
    typed: Record<string, unknown>,
    assetContents: unknown[],
    removedCount: number,
    resolvedArgs?: Record<string, unknown>,
): ToolResult {
    const truncated = applyTruncation(assetContents, 20, 'Use page/pageSize parameters to paginate asset content results.');
    const total = assetContents.length;
    return createJsonResult({
        ...typed,
        assetContents: truncated.items,
        data: truncated.items,
        total,
        ...buildTruncationSummary(total, truncated.meta),
        ...createPartialMetadata(removedCount),
        ...(resolvedArgs ? { resolvedArgs } : {}),
    });
}

async function resolveFindReplaceTargetIDs(
    client: Parameters<ToolActionHandler>[0]['client'],
    ids: string[],
    replaceTypes: Record<string, boolean>,
): Promise<string[]> {
    const resolved = new Set<string>();
    for (const id of ids) {
        const info = await client.requestRead<Record<string, unknown>>('/api/block/getBlockInfo', { id });
        const rootID = typeof info?.rootID === 'string' ? info.rootID : '';
        if (rootID !== id) {
            resolved.add(id);
            continue;
        }

        // The kernel interprets a document ID as "document title only" and
        // does not walk its body. Expand document scopes to concrete block IDs
        // so the public schema's document-or-block promise is actually true.
        if (replaceTypes.docTitle) resolved.add(id);
        const blocks = await listDocumentBlocksInTreeOrder(client, id);
        for (const block of blocks) resolved.add(block.id);
        // Never send an empty ids array: the kernel interprets that as a
        // workspace-wide replacement scope.
        if (blocks.length === 0 && !replaceTypes.docTitle) resolved.add(id);
    }
    return [...resolved];
}

export const SEARCH_ACTION_HANDLERS: Record<SearchAction, ToolActionHandler> = {
    fulltext: async ({ client, permMgr, rawArgs }) => {
        const parsed = SearchFulltextSchema.parse(rawArgs);
        if (parsed.parentId) {
            const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.parentId, 'read');
            if (denied) return denied;
        }

        const resolvedMethod = resolveSearchMethodMeta(parsed);
        const resolvedOrderBy = resolveSortAlias(parsed.sortBy, parsed.orderBy);
        const result = await searchApi.fullTextSearchBlock(client, {
            query: parsed.query,
            method: resolvedMethod.method,
            types: resolveFulltextTypes(parsed),
            paths: parsed.paths,
            groupBy: parsed.groupBy,
            orderBy: resolvedOrderBy,
            page: parsed.page,
            pageSize: resolveFulltextRequestPageSize(parsed),
        });
        const filtered = filterFullTextSearchResultByPermission(result, permMgr);
        const filteredObj = filtered as unknown as Record<string, unknown>;
        const normalizedObj: Record<string, unknown> = {
            ...filteredObj,
            blocks: normalizeReferencedBlocks(Array.isArray(filteredObj.blocks) ? filteredObj.blocks : []),
        };
        if (parsed.parentId) {
            applyFulltextParentIdFilter(normalizedObj, parsed.parentId);
        }

        if (parsed.hasTags !== undefined) {
            applyFulltextHasTagsFilter(normalizedObj, parsed.hasTags);
        }

        if (Array.isArray(normalizedObj.blocks)) {
            normalizedObj.blocks = await enrichItemsWithNotebookNames(client, normalizedObj.blocks);
        }

        const shouldExposeResolvedArgs = parsed.methodName !== undefined || parsed.sortBy !== undefined;
        const resolvedArgs = shouldExposeResolvedArgs
            ? buildResolvedArgs({
                query: parsed.query,
                ...resolvedMethod,
                ...(resolvedOrderBy !== undefined ? { orderBy: resolvedOrderBy } : {}),
                ...(resolvedOrderBy !== undefined ? { sortBy: getFulltextSortName(resolvedOrderBy) } : {}),
            }).resolvedArgs
            : undefined;

        return createFulltextPaginatedResult(normalizedObj, parsed, {
            matchedBlockCount: typeof result.matchedBlockCount === 'number' ? result.matchedBlockCount : undefined,
            matchedRootCount: typeof result.matchedRootCount === 'number' ? result.matchedRootCount : undefined,
            pageCount: typeof (result as unknown as Record<string, unknown>).pageCount === 'number'
                ? (result as unknown as Record<string, unknown>).pageCount as number
                : undefined,
        }, resolvedArgs);
    },
    semantic: async ({ client, permMgr, rawArgs }) => {
        const parsed = SearchSemanticSchema.parse(rawArgs);
        const version = await getCachedSiYuanVersion(client);
        if (!isSiYuanVersionAtLeast(version, '3.7.0')) {
            return createErrorResult(
                new Error(`SiYuan version ${version} does not support semantic search; version 3.7.0 or newer is required.`),
                { tool: SEARCH_TOOL_NAME, action: 'semantic', rawArgs },
            );
        }

        const result = await searchApi.semanticSearchBlock(client, {
            query: parsed.query,
            paths: parsed.paths,
            types: resolveSemanticTypes(parsed),
            subTypes: parsed.subTypes,
            page: parsed.page,
            pageSize: parsed.pageSize,
        });
        const filtered = filterFullTextSearchResultByPermission(result, permMgr);
        const filteredObj = filtered as unknown as Record<string, unknown>;
        const normalizedObj: Record<string, unknown> = {
            ...filteredObj,
            blocks: normalizeReferencedBlocks(Array.isArray(filteredObj.blocks) ? filteredObj.blocks : []),
        };
        if (Array.isArray(normalizedObj.blocks)) {
            normalizedObj.blocks = await enrichItemsWithNotebookNames(client, normalizedObj.blocks);
        }

        return createFulltextPaginatedResult(normalizedObj, parsed, {
            matchedBlockCount: typeof result.matchedBlockCount === 'number' ? result.matchedBlockCount : undefined,
            matchedRootCount: typeof result.matchedRootCount === 'number' ? result.matchedRootCount : undefined,
            pageCount: typeof result.pageCount === 'number' ? result.pageCount : undefined,
        }, undefined, 'No semantic matches were returned. Verify that the embedding model is enabled, the embedding index has finished, and the selected notebooks are not encrypted.');
    },
    query_sql: async ({ client, permMgr, rawArgs }) => {
        const parsed = SearchQuerySqlSchema.parse(rawArgs);
        const stmt = resolveAliasString(parsed.stmt, parsed.sql);
        try {
            assertReadOnlySql(stmt ?? '');
        } catch (error) {
            return createErrorResult(
                error,
                { tool: SEARCH_TOOL_NAME, action: 'query_sql', rawArgs },
            );
        }
        const result = await searchApi.querySQL(client, stmt ?? '');
        const rows = Array.isArray(result) ? result : [];
        const filtered = await filterItemsByPermission(client, rows, permMgr);
        const resolvedArgs = parsed.sql !== undefined
            ? buildResolvedArgs({ stmt }).resolvedArgs
            : undefined;
        return createSqlQueryResult(filtered.items, filtered.removedCount, resolvedArgs);
    },
    get_backlinks: async ({ client, permMgr, rawArgs }) => {
        const parsed = SearchGetBacklinksSchema.parse(rawArgs);
        const scopeRootId = resolveAliasString(parsed.refTreeID, parsed.scopeRootId);
        const mode = parsed.mode ?? 'both';
        const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
        if (denied) return denied;
        try {
            const linkResult = mode !== 'mentions'
                ? await getBacklinkDocWithFallback(client, parsed.id, parsed.keyword, scopeRootId)
                : {};
            const mentionResult = mode !== 'links'
                ? await getBackmentionDocWithFallback(client, parsed.id, parsed.keyword, scopeRootId)
                : {};
            const result = { ...(linkResult as Record<string, unknown>), ...(mentionResult as Record<string, unknown>) };
            const filtered = filterBacklinkResultByPermission(result, permMgr);
            return createJsonResult({
                ...filtered,
                mode,
                backlinks: mode !== 'mentions' ? normalizeReferencedBlocks(Array.isArray(filtered.backlinks) ? filtered.backlinks : []) : [],
                backmentions: mode !== 'links' ? normalizeReferencedBlocks(Array.isArray(filtered.backmentions) ? filtered.backmentions : []) : [],
                ...(result.sourcePayloadMissing ? { sourcePayloadMissing: true } : {}),
                ...(result.fallbackQuery ? { fallbackQuery: result.fallbackQuery } : {}),
                ...(result.resultConfidence ? { resultConfidence: result.resultConfidence } : {}),
                ...(parsed.scopeRootId !== undefined ? { resolvedArgs: { refTreeID: scopeRootId } } : {}),
                ...(result.fallbackUsed ? { warning: 'SiYuan returned no backlink/backmention payload; SQL fallback results are shown.' } : {}),
            });
        } catch (error) {
            if (isPermissionRelatedApiError(error)) {
                return createJsonResult({
                    backlinks: [],
                    backmentions: [],
                    warning: 'SiYuan rejected part of the backlink/backmention query due to restricted notebooks; restricted results were omitted.',
                    partial: true,
                    reason: 'permission_filtered',
                    permissionSummary: createPartialMetadata(1).permissionSummary,
                });
            }
            throw error;
        }
    },
    search_refs: async ({ client, permMgr, rawArgs }) => {
        const parsed = SearchRefsSchema.parse(rawArgs);
        const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
        if (denied) return denied;
        const result = await searchApi.searchRefBlock(client, parsed);
        const typed = result && typeof result === 'object' ? result as Record<string, unknown> : {};
        const blocks = Array.isArray(typed.blocks) ? typed.blocks : [];
        const filtered = await filterItemsByPermission(client, blocks, permMgr);
        const normalizedBlocks = normalizeReferencedBlocks(filtered.items);
        return createJsonResult({
            ...typed,
            blocks: normalizedBlocks,
            data: normalizedBlocks,
            total: normalizedBlocks.length,
            showing: normalizedBlocks.length,
            truncated: false,
            ...createPartialMetadata(filtered.removedCount),
        });
    },
    find_replace: async ({ client, permMgr, rawArgs }) => {
        const parsed = SearchFindReplaceSchema.parse(rawArgs);
        for (const id of parsed.ids) {
            const { denied } = await ensurePermissionForDocumentId(client, permMgr, id, 'write');
            if (denied) return denied;
        }
        if (Array.isArray(parsed.paths)) {
            for (const path of parsed.paths) {
                const notebook = await resolveNotebookForPath(client, path);
                if (!notebook) continue;
                const denied = await ensurePermissionForNotebook(permMgr, notebook, 'write');
                if (denied) return denied;
            }
        }
        const resolvedMethod = resolveSearchMethodMeta(parsed);
        const resolvedOrderBy = resolveSortAlias(parsed.sortBy, parsed.orderBy);
        // SiYuan treats an omitted replaceTypes object as "replace nothing"
        // while still returning code=0. Plain text is the least-surprising,
        // narrow default for this action; callers can opt into titles, links,
        // code, tags, and other node kinds explicitly.
        const resolvedReplaceTypes = parsed.replaceTypes ?? { text: true };
        const resolvedTargetIDs = await resolveFindReplaceTargetIDs(client, parsed.ids, resolvedReplaceTypes);
        await searchApi.findReplace(client, {
            k: parsed.k,
            r: parsed.r,
            ids: resolvedTargetIDs,
            ...(parsed.paths ? { paths: parsed.paths } : {}),
            ...(parsed.types ? { types: parsed.types } : {}),
            ...(resolvedMethod.method !== undefined ? { method: resolvedMethod.method } : {}),
            ...(resolvedOrderBy !== undefined ? { orderBy: resolvedOrderBy } : {}),
            ...(parsed.groupBy !== undefined ? { groupBy: parsed.groupBy } : {}),
            replaceTypes: resolvedReplaceTypes,
        });
        const shouldExposeResolvedArgs = parsed.methodName !== undefined || parsed.sortBy !== undefined;
        return createJsonResult({
            success: true,
            replaced: true,
            ids: parsed.ids,
            targetIDs: resolvedTargetIDs,
            k: parsed.k,
            r: parsed.r,
            ...(parsed.paths ? { paths: parsed.paths } : {}),
            replaceTypes: resolvedReplaceTypes,
            ...(shouldExposeResolvedArgs ? {
                resolvedArgs: buildResolvedArgs({
                    ...resolvedMethod,
                    ...(resolvedOrderBy !== undefined ? { orderBy: resolvedOrderBy } : {}),
                    ...(resolvedOrderBy !== undefined ? { sortBy: getFulltextSortName(resolvedOrderBy) } : {}),
                }).resolvedArgs,
            } : {}),
        });
    },
    search_assets: async ({ client, rawArgs }) => {
        const parsed = SearchAssetsSchema.parse(rawArgs);
        const query = resolveAliasString(parsed.k, parsed.query) ?? '';
        const result = await searchApi.searchAsset(client, query, parsed.exts);
        if (parsed.query === undefined) {
            return createJsonResult(result);
        }
        return createJsonResult({
            ...(result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : { data: result }),
            resolvedArgs: { query },
        });
    },
    fulltext_asset_content: async ({ client, permMgr, rawArgs }) => {
        const parsed = SearchFulltextAssetContentSchema.parse(rawArgs) as SearchFulltextAssetContentArgs;
        if (parsed.assetId) {
            const result = await searchApi.getAssetContent(client, parsed.assetId, parsed.query ?? '', parsed.queryMethod ?? 0);
            return createJsonResult(result);
        }
        const resolvedMethod = resolveSearchMethodMeta(parsed);
        const resolvedOrderBy = resolveAssetContentSortAlias(parsed.sortBy, parsed.orderBy);
        const result = await searchApi.fullTextSearchAssetContent(client, {
            query: parsed.query!,
            ...(parsed.types ? { types: parsed.types } : {}),
            ...(resolvedMethod.method !== undefined ? { method: resolvedMethod.method } : {}),
            ...(resolvedOrderBy !== undefined ? { orderBy: resolvedOrderBy } : {}),
            ...(parsed.page !== undefined ? { page: parsed.page } : {}),
            ...(parsed.pageSize !== undefined ? { pageSize: parsed.pageSize } : {}),
        });
        const typed = result && typeof result === 'object' ? result as Record<string, unknown> : {};
        const assetContents = Array.isArray(typed.assetContents) ? typed.assetContents : [];
        const filtered = await filterItemsByPermission(client, assetContents, permMgr);
        const shouldExposeResolvedArgs = parsed.methodName !== undefined || parsed.sortBy !== undefined;
        return createFulltextAssetContentResult(typed, filtered.items, filtered.removedCount, shouldExposeResolvedArgs
            ? buildResolvedArgs({
                query: parsed.query,
                ...resolvedMethod,
                ...(resolvedOrderBy !== undefined ? { orderBy: resolvedOrderBy } : {}),
                ...(resolvedOrderBy !== undefined ? { sortBy: getAssetContentSortName(resolvedOrderBy) } : {}),
            }).resolvedArgs
            : undefined);
    },
    list_invalid_refs: async ({ client, permMgr, rawArgs }) => {
        const parsed = SearchListInvalidRefsSchema.parse(rawArgs);
        const result = await searchApi.listInvalidBlockRefs(client, parsed.page, parsed.pageSize);
        const filtered = filterFullTextSearchResultByPermission((result ?? {}) as {
            blocks?: unknown[];
            matchedBlockCount?: number;
            matchedRootCount?: number;
        }, permMgr);
        const filteredObj = filtered as unknown as Record<string, unknown>;
        const blocks = Array.isArray(filteredObj.blocks) ? filteredObj.blocks : [];
        const normalizedBlocks = normalizeReferencedBlocks(blocks);
        return createJsonResult({
            ...filteredObj,
            blocks: normalizedBlocks,
            data: normalizedBlocks,
            total: normalizedBlocks.length,
            showing: normalizedBlocks.length,
            truncated: false,
            ...createPartialMetadata(typeof filteredObj.filteredOutBlockCount === 'number' ? filteredObj.filteredOutBlockCount as number : 0),
        });
    },
};
