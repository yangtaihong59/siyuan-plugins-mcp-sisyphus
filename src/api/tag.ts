import { SiYuanClient } from './client';

export async function listTags(
    client: SiYuanClient,
    options: { sort?: number; ignoreMaxListHint?: boolean; app?: string } = {},
): Promise<unknown> {
    const payload = { ...options, app: options.app || 'siyuan-mcp-sisyphus' };
    return client.requestRead('/api/tag/getTag', payload);
}

export async function renameTag(client: SiYuanClient, oldLabel: string, newLabel: string): Promise<null> {
    return client.requestWrite<null>('/api/tag/renameTag', { oldLabel, newLabel });
}

export async function removeTag(client: SiYuanClient, label: string): Promise<null> {
    return client.requestWrite<null>('/api/tag/removeTag', { label });
}
