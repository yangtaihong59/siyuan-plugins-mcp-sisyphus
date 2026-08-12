import { SiYuanClient } from './client';
import type { IReslsNotebooks, IResCreateNotebook, IResGetNotebookConf, IResSetNotebookConf, IReqSetNotebookIcon } from '../types/api';
import type { NotebookConf } from '../types/shared';

/**
 * List all notebooks
 */
export async function listNotebooks(client: SiYuanClient): Promise<IReslsNotebooks> {
    return client.requestRead<IReslsNotebooks>('/api/notebook/lsNotebooks');
}

/**
 * Open a notebook
 */
export async function openNotebook(client: SiYuanClient, notebook: string): Promise<null> {
    return client.requestWrite<null>('/api/notebook/openNotebook', { notebook });
}

/**
 * Close a notebook
 */
export async function closeNotebook(client: SiYuanClient, notebook: string): Promise<null> {
    return client.requestWrite<null>('/api/notebook/closeNotebook', { notebook });
}

/**
 * Create a new notebook
 */
export async function createNotebook(client: SiYuanClient, name: string): Promise<IResCreateNotebook> {
    return client.requestWrite<IResCreateNotebook>('/api/notebook/createNotebook', { name });
}

/**
 * Remove a notebook
 */
export async function removeNotebook(client: SiYuanClient, notebook: string): Promise<null> {
    return client.requestWrite<null>('/api/notebook/removeNotebook', { notebook });
}

/**
 * Rename a notebook
 */
export async function renameNotebook(client: SiYuanClient, notebook: string, name: string): Promise<null> {
    return client.requestWrite<null>('/api/notebook/renameNotebook', { notebook, name });
}

/**
 * Get notebook configuration
 */
export async function getNotebookConf(client: SiYuanClient, notebook: string): Promise<IResGetNotebookConf> {
    return client.requestRead<IResGetNotebookConf>('/api/notebook/getNotebookConf', { notebook });
}

/**
 * Set notebook configuration
 */
export async function setNotebookConf(client: SiYuanClient, notebook: string, conf: Partial<NotebookConf>): Promise<IResSetNotebookConf> {
    return client.requestWrite<IResSetNotebookConf>('/api/notebook/setNotebookConf', { notebook, conf });
}

/**
 * Set notebook icon
 */
export async function setNotebookIcon(client: SiYuanClient, notebook: string, icon: string): Promise<null> {
    return client.requestWrite<null>('/api/notebook/setNotebookIcon', { notebook, icon } as IReqSetNotebookIcon);
}
