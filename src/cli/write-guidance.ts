import { PRIMARY_CLI_COMMAND } from '../shared/constants';
import type { ToolResult } from '../tools/internal/shared';

/*
 * Strict writes are two steps (validateOnly preflight, then commit with the
 * server-issued requestId and any expected*Hash). The coordinator speaks MCP
 * field names; this layer turns its output into CLI next steps.
 */

const PREFLIGHT_REQUIRED_CODES = new Set(['precondition_required', 'invalid_request_id']);

export const CLI_PREFLIGHT_HINT = 'Writes are two steps: rerun this exact command with --validate-only, check the preview it prints, then run the commit command it prints (it already carries --request-id and any --expected-*-hash).';

/** Human output after a preflight: neutral, since "valid" is not "the right target". */
export function formatPreflightFooter(commitCommand: string): string {
    return `\nPreflight valid — check the target and changes above, then commit with:\n  ${commitCommand}\n`;
}

export interface CliWriteGuidance {
    result: ToolResult;
    /** Paste-ready commit command after a successful preflight. */
    commitCommand?: string;
    /** Human output only: the preflight's write-impact preview, formatted for the terminal. */
    previewLines?: string[];
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
    let previewLines: string[] | undefined;
    if (!result.isError && payload.validateOnly === true && isRecord(payload.preflight?.commitArgs)) {
        commitCommand = buildCliCommand(tool, payload.preflight.commitArgs);
        if (json) {
            payload = { ...payload, commitCommand };
        } else {
            if (!isRecord(payload.preview)) return { result, commitCommand };
            // Printed once in readable form before the commit command instead
            // of through the generic renderer.
            previewLines = formatWritePreview(payload.preview);
            const { preview: _preview, ...rest } = payload;
            payload = rest;
        }
    } else if (!result.isError && isRecord(payload.oneStep) && isRecord(payload.preview)) {
        // One-step receipt: the write already ran; show what it changed.
        if (json) return { result };
        previewLines = formatWritePreview(payload.preview, 'Preview (committed in one step; verify it matches the intent):');
        const { preview: _preview, ...rest } = payload;
        payload = rest;
    } else if (result.isError && isRecord(payload.error) && PREFLIGHT_REQUIRED_CODES.has(payload.error.code)) {
        // A one-step refusal already names its reason in error.message and
        // error.oneStep; the hint gives the CLI spelling of the two-step path.
        payload = { ...payload, error: { ...payload.error, hint: CLI_PREFLIGHT_HINT } };
    } else if (!result.isError && isRecord(payload.removeDefaultColumn?.arguments)) {
        // av create names SiYuan's default select column; give its paste-ready removal preflight.
        const { tool: stepTool, arguments: stepArgs } = payload.removeDefaultColumn;
        const cliCommand = `${buildCliCommand(typeof stepTool === 'string' ? stepTool : tool, stepArgs)}${stepArgs.validateOnly === true ? ' --validate-only' : ''}`;
        if (json) {
            payload = { ...payload, removeDefaultColumn: { ...payload.removeDefaultColumn, cliCommand } };
        } else {
            // One line for the reader; the step object and the column list stay in --json.
            const names = Array.isArray(payload.defaultColumns)
                ? payload.defaultColumns.filter(isRecord).map((column: Record<string, any>) => `«${String(column.name || column.keyID)}»`)
                : [];
            const { removeDefaultColumn: _step, defaultColumns: _columns, ...rest } = payload;
            payload = { ...rest, defaultColumnNote: `SiYuan added a default select column${names.length ? ` ${names.join(', ')}` : ''}; keep it (kanban needs one) or remove it with: ${cliCommand}` };
        }
    } else {
        return { result };
    }

    const content = [...result.content];
    content[index] = { type: 'text', text: JSON.stringify(payload) };
    const structured = isRecord(result.structuredContent) ? { structuredContent: payload } : {};
    return { result: { ...result, content, ...structured } as ToolResult, commitCommand, ...(previewLines ? { previewLines } : {}) };
}

