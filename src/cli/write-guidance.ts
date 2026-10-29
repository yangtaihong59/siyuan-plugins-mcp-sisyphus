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
export function formatPreflightFooter(commitCommand: string, expiresAt?: number): string {
    const expiry = typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? ` (expires ${formatClock(expiresAt)})` : '';
    return `\nPreflight valid${expiry} — check the target and changes above, then commit with:\n  ${commitCommand}\n`;
}

export interface CliWriteGuidance {
    result: ToolResult;
    /** Paste-ready commit command after a successful preflight. */
    commitCommand?: string;
    /** Human output only: the preflight's write-impact preview, formatted for the terminal. */
    previewLines?: string[];
    /** Human output only: print the preview before the (remaining) result. */
    previewFirst?: boolean;
    /** Human output only: nothing is left to render besides the preview and footer. */
    hideResult?: boolean;
    /** Human output only: one-line write receipt that replaces the safety block. */
    statusLine?: string;
    /** Human output only: preflight deadline for the footer. */
    expiresAt?: number;
}

/*
 * Coordinator bookkeeping on a preflight. The printed commit command already
 * carries the request ID and hash, so human output hides these; --json and
 * --debug keep them. requestIdExpiresAt, leaseExpiresAt, ttlMs and a
 * top-level targetCount are only sent by servers before 0.7.0.
 */
const PREFLIGHT_META_KEYS = new Set([
    'action', 'validateOnly', 'writeSafetyMode', 'writeAttempted', 'writeExecuted', 'requestId', 'requestIdExpiresAt',
    'expiresAt', 'ttlMs', 'preflight', 'preconditionField', 'hashPrefixLength', 'leaseExpiresAt', 'targetCount',
]);

function isPreflightMetaKey(key: string): boolean {
    return PREFLIGHT_META_KEYS.has(key) || /^expected[A-Z]\w*Hash$/.test(key);
}

