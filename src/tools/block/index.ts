import type { BlockAction } from '../../core/config';
import { BLOCK_ACTION_HINTS, BLOCK_GUIDANCE } from '../../core/help';
import {
    BlockActionSchema,
    BlockAddToDailyNoteSchema,
    BlockAppendSchema,
    BlockBatchKramdownSchema,
    BlockBreadcrumbSchema,
    BlockDeleteSchema,
    BlockDocsInfoSchema,
    BlockDomSchema,
    BlockGetAttrsSchema,
    BlockGetChildrenSchema,
    BlockGetKramdownSchema,
    BlockInfoSchema,
    BlockInsertSchema,
    BlockMoveSchema,
    BlockPrependSchema,
    BlockRecentUpdatedSchema,
    BlockReplaceSchema,
    BlockSetAttrsSchema,
    BlockSetFoldStateSchema,
    BlockTransferReferencesSchema,
    BlockUpdateSchema,
    BlockWordCountSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant } from '../internal/shared';
import { BLOCK_ACTION_HANDLERS } from './handlers';

export const BLOCK_TOOL_NAME = 'block';

export const BLOCK_VARIANTS: ActionVariant<BlockAction>[] = [
    createZodActionVariant('insert', BlockInsertSchema, 'Insert one or more blocks at the specified position.'),
    createZodActionVariant('prepend', BlockPrependSchema, 'Insert a block at the beginning of a parent.'),
    createZodActionVariant('append', BlockAppendSchema, 'Insert a block at the end of a parent.'),
    createZodActionVariant('update', BlockUpdateSchema, 'Update one or more blocks.'),
    createZodActionVariant('replace', BlockReplaceSchema, 'Apply exact old/new text replacement edits inside one block body and patch the original DOM.'),
    createZodActionVariant('delete', BlockDeleteSchema, 'Delete a block by ID.'),
    createZodActionVariant('move', BlockMoveSchema, 'Move a block to a new position.'),
    createZodActionVariant('set_fold_state', BlockSetFoldStateSchema, 'Set the fold state of a foldable block.'),
    createZodActionVariant('get_kramdown', BlockGetKramdownSchema, 'Get block content in kramdown format.'),
    createZodActionVariant('batch_kramdown', BlockBatchKramdownSchema, 'Get kramdown content for up to 20 blocks while preserving input order and per-item errors.'),
    createZodActionVariant('get_children', BlockGetChildrenSchema, 'Get child blocks of a parent with pagination support.'),
    createZodActionVariant('transfer_references', BlockTransferReferencesSchema, 'Transfer block references from one block to another.'),
    createZodActionVariant('set_attrs', BlockSetAttrsSchema, 'Set block attributes.'),
    createZodActionVariant('get_attrs', BlockGetAttrsSchema, 'Get block attributes.'),
    createZodActionVariant('info', BlockInfoSchema, 'Get block position and root document metadata.'),
    createZodActionVariant('breadcrumb', BlockBreadcrumbSchema, 'Get the breadcrumb path for a block.'),
    createZodActionVariant('dom', BlockDomSchema, 'Get rendered DOM for a block.'),
    createZodActionVariant('recent_updated', BlockRecentUpdatedSchema, 'Get recently updated blocks.'),
    createZodActionVariant('word_count', BlockWordCountSchema, 'Get word-count statistics for blocks.'),
    createZodActionVariant('add_to_daily_note', BlockAddToDailyNoteSchema, 'Add a block to today\'s daily note, creating the note if needed.'),
    createZodActionVariant('docs_info', BlockDocsInfoSchema, 'Get document info for one or more documents.'),
];

const blockTool = defineTool<BlockAction>({
    name: 'block',
    description: '🧱 Native structure and metadata by block ID; prefer fs for ordinary Markdown edits. Read get_kramdown before replace: it matches only that block, not children or a heading section. update is best for one block (a table/code block can be multiline); use insert/append/prepend for sibling blocks.',
    variants: BLOCK_VARIANTS,
    actionSchema: BlockActionSchema,
    aggregateOptions: {
        guidance: BLOCK_GUIDANCE,
        actionHints: BLOCK_ACTION_HINTS,
        propertyDescriptionOverrides: {
            parentID: 'Parent block or document ID. With prepend/append, a document ID targets the document head or tail; a block ID targets that block\'s child list.',
            previousID: 'Sibling block ID to place after. For move, give previousID, parentID, or both.',
            ids: 'Block IDs to move as a group, in the desired final order.',
        },
    },
    handlers: BLOCK_ACTION_HANDLERS,
});

export const listBlockTools = blockTool.listTools;
export const callBlockTool = blockTool.callTool;
