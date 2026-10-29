import { z } from "zod";
import { TAG_ACTIONS } from "../../core/config";

export const TagActionSchema = z.enum(TAG_ACTIONS);

export const TagListSchema = z.object({
    action: z.literal("list"),
    keyword: z.string().optional().describe("Optional keyword used to search/filter tags"),
    query: z.string().optional().describe("Alias for keyword"),
    sort: z.number().optional().describe("Optional tag sort mode"),
    ignoreMaxListHint: z.boolean().optional().describe("Ignore the maximum list hint from SiYuan"),
    app: z.string().optional().describe("Optional app identifier passed through to SiYuan"),
});

export const TagRenameSchema = z.object({
    action: z.literal("rename"),
    oldLabel: z.string().describe("Existing tag label"),
    newLabel: z.string().describe("New tag label"),
});

export const TagRemoveSchema = z.object({
    action: z.literal("remove"),
    label: z.string().describe("Tag label to remove"),
});
