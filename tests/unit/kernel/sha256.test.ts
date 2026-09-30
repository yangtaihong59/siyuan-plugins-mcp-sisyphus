import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Sha256 } from '@/kernel/sha256';
import { UploadStagingStore } from '@/core/upload-source';
it('incremental SHA matches native crypto across padding and chunk boundaries', () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 10000, 1024 * 1024]) {
        const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251);
        const hash = new Sha256();
        for (let i = 0; i < bytes.length; i += 37) hash.update(bytes.subarray(i, i + 37));
        expect(Buffer.from(hash.digest()).toString('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
        expect(() => hash.update(bytes)).toThrow('finalized');
    }
});
it('async staging hashes an immutable copy and yields while preserving source identity', async () => {
    const store = new UploadStagingStore();
    const bytes = new Uint8Array(128 * 1024).fill(37);
    const expected = store.stageBytes('file', bytes);
    let yielded = false;
    setTimeout(() => { yielded = true; bytes.fill(0); }, 0);
    const actual = await store.stageBytesAsync('file', bytes);
    expect(yielded).toBe(true);
    expect(actual.uploadSource).toBe(expected.uploadSource);
});
