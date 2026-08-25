import fs from 'node:fs';
import path from 'node:path';
import type { SiYuanClient } from '../../api/client';
import * as fileApi from '../../api/file';
import * as templateApi from '../../api/template';
import * as documentApi from '../../api/document';
import { normalizeMarkdownContent } from '../../core/normalize';
import type { FileAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import {
    FileCreateTemplateSchema,
    FileDeleteTemplateSchema,
    FileDeleteAssetSchema,
    FileExportMdSchema,
    FileExportMarkdownSnapshotSchema,
    FileExportResourcesSchema,
    FileExtractDocSchema,
    FileGetDocAssetsSchema,
    FileAuditImageRefsSchema,
    FileReadImageSchema,
    FileGetImageOCRTextSchema,
    FileListTemplatesSchema,
    FileListUnusedAssetsSchema,
    FileReadTemplateSchema,
    FileRemoveUnusedAssetsSchema,
    FileRenameAssetSchema,
    FileRenderSchema,
    FileSaveDocAsTemplateSchema,
    FileUpdateTemplateSchema,
    FileUploadAssetSchema,
} from '../../core/types';
import { ensurePermissionForDocumentId, ensurePermissionForNotebook } from '../internal/context';
import type { ToolActionHandler } from '../internal/define-tool';
import { createJsonResult, createPaginatedResult, paginate, type ToolResult } from '../internal/shared';
import { auditImageReferences } from '../internal/image-reference-audit';
import { resolveFsScopePath } from '../internal/helpers/fs-path';
import {
    canonicalMetadata,
    compareSnapshotText,
    decodeSnapshotCursor,
    encodeSnapshotCursor,
    flattenDocumentTree,
    hashSnapshotContent,
    hashSnapshotMetadata,
    planSnapshotPaths,
    type SnapshotDocumentCandidate,
    type SnapshotDocumentRecord,
    type SnapshotErrorRecord,
} from '../../shared/markdown-snapshot';

export const FILE_TOOL_NAME = 'file';
export const DEFAULT_LARGE_UPLOAD_THRESHOLD_MB = 10;
export const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;

interface NormalizedImageAssetPath {
    assetPath: string;
    dataPath: string;
}

function normalizeImageAssetPath(input: string): NormalizedImageAssetPath {
    const trimmed = input.trim();
    if (!trimmed) throw new Error('Image asset path must not be empty.');
    if (trimmed.includes('\\') || trimmed.includes('\0')) {
        throw new Error('Image asset path must use SiYuan forward-slash asset syntax.');
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
        throw new Error('Image asset path must be a SiYuan assets/... path, not a URL or local filesystem path.');
    }

    const withoutSuffix = trimmed.split(/[?#]/, 1)[0].replace(/^\/+/, '');
    const relative = withoutSuffix.startsWith('data/assets/')
        ? withoutSuffix.slice('data/assets/'.length)
        : withoutSuffix.startsWith('assets/')
            ? withoutSuffix.slice('assets/'.length)
            : '';
    if (!relative) {
        throw new Error('Image asset path must start with assets/, /assets/, data/assets/, or /data/assets/.');
    }
    const segments = relative.split('/');
    if (segments.some((segment) => {
        if (segment === '' || segment === '.' || segment === '..') return true;
        try {
            const decoded = decodeURIComponent(segment);
            return decoded === '.'
                || decoded === '..'
                || decoded.includes('/')
                || decoded.includes('\\')
                || decoded.includes('\0');
        } catch {
            return true;
        }
    })) {
        throw new Error('Image asset path contains an unsafe path segment.');
    }

    return {
        assetPath: `assets/${relative}`,
        dataPath: `/data/assets/${relative}`,
    };
}

function detectSupportedImageMime(data: Uint8Array): string | undefined {
    if (data.length >= 8
        && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
        && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
        return 'image/png';
    }
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
        return 'image/jpeg';
    }
    if (data.length >= 6) {
        const signature = String.fromCharCode(...data.slice(0, 6));
        if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
    }
    if (data.length >= 12
        && String.fromCharCode(...data.slice(0, 4)) === 'RIFF'
        && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') {
        return 'image/webp';
    }
    return undefined;
}

function normalizeResourcePath(input: string): string {
    const trimmed = input.trim().replace(/\\/g, '/');
    if (!trimmed) {
        return '';
    }

    const withoutLeadingSlash = trimmed.replace(/^\/+/, '');
    const workspaceRelative = withoutLeadingSlash.startsWith('data/')
        ? withoutLeadingSlash
        : withoutLeadingSlash.startsWith('assets/')
            ? `data/${withoutLeadingSlash}`
            : withoutLeadingSlash;
    const withLeadingSlash = workspaceRelative.startsWith('/') ? workspaceRelative : `/${workspaceRelative}`;
    return withLeadingSlash.replace(/\/{2,}/g, '/');
}

function normalizeResourcePaths(paths: string[]): string[] {
    return [...new Set(paths.map(normalizeResourcePath).filter(Boolean))];
}

function resolveLocalOutputPath(outputPath: string): string {
    return path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);
}

function resolveLocalInputPath(inputPath: string): string {
    return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

function isWorkspaceTemplatePathError(error: unknown): error is Error {
    return error instanceof Error && /is not in workspace/i.test(error.message);
}

function templateErrorResult(
    action: 'render' | 'read_template' | 'create_template' | 'update_template' | 'delete_template' | 'save_doc_as_template',
    error: unknown,
    reason: string,
    hint: string,
    extra?: Record<string, unknown>,
): ToolResult {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'api_error',
                    tool: FILE_TOOL_NAME,
                    action,
                    message,
                    reason,
                    ...(extra ?? {}),
                    hint,
                },
            }, null, 2),
        }],
        isError: true,
    };
}

