import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readMcpAppSource } from '../../helpers/mcp-app-source';

describe('MCP App documentation preview source contract', () => {
    const appSource = readMcpAppSource();

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

    it('preflights App mutations and executes them with server-issued idempotency', () => {
        expect(appSource).toContain('arguments: { ...args, validateOnly: true }');
        expect(appSource).toContain('requestId: payload.requestId');
        expect(appSource).toContain("toolErrorCode(preflight) === 'strict_mode_disabled'");
        expect(appSource).toContain("typeof payload?.requestId !== 'string'");
    });

    it('uses only the App tool names the server registers', async () => {
        const names = await import('@/core/mcp-app-names');
        const registered = new Set(Object.values(names).filter((value) => typeof value === 'string'));
        const used = new Set([...appSource.matchAll(/'((?:flashcard_review|timeline|mascot_shop)_(?:app_action|session|app))'/g)].map((match) => match[1]));
        expect(used.size).toBeGreaterThan(0);
        for (const name of used) expect(registered).toContain(name);
    });
});
