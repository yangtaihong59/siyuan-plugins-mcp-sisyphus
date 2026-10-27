import { z } from "zod";
import { NOTEBOOK_ACTIONS } from "../../core/config";
import type { NotebookConf } from "../../types/shared";

const NotebookConfSchema: z.ZodType<Partial<NotebookConf>> = z.object({
    name: z.string().optional(),
    closed: z.boolean().optional(),
    sortMode: z.number().int().optional(),
    refCreateSavePath: z.string().optional(),
    createDocNameTemplate: z.string().optional(),
    dailyNoteSavePath: z.string().optional(),
    dailyNoteTemplatePath: z.string().optional(),
});

export const NotebookActionSchema = z.enum(NOTEBOOK_ACTIONS);

export const NotebookListSchema = z.object({
    action: z.literal("list"),
});

export const NotebookCreateSchema = z.object({
    action: z.literal("create"),
    name: z.string().describe("Notebook name"),
    icon: z.string().optional().describe("Optional notebook icon. Prefer a Unicode hex code string such as '1f4d4' for 📔 instead of a raw emoji character."),
});

export const NotebookSetOpenStateSchema = z.object({
    action: z.literal("set_open_state"),
    notebook: z.string().describe("Notebook ID"),
    opened: z.boolean().describe("true to open, false to close"),
});

export const NotebookRemoveSchema = z.object({
    action: z.literal("remove"),
    notebook: z.string().describe("Notebook ID"),
});

export const NotebookRenameSchema = z.object({
    action: z.literal("rename"),
    notebook: z.string().describe("Notebook ID"),
    name: z.string().describe("New notebook name"),
});

export const NotebookGetConfSchema = z.object({
    action: z.literal("get_conf"),
    notebook: z.string().describe("Notebook ID"),
});

export const NotebookSetConfSchema = z.object({
    action: z.literal("set_conf"),
    notebook: z.string().describe("Notebook ID"),
    conf: NotebookConfSchema.describe("Notebook configuration"),
});

export const NotebookSetIconSchema = z.object({
    action: z.literal("set_icon"),
    notebook: z.string().describe("Notebook ID"),
    icon: z.string().describe("Icon value. Prefer a Unicode hex code string such as '1f4d4' for 📔; raw emoji characters may not render correctly. Custom icon paths are also supported."),
});

export const NotebookGetPermissionsSchema = z.object({
    action: z.literal("get_permissions"),
    notebook: z.string().optional().describe('Notebook ID, or "all" to return every notebook permission entry. Omit to return all notebooks.'),
});

export const NotebookSetPermissionSchema = z.object({
    action: z.literal("set_permission"),
    notebook: z.string().describe("Notebook ID"),
    permission: z.enum(["none", "r", "rw", "rwd"]).describe('Permission level: "none" blocks all access, "r" allows read only, "rw" allows read and write without delete, "rwd" allows read, write, and delete'),
});

export const NotebookGetChildDocsSchema = z.object({
    action: z.literal("get_child_docs"),
    notebook: z.string().describe("Notebook ID"),
    page: z.number().int().positive().optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().positive().optional().describe("Rows per page, default 50"),
});
