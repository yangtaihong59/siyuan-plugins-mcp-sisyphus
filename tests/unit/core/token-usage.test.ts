import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '../../../src/core/config';
import {
    APPROX_TOKEN_MODE,
    approximateTokensFromChars,
    measureApproxContent,
    measureApproxText,
} from '../../../src/core/token-usage';
import { MCP_INITIAL_COST_PATH, parseMcpInitialTokenCost } from '../../../src/core/analytics';
import { calculateMcpInitialTokenCost, recordMcpInitialTokenCost } from '../../../src/mcp/mcp-initial-cost';

describe('token usage helpers', () => {
    it('converts chars to approximate tokens', () => {
        expect(approximateTokensFromChars(0)).toBe(0);
        expect(approximateTokensFromChars(1)).toBe(1);
        expect(approximateTokensFromChars(4)).toBe(1);
        expect(approximateTokensFromChars(5)).toBe(2);
    });

    it('measures plain text and content arrays', () => {
        expect(measureApproxText('hello')).toEqual({ chars: 5, approxTokens: 2 });
        expect(measureApproxContent([{ type: 'text', text: 'ab' }, { type: 'text', text: 'cdef' }])).toEqual({
            chars: 6,
            approxTokens: 2,
        });
        expect(measureApproxContent([
            { type: 'text', text: 'meta' },
            { type: 'image', data: 'a'.repeat(100_000), mimeType: 'image/png' },
        ])).toEqual({ chars: 4, approxTokens: 1 });
    });

    it('calculates MCP initial cost from current config', () => {
        const base = buildDefaultToolConfig();
        const full = calculateMcpInitialTokenCost(base);

        const reduced = buildDefaultToolConfig();
        reduced.document.enabled = false;
        reduced.userRulesText = 'Keep answers short.';
        const reducedCost = calculateMcpInitialTokenCost(reduced);

        expect(APPROX_TOKEN_MODE).toBe('approx_context_v1');
        expect(full.mcpInitialChars).toBeGreaterThan(0);
        expect(full.mcpInitialApproxTokens).toBeGreaterThan(0);
        expect(reducedCost.mcpInitialChars).not.toBe(full.mcpInitialChars);
        expect(reducedCost.mcpInitialApproxTokens).not.toBe(full.mcpInitialApproxTokens);
    });

    it('records the served initial cost once per value and round-trips through the parser', async () => {
        const writes: Array<[string, string]> = [];
        const client = { writeFile: vi.fn(async (path: string, content: string) => { writes.push([path, content]); }) };
        const cost = { mcpInitialChars: 123_457, mcpInitialApproxTokens: 30_865 };

        await recordMcpInitialTokenCost(client, cost);
        await recordMcpInitialTokenCost(client, cost);

        expect(writes).toHaveLength(1);
        expect(writes[0][0]).toBe(MCP_INITIAL_COST_PATH);
        expect(parseMcpInitialTokenCost(writes[0][1])).toMatchObject(cost);
        expect(parseMcpInitialTokenCost('not json')).toBeNull();
        expect(parseMcpInitialTokenCost(JSON.stringify({ mcpInitialChars: 'x' }))).toBeNull();
    });

    it('never throws when recording the initial cost fails', async () => {
        const client = { writeFile: vi.fn(async () => { throw new Error('offline'); }) };
        await expect(recordMcpInitialTokenCost(client, { mcpInitialChars: 98_765, mcpInitialApproxTokens: 24_692 })).resolves.toBeUndefined();
    });
});
