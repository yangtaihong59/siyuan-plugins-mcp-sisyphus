import type { SiYuanClient } from './client';

export interface HistorySearchResult {
    histories?: unknown[];
    pageCount?: number;
    totalCount?: number;
    [key: string]: unknown;
}

export interface HistoryItemsResult {
    histories?: unknown[];
    [key: string]: unknown;
}

export interface DocHistoryContent {
    id: string;
    rootID: string;
    content: string;
    isLargeDoc: boolean;
}

export async function searchHistory(
    client: SiYuanClient,
    params: {
        notebook?: string;
        query?: string;
        op?: string;
        page?: number;
    } = {},
): Promise<HistorySearchResult> {
    return client.request<HistorySearchResult>('/api/history/searchHistory', params);
}

export async function getHistoryItems(
    client: SiYuanClient,
    params: {
        created?: string;
        notebook?: string;
        query?: string;
        op?: string;
    },
): Promise<HistoryItemsResult> {
    return client.request<HistoryItemsResult>('/api/history/getHistoryItems', params);
}

export async function getDocHistoryContent(
    client: SiYuanClient,
    historyPath: string,
    keyword = '',
    highlight = false,
): Promise<DocHistoryContent> {
    return client.request<DocHistoryContent>('/api/history/getDocHistoryContent', {
        historyPath,
        keyword,
        highlight,
    });
}

export async function rollbackDocHistory(
    client: SiYuanClient,
    notebook: string,
    historyPath: string,
): Promise<{ box: string }> {
    return client.request<{ box: string }>('/api/history/rollbackDocHistory', { notebook, historyPath });
}
