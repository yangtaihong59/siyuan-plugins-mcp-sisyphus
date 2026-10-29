import * as tagApi from '../../api/tag';
import * as searchApi from '../../api/search';
import * as notebookApi from '../../api/notebook';
import type { SiYuanClient } from '../../api/client';
import type { TagAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import { escapeSqlString } from '../../shared/sql';
import { ensurePermissionForNotebook } from '../internal/context';
import { TagListSchema, TagRemoveSchema, TagRenameSchema } from './schemas';
import type { ToolActionHandler } from '../internal/define-tool';
import { createJsonResult, type ToolResult } from '../internal/shared';
import { applyUiRefresh } from '../internal/ui-refresh';

/*
 * Tag handlers live in their own module (no defineTool / z.toJSONSchema at
 * top level) so the kernel goja bundle can import them without pulling the
 * schema-reflection path that hangs the sandbox.
 */
/**
 * Every indexed block carrying the tag or one of its sub-tags, one row per
 * (box, block_id). Shared with the write-impact preview.
 */
export async function queryTagCarrierRows(client: SiYuanClient, label: string): Promise<Array<Record<string, unknown>>> {
    const literal = escapeSqlString(label);
    const rows = await searchApi.querySQL(
        client,
        `SELECT DISTINCT box, block_id FROM spans WHERE type LIKE '%tag%' AND (content = '${literal}' OR substr(content, 1, length('${literal}') + 1) = '${literal}/')`,
    );
    return (Array.isArray(rows) ? rows : [])
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}

/**
 * Renaming or removing a tag rewrites every block carrying it (and its
 * sub-tags), so every notebook that holds such a block must allow writes.
 * The span index can lag a just-written tag; that window is accepted.
 */
async function ensureTagNotebooksWritable(
    client: SiYuanClient,
    permMgr: PermissionManager,
    label: string,
): Promise<{ denied: ToolResult | null; blockCount: number }> {
    const records = await queryTagCarrierRows(client, label);
    const boxes = new Set(records
        .map((row) => row.box)
        .filter((box): box is string => typeof box === 'string' && box.length > 0));
    for (const box of boxes) {
        const denied = await ensurePermissionForNotebook(permMgr, box, 'write');
        if (denied) return { denied, blockCount: 0 };
    }
    return { denied: null, blockCount: new Set(records.map((row) => row.block_id)).size };
}

/**
 * SiYuan rewrites tags only in open notebooks and reports success either way,
 * so a rename that touched nothing would otherwise look like it worked.
 */
async function tagScopeWarning(client: SiYuanClient, label: string, blockCount: number): Promise<string | undefined> {
    let notebooks: Awaited<ReturnType<typeof notebookApi.listNotebooks>> | null = null;
    try {
        notebooks = await notebookApi.listNotebooks(client);
    } catch {
        // The warning is advisory; the write itself already succeeded.
    }
    const closed = (notebooks?.notebooks ?? []).filter((notebook) => notebook.closed).map((notebook) => notebook.name);
    const closedNote = closed.length > 0
        ? ` Closed notebooks are skipped by SiYuan (${closed.join(', ')}); open them with notebook set_open_state and retry if the tag lives there.`
        : '';
    if (blockCount === 0) return `No indexed block in an open notebook carries #${label}#, so nothing was changed.${closedNote}`;
    return closedNote ? closedNote.trim() : undefined;
}

export const TAG_ACTION_HANDLERS: Record<TagAction, ToolActionHandler> = {
        list: async ({ client, rawArgs }) => {
            const parsed = TagListSchema.parse(rawArgs);
            const keyword = parsed.query ?? parsed.keyword;
            if (keyword && keyword.trim().length > 0) {
                const result = await searchApi.searchTag(client, keyword);
                const typedResult = result && typeof result === 'object' ? result as unknown as Record<string, unknown> : {};
                // searchTag wraps the match in <mark>…</mark> for the editor; callers need plain labels.
                const tags = Array.isArray(typedResult.tags)
                    ? typedResult.tags.map((tag) => typeof tag === 'string' ? tag.replace(/<\/?mark>/g, '') : tag)
                    : [];
                return createJsonResult({
                    ...typedResult,
                    tags,
                    resolvedArgs: { keyword },
                    ...(tags.length === 0 ? {
                        warning: 'No matching tags were found. If the tag was just created, SiYuan tag indexing may still be catching up; verify the markdown uses #tag# syntax and retry shortly.',
                    } : {}),
                });
            }
            const result = await tagApi.listTags(client, parsed);
            return createJsonResult(result);
        },
        rename: async ({ client, permMgr, rawArgs }) => {
            const parsed = TagRenameSchema.parse(rawArgs);
            const { denied, blockCount } = await ensureTagNotebooksWritable(client, permMgr, parsed.oldLabel);
            if (denied) return denied;
            await tagApi.renameTag(client, parsed.oldLabel, parsed.newLabel);
            const warning = await tagScopeWarning(client, parsed.oldLabel, blockCount);
            return applyUiRefresh(
                client,
                createJsonResult({ success: true, oldLabel: parsed.oldLabel, newLabel: parsed.newLabel, count: blockCount, ...(warning ? { warning } : {}) }),
                [{ type: 'reloadTag' }],
            );
        },
        remove: async ({ client, permMgr, rawArgs }) => {
            const parsed = TagRemoveSchema.parse(rawArgs);
            const { denied, blockCount } = await ensureTagNotebooksWritable(client, permMgr, parsed.label);
            if (denied) return denied;
            await tagApi.removeTag(client, parsed.label);
            const warning = await tagScopeWarning(client, parsed.label, blockCount);
            return applyUiRefresh(
                client,
                createJsonResult({ success: true, label: parsed.label, count: blockCount, ...(warning ? { warning } : {}) }),
                [{ type: 'reloadTag' }],
            );
        },
};
