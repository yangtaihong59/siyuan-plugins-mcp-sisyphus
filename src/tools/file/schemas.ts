import { z } from "zod";
import { FILE_ACTIONS } from "../../core/config";

export const FileActionSchema = z.enum(FILE_ACTIONS);

export const FileUploadAssetSchema = z.object({
    action: z.literal("upload_asset"),
    assetsDirPath: z.string().optional().describe("Asset directory path; defaults to /assets/"),
    localFilePath: z.string().optional().describe("Absolute local file path on the MCP server host (the CLI also accepts paths relative to your shell). CLI/Node stage its bytes automatically when the kernel coordinator is enabled (maximum 10 MiB)."),
    uploadSource: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("Opaque source returned by the authenticated kernel /transfer/upload endpoint; expires after 10 minutes. Supply instead of localFilePath."),
    confirmLargeFile: z.boolean().optional().describe("Set to true only after the user explicitly confirms uploading a file larger than the configured safety threshold."),
}).superRefine((value, ctx) => {
    if (Boolean(value.localFilePath) === Boolean(value.uploadSource)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of localFilePath or uploadSource." });
});

export const FileListTemplatesSchema = z.object({
    action: z.literal("list_templates"),
    query: z.string().optional().describe("Optional keyword used by SiYuan's template picker. Omit or pass an empty string to list all templates."),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).max(128).optional().describe("Templates per page, default 20"),
});

export const FileReadTemplateSchema = z.object({
    action: z.literal("read_template"),
    path: z.string().describe("Template path returned by list_templates, /data/templates/... path, /templates/... static path, or path relative to data/templates"),
    offset: z.number().int().min(0).optional().describe("Character offset for partial template source reading, default 0"),
    limit: z.number().int().min(1).max(20000).optional().describe("Maximum characters to return, default 8000"),
});

export const FileCreateTemplateSchema = z.object({
    action: z.literal("create_template"),
    path: z.string().describe("Template path to create under data/templates. Accepts relative paths such as reports/monthly.md."),
    markdown: z.string().describe("Full Markdown template source to write."),
    overwrite: z.boolean().optional().describe("When true, replace an existing template at the same path. Defaults to false."),
});

export const FileUpdateTemplateSchema = z.object({
    action: z.literal("update_template"),
    path: z.string().describe("Existing template path returned by list_templates, /data/templates/... path, /templates/... static path, or path relative to data/templates."),
    markdown: z.string().describe("Full Markdown template source to replace the existing template with."),
});

export const FileDeleteTemplateSchema = z.object({
    action: z.literal("delete_template"),
    path: z.string().describe("Existing template path returned by list_templates, /data/templates/... path, /templates/... static path, or path relative to data/templates."),
});

export const FileSaveDocAsTemplateSchema = z.object({
    action: z.literal("save_doc_as_template"),
    id: z.string().describe("Document ID to save as a root-level template."),
    name: z.string().describe("Root template name. Slashes are not supported; .md suffix is optional."),
    overwrite: z.boolean().optional().describe("When true, replace an existing template with the same root name. Defaults to false."),
});

export const FileRenderSchema = z.object({
    action: z.literal("render"),
    engine: z.enum(["template", "sprig"]).describe("Template engine to use"),
    id: z.string().optional().describe("Document ID for template context"),
    path: z.string().optional().describe("Template file path inside the SiYuan workspace"),
    template: z.string().optional().describe("Sprig template content"),
    preview: z.boolean().optional().describe("When engine=\"template\", ask SiYuan to render preview DOM instead of insertion DOM."),
}).superRefine((value, ctx) => {
    if (value.engine === "template") {
        if (!value.id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "id is required when engine=\"template\".", path: ["id"] });
        if (!value.path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "path is required when engine=\"template\".", path: ["path"] });
    }
    if (value.engine === "sprig" && !value.template) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "template is required when engine=\"sprig\".", path: ["template"] });
    }
});

export const FileExportMdSchema = z.object({
    action: z.literal("export_md"),
    id: z.string().describe("Document ID to export"),
});

export const FileExportMarkdownSnapshotSchema = z.object({
    action: z.literal("export_markdown_snapshot"),
    notebookID: z.string().min(1).describe("Notebook ID that owns every exported document"),
    roots: z.array(z.string().min(1)).min(1).max(64).optional().describe("Notebook-local storage paths to enumerate (use / for notebook roots)"),
    documentIDs: z.array(z.string().min(1)).min(1).max(500).optional().describe("Explicit document IDs to export"),
    limit: z.number().int().min(1).max(200).optional().describe("Documents returned in this page (default 20)"),
    cursor: z.string().optional().describe("Opaque continuation cursor returned by the previous page"),
}).superRefine((value, ctx) => {
    if (Boolean(value.roots) === Boolean(value.documentIDs)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of roots or documentIDs." });
    }
});

export const FileExportResourcesSchema = z.object({
    action: z.literal("export_resources"),
    delivery: z.enum(["inline", "download"]).optional().describe("Kernel response delivery. download returns a manifest for authenticated client-side saving without embedding binary data."),
    paths: z.array(z.string()).describe("Workspace-relative file paths to export (e.g., /data/20240318112233-abc123.sy/ or /assets/foo.png)"),
    name: z.string().optional().describe("Export file name"),
    outputPath: z.string().optional().describe("Optional local absolute or relative filesystem path to save the exported ZIP"),
});

export const FileListUnusedAssetsSchema = z.object({
    action: z.literal("list_unused_assets"),
});

export const FileGetDocAssetsSchema = z.object({
    action: z.literal("get_doc_assets"),
    id: z.string().describe("Document ID"),
    assetType: z.enum(['all', 'image']).optional().describe("Filter asset type: 'all' (default) returns all assets, 'image' returns only image assets."),
});

export const FileAuditImageRefsSchema = z.object({
    action: z.literal("audit_image_refs"),
    id: z.string().describe("Document ID whose direct image references should be inspected."),
    expectedRefs: z.array(z.string().min(1)).max(4096).describe("Expected image references from source Markdown; no local file is read."),
});

export const FileReadImageSchema = z.object({
    action: z.literal("read_image"),
    path: z.string().min(1).describe("SiYuan image asset path referenced by the document, such as assets/question.png"),
    id: z.string().min(1).optional().describe("Document ID that references the image"),
    documentPath: z.string().min(1).optional().describe("Human-readable fs document path, including the notebook name, that references the image"),
}).superRefine((value, ctx) => {
    if (Boolean(value.id) === Boolean(value.documentPath)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide exactly one of id or documentPath.",
            path: ["id"],
        });
    }
});

export const FileGetImageOCRTextSchema = z.object({
    action: z.literal("get_image_ocr_text"),
    path: z.string().optional().describe("Asset path; omit to receive an empty OCR text payload"),
});

export const FileRemoveUnusedAssetsSchema = z.object({
    action: z.literal("remove_unused_assets"),
});

export const FileRenameAssetSchema = z.object({
    action: z.literal("rename_asset"),
    oldPath: z.string().describe("Existing asset path"),
    newName: z.string().describe("New asset file name"),
});

export const FileDeleteAssetSchema = z.object({
    action: z.literal("delete_asset"),
    path: z.string().describe("Asset path to delete"),
});

export const FileExtractDocSchema = z.object({
    action: z.literal("extract_doc"),
    delivery: z.enum(["inline", "download"]).optional().describe("Kernel response delivery. download returns Markdown and asset paths for client-side saving."),
    id: z.string().describe("Document ID to extract"),
    outputDir: z.string().optional().describe("Output root directory. Defaults to ~/siyuan-extracted/ (resolved to absolute path)."),
});
