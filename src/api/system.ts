import type { SiYuanClient } from './client';

export async function getWorkspaceInfo(client: SiYuanClient): Promise<unknown> {
    return client.requestRead('/api/system/getWorkspaceInfo', {});
}

export async function getNetwork(client: SiYuanClient): Promise<unknown> {
    return client.requestRead('/api/system/getNetwork', {});
}

export async function getChangelog(client: SiYuanClient): Promise<unknown> {
    return client.requestRead('/api/system/getChangelog', {});
}

export async function getConf(client: SiYuanClient): Promise<unknown> {
    return client.requestRead('/api/system/getConf', {});
}

export async function getSysFonts(client: SiYuanClient): Promise<unknown> {
    return client.requestRead('/api/system/getSysFonts', {});
}

export async function getBootProgress(client: SiYuanClient): Promise<{ progress: number; details: string }> {
    return client.requestRead<{ progress: number; details: string }>('/api/system/bootProgress', {});
}

export async function performSync(client: SiYuanClient): Promise<unknown> {
    return client.requestWrite('/api/sync/performSync', {});
}

export async function getVersion(client: SiYuanClient): Promise<string> {
    return client.requestRead<string>('/api/system/version');
}

export async function getCurrentTime(client: SiYuanClient): Promise<number> {
    return client.requestRead<number>('/api/system/currentTime');
}

export async function reloadUI(client: SiYuanClient): Promise<null> {
    return client.requestWrite<null>('/api/ui/reloadUI', {});
}

export async function reloadIcon(client: SiYuanClient): Promise<null> {
    return client.requestWrite<null>('/api/ui/reloadIcon', {});
}

export async function reloadFiletree(client: SiYuanClient): Promise<null> {
    return client.requestWrite<null>('/api/ui/reloadFiletree', {});
}

export async function reloadProtyle(client: SiYuanClient, id: string): Promise<null> {
    return client.requestWrite<null>('/api/ui/reloadProtyle', { id });
}

export async function reloadAttributeView(client: SiYuanClient, id: string): Promise<null> {
    return client.requestWrite<null>('/api/ui/reloadAttributeView', { id });
}

export async function reloadTag(client: SiYuanClient): Promise<null> {
    return client.requestWrite<null>('/api/ui/reloadTag', {});
}
