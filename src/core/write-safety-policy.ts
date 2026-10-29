import {
    ACTION_SPECS_BY_CATEGORY,
    ACTIONS_BY_CATEGORY,
    isDangerousAction,
    type ToolActionMap,
    type ToolCategory,
    type WriteOneStepMode,
} from './config';

import { external, mutation, read, type ActionSafetyPolicy, type ActionSpec, type WritePrecondition } from './action-spec';

export type { ActionSafetyPolicy, WritePrecondition };

/**
 * Authoritative classification for every Sisyphus-owned action, derived from
 * the per-tool declarations (src/tools/<tool>/actions.ts). ActionSpec makes
 * the policy a required field, so an unclassified action cannot be declared.
 */
export const ACTION_SAFETY_POLICIES: {
    [Category in ToolCategory]: Record<ToolActionMap[Category], ActionSafetyPolicy>;
} = Object.fromEntries(
    Object.entries(ACTION_SPECS_BY_CATEGORY).map(([category, specs]) => [
        category,
        Object.fromEntries(Object.entries(specs as Record<string, ActionSpec>).map(([action, spec]) => [action, spec.policy])),
    ]),
) as { [Category in ToolCategory]: Record<ToolActionMap[Category], ActionSafetyPolicy> };

export const PRECONDITION_FIELD: Record<Exclude<WritePrecondition, 'none'>, string> = {
    state: 'expectedStateHash',
    structure: 'expectedStructureHash',
    value: 'expectedValueHash',
    manifest: 'expectedManifestHash',
    source: 'expectedSourceHash',
};

export function getActionSafetyPolicy(
    category: ToolCategory,
    action: string,
    args: Record<string, unknown> = {},
): ActionSafetyPolicy {
    // Dynamic official-MCP actions are external and may have unknown effects.
    // The named Sisyphus diagnostics above are local/read-only exceptions and
    // must remain declared in ACTION_SAFETY_POLICIES as the action set grows.
    if (category === 'extension'
        && action !== 'list'
        && action !== 'validate_package'
        && action !== 'diagnose_plugin_mcp'
        && action !== 'help') return external();
    const policy = (ACTION_SAFETY_POLICIES[category] as Record<string, ActionSafetyPolicy>)[action];
    if (!policy) return read();

    // Creating a new fs document is additive. Overwrite=true modifies an
    // existing document and therefore needs a current-state precondition.
    if (category === 'fs' && action === 'write' && args.overwrite !== true) {
        return mutation();
    }
    if (category === 'file' && action === 'create_template' && args.overwrite !== true) {
        return mutation();
    }
    if (category === 'av' && action === 'add_rows' && Array.isArray(args.rows)) {
        // A composite row+cell creation must freeze the AV definition, target
        // view, carrier, and default-fill configuration it validated. The
        // legacy bound/detached row paths stay additive.
        return mutation('state');
    }
    if (category === 'document' && action === 'rename' && Array.isArray(args.items)) {
        // A batch rename freezes every document identity and target path it
        // validated, even though each individual kernel rename is independent.
        return mutation('state');
    }
    // Existing-target resolution never changes SiYuan state: both resolve and
    // reuse require only read permission and return the exact supplied IDs.
    // Creation alone freezes the parent child list under a structural lease.
    // That credential catches a same-title collision or concurrent child
    // creation between preflight and the final dispatch.
    if (category === 'document' && action === 'ensure_link_targets') {
        return args.dryRun === true || args.mode === 'resolve' || args.mode === 'reuse'
            ? read()
            : mutation('structure');
    }
    return policy;
}

/**
 * Return every safety policy reachable by an action's schema branch.
 *
 * A few actions switch between read and mutation based on arguments. The
 * registry uses this helper to advertise the union of fields required by all
 * runtime paths, keeping schema decoration and dispatch on one policy source.
 */
export function getPossibleActionSafetyPolicies(category: ToolCategory, action: string): ActionSafetyPolicy[] {
    const policies = [getActionSafetyPolicy(category, action)];
    if (category === 'fs' && action === 'write') {
        policies.push(getActionSafetyPolicy(category, action, { overwrite: true }));
    }
    if (category === 'file' && action === 'create_template') {
        policies.push(getActionSafetyPolicy(category, action, { overwrite: true }));
    }
    return policies;
}

export function assertActionSafetyPoliciesComplete(): void {
    for (const [category, actions] of Object.entries(ACTIONS_BY_CATEGORY) as Array<[
        ToolCategory,
        readonly string[],
    ]>) {
        const policies = ACTION_SAFETY_POLICIES[category] as Record<string, ActionSafetyPolicy>;
        for (const action of actions) {
            if (!policies[action]) throw new Error(`Missing write-safety policy for ${category}.${action}.`);
        }
    }
}