function getTemplateErrorReason(error: unknown): string {
    if (error && typeof error === 'object' && 'reason' in error && typeof (error as { reason?: unknown }).reason === 'string') {
        return (error as { reason: string }).reason;
    }
    return 'template_source_unavailable';
}

function isTemplateNotFoundError(error: unknown): boolean {
    return getTemplateErrorReason(error) === 'template_not_found';
}

function getTemplateName(relativePath: string): string {
    return path.basename(relativePath).replace(/\.md$/i, '');
}

function buildTemplateListItem(item: { path: string; content: string }) {
    const normalized = templateApi.normalizeTemplatePath(item.path);
    return {
        path: item.path,
        relativePath: normalized.relativePath,
        name: getTemplateName(normalized.relativePath),
        content: item.content,
        readArgs: {
            action: 'read_template',
            path: item.path,
        },
        renderArgsTemplate: {
            action: 'render',
            engine: 'template',
            id: '<doc-id>',
            path: item.path,
        },
    };
}

function buildTemplateMutationPayload(pathValue: string, relativePath: string, totalChars?: number) {
    return {
        path: pathValue,
        relativePath,
        name: getTemplateName(relativePath),
        ...(typeof totalChars === 'number' ? { totalChars } : {}),
        readArgs: {
            action: 'read_template',
            path: pathValue,
        },
        renderArgsTemplate: {
            action: 'render',
            engine: 'template',
            id: '<doc-id>',
            path: pathValue,
        },
    };
}

async function resolveTemplateAfterWrite(
    client: SiYuanClient,
    relativePath: string,
    fallbackPath: string,
    totalChars: number,
) {
    try {
        const resolved = await templateApi.resolveTemplate(client, relativePath);
        return buildTemplateMutationPayload(resolved.path, resolved.relativePath, totalChars);
    } catch {
        return buildTemplateMutationPayload(fallbackPath, relativePath, totalChars);
    }
}

