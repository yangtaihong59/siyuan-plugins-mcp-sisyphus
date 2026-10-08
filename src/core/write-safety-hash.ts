import { nodeCrypto } from './node-loader';
import { canonicalizeState } from '../shared/canonical-state';

export const WRITE_STATE_HASH_VERSION = 'sha256:v1' as const;
export const WRITE_HASH_PREFIX_MIN_LENGTH = 4;
export const WRITE_HASH_DIGEST_LENGTH = 64;

/** JSON serialization with stable object keys and explicit undefined values. */
export function canonicalizeWriteState(value: unknown): string {
    return canonicalizeState(value);
}

export function hashWriteState(value: unknown): string {
    const digest = nodeCrypto().createHash('sha256')
        .update(canonicalizeWriteState(value), 'utf8')
        .digest('hex');
    return `${WRITE_STATE_HASH_VERSION}:${digest}`;
}

export function hashWriteBytes(value: Uint8Array): string {
    const digest = nodeCrypto().createHash('sha256').update(value).digest('hex');
    return `${WRITE_STATE_HASH_VERSION}:${digest}`;
}

/** Yield between bounded chunks so kernel hashing does not monopolize goja. */
export async function hashWriteBytesAsync(value: Uint8Array): Promise<string> {
    const hash = nodeCrypto().createHash('sha256');
    for (let offset = 0; offset < value.length; offset += 64 * 1024) {
        hash.update(value.subarray(offset, offset + 64 * 1024));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return `${WRITE_STATE_HASH_VERSION}:${hash.digest('hex')}`;
}

export function isVersionedWriteHash(value: unknown): value is string {
    return typeof value === 'string' && /^sha256:v1:[a-f0-9]{64}$/.test(value);
}

/** Parse a temporary preflight credential without treating it as a state hash. */
export function parseWriteHashCredential(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const match = /^(?:sha256:v1:)?([a-f0-9]{4,64})$/i.exec(value);
    return match?.[1].toLowerCase();
}

export function writeHashDigest(value: string): string {
    if (!isVersionedWriteHash(value)) {
        throw new Error(`Expected a complete ${WRITE_STATE_HASH_VERSION} digest.`);
    }
    return value.slice(WRITE_STATE_HASH_VERSION.length + 1);
}

/** Process-local aliases. Issued names stay reserved until this runtime restarts. */
export class WriteHashPool {
    private readonly byHash = new Map<string, string>();
    private readonly byAlias = new Map<string, string>();

    issue(fullHash: string): string {
        const digest = writeHashDigest(fullHash);
        const existing = this.byHash.get(fullHash);
        if (existing) return existing;
        let length = WRITE_HASH_PREFIX_MIN_LENGTH;
        while (this.byAlias.has(digest.slice(0, length))) length += 1;
        const alias = digest.slice(0, length);
        this.byHash.set(fullHash, alias);
        this.byAlias.set(alias, fullHash);
        return alias;
    }

    resolve(value: string): string | undefined {
        const digest = parseWriteHashCredential(value);
        if (!digest) return undefined;
        // Full digests still require a matching active operation lease.
        return digest.length === WRITE_HASH_DIGEST_LENGTH
            ? `${WRITE_STATE_HASH_VERSION}:${digest}`
            : this.byAlias.get(digest);
    }
}

// Preflight credentials, safety receipts and AV audit fields share this pool.
export const writeHashPool = new WriteHashPool();

/** Receipt-only display values. Never mutate the full hashes stored in the ledger. */
export function compactWriteHashFields(
    fields: Record<string, unknown>,
    pool = writeHashPool,
): Record<string, unknown> {
    const compact = { ...fields };
    for (const key of ['previousHash', 'resultHash', 'expectedHash', 'currentHash']) {
        if (isVersionedWriteHash(fields[key])) compact[key] = pool.issue(fields[key]);
    }
    return compact;
}
