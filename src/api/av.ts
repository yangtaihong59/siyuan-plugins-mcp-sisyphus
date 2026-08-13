import { SiYuanClient } from './client';

export interface AttributeViewSearchResult {
    [key: string]: unknown;
}

export interface AttributeViewCellValue {
    [key: string]: unknown;
}

export async function getAttributeView(client: SiYuanClient, id: string): Promise<{ av: unknown }> {
    return client.requestRead<{ av: unknown }>('/api/av/getAttributeView', { id });
}

export async function renderAttributeView(
    client: SiYuanClient,
    payload: {
        id: string;
        blockID?: string;
        viewID?: string;
        page?: number;
        pageSize?: number;
        query?: string;
        groupPaging?: Record<string, unknown>;
        createIfNotExist?: boolean;
    },
): Promise<Record<string, unknown>> {
    return client.requestWrite<Record<string, unknown>>('/api/av/renderAttributeView', payload);
}

export async function getAttributeViewKeys(client: SiYuanClient, id: string): Promise<unknown> {
    return client.requestRead<unknown>('/api/av/getAttributeViewKeys', { id });
}

export async function getAttributeViewFilterSort(
    client: SiYuanClient,
    payload: { id: string; blockID?: string },
): Promise<{ filters: unknown; sorts: unknown }> {
    return client.requestRead<{ filters: unknown; sorts: unknown }>('/api/av/getAttributeViewFilterSort', {
        ...payload,
        blockID: payload.blockID ?? '',
    });
}

export async function searchAttributeView(
    client: SiYuanClient,
    keyword: string,
    excludes?: string[],
): Promise<{ results: AttributeViewSearchResult[] }> {
    return client.requestRead<{ results: AttributeViewSearchResult[] }>('/api/av/searchAttributeView', { keyword, excludes });
}

export async function addAttributeViewBlocks(
    client: SiYuanClient,
    payload: {
        avID: string;
        blockID?: string;
        viewID?: string;
        groupID?: string;
        previousID?: string;
        srcs: Array<Record<string, unknown>>;
        ignoreDefaultFill?: boolean;
    },
): Promise<null> {
    return client.requestWrite<null>('/api/av/addAttributeViewBlocks', payload);
}

export async function removeAttributeViewBlocks(
    client: SiYuanClient,
    avID: string,
    srcIDs: string[],
): Promise<null> {
    return client.requestWrite<null>('/api/av/removeAttributeViewBlocks', { avID, srcIDs });
}

export async function addAttributeViewKey(
    client: SiYuanClient,
    payload: {
        avID: string;
        keyID: string;
        keyName: string;
        keyType: string;
        keyIcon?: string;
        previousKeyID?: string;
    },
): Promise<null> {
    return client.requestWrite<null>('/api/av/addAttributeViewKey', {
        keyIcon: '',
        previousKeyID: '',
        ...payload,
    });
}

export async function removeAttributeViewKey(
    client: SiYuanClient,
    avID: string,
    keyID: string,
    removeRelationDest?: boolean,
): Promise<null> {
    return client.requestWrite<null>('/api/av/removeAttributeViewKey', { avID, keyID, removeRelationDest });
}

export async function setAttributeViewBlockAttr(
    client: SiYuanClient,
    payload: {
        avID: string;
        keyID: string;
        itemID: string;
        value: AttributeViewCellValue;
    },
): Promise<{ value: unknown }> {
    return client.requestWrite<{ value: unknown }>('/api/av/setAttributeViewBlockAttr', payload);
}

export async function batchSetAttributeViewBlockAttrs(
    client: SiYuanClient,
    avID: string,
    values: AttributeViewCellValue[],
): Promise<null> {
    return client.requestWrite<null>('/api/av/batchSetAttributeViewBlockAttrs', { avID, values });
}

export async function duplicateAttributeViewBlock(
    client: SiYuanClient,
    avID: string,
): Promise<{ avID: string; blockID: string }> {
    return client.requestWrite<{ avID: string; blockID: string }>('/api/av/duplicateAttributeViewBlock', { avID });
}

export async function spinBlockDOM(
    client: SiYuanClient,
    dom: string,
): Promise<{ dom: string }> {
    return client.requestRead<{ dom: string }>('/api/lute/spinBlockDOM', { dom });
}

export async function getMirrorDatabaseBlocks(
    client: SiYuanClient,
    avID: string,
): Promise<{ refDefs: Array<{ refID?: string; defIDs?: string[] }> }> {
    return client.requestRead<{ refDefs: Array<{ refID?: string; defIDs?: string[] }> }>('/api/av/getMirrorDatabaseBlocks', { avID });
}

export async function getAttributeViewPrimaryKeyValues(
    client: SiYuanClient,
    payload: {
        id: string;
        keyword?: string;
        page?: number;
        pageSize?: number;
    },
): Promise<{ name: string; blockIDs: string[]; rows: any }> {
    return client.requestRead<{ name: string; blockIDs: string[]; rows: any }>('/api/av/getAttributeViewPrimaryKeyValues', payload);
}
