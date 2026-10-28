import * as tagApi from '../../api/tag';
import * as searchApi from '../../api/search';
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
 * Renaming or removing a tag rewrites every block carrying it (and its
 * sub-tags), so every notebook that holds such a block must allow writes.
 * The span index can lag a just-written tag; that window is accepted.
 */
async function ensureTagNotebooksWritable(
    client: SiYuanClient,
    permMgr: PermissionManager,
    label: string,
): Promise<ToolResult | null> {
    const literal = escapeSqlString(label);
    const rows = await searchApi.querySQL(
        client,
        `SELECT DISTINCT box FROM spans WHERE type LIKE '%tag%' AND (content = '${literal}' OR substr(content, 1, length('${literal}') + 1) = '${literal}/')`,
    );
    const boxes = new Set((Array.isArray(rows) ? rows : [])
        .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>).box : undefined))
        .filter((box): box is string => typeof box === 'string' && box.length > 0));
    for (const box of boxes) {
        const denied = await ensurePermissionForNotebook(permMgr, box, 'write');
        if (denied) return denied;
    }
    return null;
}

export const TAG_ACTION_HANDLERS: Record<TagAction, ToolActionHandler> = {
        list: async ({ client, rawArgs }) => {
            const parsed = TagListSchema.parse(rawArgs);
            const keyword = parsed.query ?? parsed.keyword;
            if (keyword && keyword.trim().length > 0) {
                const result = await searchApi.searchTag(client, keyword);
                const typedResult = result && typeof result === 'object' ? result as unknown as Record<string, unknown> : {};
                const tags = Array.isArray(typedResult.tags) ? typedResult.tags : [];
                return createJsonResult({
                    ...typedResult,
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
            const denied = await ensureTagNotebooksWritable(client, permMgr, parsed.oldLabel);
            if (denied) return denied;
            await tagApi.renameTag(client, parsed.oldLabel, parsed.newLabel);
            return applyUiRefresh(
                client,
                createJsonResult({ success: true, oldLabel: parsed.oldLabel, newLabel: parsed.newLabel }),
                [{ type: 'reloadTag' }],
            );
        },
        remove: async ({ client, permMgr, rawArgs }) => {
            const parsed = TagRemoveSchema.parse(rawArgs);
            const denied = await ensureTagNotebooksWritable(client, permMgr, parsed.label);
            if (denied) return denied;
            await tagApi.removeTag(client, parsed.label);
            return applyUiRefresh(
                client,
                createJsonResult({ success: true, label: parsed.label }),
                [{ type: 'reloadTag' }],
            );
        },
};
