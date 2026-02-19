import { z } from "zod";

export interface ServerConfig {
    name: string;
    version: string;
    description?: string;
}

export const ListNotebooksSchema = z.object({});

export const OpenNotebookSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
});

export const CloseNotebookSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
});

export const CreateNotebookSchema = z.object({
    name: z.string().describe("Notebook name"),
});

export const RemoveNotebookSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
});

export const RenameNotebookSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
    name: z.string().describe("New notebook name"),
});

export const GetNotebookConfSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
});

export const SetNotebookConfSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
    conf: z.object({
        name: z.string().optional(),
        closed: z.boolean().optional(),
        refCreateSavePath: z.string().optional(),
        createDocNameTemplate: z.string().optional(),
        dailyNoteSavePath: z.string().optional(),
        dailyNoteTemplatePath: z.string().optional(),
    }).describe("Notebook configuration"),
});

export const CreateDocSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
    path: z.string().describe("Document path (e.g., /folder/doc)"),
    markdown: z.string().describe("Markdown content"),
});

export const RenameDocSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
    path: z.string().describe("Document path"),
    title: z.string().describe("New title"),
});

export const RenameDocByIDSchema = z.object({
    id: z.string().describe("Document ID"),
    title: z.string().describe("New title"),
});

export const RemoveDocSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
    path: z.string().describe("Document path"),
});

export const RemoveDocByIDSchema = z.object({
    id: z.string().describe("Document ID"),
});

export const MoveDocsSchema = z.object({
    fromPaths: z.array(z.string()).describe("Source document paths"),
    toNotebook: z.string().describe("Target notebook ID"),
    toPath: z.string().describe("Target path"),
});

export const MoveDocsByIDSchema = z.object({
    fromIDs: z.array(z.string()).describe("Source document IDs"),
    toID: z.string().describe("Target parent document ID or notebook ID"),
});

export const GetDocPathSchema = z.object({
    id: z.string().describe("Document ID"),
});

export const GetHPathByPathSchema = z.object({
    notebook: z.string().describe("Notebook ID"),
    path: z.string().describe("Document path"),
});

export const GetHPathByIDSchema = z.object({
    id: z.string().describe("Document ID"),
});

export const GetIDsByHPathSchema = z.object({
    path: z.string().describe("Hierarchical path"),
    notebook: z.string().describe("Notebook ID"),
});

export const InsertBlockSchema = z.object({
    dataType: z.enum(["markdown", "dom"]).describe("Data type to insert"),
    data: z.string().describe("Data to insert"),
    nextID: z.string().optional().describe("Next block ID for positioning"),
    previousID: z.string().optional().describe("Previous block ID for positioning"),
    parentID: z.string().optional().describe("Parent block ID for positioning"),
});

export const PrependBlockSchema = z.object({
    dataType: z.enum(["markdown", "dom"]).describe("Data type to insert"),
    data: z.string().describe("Data to insert"),
    parentID: z.string().describe("Parent block ID"),
});

export const AppendBlockSchema = z.object({
    dataType: z.enum(["markdown", "dom"]).describe("Data type to insert"),
    data: z.string().describe("Data to insert"),
    parentID: z.string().describe("Parent block ID"),
});

export const UpdateBlockSchema = z.object({
    dataType: z.enum(["markdown", "dom"]).describe("Data type to update"),
    data: z.string().describe("New data"),
    id: z.string().describe("Block ID to update"),
});

export const DeleteBlockSchema = z.object({
    id: z.string().describe("Block ID to delete"),
});

export const MoveBlockSchema = z.object({
    id: z.string().describe("Block ID to move"),
    previousID: z.string().optional().describe("Previous block ID for positioning"),
    parentID: z.string().optional().describe("Parent block ID"),
});

export const FoldBlockSchema = z.object({
    id: z.string().describe("Block ID to fold"),
});

export const UnfoldBlockSchema = z.object({
    id: z.string().describe("Block ID to unfold"),
});

export const GetBlockKramdownSchema = z.object({
    id: z.string().describe("Block ID"),
});

export const GetChildBlocksSchema = z.object({
    id: z.string().describe("Parent block ID"),
});

export const TransferBlockRefSchema = z.object({
    fromID: z.string().describe("Source block ID"),
    toID: z.string().describe("Target block ID"),
    refIDs: z.array(z.string()).optional().describe("Reference block IDs to transfer"),
});

export const SetBlockAttrsSchema = z.object({
    id: z.string().describe("Block ID"),
    attrs: z.record(z.string(), z.string()).describe("Block attributes (custom-*)"),
});

export const GetBlockAttrsSchema = z.object({
    id: z.string().describe("Block ID"),
});

