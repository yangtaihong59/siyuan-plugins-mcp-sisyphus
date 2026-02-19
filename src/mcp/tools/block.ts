import type { SiYuanClient } from '../../api/client';
import {
    InsertBlockSchema,
    PrependBlockSchema,
    AppendBlockSchema,
    UpdateBlockSchema,
    DeleteBlockSchema,
    MoveBlockSchema,
    FoldBlockSchema,
    UnfoldBlockSchema,
    GetBlockKramdownSchema,
    GetChildBlocksSchema,
    TransferBlockRefSchema,
    SetBlockAttrsSchema,
    GetBlockAttrsSchema,
} from '../../mcp/types';
import * as blockApi from '../../api/block';
import * as attributeApi from '../../api/attribute';

const BLOCK_TOOLS = [
    { name: 'insert_block', description: 'Insert a new block at the specified position. Returns block ID in result.action.id. Note: Document ID can be used as block ID (document root block).', inputSchema: { type: 'object' as const, properties: { dataType: { type: 'string', enum: ['markdown', 'dom'], description: 'Data format' }, data: { type: 'string', description: 'Block content' }, nextID: { type: 'string', description: 'Next block ID (optional)' }, previousID: { type: 'string', description: 'Previous block ID (optional)' }, parentID: { type: 'string', description: 'Parent block ID (optional)' } }, required: ['dataType', 'data'] } },
    { name: 'prepend_block', description: 'Insert a block at the beginning of the parent\'s children. Returns block ID in result.action.id. parentID can be a document ID (document root block).', inputSchema: { type: 'object' as const, properties: { dataType: { type: 'string', enum: ['markdown', 'dom'], description: 'Data format' }, data: { type: 'string', description: 'Block content' }, parentID: { type: 'string', description: 'Parent block ID (document ID can be used)' } }, required: ['dataType', 'data', 'parentID'] } },
    { name: 'append_block', description: 'Insert a block at the end of the parent\'s children. Returns block ID in result.action.id. parentID can be a document ID (document root block).', inputSchema: { type: 'object' as const, properties: { dataType: { type: 'string', enum: ['markdown', 'dom'], description: 'Data format' }, data: { type: 'string', description: 'Block content' }, parentID: { type: 'string', description: 'Parent block ID (document ID can be used)' } }, required: ['dataType', 'data', 'parentID'] } },
    { name: 'update_block', description: 'Update an existing block\'s content. id should be a block ID (not document ID). Document root blocks may have limitations.', inputSchema: { type: 'object' as const, properties: { dataType: { type: 'string', enum: ['markdown', 'dom'], description: 'Data format' }, data: { type: 'string', description: 'New block content' }, id: { type: 'string', description: 'Block ID (not document ID)' } }, required: ['dataType', 'data', 'id'] } },
    { name: 'delete_block', description: 'Delete a block by block ID. Note: Cannot delete document root blocks.', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Block ID' } }, required: ['id'] } },
    { name: 'move_block', description: 'Move a block to a new position. id should be a block ID (not document ID).', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Block ID to move' }, previousID: { type: 'string', description: 'Previous block ID (optional)' }, parentID: { type: 'string', description: 'New parent block ID (optional)' } }, required: ['id'] } },
    { name: 'fold_block', description: 'Fold a block (collapse its children). id can be a document ID (document root block) or block ID.', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Block ID or document ID' } }, required: ['id'] } },
    { name: 'unfold_block', description: 'Unfold a block (expand its children). id can be a document ID (document root block) or block ID.', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Block ID or document ID' } }, required: ['id'] } },
    { name: 'get_block_kramdown', description: 'Get the kramdown content of a block. id can be a document ID (document root block) or block ID.', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Block ID or document ID' } }, required: ['id'] } },
    { name: 'get_child_blocks', description: 'Get all child blocks of a parent block. id can be a document ID (document root block) or block ID.', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Block ID or document ID' } }, required: ['id'] } },
    { name: 'transfer_block_ref', description: 'Transfer block references from one block to another. Both fromID and toID should be block IDs.', inputSchema: { type: 'object' as const, properties: { fromID: { type: 'string', description: 'Source block ID' }, toID: { type: 'string', description: 'Target block ID' }, refIDs: { type: 'array', items: { type: 'string', description: 'Reference block IDs' } } }, required: ['fromID', 'toID'] } },
    { name: 'set_block_attrs', description: 'Set attributes for a block. id should be a block ID (not document ID).', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Block ID' }, attrs: { type: 'object', additionalProperties: { type: 'string' }, description: 'Attributes object' } }, required: ['id', 'attrs'] } },
    { name: 'get_block_attrs', description: 'Get attributes for a block. id should be a block ID (not document ID).', inputSchema: { type: 'object' as const, properties: { id: { type: 'string', description: 'Block ID' } }, required: ['id'] } },
];

const BLOCK_NAMES = new Set(BLOCK_TOOLS.map((t) => t.name));

export function listBlockTools() {
    return BLOCK_TOOLS;
}

export async function callBlockTool(
    client: SiYuanClient,
    name: string,
    args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
    if (!BLOCK_NAMES.has(name)) return null;
    try {
        switch (name) {
            case 'insert_block': {
                const parsed = InsertBlockSchema.parse(args);
                const result = await blockApi.insertBlock(client, parsed.dataType, parsed.data, parsed.nextID, parsed.previousID, parsed.parentID);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'prepend_block': {
                const parsed = PrependBlockSchema.parse(args);
                const result = await blockApi.prependBlock(client, parsed.dataType, parsed.data, parsed.parentID);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'append_block': {
                const parsed = AppendBlockSchema.parse(args);
                const result = await blockApi.appendBlock(client, parsed.dataType, parsed.data, parsed.parentID);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'update_block': {
                const parsed = UpdateBlockSchema.parse(args);
                const result = await blockApi.updateBlock(client, parsed.dataType, parsed.data, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'delete_block': {
                const parsed = DeleteBlockSchema.parse(args);
                await blockApi.deleteBlock(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: parsed.id }) }] };
            }
            case 'move_block': {
                const parsed = MoveBlockSchema.parse(args);
                const result = await blockApi.moveBlock(client, parsed.id, parsed.previousID, parsed.parentID);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'fold_block': {
                const parsed = FoldBlockSchema.parse(args);
                await blockApi.foldBlock(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: parsed.id }) }] };
            }
            case 'unfold_block': {
                const parsed = UnfoldBlockSchema.parse(args);
                await blockApi.unfoldBlock(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: parsed.id }) }] };
            }
            case 'get_block_kramdown': {
                const parsed = GetBlockKramdownSchema.parse(args);
                const result = await blockApi.getBlockKramdown(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'get_child_blocks': {
                const parsed = GetChildBlocksSchema.parse(args);
                const result = await blockApi.getChildBlocks(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'transfer_block_ref': {
                const parsed = TransferBlockRefSchema.parse(args);
                await blockApi.transferBlockRef(client, parsed.fromID, parsed.toID, parsed.refIDs);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, fromID: parsed.fromID, toID: parsed.toID }) }] };
            }
            case 'set_block_attrs': {
                const parsed = SetBlockAttrsSchema.parse(args);
                await attributeApi.setBlockAttrs(client, parsed.id, parsed.attrs);
                return { content: [{ type: 'text', text: JSON.stringify({ success: true, id: parsed.id, attrs: parsed.attrs }) }] };
            }
            case 'get_block_attrs': {
                const parsed = GetBlockAttrsSchema.parse(args);
                const result = await attributeApi.getBlockAttrs(client, parsed.id);
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
