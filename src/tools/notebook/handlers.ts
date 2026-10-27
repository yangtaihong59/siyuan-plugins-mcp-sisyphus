import type { SiYuanClient } from '../../api/client';
import * as notebookApi from '../../api/notebook';
import type { NotebookAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import { NotebookCreateSchema, NotebookGetConfSchema, NotebookGetChildDocsSchema, NotebookGetPermissionsSchema, NotebookListSchema, NotebookSetOpenStateSchema, NotebookRemoveSchema, NotebookRenameSchema, NotebookSetConfSchema, NotebookSetIconSchema, NotebookSetPermissionSchema } from './schemas';
import { ensurePermissionForNotebook, listChildDocumentsByPath } from '../internal/context';
import type { ToolActionHandler } from '../internal/define-tool';
import { createErrorResult, createJsonResult, createPaginatedResult, createSetIconReminder, paginate, type ToolResult } from '../internal/shared';
import { applyUiRefresh } from '../internal/ui-refresh';

export const NOTEBOOK_TOOL_NAME = 'notebook';

type NotebookActionHandler = ToolActionHandler;

function normalizeNotebookChildDocsError(error: unknown, notebookId: string, exists: boolean, closed: boolean): Error {
    const message = error instanceof Error ? error.message : String(error);

    if (!exists) {
        return new Error(`Failed to get child documents: notebook "${notebookId}" does not exist.`);
    }

    if (message.includes('permission')) {
        return new Error(`Failed to get child documents for notebook "${notebookId}": permission denied by SiYuan. ${message}`);
    }

    if (closed) {
        return new Error(`Failed to get child documents for notebook "${notebookId}": notebook is currently closed or still initializing. ${message}`);
    }

    return new Error(`Failed to get child documents for notebook "${notebookId}" at "/". ${message}`);
}

function isRetryableNotebookChildDocsError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /initializing|kernel still initializing|notebook is currently closed/i.test(message);
}

async function retryNotebookChildDocs(
    client: SiYuanClient,
    notebookId: string,
    retries: number,
    delayMs: number,
): Promise<{ children?: Awaited<ReturnType<typeof listChildDocumentsByPath>>; error?: unknown; attempts: number }> {
    let attempts = 0;

    while (attempts <= retries) {
        attempts += 1;
        try {
            const children = await listChildDocumentsByPath(client, notebookId, '/');
            return { children, attempts };
        } catch (error) {
            if (attempts > retries || !isRetryableNotebookChildDocsError(error)) {
                return { error, attempts };
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    return { error: new Error(`Failed to get child documents for notebook "${notebookId}".`), attempts };
}

function createNotebookChildDocsStateErrorResult(notebookId: string, message: string, retryAttempts: number, retryWindowMs: number): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'internal_error',
                    tool: NOTEBOOK_TOOL_NAME,
                    action: 'get_child_docs',
                    message,
                    reason: 'notebook_closed_or_initializing',
                    retryable: true,
                    suggestedNextAction: 'open_notebook_or_retry',
                    notebook: notebookId,
                    retryAttempts,
                    retryWindowMs,
                    hint: 'This usually happens right after notebook(action="close"). Re-open the notebook first, or retry after a short wait.',
                },
            }, null, 2),
        }],
        isError: true,
    };
}

const handleList: NotebookActionHandler = async ({ client, rawArgs }) => {
    NotebookListSchema.parse(rawArgs);
    const result = await notebookApi.listNotebooks(client);
    return createJsonResult(result.notebooks);
};

