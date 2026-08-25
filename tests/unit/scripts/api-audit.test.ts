import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRouter, runAudit, stripComments } from '../../../scripts/api-audit.mjs';

describe('API audit', () => {
    it('parses Handle and Any while excluding commented registrations', () => {
        const source = `
            ginServer.Handle("POST", "/api/example/read", model.CheckAuth, read)
            // ginServer.Handle("POST", "/api/example/commented", commented)
            /* ginServer.Any("/api/example/commented-any", commentedAny) */
            ginServer.Any("/api/example/:id", model.CheckAuth, model.CheckAdminRole, dynamic)
        `;

        expect(parseRouter(source, 'fixture.go')).toEqual([
            expect.objectContaining({ method: 'POST', path: '/api/example/read', auth: true, admin: false, handler: 'read' }),
            expect.objectContaining({ method: 'ANY', path: '/api/example/:id', auth: true, admin: true, handler: 'dynamic' }),
        ]);
        expect(stripComments(source)).not.toContain('/api/example/commented-any');
    });

    it('fails closed when a new ginServer registration form appears', () => {
        expect(() => parseRouter('ginServer.PUT("/api/example", handler)', 'fixture.go'))
            .toThrow(/未知 Gin 注册形式 ginServer\.PUT/);
    });

    it('matches the fixed SiYuan and plugin baselines with no document drift', () => {
        const { model } = runAudit({ check: true });
        expect(model.routes).toHaveLength(593);
        expect(model.paths.size).toBe(589);
        expect([...model.paths].filter((item) => item.startsWith('/api/'))).toHaveLength(582);
        expect(model.added).toHaveLength(43);
        expect(model.removed).toEqual(['/api/ai/agent/frontendToolResult']);
        expect(model.permissionChanges).toHaveLength(11);
        expect(model.production).toHaveLength(38);
        expect(model.plugin.tools).toHaveLength(14);
        expect(model.actions).toHaveLength(143);
        expect(model.backendLiterals.size).toBe(150);
        expect(model.validBackend).toHaveLength(149);
        expect(model.invalidBackend).toEqual(['/api/asset/setImageAlpha']);
        expect([...model.toolDirectOnly.keys()]).toEqual(['/api/file/readDir']);

        const mapping = fs.readFileSync(path.resolve('API_MCP_MAPPING.md'), 'utf8');
        const mappedActions = new Set([...mapping.matchAll(/^\| `([a-z_]+\.[a-z_]+)` \|/gm)].map((match) => match[1]));
        expect(mappedActions).toEqual(new Set(model.actions));
    });
});
