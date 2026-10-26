import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
    connect: vi.fn(),
    request: vi.fn(),
    callTool: vi.fn(),
    close: vi.fn(),
}));

vi.mock('@modelcontextprotocol/client', () => ({
    Client: class {
        connect = sdkMocks.connect;
        request = sdkMocks.request;
        callTool = sdkMocks.callTool;
    },
    StreamableHTTPClientTransport: class {
        close = sdkMocks.close;
    },
}));

import { HttpSiYuanClient } from '@/api/client';
import {
    OfficialMcpBridge,
    normalizeOfficialInputSchema,
    selectOfficialTools,
} from '@/core/official-mcp-bridge';
import {
    MIN_OFFICIAL_MCP_VERSION,
    supportsOfficialMcp,
} from '@/shared/official-mcp-support';

function createBridge(version = '3.7.3') {
    return new OfficialMcpBridge(
        new HttpSiYuanClient({ baseUrl: 'http://127.0.0.1:6806' }),
        { getSiYuanVersion: vi.fn().mockResolvedValue(version) },
    );
}

describe('official MCP bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sdkMocks.connect.mockResolvedValue(undefined);
        sdkMocks.close.mockResolvedValue(undefined);
    });

    it('preserves plugin/native metadata, treats missing source as native, and excludes external MCP and itself', () => {
        const tools = selectOfficialTools([
            {
                name: 'plugin__alpha__read',
                title: 'Read',
                description: 'Read from alpha.',
                inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
                source: 'plugin',
                readOnlyHint: true,
                effectScope: 'local',
            },
            {
                name: 'search',
                inputSchema: { type: 'object' },
                source: 'native',
                effectScope: 'local',
            },
            {
                name: 'document',
                inputSchema: { type: 'object' },
            },
            {
                name: 'server__external',
                inputSchema: { type: 'object' },
                source: 'mcp',
            },
            {
                name: 'plugin__siyuan_plugins_mcp_sisyphus__loop',
                inputSchema: { type: 'object' },
                source: 'plugin',
            },
        ]);

        expect(tools).toEqual([
            expect.objectContaining({
                name: 'document',
                source: 'native',
            }),
            expect.objectContaining({
                name: 'plugin__alpha__read',
                title: 'Read',
                source: 'plugin',
                readOnlyHint: true,
                effectScope: 'local',
                schemaDegraded: false,
            }),
            expect.objectContaining({
                name: 'search',
                source: 'native',
                effectScope: 'local',
            }),
        ]);
    });

    it('degrades invalid non-object input schemas', () => {
        expect(normalizeOfficialInputSchema({ type: 'string' })).toEqual({
            schema: { type: 'object', additionalProperties: true },
            degraded: true,
        });
        expect(normalizeOfficialInputSchema({ properties: { action: { type: 'string' } } })).toEqual({
            schema: {
                type: 'object',
                properties: { action: { type: 'string' } },
            },
            degraded: false,
        });
        expect(selectOfficialTools([{
            name: 'plugin__alpha__malformed',
            description: 'Malformed but still discoverable.',
            inputSchema: 'not-an-object',
            source: 'plugin',
        }])).toEqual([expect.objectContaining({
            name: 'plugin__alpha__malformed',
            inputSchema: { type: 'object', additionalProperties: true },
            schemaDegraded: true,
        })]);
    });

    it('compares SiYuan versions without requiring the whole plugin to raise its minimum version', () => {
        expect(MIN_OFFICIAL_MCP_VERSION).toBe('3.7.0');
        expect(supportsOfficialMcp('3.6.9')).toBe(false);
        expect(supportsOfficialMcp('3.7.0')).toBe(true);
        expect(supportsOfficialMcp('v3.7.0-dev1')).toBe(true);
        expect(supportsOfficialMcp('3.10.1')).toBe(true);
    });

    it('marks old SiYuan versions unsupported without connecting to /mcp', async () => {
        const getSiYuanVersion = vi.fn().mockResolvedValue('3.6.9');
        const bridge = new OfficialMcpBridge(
            new HttpSiYuanClient({ baseUrl: 'http://127.0.0.1:6806' }),
            { getSiYuanVersion },
        );

        const first = await bridge.refresh();
        const second = await bridge.refresh();

        expect(first).toEqual(expect.objectContaining({
            connected: false,
            supported: false,
            siyuanVersion: '3.6.9',
            minSupportedVersion: '3.7.0',
            tools: [],
        }));
        expect(second.supported).toBe(false);
        expect(getSiYuanVersion).toHaveBeenCalledTimes(1);
        expect(sdkMocks.connect).not.toHaveBeenCalled();
        expect(sdkMocks.request).not.toHaveBeenCalled();
    });

    it('reconnects and retries discovery once while keeping custom metadata', async () => {
        sdkMocks.request
            .mockRejectedValueOnce(new Error('session expired'))
            .mockResolvedValueOnce({
                tools: [{
                    name: 'plugin__alpha__write',
                    description: 'Write through alpha.',
                    inputSchema: { type: 'object', properties: {} },
                    source: 'plugin',
                    readOnlyHint: false,
                    effectScope: 'local',
                }],
            });
        const bridge = createBridge();

        const snapshot = await bridge.refresh();

        expect(sdkMocks.request).toHaveBeenCalledTimes(2);
        expect(sdkMocks.connect).toHaveBeenCalledTimes(2);
        expect(snapshot.connected).toBe(true);
        expect(snapshot.tools[0]).toEqual(expect.objectContaining({
            name: 'plugin__alpha__write',
            readOnlyHint: false,
            effectScope: 'local',
        }));
    });

    it('hides cached dynamic tools when an explicit discovery refresh can no longer reach /mcp', async () => {
        sdkMocks.request
            .mockResolvedValueOnce({
                tools: [{
                    name: 'plugin__alpha__read',
                    inputSchema: { type: 'object' },
                    source: 'plugin',
                    readOnlyHint: true,
                }],
            })
            .mockRejectedValueOnce(new Error('official MCP offline'))
            .mockRejectedValueOnce(new Error('official MCP offline'));
        const bridge = createBridge();

        const available = await bridge.refresh();
        const unavailable = await bridge.refresh();

        expect(available.tools).toHaveLength(1);
        expect(unavailable).toEqual(expect.objectContaining({
            connected: false,
            tools: [],
            changed: true,
            error: 'official MCP offline',
        }));
    });

    it('never retries a dispatched plugin tool call', async () => {
        sdkMocks.callTool.mockRejectedValueOnce(new Error('socket closed'));
        const bridge = createBridge();

        const result = await bridge.callTool('plugin__alpha__write', { value: 1 });

        expect(sdkMocks.callTool).toHaveBeenCalledTimes(1);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Execution status is unknown');
    });
});