const handleCreate: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookCreateSchema.parse(rawArgs);
    const result = await notebookApi.createNotebook(client, parsed.name);
    // The notebook exists now; a failed permission write must not hide that.
    let permission: string;
    let permissionWarning: string | undefined;
    try {
        permission = await permMgr.grantNewNotebook(result.notebook.id);
    } catch (error) {
        permission = permMgr.get(result.notebook.id);
        permissionWarning = `Notebook was created, but its permission could not be saved: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (parsed.icon) {
        await notebookApi.setNotebookIcon(client, result.notebook.id, parsed.icon);
        result.notebook.icon = parsed.icon;
    }
    return applyUiRefresh(client, createJsonResult({
        ...result.notebook,
        permission,
        ...(permissionWarning ? { permissionWarning } : {}),
        iconHint: createSetIconReminder('notebook', Boolean(parsed.icon)),
    }), parsed.icon ? [{ type: 'reloadIcon' }] : [{ type: 'reloadFiletree' }]);
};

const handleSetOpenState: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookSetOpenStateSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'read');
    if (denied) return denied;
    if (parsed.opened) {
        await notebookApi.openNotebook(client, parsed.notebook);
    } else {
        await notebookApi.closeNotebook(client, parsed.notebook);
    }
    return applyUiRefresh(client, createJsonResult({ success: true, notebook: parsed.notebook, opened: parsed.opened }), [{ type: 'reloadFiletree' }]);
};

const handleRemove: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookRemoveSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'delete');
    if (denied) return denied;
    await notebookApi.removeNotebook(client, parsed.notebook);
    return applyUiRefresh(client, createJsonResult({ success: true, notebook: parsed.notebook }), [{ type: 'reloadFiletree' }]);
};

const handleRename: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookRenameSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'write');
    if (denied) return denied;
    await notebookApi.renameNotebook(client, parsed.notebook, parsed.name);
    return applyUiRefresh(client, createJsonResult({ success: true, notebook: parsed.notebook, name: parsed.name }), [{ type: 'reloadFiletree' }]);
};

const handleGetConf: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookGetConfSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'read');
    if (denied) return denied;
    const result = await notebookApi.getNotebookConf(client, parsed.notebook);
    return createJsonResult(result);
};

const handleSetConf: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookSetConfSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'write');
    if (denied) return denied;
    const result = await notebookApi.setNotebookConf(client, parsed.notebook, parsed.conf);
    return applyUiRefresh(client, createJsonResult(result), [{ type: 'reloadFiletree' }]);
};

const handleSetIcon: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookSetIconSchema.parse(rawArgs);
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'write');
    if (denied) return denied;
    await notebookApi.setNotebookIcon(client, parsed.notebook, parsed.icon);
    return applyUiRefresh(client, createJsonResult({ success: true, notebook: parsed.notebook, icon: parsed.icon }), [{ type: 'reloadIcon' }]);
};

const handleGetPermissions: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookGetPermissionsSchema.parse(rawArgs);
    await permMgr.reload();
    const listResult = await notebookApi.listNotebooks(client);
    const notebooks = listResult.notebooks.map(nb => ({
        id: nb.id,
        name: nb.name,
        permission: permMgr.get(nb.id),
    }));
    if (!parsed.notebook || parsed.notebook === 'all') {
        return createJsonResult({ notebooks });
    }

    const notebook = notebooks.find((entry) => entry.id === parsed.notebook);
    if (!notebook) {
        return createErrorResult(
            new Error(`Notebook "${parsed.notebook}" not found.`),
            { tool: NOTEBOOK_TOOL_NAME, action: 'get_permissions', rawArgs },
        );
    }

    return createJsonResult({ notebook });
};

const handleSetPermission: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookSetPermissionSchema.parse(rawArgs);
    await permMgr.set(parsed.notebook, parsed.permission);
    return applyUiRefresh(client, createJsonResult({ success: true, notebook: parsed.notebook, permission: parsed.permission }), [{ type: 'reloadFiletree' }]);
};

const handleGetChildDocs: NotebookActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = NotebookGetChildDocsSchema.parse(rawArgs);
    const retryCount = 2;
    const retryDelayMs = 150;
    const denied = await ensurePermissionForNotebook(permMgr, parsed.notebook, 'read');
    if (denied) {
        return denied;
    }
    const notebookList = await notebookApi.listNotebooks(client);
    const notebook = notebookList.notebooks.find((item) => item.id === parsed.notebook);

    if (!notebook) {
        throw normalizeNotebookChildDocsError(new Error('Notebook not found in lsNotebooks result.'), parsed.notebook, false, false);
    }

    const retryResult = await retryNotebookChildDocs(client, parsed.notebook, retryCount, retryDelayMs);
    if (retryResult.error) {
        const normalized = normalizeNotebookChildDocsError(retryResult.error, parsed.notebook, true, Boolean(notebook.closed));
        if (notebook.closed) {
            return createNotebookChildDocsStateErrorResult(parsed.notebook, normalized.message, retryResult.attempts, retryCount * retryDelayMs);
        }
        throw normalized;
    }
    const docs = retryResult.children ?? [];
    const paged = paginate(docs, parsed.page ?? 1, parsed.pageSize ?? 50);
    return createPaginatedResult(paged.items, paged, { notebook: parsed.notebook });
};

export const NOTEBOOK_ACTION_HANDLERS: Record<NotebookAction, NotebookActionHandler> = {
    list: handleList,
    create: handleCreate,
    set_open_state: handleSetOpenState,
    remove: handleRemove,
    rename: handleRename,
    get_conf: handleGetConf,
    set_conf: handleSetConf,
    set_icon: handleSetIcon,
    get_permissions: handleGetPermissions,
    set_permission: handleSetPermission,
    get_child_docs: handleGetChildDocs,
};
