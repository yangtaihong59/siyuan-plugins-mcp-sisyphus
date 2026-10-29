import { z } from "zod";
import { FEEDBACK_ACTIONS } from "../../core/config";

export const FeedbackActionSchema = z.enum(FEEDBACK_ACTIONS);

export const FeedbackSubmitSchema = z.object({
    action: z.literal("submit"),
    description: z.string().trim().min(1).max(4000).describe("Required feedback text. Prefer a GitHub Issue-style body for bugs, confusing behavior, or rough workflows, with headings such as ## Summary, ## What happened, ## Expected behavior, ## Steps or context, ## Impact, and ## Suggested fix."),
    impact: z.string().trim().max(1000).optional().describe("Optional one- or two-sentence impact summary, such as affected workflow, error risk, confusion, or inconvenience."),
    suggestion: z.string().trim().max(1000).optional().describe("Optional direct improvement suggestion; keep it focused and avoid repeating the full description."),
    agent: z.string().trim().max(200).optional().describe("Optional Agent product and model name, such as Claude Desktop / Claude Sonnet 4.5. Defaults to 无."),
    source: z.string().trim().max(100).optional().describe("Internal source label. Defaults to the current runtime transport."),
});
