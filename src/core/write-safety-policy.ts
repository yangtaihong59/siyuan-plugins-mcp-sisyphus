import {
    ACTION_SPECS_BY_CATEGORY,
    ACTIONS_BY_CATEGORY,
    type ToolActionMap,
    type ToolCategory,
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
