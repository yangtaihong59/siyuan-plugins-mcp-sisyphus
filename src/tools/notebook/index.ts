import type { SiYuanClient } from '../../api/client';
import type { CategoryToolConfig, NotebookAction } from '../../core/config';
import { NOTEBOOK_ACTION_HINTS, NOTEBOOK_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    NotebookActionSchema,
    NotebookCreateSchema,
    NotebookGetChildDocsSchema,
    NotebookGetConfSchema,
    NotebookGetPermissionsSchema,
    NotebookListSchema,
    NotebookRemoveSchema,
    NotebookRenameSchema,
    NotebookSetConfSchema,
    NotebookSetIconSchema,
    NotebookSetOpenStateSchema,
    NotebookSetPermissionSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { NOTEBOOK_ACTION_HANDLERS } from './handlers';

export { NOTEBOOK_TOOL_NAME } from './handlers';

export const NOTEBOOK_VARIANTS: ActionVariant<NotebookAction>[] = [
    createZodActionVariant('list', NotebookListSchema, 'List all notebooks in the workspace.'),
    createZodActionVariant('create', NotebookCreateSchema, 'Create a new notebook.'),
    createZodActionVariant('set_open_state', NotebookSetOpenStateSchema, 'Set notebook open state (open or close).'),
    createZodActionVariant('remove', NotebookRemoveSchema, 'Remove a notebook.'),
    createZodActionVariant('rename', NotebookRenameSchema, 'Rename a notebook.'),
    createZodActionVariant('get_conf', NotebookGetConfSchema, 'Get notebook configuration.'),
    createZodActionVariant('set_conf', NotebookSetConfSchema, 'Set notebook configuration.'),
    createZodActionVariant('set_icon', NotebookSetIconSchema, 'Set the icon for a notebook.'),
    createZodActionVariant('get_permissions', NotebookGetPermissionsSchema, 'Get permission levels for notebooks. Omit notebook or pass "all" to return every notebook; pass a specific notebook ID to return only that notebook.'),
    createZodActionVariant('set_permission', NotebookSetPermissionSchema, 'Set the permission level for a notebook.'),
    createZodActionVariant('get_child_docs', NotebookGetChildDocsSchema, 'Get direct child documents at the notebook root. Returns a paginated { data, total, page, pageSize, pageCount, hasNextPage } payload.'),
];

const notebookTool = defineTool<NotebookAction>({
    name: 'notebook',
    description: '📚 Notebooks by notebook ID: list, create, open/close, rename, icon, config, root child docs, and MCP read/write permissions.',
    variants: NOTEBOOK_VARIANTS,
    actionSchema: NotebookActionSchema,
    aggregateOptions: {
        guidance: NOTEBOOK_GUIDANCE,
        actionHints: NOTEBOOK_ACTION_HINTS,
    },
    handlers: NOTEBOOK_ACTION_HANDLERS,
});

export function listNotebookTools(config: CategoryToolConfig<NotebookAction>) {
    return notebookTool.listTools(config);
}

export function callNotebookTool(
    client: SiYuanClient,
    args: Record<string, unknown> | undefined,
    config: CategoryToolConfig<NotebookAction>,
    permMgr: PermissionManager,
): Promise<ToolResult> {
    return notebookTool.callTool(client, args, config, permMgr);
}