const handleUploadAsset = (thresholdMB: number, largeUploadThresholdBytes: number): ToolActionHandler =>
    async ({ client, rawArgs }) => {
        const parsed = FileUploadAssetSchema.parse(rawArgs);
        const localFilePath = resolveLocalInputPath(parsed.localFilePath);
        if (!fs.existsSync(localFilePath)) {
            throw new Error(`Local file does not exist: ${localFilePath}`);
        }
        const stat = fs.statSync(localFilePath);
        if (!stat.isFile()) {
            throw new Error(`Local file path must point to a regular file: ${localFilePath}`);
        }
        if (stat.size > largeUploadThresholdBytes && parsed.confirmLargeFile !== true) {
            return createJsonResult({
                success: false,
                requiresConfirmation: true,
                reason: 'file_too_large',
                localFilePath,
                fileSizeBytes: stat.size,
                thresholdBytes: largeUploadThresholdBytes,
                thresholdMB,
                message: `File exceeds the large-upload safety threshold (${thresholdMB} MB). Stop the current operation and ask the user for explicit confirmation before retrying with confirmLargeFile=true.`,
            });
        }
        const fileName = path.basename(localFilePath);
        const fileBytes = fs.readFileSync(localFilePath);
        const result = await fileApi.uploadAsset(client, parsed.assetsDirPath, fileBytes, fileName);
        return createJsonResult({
            ...result,
            localFilePath,
            uploadedFileName: fileName,
            ...(stat.size > largeUploadThresholdBytes ? { largeFileConfirmed: true } : {}),
        });
    };

const handleRender: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FileRenderSchema.parse(rawArgs);
    if (parsed.engine === 'sprig') {
        const result = await templateApi.renderSprig(client, parsed.template!);
        return createJsonResult(result);
    }
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id!, 'read');
    if (denied) return denied;
    try {
        const result = await templateApi.renderTemplate(client, parsed.id!, parsed.path!, parsed.preview);
        return createJsonResult(result);
    } catch (error) {
        if (isWorkspaceTemplatePathError(error)) {
            return templateErrorResult(
                'render',
                error,
                'path_not_in_workspace',
                'The template path must point to a file inside the SiYuan workspace, not an arbitrary local path such as /tmp/... or your repo checkout. Use file(action="list_templates") to resolve a valid template path.',
                { workspacePathRequired: true },
            );
        }
        throw error;
    }
};

const handleListTemplates: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileListTemplatesSchema.parse(rawArgs);
    const query = parsed.query ?? '';
    const result = await templateApi.searchTemplates(client, query);
    const templates = (Array.isArray(result.templates) ? result.templates : []).map(buildTemplateListItem);
    const paged = paginate(templates, parsed.page ?? 1, parsed.pageSize ?? 20);
    return createPaginatedResult(paged.items, paged, {
        query: result.k,
        showing: paged.showing,
        truncated: paged.truncated,
    });
};

const handleReadTemplate: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileReadTemplateSchema.parse(rawArgs);
    try {
        const source = await templateApi.readTemplateSource(client, parsed.path);
        const totalChars = source.markdown.length;
        const offset = parsed.offset ?? 0;
        const limit = parsed.limit ?? 8000;
        const markdown = source.markdown.slice(offset, offset + limit);
        const nextOffset = offset + markdown.length;
        const truncated = nextOffset < totalChars;
        return createJsonResult({
            path: source.path,
            relativePath: source.relativePath,
            markdown,
            totalChars,
            offset,
            limit,
            truncated,
            ...(truncated ? { nextOffset } : {}),
        });
    } catch (error) {
        return templateErrorResult(
            'read_template',
            error,
            getTemplateErrorReason(error),
            'Use file(action="list_templates") to resolve a valid Markdown template path. If you only need rendered output, use file(action="render", engine="template").',
        );
    }
};

const handleCreateTemplate: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileCreateTemplateSchema.parse(rawArgs);
    if (parsed.overwrite !== true) {
        try {
            const existing = await templateApi.resolveTemplate(client, parsed.path);
            return templateErrorResult(
                'create_template',
                new Error(`Template already exists: ${existing.relativePath}`),
                'template_exists',
                'Pass overwrite=true to replace the existing template, or choose a different template path.',
                {
                    path: existing.path,
                    relativePath: existing.relativePath,
                },
            );
        } catch (error) {
            if (!isTemplateNotFoundError(error)) {
                return templateErrorResult(
                    'create_template',
                    error,
                    getTemplateErrorReason(error),
                    'Use a Markdown template path under data/templates, such as "reports/monthly.md".',
                );
            }
        }
    }

    try {
        const written = await templateApi.writeTemplateSource(client, parsed.path, parsed.markdown);
        const payload = await resolveTemplateAfterWrite(client, written.relativePath, written.path, written.totalChars);
        return createJsonResult({
            success: true,
            ...payload,
        });
    } catch (error) {
        return templateErrorResult(
            'create_template',
            error,
            getTemplateErrorReason(error),
            'Use a Markdown template path under data/templates, such as "reports/monthly.md".',
        );
    }
};

