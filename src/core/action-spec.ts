/*
 * Dependency-free vocabulary for per-tool action declarations
 * (src/tools/<tool>/actions.ts). Kept import-free so the renderer can read
 * action metadata through core/config without pulling in the tool layer.
 */

export type ActionTier = 'basic' | 'advanced';

export type WritePrecondition = 'none' | 'state' | 'structure' | 'value' | 'manifest' | 'source';

export type ActionSafetyPolicy =
    | { mode: 'read' }
    | { mode: 'external' }
    | {
        mode: 'mutation';
        precondition: WritePrecondition;
        validateOnly: boolean;
    };

export const read = (): ActionSafetyPolicy => ({ mode: 'read' });
export const external = (): ActionSafetyPolicy => ({ mode: 'external' });
export const mutation = (
    precondition: WritePrecondition = 'none',
    validateOnly = true,
): ActionSafetyPolicy => ({ mode: 'mutation', precondition, validateOnly });

export interface ActionSpec {
    /** basic actions are listed first and shown as "common" in help and the CLI. */
    tier: ActionTier;
    /** Base write-safety classification; argument-dependent overrides live in write-safety-policy. */
    policy: ActionSafetyPolicy;
    defaultEnabled: boolean;
    /** Requires explicit user confirmation before execution. */
    dangerous?: boolean;
}

/** Declaration order is the action order everywhere (schemas, help, settings). */
export function defineActionSpecs<const Specs extends Record<string, ActionSpec>>(specs: Specs): Specs {
    return specs;
}

export function actionNames<Specs extends Record<string, ActionSpec>>(specs: Specs): readonly [keyof Specs & string, ...Array<keyof Specs & string>] {
    return Object.keys(specs) as unknown as readonly [keyof Specs & string, ...Array<keyof Specs & string>];
}
