import { createServer } from 'node:net';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSiYuanServer } from '@/core/server';
import { startHttpMcpServer, type HttpMcpServerHandle } from '@/core/http-transport';


const TOOL_CONFIG_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig';
const PERMISSIONS_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/notebookPermissions';

const jsonResponse = (payload: unknown): Response => ({
    ok: true,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
} as Response);

async function getAvailablePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Failed to acquire test port')));
                return;
            }
            const { port } = address;
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}

function parseToolResultText(result: Awaited<ReturnType<Client['callTool']>>): unknown {
    const text = (result.content as Array<{ type: string; text?: string }> | undefined)?.find((item) => item.type === 'text')?.text ?? '';
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

describe('HTTP MCP concurrency', () => {
    let serverHandle: HttpMcpServerHandle | null = null;
    let storedFiles: Record<string, string>;
    let originalFetch: typeof global.fetch;
    const clients: Client[] = [];
    const transports: StreamableHTTPClientTransport[] = [];

    beforeEach(() => {
        process.env.SIYUAN_TOKEN = 'test-token';
        originalFetch = global.fetch;
        storedFiles = {
            [PERMISSIONS_PATH]: '{}',
            [TOOL_CONFIG_PATH]: '',
        };

        global.fetch = vi.fn().mockImplementation(async (url, init) => {
            const urlStr = String(url);

            if (urlStr.includes('/api/file/getFile')) {
                const body = init?.body ? JSON.parse(String(init.body)) as { path?: string } : {};
                if (body.path === '/data/assets/question.png') {
                    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
                    return {
                        ok: true,
                        text: async () => '',
                        arrayBuffer: async () => bytes.buffer,
                    } as Response;
                }
                return {
                    ok: true,
                    text: async () => storedFiles[body.path ?? ''] ?? '',
                } as Response;
            }

            if (urlStr.includes('/api/query/sql')) {
                return jsonResponse({
                    code: 0,
                    msg: 'success',
                    data: [{
                        id: 'doc-image',
                        root_id: 'doc-image',
                        box: 'notebook-1',
                        path: '/doc-image.sy',
                        hpath: '/Image Question',
                        content: 'Image Question',
                        type: 'd',
                    }],
                });
            }

            if (urlStr.includes('/api/asset/getDocImageAssets')) {
                return jsonResponse({ code: 0, msg: 'success', data: ['assets/question.png'] });
            }

            if (urlStr.includes('/api/file/putFile')) {
                const formData = init?.body as FormData;
                const filePath = String(formData.get('path') ?? '');
                const file = formData.get('file');
                storedFiles[filePath] = file instanceof File ? await file.text() : String(file ?? '');
                return jsonResponse({ code: 0, msg: 'success', data: null });
            }

            if (urlStr.includes('/api/system/version')) {
                return jsonResponse({ code: 0, msg: 'success', data: '3.1.0' });
            }

            if (urlStr.includes('/api/system/currentTime')) {
                return jsonResponse({ code: 0, msg: 'success', data: 1712640000000 });
            }

            if (urlStr.startsWith('http://127.0.0.1:6806/')) {
                return jsonResponse({ code: 0, msg: 'success', data: {} });
            }

            return originalFetch(url, init);
        });
    });

    afterEach(async () => {
        while (clients.length) {
            const client = clients.pop();
            await client?.close().catch(() => {});
        }

        while (transports.length) {
            const transport = transports.pop();
            await transport?.close().catch(() => {});
        }

        await serverHandle?.close().catch(() => {});
        serverHandle = null;
        global.fetch = originalFetch;
        delete process.env.SIYUAN_TOKEN;
    });

    it('accepts two concurrent HTTP clients with isolated sessions', async () => {
        const port = await getAvailablePort();
        serverHandle = await startHttpMcpServer({
            host: '127.0.0.1',
            port,
            token: 'http-test-token',
            path: '/mcp',
            serverFactory: createSiYuanServer,
        });

        const serverUrl = new URL(`http://127.0.0.1:${serverHandle.port}${serverHandle.path}`);
        const createClient = async (name: string) => {
            const client = new Client({ name, version: '1.0.0' });
            const transport = new StreamableHTTPClientTransport(serverUrl, {
                requestInit: {
                    headers: {
                        Authorization: 'Bearer http-test-token',
                    },
                },
            });

            clients.push(client);
            transports.push(transport);
            await client.connect(transport);
            return { client, transport };
        };

        const [{ client: clientA, transport: transportA }, { client: clientB, transport: transportB }] = await Promise.all([
            createClient('http-concurrency-a'),
            createClient('http-concurrency-b'),
        ]);

        expect(transportA.sessionId).toBeTruthy();
        expect(transportB.sessionId).toBeTruthy();
        expect(transportA.sessionId).not.toEqual(transportB.sessionId);

        const [
            toolsA,
            toolsB,
            versionAResult,
            versionBResult,
        ] = await Promise.all([
            clientA.listTools(),
            clientB.listTools(),
            clientA.callTool({ name: 'system', arguments: { action: 'get_version' } }),
            clientB.callTool({ name: 'system', arguments: { action: 'get_version' } }),
        ]);

        expect(toolsA.tools.map((tool) => tool.name)).toContain('system');
        expect(toolsB.tools.map((tool) => tool.name)).toContain('system');
        expect(parseToolResultText(versionAResult)).toEqual({ version: '3.1.0' });
        expect(parseToolResultText(versionBResult)).toEqual({ version: '3.1.0' });
        expect(storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/puppyStats.json']).toBeTruthy();
    });

    it('accepts five concurrent HTTP clients across repeated read-only requests', async () => {
        const port = await getAvailablePort();
        serverHandle = await startHttpMcpServer({
            host: '127.0.0.1',
            port,
            token: 'http-test-token',
            path: '/mcp',
            serverFactory: createSiYuanServer,
        });

        const serverUrl = new URL(`http://127.0.0.1:${serverHandle.port}${serverHandle.path}`);
        const createClient = async (index: number) => {
            const client = new Client({ name: `http-concurrency-${index}`, version: '1.0.0' });
            const transport = new StreamableHTTPClientTransport(serverUrl, {
                requestInit: {
                    headers: {
                        Authorization: 'Bearer http-test-token',
                    },
                },
            });

            clients.push(client);
            transports.push(transport);
            await client.connect(transport);
            return { client, transport };
        };

        const pairs = await Promise.all([1, 2, 3, 4, 5].map((index) => createClient(index)));
        const sessionIds = pairs.map(({ transport }) => transport.sessionId);

        expect(sessionIds.every(Boolean)).toBe(true);
        expect(new Set(sessionIds).size).toBe(5);

        const rounds = await Promise.all(
            pairs.map(async ({ client }) => {
                const [tools, versionResult, currentTimeResult] = await Promise.all([
                    client.listTools(),
                    client.callTool({ name: 'system', arguments: { action: 'get_version' } }),
                    client.callTool({ name: 'system', arguments: { action: 'get_current_time' } }),
                ]);

                return {
                    tools,
                    version: parseToolResultText(versionResult),
                    currentTime: parseToolResultText(currentTimeResult),
                };
            }),
        );

        for (const round of rounds) {
            expect(round.tools.tools.map((tool) => tool.name)).toContain('system');
            expect(round.version).toEqual({ version: '3.1.0' });
            expect(round.currentTime).toEqual({
                currentTime: 1712640000000,
                iso: new Date(1712640000000).toISOString(),
            });
        }
    });

    it('negotiates MCP 2026-07-28 without creating a legacy HTTP session', async () => {
        const port = await getAvailablePort();
        serverHandle = await startHttpMcpServer({
            host: '127.0.0.1',
            port,
            token: 'http-test-token',
            path: '/mcp',
            serverFactory: createSiYuanServer,
        });

        const client = new Client(
            { name: 'http-modern-client', version: '1.0.0' },
            {
                capabilities: { elicitation: {} },
                versionNegotiation: { mode: 'auto' },
            },
        );
        const confirm = vi.fn().mockResolvedValue({
            action: 'accept',
            content: { confirm: true },
        });
        client.setRequestHandler('elicitation/create', confirm);
        const transport = new StreamableHTTPClientTransport(
            new URL(`http://127.0.0.1:${serverHandle.port}${serverHandle.path}`),
            { requestInit: { headers: { Authorization: 'Bearer http-test-token' } } },
        );
        clients.push(client);
        transports.push(transport);

        await client.connect(transport);
        const tools = await client.listTools();
        const versionResult = await client.callTool({ name: 'system', arguments: { action: 'get_version' } });
        const imageResult = await client.callTool({
            name: 'file',
            arguments: { action: 'read_image', id: 'doc-image', path: 'assets/question.png' },
        });
        const syncResult = await client.callTool({ name: 'system', arguments: { action: 'perform_sync' } });

        expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
        expect(imageResult.content).toEqual([
            expect.objectContaining({ type: 'text', text: expect.stringContaining('"delivery": "mcp_image"') }),
            {
                type: 'image',
                data: Buffer.from(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])).toString('base64'),
                mimeType: 'image/png',
            },
        ]);
        expect(imageResult.structuredContent).toMatchObject({
            documentID: 'doc-image',
            path: 'assets/question.png',
            mimeType: 'image/png',
            bytes: 9,
        });
        expect(client.getDiscoverResult()?.supportedVersions).toContain('2026-07-28');
        expect(transport.sessionId).toBeUndefined();
        expect(tools.tools.map((tool) => tool.name)).toContain('system');
        expect(parseToolResultText(versionResult)).toEqual({ version: '3.1.0' });
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(syncResult.isError).not.toBe(true);
        expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/api/sync/performSync'))).toBe(true);
    });

    it('rejects untrusted browser origins before MCP dispatch', async () => {
        const port = await getAvailablePort();
        serverHandle = await startHttpMcpServer({
            host: '127.0.0.1',
            port,
            path: '/mcp',
            serverFactory: createSiYuanServer,
        });

        const response = await originalFetch(
            `http://127.0.0.1:${serverHandle.port}${serverHandle.path}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://attacker.example',
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} }),
            },
        );

        expect(response.status).toBe(403);
    });
});
