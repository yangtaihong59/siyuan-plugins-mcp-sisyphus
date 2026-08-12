import type { SiYuanClient } from './client';
import type {
    IReqExportMdContent,
    IReqExportResources,
    IResExportMdContent,
    IResExportResources,
} from '../types/api';

/**
 * Upload an asset file to the specified assets directory
 */
export async function uploadAsset(
    client: SiYuanClient,
    assetsDirPath: string,
    fileContent: Uint8Array,
    fileName: string,
): Promise<{ errFiles: string[]; succMap: { [key: string]: string } }> {
    const formData = new FormData();
    const file = new File([fileContent as Uint8Array<ArrayBuffer>], fileName);
    formData.append('assetsDirPath', assetsDirPath);
    formData.append('file[]', file, fileName);
    return client.requestFormDataWrite<{ errFiles: string[]; succMap: { [key: string]: string } }>('/api/asset/upload', formData);
}

/**
 * Export document content as Markdown
 */
export async function exportMdContent(
    client: SiYuanClient,
    id: string
): Promise<IResExportMdContent> {
    const request: IReqExportMdContent = {
        id,
    };
    return client.requestRead<IResExportMdContent>('/api/export/exportMdContent', request);
}

/**
 * Export resources (files) as a ZIP archive
 */
export async function exportResources(
    client: SiYuanClient,
    paths: string[],
    name?: string
): Promise<IResExportResources> {
    const request: IReqExportResources = {
        paths,
        name,
    };
    return client.requestRead<IResExportResources>('/api/export/exportResources', request);
}

export async function getUnusedAssets(client: SiYuanClient): Promise<unknown> {
    return client.requestRead('/api/asset/getUnusedAssets', {});
}

export async function getDocAssets(client: SiYuanClient, id: string): Promise<unknown> {
    return client.requestRead('/api/asset/getDocAssets', { id });
}

export async function getDocImageAssets(client: SiYuanClient, id: string): Promise<unknown> {
    return client.requestRead('/api/asset/getDocImageAssets', { id });
}

export async function getImageOCRText(client: SiYuanClient, path?: string): Promise<{ text: string }> {
    return client.requestRead<{ text: string }>('/api/asset/getImageOCRText', path ? { path } : {});
}

export async function removeUnusedAssets(client: SiYuanClient): Promise<unknown> {
    return client.requestWrite('/api/asset/removeUnusedAssets', {});
}

export async function renameAsset(
    client: SiYuanClient,
    oldPath: string,
    newName: string,
): Promise<{ newPath?: string }> {
    return client.requestWrite('/api/asset/renameAsset', { oldPath, newName });
}

export async function deleteAsset(
    client: SiYuanClient,
    path: string,
): Promise<unknown> {
    return client.requestWrite('/api/asset/removeUnusedAsset', { path });
}

export async function setImageAlpha(
    client: SiYuanClient,
    path: string,
    alpha: number,
): Promise<unknown> {
    return client.requestWrite('/api/asset/setImageAlpha', { path, alpha });
}
