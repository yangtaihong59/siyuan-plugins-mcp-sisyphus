import { isSiYuanVersionAtLeast } from '../../shared/siyuan-version';

export const MIN_EMBEDDING_CONFIG_VERSION = '3.7.0';
export const MIN_EMBEDDING_MANAGEMENT_VERSION = '3.7.2';

export interface EmbeddingConfig {
    id: string;
    enabled: boolean;
    apiKey: string;
    baseURL: string;
    name: string;
    timeout: number;
    dimensions: number;
}

export interface EmbeddingStat {
    total: number;
    indexed: number;
    pending: number;
    failed: number;
    ignoredByLen: number;
    ignoredByConfig: number;
    enabled: boolean;
}

export interface EmbeddingCapabilities {
    configuration: boolean;
    management: boolean;
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
    id: '',
    enabled: false,
    apiKey: '',
    baseURL: '',
    name: '',
    timeout: 30,
    dimensions: 0,
};

function finiteInteger(value: unknown, fallback: number): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
}

export function normalizeEmbeddingConfig(raw: unknown): EmbeddingConfig {
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    return {
        id: typeof source.id === 'string' ? source.id : '',
        enabled: source.enabled === true,
        apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
        baseURL: typeof source.baseURL === 'string' ? source.baseURL : '',
        name: typeof source.name === 'string' ? source.name : '',
        timeout: Math.max(1, finiteInteger(source.timeout, 30)),
        dimensions: Math.max(0, finiteInteger(source.dimensions, 0)),
    };
}

export function getEmbeddingCapabilities(version: string): EmbeddingCapabilities {
    return {
        configuration: isSiYuanVersionAtLeast(version, MIN_EMBEDDING_CONFIG_VERSION),
        management: isSiYuanVersionAtLeast(version, MIN_EMBEDDING_MANAGEMENT_VERSION),
    };
}

export function validateEmbeddingConfig(config: EmbeddingConfig): string[] {
    const errors: string[] = [];
    if (config.enabled) {
        if (!config.baseURL.trim()) errors.push('baseURL');
        else {
            try {
                const url = new URL(config.baseURL);
                if (url.protocol !== 'http:' && url.protocol !== 'https:') errors.push('baseURL');
            } catch {
                errors.push('baseURL');
            }
        }
        if (!config.apiKey.trim()) errors.push('apiKey');
        if (!config.name.trim()) errors.push('name');
    }
    if (!Number.isInteger(config.timeout) || config.timeout < 1 || config.timeout > 600) errors.push('timeout');
    if (!Number.isInteger(config.dimensions) || config.dimensions < 0) errors.push('dimensions');
    return Array.from(new Set(errors));
}

export function mergeEmbeddingIntoAI(ai: unknown, embedding: EmbeddingConfig): Record<string, unknown> {
    const latest = ai && typeof ai === 'object' ? ai as Record<string, unknown> : {};
    return {
        ...latest,
        embedding: {
            ...embedding,
            baseURL: embedding.baseURL.trim(),
            apiKey: embedding.apiKey.trim(),
            name: embedding.name.trim(),
        },
    };
}

export function embeddingChangeRequiresReindex(before: EmbeddingConfig, after: EmbeddingConfig): boolean {
    return (!before.enabled && after.enabled)
        || before.baseURL.trim() !== after.baseURL.trim()
        || before.name.trim() !== after.name.trim()
        || before.dimensions !== after.dimensions;
}

export function calculateEmbeddingProgress(stat: EmbeddingStat | undefined): {
    effectiveTotal: number;
    percent: number;
    done: boolean;
} {
    if (!stat) return { effectiveTotal: 0, percent: 0, done: false };
    const ignored = Math.max(0, stat.ignoredByLen) + Math.max(0, stat.ignoredByConfig);
    const effectiveTotal = Math.max(0, stat.total - ignored);
    const percent = effectiveTotal > 0 ? Math.min(100, Math.max(0, stat.indexed / effectiveTotal * 100)) : 0;
    return {
        effectiveTotal,
        percent,
        done: stat.enabled && stat.indexed >= effectiveTotal && stat.pending === 0,
    };
}
