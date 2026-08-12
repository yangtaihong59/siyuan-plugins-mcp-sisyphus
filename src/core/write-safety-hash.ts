import { createHash } from 'node:crypto';
import { canonicalizeState } from '../shared/canonical-state';

export const WRITE_STATE_HASH_VERSION = 'sha256:v1' as const;
export const WRITE_HASH_PREFIX_MIN_LENGTH = 4;
export const WRITE_HASH_DIGEST_LENGTH = 64;

/** JSON serialization with stable object keys and explicit undefined values. */
export function canonicalizeWriteState(value: unknown): string {
    return canonicalizeState(value);
}

export function hashWriteState(value: unknown): string {
    const digest = createHash('sha256')
        .update(canonicalizeWriteState(value), 'utf8')
        .digest('hex');
    return `${WRITE_STATE_HASH_VERSION}:${digest}`;
}

export function hashWriteBytes(value: Uint8Array): string {
    const digest = createHash('sha256').update(value).digest('hex');
    return `${WRITE_STATE_HASH_VERSION}:${digest}`;
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
