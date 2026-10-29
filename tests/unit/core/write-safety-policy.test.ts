import { describe, expect, it } from 'vitest';

import { ACTIONS_BY_CATEGORY, TOOL_CATEGORIES } from '@/core/config';
import {
    ACTION_SAFETY_POLICIES,
    assertActionSafetyPoliciesComplete,
    getActionSafetyPolicy,
} from '@/core/write-safety-policy';
import { buildDefaultToolConfig } from '@/core/config';
import { listAllTools } from '@/mcp/tool-registry';

describe('write safety action policy', () => {
    it('classifies every configured action exactly once', () => {
        expect(() => assertActionSafetyPoliciesComplete()).not.toThrow();
        for (const category of TOOL_CATEGORIES) {
            expect(Object.keys(ACTION_SAFETY_POLICIES[category]).sort()).toEqual(
                [...ACTIONS_BY_CATEGORY[category]].sort(),
            );
        }
    });

    it('treats conditional writes according to their effective mutation', () => {
        expect(getActionSafetyPolicy('fs', 'write', { overwrite: false })).toMatchObject({
            mode: 'mutation', precondition: 'none',
        });
        expect(getActionSafetyPolicy('fs', 'write', { overwrite: true })).toMatchObject({
            mode: 'mutation', precondition: 'state',
        });
        expect(getActionSafetyPolicy('av', 'create')).toMatchObject({
            mode: 'mutation', precondition: 'none',
        });
        expect(getActionSafetyPolicy('av', 'render')).toEqual({ mode: 'read' });
        expect(getActionSafetyPolicy('file', 'create_template')).toMatchObject({
            mode: 'mutation', precondition: 'none',
        });
        expect(getActionSafetyPolicy('file', 'create_template', { overwrite: true })).toMatchObject({
            mode: 'mutation', precondition: 'state',
        });
        expect(getActionSafetyPolicy('fs', 'reorder')).toMatchObject({
            mode: 'mutation', precondition: 'structure',
        });
        expect(getActionSafetyPolicy('document', 'reorder')).toMatchObject({
            mode: 'mutation', precondition: 'structure',
        });
        expect(getActionSafetyPolicy('document', 'ensure_link_targets', { mode: 'resolve' })).toEqual({ mode: 'read' });
        expect(getActionSafetyPolicy('document', 'ensure_link_targets', { mode: 'reuse' })).toEqual({ mode: 'read' });
        expect(getActionSafetyPolicy('document', 'ensure_link_targets', { mode: 'create', dryRun: true })).toEqual({ mode: 'read' });
        expect(getActionSafetyPolicy('document', 'ensure_link_targets', { mode: 'create' })).toMatchObject({
            mode: 'mutation', precondition: 'structure',
        });
        expect(getActionSafetyPolicy('extension', 'third_party_write')).toEqual({ mode: 'external' });
    });

    it('routes AV view configuration through strict state preconditions', () => {
        for (const action of ['add_view', 'update_view']) {
            expect(getActionSafetyPolicy('av', action)).toMatchObject({ mode: 'mutation', precondition: 'state', validateOnly: true });
        }
    });

    it('advertises strict fields only while strict mode is enabled', () => {
        const strict = buildDefaultToolConfig();
        const strictBlock = listAllTools(strict).find((tool) => tool.name === 'block')!;
        expect(strictBlock.inputSchema.properties).toHaveProperty('requestId');
        expect(strictBlock.inputSchema.properties).toHaveProperty('expectedStateHash');
        const requestPattern = new RegExp((strictBlock.inputSchema.properties as any).requestId.pattern);
        expect(requestPattern.test('b72f')).toBe(true);
        expect(requestPattern.test('b72f0')).toBe(true);
        expect(requestPattern.test('abc')).toBe(false);
        expect(requestPattern.test('019c1234-5678-7abc-8def-0123456789ab')).toBe(false);
        expect(getActionSafetyPolicy('block', 'append')).toMatchObject({ validateOnly: true });
        const credentialPattern = new RegExp((strictBlock.inputSchema.properties as any).expectedStateHash.pattern);
        expect(credentialPattern.test('sha256:v1:8ac2')).toBe(true);
        expect(credentialPattern.test('8AC2')).toBe(true);
        expect(credentialPattern.test('f'.repeat(64))).toBe(true);
        expect(credentialPattern.test('abc')).toBe(false);
        expect(credentialPattern.test('f'.repeat(65))).toBe(false);
        expect(credentialPattern.test('sha256:v2:8ac2')).toBe(false);

        strict.writeSafety.strictMode = false;
        const legacyBlock = listAllTools(strict).find((tool) => tool.name === 'block')!;
        expect(legacyBlock.inputSchema.properties).not.toHaveProperty('requestId');
    });

    it('advertises strict fields on conditional mutation branches', () => {
        const config = buildDefaultToolConfig();
        const branchKey = 'x-sisyphus-actionSchemas';

        for (const [category, action] of [
            ['fs', 'write'],
            ['file', 'create_template'],
            ['av', 'create'],
        ] as const) {
            const descriptor = listAllTools(config).find((tool) => tool.name === category)!;
            const branches = (descriptor.inputSchema as Record<string, unknown>)[branchKey] as Array<Record<string, any>>;
            const branch = branches.find((entry) => entry.properties?.action?.const === action);

            expect(branch, `${category}.${action} branch`).toBeDefined();
            expect(branch?.properties).toHaveProperty('requestId');
            expect(branch?.properties).toHaveProperty('validateOnly');
            if (category === 'fs' || category === 'file') {
                expect(branch?.properties).toHaveProperty('expectedStateHash');
            }
        }
    });
});

