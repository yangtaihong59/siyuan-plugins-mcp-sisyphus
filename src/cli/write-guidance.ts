import { PRIMARY_CLI_COMMAND } from '../shared/constants';
import type { ToolResult } from '../tools/internal/shared';

/*
 * Strict writes are two steps (validateOnly preflight, then commit with the
 * server-issued requestId and any expected*Hash). The coordinator speaks MCP
 * field names; this layer turns its output into CLI next steps.
 */

const PREFLIGHT_REQUIRED_CODES = new Set(['precondition_required', 'invalid_request_id']);

export const CLI_PREFLIGHT_HINT = 'Writes are two steps: rerun this exact command with --validate-only, then run the commit command it prints (it already carries --request-id and any --expected-*-hash).';

export interface CliWriteGuidance {
    result: ToolResult;
    /** Paste-ready commit command after a successful preflight. */
    commitCommand?: string;
}

/** `json` adds commitCommand to the payload; human output prints it once, untruncated, after the result. */
export function applyCliWriteGuidance(result: ToolResult, tool: string, json = true): CliWriteGuidance {
    const index = result.content.findIndex((item) => item.type === 'text');
    if (index < 0) return { result };
    let payload: Record<string, any>;
    try {
        payload = JSON.parse((result.content[index] as { text: string }).text);
    } catch {
        return { result };
    }
    if (!payload || typeof payload !== 'object') return { result };

    let commitCommand: string | undefined;
    if (!result.isError && payload.validateOnly === true && isRecord(payload.preflight?.commitArgs)) {
        commitCommand = buildCliCommand(tool, payload.preflight.commitArgs);
        if (!json) return { result, commitCommand };
        payload = { ...payload, commitCommand };
    } else if (result.isError && isRecord(payload.error) && PREFLIGHT_REQUIRED_CODES.has(payload.error.code)) {
        payload = { ...payload, error: { ...payload.error, hint: CLI_PREFLIGHT_HINT } };
    } else if (!result.isError && isRecord(payload.removeDefaultColumn?.arguments)) {
        // av create names SiYuan's default select column; give its paste-ready removal preflight.
        const { tool: stepTool, arguments: stepArgs } = payload.removeDefaultColumn;
        payload = { ...payload, removeDefaultColumn: {
            ...payload.removeDefaultColumn,
            cliCommand: `${buildCliCommand(typeof stepTool === 'string' ? stepTool : tool, stepArgs)}${stepArgs.validateOnly === true ? ' --validate-only' : ''}`,
        } };
    } else {
        return { result };
    }

    const content = [...result.content];
    content[index] = { type: 'text', text: JSON.stringify(payload) };
    const structured = isRecord(result.structuredContent) ? { structuredContent: payload } : {};
    return { result: { ...result, content, ...structured } as ToolResult, commitCommand };
}

export function buildCliCommand(tool: string, args: Record<string, unknown>): string {
    const parts = [PRIMARY_CLI_COMMAND, tool, String(args.action ?? '')];
    for (const [key, value] of Object.entries(args)) {
        if (key === 'action' || key === 'validateOnly' || value === undefined || value === null) continue;
        const flag = `--${toKebab(key)}`;
        if (typeof value === 'boolean') parts.push(value ? flag : `--no-${toKebab(key)}`);
        else if (typeof value === 'string' || typeof value === 'number') parts.push(flag, shellQuote(String(value)));
        else parts.push(`${flag}-json`, shellQuote(JSON.stringify(value)));
    }
    return parts.join(' ');
}

function toKebab(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function shellQuote(value: string): string {
    return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
