import { describe, expect, it } from 'vitest';

import {
    canonicalizeWriteState,
    compactWriteHashFields,
    WriteHashPool,
    hashWriteState,
    isVersionedWriteHash,
    parseWriteHashCredential,
} from '@/core/write-safety-hash';
import { hashCanonicalState } from '@/shared/canonical-state';

describe('write state hashing', () => {
    it('shortens receipt hashes without changing stored hashes or business fields', () => {
        const fields = {
            previousHash: `sha256:v1:0e22${'9'.repeat(60)}`,
            resultHash: `sha256:v1:986e${'c'.repeat(60)}`,
            content: `sha256:v1:${'f'.repeat(64)}`,
            expectedStateHash: '0e22',
        };
        expect(compactWriteHashFields(fields)).toEqual({
            ...fields, previousHash: '0e22', resultHash: '986e',
        });
        expect(fields.previousHash).toHaveLength(74);
        expect(fields.resultHash).toHaveLength(74);
    });

    it('reserves aliases across responses and extends each occupied candidate', () => {
        const pool = new WriteHashPool();
        const a = `sha256:v1:abcd0${'0'.repeat(59)}`;
        const b = `sha256:v1:abcd1${'0'.repeat(59)}`;
        const c = `sha256:v1:abcd12${'0'.repeat(58)}`;
        expect(compactWriteHashFields({ resultHash: a }, pool).resultHash).toBe('abcd');
        expect(compactWriteHashFields({ resultHash: b }, pool).resultHash).toBe('abcd1');
        expect(compactWriteHashFields({ currentHash: c }, pool).currentHash).toBe('abcd12');
        expect(pool.issue(a)).toBe('abcd');
        expect(pool.resolve('ABCD')).toBe(a);
        expect(pool.resolve('sha256:v1:ABCD1')).toBe(b);
        expect(pool.resolve('abcd12')).toBe(c);
        expect(pool.resolve('abcd0')).toBeUndefined();
        expect(pool.resolve('abc')).toBeUndefined();
        expect(new WriteHashPool().resolve('abcd')).toBeUndefined();
    });

    it('extends to 64 digits if every shorter alias is already assigned', () => {
        const pool = new WriteHashPool();
        for (let length = 4; length < 64; length += 1) {
            expect(pool.issue(`sha256:v1:${'a'.repeat(length)}b${'0'.repeat(63 - length)}`))
                .toBe('a'.repeat(length));
        }
        const full = `sha256:v1:${'a'.repeat(64)}`;
        expect(pool.issue(full)).toBe('a'.repeat(64));
        expect(pool.resolve(pool.issue(full))).toBe(full);
        expect(pool.issue(full)).toBe('a'.repeat(64));
    });

    it('keeps equal hashes equal and leaves absent or malformed values untouched', () => {
        const hash = `sha256:v1:${'a'.repeat(64)}`;
        expect(compactWriteHashFields({ previousHash: hash, resultHash: hash })).toEqual({
            previousHash: 'aaaa', resultHash: 'aaaa',
        });
        expect(compactWriteHashFields({ resultHash: 'invalid', expectedHash: undefined })).toEqual({
            resultHash: 'invalid', expectedHash: undefined,
        });
    });

    it('is stable across object key order and Unicode input', () => {
        const left = hashWriteState({ 文档: '你好', b: 2, a: { y: true, x: null } });
        const right = hashWriteState({ a: { x: null, y: true }, b: 2, 文档: '你好' });
        expect(left).toBe(right);
        expect(isVersionedWriteHash(left)).toBe(true);
    });

    it('preserves array order and distinguishes undefined from null', () => {
        expect(hashWriteState([1, 2])).not.toBe(hashWriteState([2, 1]));
        expect(hashWriteState({ value: undefined })).not.toBe(hashWriteState({ value: null }));
        expect(canonicalizeWriteState({ value: undefined })).toContain('undefined');
    });

    it('keeps renderer-visible canonical SHA-256 equal to the strict coordinator hash', async () => {
        const value = { b: [undefined, '关系'], a: { n: -0, bytes: new Uint8Array([0, 255]) } };
        await expect(hashCanonicalState(value)).resolves.toBe(hashWriteState(value));
    });

    it('accepts bare or versioned 4-64 digit credentials case-insensitively', () => {
        expect(parseWriteHashCredential('8ac2')).toBe('8ac2');
        expect(parseWriteHashCredential('sha256:v1:8AC2')).toBe('8ac2');
        expect(parseWriteHashCredential('A'.repeat(64))).toBe('a'.repeat(64));
        expect(parseWriteHashCredential(`sha256:v1:${'f'.repeat(64)}`)).toBe('f'.repeat(64));
        expect(parseWriteHashCredential('abc')).toBeUndefined();
        expect(parseWriteHashCredential('a'.repeat(65))).toBeUndefined();
        expect(parseWriteHashCredential('sha256:v2:8ac2')).toBeUndefined();
        expect(parseWriteHashCredential('xyz1')).toBeUndefined();
    });
});
