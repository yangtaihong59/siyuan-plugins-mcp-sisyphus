import { describe, expect, it } from 'vitest';

import { auditImageReferences, imageReferenceBasename } from '@/tools/internal/image-reference-audit';

describe('image reference audit', () => {
    it('normalizes query strings and SiYuan timestamp/id suffixes', () => {
        expect(imageReferenceBasename('assets/cover.png?download=1')).toBe('cover.png');
        expect(imageReferenceBasename('/data/assets/cover-20260813120000-abcdefg.png')).toBe('cover.png');
    });

    it('reports exact missing and extra references while deduplicating expectations', () => {
        expect(auditImageReferences(
            ['assets/a.png', 'assets/a.png', 'assets/b.png'],
            ['assets/a-20260813120000-abcdefg.png', 'assets/c.png'],
        )).toEqual({
            expectedRefs: ['assets/a.png', 'assets/b.png'],
            actualRefs: ['assets/a-20260813120000-abcdefg.png', 'assets/c.png'],
            missingRefs: ['assets/b.png'],
            extraRefs: ['assets/c.png'],
            expectedCount: 2,
            actualCount: 2,
            ok: false,
        });
    });
});
