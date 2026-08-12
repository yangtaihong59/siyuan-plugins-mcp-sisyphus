import { describe, expect, it } from 'vitest';

import {
    canonicalizeWriteState,
    hashWriteState,
    isVersionedWriteHash,
    parseWriteHashCredential,
} from '@/core/write-safety-hash';

describe('write state hashing', () => {
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
