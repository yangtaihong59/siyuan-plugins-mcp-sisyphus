import { describe, expect, it } from 'vitest';

import { suggestActions, suggestFlag } from '@/cli/flag-mapper';
import { BLOCK_ACTIONS } from '@/core/config';

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

describe('suggestActions', () => {
    it('suggests block reads for a bare "get", prefix matches first', () => {
        const near = suggestActions('get', [...BLOCK_ACTIONS]);
        expect(near.length).toBeGreaterThan(1);
        expect(near.every((name) => name.startsWith('get_'))).toBe(true);
        expect(near).toEqual(expect.arrayContaining(['get_kramdown', 'get_attrs']));
    });

    it('matches a whole word, a substring and a typo', () => {
        expect(suggestActions('attrs', ['get_attrs', 'set_attrs', 'move'])).toEqual(['get_attrs', 'set_attrs']);
        expect(suggestActions('kramdown', ['get_kramdown', 'move'])).toEqual(['get_kramdown']);
        expect(suggestActions('udpate', ['update', 'delete'])).toEqual(['update']);
        expect(suggestActions('zebra', ['update', 'delete'])).toEqual([]);
    });
});
