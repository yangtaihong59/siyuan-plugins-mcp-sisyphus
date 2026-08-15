import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ACTIONS_BY_CATEGORY, TOOL_CATEGORIES } from '@/core/config';
import { TOOL_REGISTRY } from '@/core/tool-registry';

describe('action inventory documentation contract', () => {
    it('derives every static category and action count from the source registry', () => {
        const categories = Object.keys(ACTIONS_BY_CATEGORY);
        const staticActionTotal = Object.values(ACTIONS_BY_CATEGORY)
            .reduce((total, actions) => total + actions.length, 0);
        const coverageDoc = readFileSync(
            new URL('../../../docs/testing/ACTION_TEST_COVERAGE.md', import.meta.url),
            'utf8',
        );
        const mappingDoc = readFileSync(
            new URL('../../../API_MCP_MAPPING.md', import.meta.url),
            'utf8',
        );

        expect(categories).toEqual([...TOOL_CATEGORIES]);
        expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...TOOL_CATEGORIES].sort());
        expect(staticActionTotal).toBeGreaterThan(0);
        expect(coverageDoc).toContain('`ACTIONS_BY_CATEGORY`');
        for (const category of TOOL_CATEGORIES) {
            expect(coverageDoc).toContain(`ACTIONS_BY_CATEGORY.${category}`);
        }
        expect(mappingDoc).toContain(`**${TOOL_CATEGORIES.length}** 个聚合工具、**${staticActionTotal}** 个静态 action`);
        const referencedStaticTotals = [...mappingDoc.matchAll(/(?:不计入|不纳入)静态 (\d+)/g)]
            .map((match) => Number(match[1]));
        expect(referencedStaticTotals.length).toBeGreaterThan(0);
        expect(new Set(referencedStaticTotals)).toEqual(new Set([staticActionTotal]));
    });
});