/** `json` adds commitCommand to the payload; human output prints it once, untruncated, after the preview. */
export function applyCliWriteGuidance(result: ToolResult, tool: string, json = true, debug = false): CliWriteGuidance {
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
    let previewFirst = false;
    let statusLine: string | undefined;
    let expiresAt: number | undefined;
    if (!result.isError && payload.validateOnly === true && isRecord(payload.preflight?.commitArgs)) {
        commitCommand = buildCliCommand(tool, payload.preflight.commitArgs);
        if (json) {
            payload = { ...payload, commitCommand };
        } else {
            // Preview, then the commit command; the bookkeeping rides in the command.
            if (isRecord(payload.preview)) previewLines = formatWritePreview(payload.preview);
            previewFirst = true;
            if (typeof payload.expiresAt === 'number') expiresAt = payload.expiresAt;
            payload = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'preview' && (debug || !isPreflightMetaKey(key))));
        }
    } else if (!result.isError && isRecord(payload.safety) && !json) {
        // Commit / one-step receipt: the result first, then what changed, then one status line.
        if (isRecord(payload.oneStep) && isRecord(payload.preview)) {
            previewLines = formatWritePreview(payload.preview, `Preview (committed in one step${typeof payload.oneStep.tier === 'number' ? `, tier ${payload.oneStep.tier}` : ''}; verify it matches the intent):`);
        }
        if (!debug) {
            statusLine = formatSafetyStatus(payload.safety, isRecord(payload.oneStep) ? payload.oneStep : undefined);
            const { safety, oneStep: _oneStep, preview: _preview, ...rest } = payload;
            // Batch progress is the result for partial outcomes; keep it.
            payload = { ...rest, ...(isRecord(safety.addRows) ? { addRows: safety.addRows } : {}), ...(isRecord(safety.rename) ? { rename: safety.rename } : {}) };
        } else {
            const { preview: _preview, ...rest } = payload;
            payload = rest;
        }
    } else if (!result.isError && !json && !debug && payload.replayed === true && typeof payload.transactionState === 'string' && payload.success === undefined) {
        // A replayed commit whose ledger kept only the receipt: the payload is the safety record.
        statusLine = formatSafetyStatus(payload);
        payload = { ...(isRecord(payload.addRows) ? { addRows: payload.addRows } : {}), ...(isRecord(payload.rename) ? { rename: payload.rename } : {}) };
    } else if (result.isError && isRecord(payload.error) && PREFLIGHT_REQUIRED_CODES.has(payload.error.code)) {
        // A one-step refusal already names its reason in error.message and
        // error.oneStep; the hint gives the CLI spelling of the two-step path.
        payload = { ...payload, error: { ...payload.error, hint: CLI_PREFLIGHT_HINT } };
    } else if (!result.isError && isRecord(payload.removeDefaultColumn?.arguments)) {
        payload = withDefaultColumnStep(payload, tool, json);
    } else {
        return { result };
    }
    // av create carries both a safety receipt and the default-column step.
    if (!json && !result.isError && isRecord(payload.removeDefaultColumn?.arguments)) payload = withDefaultColumnStep(payload, tool, json);

    const content = [...result.content];
    content[index] = { type: 'text', text: JSON.stringify(payload) };
    const structured = isRecord(result.structuredContent) ? { structuredContent: payload } : {};
    return {
        result: { ...result, content, ...structured } as ToolResult,
        commitCommand,
        ...(previewLines ? { previewLines } : {}),
        ...(previewFirst ? { previewFirst } : {}),
        ...(!json && Object.keys(payload).length === 0 ? { hideResult: true } : {}),
        ...(statusLine ? { statusLine } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
}

function withDefaultColumnStep(payload: Record<string, any>, tool: string, json: boolean): Record<string, any> {
    // av create names SiYuan's default select column; give its paste-ready removal preflight.
    const { tool: stepTool, arguments: stepArgs } = payload.removeDefaultColumn;
    const cliCommand = `${buildCliCommand(typeof stepTool === 'string' ? stepTool : tool, stepArgs)}${stepArgs.validateOnly === true ? ' --validate-only' : ''}`;
    if (json) return { ...payload, removeDefaultColumn: { ...payload.removeDefaultColumn, cliCommand } };
    // One line for the reader; the step object and the column list stay in --json.
    const names = Array.isArray(payload.defaultColumns)
        ? payload.defaultColumns.filter(isRecord).map((column: Record<string, any>) => `«${String(column.name || column.keyID)}»`)
        : [];
    const { removeDefaultColumn: _step, defaultColumns: _columns, ...rest } = payload;
    return { ...rest, defaultColumnNote: `SiYuan added a default select column${names.length ? ` ${names.join(', ')}` : ''}; keep it (kanban needs one) or remove it with: ${cliCommand}` };
}

/** What a one-step tier means, for the receipt line. */
const ONE_STEP_TIER_MEANING: Record<number, string> = {
    1: 'tier 1: additive or name-only change, no --if-match needed',
    2: 'tier 2: overwrite guarded by --if-match',
};

/** One line for a commit receipt; the hashes and flags stay in --json / --debug. */
export function formatSafetyStatus(safety: Record<string, any>, oneStep?: Record<string, any>): string {
    const state = String(safety.transactionState ?? (safety.writeExecuted === true ? 'committed' : 'unknown'));
    const parts = [
        safety.replayed === true
            ? 'replayed — this request ID already ran; nothing was executed again'
            : state === 'no_change' ? 'no change — the target already had this content' : state,
    ];
    if (oneStep) parts.push(`one step${typeof oneStep.tier === 'number' ? ` (${ONE_STEP_TIER_MEANING[oneStep.tier] ?? `tier ${oneStep.tier}`})` : ''}`);
    if (safety.writeSafetyGuaranteed === false) parts.push(`not covered by strict write safety${safety.reason ? ` (${safety.reason})` : ''}`);
    if (typeof safety.requestId === 'string') parts.push(`request ${safety.requestId}`);
    return `Write: ${parts.join(' · ')}`;
}

function formatClock(epochMs: number): string {
    const date = new Date(epochMs);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Terminal rendering of a preflight `preview` object (targets, changes, risk). */
export function formatWritePreview(preview: Record<string, any>, heading = 'Preview (read it before committing):'): string[] {
    if (typeof preview.error === 'string') return [`Preview unavailable: ${preview.error}`];
    const lines: string[] = [heading];
    const targets = Array.isArray(preview.targets) ? preview.targets.filter(isRecord) : [];
    const changes = Array.isArray(preview.changes) ? preview.changes.filter(isRecord) : [];
    // find_replace: targets are the scope ids that change; the rest were only scanned.
    const scan = changes.find((change) => change.kind === 'find_replace' && typeof change.unchangedScopeCount === 'number');
    if (targets.length > 0) {
        const more = typeof preview.targetCount === 'number' && preview.targetCount > targets.length
            ? ` (${targets.length} of ${preview.targetCount})`
            : '';
        lines.push(`  ${scan ? 'Will change' : 'Targets'}${more}:`);
        for (const target of targets) lines.push(`    - ${formatTarget(target)}`);
    }
    if (scan && scan.unchangedScopeCount > 0) {
        const ids = Array.isArray(scan.unchangedScopeIds) ? scan.unchangedScopeIds.map(String) : [];
        const shown = ids.length > 0 ? `: ${ids.join(', ')}${scan.unchangedScopeCount > ids.length ? ', …' : ''}` : '';
        lines.push(`  Scanned, no match (${scan.unchangedScopeCount})${shown}`);
    }
    if (changes.length > 0) {
        lines.push('  Changes:');
        for (const change of changes) {
            // Previews name the MCP argument; the CLI spells it as a flag.
            lines.push(`    - ${String(change.summary ?? change.kind ?? '').replace(/\bpreview="full"/g, '--preview full')}`);
            for (const [key, value] of Object.entries(change)) {
                if (key === 'kind' || key === 'summary' || key === 'unchangedScopeIds') continue;
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
    // Receipts describe targets as they were before the write.
    else if (typeof target.excerptBefore === 'string' && target.excerptBefore) parts.push(`(before the write) "${target.excerptBefore}"`);
    if (typeof target.hPath === 'string' && target.hPath) parts.push(target.hPath);
    if (typeof target.position === 'string' && target.position) parts.push(`(${target.position})`);
    if (typeof target.matchCount === 'number') parts.push(`— ${target.matchCount} match(es)`);
    if (isRecord(target.notebook)) {
        const notebook = target.notebook;
        parts.push(`[notebook ${notebook.name ?? notebook.id}${notebook.permission ? `, ${notebook.permission}` : ''}]`);
    }
    return parts.join(' ');
}

/** Before/after text and example lists are the reviewable detail; counts already sit in the summary. */
function formatDetail(key: string, value: unknown, indent: string): string[] {
    if ((key === 'recovery' || key === 'note') && typeof value === 'string') return [`${indent}${key}: ${value}`];
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
