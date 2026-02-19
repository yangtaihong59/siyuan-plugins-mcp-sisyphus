import { SiYuanClient } from './client';
import type { Notebook, NotebookConf, IReslsNotebooks, IResCreateNotebook, IResGetNotebookConf, IResSetNotebookConf } from '../types/api';

/**
 * List all notebooks
 */
export async function listNotebooks(client: SiYuanClient): Promise<IReslsNotebooks> {
    return client.request<IReslsNotebooks>('/api/notebook/lsNotebooks');
}

/**
 * Open a notebook
 */
export async function openNotebook(client: SiYuanClient, notebook: string): Promise<null> {
    return client.request<null>('/api/notebook/openNotebook', { notebook });
}

/**
 * Close a notebook
 */
export async function closeNotebook(client: SiYuanClient, notebook: string): Promise<null> {
    return client.request<null>('/api/notebook/closeNotebook', { notebook });
}

/**
 * Create a new notebook
 */
export async function createNotebook(client: SiYuanClient, name: string): Promise<IResCreateNotebook> {
    return client.request<IResCreateNotebook>('/api/notebook/createNotebook', { name });
}

/**
 * Remove a notebook
 */
export async function removeNotebook(client: SiYuanClient, notebook: string): Promise<null> {
    return client.request<null>('/api/notebook/removeNotebook', { notebook });
}

/**
 * Rename a notebook
 */
export async function renameNotebook(client: SiYuanClient, notebook: string, name: string): Promise<null> {
    return client.request<null>('/api/notebook/renameNotebook', { notebook, name });
}

/**
 * Get notebook configuration
 */
export async function getNotebookConf(client: SiYuanClient, notebook: string): Promise<IResGetNotebookConf> {
    return client.request<IResGetNotebookConf>('/api/notebook/getNotebookConf', { notebook });
}

/**
 * Set notebook configuration
 */
export async function setNotebookConf(client: SiYuanClient, notebook: string, conf: NotebookConf): Promise<IResSetNotebookConf> {
    return client.request<IResSetNotebookConf>('/api/notebook/setNotebookConf', { notebook, conf });
}
