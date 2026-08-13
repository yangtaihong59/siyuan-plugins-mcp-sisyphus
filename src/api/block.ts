import { SiYuanClient } from './client';
import type {
    IReqAppendBlock,
    IReqDeleteBlock,
    IReqFoldBlock,
    IReqGetBlockKramdown,
    IReqGetChildBlocks,
    IReqGetDocInfo,
    IReqInsertBlock,
    IReqMoveBlock,
    IReqPrependBlock,
    IReqTransferBlockRef,
    IReqUnfoldBlock,
    IReqUpdateBlock,
    IResGetChildBlock,
    IResGetBlockKramdown,
    IResGetDocInfo,
    IResInsertBlock,
} from '../types/api';
import type { DataType } from '../types/shared';

/**
 * Insert a new block at the specified position
 */
export async function insertBlock(
    client: SiYuanClient,
    dataType: DataType | IReqInsertBlock,
    data?: string,
    nextID?: string,
    previousID?: string,
    parentID?: string
): Promise<IResInsertBlock> {
    const request: IReqInsertBlock = typeof dataType === 'object'
        ? dataType
        : {
            dataType,
            data: data ?? '',
            nextID,
            previousID,
            parentID,
        };
    return client.requestWrite<IResInsertBlock>('/api/block/insertBlock', request);
}

/**
 * Insert a new block at the beginning of the parent block's children
 */
export async function prependBlock(
    client: SiYuanClient,
    dataType: DataType,
    data: string,
    parentID: string
): Promise<IResInsertBlock> {
    const request: IReqPrependBlock = {
        dataType,
        data,
        parentID,
    };
    return client.requestWrite<IResInsertBlock>('/api/block/prependBlock', request);
}

/**
 * Insert a new block at the end of the parent block's children
 */
export async function appendBlock(
    client: SiYuanClient,
    dataType: DataType,
    data: string,
    parentID: string
): Promise<IResInsertBlock> {
    const request: IReqAppendBlock = {
        dataType,
        data,
        parentID,
    };
    return client.requestWrite<IResInsertBlock>('/api/block/appendBlock', request);
}

/**
 * Update an existing block's content
 */
export async function updateBlock(
    client: SiYuanClient,
    dataType: DataType,
    data: string,
    id: string
): Promise<IResInsertBlock> {
    const request: IReqUpdateBlock = {
        dataType,
        data,
        id,
    };
    return client.requestWrite<IResInsertBlock>('/api/block/updateBlock', request);
}

/**
 * Delete a block by ID
 */
export async function deleteBlock(client: SiYuanClient, id: string): Promise<IResInsertBlock> {
    const request: IReqDeleteBlock = { id };
    return client.requestWrite<IResInsertBlock>('/api/block/deleteBlock', request);
}

/**
 * Move a block to a new position
 */
export async function moveBlock(
    client: SiYuanClient,
    id: string,
    previousID?: string,
    parentID?: string
): Promise<IResInsertBlock> {
    const request: IReqMoveBlock = {
        id,
        previousID,
        parentID,
    };
    return client.requestWrite<IResInsertBlock>('/api/block/moveBlock', request);
}

/**
 * Fold a block (collapse its children)
 */
export async function foldBlock(client: SiYuanClient, id: string): Promise<null> {
    const request: IReqFoldBlock = { id };
    return client.requestWrite<null>('/api/block/foldBlock', request);
}

/**
 * Unfold a block (expand its children)
 */
export async function unfoldBlock(client: SiYuanClient, id: string): Promise<null> {
    const request: IReqUnfoldBlock = { id };
    return client.requestWrite<null>('/api/block/unfoldBlock', request);
}

/**
 * Get the kramdown content of a block
 */
export async function getBlockKramdown(client: SiYuanClient, id: string): Promise<IResGetBlockKramdown> {
    const request: IReqGetBlockKramdown = { id };
    return client.requestRead<IResGetBlockKramdown>('/api/block/getBlockKramdown', request);
}

/**
 * Get kramdown content for multiple blocks in one kernel request.
 */
export async function getBlockKramdowns(
    client: SiYuanClient,
    ids: string[],
    mode: 'md' | 'textmark' = 'md',
): Promise<Record<string, string>> {
    return client.requestRead<Record<string, string>>('/api/block/getBlockKramdowns', { ids, mode });
}

