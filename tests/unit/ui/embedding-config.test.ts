import { describe, expect, it } from 'vitest';

import {
    calculateEmbeddingProgress,
    embeddingChangeRequiresReindex,
    getEmbeddingCapabilities,
    mergeEmbeddingIntoAI,
    normalizeEmbeddingConfig,
    validateEmbeddingConfig,
} from '@/ui/setting/embedding-config';

describe('embedding settings model', () => {
    it('gates configuration and full management by SiYuan version', () => {
        expect(getEmbeddingCapabilities('3.6.4')).toEqual({ configuration: false, management: false });
        expect(getEmbeddingCapabilities('v3.7.0-dev1')).toEqual({ configuration: true, management: false });
        expect(getEmbeddingCapabilities('3.7.1')).toEqual({ configuration: true, management: false });
        expect(getEmbeddingCapabilities('3.7.2')).toEqual({ configuration: true, management: true });
    });

    it('normalizes and validates native embedding fields', () => {
        const config = normalizeEmbeddingConfig({ enabled: true, timeout: '45', dimensions: -2 });
        expect(config.timeout).toBe(45);
        expect(config.dimensions).toBe(0);
        expect(validateEmbeddingConfig(config)).toEqual(['baseURL', 'apiKey', 'name']);

        expect(validateEmbeddingConfig({
            ...config,
            apiKey: 'secret',
            baseURL: 'https://api.openai.com/v1',
            name: 'text-embedding-3-small',
        })).toEqual([]);
    });

    it('replaces only embedding while preserving the latest native AI configuration', () => {
        const ai = {
            providers: [{ id: 'provider-1' }],
            agent: { modelId: 'agent-1' },
            mcp: { servers: [{ id: 'mcp-1' }] },
            rerank: { enabled: true },
            embedding: { enabled: false, apiKey: 'old' },
        };
        const merged = mergeEmbeddingIntoAI(ai, {
            id: 'embedding-1',
            enabled: true,
            apiKey: ' secret ',
            baseURL: ' https://embedding.example/v1 ',
            name: ' model ',
            timeout: 30,
            dimensions: 1024,
        });

        expect(merged).toMatchObject({
            providers: ai.providers,
            agent: ai.agent,
            mcp: ai.mcp,
            rerank: ai.rerank,
            embedding: {
                id: 'embedding-1', enabled: true, apiKey: 'secret',
                baseURL: 'https://embedding.example/v1', name: 'model', dimensions: 1024,
            },
        });
    });

    it('flags index-affecting changes and calculates progress without ignored blocks', () => {
        const before = normalizeEmbeddingConfig({ enabled: false, name: 'old', baseURL: 'https://a', dimensions: 0 });
        const after = { ...before, enabled: true };
        expect(embeddingChangeRequiresReindex(before, after)).toBe(true);
        expect(embeddingChangeRequiresReindex(after, { ...after, timeout: 60, apiKey: 'new' })).toBe(false);
        expect(calculateEmbeddingProgress({
            enabled: true, total: 100, indexed: 75, pending: 0, failed: 5,
            ignoredByLen: 10, ignoredByConfig: 15,
        })).toEqual({ effectiveTotal: 75, percent: 100, done: true });
    });
});
