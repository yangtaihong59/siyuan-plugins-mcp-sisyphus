import { SiYuanClient } from './client';
import type { DataType, IReqInsertBlock, IReqPrependBlock, IReqAppendBlock, IReqUpdateBlock, IReqDeleteBlock, IReqMoveBlock, IReqFoldBlock, IReqUnfoldBlock, IReqGetBlockKramdown, IReqGetChildBlocks, IReqTransferBlockRef, IResInsertBlock, IResGetBlockKramdown, IResGetChildBlock } from '../types/api';

/**
 * Insert a new block at the specified position
 */
export async function insertBlock(
    client: SiYuanClient,
    dataType: DataType,
    data: string,
    nextID?: string,
    previousID?: string,
    parentID?: string
): Promise<IResInsertBlock> {
    const request: IReqInsertBlock = {
        dataType,
        data,
        nextID,
        previousID,
        parentID,
    };
    return client.request<IResInsertBlock>('/api/block/insertBlock', request);
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
    return client.request<IResInsertBlock>('/api/block/prependBlock', request);
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
    return client.request<IResInsertBlock>('/api/block/appendBlock', request);
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
    return client.request<IResInsertBlock>('/api/block/updateBlock', request);
}

/**
 * Delete a block by ID
 */
export async function deleteBlock(client: SiYuanClient, id: string): Promise<IResInsertBlock> {
    const request: IReqDeleteBlock = { id };
    return client.request<IResInsertBlock>('/api/block/deleteBlock', request);
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
    return client.request<IResInsertBlock>('/api/block/moveBlock', request);
}

/**
 * Fold a block (collapse its children)
 */
export async function foldBlock(client: SiYuanClient, id: string): Promise<null> {
    const request: IReqFoldBlock = { id };
    return client.request<null>('/api/block/foldBlock', request);
}

/**
 * Unfold a block (expand its children)
 */
export async function unfoldBlock(client: SiYuanClient, id: string): Promise<null> {
    const request: IReqUnfoldBlock = { id };
    return client.request<null>('/api/block/unfoldBlock', request);
}

/**
 * Get the kramdown content of a block
 */
export async function getBlockKramdown(client: SiYuanClient, id: string): Promise<IResGetBlockKramdown> {
    const request: IReqGetBlockKramdown = { id };
    return client.request<IResGetBlockKramdown>('/api/block/getBlockKramdown', request);
}

/**
 * Get all child blocks of a parent block
 */
export async function getChildBlocks(client: SiYuanClient, id: string): Promise<IResGetChildBlock[]> {
    const request: IReqGetChildBlocks = { id };
    return client.request<IResGetChildBlock[]>('/api/block/getChildBlocks', request);
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
    return client.request<null>('/api/block/transferBlockRef', request);
}
