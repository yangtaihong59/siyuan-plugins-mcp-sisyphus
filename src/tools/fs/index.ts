import type { SiYuanClient } from '../../api/client';
import type { CategoryToolConfig, FsAction } from '../../core/config';
import { FS_ACTION_HINTS, FS_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    FsActionSchema,
    FsLsSchema,
    FsMvSchema,
    FsReorderSchema,
    FsReplaceSchema,
    FsReadSchema,
    FsRmSchema,
    FsSearchSchema,
    FsTreeSchema,
    FsWriteSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { FS_ACTION_HANDLERS } from './handlers';

export const FS_TOOL_NAME = 'fs';

export const FS_VARIANTS: ActionVariant<FsAction>[] = [
    createZodActionVariant('ls', FsLsSchema, 'List direct child documents using human-readable paths.'),
    createZodActionVariant('tree', FsTreeSchema, 'List a recursive document tree using human-readable paths.'),
    createZodActionVariant('read', FsReadSchema, 'Read complete display-block Markdown windows by human-readable path, with outline and continuation metadata.'),
    createZodActionVariant('write', FsWriteSchema, 'Create a document, stripping a duplicate leading title heading when present; overwrite=true performs a full body replacement.'),
    createZodActionVariant('replace', FsReplaceSchema, 'Apply exact old/new text replacement edits inside matched non-complex Markdown block DOM without rebuilding the document.'),
    createZodActionVariant('rm', FsRmSchema, 'Delete a document by human-readable path.'),
    createZodActionVariant('mv', FsMvSchema, 'Move or rename a document by human-readable paths.'),
    createZodActionVariant('reorder', FsReorderSchema, 'Apply a complete manual order to all visible direct child documents and enable custom sorting.'),
    createZodActionVariant('search', FsSearchSchema, 'Search Markdown lines under a human-readable path.'),
];

const fsTool = defineTool<FsAction>({
    name: 'fs',
    description: '📂 Simplified filesystem-style document operations.',
    variants: FS_VARIANTS,
    actionSchema: FsActionSchema,
    aggregateOptions: {
        guidance: FS_GUIDANCE,
        actionHints: FS_ACTION_HINTS,
    },
    handlers: FS_ACTION_HANDLERS,
});

export function listFsTools(config: CategoryToolConfig<FsAction>) {
    return fsTool.listTools(config);
}

export async function callFsTool(
    client: SiYuanClient,
    args: Record<string, unknown> | undefined,
    config: CategoryToolConfig<FsAction>,
    permMgr: PermissionManager,
): Promise<ToolResult> {
    return fsTool.callTool(client, args, config, permMgr);
}