describe('one-step write tiers', () => {
    it('lists only existing, non-dangerous mutations and denies everything else by default', async () => {
        const { ONE_STEP_TIERS, getOneStepTier } = await import('@/core/write-safety-policy');
        const { isDangerousAction } = await import('@/core/config');
        for (const [category, actions] of Object.entries(ONE_STEP_TIERS)) {
            for (const action of Object.keys(actions!)) {
                expect(ACTIONS_BY_CATEGORY[category as keyof typeof ACTIONS_BY_CATEGORY], `${category}.${action}`).toContain(action);
                expect(isDangerousAction(category as never, action), `${category}.${action}`).toBe(false);
                expect(getActionSafetyPolicy(category as never, action).mode, `${category}.${action}`).toBe('mutation');
            }
        }
        for (const category of TOOL_CATEGORIES) {
            for (const action of ACTIONS_BY_CATEGORY[category]) {
                const listed = (ONE_STEP_TIERS[category] as Record<string, number> | undefined)?.[action];
                if (!listed) expect(getOneStepTier(category, action), `${category}.${action}`).toBe(3);
            }
        }
    });

    it('pins the tier table', async () => {
        const { getOneStepTier } = await import('@/core/write-safety-policy');
        const tier1 = [['document', 'create'], ['document', 'rename'], ['document', 'set_attr'], ['fs', 'write'],
            ['block', 'insert'], ['block', 'prepend'], ['block', 'append'], ['block', 'set_attrs'],
            ['av', 'add_rows'], ['av', 'add_column'], ['av', 'add_view'], ['flashcard', 'create_card'], ['flashcard', 'review_card']] as const;
        const tier2 = [['block', 'update'], ['block', 'replace'], ['fs', 'replace'], ['av', 'set_cells'], ['file', 'update_template']] as const;
        const tier3 = [['tag', 'rename'], ['document', 'heading_to_doc'], ['document', 'doc_to_heading'], ['document', 'reorder'],
            ['fs', 'reorder'], ['block', 'transfer_references'], ['av', 'remove_rows'], ['av', 'remove_column'],
            ['notebook', 'set_open_state'], ['notebook', 'set_conf'], ['notebook', 'rename'], ['block', 'delete'],
            ['search', 'find_replace'], ['av', 'create'], ['notebook', 'create']] as const;
        for (const [category, action] of tier1) expect(getOneStepTier(category, action), `${category}.${action}`).toBe(1);
        for (const [category, action] of tier2) expect(getOneStepTier(category, action), `${category}.${action}`).toBe(2);
        for (const [category, action] of tier3) expect(getOneStepTier(category, action), `${category}.${action}`).toBe(3);
        expect(getOneStepTier('fs', 'write', { overwrite: true })).toBe(2);
        expect(getOneStepTier('fs', 'replace', { edit: { old: 'a', new: 'b' } })).toBe(2);
        expect(getOneStepTier('fs', 'replace', { edit: { old: 'a', new: 'b', replace_all: true } })).toBe(3);
        expect(getOneStepTier('fs', 'replace', { edit: [{ old: 'a', new: 'b' }, { old: 'c', new: 'd', replace_all: true }] })).toBe(3);
    });

    it('decides one-step per setting, tier, batch size and ifMatch', async () => {
        const { decideOneStep, ONE_STEP_MAX_BATCH } = await import('@/core/write-safety-policy');
        const id = '20260812000000-abcdefg';
        expect(decideOneStep('off', 'block', 'append', { parentID: id })).toMatchObject({ allowed: false, reason: 'setting_off' });
        expect(decideOneStep(undefined, 'block', 'append', { parentID: id })).toMatchObject({ allowed: false, reason: 'setting_off' });
        expect(decideOneStep('low_risk', 'block', 'append', { parentID: id })).toEqual({ allowed: true, tier: 1 });
        expect(decideOneStep('low_risk', 'tag', 'rename', { oldLabel: 'a', newLabel: 'b' })).toMatchObject({ allowed: false, reason: 'tier3' });
        expect(decideOneStep('low_risk', 'block', 'update', { id })).toMatchObject({ allowed: false, reason: 'missing_if_match' });
        expect(decideOneStep('low_risk', 'block', 'update', { id, ifMatch: 'a'.repeat(16) })).toEqual({ allowed: true, tier: 2 });
        expect(decideOneStep('low_risk', 'block', 'update', { items: [{ id }], ifMatch: 'a'.repeat(16) }))
            .toMatchObject({ allowed: false, reason: 'if_match_unsupported' });
        const rows = Array.from({ length: ONE_STEP_MAX_BATCH + 1 }, (_, index) => ({ clientKey: `k${index}`, primaryKeyText: `r${index}` }));
        expect(decideOneStep('low_risk', 'av', 'add_rows', { avID: id, rows })).toMatchObject({ allowed: false, reason: 'batch_too_large' });
        expect(decideOneStep('low_risk', 'av', 'add_rows', { avID: id, rows: rows.slice(0, ONE_STEP_MAX_BATCH) })).toEqual({ allowed: true, tier: 1 });
    });

    it('maps reads and writes of one target to one canonical probe call', async () => {
        const { getReadIfMatchTarget, getWriteIfMatchTarget, ifMatchMatches, formatIfMatch, parseIfMatch } = await import('@/core/write-safety-policy');
        const id = '20260812000000-abcdefg';
        const block = getReadIfMatchTarget('block', 'get_kramdown', { id });
        expect(block).toEqual({ kind: 'block', category: 'block', action: 'update', args: { id } });
        for (const [category, action] of [['block', 'get_attrs'], ['block', 'get_children'], ['document', 'get_doc']] as const) {
            expect(getReadIfMatchTarget(category, action, { id })).toEqual(block);
        }
        for (const [category, action] of [['block', 'update'], ['block', 'replace'], ['block', 'set_attrs'], ['document', 'set_attr'], ['document', 'rename']] as const) {
            expect(getWriteIfMatchTarget(category, action, { id })).toEqual(block);
        }
        expect(getReadIfMatchTarget('fs', 'read', { path: '/N/D' })).toEqual(getWriteIfMatchTarget('fs', 'replace', { path: '/N/D' }));
        expect(getReadIfMatchTarget('fs', 'read', { path: '/N/D' })).toEqual(getWriteIfMatchTarget('fs', 'write', { path: '/N/D', overwrite: true }));
        expect(getReadIfMatchTarget('av', 'query', { avID: id })).toEqual(getWriteIfMatchTarget('av', 'set_cells', { avID: id, cells: [] }));
        expect(getReadIfMatchTarget('av', 'get', { avID: id })?.action).toBe('set_cells');
        expect(getReadIfMatchTarget('file', 'read_template', { path: 'a.md' })).toEqual(getWriteIfMatchTarget('file', 'update_template', { path: 'a.md' }));
        expect(getReadIfMatchTarget('block', 'info', { id })).toBeUndefined();
        expect(getWriteIfMatchTarget('block', 'insert', { parentID: id })).toBeUndefined();
        expect(getWriteIfMatchTarget('document', 'rename', { items: [{ id, title: 'x' }] })).toBeUndefined();

        const full = `sha256:v1:${'0123456789abcdef'.repeat(4)}`;
        expect(formatIfMatch(full)).toBe('0123456789abcdef');
        expect(ifMatchMatches('0123456789ABCDEF', full)).toBe(true);
        expect(ifMatchMatches(`sha256:v1:${'0123456789abcdef'.repeat(2)}`, full)).toBe(true);
        expect(ifMatchMatches('0123456789abcde0', full)).toBe(false);
        expect(parseIfMatch('abcd')).toBeUndefined();
        expect(parseIfMatch('g'.repeat(16))).toBeUndefined();
    });
});