const handleUpdateTemplate: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileUpdateTemplateSchema.parse(rawArgs);
    let existing: templateApi.TemplateSearchItem;
    try {
        existing = await templateApi.resolveTemplate(client, parsed.path);
    } catch (error) {
        return templateErrorResult(
            'update_template',
            error,
            getTemplateErrorReason(error),
            'Use file(action="list_templates") to resolve an existing Markdown template before updating it.',
        );
    }

    try {
        const written = await templateApi.writeTemplateSource(client, existing.relativePath, parsed.markdown);
        const payload = await resolveTemplateAfterWrite(client, written.relativePath, existing.path, written.totalChars);
        return createJsonResult({
            success: true,
            ...payload,
        });
    } catch (error) {
        return templateErrorResult(
            'update_template',
            error,
            getTemplateErrorReason(error),
            'The template was found, but writing the replacement Markdown failed.',
        );
    }
};

const handleDeleteTemplate: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileDeleteTemplateSchema.parse(rawArgs);
    try {
        const result = await templateApi.deleteTemplate(client, parsed.path);
        return createJsonResult({
            success: true,
            ...result,
        });
    } catch (error) {
        return templateErrorResult(
            'delete_template',
            error,
            getTemplateErrorReason(error),
            'Use file(action="list_templates") to resolve an existing Markdown template before deleting it.',
        );
    }
};

const handleSaveDocAsTemplate: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FileSaveDocAsTemplateSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;

    try {
        const saved = await templateApi.saveDocAsTemplate(client, parsed.id, parsed.name, parsed.overwrite ?? false);
        let template;
        try {
            const resolved = await templateApi.resolveTemplate(client, saved.relativePath);
            template = buildTemplateMutationPayload(resolved.path, resolved.relativePath);
        } catch {
            template = undefined;
        }
        return createJsonResult({
            success: true,
            id: saved.id,
            name: saved.name,
            ...(template ? { template } : {}),
        });
    } catch (error) {
        return templateErrorResult(
            'save_doc_as_template',
            error,
            getTemplateErrorReason(error),
            'Use a root-level template name without slashes. Pass overwrite=true to replace an existing template.',
        );
    }
};

const handleExportMd: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FileExportMdSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = normalizeMarkdownContent(await fileApi.exportMdContent(client, parsed.id));
    return createJsonResult(result);
};

function suffixSnapshotPathWithID(relativePath: string, documentID: string): string {
    const suffix = ` [${documentID}].md`;
    return relativePath.endsWith(suffix) ? relativePath : `${relativePath.slice(0, -3)}${suffix}`;
}

