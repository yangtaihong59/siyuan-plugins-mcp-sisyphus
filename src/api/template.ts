import type { SiYuanClient } from './client';
import type {
    IReqDocSaveAsTemplate,
    IReqRenderTemplate,
    IReqRenderSprig,
    IReqSearchTemplates,
    IResGetTemplates,
    IResSearchTemplates,
} from '../types/api';

export interface TemplateSourceResult {
    path: string;
    relativePath: string;
    markdown: string;
}

export interface TemplatePathResult {
    path: string;
    relativePath: string;
}

export interface TemplateSearchItem {
    path: string;
    content: string;
    relativePath: string;
}

export interface TemplateWriteResult extends TemplatePathResult {
    totalChars: number;
}

export interface TemplateSaveDocResult {
    id: string;
    name: string;
    relativePath: string;
}

export interface NormalizedTemplatePath {
    path: string;
    relativePath: string;
    staticPath: string;
    workspacePath: string;
}

function createTemplatePathError(message: string): Error {
    const error = new Error(message);
    (error as Error & { reason?: string }).reason = 'invalid_template_path';
    return error;
}

function normalizeTemplateRelativePath(input: string): string {
    const raw = input.trim();
    if (!raw) {
        throw createTemplatePathError('Template path is required.');
    }
    if (/[\0?#]/.test(raw)) {
        throw createTemplatePathError('Template path must not contain null bytes, query strings, or hash fragments.');
    }

    const normalized = raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    const lower = normalized.toLowerCase();
    const dataTemplatesMarker = '/data/templates/';
    const dataTemplatesIndex = lower.lastIndexOf(dataTemplatesMarker);

    let relativePath: string;
    if (dataTemplatesIndex >= 0) {
        relativePath = normalized.slice(dataTemplatesIndex + dataTemplatesMarker.length);
    } else {
        const withoutLeadingSlash = normalized.replace(/^\/+/, '');
        const lowerWithoutLeadingSlash = withoutLeadingSlash.toLowerCase();
        if (lowerWithoutLeadingSlash.startsWith('data/templates/')) {
            relativePath = withoutLeadingSlash.slice('data/templates/'.length);
        } else if (lowerWithoutLeadingSlash.startsWith('templates/')) {
            relativePath = withoutLeadingSlash.slice('templates/'.length);
        } else if (/^[a-z]:\//i.test(normalized)) {
            throw createTemplatePathError('Template path must be inside data/templates; arbitrary drive paths are not allowed.');
        } else if (!normalized.startsWith('/')) {
            relativePath = withoutLeadingSlash;
        } else {
            throw createTemplatePathError('Template path must be inside data/templates or use the /templates/ static route.');
        }
    }

    relativePath = relativePath.replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    const segments = relativePath.split('/');
    if (
        segments.length === 0
        || segments.some((segment) => !segment || segment === '.' || segment === '..')
        || relativePath.startsWith('../')
        || relativePath.includes('/../')
        || relativePath.includes(':')
    ) {
        throw createTemplatePathError('Template path must not traverse directories.');
    }
    if (!relativePath.toLowerCase().endsWith('.md')) {
        throw createTemplatePathError('Template source reading only supports Markdown .md files.');
    }
    return relativePath;
}

export function normalizeTemplatePath(input: string): NormalizedTemplatePath {
    const relativePath = normalizeTemplateRelativePath(input);
    const staticPath = `/templates/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
    return {
        path: input.trim().replace(/\\/g, '/'),
        relativePath,
        staticPath,
        workspacePath: `/data/templates/${relativePath}`,
    };
}

function createTemplateError(message: string, reason: string): Error {
    const error = new Error(message);
    (error as Error & { reason?: string }).reason = reason;
    return error;
}

function normalizeTemplateName(input: string): string {
    const raw = input.trim().replace(/\.md$/i, '');
    if (!raw) {
        throw createTemplateError('Template name is required.', 'invalid_template_name');
    }
    if (/[\0?#/\\:]/.test(raw) || raw === '.' || raw === '..') {
        throw createTemplateError('Template name must be a root template name without slashes, drive markers, query strings, or hash fragments.', 'invalid_template_name');
    }
    return raw;
}

function templateQueryFromRelativePath(relativePath: string): string {
    return relativePath.replace(/\.md$/i, '');
}

function toTemplateSearchItem(item: { path: string; content: string }): TemplateSearchItem | null {
    try {
        const normalized = normalizeTemplatePath(item.path);
        return {
            path: item.path,
            content: item.content,
            relativePath: normalized.relativePath,
        };
    } catch {
        return null;
    }
}

/**
 * Search workspace templates through the same kernel endpoint used by SiYuan's template picker.
 */
export async function searchTemplates(
    client: SiYuanClient,
    query = '',
): Promise<IResSearchTemplates> {
    const request: IReqSearchTemplates = { k: query };
    const result = await client.requestRead<IResSearchTemplates>('/api/search/searchTemplate', request);
    return {
        templates: Array.isArray(result?.templates) ? result.templates : [],
        k: typeof result?.k === 'string' ? result.k : query,
    };
}

/**
 * Resolve a template path to the exact workspace path returned by SiYuan's template picker.
 */
export async function resolveTemplate(
    client: SiYuanClient,
    path: string,
): Promise<TemplateSearchItem> {
    const normalized = normalizeTemplatePath(path);
    const queries = [...new Set([templateQueryFromRelativePath(normalized.relativePath), ''])];

    for (const query of queries) {
        const result = await searchTemplates(client, query);
        const match = result.templates
            .map(toTemplateSearchItem)
            .find((item): item is TemplateSearchItem => Boolean(item) && item.relativePath === normalized.relativePath);
        if (match) {
            return match;
        }
    }

    throw createTemplateError(`Template not found: ${normalized.relativePath}`, 'template_not_found');
}

/**
 * Render a template by ID or path
 */
export async function renderTemplate(
    client: SiYuanClient,
    id: string,
    path: string,
    preview?: boolean,
): Promise<IResGetTemplates> {
    const request: IReqRenderTemplate = {
        id,
        path,
        ...(preview !== undefined ? { preview } : {}),
    };
    return client.requestRead<IResGetTemplates>('/api/template/render', request);
}

/**
 * Render a Sprig template
 */
export async function renderSprig(
    client: SiYuanClient,
    template: string
): Promise<string> {
    const request: IReqRenderSprig = {
        template,
    };
    return client.requestRead<string>('/api/template/renderSprig', request);
}

/**
 * Write a Markdown template source through SiYuan's workspace file API.
 */
export async function writeTemplateSource(
    client: SiYuanClient,
    path: string,
    markdown: string,
): Promise<TemplateWriteResult> {
    const normalized = normalizeTemplatePath(path);
    try {
        await client.writeFile(normalized.workspacePath, markdown);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw createTemplateError(`Failed to write template [${normalized.relativePath}]: ${message}`, 'template_write_failed');
    }
    return {
        path: normalized.workspacePath,
        relativePath: normalized.relativePath,
        totalChars: markdown.length,
    };
}

/**
 * Delete a Markdown template using the same kernel endpoint as SiYuan's template picker.
 */
export async function deleteTemplate(
    client: SiYuanClient,
    path: string,
): Promise<TemplatePathResult> {
    const resolved = await resolveTemplate(client, path);
    try {
        await client.requestWrite<null>('/api/search/removeTemplate', { path: resolved.path });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw createTemplateError(`Failed to delete template [${resolved.relativePath}]: ${message}`, 'template_delete_failed');
    }
    return {
        path: resolved.path,
        relativePath: resolved.relativePath,
    };
}

/**
 * Save an existing document as a root-level SiYuan template.
 */
export async function saveDocAsTemplate(
    client: SiYuanClient,
    id: string,
    name: string,
    overwrite = false,
): Promise<TemplateSaveDocResult> {
    const normalizedName = normalizeTemplateName(name);
    const request: IReqDocSaveAsTemplate = {
        id,
        name: normalizedName,
        overwrite,
    };
    try {
        await client.requestWrite<null>('/api/template/docSaveAsTemplate', request);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/SiYuan API error:\s*1\b/.test(message)) {
            throw createTemplateError(`Template already exists: ${normalizedName}.md`, 'template_exists');
        }
        throw createTemplateError(`Failed to save document as template [${normalizedName}]: ${message}`, 'template_write_failed');
    }
    return {
        id,
        name: normalizedName,
        relativePath: `${normalizedName}.md`,
    };
}

/**
 * Read a Markdown template source through SiYuan's authenticated /templates/ static route.
 */
export async function readTemplateSource(
    client: SiYuanClient,
    path: string,
): Promise<TemplateSourceResult> {
    const normalized = normalizeTemplatePath(path);
    const response = await fetch(`${client.getBaseUrl()}${normalized.staticPath}`, {
        method: 'GET',
        headers: client.getAuthHeaders(),
    });
    if (!response.ok) {
        const message = `Failed to read template source [${normalized.relativePath}]: HTTP ${response.status} ${response.statusText}`;
        const error = new Error(message);
        (error as Error & { reason?: string }).reason = response.status === 404
            ? 'template_not_found'
            : 'template_source_unavailable';
        throw error;
    }

    return {
        path: normalized.path,
        relativePath: normalized.relativePath,
        markdown: await response.text(),
    };
}
