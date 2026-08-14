import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import type { OfficialMcpRuntime, OfficialMcpTool } from '@/core/official-mcp-bridge';
import {
    callExtensionTool,
    listExtensionTools,
    prepareExtensionTools,
    rebaseOfficialSchemaRefs,
} from '@/tools/extension';
import { createMockClient } from '../../helpers/mock-client';
import { createMockPermissionManager } from '../../helpers/mock-permissions';

function pluginTool(overrides: Partial<OfficialMcpTool> = {}): OfficialMcpTool {
    return {
        name: 'plugin__alpha__aggregate',
        title: 'Alpha aggregate',
        description: 'A plugin tool with its own action parameter.',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string' },
                value: { type: 'number' },
            },
            required: ['action'],
        },
        source: 'plugin',
        readOnlyHint: false,
        effectScope: 'local',
        schemaDegraded: false,
        ...overrides,
    };
}

function nativeTool(overrides: Partial<OfficialMcpTool> = {}): OfficialMcpTool {
    return pluginTool({
        name: 'document',
        title: 'Native document',
        description: 'The native SiYuan document tool.',
        source: 'native',
        readOnlyHint: false,
        ...overrides,
    });
}

function fakeRuntime(tools = [pluginTool()]) {
    const callTool = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"ok":true}' }],
    });
    const refresh = vi.fn().mockResolvedValue({
        tools,
        connected: true,
        changed: false,
    });
    const bridge = {
        getTools: () => tools,
        getSnapshot: () => ({ tools, connected: true, changed: false }),
        refresh,
        callTool,
    };
    return {
        runtime: { bridge } as unknown as OfficialMcpRuntime,
        callTool,
        refresh,
    };
}

