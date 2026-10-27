/**
 * The `sha256:v1:<hex>` fingerprint format. Values are persisted and compared
 * across runtimes, so every producer formats and validates through here.
 *
 * Two digest producers exist for runtime reasons: Node's synchronous crypto
 * (`core/write-safety-hash`, shimmed in the kernel) and the async Web Crypto
 * one below for renderer-reachable code. What gets hashed — the canonical
 * serialization — stays with each caller.
 */
export const SHA256_V1 = 'sha256:v1' as const;

/** Preflight credential: a full or abbreviated digest, prefix optional. */
export const SHA256_V1_CREDENTIAL_PATTERN = '^(?:sha256:v1:)?[a-fA-F0-9]{4,64}$';

export function formatSha256V1(hexDigest: string): string {
    return `${SHA256_V1}:${hexDigest}`;
}

export function isSha256V1(value: unknown): value is string {
    return typeof value === 'string' && /^sha256:v1:[a-f0-9]{64}$/.test(value);
}

export async function sha256V1(bytes: Uint8Array): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable.');
    const digest = await subtle.digest('SHA-256', Uint8Array.from(bytes));
    return formatSha256V1(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));
}
