import fs from 'node:fs';
import path from 'node:path';
import type { SiYuanClient } from '../../api/client';
import * as fileApi from '../../api/file';
import * as templateApi from '../../api/template';
import { normalizeMarkdownContent } from '../../core/normalize';
import type { FileAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import {
    FileDeleteAssetSchema,
    FileExportMdSchema,
    FileExportResourcesSchema,
    FileExtractDocSchema,
    FileGetDocAssetsSchema,
    FileGetImageOCRTextSchema,
    FileListUnusedAssetsSchema,
    FileRemoveUnusedAssetsSchema,
    FileRenameAssetSchema,
    FileRenderSchema,
    FileUploadAssetSchema,
} from '../../core/types';
import { ensurePermissionForDocumentId } from '../internal/context';
import type { ToolActionHandler } from '../internal/define-tool';
import { createJsonResult, type ToolResult } from '../internal/shared';

export const FILE_TOOL_NAME = 'file';
export const DEFAULT_LARGE_UPLOAD_THRESHOLD_MB = 10;

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
        const result = await templateApi.renderTemplate(client, parsed.id!, parsed.path!);
        return createJsonResult(result);
    } catch (error) {
        if (isWorkspaceTemplatePathError(error)) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        error: {
                            type: 'api_error',
                            tool: FILE_TOOL_NAME,
                            action: 'render',
                            message: error.message,
                            reason: 'path_not_in_workspace',
                            workspacePathRequired: true,
                            hint: 'The template path must point to a file inside the SiYuan workspace, not an arbitrary local path such as /tmp/... or your repo checkout.',
                        },
                    }, null, 2),
                }],
                isError: true,
            };
        }
        throw error;
    }
};

const handleExportMd: ToolActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FileExportMdSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;
    const result = normalizeMarkdownContent(await fileApi.exportMdContent(client, parsed.id));
    return createJsonResult(result);
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

const handleGetImageOCRText: ToolActionHandler = async ({ client, rawArgs }) => {
    const parsed = FileGetImageOCRTextSchema.parse(rawArgs);
    const result = await fileApi.getImageOCRText(client, parsed.path);
    return createJsonResult({
        path: parsed.path ?? null,
        ...result,
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
    const targetDir = path.join(outputRoot, folderName);
    const assetsDir = path.join(targetDir, 'assets');

    if (fs.existsSync(outputRoot)) {
        fs.rmSync(outputRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(assetsDir, { recursive: true });

    const docMdPath = path.join(targetDir, `${docName}.md`);
    fs.writeFileSync(docMdPath, markdown, 'utf-8');

    const assetRefs = [...markdown.matchAll(/\]\(assets\/([^)]+)\)/g)];
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
        extractedDir: targetDir,
        docMdFile: `${docName}.md`,
        extractedAssetCount: extractedCount,
        skippedAssetCount: skippedCount,
        structure,
    });
};

export function createFileActionHandlers(thresholdMB: number, largeUploadThresholdBytes: number): Record<FileAction, ToolActionHandler> {
    return {
        upload_asset: handleUploadAsset(thresholdMB, largeUploadThresholdBytes),
        render: handleRender,
        export_md: handleExportMd,
        export_resources: handleExportResources,
        list_unused_assets: handleListUnusedAssets,
        get_doc_assets: handleGetDocAssets,
        get_image_ocr_text: handleGetImageOCRText,
        remove_unused_assets: handleRemoveUnusedAssets,
        rename_asset: handleRenameAsset,
        delete_asset: handleDeleteAsset,
        extract_doc: handleExtractDoc,
    };
}
