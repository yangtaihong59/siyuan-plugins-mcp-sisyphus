import type { SiYuanClient } from './client';

export interface RepoSnapshot {
    id: string;
    memo?: string;
    tag?: string;
    created?: string;
    updated?: string;
    hCreated?: string;
    size?: number;
    count?: number;
    [key: string]: unknown;
}

export interface RepoSnapshotsResult {
    snapshots: RepoSnapshot[];
    pageCount: number;
    totalCount: number;
}

export interface RepoSnapshotFileChange {
    id?: string;
    fileID?: string;
    path?: string;
    title?: string;
    name?: string;
    hash?: string;
    hSize?: string;
    updated?: string;
    [key: string]: unknown;
}

export interface RepoSnapshotDiffResult {
    addsLeft?: RepoSnapshotFileChange[];
    updatesLeft?: RepoSnapshotFileChange[];
    updatesRight?: RepoSnapshotFileChange[];
    removesRight?: RepoSnapshotFileChange[];
    left?: unknown;
    right?: unknown;
    leftIndex?: unknown;
    rightIndex?: unknown;
}

export interface RepoSnapshotFileContent {
    title: string;
    content: string;
    displayInText: boolean;
    updated: string;
}

export async function createSnapshot(client: SiYuanClient, memo = ''): Promise<unknown> {
    return client.request('/api/repo/createSnapshot', { memo });
}

export async function tagSnapshot(client: SiYuanClient, id: string, name = ''): Promise<unknown> {
    return client.request('/api/repo/tagSnapshot', { id, name });
}

export async function getRepoSnapshots(client: SiYuanClient, page = 1): Promise<RepoSnapshotsResult> {
    return client.request<RepoSnapshotsResult>('/api/repo/getRepoSnapshots', { page });
}

export async function getRepoTagSnapshots(client: SiYuanClient): Promise<{ snapshots: RepoSnapshot[] }> {
    return client.request<{ snapshots: RepoSnapshot[] }>('/api/repo/getRepoTagSnapshots', {});
}

export async function removeRepoTagSnapshot(client: SiYuanClient, tag: string): Promise<unknown> {
    return client.request('/api/repo/removeRepoTagSnapshot', { tag });
}

export async function diffRepoSnapshots(
    client: SiYuanClient,
    left: string,
    right: string,
): Promise<RepoSnapshotDiffResult> {
    return client.request<RepoSnapshotDiffResult>('/api/repo/diffRepoSnapshots', { left, right });
}

export async function openRepoSnapshotFile(client: SiYuanClient, id: string): Promise<RepoSnapshotFileContent> {
    return client.request<RepoSnapshotFileContent>('/api/repo/openRepoSnapshotFile', { id });
}

export async function rollbackRepoSnapshotFile(client: SiYuanClient, id: string): Promise<unknown> {
    return client.request('/api/repo/rollbackRepoSnapshotFile', { id });
}