/** Terminal rendering of a preflight `preview` object (targets, changes, risk). */
export function formatWritePreview(preview: Record<string, any>, heading = 'Preview (read it before committing):'): string[] {
    if (typeof preview.error === 'string') return [`Preview unavailable: ${preview.error}`];
    const lines: string[] = [heading];
    const targets = Array.isArray(preview.targets) ? preview.targets.filter(isRecord) : [];
    if (targets.length > 0) {
        const more = typeof preview.targetCount === 'number' && preview.targetCount > targets.length
            ? ` (${targets.length} of ${preview.targetCount})`
            : '';
        lines.push(`  Targets${more}:`);
        for (const target of targets) lines.push(`    - ${formatTarget(target)}`);
    }
    const changes = Array.isArray(preview.changes) ? preview.changes.filter(isRecord) : [];
    if (changes.length > 0) {
        lines.push('  Changes:');
        for (const change of changes) {
            // Previews name the MCP argument; the CLI spells it as a flag.
            lines.push(`    - ${String(change.summary ?? change.kind ?? '').replace(/\bpreview="full"/g, '--preview full')}`);
            for (const [key, value] of Object.entries(change)) {
                if (key === 'kind' || key === 'summary') continue;
                lines.push(...formatDetail(key, value, '        '));
            }
        }
    }
    // "workspace_wide" says what the action can reach; add what it reaches now.
    const reach = changes.find((change) => typeof change.blockCount === 'number' && typeof change.notebookCount === 'number');
    const risk = Array.isArray(preview.risk)
        ? preview.risk.map(String).map((flag: string) => flag === 'workspace_wide' && reach
            ? `${flag} — currently ${reach.blockCount} block(s) in ${reach.notebookCount} notebook(s)`
            : flag)
        : [];
    lines.push(`  Risk: ${risk.length > 0 ? risk.join(', ') : 'none flagged'}`);
    return lines;
}

function formatTarget(target: Record<string, any>): string {
    const name = target.title ?? target.excerpt;
    const parts = [`${String(target.kind ?? 'target')} ${String(target.id ?? '')}`];
    if (typeof name === 'string' && name) parts.push(`"${name}"`);
    if (typeof target.hPath === 'string' && target.hPath) parts.push(target.hPath);
    if (typeof target.position === 'string' && target.position) parts.push(`(${target.position})`);
    if (isRecord(target.notebook)) {
        const notebook = target.notebook;
        parts.push(`[notebook ${notebook.name ?? notebook.id}${notebook.permission ? `, ${notebook.permission}` : ''}]`);
    }
    return parts.join(' ');
}

/** Before/after text and example lists are the reviewable detail; counts already sit in the summary. */
function formatDetail(key: string, value: unknown, indent: string): string[] {
    if (key === 'before' || key === 'after' || key === 'from' || key === 'to') {
        if (typeof value === 'string') return [`${indent}${key}: ${value}`];
        if (Array.isArray(value)) return [`${indent}${key}: ${value.map(String).join(' | ')}`];
        return [];
    }
    if (!Array.isArray(value) || value.length === 0) return [];
    // Name lists (attribute names, notebook names) read best on one line; excerpts keep one per line.
    if (/Attributes$|NotebooksSkipped$|^defaultColumns$/.test(key) && value.every((item) => typeof item === 'string')) return [`${indent}${key}: ${value.join(', ')}`];
    const lines: string[] = [];
    for (const item of value) {
        if (isRecord(item) && typeof item.before === 'string' && typeof item.after === 'string') {
            lines.push(`${indent}${key}: ${item.before}`, `${indent}${' '.repeat(key.length)}→ ${item.after}`);
        } else if (isRecord(item) && Array.isArray(item.examples)) {
            for (const example of item.examples) lines.push(...formatDetail(key, [example], indent));
        } else if (isRecord(item)) {
            lines.push(`${indent}${key}: ${Object.entries(item).map(([name, field]) => `${name}=${typeof field === 'string' ? field : JSON.stringify(field)}`).join(', ')}`);
        } else {
            lines.push(`${indent}${key}: ${String(item)}`);
        }
    }
    return lines;
}

export function buildCliCommand(tool: string, args: Record<string, unknown>): string {
    // Kebab-case like the help and the examples; the dispatcher accepts both.
    const parts = [PRIMARY_CLI_COMMAND, tool, String(args.action ?? '').replace(/_/g, '-')];
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
