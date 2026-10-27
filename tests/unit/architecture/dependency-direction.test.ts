import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve('src');

/**
 * Top-level src directories each layer may import from (besides itself).
 * core is the foundation the tools build on; mcp assembles tools into the
 * registry, call gate, write coordinator and server.
 */
const ALLOWED: Record<string, string[]> = {
    api: ['types'],
    types: [],
    shared: ['api', 'types'],
    core: ['api', 'types', 'shared'],
    tools: ['api', 'types', 'shared', 'core'],
    mcp: ['api', 'types', 'shared', 'core', 'tools'],
    kernel: ['api', 'types', 'shared', 'core', 'tools', 'mcp'],
    // The renderer stays off the tool implementations and the MCP assembly.
    ui: ['api', 'types', 'shared', 'core'],
};

/** core derives its action tables from the per-tool declaration leaves. */
const ACTION_DECLARATION = /^tools\/[^/]+\/actions$/;

function listSourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listSourceFiles(full);
        return /\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
    });
}

/** Import targets as src-relative paths without extension. */
function importedTargets(file: string): string[] {
    const source = fs.readFileSync(file, 'utf8');
    const targets: string[] = [];
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const spec = match[1];
        let target: string | undefined;
        if (spec.startsWith('@/')) target = path.join(SRC, spec.slice(2));
        else if (spec.startsWith('.')) target = path.resolve(path.dirname(file), spec);
        if (!target) continue;
        const rel = path.relative(SRC, target).split(path.sep).join('/').replace(/\.(ts|svelte)$/, '');
        if (!rel.startsWith('..')) targets.push(rel);
    }
    return targets;
}

describe('src dependency direction', () => {
    it('keeps lower layers free of imports from ui, cli and other higher layers', () => {
        const violations: string[] = [];
        for (const [layer, allowed] of Object.entries(ALLOWED)) {
            for (const file of listSourceFiles(path.join(SRC, layer))) {
                for (const target of importedTargets(file)) {
                    const targetLayer = target.split('/')[0];
                    if (targetLayer === layer || allowed.includes(targetLayer)) continue;
                    if (layer === 'core' && ACTION_DECLARATION.test(target)) continue;
                    violations.push(`${path.relative(SRC, file)} -> ${target}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('keeps per-tool action declarations dependency-free so the renderer can load them', () => {
        const toolsDir = path.join(SRC, 'tools');
        const offenders: string[] = [];
        for (const tool of fs.readdirSync(toolsDir)) {
            const file = path.join(toolsDir, tool, 'actions.ts');
            if (!fs.existsSync(file)) continue;
            for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
                if (match[1] !== '../../core/action-spec') offenders.push(`tools/${tool}/actions.ts -> ${match[1]}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps the av base modules layered definition -> rows -> carrier -> transaction', () => {
        const order = ['definition', 'rows', 'carrier', 'transaction'];
        const offenders: string[] = [];
        order.forEach((name, rank) => {
            for (const target of importedTargets(path.join(SRC, 'tools/av', `${name}.ts`))) {
                const sibling = target.startsWith('tools/av/') ? target.slice('tools/av/'.length) : undefined;
                if (sibling && (sibling.endsWith('-handlers') || sibling === 'handlers' || order.indexOf(sibling) >= rank)) {
                    offenders.push(`tools/av/${name}.ts -> ${target}`);
                }
            }
        });
        expect(offenders).toEqual([]);
    });
});
