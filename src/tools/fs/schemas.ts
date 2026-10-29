import { z } from "zod";
import { FS_ACTIONS } from "../../core/config";
import { ReplaceEditSchema as FsReplaceEditSchema } from "../internal/replace-schema";

export const FsActionSchema = z.enum(FS_ACTIONS);

export const FsLsSchema = z.object({
    action: z.literal("ls"),
    path: z.string().describe("Human-readable workspace path. Prefer including the notebook name (e.g., /Notebook or /Notebook/Folder) for unambiguous resolution; a notebook-omitted path is accepted only when it uniquely matches across readable notebooks. Use / to list all readable notebooks."),
});

export const FsTreeSchema = z.object({
    action: z.literal("tree"),
    path: z.string().describe("Human-readable workspace path. Prefer including the notebook name (e.g., /Notebook or /Notebook/Folder) for unambiguous resolution; a notebook-omitted path is accepted only when it uniquely matches across readable notebooks. Use / to list all readable notebooks."),
    maxDepth: z.number().int().min(0).max(20).optional().describe("Max tree depth to return (default 3)"),
});

export const FsReadSchema = z.object({
    action: z.literal("read"),
    path: z.string().describe("Human-readable workspace document path. Prefer including the notebook name (e.g., /Notebook/Folder/Doc); omitting it is accepted only when the document uniquely matches across readable notebooks."),
    blockStart: z.number().int().min(0).optional().describe("Zero-based display-block index to start reading from (default 0)"),
    blockLimit: z.number().int().min(1).max(200).optional().describe("Optional maximum complete display blocks. Omit to try full text, subject to the 256 KiB hard content limit."),
    tokenBudget: z.number().int().min(1).max(32000).optional().describe("Optional soft token budget. Complete blocks may exceed it, but never the 256 KiB hard content limit."),
    includeBlockIds: z.boolean().optional().describe("Include a sidecar blockRefs mapping without adding block IDs to Markdown content (default false)"),
}).passthrough().superRefine((value, ctx) => {
    for (const key of ["page", "pageSize"] as const) {
        if (value[key] !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [key],
                message: `${key} character pagination was removed; use blockStart, blockLimit, and tokenBudget.`,
            });
        }
    }
});

export const FsWriteSchema = z.object({
    action: z.literal("write"),
    path: z.string().describe("Human-readable workspace document path. Prefer including the notebook name (e.g., /Notebook/Folder/Doc); omitting it is accepted only when the existing document or parent path uniquely matches across readable notebooks. Root-level creation requires /Notebook/Title."),
    markdown: z.string().describe("Markdown content to create or write. Do not include a leading # Title; a matching create-time H1 is stripped automatically."),
    overwrite: z.boolean().optional().describe("When true, replace an existing document body while keeping the document node and title. This is a full body replacement."),
});

export { ReplaceEditSchema as FsReplaceEditSchema } from "../internal/replace-schema";

export const FsReplaceSchema = z.object({
    action: z.literal("replace"),
    path: z.string().describe("Human-readable workspace document path. Prefer including the notebook name (e.g., /Notebook/Folder/Doc); omitting it is accepted only when the document uniquely matches across readable notebooks."),
    edit: z.union([
        FsReplaceEditSchema,
        z.array(FsReplaceEditSchema).min(1),
    ]).describe("One replacement edit or an array of edits to apply sequentially inside editable non-complex Markdown blocks without rebuilding the document"),
});

export const FsRmSchema = z.object({
    action: z.literal("rm"),
    path: z.string().describe("Human-readable workspace document path. Prefer including the notebook name (e.g., /Notebook/Folder/Doc); omitting it is accepted only when the document uniquely matches across readable notebooks."),
});

export const FS_MV_MAX_BATCH = 20;

/** Path key for in-batch duplicate checks: trimmed, single slashes, no trailing slash. */
export function fsMvPathKey(path: string): string {
    return path.trim().replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
}

const FsMvItemSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
}).strict();

export const FsMvSchema = z.object({
    action: z.literal("mv"),
    from: z.string().optional().describe("Human-readable workspace source document path. Prefer including the notebook name (e.g., /Notebook/Folder/Old); omitting it is accepted only when the source uniquely matches across readable notebooks."),
    to: z.string().optional().describe("Human-readable workspace destination document path. Prefer including the notebook name (e.g., /Notebook/Folder/New); omitting it is accepted only when the destination parent uniquely matches across readable notebooks. A root-level destination requires /Notebook/Title."),
    items: z.array(FsMvItemSchema).min(1).max(FS_MV_MAX_BATCH).optional().describe("Batch: up to 20 {from,to}, moved in order; excludes from/to"),
}).superRefine((value, ctx) => {
    if (value.items) {
        if (value.from !== undefined || value.to !== undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "items is mutually exclusive with from and to.", path: ["items"] });
            return;
        }
        const sources = new Map<string, number>();
        const destinations = new Map<string, number>();
        value.items.forEach((item, index) => {
            const from = fsMvPathKey(item.from);
            const to = fsMvPathKey(item.to);
            const repeatedFrom = sources.get(from);
            if (repeatedFrom !== undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: `items[${index}].from repeats items[${repeatedFrom}].from (${item.from}); each document may move once per batch. Nothing was moved.`, path: ["items", index, "from"] });
            } else sources.set(from, index);
            const repeatedTo = destinations.get(to);
            if (repeatedTo !== undefined) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: `items[${index}].to repeats items[${repeatedTo}].to (${item.to}); two documents cannot move to one path. Nothing was moved.`, path: ["items", index, "to"] });
            } else destinations.set(to, index);
        });
        value.items.forEach((item, index) => {
            const chained = sources.get(fsMvPathKey(item.to));
            if (chained !== undefined && chained !== index) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: `items[${index}].to is the source of items[${chained}]; chained or swapped moves are not supported in one batch. Nothing was moved.`, path: ["items", index, "to"] });
            }
        });
        return;
    }
    for (const key of ["from", "to"] as const) {
        if (typeof value[key] !== "string" || !value[key]!.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${key} is required (or pass items:[{from,to}] for a batch).`, path: [key] });
        }
    }
});

export const FsReorderSchema = z.object({
    action: z.literal("reorder"),
    path: z.string().describe("Human-readable workspace notebook or parent document path. Prefer including the notebook name (e.g., /Notebook or /Notebook/Folder); omission is accepted only for a unique document match."),
    orderedPaths: z.array(z.string()).min(1).describe("Complete ordered list of all visible direct child document workspace paths. Prefer including the notebook name in each path (e.g., /Notebook/Folder/First); an omitted notebook must resolve uniquely."),
});

export const FsSearchSchema = z.object({
    action: z.literal("search"),
    path: z.string().describe("Human-readable workspace document or folder path. Prefer including the notebook name (e.g., /Notebook or /Notebook/Folder); omitting it is accepted only when the scope uniquely matches across readable notebooks."),
    query: z.string().describe("Text or regular expression to search for"),
    regex: z.boolean().optional().describe("Treat query as a JavaScript regular expression"),
    caseSensitive: z.boolean().optional().describe("Use case-sensitive matching"),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).max(200).optional().describe("Matches per page, default 50"),
});
