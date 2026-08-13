import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('MCP App documentation preview source contract', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/mcp-apps/index.ts'), 'utf8');

    it('keeps preview fixtures development-only', () => {
        expect(appSource).toContain('const previewMode = import.meta.env.DEV');
        expect(appSource).toContain("new URLSearchParams(window.location.search).get('preview')");
        expect(appSource).toContain('{ autoResize: !previewMode, strict: true }');
    });

    it('provides stable states for every documented MCP App', () => {
        expect(appSource).toContain("mode === 'flashcard'");
        expect(appSource).toContain("mode === 'timeline'");
        expect(appSource).toContain("mode === 'shop'");
        expect(appSource).toContain("name: '实验基线'");
        expect(appSource).toContain("label: '猫猫皇冠'");
    });

    it('preflights App mutations and executes them with UUIDv7 idempotency', () => {
        expect(appSource).toContain('arguments: { ...args, validateOnly: true }');
        expect(appSource).toContain('requestId: createUuidV7()');
        expect(appSource).toContain("toolErrorCode(preflight) === 'strict_mode_disabled'");
        expect(appSource).toContain('bytes[6] = 0x70');
    });
});
