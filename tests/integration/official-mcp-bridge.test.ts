import { describe, expect, it } from 'vitest';

import { HttpSiYuanClient } from '@/api/client';
import { OfficialMcpBridge } from '@/core/official-mcp-bridge';

describe('official MCP bridge transport', () => {
    it('uses the official session, preserves custom metadata, paginates, and calls once', async () => {
        const sessionId = 'official-session';
        const seenAuth: string[] = [];
        const seenSessions: string[] = [];
        let callCount = 0;

        const fakeFetch: typeof fetch = async (_input, init) => {
            const headers = new Headers(init?.headers);
            seenAuth.push(headers.get('Authorization') ?? '');
            const requestSession = headers.get('Mcp-Session-Id');
            if (requestSession) seenSessions.push(requestSession);
            if (init?.method === 'DELETE') {
                return new Response(null, { status: 200 });
            }

            const body = JSON.parse(String(init?.body ?? '{}'));
            if (body.method === 'initialize') {
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        protocolVersion: '2025-06-18',
                        capabilities: { tools: { listChanged: false } },
                        serverInfo: { name: 'SiYuan', version: '3.7.3' },
                    },
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Mcp-Session-Id': sessionId,
                    },
                });
            }
            if (body.method === 'notifications/initialized') {
                return new Response(null, { status: 202 });
            }
            if (body.method === 'tools/list') {
                const secondPage = body.params?.cursor === 'page-2';
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: secondPage
                        ? {
                            tools: [
                                {
                                    name: 'plugin__beta__write',
                                    description: 'Beta write',
                                    inputSchema: { type: 'object', properties: {} },
                                    source: 'plugin',
                                    readOnlyHint: false,
                                    effectScope: 'external',
                                },
                                {
                                    name: 'document',
                                    description: 'Native document',
                                    inputSchema: { type: 'object', properties: {} },
                                    source: 'native',
                                    effectScope: 'local',
                                },
                            ],
                        }
                        : {
                            tools: [{
                                name: 'plugin__alpha__read',
                                description: 'Alpha read',
                                inputSchema: { type: 'object', properties: {} },
                                source: 'plugin',
                                readOnlyHint: true,
                                effectScope: 'local',
                            }],
                            nextCursor: 'page-2',
                        },
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (body.method === 'tools/call') {
                callCount += 1;
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(body.params.arguments) }],
                    },
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            return new Response(null, { status: 404 });
        };

        const siyuanClient = new HttpSiYuanClient({ baseUrl: 'http://127.0.0.1:6806' });
        siyuanClient.setToken('secret');
        const bridge = new OfficialMcpBridge(siyuanClient, {
            fetch: fakeFetch,
            getSiYuanVersion: async () => '3.7.3',
        });

        try {
            const snapshot = await bridge.refresh();
            const result = await bridge.callTool('plugin__beta__write', { action: 'inner', value: 7 });

            expect(snapshot.tools.map((tool) => tool.name)).toEqual([
                'document',
                'plugin__alpha__read',
                'plugin__beta__write',
            ]);
            expect(snapshot.tools[0]).toEqual(expect.objectContaining({
                source: 'native',
                effectScope: 'local',
            }));
            expect(snapshot.tools[1]).toEqual(expect.objectContaining({
                readOnlyHint: true,
                effectScope: 'local',
            }));
            expect(snapshot.tools[2]).toEqual(expect.objectContaining({
                readOnlyHint: false,
                effectScope: 'external',
            }));
            expect(result.content[0].text).toContain('"action":"inner"');
            expect(callCount).toBe(1);
            expect(seenAuth.every((header) => header === 'Token secret')).toBe(true);
            expect(seenSessions).toContain(sessionId);
        } finally {
            await bridge.close();
        }
    });
});
