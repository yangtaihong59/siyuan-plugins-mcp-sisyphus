import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTIONS_BY_CATEGORY, TOOL_CATEGORIES } from '@/core/config';
import { collectPlan, summarizeEvidence } from '../../../scripts/acceptance-plan.mjs';

describe('acceptance planning and evidence accounting', () => {
    const plan = collectPlan();
    it('plans every current source action without claiming execution', () => {
        expect(plan.plannedTools).toBe(TOOL_CATEGORIES.length);
        expect(plan.plannedActions).toBe(Object.values(ACTIONS_BY_CATEGORY).flat().length);
        expect(plan.actions.every(action => action.scenarios.length > 0)).toBe(true);
        expect(plan.cases.every(scenario => ['planned', 'partial_existing'].includes(scenario.implementation))).toBe(true);
    });
    it('does not count help, mock or expected denial as positive functional coverage', () => {
        const keys = plan.actions.slice(0, 3).map(action => action.key);
        const report = { schemaVersion: 1, actions: ['help_only', 'mock', 'expected_denial'].map((kind, i) => ({
            key: keys[i], status: 'passed', kind, real: true, readbackVerified: true, evidenceFiles: ['trace.json'],
        })) };
        expect(summarizeEvidence(plan, report)).toMatchObject({ positiveActions: 0, positiveTools: 0, denialActions: 1 });
    });
    it('requires real execution and verified readback before counting a success', () => {
        const key = plan.actions[0].key;
        const base = { key, status: 'passed', kind: 'success', evidenceFiles: ['trace.json'] };
        for (const evidence of [{ real: false, readbackVerified: true }, { real: true, readbackVerified: false }]) {
            expect(summarizeEvidence(plan, { schemaVersion: 1, actions: [{ ...base, ...evidence }] }).positiveActions).toBe(0);
        }
        expect(summarizeEvidence(plan, { schemaVersion: 1, actions: [{ ...base, real: true, readbackVerified: true }] }).positiveActions).toBe(1);
    });
    it('rejects fabricated action names and passes without evidence references', () => {
        expect(() => summarizeEvidence(plan, { schemaVersion: 1, actions: [{ key: 'fake.tool', status: 'passed' }] })).toThrow('Unknown reported action');
        expect(() => summarizeEvidence(plan, { schemaVersion: 1, actions: [{ key: plan.actions[0].key, status: 'passed', kind: 'success' }] })).toThrow('lacks evidence');
    });
    it('fails when a new source action has no planned scenario', () => {
        const root = mkdtempSync(join(tmpdir(), 'sisyphus-plan-test-'));
        try {
            mkdirSync(join(root, 'src/core'), { recursive: true });
            mkdirSync(join(root, 'tests/acceptance'), { recursive: true });
            writeFileSync(join(root, 'src/core/config.ts'), "export const TOOL_CATEGORIES=['fs'] as const; const FS_ACTIONS=['read','new_action'] as const; export const ACTIONS_BY_CATEGORY={fs:FS_ACTIONS};");
            writeFileSync(join(root, 'src/core/write-safety-policy.ts'), "export const ACTION_SAFETY_POLICIES={fs:{read:read(),new_action:read()}};");
            writeFileSync(join(root, 'tests/acceptance/scenarios.json'), JSON.stringify({ cases: [{ id: 'one', persona: 'newcomer', minimumTier: 'quick', gate: 'read_only', oracle: 'readback', actions: ['fs.read'], implementation: 'planned' }] }));
            expect(() => collectPlan(root)).toThrow('Unplanned source action: fs.new_action');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
});
