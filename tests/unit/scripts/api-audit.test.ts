import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parsePluginTools, parseRouter, runAudit, stripComments } from '../../../scripts/api-audit.mjs';
import { ACTIONS_BY_CATEGORY, DANGEROUS_ACTIONS, TOOL_CATEGORIES } from '../../../src/core/config';
import { ACTION_SAFETY_POLICIES } from '../../../src/core/write-safety-policy';

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

    it('reads per-tool action specs consistently with the runtime config', () => {
        const plugin = parsePluginTools();
        expect(plugin.tools.map((tool: { name: string }) => tool.name)).toEqual([...TOOL_CATEGORIES]);
        for (const tool of plugin.tools as Array<{ name: typeof TOOL_CATEGORIES[number]; actions: string[] }>) {
            expect(tool.actions).toEqual([...ACTIONS_BY_CATEGORY[tool.name]]);
            for (const action of tool.actions) {
                const policy = (ACTION_SAFETY_POLICIES[tool.name] as Record<string, { mode: string; precondition?: string }>)[action];
                const expected = policy.mode === 'mutation' ? `mutation(${policy.precondition})` : policy.mode;
                expect(plugin.safety.get(`${tool.name}.${action}`)).toBe(expected);
                expect(plugin.dangerous.has(`${tool.name}.${action}`)).toBe(DANGEROUS_ACTIONS[tool.name].has(action));
            }
        }
    });

    // Requires the pinned SiYuan source checkout at sample/siyuan (not present in CI).
    it.skipIf(!fs.existsSync(path.resolve('sample/siyuan/.git')))('matches the fixed SiYuan and plugin baselines with no document drift', () => {
        const readFile = fs.readFileSync.bind(fs);
        const sampleRoot = path.resolve('sample/siyuan') + path.sep;
        const guard = vi.spyOn(fs, 'readFileSync').mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
            if (typeof args[0] === 'string' && path.resolve(args[0]).startsWith(sampleRoot)) {
                throw new Error('Audit must read pinned Git objects, not the mutable sample checkout');
            }
            return readFile(...args);
        });
        let audited: ReturnType<typeof runAudit>;
        try {
            audited = runAudit({ check: true });
        } finally {
            guard.mockRestore();
        }
        const { model } = audited;
        expect(model.routes).toHaveLength(593);
        expect(model.paths.size).toBe(589);
        expect([...model.paths].filter((item) => item.startsWith('/api/'))).toHaveLength(582);
        expect(model.added).toHaveLength(43);
        expect(model.removed).toEqual(['/api/ai/agent/frontendToolResult']);
        expect(model.permissionChanges).toHaveLength(11);
        expect(model.production).toHaveLength(38);
        expect(model.plugin.tools).toHaveLength(14);
        expect(model.actions).toHaveLength(138);
        expect(model.backendLiterals.size).toBe(151);
        expect(model.validBackend).toHaveLength(150);
        expect(model.invalidBackend).toEqual(['/api/asset/setImageAlpha']);
        expect([...model.toolDirectOnly.keys()]).toEqual(['/api/file/readDir']);

        const mapping = fs.readFileSync(path.resolve('API_MCP_MAPPING.md'), 'utf8');
        const mappedActions = new Set([...mapping.matchAll(/^\| `([a-z_]+\.[a-z_]+)` \|/gm)].map((match) => match[1]));
        expect(mappedActions).toEqual(new Set(model.actions));
    });
});