const handleExportMarkdownSnapshot: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FileExportMarkdownSnapshotSchema.parse(rawArgs);
    const deniedNotebook = await ensurePermissionForNotebook(permMgr, parsed.notebookID, 'read');
    if (deniedNotebook) return deniedNotebook;

    const roots = parsed.roots ? [...new Set(parsed.roots)].sort(compareSnapshotText) : undefined;
    const documentIDs = parsed.documentIDs ? [...new Set(parsed.documentIDs)].sort(compareSnapshotText) : undefined;
    const scope = {
        notebookID: parsed.notebookID,
        ...(roots ? { roots } : { documentIDs: documentIDs! }),
    };
    const scopeHash = await hashSnapshotMetadata(scope);
    const cursor = parsed.cursor ? decodeSnapshotCursor(parsed.cursor) : undefined;
    const offset = cursor?.offset ?? 0;
    const limit = parsed.limit ?? 20;

    const candidates: SnapshotDocumentCandidate[] = documentIDs
        ? documentIDs.map((id) => ({ id }))
        : [];
    const byID = new Map<string, SnapshotDocumentCandidate>();
    const errors: SnapshotErrorRecord[] = [];
    if (roots) {
        // Keep successful roots exportable when one root is stale or inaccessible;
        // callers can retry only the structured failed root instead of losing a
        // whole page to an aggregate Promise rejection.
        const rootResults = await Promise.all(roots.map(async (root) => {
            try {
                return { root, tree: await documentApi.listDocTree(client, parsed.notebookID, root) };
            } catch (error) {
                return {
                    root,
                    error: {
                        code: 'enumeration_failed',
                        message: error instanceof Error ? error.message : String(error),
                        path: root,
                        retryable: true,
                    } satisfies SnapshotErrorRecord,
                };
            }
        }));
        for (const result of rootResults) {
            if ('error' in result) {
                errors.push(result.error);
            } else {
                candidates.push(...flattenDocumentTree(result.tree));
            }
        }
    }
    for (const candidate of candidates) {
        if (!candidate.id) continue;
        if (!byID.has(candidate.id)) byID.set(candidate.id, candidate);
    }

    // Build the continuation inventory from the enumeration surface itself.
    // Root enumeration already returns IDs and paths; explicit IDs are their
    // own stable inventory. Resolving every document before slicing made each
    // page repeat the complete notebook scan.
    const inventoryCandidates = [...byID.values()].sort((left, right) => {
        const leftKey = left.hPath || left.id;
        const rightKey = right.hPath || right.id;
        return compareSnapshotText(leftKey, rightKey) || compareSnapshotText(left.id, right.id);
    });
    const inventoryHash = await hashSnapshotMetadata(inventoryCandidates.map((candidate) => ({
        id: candidate.id,
        ...(candidate.path ? { path: candidate.path } : {}),
        ...(candidate.hPath ? { hPath: candidate.hPath } : {}),
        ...(candidate.name ? { name: candidate.name } : {}),
    })));
    if (cursor && (cursor.scopeHash !== scopeHash || cursor.inventoryHash !== inventoryHash)) {
        throw new Error('export_markdown_snapshot cursor does not match the current notebook inventory; restart from the first page.');
    }

    // Root trees contain enough metadata to plan collisions for the complete
    // inventory without resolving every document. Any candidate whose tree
    // metadata is incomplete is resolved only when its page is requested.
    const plannedRecords: SnapshotDocumentRecord[] = inventoryCandidates
        .filter((candidate): candidate is SnapshotDocumentCandidate & { path: string; hPath: string } => Boolean(candidate.path && candidate.hPath))
        .map((candidate) => {
            const metadata = canonicalMetadata(parsed.notebookID, candidate);
            return {
                id: metadata.id,
                title: metadata.title,
                hPath: metadata.hPath,
                storagePath: metadata.storagePath,
                metadata,
                metadataHash: '',
            };
        });
    const conflicts = planSnapshotPaths(plannedRecords);
    const plannedPathByID = new Map(plannedRecords.map((record) => [record.id, record.relativePath]));
    for (const record of plannedRecords) {
        for (const error of record.errors ?? []) errors.push(error);
    }

    const pageCandidates = inventoryCandidates.slice(offset, offset + limit);
    const records: SnapshotDocumentRecord[] = [];
    for (const candidate of pageCandidates) {
        try {
            const resolved = await ensurePermissionForDocumentId(client, permMgr, candidate.id, 'read');
            if (resolved.denied) {
                errors.push({ code: 'permission_denied', message: `Read permission denied for document ${candidate.id}.`, documentID: candidate.id });
                continue;
            }
            const documentID = resolved.context.documentId;
            if (resolved.context.notebook !== parsed.notebookID) {
                throw new Error(`Document ${candidate.id} does not belong to notebook ${parsed.notebookID}.`);
            }
            const storagePath = resolved.context.path || candidate.path;
            const hPath = candidate.hPath || resolved.context.hPath || await documentApi.getHPathByID(client, documentID);
            if (!storagePath || !hPath) throw new Error('Document path metadata is unavailable.');
            const metadata = canonicalMetadata(parsed.notebookID, {
                id: documentID,
                path: storagePath,
                hPath,
                name: resolved.context.name || candidate.name,
            });
            const record: SnapshotDocumentRecord = {
                id: metadata.id,
                title: metadata.title,
                hPath: metadata.hPath,
                storagePath: metadata.storagePath,
                metadata,
                metadataHash: await hashSnapshotMetadata(metadata),
                relativePath: plannedPathByID.get(metadata.id),
            };
            records.push(record);
        } catch (error) {
            errors.push({
                code: 'document_metadata_unavailable',
                message: error instanceof Error ? error.message : String(error),
                documentID: candidate.id,
                retryable: true,
            });
        }
    }

    const unplannedRecords = records.filter((record) => !record.relativePath);
    conflicts.push(...planSnapshotPaths(unplannedRecords));
    // Explicit-ID pagination cannot know other pages' hPaths without doing the
    // full scan we are avoiding. Add the stable ID to every explicit export
    // filename so cross-page collisions are impossible by construction.
    if (documentIDs) {
        for (const record of records) {
            if (!record.relativePath) continue;
            record.relativePath = suffixSnapshotPathWithID(record.relativePath, record.id);
        }
    } else {
        // A tree entry with incomplete metadata was planned only after page
        // resolution; suffix it so it cannot collide with another page.
        for (const record of unplannedRecords) {
            if (!record.relativePath) continue;
            record.relativePath = suffixSnapshotPathWithID(record.relativePath, record.id);
        }
    }
    for (const record of records) {
        for (const error of record.errors ?? []) {
            if (!errors.includes(error)) errors.push(error);
        }
    }
    for (const record of records) {
        try {
            const result = normalizeMarkdownContent(await fileApi.exportMdContent(client, record.id));
            if (result.hPath !== record.hPath) {
                throw new Error(`Export hPath mismatch: ${result.hPath ?? '<missing>'} != ${record.hPath}`);
            }
            if (typeof result.content !== 'string') throw new Error('Export returned no Markdown content.');
            record.content = result.content;
            record.contentHash = await hashSnapshotContent(result.content);
        } catch (error) {
            const itemError: SnapshotErrorRecord = {
                code: 'export_failed',
                message: error instanceof Error ? error.message : String(error),
                documentID: record.id,
                path: record.relativePath,
                retryable: true,
            };
            record.errors = [...(record.errors ?? []), itemError];
            errors.push(itemError);
        }
    }

    const nextOffset = offset + pageCandidates.length;
    return createJsonResult({
        kind: 'siyuan-markdown-snapshot-page',
        schemaVersion: '1.0.0',
        status: errors.length > 0 || records.some((record) => record.errors?.length) ? 'partial' : 'complete',
        source: {
            notebookID: parsed.notebookID,
            inventorySurface: parsed.documentIDs ? 'documentIDs' : 'document.list_tree',
            exportSurface: 'file.export_md',
            ...(roots ? { roots } : { documentIDs: documentIDs! }),
        },
        scope: { ...scope, scopeHash },
        page: {
            offset,
            limit,
            total: inventoryCandidates.length,
            hasNext: nextOffset < inventoryCandidates.length,
            ...(nextOffset < inventoryCandidates.length ? { nextCursor: encodeSnapshotCursor(scopeHash, inventoryHash, nextOffset) } : {}),
        },
        inventoryHash,
        documents: records,
        conflicts,
        errors,
    });
};

