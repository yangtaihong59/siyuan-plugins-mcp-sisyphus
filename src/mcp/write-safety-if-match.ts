/*
 * Read hashes (`ifMatch`) for writable targets. Both the read side and the
 * write-side verification go through probeCurrentState with one canonical
 * call per target (core/write-safety-policy IfMatchTarget), so a read hash is
 * by construction the strict-preflight state hash of that canonical write.
 * Coordinator-internal: tools never import this module.
 */
import type { SiYuanClient } from '../api/client';
import { normalizeTemplatePath } from '../api/template';
import type { PermissionManager } from '../core/permissions';
import type { ToolResult } from '../core/tool-result';
import { BATCH_ARRAY_KEYS, ONE_STEP_MAX_BATCH, formatIfMatch, getOneStepTier, getReadIfMatchTarget, type IfMatchTarget } from '../core/write-safety-policy';
import { isRecord, parseResultObject } from '../core/write-safety-records';
import type { ToolCategory } from '../core/config';
import { probeCurrentState } from './write-safety-probe';
import { getRegisteredActionSchemas } from '../tools/internal/define-tool';

const IF_MATCH_PROBE_POLICY = { mode: 'mutation', precondition: 'state', validateOnly: true } as const;

function canonicalProbeArgs(target: IfMatchTarget): Record<string, unknown> {
    if (target.kind === 'template' && typeof target.args.path === 'string') {
        // Every accepted template spelling (/data/templates/x.md, /templates/x.md,
        // x.md) names one file; hash it under its one relative path.
        try { return { path: normalizeTemplatePath(target.args.path).relativePath }; } catch { return target.args; }
    }
    return target.args;
}

/** Full sha256:v1 state hash of the target, exactly as the strict probe computes it. */
export async function computeIfMatchHash(
    client: SiYuanClient,
    permMgr: PermissionManager,
    target: IfMatchTarget,
): Promise<string> {
    const probe = await probeCurrentState(client, permMgr, target.category, target.action, canonicalProbeArgs(target), IF_MATCH_PROBE_POLICY);
    return probe.hash;
}

/**
 * Run a mapped read and attach `ifMatch`. The state is hashed BEFORE the read:
 * if the target changes in between, the caller holds an older hash than the
 * content it saw, so a later write fails closed with state_changed instead of
 * silently matching unseen content. A target that cannot be hashed for writing
 * (no write permission, missing, probe failure) simply gets no ifMatch.
 */
export async function executeReadWithIfMatch(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    execute: () => Promise<ToolResult>,
    onIssued?: (ifMatch: string, target: IfMatchTarget) => void,
): Promise<ToolResult> {
    const target = getReadIfMatchTarget(category, action, args);
    if (!target) return execute();
    let hash: string | undefined;
    try {
        hash = await computeIfMatchHash(client, permMgr, target);
    } catch {
        hash = undefined;
    }
    const result = await execute();
    if (!hash || result.isError) return result;
    const ifMatch = formatIfMatch(hash);
    onIssued?.(ifMatch, target);
    // Name what the hash covers: get_children's is the parent's, not a child's.
    return addTopLevelField(addTopLevelField(result, 'ifMatch', ifMatch), 'ifMatchTarget', ifMatchTargetKey(target));
}

/** The id or path an ifMatch describes. */
export function ifMatchTargetKey(target: IfMatchTarget): string {
    return String(Object.values(canonicalProbeArgs(target))[0] ?? '');
}

/** The read that returns a fresh ifMatch for exactly this target (MCP form; the CLI translates it). */
export function ifMatchReadCall(target: IfMatchTarget): string {
    const key = ifMatchTargetKey(target);
    switch (target.kind) {
        case 'block': return `block(action="get_kramdown", id="${key}")`;
        case 'fs_path': return `fs(action="read", path="${key}")`;
        case 'av': return `av(action="get", avID="${key}")`;
        case 'template': return `file(action="read_template", path="${key}")`;
    }
}

/**
 * With one-step enabled, action help for a one-step-eligible write says so;
 * with it off, help stays byte-identical to the two-step contract.
 */
export function annotateHelpWithOneStep(category: ToolCategory, args: Record<string, unknown>, result: ToolResult): ToolResult {
    const topic = typeof args.topic === 'string' ? args.topic : '';
    if (!topic || result.isError) return result;
    const tier = getOneStepTier(category, topic, {});
    if (tier === 3) return result;
    const lists = oneStepBatchFields(category, topic);
    const limit = lists.length ? ` (${lists.join('/')} lists of up to ${ONE_STEP_MAX_BATCH} entries)` : '';
    const rule = tier === 1
        ? `Enabled: may commit without validateOnly${limit}; the receipt includes the preview.${category === 'fs' && topic === 'write' ? ' overwrite=true additionally needs ifMatch from a fresh read.' : ''}`
        : 'Enabled: may commit without validateOnly only with ifMatch from a fresh read of the target; otherwise use the two steps.';
    const annotated = addTopLevelField(result, 'oneStep', { tier, rule });
    return tier === 1 ? withOneStepExamples(annotated) : annotated;
}

/** Tier-1 examples commit in one step: drop the preflight flag and "(preflight first)" labels. */
function withOneStepExamples(result: ToolResult): ToolResult {
    const payload = parseResultObject(result);
    if (!payload || !Array.isArray(payload.examples)) return result;
    const examples = payload.examples.map((example) => {
        if (!isRecord(example)) return example;
        const next: Record<string, unknown> = { ...example };
        if (typeof next.title === 'string') next.title = next.title.replace(/\s*\(preflight first\)/i, '');
        if (typeof next.description === 'string') next.description = next.description.replace(/Writes are two steps:[^.]*\.\s*/i, '');
        if (isRecord(next.mcp) && next.mcp.validateOnly === true) {
            const { validateOnly: _validateOnly, ...mcp } = next.mcp;
            next.mcp = mcp;
        }
        return next;
    });
    return addTopLevelField(result, 'examples', examples);
}

/** Item-list arguments this action accepts that count toward the one-step batch limit. */
export function oneStepBatchFields(category: ToolCategory, action: string): string[] {
    const schema = getRegisteredActionSchemas()[category]?.[action];
    const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
    const isArray = (value: unknown): boolean => isRecord(value) && (value.type === 'array'
        || [value.anyOf, value.oneOf].some((options) => Array.isArray(options) && options.some(isArray)));
    return BATCH_ARRAY_KEYS.filter((key) => isArray(properties[key]));
}

function addTopLevelField(result: ToolResult, key: string, value: unknown): ToolResult {
    const payload = parseResultObject(result);
    if (!payload || !isRecord(payload)) return result;
    const next = { ...payload, [key]: value };
    const textIndex = result.content.findIndex((item) => item.type === 'text');
    if (textIndex < 0) return result;
    const content = [...result.content];
    content[textIndex] = { type: 'text', text: JSON.stringify(next, null, 2) };
    return {
        ...result,
        content,
        ...(result.structuredContent ? { structuredContent: next } : {}),
    };
}
