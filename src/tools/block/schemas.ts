import { z } from "zod";
import { BLOCK_ACTIONS } from "../../core/config";
import { FsReplaceEditSchema } from "../fs/schemas";

export const BlockActionSchema = z.enum(BLOCK_ACTIONS);

export const BlockInsertSchema = z.object({
    action: z.literal("insert"),
    dataType: z.enum(["markdown", "dom"]).optional().describe("Data format"),
    data: z.string().optional().describe("Block content"),
    nextID: z.string().optional().describe("Next block ID"),
    previousID: z.string().optional().describe("Previous block ID"),
    parentID: z.string().optional().describe("Parent block or document ID"),
    blocks: z.array(z.object({
        dataType: z.enum(["markdown", "dom"]).describe("Data format"),
        data: z.string().describe("Block content"),
        nextID: z.string().optional().describe("Next block ID"),
        previousID: z.string().optional().describe("Previous block ID"),
        parentID: z.string().optional().describe("Parent block or document ID"),
    })).min(1).optional().describe("Blocks to insert. Item-level anchors override top-level parentID/previousID/nextID."),
}).superRefine((value, ctx) => {
    const batch = Array.isArray(value.blocks);
    if (batch) {
        if (value.dataType || value.data) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide either blocks or single insert data, not both.", path: ["blocks"] });
        }
        value.blocks!.forEach((block, index) => {
            if (block.nextID || block.previousID || block.parentID || value.nextID || value.previousID || value.parentID) return;
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["blocks", index, "previousID"], message: "Provide nextID, previousID, or parentID for each block, or set a top-level parentID/previousID/nextID." });
        });
        return;
    }
    if (!value.dataType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dataType is required for single insert.", path: ["dataType"] });
    if (value.data === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "data is required for single insert.", path: ["data"] });
});

export const BlockPrependSchema = z.object({
    action: z.literal("prepend"),
    dataType: z.enum(["markdown", "dom"]).describe("Data format"),
    data: z.string().describe("Block content"),
    parentID: z.string().describe("Parent block or document ID"),
});

export const BlockAppendSchema = z.object({
    action: z.literal("append"),
    dataType: z.enum(["markdown", "dom"]).describe("Data format"),
    data: z.string().describe("Block content"),
    parentID: z.string().describe("Parent block or document ID"),
});

export const BlockUpdateSchema = z.object({
    action: z.literal("update"),
    dataType: z.enum(["markdown", "dom"]).optional().describe("Data format"),
    data: z.string().optional().describe("New block content"),
    id: z.string().optional().describe("Block ID"),
    items: z.array(z.object({
        id: z.string().describe("Block ID"),
        dataType: z.enum(["markdown", "dom"]).describe("Data format"),
        data: z.string().describe("Replacement block content"),
    })).min(1).optional().describe("Blocks to update"),
}).superRefine((value, ctx) => {
    if (Array.isArray(value.items)) {
        if (value.id || value.dataType || value.data !== undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide either items or single update fields, not both.", path: ["items"] });
        }
        return;
    }
    if (!value.id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "id is required for single update.", path: ["id"] });
    if (!value.dataType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dataType is required for single update.", path: ["dataType"] });
    if (value.data === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "data is required for single update.", path: ["data"] });
});

export const BlockReplaceSchema = z.object({
    action: z.literal("replace"),
    id: z.string().describe("Block ID"),
    edit: z.union([
        FsReplaceEditSchema,
        z.array(FsReplaceEditSchema).min(1),
    ]).describe("One replacement edit or an array of edits to apply sequentially within the same block kramdown"),
});

export const BlockDeleteSchema = z.object({
    action: z.literal("delete"),
    id: z.string().describe("Block ID"),
});

