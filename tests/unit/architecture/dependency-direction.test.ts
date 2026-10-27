import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve('src');

/** Top-level src directories each layer may import from (besides itself). */
const ALLOWED: Record<string, string[]> = {
    api: ['types'],
    types: [],
    shared: ['api', 'types'],
    tools: ['api', 'types', 'shared', 'core'],
    core: ['api', 'types', 'shared', 'tools'],
    kernel: ['api', 'types', 'shared', 'core', 'tools'],
};

function listSourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listSourceFiles(full);
        return /\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
    });
}

function importedLayers(file: string): string[] {
    const source = fs.readFileSync(file, 'utf8');
    const layers: string[] = [];
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const spec = match[1];
        let target: string | undefined;
        if (spec.startsWith('@/')) target = path.join(SRC, spec.slice(2));
        else if (spec.startsWith('.')) target = path.resolve(path.dirname(file), spec);
        if (!target) continue;
        const rel = path.relative(SRC, target);
        if (!rel.startsWith('..')) layers.push(rel.split(path.sep)[0]);
    }
    return layers;
}

describe('src dependency direction', () => {
    it('keeps lower layers free of imports from ui, cli and other higher layers', () => {
        const violations: string[] = [];
        for (const [layer, allowed] of Object.entries(ALLOWED)) {
            for (const file of listSourceFiles(path.join(SRC, layer))) {
                for (const target of importedLayers(file)) {
                    if (target !== layer && !allowed.includes(target)) {
                        violations.push(`${path.relative(SRC, file)} -> ${target}`);
                    }
                }
            }
        }
        expect(violations).toEqual([]);
    });
});
