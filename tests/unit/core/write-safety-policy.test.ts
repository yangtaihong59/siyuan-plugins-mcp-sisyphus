import { describe, expect, it } from 'vitest';

import { ACTIONS_BY_CATEGORY, TOOL_CATEGORIES } from '@/core/config';
import {
    ACTION_SAFETY_POLICIES,
    assertActionSafetyPoliciesComplete,
    getActionSafetyPolicy,
} from '@/core/write-safety-policy';
import { buildDefaultToolConfig } from '@/core/config';
import { listAllTools } from '@/core/tool-registry';

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
        expect(getActionSafetyPolicy('av', 'render', { createIfNotExist: true })).toMatchObject({
            mode: 'mutation', precondition: 'none',
        });
        expect(getActionSafetyPolicy('av', 'render')).toEqual({ mode: 'read' });
        expect(getActionSafetyPolicy('file', 'create_template')).toMatchObject({
            mode: 'mutation', precondition: 'none',
        });
        expect(getActionSafetyPolicy('file', 'create_template', { overwrite: true })).toMatchObject({
            mode: 'mutation', precondition: 'state',
        });
        expect(getActionSafetyPolicy('extension', 'third_party_write')).toEqual({ mode: 'external' });
    });

    it('advertises strict fields only while strict mode is enabled', () => {
        const strict = buildDefaultToolConfig();
        const strictBlock = listAllTools(strict).find((tool) => tool.name === 'block')!;
        expect(strictBlock.inputSchema.properties).toHaveProperty('requestId');
        expect(strictBlock.inputSchema.properties).toHaveProperty('expectedStateHash');
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
            ['av', 'render'],
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
