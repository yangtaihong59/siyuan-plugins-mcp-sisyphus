import { describe, expect, it } from 'vitest';

import { auditImageReferences, imageReferenceBasename } from '@/tools/internal/image-reference-audit';

describe('image reference audit', () => {
    it('normalizes query strings and SiYuan timestamp/id suffixes', () => {
        expect(imageReferenceBasename('assets/cover.png?download=1')).toBe('cover.png');
        expect(imageReferenceBasename('/data/assets/cover-20260813120000-abcdefg.png')).toBe('cover.png');
    });

    it('reports exact missing and extra occurrences while preserving duplicate expectations', () => {
        expect(auditImageReferences(
            ['assets/a.png', 'assets/a.png', 'assets/b.png'],
            ['assets/a-20260813120000-abcdefg.png', 'assets/c.png'],
        )).toEqual({
            expectedRefs: ['assets/a.png', 'assets/a.png', 'assets/b.png'],
            actualRefs: ['assets/a-20260813120000-abcdefg.png', 'assets/c.png'],
            missingRefs: ['assets/a.png', 'assets/b.png'],
            extraRefs: ['assets/c.png'],
            expectedCount: 3,
            actualCount: 2,
            ok: false,
        });
    });

    it('treats duplicate expected refs and duplicate actual refs as separate occurrences', () => {
        expect(auditImageReferences(
            ['assets/cover.png', 'assets/cover.png'],
            ['assets/cover-20260813120000-abcdefg.png'],
        )).toMatchObject({
            missingRefs: ['assets/cover.png'],
            extraRefs: [],
            expectedCount: 2,
            actualCount: 1,
            ok: false,
        });
        expect(auditImageReferences(
            ['assets/cover.png'],
            ['assets/cover-20260813120000-abcdefg.png', 'assets/cover-20260813120001-abcdefh.png'],
        )).toMatchObject({
            missingRefs: [],
            extraRefs: ['assets/cover-20260813120001-abcdefh.png'],
            expectedCount: 1,
            actualCount: 2,
            ok: false,
        });
    });

    it('does not merge distinct paths that collide on a normalized basename', () => {
        expect(auditImageReferences(
            ['assets/first/cover.png', 'assets/second/cover.png'],
            ['assets/imported/cover-20260813120000-abcdefg.png'],
        )).toMatchObject({
            missingRefs: ['assets/second/cover.png'],
            extraRefs: [],
            ok: false,
        });
    });

    it('preserves multiplicity after query, fragment, and suffix normalization', () => {
        expect(auditImageReferences(
            ['assets/cover.png?download=1', 'assets/cover.png#source'],
            [
                'assets/cover-20260813120000-abcdefg.png?cache=1',
                'assets/cover-20260813120001-abcdefh.png#asset',
            ],
        )).toMatchObject({
            missingRefs: [],
            extraRefs: [],
            expectedCount: 2,
            actualCount: 2,
            ok: true,
        });
    });
});
