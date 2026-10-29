import { getEnabledActions, TOOL_CATEGORIES, type ToolCategory, type ToolConfig } from '../core/config';
import { getActionSafetyPolicy, getOneStepTier, ONE_STEP_MAX_BATCH, READ_IF_MATCH_SOURCES, acceptsIfMatch, type IfMatchTargetKind } from '../core/write-safety-policy';
import { PRIMARY_CLI_COMMAND } from '../shared/constants';

/*
 * CLI help only: what one-step mode allows, so a terminal user does not have
 * to discover the tiers by trial. Nothing here reaches the mounted schema or
 * the server instructions; it is shown only while one-step is enabled.
 */

export function isOneStepEnabled(config: ToolConfig): boolean {
    return config.writeSafety?.oneStep === 'low_risk' && config.writeSafety?.strictMode !== false;
}

const kebab = (name: string) => name.replace(/_/g, '-');

/** Reads that print an If Match for targets of this kind, as CLI commands. */
export function ifMatchReads(kind?: IfMatchTargetKind): string[] {
    const reads: string[] = [];
    for (const [category, actions] of Object.entries(READ_IF_MATCH_SOURCES)) {
        for (const [action, source] of Object.entries(actions ?? {})) {
            if (kind && source.kind !== kind) continue;
            reads.push(`${category} ${kebab(action)} --${source.arg.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`);
        }
    }
    return reads;
}

const IF_MATCH_KIND_BY_TOOL: Partial<Record<ToolCategory, IfMatchTargetKind>> = { block: 'block', document: 'block', fs: 'fs_path', av: 'av', file: 'template' };

/** Target kind of a write that accepts --if-match. */
function ifMatchKindOf(category: ToolCategory, action: string): IfMatchTargetKind | undefined {
    return acceptsIfMatch(category, action) ? IF_MATCH_KIND_BY_TOOL[category] : undefined;
}

interface ToolTiers { oneStep: string[]; ifMatch: string[]; twoStep: string[] }

function tiersFor(category: ToolCategory, actions: string[]): ToolTiers {
    const tiers: ToolTiers = { oneStep: [], ifMatch: [], twoStep: [] };
    for (const action of actions) {
        if (getActionSafetyPolicy(category, action).mode !== 'mutation') continue;
        const tier = getOneStepTier(category, action);
        (tier === 1 ? tiers.oneStep : tier === 2 ? tiers.ifMatch : tiers.twoStep).push(kebab(action));
    }
    // fs write overwriting an existing document is an overwrite.
    if (category === 'fs' && tiers.oneStep.includes('write')) tiers.ifMatch.unshift('write --overwrite');
    return tiers;
}

/** Lines for `help <tool>`; empty when the tool has no writes. */
export function oneStepToolLines(category: ToolCategory, config: ToolConfig): string[] {
    const tiers = tiersFor(category, getEnabledActions(config[category]));
    if (tiers.oneStep.length + tiers.ifMatch.length + tiers.twoStep.length === 0) return [];
    const lines = [
        ...(tiers.oneStep.length ? [`One step (no --validate-only needed): ${tiers.oneStep.join(', ')}`] : []),
        ...(tiers.ifMatch.length ? [`One step only with --if-match from a fresh read: ${tiers.ifMatch.join(', ')}`] : []),
        ...(tiers.twoStep.length ? [`Always two steps: ${tiers.twoStep.join(', ')}`] : []),
    ];
    const kinds = new Set(tiers.ifMatch.map((action) => ifMatchKindOf(category, action.split(' ')[0])).filter(Boolean) as IfMatchTargetKind[]);
    const reads = [...kinds].flatMap((kind) => ifMatchReads(kind));
    if (reads.length) lines.push(`Reads that print If Match: ${reads.join(', ')}`);
    lines.push(`Batches over ${ONE_STEP_MAX_BATCH} items always use two steps. A one-step receipt shows the preview after the write.`);
    return lines;
}

/** Lines for `help` with no tool: the tiers across every enabled tool. */
export function oneStepWorkspaceLines(config: ToolConfig): string[] {
    const all: ToolTiers = { oneStep: [], ifMatch: [], twoStep: [] };
    for (const category of TOOL_CATEGORIES) {
        if (!config[category]?.enabled) continue;
        const tiers = tiersFor(category, getEnabledActions(config[category]));
        for (const key of ['oneStep', 'ifMatch'] as const) all[key].push(...tiers[key].map((action) => `${category} ${action}`));
    }
    return [
        `One step (no --validate-only needed): ${all.oneStep.join(', ') || 'none'}`,
        `One step only with --if-match from a fresh read: ${all.ifMatch.join(', ') || 'none'}`,
        'Always two steps: every other write (deletes, moves, structure changes, find-replace, tag and database renames, …).',
        `Reads that print If Match: ${ifMatchReads().join(', ')}`,
        `Batches over ${ONE_STEP_MAX_BATCH} items always use two steps. A one-step receipt shows the preview after the write. Per tool: ${PRIMARY_CLI_COMMAND} help <tool>.`,
    ];
}

/** Action help addition: where --if-match comes from, or that the write is always two-step. */
export function oneStepActionNote(category: ToolCategory, action: string): { tier: number; rule?: string; ifMatchReads?: string[] } | undefined {
    if (getActionSafetyPolicy(category, action).mode !== 'mutation') return undefined;
    const tier = getOneStepTier(category, action);
    if (tier === 3) return { tier, rule: 'Enabled, but this write always uses the two steps (not on the one-step list).' };
    const kind = ifMatchKindOf(category, action);
    return { tier, ...(kind ? { ifMatchReads: ifMatchReads(kind) } : {}) };
}
