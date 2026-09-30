/*
 * Build-time generator for the kernel tool schema manifest.
 *
 * Loads src/kernel/schema-manifest.ts through vite's ssrLoadModule so the @/
 * alias, TS, and the (Node-safe) z.toJSONSchema calls in the tool variant
 * definitions all resolve exactly as they do for tests. The collected
 * descriptors are written to src/kernel/generated/kernel-schemas.json, which
 * kernel.js embeds at bundle time — the goja sandbox only ever sees plain JSON.
 *
 * Run directly:  node scripts/gen-kernel-schemas.mjs
 * Or via vite:   BUILD_TARGET=kernel vite build   (wired in via a plugin)
 */

import { createServer } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(repoRoot, 'src/kernel/generated/kernel-schemas.json');

export async function generateKernelSchemas() {
    const server = await createServer({
        configFile: resolve(repoRoot, 'vitest.config.ts'),
        logLevel: 'error',
        server: { middlewareMode: true, hmr: false },
        optimizeDeps: { noDiscovery: true },
    });
    try {
        const mod = await server.ssrLoadModule('/src/kernel/schema-manifest.ts');
        const tools = mod.buildKernelToolManifest();
        mkdirSync(dirname(outFile), { recursive: true });
        const generated = JSON.stringify({ tools, actions: mod.getRegisteredActionSchemas() }, null, 2) + '\n';
        // Watch builds import this file. Avoid retriggering the watcher when
        // only handler code changed and the schema is identical.
        if (!existsSync(outFile) || readFileSync(outFile, 'utf8') !== generated) writeFileSync(outFile, generated, 'utf8');
        return tools.length;
    } finally {
        await server.close();
    }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const count = await generateKernelSchemas();
    process.stdout.write(`gen-kernel-schemas: wrote ${count} tool descriptors -> ${outFile}\n`);
}