export const UploadAssetSchema = z.object({
    assetsDirPath: z.string().describe("Asset directory path (e.g., /assets/)"),
    file: z.string().describe("Base64 encoded file content"),
    fileName: z.string().describe("Original file name"),
});

export const RenderTemplateSchema = z.object({
    id: z.string().describe("Document ID for template context"),
    path: z.string().describe("Template file absolute path"),
});

export const RenderSprigSchema = z.object({
    template: z.string().describe("Sprig template content"),
});

export const ExportMdContentSchema = z.object({
    id: z.string().describe("Document ID to export"),
});

export const ExportResourcesSchema = z.object({
    paths: z.array(z.string()).describe("Paths to export"),
    name: z.string().optional().describe("Export file name"),
});

export const PushMsgSchema = z.object({
    msg: z.string().describe("Message content"),
    timeout: z.number().optional().describe("Display timeout in milliseconds"),
});

export const PushErrMsgSchema = z.object({
    msg: z.string().describe("Error message content"),
    timeout: z.number().optional().describe("Display timeout in milliseconds"),
});

export const GetVersionSchema = z.object({});

export const GetCurrentTimeSchema = z.object({});

export type ListNotebooksInput = z.infer<typeof ListNotebooksSchema>;
export type OpenNotebookInput = z.infer<typeof OpenNotebookSchema>;
export type CloseNotebookInput = z.infer<typeof CloseNotebookSchema>;
export type CreateNotebookInput = z.infer<typeof CreateNotebookSchema>;
export type RemoveNotebookInput = z.infer<typeof RemoveNotebookSchema>;
export type RenameNotebookInput = z.infer<typeof RenameNotebookSchema>;
export type GetNotebookConfInput = z.infer<typeof GetNotebookConfSchema>;
export type SetNotebookConfInput = z.infer<typeof SetNotebookConfSchema>;

export type CreateDocInput = z.infer<typeof CreateDocSchema>;
export type RenameDocInput = z.infer<typeof RenameDocSchema>;
export type RenameDocByIDInput = z.infer<typeof RenameDocByIDSchema>;
export type RemoveDocInput = z.infer<typeof RemoveDocSchema>;
export type RemoveDocByIDInput = z.infer<typeof RemoveDocByIDSchema>;
export type MoveDocsInput = z.infer<typeof MoveDocsSchema>;
export type MoveDocsByIDInput = z.infer<typeof MoveDocsByIDSchema>;

export type GetDocPathInput = z.infer<typeof GetDocPathSchema>;
export type GetHPathByPathInput = z.infer<typeof GetHPathByPathSchema>;
export type GetHPathByIDInput = z.infer<typeof GetHPathByIDSchema>;
export type GetIDsByHPathInput = z.infer<typeof GetIDsByHPathSchema>;

export type InsertBlockInput = z.infer<typeof InsertBlockSchema>;
export type PrependBlockInput = z.infer<typeof PrependBlockSchema>;
export type AppendBlockInput = z.infer<typeof AppendBlockSchema>;
export type UpdateBlockInput = z.infer<typeof UpdateBlockSchema>;
export type DeleteBlockInput = z.infer<typeof DeleteBlockSchema>;
export type MoveBlockInput = z.infer<typeof MoveBlockSchema>;
export type FoldBlockInput = z.infer<typeof FoldBlockSchema>;
export type UnfoldBlockInput = z.infer<typeof UnfoldBlockSchema>;
export type GetBlockKramdownInput = z.infer<typeof GetBlockKramdownSchema>;
export type GetChildBlocksInput = z.infer<typeof GetChildBlocksSchema>;
export type TransferBlockRefInput = z.infer<typeof TransferBlockRefSchema>;

export type SetBlockAttrsInput = z.infer<typeof SetBlockAttrsSchema>;
export type GetBlockAttrsInput = z.infer<typeof GetBlockAttrsSchema>;

export type UploadAssetInput = z.infer<typeof UploadAssetSchema>;

export type RenderTemplateInput = z.infer<typeof RenderTemplateSchema>;
export type RenderSprigInput = z.infer<typeof RenderSprigSchema>;

export type ExportMdContentInput = z.infer<typeof ExportMdContentSchema>;
export type ExportResourcesInput = z.infer<typeof ExportResourcesSchema>;

export type PushMsgInput = z.infer<typeof PushMsgSchema>;
export type PushErrMsgInput = z.infer<typeof PushErrMsgSchema>;

export type GetVersionInput = z.infer<typeof GetVersionSchema>;
export type GetCurrentTimeInput = z.infer<typeof GetCurrentTimeSchema>;
