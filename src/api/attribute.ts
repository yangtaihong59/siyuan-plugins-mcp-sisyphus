import { SiYuanClient } from './client';

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
    return client.request<null>('/api/attr/setBlockAttrs', request);
}

/**
 * Get attributes for a block
 */
export async function getBlockAttrs(client: SiYuanClient, id: string): Promise<Record<string, string>> {
    const request: IReqGetBlockAttrs = { id };
    return client.request<Record<string, string>>('/api/attr/getBlockAttrs', request);
}
