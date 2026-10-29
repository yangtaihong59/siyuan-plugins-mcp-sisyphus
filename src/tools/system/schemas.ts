import { z } from "zod";
import { SYSTEM_ACTIONS } from "../../core/config";

export const SystemActionSchema = z.enum(SYSTEM_ACTIONS);

export const SystemWorkspaceInfoSchema = z.object({
    action: z.literal("workspace_info"),
});

export const SystemNetworkSchema = z.object({
    action: z.literal("network"),
});

export const SystemConfSchema = z.object({
    action: z.literal("conf"),
    mode: z.enum(["summary", "get"]).optional().describe('Read mode: "summary" returns a navigable overview, "get" reads a specific key path'),
    keyPath: z.string().optional().describe('Dot/bracket path to a specific config field, e.g. "conf.appearance.mode" or "conf.langs[0]"'),
    maxDepth: z.number().int().min(0).max(5).optional().describe('Maximum object traversal depth for summary/get responses'),
    maxItems: z.number().int().min(1).max(100).optional().describe('Maximum keys/items to include per level'),
});

export const SystemNotifySchema = z.object({
    action: z.literal("notify"),
    msg: z.string().describe("Message content"),
    level: z.enum(["info", "error"]).describe("Notification level"),
    timeout: z.number().optional().describe("Display timeout in milliseconds"),
});

export const SystemChangelogSchema = z.object({
    action: z.literal("changelog"),
    version: z.string().optional().describe("Exact plugin version to read, e.g. 0.4.11 or v0.4.11"),
    fromVersion: z.string().optional().describe("Previous plugin version; returns entries newer than this version"),
    limit: z.number().int().min(1).max(50).optional().describe("Maximum number of entries to return when version is omitted"),
    includeRaw: z.boolean().optional().describe("Include raw Markdown for each returned changelog entry"),
});

export const SystemPerformSyncSchema = z.object({
    action: z.literal("perform_sync"),
});

export const SystemGetVersionSchema = z.object({
    action: z.literal("get_version"),
});

export const SystemGetCurrentTimeSchema = z.object({
    action: z.literal("get_current_time"),
});
