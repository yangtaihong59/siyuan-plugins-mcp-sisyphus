import type { SiYuanClient } from '../../api/client';
import {
    ListNotebooksSchema,
    OpenNotebookSchema,
    CloseNotebookSchema,
    CreateNotebookSchema,
    RemoveNotebookSchema,
    RenameNotebookSchema,
    GetNotebookConfSchema,
    SetNotebookConfSchema,
} from '../../mcp/types';
import * as notebookApi from '../../api/notebook';

const NOTEBOOK_TOOLS = [
        { name: 'list_notebooks', description: 'List all notebooks in the workspace', inputSchema: { type: 'object', properties: {} } },
        { name: 'create_notebook', description: 'Create a new notebook', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Notebook name' } }, required: ['name'] } },
        { name: 'open_notebook', description: 'Open a notebook', inputSchema: { type: 'object', properties: { notebook: { type: 'string', description: 'Notebook ID' } }, required: ['notebook'] } },
        { name: 'close_notebook', description: 'Close a notebook', inputSchema: { type: 'object', properties: { notebook: { type: 'string', description: 'Notebook ID' } }, required: ['notebook'] } },
        { name: 'remove_notebook', description: 'Remove a notebook', inputSchema: { type: 'object', properties: { notebook: { type: 'string', description: 'Notebook ID' } }, required: ['notebook'] } },
        { name: 'rename_notebook', description: 'Rename a notebook', inputSchema: { type: 'object', properties: { notebook: { type: 'string', description: 'Notebook ID' }, name: { type: 'string', description: 'New notebook name' } }, required: ['notebook', 'name'] } },
        { name: 'get_notebook_conf', description: 'Get notebook configuration', inputSchema: { type: 'object', properties: { notebook: { type: 'string', description: 'Notebook ID' } }, required: ['notebook'] } },
        { name: 'set_notebook_conf', description: 'Set notebook configuration', inputSchema: { type: 'object', properties: { notebook: { type: 'string', description: 'Notebook ID' }, conf: { type: 'object', properties: { name: { type: 'string' }, closed: { type: 'boolean' }, refCreateSavePath: { type: 'string' }, createDocNameTemplate: { type: 'string' }, dailyNoteSavePath: { type: 'string' }, dailyNoteTemplatePath: { type: 'string' } } } }, required: ['notebook', 'conf'] } },
];

const NOTEBOOK_NAMES = new Set(NOTEBOOK_TOOLS.map((t) => t.name));

export function listNotebookTools() {
    return NOTEBOOK_TOOLS;
}

export async function callNotebookTool(
    client: SiYuanClient,
    name: string,
    args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
    if (!NOTEBOOK_NAMES.has(name)) return null;
    try {
        switch (name) {
            case 'list_notebooks': {
                ListNotebooksSchema.parse(args);
                const result = await notebookApi.listNotebooks(client);
                return { content: [{ type: 'text', text: JSON.stringify(result.notebooks, null, 2) }] };
            }
            case 'create_notebook': {
                const parsed = CreateNotebookSchema.parse(args);
                const result = await notebookApi.createNotebook(client, parsed.name);
                return { content: [{ type: 'text', text: JSON.stringify(result.notebook, null, 2) }] };
            }
            case 'open_notebook': {
                const parsed = OpenNotebookSchema.parse(args);
                await notebookApi.openNotebook(client, parsed.notebook);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, notebook: parsed.notebook }) }] };
            }
            case 'close_notebook': {
                const parsed = CloseNotebookSchema.parse(args);
                await notebookApi.closeNotebook(client, parsed.notebook);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, notebook: parsed.notebook }) }] };
            }
            case 'remove_notebook': {
                const parsed = RemoveNotebookSchema.parse(args);
                await notebookApi.removeNotebook(client, parsed.notebook);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, notebook: parsed.notebook }) }] };
            }
            case 'rename_notebook': {
                const parsed = RenameNotebookSchema.parse(args);
                await notebookApi.renameNotebook(client, parsed.notebook, parsed.name);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, notebook: parsed.notebook, name: parsed.name }) }] };
            }
            case 'get_notebook_conf': {
                const parsed = GetNotebookConfSchema.parse(args);
                const result = await notebookApi.getNotebookConf(client, parsed.notebook);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'set_notebook_conf': {
                const parsed = SetNotebookConfSchema.parse(args);
                const result = await notebookApi.setNotebookConf(client, parsed.notebook, parsed.conf);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            default:
                return null;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error: ${errorMessage}` }], isError: true };
    }
}