export const BlockMoveSchema = z.object({
    action: z.literal("move"),
    id: z.string().optional().describe("Single block ID"),
    ids: z.array(z.string()).min(1).optional().describe("Multiple block IDs to move as a group. Pass IDs in the desired final order; the tool calls SiYuan's low-level move API from last to first internally to preserve that order."),
    previousID: z.string().optional().describe("Previous block ID"),
    parentID: z.string().optional().describe("New parent block ID"),
}).superRefine((value, ctx) => {
    if ((value.id && value.ids) || (!value.id && !value.ids)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide exactly one of id or ids.",
            path: ["id"],
        });
    }
    if (!value.previousID && !value.parentID) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide previousID, parentID, or both to describe the destination.",
            path: ["previousID"],
        });
    }
});

export const BlockSetFoldStateSchema = z.object({
    action: z.literal("set_fold_state"),
    id: z.string().describe("Foldable block ID"),
    folded: z.boolean().describe("true to fold, false to unfold"),
});

export const BlockGetKramdownSchema = z.object({
    action: z.literal("get_kramdown"),
    id: z.string().describe("Block ID or document ID"),
});

export const BlockBatchKramdownSchema = z.object({
    action: z.literal("batch_kramdown"),
    ids: z.array(z.string().min(1)).min(1).max(20).describe("Block or document IDs. Results preserve this input order, including duplicate IDs."),
    mode: z.enum(["md", "textmark"]).optional().describe('Kramdown export mode: "md" (default) or "textmark"'),
});

export const BlockGetChildrenSchema = z.object({
    action: z.literal("get_children"),
    id: z.string().describe("Block ID or document ID"),
    page: z.number().int().min(1).optional().describe('Page number (1-based), default 1'),
    pageSize: z.number().int().min(1).max(200).optional().describe('Items per page, default 50'),
});

export const BlockTransferReferencesSchema = z.object({
    action: z.literal("transfer_references"),
    fromID: z.string().describe("Source block ID"),
    toID: z.string().describe("Target block ID"),
    refIDs: z.array(z.string()).optional().describe("Reference block IDs"),
});

export const BlockSetAttrsSchema = z.object({
    action: z.literal("set_attrs"),
    id: z.string().describe("Block ID"),
    attrs: z.record(z.string(), z.string()).describe("Block attributes"),
});

export const BlockGetAttrsSchema = z.object({
    action: z.literal("get_attrs"),
    id: z.string().describe("Block ID"),
});

export const BlockInfoSchema = z.object({
    action: z.literal("info"),
    id: z.string().describe("Block ID"),
});

export const BlockBreadcrumbSchema = z.object({
    action: z.literal("breadcrumb"),
    id: z.string().describe("Block ID"),
    excludeTypes: z.array(z.string()).optional().describe("Optional block types to exclude from the breadcrumb"),
});

export const BlockDomSchema = z.object({
    action: z.literal("dom"),
    id: z.string().describe("Block ID"),
});

export const BlockRecentUpdatedSchema = z.object({
    action: z.literal("recent_updated"),
    count: z.number().optional().describe("Maximum number of recent readable blocks to return after permission filtering"),
});

export const BlockWordCountSchema = z.object({
    action: z.literal("word_count"),
    ids: z.array(z.string()).describe("One or more block IDs"),
});

export const BlockAddToDailyNoteSchema = z.object({
    action: z.literal("add_to_daily_note"),
    notebook: z.string().describe("Notebook ID"),
    dataType: z.enum(["markdown", "dom"]).describe("Data format"),
    data: z.string().describe("Block content"),
    position: z.enum(["append", "prepend"]).describe("Where to add content in today's daily note"),
});

export const BlockDocsInfoSchema = z.object({
    action: z.literal("docs_info"),
    id: z.string().optional().describe("Single document/block ID"),
    ids: z.array(z.string()).min(1).optional().describe("Document IDs"),
    refCount: z.boolean().optional().describe("When true, include reference counts"),
    av: z.boolean().optional().describe("When true, include AV metadata"),
}).superRefine((value, ctx) => {
    if ((value.id && value.ids) || (!value.id && !value.ids)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of id or ids.", path: ["ids"] });
    }
});
