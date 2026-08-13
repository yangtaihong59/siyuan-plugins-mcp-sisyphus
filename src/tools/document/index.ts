import type { SiYuanClient } from '../../api/client';
import type { DocumentAction, CategoryToolConfig } from '../../core/config';
import { DOCUMENT_ACTION_HINTS, DOCUMENT_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    DocumentActionSchema,
    DocumentCreateDailyNoteSchema,
    DocumentCreateSchema,
    DocumentDocToHeadingSchema,
    DocumentDuplicateSchema,
    DocumentGetChildBlocksSchema,
    DocumentGetChildDocsSchema,
    DocumentGetDocSchema,
    DocumentGetOutlineSchema,
    DocumentHeadingToDocSchema,
    DocumentListTreeSchema,
    DocumentLookupSchema,
    DocumentMoveSchema,
    DocumentReorderSchema,
    DocumentRemoveSchema,
    DocumentRenameSchema,
    DocumentSearchDocsSchema,
    DocumentSetAttrSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { DOCUMENT_ACTION_HANDLERS } from './handlers';

export const DOCUMENT_TOOL_NAME = 'document';

export const DOCUMENT_VARIANTS: ActionVariant<DocumentAction>[] = [
    createZodActionVariant('create', DocumentCreateSchema, 'Create a new document. Prefer path for child documents; parentPath + title also accepts a human-readable parent path or a storage path ending in .sy.'),
    createZodActionVariant('lookup', DocumentLookupSchema, 'Look up document IDs, storage paths, human-readable paths, and document metadata from one document reference.'),
    createZodActionVariant('rename', DocumentRenameSchema, 'Rename a document'),
    createZodActionVariant('remove', DocumentRemoveSchema, 'Delete a document'),
    createZodActionVariant('move', DocumentMoveSchema, 'Move a document to another location'),
    createZodActionVariant('reorder', DocumentReorderSchema, 'Apply a complete manual order to all visible direct child documents and enable custom sorting.'),
    createZodActionVariant('get_child_blocks', DocumentGetChildBlocksSchema, 'Get top-level blocks of a document'),
    createZodActionVariant('get_child_docs', DocumentGetChildDocsSchema, 'Get child documents'),
    createZodActionVariant('set_attr', DocumentSetAttrSchema, 'Set document metadata such as icon and cover image.'),
    createZodActionVariant('list_tree', DocumentListTreeSchema, 'Get document tree'),
    createZodActionVariant('search_docs', DocumentSearchDocsSchema, 'Search documents by title'),
    createZodActionVariant('get_doc', DocumentGetDocSchema, 'Read document Markdown in complete block windows, or return the current HTML view.'),
    createZodActionVariant('get_outline', DocumentGetOutlineSchema, 'Get the native SiYuan heading tree for a document without reading its body.'),
    createZodActionVariant('create_daily_note', DocumentCreateDailyNoteSchema, 'Create or open today\'s daily note'),
    createZodActionVariant('duplicate', DocumentDuplicateSchema, 'Duplicate a document'),
    createZodActionVariant('heading_to_doc', DocumentHeadingToDocSchema, 'Convert a heading to a separate document'),
    createZodActionVariant('doc_to_heading', DocumentDocToHeadingSchema, 'Merge a document into another as a heading'),
];

const documentTool = defineTool<DocumentAction>({
    name: 'document',
    description: '📝 Grouped document operations.',
    variants: DOCUMENT_VARIANTS,
    actionSchema: DocumentActionSchema,
    aggregateOptions: {
        guidance: DOCUMENT_GUIDANCE,
        actionHints: DOCUMENT_ACTION_HINTS,
        propertyDescriptionOverrides: {
            path: 'Path value. For action="create", use a human-readable target path such as /Inbox/Weekly Note. For action="lookup" and path-based rename/remove/move, use a storage path returned by document(action="lookup", id=..., include=["path"]); use hpath for human-readable lookup.',
            parentPath: 'Parent path for title-based creation. Accepts a human-readable parent path such as /Inbox or a storage path ending in .sy returned by document(action="lookup").',
            fromPaths: 'Source storage paths returned by document(action="lookup").',
            toPath: 'Target storage path. Use the storage path of an existing destination document returned by document(action="lookup").',
        },
    },
    handlers: DOCUMENT_ACTION_HANDLERS,
});

export function listDocumentTools(config: CategoryToolConfig<DocumentAction>) {
    return documentTool.listTools(config);
}

export async function callDocumentTool(
    client: SiYuanClient,
    args: Record<string, unknown> | undefined,
    config: CategoryToolConfig<DocumentAction>,
    permMgr: PermissionManager,
): Promise<ToolResult> {
    return documentTool.callTool(client, args, config, permMgr);
}
