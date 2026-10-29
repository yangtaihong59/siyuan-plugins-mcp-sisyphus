import { z } from "zod";
import { TIMELINE_ACTIONS } from "../../core/config";

export const TimelineActionSchema = z.enum(TIMELINE_ACTIONS);

export const TimelineListNodesSchema = z.object({
    action: z.literal("list_nodes"),
    scope: z.enum(["global", "document", "all"]).describe("Node scope to list"),
    documentId: z.string().optional().describe("Required for document or all scope"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
    pageSize: z.number().int().min(1).max(100).optional().describe("Nodes per page (default 50)"),
}).superRefine((value, ctx) => {
    if (value.scope !== "global" && !value.documentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documentId"], message: "documentId is required for document or all scope." });
    }
});

export const TimelineCreateNodeSchema = z.object({
    action: z.literal("create_node"),
    name: z.string().trim().min(1).describe("Human-readable timeline node name"),
    scope: z.enum(["global", "document"]).describe("Create a workspace-global or document-scoped node"),
    documentId: z.string().optional().describe("Required for document scope"),
}).superRefine((value, ctx) => {
    if (value.scope === "document" && !value.documentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documentId"], message: "documentId is required for document scope." });
    }
});

export const TimelineCompareNodeSchema = z.object({
    action: z.literal("compare_node"),
    documentId: z.string().describe("Document ID to compare"),
    tag: z.string().min(1).describe("Timeline tag returned by create_node or list_nodes"),
    page: z.number().int().min(1).optional().describe("Changed-block page number (default 1)"),
    pageSize: z.number().int().min(1).max(100).optional().describe("Blocks per page (default 20)"),
    includeUnchanged: z.boolean().optional().describe("Include unchanged blocks in the paginated result (default false)"),
});

export const TimelineDeleteNodeSchema = z.object({
    action: z.literal("delete_node"),
    tag: z.string().min(1).describe("Timeline tag to remove"),
    documentId: z.string().optional().describe("Required for document-scoped tags; omit for global tags"),
});

export const TimelineRollbackDocumentSchema = z.object({
    action: z.literal("rollback_document"),
    documentId: z.string().describe("Document ID to restore"),
    tag: z.string().min(1).describe("Timeline tag identifying the historical node"),
});

export const TimelineRollbackBlockSchema = z.object({
    action: z.literal("rollback_block"),
    documentId: z.string().describe("Document ID containing the block change"),
    tag: z.string().min(1).describe("Timeline tag identifying the historical node"),
    changeKey: z.string().min(1).describe("Opaque changeKey returned by the latest compare_node call"),
});