const handleExportResources: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileExportResourcesSchema.parse(rawArgs);
    const normalizedPaths = normalizeResourcePaths(parsed.paths);
    if (normalizedPaths.length === 0) {
        throw new Error('export_resources requires at least one non-empty resource path.');
    }

    let result;
    try {
        result = await fileApi.exportResources(client, normalizedPaths, parsed.name);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to export resources. original_paths=${JSON.stringify(parsed.paths)} normalized_paths=${JSON.stringify(normalizedPaths)} cause=${message}`);
    }

    if (parsed.outputPath) {
        const localOutputPath = resolveLocalOutputPath(parsed.outputPath);
        const binary = await client.readFileBinary(result.path);
        fs.mkdirSync(path.dirname(localOutputPath), { recursive: true });
        fs.writeFileSync(localOutputPath, binary);
        return createJsonResult({
            ...result,
            outputPath: localOutputPath,
            bytes: binary.byteLength,
        });
    }
    return createJsonResult(result);
};

const handleListUnusedAssets: ToolActionHandler = async ({ client, rawArgs }) => {
    FileListUnusedAssetsSchema.parse(rawArgs);
    const result = await fileApi.getUnusedAssets(client);
    return createJsonResult({
        assets: result,
        count: Array.isArray(result) ? result.length : undefined,
    });
};

const handleGetDocAssets: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FileGetDocAssetsSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const assets = parsed.assetType === 'image'
        ? await fileApi.getDocImageAssets(client, parsed.id)
        : await fileApi.getDocAssets(client, parsed.id);
    return createJsonResult({
        id: parsed.id,
        assetType: parsed.assetType ?? 'all',
        assets,
        count: Array.isArray(assets) ? assets.length : undefined,
    });
};

const handleAuditImageRefs: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FileAuditImageRefsSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const actualRefs = await fileApi.getDocImageAssets(client, parsed.id);
    return createJsonResult({
        id: parsed.id,
        ...auditImageReferences(parsed.expectedRefs, Array.isArray(actualRefs) ? actualRefs : []),
        comparison: 'multiset basename; each occurrence is matched once, and SiYuan timestamp/id suffixes are ignored for matching',
    });
};

const handleReadImage: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FileReadImageSchema.parse(rawArgs);
    const normalized = normalizeImageAssetPath(parsed.path);

    let documentID: string;
    if (parsed.id) {
        const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
        if (denied) return denied;
        documentID = context.documentId;
    } else {
        const scope = await resolveFsScopePath(client, permMgr, parsed.documentPath!, 'read');
        if (scope.type !== 'document') {
            throw new Error(`read_image requires a document path, got "${parsed.documentPath}".`);
        }
        const denied = await ensurePermissionForNotebook(permMgr, scope.notebook, 'read');
        if (denied) return denied;
        documentID = scope.id;
    }

    const referenced = await fileApi.getDocImageAssets(client, documentID);
    const referencedPaths = Array.isArray(referenced)
        ? referenced.flatMap((candidate) => {
            if (typeof candidate !== 'string') return [];
            try {
                return [normalizeImageAssetPath(candidate).assetPath];
            } catch {
                return [];
            }
        })
        : [];
    if (!referencedPaths.includes(normalized.assetPath)) {
        throw new Error(`Image asset "${normalized.assetPath}" is not referenced by document "${documentID}".`);
    }

    const data = await client.readFileBinary(normalized.dataPath);
    if (data.byteLength > MAX_INLINE_IMAGE_BYTES) {
        throw new Error(`Image asset is too large for inline visual delivery: ${data.byteLength} bytes exceeds the ${MAX_INLINE_IMAGE_BYTES}-byte limit.`);
    }
    const mimeType = detectSupportedImageMime(data);
    if (!mimeType) {
        throw new Error('Unsupported image data. read_image accepts PNG, JPEG, WebP, and GIF images identified from their file signature.');
    }

    const metadata = {
        documentID,
        path: normalized.assetPath,
        mimeType,
        bytes: data.byteLength,
        delivery: 'mcp_image',
    };
    return {
        content: [
            { type: 'text', text: JSON.stringify(metadata, null, 2) },
            { type: 'image', data: Buffer.from(data).toString('base64'), mimeType },
        ],
        structuredContent: metadata,
    };
};

const handleGetImageOCRText: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileGetImageOCRTextSchema.parse(rawArgs);
    const result = await fileApi.getImageOCRText(client, parsed.path);
    return createJsonResult({
        path: parsed.path ?? null,
        ...result,
        ...(!result.text ? {
            available: false,
            hint: 'SiYuan has no stored OCR text for this image. If the client supports vision, resolve the referencing document and call file(action="read_image", id=... or documentPath=..., path=...) to inspect the image directly. Otherwise install/configure Tesseract OCR in SiYuan and generate OCR data first.',
        } : {}),
    });
};

const handleRemoveUnusedAssets: ToolActionHandler = async ({ client, rawArgs }) => {
    FileRemoveUnusedAssetsSchema.parse(rawArgs);
    const result = await fileApi.removeUnusedAssets(client);
    return createJsonResult({
        success: true,
        ...((result && typeof result === 'object' && !Array.isArray(result)) ? result as Record<string, unknown> : { result }),
    });
};

const handleRenameAsset: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileRenameAssetSchema.parse(rawArgs);
    const result = await fileApi.renameAsset(client, parsed.oldPath, parsed.newName);
    return createJsonResult({
        success: true,
        oldPath: parsed.oldPath,
        newName: parsed.newName,
        ...result,
    });
};

const handleDeleteAsset: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileDeleteAssetSchema.parse(rawArgs);
    const result = await fileApi.deleteAsset(client, parsed.path);
    return createJsonResult({
        success: true,
        path: parsed.path,
        ...((result && typeof result === 'object' && !Array.isArray(result)) ? result as Record<string, unknown> : {}),
    });
};

const handleExtractDoc: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileExtractDocSchema.parse(rawArgs);

    const mdResult = await fileApi.exportMdContent(client, parsed.id);
    const markdown = typeof mdResult.content === 'string' ? mdResult.content : '';
    const hPath = typeof mdResult.hPath === 'string' ? mdResult.hPath : '';

    const docName = hPath.split('/').filter(Boolean).pop()?.replace(/\.sy$/, '') || parsed.id;
    const idSuffix = parsed.id.slice(-7);
    const folderName = `${docName}-${idSuffix}`;

    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    const outputRoot = parsed.outputDir
        ? path.resolve(parsed.outputDir)
        : path.join(homeDir, 'siyuan-extracted');
    const defaultOutputDirUsed = !parsed.outputDir;
    const targetDir = path.join(outputRoot, folderName);
    const assetsDir = path.join(targetDir, 'assets');

    if (fs.existsSync(outputRoot)) {
        fs.rmSync(outputRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(assetsDir, { recursive: true });

    const docMdPath = path.join(targetDir, `${docName}.md`);
    fs.writeFileSync(docMdPath, markdown, 'utf-8');

    const assetRefs = [...markdown.matchAll(/\]\(assets\/([^\s)"']+)(?:\s+"[^"]*")?\)/g)];
    const structure = [`${docName}.md`];
    let extractedCount = 0;
    let skippedCount = 0;

    for (const match of assetRefs) {
        const assetRelPath = match[1];
        const assetFullPath = path.join(assetsDir, assetRelPath);

        try {
            fs.mkdirSync(path.dirname(assetFullPath), { recursive: true });
            const data = await client.readFileBinary(`data/assets/${assetRelPath}`);
            fs.writeFileSync(assetFullPath, data);
            structure.push(`assets/${assetRelPath}`);
            extractedCount++;
        } catch {
            skippedCount++;
        }
    }

    return createJsonResult({
        outputRoot,
        defaultOutputDirUsed,
        extractedDir: targetDir,
        docMdFile: `${docName}.md`,
        extractedAssetCount: extractedCount,
        skippedAssetCount: skippedCount,
        structure,
        hint: defaultOutputDirUsed
            ? 'No outputDir was provided, so extract_doc used the default ~/siyuan-extracted/ output root. Pass outputDir explicitly when you need a specific location such as /private/tmp.'
            : 'extract_doc wrote to the explicit outputDir root.',
    });
};

export function createFileActionHandlers(thresholdMB: number, largeUploadThresholdBytes: number): Record<FileAction, ToolActionHandler> {
    return {
        upload_asset: handleUploadAsset(thresholdMB, largeUploadThresholdBytes),
        list_templates: handleListTemplates,
        read_template: handleReadTemplate,
        create_template: handleCreateTemplate,
        update_template: handleUpdateTemplate,
        delete_template: handleDeleteTemplate,
        save_doc_as_template: handleSaveDocAsTemplate,
        render: handleRender,
        export_md: handleExportMd,
        export_markdown_snapshot: handleExportMarkdownSnapshot,
        export_resources: handleExportResources,
        list_unused_assets: handleListUnusedAssets,
        get_doc_assets: handleGetDocAssets,
        audit_image_refs: handleAuditImageRefs,
        read_image: handleReadImage,
        get_image_ocr_text: handleGetImageOCRText,
        remove_unused_assets: handleRemoveUnusedAssets,
        rename_asset: handleRenameAsset,
        delete_asset: handleDeleteAsset,
        extract_doc: handleExtractDoc,
    };
}
