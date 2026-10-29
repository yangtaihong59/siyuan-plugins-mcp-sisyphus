import { describe, expect, it } from 'vitest';

import { suggestFlag } from '@/cli/flag-mapper';

describe('suggestFlag', () => {
    it('suggests by prefix, per-word prefix and small typos', () => {
        expect(suggestFlag('--old', ['oldLabel', 'newLabel'])).toBe('oldLabel');
        expect(suggestFlag('--new', ['oldLabel', 'newLabel'])).toBe('newLabel');
        expect(suggestFlag('--doc-id', ['scope', 'documentId', 'name'])).toBe('documentId');
        expect(suggestFlag('--parnet-id', ['parentID', 'previousID'])).toBe('parentID');
        expect(suggestFlag('--sql-json', ['sql', 'stmt'])).toBe('sql');
    });

    it('returns undefined when nothing is close', () => {
        expect(suggestFlag('--zebra', ['oldLabel', 'newLabel'])).toBeUndefined();
        expect(suggestFlag('--x', ['xyzLong'])).toBeUndefined();
    });
});
