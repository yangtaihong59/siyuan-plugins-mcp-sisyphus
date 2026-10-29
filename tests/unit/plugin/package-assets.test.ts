import fs from 'node:fs';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

/**
 * Bazaar limits on marketplace images (siyuan-note/bazaar rules/images.go).
 * The Stage index re-checks every release; a package that fails is not
 * updated in the marketplace.
 */
const BAZAAR_IMAGE_LIMITS = [
    { file: 'icon.png', maxBytes: 64 * 1024 },
    { file: 'preview.png', maxBytes: 512 * 1024 },
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Files the renderer build copies into package.zip (viteStaticCopy targets). */
function packagedFiles(): Set<string> {
    const config = fs.readFileSync('vite.config.ts', 'utf8');
    const patterns = [...config.matchAll(/\{ src: "\.\/([^"]+)", dest:/g)].map((match) => match[1]);
    return new Set(fg.sync(patterns));
}

/** Relative image paths a README references through <img>, <source> or Markdown. */
function readmeImages(readme: string): string[] {
    const text = fs.readFileSync(readme, 'utf8');
    const refs = [
        ...[...text.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map((match) => match[1]),
        ...[...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]),
    ];
    return refs.filter((ref) => !/^[a-z]+:/i.test(ref)).map((ref) => ref.replace(/^\.\//, ''));
}

describe('package assets', () => {
    it.each(BAZAAR_IMAGE_LIMITS)('$file is a PNG within the bazaar limit', ({ file, maxBytes }) => {
        const data = fs.readFileSync(file);
        expect(data.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        expect(data.length).toBeLessThanOrEqual(maxBytes);
    });

    it.each(['README.md', 'README_zh_CN.md'])('every local image in %s exists and is packaged', (readme) => {
        const packaged = packagedFiles();
        const images = readmeImages(readme);
        expect(images.length).toBeGreaterThan(0);
        for (const image of images) {
            expect(fs.existsSync(image), image).toBe(true);
            expect(packaged.has(image), image).toBe(true);
        }
    });
});
