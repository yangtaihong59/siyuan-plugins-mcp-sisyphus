import { z } from "zod";

/** One exact-text edit, shared by fs(action="replace") and block(action="replace"). */
export const ReplaceEditSchema = z.object({
    old: z.string().min(1).describe("Original text to match exactly. Supports multi-line strings."),
    new: z.string().describe("Replacement text. Supports multi-line strings."),
    replace_all: z.boolean().optional().describe("When true, replace every exact match. Defaults to false."),
});
