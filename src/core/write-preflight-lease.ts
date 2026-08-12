import type { ToolCategory } from './config';
import {
    WRITE_HASH_DIGEST_LENGTH,
    WRITE_HASH_PREFIX_MIN_LENGTH,
    WRITE_STATE_HASH_VERSION,
    hashWriteState,
    writeHashDigest,
} from './write-safety-hash';

export const WRITE_PREFLIGHT_LEASE_TTL_MS = 10 * 60 * 1000;
export const WRITE_PREFLIGHT_LEASE_MAX_PER_SCOPE = 4;
export const WRITE_PREFLIGHT_LEASE_MAX_ENTRIES = 1024;

export interface WritePreflightLeaseScope {
    tool: ToolCategory;
    action: string;
    argsHash: string;
    targetIds: string[];
}

export interface WritePreflightLease extends WritePreflightLeaseScope {
    scopeKey: string;
    fullHash: string;
    createdAt: number;
    expiresAt: number;
}

export type WritePreflightLeaseResolution =
    | { status: 'ok'; lease: WritePreflightLease }
    | { status: 'invalid' }
    | { status: 'ambiguous'; minimumRequiredLength: number };

/**
 * Process-local preflight credentials. Only complete SHA-256 values are kept;
 * the short value exposed to callers is an untrusted lookup prefix.
 */
export class WritePreflightLeasePool {
    private leases: WritePreflightLease[] = [];

    issue(
        scope: WritePreflightLeaseScope,
        fullHash: string,
        now = Date.now(),
    ): { credential: string; hashPrefixLength: number; leaseExpiresAt: number; lease: WritePreflightLease } {
        writeHashDigest(fullHash);
        this.pruneExpired(now);
        const normalized = normalizeScope(scope);
        const scopeKey = buildScopeKey(normalized);
        let lease = this.leases.find((item) => item.scopeKey === scopeKey && item.fullHash === fullHash);
        if (lease) {
            lease.createdAt = now;
            lease.expiresAt = now + WRITE_PREFLIGHT_LEASE_TTL_MS;
        } else {
            lease = {
                ...normalized,
                scopeKey,
                fullHash,
                createdAt: now,
                expiresAt: now + WRITE_PREFLIGHT_LEASE_TTL_MS,
            };
            this.leases.push(lease);
        }

        this.enforceScopeCapacity(scopeKey);
        this.enforceGlobalCapacity();
        const prefixLength = shortestUniquePrefixLength(
            lease.fullHash,
            this.leases.filter((item) => item.scopeKey === scopeKey).map((item) => item.fullHash),
        );
        return {
            credential: `${WRITE_STATE_HASH_VERSION}:${writeHashDigest(fullHash).slice(0, prefixLength)}`,
            hashPrefixLength: prefixLength,
            leaseExpiresAt: lease.expiresAt,
            lease: cloneLease(lease),
        };
    }

    resolve(
        scope: WritePreflightLeaseScope,
        digestPrefix: string,
        now = Date.now(),
    ): WritePreflightLeaseResolution {
        this.pruneExpired(now);
        const scopeKey = buildScopeKey(normalizeScope(scope));
        const matches = this.leases.filter((item) => (
            item.scopeKey === scopeKey && writeHashDigest(item.fullHash).startsWith(digestPrefix.toLowerCase())
        ));
        if (matches.length === 0) return { status: 'invalid' };
        if (matches.length > 1) {
            return {
                status: 'ambiguous',
                minimumRequiredLength: Math.max(
                    digestPrefix.length + 1,
                    ...matches.map((item) => shortestUniquePrefixLength(
                        item.fullHash,
                        matches.map((candidate) => candidate.fullHash),
                    )),
                ),
            };
        }
        return { status: 'ok', lease: cloneLease(matches[0]) };
    }

    consume(lease: WritePreflightLease): void {
        const index = this.leases.findIndex((item) => (
            item.scopeKey === lease.scopeKey && item.fullHash === lease.fullHash
        ));
        if (index >= 0) this.leases.splice(index, 1);
    }

    /** Test and diagnostics only; never exposes hashes or note content. */
    get size(): number {
        return this.leases.length;
    }

    private pruneExpired(now: number): void {
        this.leases = this.leases.filter((item) => item.expiresAt > now);
    }

    private enforceScopeCapacity(scopeKey: string): void {
        const scoped = this.leases
            .filter((item) => item.scopeKey === scopeKey)
            .sort(compareLeaseAge);
        while (scoped.length > WRITE_PREFLIGHT_LEASE_MAX_PER_SCOPE) {
            this.removeExact(scoped.shift()!);
        }
    }

    private enforceGlobalCapacity(): void {
        if (this.leases.length <= WRITE_PREFLIGHT_LEASE_MAX_ENTRIES) return;
        const oldest = [...this.leases].sort(compareLeaseAge);
        while (this.leases.length > WRITE_PREFLIGHT_LEASE_MAX_ENTRIES) {
            this.removeExact(oldest.shift()!);
        }
    }

    private removeExact(lease: WritePreflightLease): void {
        const index = this.leases.indexOf(lease);
        if (index >= 0) this.leases.splice(index, 1);
    }
}

function normalizeScope(scope: WritePreflightLeaseScope): WritePreflightLeaseScope {
    return { ...scope, targetIds: [...scope.targetIds].sort() };
}

function buildScopeKey(scope: WritePreflightLeaseScope): string {
    return hashWriteState(scope);
}

function shortestUniquePrefixLength(fullHash: string, candidates: string[]): number {
    const digest = writeHashDigest(fullHash);
    for (let length = WRITE_HASH_PREFIX_MIN_LENGTH; length < WRITE_HASH_DIGEST_LENGTH; length += 1) {
        const prefix = digest.slice(0, length);
        if (candidates.every((candidate) => candidate === fullHash || !writeHashDigest(candidate).startsWith(prefix))) {
            return length;
        }
    }
    return WRITE_HASH_DIGEST_LENGTH;
}

function compareLeaseAge(left: WritePreflightLease, right: WritePreflightLease): number {
    return left.createdAt - right.createdAt || left.expiresAt - right.expiresAt;
}

function cloneLease(lease: WritePreflightLease): WritePreflightLease {
    return { ...lease, targetIds: [...lease.targetIds] };
}
