import { describe, expect, it, vi } from 'vitest';
import { AV_ACTIONS, buildDefaultToolConfig, normalizeToolConfig, loadToolConfigFromApiFileWithStatus, saveToolConfigToApiFile } from '@/core/config';
import { AV_VARIANTS, callAvTool } from '@/tools/av';

describe('AV v2 contract and explicit configuration migration', () => {
    it('exposes only the new read/create/view entrypoints', async () => {
        for (const action of ['render', 'get_attribute_view_keys', 'get_attribute_view_filter_sort', 'get_primary_key_values', 'set_filters', 'set_sorts', 'set_group', 'set_column_visibility', 'set_column_order']) {
            expect(AV_ACTIONS).not.toContain(action);
            expect((await callAvTool({} as any, { action }, buildDefaultToolConfig().av, {} as any)).isError).toBe(true);
        }
        for (const action of ['get', 'query', 'create', 'update_view']) {
            const variant = AV_VARIANTS.find(item => item.action === action)!;
            expect(variant.schema.properties.id).toBeUndefined();
            expect(() => variant.validate({ action, id: 'old-id' })).toThrow();
        }
    });

    it.each([undefined, 1])('migrates v%s get:true plus disabled keys to get:false before defaults', version => {
        const result = normalizeToolConfig({ avActionsVersion: version, av: { enabled: true, actions: { get: true, get_attribute_view_keys: false } } });
        expect(result.av.actions.get).toBe(false);
        expect(result.avActionsVersion).toBe(2);
        expect(result.av.actions).not.toHaveProperty('get_attribute_view_keys');
        expect(normalizeToolConfig(result)).toEqual(result);
    });
    it.each([
        [{ render: false }, ['create', 'query']],
        [{ get_primary_key_values: false, render: true }, ['query']],
        [{ set_filters: true, set_column_order: false }, ['update_view']],
        [{ get: false, get_attribute_view_filter_sort: true }, ['get']],
    ])('conservatively merges old sources %j', (actions, disabled) => {
        const result = normalizeToolConfig({ av: { actions } });
        for (const action of disabled) expect(result.av.actions[action]).toBe(false);
    });
    it('ignores unversioned new flags and honors versioned new flags', () => {
        expect(normalizeToolConfig({ av: { actions: { render: false, query: true } } }).av.actions.query).toBe(false);
        expect(normalizeToolConfig({ avActionsVersion: 2, av: { actions: { get: true, get_attribute_view_keys: false, query: true, render: false } } }).av.actions).toMatchObject({ get: true, query: true });
    });
    it('uses defaults only when all source flags are absent and preserves category disable', () => {
        expect(normalizeToolConfig({}).av).toEqual(buildDefaultToolConfig().av);
        expect(normalizeToolConfig({ av: { enabled: false } }).av.enabled).toBe(false);
    });
    it('fails closed for unknown versions and does not write on read', async () => {
        const client = { readFile: vi.fn(async () => '{"avActionsVersion":99}'), writeFile: vi.fn() } as any;
        expect(() => normalizeToolConfig({ avActionsVersion: 99 })).toThrow('Unsupported');
        const result = await loadToolConfigFromApiFileWithStatus(client);
        expect(result.ok).toBe(false);
        expect(result.config.av.enabled).toBe(false);
        expect(client.writeFile).not.toHaveBeenCalled();
    });
    it('persists versioned normalized settings and survives reload', async () => {
        let stored = JSON.stringify({ av: { actions: { get: true, get_attribute_view_keys: false } } });
        const client = { readFile: async () => stored, writeFile: vi.fn(async (_path, content) => { stored = content; }) } as any;
        const before = await loadToolConfigFromApiFileWithStatus(client);
        expect(client.writeFile).not.toHaveBeenCalled();
        await saveToolConfigToApiFile(client, before.config);
        expect(JSON.parse(stored).avActionsVersion).toBe(2);
        expect((await loadToolConfigFromApiFileWithStatus(client)).config).toEqual(before.config);
    });
});
