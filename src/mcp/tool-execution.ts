import type { SiYuanClient } from '../api/client';
import type { ToolCategory, ToolConfig } from '../core/config';
import type { OfficialMcpRuntime } from '../core/official-mcp-bridge';
import type { PermissionManager } from '../core/permissions';
import type { ToolResult } from '../core/tool-result';
import { validateRegisteredToolArguments } from '../tools/internal/define-tool';
import type { ToolCallPlan } from './tool-call-gate';
import { TOOL_REGISTRY } from './tool-registry';
import { fillImplicitAvViewCarrier } from '../tools/av/carrier';
import type { WriteSafetyCoordinator } from './write-safety-coordinator';

/**
 * The execution half of a tools/call, shared by the Node server, the kernel
 * endpoint and the CLI. planToolCall decides; these helpers run the decision
 * the same way everywhere. Transports only supply their own confirmation UI,
 * scheduling, remote-coordinator routing and rendering. The App-facing half
 * (executeAppTool, finalizeToolResult) lives in mcp-apps.ts so the CLI bundle
 * stays free of the App HTML.
 */

type ToolPlan = Extract<ToolCallPlan, { kind: 'tool' }>;

export interface LocalToolExecution {
    plan: ToolPlan;
    /** Client the handler and coordinator use (the kernel passes its task-scoped client). */
    client: SiYuanClient;
    permMgr: PermissionManager;
    coordinator: WriteSafetyCoordinator;
    config: Pick<ToolConfig, 'writeSafety'>;
    args?: Record<string, unknown>;
    runtime?: OfficialMcpRuntime;
    beforeCommit?: () => void;
}

/** Run a planned tool through the write-safety coordinator, which also passes reads straight through. */
export async function executeLocalTool(execution: LocalToolExecution): Promise<ToolResult> {
    const { plan, client, permMgr, coordinator, runtime } = execution;
    const { category, action } = plan;
    const actionConfig = plan.target.actionConfig as ToolConfig[ToolCategory];
    let args = execution.args ?? plan.args;
    if (category === 'av') args = await fillImplicitAvViewCarrier(client, args);
    return coordinator.run({
        client,
        permMgr,
        category,
        action,
        args,
        strictMode: execution.config.writeSafety.strictMode,
        // One-step writes and read hashes exist only on top of strict writes.
        oneStep: execution.config.writeSafety.strictMode ? execution.config.writeSafety.oneStep : 'off',
        beforeCommit: execution.beforeCommit,
        validateArgs: (safeArgs) => validateRegisteredToolArguments(category, safeArgs),
        execute: (safeArgs) => TOOL_REGISTRY[category].callTool(client, safeArgs, actionConfig, permMgr, runtime),
    });
}

/** Analytics request text for protocol transports; extension arguments are third-party and stay out. */
export function toolCallRequestText(category: ToolCategory, name: string, action: string, input: unknown): string {
    return category === 'extension'
        ? JSON.stringify({ name, action })
        : JSON.stringify({ name, arguments: input ?? {} });
}

/** Download manifests must reach the client intact, so slimming never applies to them. */
export function shouldSlimResponse(config: Pick<ToolConfig, 'debug'>, args: Record<string, unknown>): boolean {
    return config.debug.slimResponses && args.delivery !== 'download';
}
