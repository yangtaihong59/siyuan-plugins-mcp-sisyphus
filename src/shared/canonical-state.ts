/**
 * Browser-safe canonical serialization shared by strict server hashes and
 * renderer-reachable tool handlers. Object-key ordering and explicit
 * undefined values are part of the write-precondition contract, so changing
 * this representation would invalidate both lease credentials and AV
 * postimage evidence.
 */
export function canonicalizeState(value: unknown): string {
    return JSON.stringify(normalizeCanonicalValue(value));
}

export async function hashCanonicalState(value: unknown): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto SHA-256 is unavailable; cannot verify the AV canonical postimage.');
    }
    const bytes = new TextEncoder().encode(canonicalizeState(value));
    const digest = await subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256:v1:${hex}`;
}

function normalizeCanonicalValue(value: unknown): unknown {
    if (value === undefined) return { $sisyphus: 'undefined' };
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return { $sisyphus: 'number', value: 'NaN' };
        if (value === Infinity) return { $sisyphus: 'number', value: 'Infinity' };
        if (value === -Infinity) return { $sisyphus: 'number', value: '-Infinity' };
        if (Object.is(value, -0)) return 0;
        return value;
    }
    if (typeof value === 'bigint') return { $sisyphus: 'bigint', value: value.toString() };
    if (value instanceof Uint8Array) {
        return { $sisyphus: 'bytes', hex: Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('') };
    }
    if (value instanceof Date) return { $sisyphus: 'date', value: value.toISOString() };
    if (Array.isArray(value)) return value.map(normalizeCanonicalValue);
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalizeCanonicalValue(record[key])]));
    }
    return { $sisyphus: typeof value, value: String(value) };
}