describe('extension tool', () => {
    it('does not discover official tools while extension is disabled', async () => {
        const config = buildDefaultToolConfig().extension;
        config.enabled = false;
        const { runtime, refresh } = fakeRuntime();

        await expect(prepareExtensionTools(config, runtime)).resolves.toBeUndefined();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('builds one dynamic action branch and nests the downstream schema under arguments', () => {
        const config = buildDefaultToolConfig().extension;
        const { runtime } = fakeRuntime();

        const descriptor = listExtensionTools(config, runtime)[0];
        const schema = descriptor.inputSchema as any;
        const branch = schema.oneOf.find((item: any) => item.properties?.action?.const === 'plugin__alpha__aggregate');

        expect(schema.properties.action.enum).toContain('plugin__alpha__aggregate');
        expect(branch.required).toEqual(['action', 'arguments']);
        expect(branch.properties.arguments.properties.action).toEqual({ type: 'string' });
        expect(branch.description).toContain('Explicit user confirmation');
        expect(branch.readOnlyHint).toBe(false);
        expect(branch.effectScope).toBe('local');
    });

    it('rebases local downstream schema references after nesting under an action branch', () => {
        expect(rebaseOfficialSchemaRefs({
            type: 'object',
            properties: {
                item: { $ref: '#/$defs/Item' },
                external: { $ref: 'https://example.com/schema.json' },
            },
            $defs: {
                Item: {
                    type: 'object',
                    properties: { child: { $ref: '#/$defs/Item' } },
                },
            },
        }, '#/oneOf/2/properties/arguments')).toEqual({
            type: 'object',
            properties: {
                item: { $ref: '#/oneOf/2/properties/arguments/$defs/Item' },
                external: { $ref: 'https://example.com/schema.json' },
            },
            $defs: {
                Item: {
                    type: 'object',
                    properties: {
                        child: { $ref: '#/oneOf/2/properties/arguments/$defs/Item' },
                    },
                },
            },
        });
    });

    it('removes blocked plugin and native tools from the exposed action schema', () => {
        const config = buildDefaultToolConfig().extension;
        config.includeNativeTools = true;
        config.blockedTools = ['plugin__alpha__aggregate', 'document'];
        const { runtime } = fakeRuntime([pluginTool(), nativeTool()]);

        const descriptor = listExtensionTools(config, runtime)[0];

        expect((descriptor.inputSchema as any).properties.action.enum).not.toContain('plugin__alpha__aggregate');
        expect((descriptor.inputSchema as any).properties.action.enum).not.toContain('document');
    });

    it('keeps native tools hidden by default and exposes their official names when enabled', () => {
        const config = buildDefaultToolConfig().extension;
        const native = nativeTool();
        const { runtime } = fakeRuntime([pluginTool(), native]);

        let descriptor = listExtensionTools(config, runtime)[0];
        expect((descriptor.inputSchema as any).properties.action.enum).not.toContain(native.name);

        config.includeNativeTools = true;
        descriptor = listExtensionTools(config, runtime)[0];
        const branch = (descriptor.inputSchema as any).oneOf
            .find((item: any) => item.properties?.action?.const === native.name);
        expect((descriptor.inputSchema as any).properties.action.enum).toContain('document');
        expect(branch.source).toBe('native');
    });

    it('returns discovery counts without tool details while native tools are disabled', async () => {
        const config = buildDefaultToolConfig().extension;
        const tools = [pluginTool(), nativeTool()];
        const { runtime } = fakeRuntime(tools);

        const result = await callExtensionTool(
            createMockClient(),
            { action: 'list' },
            config,
            createMockPermissionManager(),
            runtime,
        );
        const payload = JSON.parse(result.content[0].text);

        expect(payload).toEqual(expect.objectContaining({
            discoveredCount: 2,
            discoveredBySource: { plugin: 1, native: 1 },
            nativeToolsEnabled: false,
            exposedCount: 1,
            detailsIncluded: false,
        }));
        expect(payload).not.toHaveProperty('tools');
        expect(result.content[0].text).not.toContain('The native SiYuan document tool.');
    });

    it('omits the discovered tool-name list from general help while native tools are disabled', async () => {
        const config = buildDefaultToolConfig().extension;
        const { runtime } = fakeRuntime([pluginTool(), nativeTool()]);

        const result = await callExtensionTool(
            createMockClient(),
            { action: 'help' },
            config,
            createMockPermissionManager(),
            runtime,
        );
        const payload = JSON.parse(result.content[0].text);

        expect(payload).toEqual(expect.objectContaining({
            discoveredCount: 2,
            discoveredBySource: { plugin: 1, native: 1 },
            detailsIncluded: false,
        }));
        expect(payload).not.toHaveProperty('discoveredTools');
    });

    it('does not expose official tools that conflict with reserved extension actions', async () => {
        const config = buildDefaultToolConfig().extension;
        config.includeNativeTools = true;
        const reserved = nativeTool({ name: 'help' });
        const { runtime } = fakeRuntime([reserved]);

        const descriptor = listExtensionTools(config, runtime)[0];
        expect((descriptor.inputSchema as any).properties.action.enum).toEqual([
            'help',
            'list',
            'validate_package',
            'diagnose_plugin_mcp',
        ]);

        const result = await callExtensionTool(
            createMockClient(),
            { action: 'list' },
            config,
            createMockPermissionManager(),
            runtime,
        );
        const payload = JSON.parse(result.content[0].text);
        expect(payload.tools[0]).toEqual(expect.objectContaining({
            name: 'help',
            source: 'native',
            reservedActionConflict: true,
            exposed: false,
        }));
    });

    it('forwards nested arguments unchanged exactly once', async () => {
        const config = buildDefaultToolConfig().extension;
        const { runtime, callTool } = fakeRuntime();
        const downstreamArgs = { action: 'inner_action', value: 42 };

        const result = await callExtensionTool(
            createMockClient(),
            {
                action: 'plugin__alpha__aggregate',
                arguments: downstreamArgs,
            },
            config,
            createMockPermissionManager(),
            runtime,
        );

        expect(callTool).toHaveBeenCalledTimes(1);
        expect(callTool).toHaveBeenCalledWith('plugin__alpha__aggregate', downstreamArgs);
        expect(result.isError).not.toBe(true);
    });

    it('validates explicit package content locally without requiring an official MCP bridge', async () => {
        const config = buildDefaultToolConfig().extension;

        const result = await callExtensionTool(
            createMockClient(),
            {
                action: 'validate_package',
                package: {
                    type: 'theme',
                    manifest: {
                        name: 'sample-theme',
                        version: '1.0.0',
                        modes: ['light'],
                    },
                    files: { 'theme.css': ':root { --b3-theme-background: #fff; }' },
                },
            },
            config,
            createMockPermissionManager(),
        );
        const payload = JSON.parse(result.content[0].text);

        expect(result.isError).not.toBe(true);
        expect(payload).toEqual(expect.objectContaining({
            kind: 'static_extension_package_validation',
            staticPackage: 'valid',
            lifecycle: expect.objectContaining({ reload: 'not_triggered' }),
        }));
    });

    it('reads a refreshed Source=plugin registry without treating absence as completed unload', async () => {
        const config = buildDefaultToolConfig().extension;
        const observed = pluginTool({
            name: 'plugin__my_plugin__read_item',
            readOnlyHint: true,
        });
        const refresh = vi.fn().mockResolvedValue({
            tools: [observed],
            connected: true,
            supported: true,
            siyuanVersion: '3.7.3',
            changed: false,
        });
        const runtime = {
            bridge: {
                refresh,
                getTools: () => [observed],
                getSnapshot: () => ({ tools: [observed], connected: true, changed: false }),
            },
        } as unknown as OfficialMcpRuntime;

        const result = await callExtensionTool(
            createMockClient(),
            {
                action: 'diagnose_plugin_mcp',
                pluginName: 'my-plugin',
                expectedToolNames: ['read item', 'removed'],
                expectedState: 'absent',
            },
            config,
            createMockPermissionManager(),
            runtime,
        );
        const payload = JSON.parse(result.content[0].text);

        expect(refresh).toHaveBeenCalledWith({ forceVersionCheck: true });
        expect(payload.plugin).toEqual(expect.objectContaining({
            manifestName: 'my-plugin',
            sanitizedName: 'my_plugin',
            toolPrefix: 'plugin__my_plugin__',
            registeredTools: [expect.objectContaining({ name: 'plugin__my_plugin__read_item' })],
        }));
        expect(payload.expectation).toEqual(expect.objectContaining({
            expectedState: 'absent',
            allMet: false,
            tools: expect.arrayContaining([
                expect.objectContaining({ qualifiedName: 'plugin__my_plugin__read_item', observed: true, expectationMet: false }),
                expect.objectContaining({ qualifiedName: 'plugin__my_plugin__removed', observed: false, expectationMet: true }),
            ]),
        }));
        expect(payload.lifecycle).toEqual(expect.objectContaining({
            kernelPluginRunning: 'inferred_from_registered_tool',
            mcpToolUnregistration: 'registry_absence_observed_not_proven',
            reload: 'not_triggered',
            functionAfterReload: 'not_verified',
        }));
    });

    it('does not present a stale bridge cache as fresh lifecycle evidence after refresh fails', async () => {
        const config = buildDefaultToolConfig().extension;
        const stale = pluginTool({ name: 'plugin__my_plugin__echo' });
        const runtime = {
            bridge: {
                refresh: vi.fn().mockResolvedValue({
                    tools: [stale],
                    connected: false,
                    changed: false,
                    error: 'connection failed',
                }),
                getTools: () => [stale],
                getSnapshot: () => ({ tools: [stale], connected: false, changed: false }),
            },
        } as unknown as OfficialMcpRuntime;

        const result = await callExtensionTool(
            createMockClient(),
            {
                action: 'diagnose_plugin_mcp',
                pluginName: 'my-plugin',
                expectedToolNames: ['echo'],
                expectedState: 'present',
            },
            config,
            createMockPermissionManager(),
            runtime,
        );
        const payload = JSON.parse(result.content[0].text);

        expect(result.isError).toBe(true);
        expect(payload.observation).toBe('unavailable');
        expect(payload.plugin.registeredTools).toEqual([]);
        expect(payload.expectation).toEqual(expect.objectContaining({ allMet: false }));
        expect(payload.lifecycle.mcpToolRegistration).toBe('not_observed');
    });

    it('rejects cached native tools while disabled and forwards them after the switch is enabled', async () => {
        const config = buildDefaultToolConfig().extension;
        const native = nativeTool();
        const { runtime, callTool } = fakeRuntime([native]);

        const disabledResult = await callExtensionTool(
            createMockClient(),
            { action: native.name, arguments: { action: 'read' } },
            config,
            createMockPermissionManager(),
            runtime,
        );
        expect(disabledResult.isError).toBe(true);
        expect(disabledResult.content[0].text).toContain('includeNativeTools');
        expect(callTool).not.toHaveBeenCalled();

        config.includeNativeTools = true;
        const enabledResult = await callExtensionTool(
            createMockClient(),
            { action: native.name, arguments: { action: 'read' } },
            config,
            createMockPermissionManager(),
            runtime,
        );
        expect(enabledResult.isError).not.toBe(true);
        expect(callTool).toHaveBeenCalledWith(native.name, { action: 'read' });
    });

    it('refreshes once when a requested action is not cached', async () => {
        const config = buildDefaultToolConfig().extension;
        const tool = pluginTool();
        const callTool = vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'ok' }],
        });
        const bridge = {
            getTools: () => [],
            getSnapshot: () => ({ tools: [], connected: true, changed: false }),
            refresh: vi.fn().mockResolvedValue({
                tools: [tool],
                connected: true,
                changed: true,
            }),
            callTool,
        };
        const notifyToolListChanged = vi.fn();
        const runtime = { bridge, notifyToolListChanged } as unknown as OfficialMcpRuntime;

        await callExtensionTool(
            createMockClient(),
            { action: tool.name, arguments: {} },
            config,
            createMockPermissionManager(),
            runtime,
        );

        expect(bridge.refresh).toHaveBeenCalledTimes(1);
        expect(notifyToolListChanged).toHaveBeenCalledTimes(1);
        expect(callTool).toHaveBeenCalledTimes(1);
    });

    it('notifies after prepare discovers a changed action set without failing on notification errors', async () => {
        const config = buildDefaultToolConfig().extension;
        const refresh = vi.fn().mockResolvedValue({
            tools: [pluginTool()],
            connected: true,
            changed: true,
        });
        const notifyToolListChanged = vi.fn().mockRejectedValue(new Error('outer client closed'));
        const runtime = {
            bridge: {
                refresh,
                getTools: () => [pluginTool()],
                getSnapshot: () => ({
                    tools: [],
                    connected: false,
                    minSupportedVersion: '3.7.0',
                    changed: false,
                }),
            },
            notifyToolListChanged,
        } as unknown as OfficialMcpRuntime;

        await expect(prepareExtensionTools(config, runtime)).resolves.toEqual(expect.objectContaining({
            changed: true,
        }));
        expect(notifyToolListChanged).toHaveBeenCalledTimes(1);
    });

    it('notifies when includeNativeTools changes the exposed action set', async () => {
        const config = buildDefaultToolConfig().extension;
        const tools = [pluginTool(), nativeTool()];
        const runtime = {
            bridge: {
                refresh: vi.fn().mockResolvedValue({
                    tools,
                    connected: true,
                    changed: false,
                }),
                getTools: () => tools,
                getSnapshot: () => ({
                    tools,
                    connected: true,
                    supported: true,
                    minSupportedVersion: '3.7.0',
                    lastAttemptAt: '2026-07-28T00:00:00.000Z',
                    changed: false,
                }),
            },
            notifyToolListChanged: vi.fn(),
        } as unknown as OfficialMcpRuntime;

        await prepareExtensionTools(config, runtime);
        config.includeNativeTools = true;
        await prepareExtensionTools(config, runtime);

        expect(runtime.notifyToolListChanged).toHaveBeenCalledTimes(2);
    });

    it('uses a completed discovery snapshot without refreshing on every tools/list', async () => {
        const config = buildDefaultToolConfig().extension;
        const tools = [pluginTool()];
        const refresh = vi.fn();
        const runtime = {
            bridge: {
                getSnapshot: () => ({
                    tools,
                    connected: true,
                    supported: true,
                    minSupportedVersion: '3.7.0',
                    lastAttemptAt: '2026-07-28T00:00:00.000Z',
                    lastSuccessfulRefreshAt: '2026-07-28T00:00:00.000Z',
                    changed: false,
                }),
                getTools: () => tools,
                refresh,
            },
        } as unknown as OfficialMcpRuntime;

        await prepareExtensionTools(config, runtime);
        await prepareExtensionTools(config, runtime);

        expect(refresh).not.toHaveBeenCalled();
    });

    it('starts discovery in the background without delaying the outer tools/list', async () => {
        const config = buildDefaultToolConfig().extension;
        const tools = [pluginTool()];
        let resolveRefresh!: (snapshot: any) => void;
        const refresh = vi.fn(() => new Promise((resolve) => {
            resolveRefresh = resolve;
        }));
        const notifyToolListChanged = vi.fn();
        const runtime = {
            bridge: {
                getSnapshot: () => ({
                    tools: [],
                    connected: false,
                    minSupportedVersion: '3.7.0',
                    changed: false,
                }),
                getTools: () => [],
                refresh,
            },
            discoveryMode: 'background',
            notifyToolListChanged,
        } as unknown as OfficialMcpRuntime;

        const snapshot = await prepareExtensionTools(config, runtime);

        expect(snapshot?.tools).toEqual([]);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(notifyToolListChanged).not.toHaveBeenCalled();

        resolveRefresh({
            tools,
            connected: true,
            supported: true,
            minSupportedVersion: '3.7.0',
            lastAttemptAt: '2026-07-28T00:00:00.000Z',
            changed: true,
        });
        await runtime.discoveryPromise;

        expect(notifyToolListChanged).toHaveBeenCalledTimes(1);
    });
});
