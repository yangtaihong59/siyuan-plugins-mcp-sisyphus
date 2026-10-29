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
import { ONE_STEP_MAX_BATCH, formatIfMatch, getOneStepTier, getReadIfMatchTarget, type IfMatchTarget } from '../core/write-safety-policy';
import { isRecord, parseResultObject } from '../core/write-safety-records';
import type { ToolCategory } from '../core/config';
import { probeCurrentState } from './write-safety-probe';

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
    return addTopLevelField(result, 'ifMatch', formatIfMatch(hash));
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
    const rule = tier === 1
        ? `Enabled: may commit without validateOnly (up to ${ONE_STEP_MAX_BATCH} items); the receipt includes the preview.${category === 'fs' && topic === 'write' ? ' overwrite=true additionally needs ifMatch from a fresh read.' : ''}`
        : 'Enabled: may commit without validateOnly only with ifMatch from a fresh read of the target; otherwise use the two steps.';
    return addTopLevelField(result, 'oneStep', { tier, rule });
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