/**
 * Get all child blocks of a parent block
 */
export async function getChildBlocks(client: SiYuanClient, id: string): Promise<IResGetChildBlock[]> {
    const request: IReqGetChildBlocks = { id };
    return client.requestRead<IResGetChildBlock[]>('/api/block/getChildBlocks', request);
}

/**
 * Get owning document info for a block or document ID
 */
export async function getDocInfo(client: SiYuanClient, id: string): Promise<IResGetDocInfo> {
    const request: IReqGetDocInfo = { id };
    return client.requestRead<IResGetDocInfo>('/api/block/getDocInfo', request);
}

/**
 * Transfer block references from one block to another
 */
export async function transferBlockRef(
    client: SiYuanClient,
    fromID: string,
    toID: string,
    refIDs?: string[]
): Promise<null> {
    const request: IReqTransferBlockRef = {
        fromID,
        toID,
        refIDs,
    };
    return client.requestWrite<null>('/api/block/transferBlockRef', request);
}

export async function checkBlockExist(client: SiYuanClient, id: string): Promise<boolean> {
    return client.requestRead<boolean>('/api/block/checkBlockExist', { id });
}

export async function getBlockInfo(client: SiYuanClient, id: string): Promise<unknown> {
    return client.requestRead('/api/block/getBlockInfo', { id });
}

export async function getBlockBreadcrumb(
    client: SiYuanClient,
    id: string,
    excludeTypes?: string[],
): Promise<unknown> {
    return client.requestRead('/api/block/getBlockBreadcrumb', { id, excludeTypes });
}

export async function getBlockDOM(client: SiYuanClient, id: string): Promise<{ id: string; dom: string }> {
    return client.requestRead<{ id: string; dom: string }>('/api/block/getBlockDOM', { id });
}

export async function getRecentUpdatedBlocks(client: SiYuanClient): Promise<unknown> {
    return client.requestRead('/api/block/getRecentUpdatedBlocks', {});
}

export async function getBlocksWordCount(client: SiYuanClient, ids: string[]): Promise<unknown> {
    return client.requestRead('/api/block/getBlocksWordCount', { ids });
}

export async function batchInsertBlock(
    client: SiYuanClient,
    blocks: Array<{
        dataType: DataType;
        data: string;
        nextID?: string;
        previousID?: string;
        parentID?: string;
    }>,
): Promise<unknown> {
    return client.requestWrite('/api/block/batchInsertBlock', { blocks });
}

export async function batchUpdateBlock(
    client: SiYuanClient,
    blocks: Array<{
        id: string;
        dataType: DataType;
        data: string;
    }>,
): Promise<unknown> {
    return client.requestWrite('/api/block/batchUpdateBlock', { blocks });
}

export async function appendDailyNoteBlock(
    client: SiYuanClient,
    notebook: string,
    dataType: DataType,
    data: string,
): Promise<unknown> {
    return client.requestWrite('/api/block/appendDailyNoteBlock', { notebook, dataType, data });
}

export async function prependDailyNoteBlock(
    client: SiYuanClient,
    notebook: string,
    dataType: DataType,
    data: string,
): Promise<unknown> {
    return client.requestWrite('/api/block/prependDailyNoteBlock', { notebook, dataType, data });
}

export async function getDocsInfo(
    client: SiYuanClient,
    ids: string[],
    refCount = false,
    av = false,
): Promise<unknown> {
    return client.requestRead('/api/block/getDocsInfo', { ids, refCount, av });
}

// --- Merged from attribute.ts ---

export interface IReqSetBlockAttrs {
    id: string;
    attrs: Record<string, string>;
}

export interface IReqGetBlockAttrs {
    id: string;
}

/**
 * Set attributes for a block
 */
export async function setBlockAttrs(
    client: SiYuanClient,
    id: string,
    attrs: Record<string, string>
): Promise<null> {
    const request: IReqSetBlockAttrs = {
        id,
        attrs,
    };
    return client.requestWrite<null>('/api/attr/setBlockAttrs', request);
}

/**
 * Get attributes for a block
 */
export async function getBlockAttrs(client: SiYuanClient, id: string): Promise<Record<string, string>> {
    const request: IReqGetBlockAttrs = { id };
    return client.requestRead<Record<string, string>>('/api/attr/getBlockAttrs', request);
}
