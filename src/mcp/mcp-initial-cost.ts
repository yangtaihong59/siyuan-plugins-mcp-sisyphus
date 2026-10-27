import type { SiYuanClient } from '../api/client';
import type { ToolConfig } from '../core/config';
import { listAllTools } from './tool-registry';
import { buildServerInstructions } from '../core/server-instructions';
import { approximateTokensFromChars } from '../core/token-usage';
import { MCP_INITIAL_COST_PATH, type McpInitialTokenCost } from '../core/analytics';

/*
 * Server-side measurement of the one-off MCP mount cost (instructions + the
 * tools/list payload). Kept out of analytics.ts so the renderer bundle, which
 * only reads the recorded value, never pulls in tool-registry and every tool
 * schema behind it.
 */

export function measureMcpInitialTokenCost(config: ToolConfig, tools: unknown[]): McpInitialTokenCost {
    const instructions = buildServerInstructions({
        userRulesText: config.userRulesText,
        agentSiyuanMemoryText: config.agentSiyuanMemoryText,
        agentSiyuanMemoryUpdatedAt: config.agentSiyuanMemoryUpdatedAt,
        writeSafety: config.writeSafety,
    }).trim();
    const totalChars = instructions.length + JSON.stringify({ tools }).length;
    return {
        mcpInitialChars: totalChars,
        mcpInitialApproxTokens: approximateTokensFromChars(totalChars),
    };
}

export function calculateMcpInitialTokenCost(config: ToolConfig): McpInitialTokenCost {
    return measureMcpInitialTokenCost(config, listAllTools(config));
}

let lastRecordedChars: number | null = null;

/** Persist the cost actually served by tools/list; skips unchanged values and never throws. */
export async function recordMcpInitialTokenCost(
    client: Pick<SiYuanClient, 'writeFile'>,
    cost: McpInitialTokenCost,
): Promise<void> {
    if (cost.mcpInitialChars === lastRecordedChars) return;
    try {
        await client.writeFile(MCP_INITIAL_COST_PATH, JSON.stringify({ ...cost, measuredAt: Date.now() }));
        lastRecordedChars = cost.mcpInitialChars;
    } catch {
        // Best effort: the settings panel simply shows no value until the next successful write.
    }
}