/*
 * ---------------------------------------------------------------------------
 * Read hashes (ifMatch) and opt-in one-step commits.
 *
 * A read of a writable target can return `ifMatch`, the leading digits of the
 * same sha256:v1 state hash the strict preflight probe computes. Writes accept
 * it back as a precondition. To keep "read hash == preflight hash" true by
 * construction, reads and writes of one target are both hashed through one
 * canonical probe call per target kind (IfMatchTarget). It equals the
 * preflight credential of that canonical write exactly (block.update {id},
 * fs.write {path}, av.set_cells {avID}, file.update_template {path}); sibling
 * writes on the same target compare against the same canonical hash.
 * ---------------------------------------------------------------------------
 */

/** Hex digits of the state digest a read returns as ifMatch (64 bits). */
export const IF_MATCH_HEX_LENGTH = 16;
export const IF_MATCH_PATTERN = `^(?:sha256:v1:)?[a-fA-F0-9]{${IF_MATCH_HEX_LENGTH},64}$`;

export type IfMatchTargetKind = 'block' | 'fs_path' | 'av' | 'template';

export interface IfMatchTarget {
    kind: IfMatchTargetKind;
    /** The canonical probe call: always the same for reads and writes of this target. */
    category: ToolCategory;
    action: string;
    args: Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function ifMatchTargetFor(kind: IfMatchTargetKind, key: string): IfMatchTarget {
    switch (kind) {
        case 'block': return { kind, category: 'block', action: 'update', args: { id: key } };
        case 'fs_path': return { kind, category: 'fs', action: 'write', args: { path: key } };
        case 'av': return { kind, category: 'av', action: 'set_cells', args: { avID: key } };
        case 'template': return { kind, category: 'file', action: 'update_template', args: { path: key } };
    }
}

/** Reads that return ifMatch, and the argument naming their target. */
export const READ_IF_MATCH_SOURCES: Partial<Record<ToolCategory, Record<string, { kind: IfMatchTargetKind; arg: string }>>> = {
    block: {
        get_kramdown: { kind: 'block', arg: 'id' },
        get_attrs: { kind: 'block', arg: 'id' },
        get_children: { kind: 'block', arg: 'id' },
    },
    document: { get_doc: { kind: 'block', arg: 'id' } },
    fs: { read: { kind: 'fs_path', arg: 'path' } },
    av: {
        get: { kind: 'av', arg: 'avID' },
        query: { kind: 'av', arg: 'avID' },
    },
    file: { read_template: { kind: 'template', arg: 'path' } },
};

/** Writes that accept ifMatch, and the argument naming their single target. */
const WRITE_IF_MATCH_TARGETS: Partial<Record<ToolCategory, Record<string, { kind: IfMatchTargetKind; arg: string }>>> = {
    block: {
        update: { kind: 'block', arg: 'id' },
        replace: { kind: 'block', arg: 'id' },
        set_attrs: { kind: 'block', arg: 'id' },
        set_fold_state: { kind: 'block', arg: 'id' },
        delete: { kind: 'block', arg: 'id' },
    },
    document: {
        rename: { kind: 'block', arg: 'id' },
        set_attr: { kind: 'block', arg: 'id' },
        remove: { kind: 'block', arg: 'id' },
    },
    fs: {
        write: { kind: 'fs_path', arg: 'path' },
        replace: { kind: 'fs_path', arg: 'path' },
        rm: { kind: 'fs_path', arg: 'path' },
    },
    av: {
        add_rows: { kind: 'av', arg: 'avID' },
        add_column: { kind: 'av', arg: 'avID' },
        add_view: { kind: 'av', arg: 'avID' },
        set_cells: { kind: 'av', arg: 'avID' },
        remove_rows: { kind: 'av', arg: 'avID' },
        remove_column: { kind: 'av', arg: 'avID' },
        rename: { kind: 'av', arg: 'avID' },
    },
    file: {
        update_template: { kind: 'template', arg: 'path' },
        delete_template: { kind: 'template', arg: 'path' },
    },
};

/** Whether the action accepts ifMatch for some argument shape (schema advertisement). */
export function acceptsIfMatch(category: ToolCategory, action: string): boolean {
    return !!WRITE_IF_MATCH_TARGETS[category]?.[action];
}

export function getReadIfMatchTarget(category: ToolCategory, action: string, args: Record<string, unknown>): IfMatchTarget | undefined {
    const source = READ_IF_MATCH_SOURCES[category]?.[action];
    const key = source ? nonEmptyString(args[source.arg]) : undefined;
    return source && key ? ifMatchTargetFor(source.kind, key) : undefined;
}

/** Undefined when the write has no single target an ifMatch could describe (e.g. batch items). */
export function getWriteIfMatchTarget(category: ToolCategory, action: string, args: Record<string, unknown>): IfMatchTarget | undefined {
    const source = WRITE_IF_MATCH_TARGETS[category]?.[action];
    if (!source || Array.isArray(args.items)) return undefined;
    const key = nonEmptyString(args[source.arg]);
    return key ? ifMatchTargetFor(source.kind, key) : undefined;
}

/** Lowercase digest digits of an ifMatch credential, or undefined when malformed. */
export function parseIfMatch(value: unknown): string | undefined {
    if (typeof value !== 'string' || !new RegExp(IF_MATCH_PATTERN).test(value)) return undefined;
    return value.slice(value.lastIndexOf(':') + 1).toLowerCase();
}

/** Display form returned by reads: the leading IF_MATCH_HEX_LENGTH digest digits. */
export function formatIfMatch(fullHash: string): string {
    return fullHash.slice(fullHash.lastIndexOf(':') + 1, fullHash.lastIndexOf(':') + 1 + IF_MATCH_HEX_LENGTH);
}

/** True when the ifMatch digits are a prefix of the recomputed full digest. */
export function ifMatchMatches(ifMatch: string, fullHash: string): boolean {
    const digits = parseIfMatch(ifMatch);
    return !!digits && fullHash.slice(fullHash.lastIndexOf(':') + 1).toLowerCase().startsWith(digits);
}

/*
 * One-step tiers (only consulted when writeSafety.oneStep is 'low_risk'):
 *   1 — additive / low-impact: may commit without preflight; ifMatch optional.
 *   2 — overwrites: may commit without preflight only with a matching ifMatch.
 *   3 — everything else (dangerous, structural, workspace-wide, unlisted):
 *       always the two-step preflight + commit flow. Default deny.
 */
export type OneStepTier = 1 | 2 | 3;
export const ONE_STEP_MAX_BATCH = 20;

export const ONE_STEP_TIERS: Partial<Record<ToolCategory, Record<string, 1 | 2>>> = {
    document: { create: 1, rename: 1, set_attr: 1 },
    // fs.write creates a new document (tier 1); overwrite=true is tier 2.
    fs: { write: 1, replace: 2 },
    block: { insert: 1, prepend: 1, append: 1, set_attrs: 1, update: 2, replace: 2 },
    // av create/rename add a database or change only names; both are recoverable.
    av: { create: 1, rename: 1, add_rows: 1, add_column: 1, add_view: 1, set_cells: 2 },
    flashcard: { create_card: 1, review_card: 1 },
    file: { update_template: 2 },
};

export const BATCH_ARRAY_KEYS = ['items', 'docs', 'blocks', 'rows', 'blockIDs', 'primaryKeyTexts', 'cells', 'rowIDs', 'ids', 'edit'] as const;

/** Largest item list in the arguments (1 for a single-target write). */
export function getWriteBatchSize(args: Record<string, unknown>): number {
    let size = 1;
    for (const key of BATCH_ARRAY_KEYS) {
        const value = args[key];
        if (Array.isArray(value)) size = Math.max(size, value.length);
    }
    return size;
}

export function getOneStepTier(category: ToolCategory, action: string, args: Record<string, unknown> = {}): OneStepTier {
    if (isDangerousAction(category, action)) return 3;
    const tier = ONE_STEP_TIERS[category]?.[action] ?? 3;
    if (category === 'fs' && action === 'write' && args.overwrite === true) return 2;
    if (category === 'fs' && action === 'replace') {
        const edits = Array.isArray(args.edit) ? args.edit : [args.edit];
        if (edits.some((edit) => typeof edit === 'object' && edit !== null && (edit as Record<string, unknown>).replace_all === true)) return 3;
    }
    return tier;
}

export type OneStepRefusalReason = 'setting_off' | 'tier3' | 'missing_if_match' | 'if_match_unsupported' | 'batch_too_large';

export type OneStepDecision =
    | { allowed: true; tier: 1 | 2 }
    | { allowed: false; tier: OneStepTier; reason: OneStepRefusalReason };

/**
 * Decide whether a strict commit without requestId may run in one step.
 * The caller still probes state, checks permissions and ifMatch, and records
 * the ledger exactly like a two-step commit.
 */
export function decideOneStep(
    mode: WriteOneStepMode | undefined,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
): OneStepDecision {
    const tier = getOneStepTier(category, action, args);
    if (mode !== 'low_risk') return { allowed: false, tier, reason: 'setting_off' };
    if (tier === 3) return { allowed: false, tier, reason: 'tier3' };
    if (getWriteBatchSize(args) > ONE_STEP_MAX_BATCH) return { allowed: false, tier, reason: 'batch_too_large' };
    if (tier === 2) {
        if (!getWriteIfMatchTarget(category, action, args)) return { allowed: false, tier, reason: 'if_match_unsupported' };
        if (args.ifMatch === undefined) return { allowed: false, tier, reason: 'missing_if_match' };
    }
    return { allowed: true, tier };
}

export const ONE_STEP_REFUSAL_MESSAGES: Record<OneStepRefusalReason, string> = {
    setting_off: 'One-step writes are disabled (writeSafety.oneStep is off).',
    tier3: 'This write always needs the two-step preflight (dangerous, structural, or not on the one-step list).',
    missing_if_match: 'This overwrite can skip preflight only with ifMatch from a fresh read of the target.',
    if_match_unsupported: 'This write shape (for example batch items) has no single target an ifMatch can cover.',
    batch_too_large: `Batches over ${ONE_STEP_MAX_BATCH} items always use the two-step preflight.`,
};
