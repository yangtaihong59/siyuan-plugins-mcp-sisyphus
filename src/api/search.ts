import { SiYuanClient } from './client';
import type {
    IReqFullTextSearchBlock,
    IReqSemanticSearchBlock,
    IReqGetBacklinkDoc,
    IReqGetBackmentionDoc,
    IReqQuerySQL,
    IReqSearchTag,
    IResFullTextSearchBlock,
    IResGetBacklinkDoc,
    IResGetBackmentionDoc,
    IResSearchTag,
} from '../types/api';

export async function fullTextSearchBlock(
    client: SiYuanClient,
    params: IReqFullTextSearchBlock,
): Promise<IResFullTextSearchBlock> {
    return client.requestRead<IResFullTextSearchBlock>('/api/search/fullTextSearchBlock', params);
}

export async function semanticSearchBlock(
    client: SiYuanClient,
    params: IReqSemanticSearchBlock,
): Promise<IResFullTextSearchBlock> {
    return client.requestRead<IResFullTextSearchBlock>('/api/search/semanticSearchBlock', params);
}

export async function querySQL(client: SiYuanClient, stmt: string): Promise<unknown[]> {
    const request: IReqQuerySQL = { stmt };
    const result = await client.requestRead<unknown[] | null>('/api/query/sql', request);
    return Array.isArray(result) ? result : [];
}

export async function searchTag(client: SiYuanClient, k: string): Promise<IResSearchTag> {
    const request: IReqSearchTag = { k };
    return client.requestRead<IResSearchTag>('/api/search/searchTag', request);
}

export async function getBacklinkDoc(
    client: SiYuanClient,
    defID: string,
    keyword?: string,
    refTreeID?: string,
): Promise<IResGetBacklinkDoc | null> {
    const request: IReqGetBacklinkDoc = { defID, keyword, refTreeID };
    return client.requestRead<IResGetBacklinkDoc | null>('/api/ref/getBacklinkDoc', request);
}

export async function getBackmentionDoc(
    client: SiYuanClient,
    defID: string,
    keyword?: string,
    refTreeID?: string,
): Promise<IResGetBackmentionDoc | null> {
    const request: IReqGetBackmentionDoc = { defID, keyword, refTreeID };
    return client.requestRead<IResGetBackmentionDoc | null>('/api/ref/getBackmentionDoc', request);
}

export async function searchRefBlock(
    client: SiYuanClient,
    params: {
        id: string;
        rootID?: string;
        k?: string;
        beforeLen?: number;
        isSquareBrackets?: boolean;
        isDatabase?: boolean;
        reqId?: string;
    },
): Promise<unknown> {
    return client.requestRead('/api/search/searchRefBlock', {
        reqId: params.reqId,
        id: params.id,
        rootID: params.rootID ?? '',
        k: params.k ?? '',
        beforeLen: params.beforeLen ?? 512,
        isSquareBrackets: params.isSquareBrackets ?? false,
        isDatabase: params.isDatabase ?? false,
    });
}

export async function findReplace(
    client: SiYuanClient,
    params: {
        k: string;
        r: string;
        ids: string[];
        paths?: string[];
        types?: Record<string, boolean>;
        method?: number;
        orderBy?: number;
        groupBy?: number;
        replaceTypes?: Record<string, boolean>;
    },
): Promise<null> {
    return client.requestWrite<null>('/api/search/findReplace', params);
}

export async function searchAsset(
    client: SiYuanClient,
    k: string,
    exts?: string[],
): Promise<unknown> {
    return client.requestRead('/api/search/searchAsset', { k, exts });
}

export async function getAssetContent(
    client: SiYuanClient,
    id: string,
    query: string,
    queryMethod = 0,
): Promise<unknown> {
    return client.requestRead('/api/search/getAssetContent', { id, query, queryMethod });
}

export async function fullTextSearchAssetContent(
    client: SiYuanClient,
    params: {
        query: string;
        types?: Record<string, boolean>;
        method?: number;
        orderBy?: number;
        page?: number;
        pageSize?: number;
    },
): Promise<unknown> {
    return client.requestRead('/api/search/fullTextSearchAssetContent', params);
}

export async function listInvalidBlockRefs(
    client: SiYuanClient,
    page?: number,
    pageSize?: number,
): Promise<unknown> {
    return client.requestRead('/api/search/listInvalidBlockRefs', { page, pageSize });
}
