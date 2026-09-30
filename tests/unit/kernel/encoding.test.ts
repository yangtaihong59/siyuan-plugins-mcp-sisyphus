import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { nodeCrypto } from '@/kernel/node-shims';
afterEach(() => { vi.unstubAllGlobals(); });
it('preserves Node SHA-256 for Unicode and large UTF-8 string input', () => {
    for (const value of ['中文 🌏', '\ud800', 'x'.repeat(256 * 1024)]) {
        expect(nodeCrypto().createHash('sha256').update(value, 'utf8').digest('hex')).toBe(createHash('sha256').update(value).digest('hex'));
    }
});
it('uses host Buffer for TextEncoder without changing Unicode bytes', async () => {
    const expected = Buffer.from('中文 🌏\ud800');
    vi.stubGlobal('TextEncoder', undefined); vi.stubGlobal('TextDecoder', undefined);
    vi.resetModules(); await import('@/kernel/polyfill');
    const encoded = new TextEncoder().encode('中文 🌏\ud800');
    expect(Buffer.from(encoded)).toEqual(expected);
    expect(new TextDecoder().decode(encoded)).toBe('中文 🌏�');
});
