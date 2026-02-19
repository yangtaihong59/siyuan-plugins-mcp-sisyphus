import type { SiYuanClient } from '../../api/client';
import {
    CreateDocSchema,
    RenameDocSchema,
    RenameDocByIDSchema,
    RemoveDocSchema,
    RemoveDocByIDSchema,
    MoveDocsSchema,
    MoveDocsByIDSchema,
    GetDocPathSchema,
    GetHPathByPathSchema,
    GetHPathByIDSchema,
    GetIDsByHPathSchema,
} from '../../mcp/types';
import * as documentApi from '../../api/document';

const DOCUMENT_TOOLS = [
    { name: 'create_document', description: 'Create a new document with markdown content. Returns document ID. Path should start with / and use storage path format (e.g., /foo/bar).', inputSchema: { type: 'object' as const, properties: { notebook: { type: 'string', description: 'Notebook ID' }, path: { type: 'string', description: 'Storage path, must start with / (e.g., /foo/bar)' }, markdown: { type: 'string', description: 'Markdown content' } }, required: ['notebook', 'path', 'markdown'] } },
    { name: 'rename_document', description: 'Rename a document by storage path. Path should be storage path format (e.g., /20210902210113-0avi12f.sy).', inputSchema: { type: 'object' as const, properties: { notebook: { type: 'string', description: 'Notebook ID' }, path: { type: 'string', description: 'Storage path (e.g., /20210902210113-0avi12f.sy)' }, title: { type: 'string', description: 'New document title' } }, required: ['notebook', 'path', 'title'] } },
    { name: 'rename_document_by_id', description: 'Rename a document by document ID', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Document ID' }, title: { type: 'string', description: 'New document title' } }, required: ['id', 'title'] } },
    { name: 'remove_document', description: 'Remove a document by storage path. Path should be storage path format (e.g., /20210902210113-0avi12f.sy).', inputSchema: { type: 'object' as const, properties: { notebook: { type: 'string', description: 'Notebook ID' }, path: { type: 'string', description: 'Storage path (e.g., /20210902210113-0avi12f.sy)' } }, required: ['notebook', 'path'] } },
    { name: 'remove_document_by_id', description: 'Remove a document by document ID', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Document ID' } }, required: ['id'] } },
    { name: 'move_documents', description: 'Move multiple documents to a new location. fromPaths should be storage paths (e.g., /20210902210113-0avi12f.sy).', inputSchema: { type: 'object' as const, properties: { fromPaths: { type: 'array', items: { type: 'string', description: 'Storage paths' } }, toNotebook: { type: 'string', description: 'Target notebook ID' }, toPath: { type: 'string', description: 'Target storage path' } }, required: ['fromPaths', 'toNotebook', 'toPath'] } },
    { name: 'move_documents_by_id', description: 'Move multiple documents by document ID. toID can be a document ID or notebook ID.', inputSchema: { type: 'object' as const, properties: { fromIDs: { type: 'array', items: { type: 'string', description: 'Document IDs' } }, toID: { type: 'string', description: 'Target document ID or notebook ID' } }, required: ['fromIDs', 'toID'] } },
    { name: 'get_document_path', description: 'Get storage path by document ID. Returns notebook ID and storage path.', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Document ID' } }, required: ['id'] } },
    { name: 'get_hpath_by_path', description: 'Get hierarchical (human-readable) path by storage path. Path should be storage path format (e.g., /20210902210113-0avi12f.sy).', inputSchema: { type: 'object' as const, properties: { notebook: { type: 'string', description: 'Notebook ID' }, path: { type: 'string', description: 'Storage path (e.g., /20210902210113-0avi12f.sy)' } }, required: ['notebook', 'path'] } },
    { name: 'get_hpath_by_id', description: 'Get hierarchical (human-readable) path by document ID', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Document ID' } }, required: ['id'] } },
    { name: 'get_ids_by_hpath', description: 'Get document IDs by hierarchical (human-readable) path. Path should be human-readable format (e.g., /foo/bar).', inputSchema: { type: 'object' as const, properties: { path: { type: 'string', description: 'Human-readable path (e.g., /foo/bar)' }, notebook: { type: 'string', description: 'Notebook ID' } }, required: ['path', 'notebook'] } },
];

const DOCUMENT_NAMES = new Set(DOCUMENT_TOOLS.map((t) => t.name));

export function listDocumentTools() {
    return DOCUMENT_TOOLS;
}

export async function callDocumentTool(
    client: SiYuanClient,
    name: string,
    args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
    if (!DOCUMENT_NAMES.has(name)) return null;
    try {
        switch (name) {
            case 'create_document': {
                const parsed = CreateDocSchema.parse(args);
                const docId = await documentApi.createDoc(client, parsed.notebook, parsed.path, parsed.markdown);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, notebook: parsed.notebook, path: parsed.path, id: docId }) }] };
            }
            case 'rename_document': {
                const parsed = RenameDocSchema.parse(args);
                await documentApi.renameDoc(client, parsed.notebook, parsed.path, parsed.title);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, notebook: parsed.notebook, path: parsed.path, title: parsed.title }) }] };
            }
            case 'rename_document_by_id': {
                const parsed = RenameDocByIDSchema.parse(args);
                await documentApi.renameDocByID(client, parsed.id, parsed.title);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: parsed.id, title: parsed.title }) }] };
            }
            case 'remove_document': {
                const parsed = RemoveDocSchema.parse(args);
                await documentApi.removeDoc(client, parsed.notebook, parsed.path);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, notebook: parsed.notebook, path: parsed.path }) }] };
            }
            case 'remove_document_by_id': {
                const parsed = RemoveDocByIDSchema.parse(args);
                await documentApi.removeDocByID(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: parsed.id }) }] };
            }
            case 'move_documents': {
                const parsed = MoveDocsSchema.parse(args);
                await documentApi.moveDocs(client, parsed.fromPaths, parsed.toNotebook, parsed.toPath);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, fromPaths: parsed.fromPaths, toNotebook: parsed.toNotebook, toPath: parsed.toPath }) }] };
            }
            case 'move_documents_by_id': {
                const parsed = MoveDocsByIDSchema.parse(args);
                await documentApi.moveDocsByID(client, parsed.fromIDs, parsed.toID);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, fromIDs: parsed.fromIDs, toID: parsed.toID }) }] };
            }
            case 'get_document_path': {
                const parsed = GetDocPathSchema.parse(args);
                const result = await documentApi.getPathByID(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'get_hpath_by_path': {
                const parsed = GetHPathByPathSchema.parse(args);
                const result = await documentApi.getHPathByPath(client, parsed.notebook, parsed.path);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'get_hpath_by_id': {
                const parsed = GetHPathByIDSchema.parse(args);
                const result = await documentApi.getHPathByID(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'get_ids_by_hpath': {
                const parsed = GetIDsByHPathSchema.parse(args);
                const result = await documentApi.getIDsByHPath(client, parsed.path, parsed.notebook);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            default:
                return null;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorDetails = error instanceof Error && error.stack ? error.stack : String(error);
        return { 
            content: [{ 
                type: 'text', 
                text: JSON.stringify({ 
                    error: errorMessage, 
                    details: errorDetails,
                    tool: name,
                    args: args 
                }, null, 2) 
            }], 
            isError: true 
        };
    }
}
