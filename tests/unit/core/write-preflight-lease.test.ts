import { describe, expect, it } from 'vitest';
import { WriteHashPool, compactWriteHashFields } from '@/core/write-safety-hash';

import {
    WRITE_PREFLIGHT_LEASE_MAX_ENTRIES,
    WRITE_PREFLIGHT_LEASE_TTL_MS,
    WritePreflightLeasePool,
    type WritePreflightLeaseScope,
} from '@/core/write-preflight-lease';

const baseScope: WritePreflightLeaseScope = {
    tool: 'block',
    action: 'update',
    argsHash: `sha256:v1:${'a'.repeat(64)}`,
    targetIds: ['target-b', 'target-a'],
};

function full(prefix: string, fill = '0'): string {
    return `sha256:v1:${prefix}${fill.repeat(64 - prefix.length)}`;
}

describe('write preflight lease pool', () => {
    it('shares aliases across scopes and receipts without invalidating earlier credentials', () => {
        const hashes = new WriteHashPool();
        const pool = new WritePreflightLeasePool(hashes);
        const first = pool.issue(baseScope, full('8ac2f'), 1);
        expect(first).toMatchObject({ credential: '8ac2', hashPrefixLength: 4 });
        expect(compactWriteHashFields({ resultHash: full('8ac29', '1') }, hashes).resultHash).toBe('8ac29');
        const other = { ...baseScope, action: 'delete' };
        const second = pool.issue(other, full('8ac29', '1'), 2);
        expect(second).toMatchObject({ credential: '8ac29', hashPrefixLength: 5 });
        expect(pool.resolve(baseScope, '8ac2', 3)).toMatchObject({ status: 'ok', lease: { fullHash: full('8ac2f') } });
        expect(pool.resolve(other, '8ac2', 3)).toEqual({ status: 'invalid' });
        expect(pool.resolve(other, '8ac29', 3)).toMatchObject({ status: 'ok' });
        pool.issue(baseScope, full('8ac29', '1'), 3);
        expect(pool.resolve(baseScope, '8ac2', 3)).toMatchObject({ status: 'ok', lease: { fullHash: full('8ac2f') } });
        expect(pool.resolve(baseScope, '8ac29', 3)).toMatchObject({ status: 'ok', lease: { fullHash: full('8ac29', '1') } });
        expect(pool.resolve(baseScope, '8ac2f', 3)).toEqual({ status: 'invalid' });
        expect(pool.issue(baseScope, full('8ac2f'), 4).credential).toBe('8ac2');
        expect(pool.resolve(baseScope, full('8ac2f'), 5)).toMatchObject({ status: 'ok' });
        pool.consume(first.lease);
        expect(pool.resolve(baseScope, '8ac2', 5)).toEqual({ status: 'invalid' });
        expect(hashes.issue(full('8ac2f'))).toBe('8ac2');
        expect(hashes.issue(full('8ac2e'))).toBe('8ac2e');
    });

    it('isolates tool, action, arguments, and sorted target IDs', () => {
        const pool = new WritePreflightLeasePool(new WriteHashPool());
        const hash = full('abcd');
        pool.issue(baseScope, hash, 1);

        expect(pool.resolve({ ...baseScope, targetIds: [...baseScope.targetIds].reverse() }, 'abcd', 2)).toMatchObject({ status: 'ok' });
        expect(pool.resolve({ ...baseScope, tool: 'document' }, 'abcd', 2)).toEqual({ status: 'invalid' });
        expect(pool.resolve({ ...baseScope, action: 'delete' }, 'abcd', 2)).toEqual({ status: 'invalid' });
        expect(pool.resolve({ ...baseScope, argsHash: full('b') }, 'abcd', 2)).toEqual({ status: 'invalid' });
        expect(pool.resolve({ ...baseScope, targetIds: ['other'] }, 'abcd', 2)).toEqual({ status: 'invalid' });
    });

    it('refreshes duplicates, expires at ten minutes, and is process-local', () => {
        const pool = new WritePreflightLeasePool(new WriteHashPool());
        const hash = full('1234');
        const first = pool.issue(baseScope, hash, 10);
        const renewed = pool.issue(baseScope, hash, 20);
        expect(pool.size).toBe(1);
        expect(renewed.leaseExpiresAt).toBe(20 + WRITE_PREFLIGHT_LEASE_TTL_MS);
        expect(renewed.leaseExpiresAt).toBeGreaterThan(first.leaseExpiresAt);
        expect(pool.resolve(baseScope, '1234', renewed.leaseExpiresAt - 1)).toMatchObject({ status: 'ok' });
        expect(pool.resolve(baseScope, '1234', renewed.leaseExpiresAt)).toEqual({ status: 'invalid' });
        expect(new WritePreflightLeasePool(new WriteHashPool()).resolve(baseScope, '1234', 21)).toEqual({ status: 'invalid' });
    });

    it('keeps only four distinct hashes per scope and consumes exact leases', () => {
        const pool = new WritePreflightLeasePool(new WriteHashPool());
        const hashes = ['1000', '2000', '3000', '4000', '5000'].map((prefix) => full(prefix));
        hashes.forEach((hash, index) => pool.issue(baseScope, hash, index + 1));
        expect(pool.size).toBe(4);
        expect(pool.resolve(baseScope, '1000', 10)).toEqual({ status: 'invalid' });
        const resolved = pool.resolve(baseScope, '5000', 10);
        expect(resolved.status).toBe('ok');
        if (resolved.status === 'ok') pool.consume(resolved.lease);
        expect(pool.resolve(baseScope, '5000', 10)).toEqual({ status: 'invalid' });
    });

    it('evicts the globally oldest lease above 1024 entries', () => {
        const pool = new WritePreflightLeasePool(new WriteHashPool());
        for (let index = 0; index <= WRITE_PREFLIGHT_LEASE_MAX_ENTRIES; index += 1) {
            pool.issue({ ...baseScope, argsHash: full(index.toString(16).padStart(4, '0')) }, full('abcd'), index + 1);
        }
        expect(pool.size).toBe(WRITE_PREFLIGHT_LEASE_MAX_ENTRIES);
        expect(pool.resolve({ ...baseScope, argsHash: full('0000') }, 'abcd', 2000)).toEqual({ status: 'invalid' });
        expect(pool.resolve({ ...baseScope, argsHash: full('0400') }, 'abcd', 2000)).toMatchObject({ status: 'ok' });
    });
});
