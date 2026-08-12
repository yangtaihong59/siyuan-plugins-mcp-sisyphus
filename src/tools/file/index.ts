import type { SiYuanClient } from '../../api/client';
import type { CategoryToolConfig, FileAction, FileCategoryToolConfig } from '../../core/config';
import { FILE_ACTION_HINTS, FILE_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    FileActionSchema,
    FileCreateTemplateSchema,
    FileDeleteTemplateSchema,
    FileDeleteAssetSchema,
    FileExportMdSchema,
    FileExportResourcesSchema,
    FileExtractDocSchema,
    FileGetDocAssetsSchema,
    FileAuditImageRefsSchema,
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
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { createFileActionHandlers, FILE_TOOL_NAME, DEFAULT_LARGE_UPLOAD_THRESHOLD_MB } from './handlers';

export { FILE_TOOL_NAME };

export const FILE_VARIANTS: ActionVariant<FileAction>[] = [
    createZodActionVariant('upload_asset', FileUploadAssetSchema, 'Read a local file and upload it to the specified assets directory.'),
    createZodActionVariant('list_templates', FileListTemplatesSchema, 'List or search SiYuan workspace templates available under data/templates.'),
    createZodActionVariant('read_template', FileReadTemplateSchema, 'Read a Markdown template source through SiYuan’s authenticated template route.'),
    createZodActionVariant('create_template', FileCreateTemplateSchema, 'Create a Markdown template under data/templates through SiYuan’s workspace file API.'),
    createZodActionVariant('update_template', FileUpdateTemplateSchema, 'Replace an existing Markdown template under data/templates.'),
    createZodActionVariant('delete_template', FileDeleteTemplateSchema, 'Delete an existing Markdown template under data/templates.'),
    createZodActionVariant('save_doc_as_template', FileSaveDocAsTemplateSchema, 'Save an existing SiYuan document as a root-level template.'),
    createZodActionVariant('render', FileRenderSchema, 'Render a SiYuan workspace template (.action{.title}) or an inline Sprig template ({{...}}).'),
    createZodActionVariant('export_md', FileExportMdSchema, 'Export document content as Markdown.'),
    createZodActionVariant('export_resources', FileExportResourcesSchema, 'Export resources as a ZIP archive.'),
    createZodActionVariant('list_unused_assets', FileListUnusedAssetsSchema, 'List unused asset files.'),
    createZodActionVariant('get_doc_assets', FileGetDocAssetsSchema, 'List assets directly referenced by the current document tree. Use extract_doc for complete document asset inspection.'),
    createZodActionVariant('audit_image_refs', FileAuditImageRefsSchema, 'Compare expected imported image references with SiYuan document image references. Read-only; no local file access or repair.'),
    createZodActionVariant('get_image_ocr_text', FileGetImageOCRTextSchema, 'Get stored OCR text for an image asset.'),
    createZodActionVariant('remove_unused_assets', FileRemoveUnusedAssetsSchema, 'Remove all unused asset files.'),
    createZodActionVariant('rename_asset', FileRenameAssetSchema, 'Rename an asset file.'),
    createZodActionVariant('delete_asset', FileDeleteAssetSchema, 'Delete an asset file.'),
    createZodActionVariant('extract_doc', FileExtractDocSchema, 'Export a document and all referenced assets into a self-contained uncompressed folder. Prefer this over export_resources when you need to inspect attachment content.'),
];

function createFileTool(thresholdMB: number, largeUploadThresholdBytes: number) {
    return defineTool<FileAction>({
        name: 'file',
        description: '📁 Grouped file and asset operations.',
        variants: FILE_VARIANTS,
        actionSchema: FileActionSchema,
        aggregateOptions: {
            guidance: FILE_GUIDANCE,
            actionHints: FILE_ACTION_HINTS,
        },
        handlers: createFileActionHandlers(thresholdMB, largeUploadThresholdBytes),
    });
}

const listFileTool = createFileTool(DEFAULT_LARGE_UPLOAD_THRESHOLD_MB, DEFAULT_LARGE_UPLOAD_THRESHOLD_MB * 1024 * 1024);

export function listFileTools(config: CategoryToolConfig<FileAction>) {
    return listFileTool.listTools(config);
}

export async function callFileTool(
    client: SiYuanClient,
    args: Record<string, unknown> | undefined,
    config: CategoryToolConfig<FileAction> | FileCategoryToolConfig<FileAction>,
    permMgr: PermissionManager,
): Promise<ToolResult> {
    const thresholdMB = 'uploadLargeFileThresholdMB' in config && typeof config.uploadLargeFileThresholdMB === 'number'
        ? config.uploadLargeFileThresholdMB
        : DEFAULT_LARGE_UPLOAD_THRESHOLD_MB;
    const largeUploadThresholdBytes = thresholdMB * 1024 * 1024;
    return createFileTool(thresholdMB, largeUploadThresholdBytes).callTool(client, args, config, permMgr);
}
