import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { USER_RULES_VIRTUAL_PATH, resetToolConfigWarningStateForTests } from '@/core/config';
import { USER_RULES_RESOURCE_URI } from '@/core/help';
import {
    FLASHCARD_APP_HANDOFF_MESSAGE,
    FLASHCARD_APP_MODEL_INSTRUCTION,
    FLASHCARD_APP_PRESENTATION_MODE,
    FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
    MCP_APPS_EXTENSION_ID,
    MCP_APP_LEGACY_RESOURCE_URI_META_KEY,
    MCP_APP_MIME_TYPE,
    MCP_APP_RESOURCE_URIS,
    TIMELINE_APP_ACTION_TOOL_NAME,
    TIMELINE_APP_TOOL_NAME,
    MASCOT_SHOP_APP_TOOL_NAME,
    MASCOT_SHOP_APP_ACTION_TOOL_NAME,
} from '@/core/mcp-apps';
import { buildServerInstructions, createSiYuanServer, getMcpServerHelpText } from '@/core/server';
import { AGENT_MEMORY_TOOL_DESCRIPTION_REMINDER, USER_RULES_TOOL_DESCRIPTION_REMINDER } from '@/core/tool-registry';
import { scenarios } from '../../skills/source/scenarios.mjs';

const jsonResponse = (payload: unknown): Response => ({
    ok: true,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
} as Response);

describe('MCP Server Integration', () => {
    let client: Client;
    let storedFiles: Record<string, string>;
    let failConfigRead = false;

    it('documents mcp-server CLI usage without starting transports', () => {
        const help = getMcpServerHelpText();
        expect(help).toContain('node mcp-server.cjs');
        expect(help).toContain('--http');
        expect(help).toContain('SIYUAN_MCP_TRANSPORT=http');
        expect(help).toContain('SIYUAN_API_URL');
        expect(help).toContain('SIYUAN_MCP_TLS_CERT');
        expect(help).toContain('SIYUAN_MCP_SKILLS_EXTENSION');
    });

    beforeEach(async () => {
        resetToolConfigWarningStateForTests();
        global.fetch = vi.fn();
        failConfigRead = false;
        process.env.SIYUAN_TOKEN = 'test-token';
        storedFiles = {
            '/data/storage/petal/siyuan-plugins-mcp-sisyphus/notebookPermissions': '{}',
            '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig': '',
        };

        // Mock all API responses: permission load + config read
        vi.mocked(global.fetch).mockImplementation(async (url, init) => {
            const urlStr = String(url);

            if (urlStr.includes('/api/file/getFile')) {
                const body = init?.body ? JSON.parse(String(init.body)) as { path?: string } : {};
                if (failConfigRead && body.path?.endsWith('/mcpToolsConfig')) {
                    throw new Error('config read unavailable');
                }
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

            // Default: successful empty response
            return jsonResponse({ code: 0, msg: 'success', data: {} });
        });

        const server = await createSiYuanServer();

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);

        client = new Client({ name: 'test-client', version: '1.0.0' });
        await client.connect(clientTransport);
    });

    afterEach(() => {
        delete process.env.SIYUAN_TOKEN;
        delete process.env.SIYUAN_MCP_TOOLS;
        delete process.env.SIYUAN_MCP_SKILLS_EXTENSION;
    });

    describe('Server creation and tool listing', () => {
        it('serves the default SEP-2640 skill catalog with verifiable resources', async () => {
            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);
            const skillsClient = new Client({ name: 'skills-extension-client', version: '1.0.0' });
            await skillsClient.connect(clientTransport);

            const list = await skillsClient.request(
                { method: 'skills/list', params: {} },
                z.object({ skills: z.array(z.any()), ttlMs: z.number().optional(), cacheScope: z.string().optional() }),
            );
            expect(list.skills).toHaveLength(5);
            expect(list.skills.map((entry: any) => entry.frontmatter.name)).toContain('siyuan-mcp-sisyphus');
            expect(list.skills.map((entry: any) => entry.frontmatter.name)).not.toContain('siyuan-mcp-timeline');
            expect((skillsClient.getServerCapabilities() as any)?.extensions?.['io.modelcontextprotocol/skills']).toEqual({ directoryRead: false });

            const entry = list.skills[0] as any;
            const resource = await skillsClient.readResource({ uri: entry.uri });
            const text = (resource.contents[0] as { text: string }).text;
            expect(`sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`).toBe(
                entry.resources.find((item: any) => item.uri === entry.uri).digest,
            );

            const unlisted = await skillsClient.request(
                { method: 'skills/get', params: { uri: 'skill://siyuan-mcp-timeline/SKILL.md' } },
                z.object({ skill: z.any() }),
            );
            expect(unlisted.skill.frontmatter.name).toBe('siyuan-mcp-timeline');
            await skillsClient.close();
        });

        it('allows the SEP-2640 extension to be explicitly disabled', async () => {
            process.env.SIYUAN_MCP_SKILLS_EXTENSION = 'false';
            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);
            const skillsClient = new Client({ name: 'skills-disabled-client', version: '1.0.0' });
            await skillsClient.connect(clientTransport);

            expect((skillsClient.getServerCapabilities() as any)?.extensions?.['io.modelcontextprotocol/skills']).toBeUndefined();
            await expect(skillsClient.request(
                { method: 'skills/list', params: {} },
                z.object({ skills: z.array(z.any()) }),
            )).rejects.toThrow();
            await skillsClient.close();
        });

        it('advertises v2 tool metadata and returns structured content', async () => {
            const { tools } = await client.listTools();
            const system = tools.find((tool) => tool.name === 'system');

            expect(system).toEqual(expect.objectContaining({
                title: 'SiYuan System',
                outputSchema: expect.objectContaining({ type: 'object' }),
                annotations: expect.objectContaining({
                    readOnlyHint: false,
                    destructiveHint: true,
                    idempotentHint: false,
                    openWorldHint: true,
                }),
            }));

            const result = await client.callTool({ name: 'system', arguments: { action: 'get_version' } });
            expect(result.structuredContent).toEqual(expect.any(Object));
        });

        it('preserves read_image blocks in legacy tools/call projection', async () => {
            const expectedImage = {
                type: 'image',
                data: Buffer.from(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])).toString('base64'),
                mimeType: 'image/png',
            };

            const legacyResult = await client.callTool({
                name: 'file',
                arguments: { action: 'read_image', id: 'doc-image', path: 'assets/question.png' },
            });
            expect(legacyResult.content).toEqual([
                expect.objectContaining({ type: 'text', text: expect.stringContaining('"delivery": "mcp_image"') }),
                expectedImage,
            ]);
            expect(legacyResult.structuredContent).toMatchObject({
                documentID: 'doc-image',
                path: 'assets/question.png',
                mimeType: 'image/png',
                bytes: 9,
            });
        });

        it('negotiates MCP Apps and serves the flashcard, timeline, and shop views', async () => {
            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);
            const appsClient = new Client(
                { name: 'mcp-apps-client', version: '1.0.0' },
                {
                    capabilities: {
                        extensions: {
                            [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] },
                        },
                    },
                },
            );
            await appsClient.connect(clientTransport);

            expect((appsClient.getServerCapabilities() as any)?.extensions?.[MCP_APPS_EXTENSION_ID]).toEqual({
                mimeTypes: [MCP_APP_MIME_TYPE],
            });

            const { tools } = await appsClient.listTools();
            expect((tools.find((entry) => entry.name === 'flashcard') as any)?._meta?.ui).toBeUndefined();
            expect((tools.find((entry) => entry.name === 'timeline') as any)?._meta?.ui).toBeUndefined();
            expect((tools.find((entry) => entry.name === 'mascot') as any)?._meta?.ui).toBeUndefined();
            expect((tools.find((entry) => entry.name === FLASHCARD_REVIEW_SESSION_TOOL_NAME) as any)?._meta?.ui).toEqual({
                resourceUri: MCP_APP_RESOURCE_URIS.flashcard,
                visibility: ['model'],
            });
            expect((tools.find((entry) => entry.name === FLASHCARD_REVIEW_SESSION_TOOL_NAME) as any)?._meta?.[MCP_APP_LEGACY_RESOURCE_URI_META_KEY]).toBe(MCP_APP_RESOURCE_URIS.flashcard);
            const timelineAppAction = tools.find((entry) => entry.name === TIMELINE_APP_ACTION_TOOL_NAME) as any;
            expect(timelineAppAction?._meta?.ui).toEqual({ visibility: ['app'] });
            expect(timelineAppAction?.inputSchema?.properties?.action?.enum).toEqual([
                'list_nodes',
                'create_node',
                'compare_node',
                'delete_node',
                'rollback_document',
                'rollback_block',
                'help',
            ]);
            expect((tools.find((entry) => entry.name === FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME) as any)?._meta?.ui).toEqual({ visibility: ['app'] });
            expect((tools.find((entry) => entry.name === MASCOT_SHOP_APP_ACTION_TOOL_NAME) as any)?._meta?.ui).toEqual({ visibility: ['app'] });
            for (const [toolName, resourceUri] of [
                [TIMELINE_APP_TOOL_NAME, MCP_APP_RESOURCE_URIS.timeline],
                [MASCOT_SHOP_APP_TOOL_NAME, MCP_APP_RESOURCE_URIS.mascot],
            ] as const) {
                const tool = tools.find((entry) => entry.name === toolName) as any;
                expect(tool?._meta?.ui).toEqual({
                    resourceUri,
                    visibility: ['model'],
                });
                expect(tool?._meta?.[MCP_APP_LEGACY_RESOURCE_URI_META_KEY]).toBe(resourceUri);
                const resource = await appsClient.readResource({ uri: resourceUri });
                expect(resource.contents[0]).toEqual(expect.objectContaining({
                    uri: resourceUri,
                    mimeType: MCP_APP_MIME_TYPE,
                    text: expect.stringContaining('SiYuan MCP App'),
                }));
            }
            const flashcardResource = await appsClient.readResource({ uri: MCP_APP_RESOURCE_URIS.flashcard });
            expect(flashcardResource.contents[0]).toEqual(expect.objectContaining({
                uri: MCP_APP_RESOURCE_URIS.flashcard,
                mimeType: MCP_APP_MIME_TYPE,
                text: expect.stringContaining('SiYuan MCP App'),
            }));
            await appsClient.close();
        });

        it('starts a flashcard App session from the fixed candidate snapshot without drawing due cards twice', async () => {
            let dueCalls = 0;
            vi.mocked(global.fetch).mockImplementation(async (url, init) => {
                const urlStr = String(url);
                if (urlStr.includes('/api/file/getFile')) {
                    const body = init?.body ? JSON.parse(String(init.body)) as { path?: string } : {};
                    return {
                        ok: true,
                        text: async () => storedFiles[body.path ?? ''] ?? '',
                    } as Response;
                }
                if (urlStr.includes('/api/riff/getRiffDueCards')) {
                    dueCalls += 1;
                    return jsonResponse({
                        code: 0,
                        msg: 'success',
                        data: dueCalls === 1
                            ? {
                                cards: [{
                                    deckID: 'deck-1',
                                    cardID: 'card-1',
                                    blockID: 'block-1',
                                    state: 1,
                                }],
                                unreviewedCount: 1,
                            }
                            : { cards: [] },
                    });
                }
                if (urlStr.includes('/api/block/getBlockInfo')) {
                    return jsonResponse({ code: 0, msg: 'success', data: { box: 'notebook-1' } });
                }
                if (urlStr.includes('/api/block/getChildBlocks')) {
                    return jsonResponse({ code: 0, msg: 'success', data: [{ id: 'answer-1', type: 'p' }] });
                }
                if (urlStr.includes('/api/block/getBlockKramdowns')) {
                    return jsonResponse({
                        code: 0,
                        msg: 'success',
                        data: {
                            'block-1': '快照题目',
                            'answer-1': '快照答案',
                        },
                    });
                }
                return jsonResponse({ code: 0, msg: 'success', data: {} });
            });

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);
            const appsClient = new Client(
                { name: 'flashcard-snapshot-client', version: '1.0.0' },
                {
                    capabilities: {
                        extensions: {
                            [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] },
                        },
                    },
                },
            );
            await appsClient.connect(clientTransport);

            const candidates = await appsClient.callTool({
                name: 'flashcard',
                arguments: { action: 'list_cards', scope: 'all', filter: 'due' },
            });
            const candidatePayload = candidates.structuredContent as any;
            expect(candidatePayload.candidateToken).toEqual(expect.any(String));
            expect(candidatePayload.cards).toEqual([
                expect.objectContaining({ deckID: 'deck-1', cardID: 'card-1', front: '快照题目' }),
            ]);

            const session = await appsClient.callTool({
                name: FLASHCARD_REVIEW_SESSION_TOOL_NAME,
                arguments: {
                    candidateToken: candidatePayload.candidateToken,
                    cards: [{ deckID: 'deck-1', cardID: 'card-1' }],
                    selectionReason: '固定候选快照回归测试。',
                },
            });
            expect(session.isError).not.toBe(true);
            expect(session.structuredContent).toMatchObject({
                selectedCount: 1,
                omittedCards: [],
                presentationMode: FLASHCARD_APP_PRESENTATION_MODE,
                message: FLASHCARD_APP_HANDOFF_MESSAGE,
                modelInstruction: FLASHCARD_APP_MODEL_INSTRUCTION,
                cards: [{
                    front: '快照题目',
                    back: '快照答案',
                }],
            });
            const sessionText = session.content.find((item) => item.type === 'text')?.text ?? '';
            expect(JSON.parse(sessionText)).toMatchObject({
                presentationMode: FLASHCARD_APP_PRESENTATION_MODE,
                message: FLASHCARD_APP_HANDOFF_MESSAGE,
                modelInstruction: FLASHCARD_APP_MODEL_INSTRUCTION,
            });
            expect(sessionText).not.toContain('快照题目');
            expect(sessionText).not.toContain('快照答案');
            expect(dueCalls).toBe(1);

            await appsClient.close();
        });

        it('keeps MCP App metadata out of tools for clients that did not opt in', async () => {
            const { tools } = await client.listTools();
            expect((tools.find((tool) => tool.name === 'flashcard') as any)?._meta?.ui).toBeUndefined();
            expect((tools.find((tool) => tool.name === 'timeline') as any)?._meta?.ui).toBeUndefined();
            expect((tools.find((tool) => tool.name === 'mascot') as any)?._meta?.ui).toBeUndefined();
            expect(tools.find((tool) => tool.name === FLASHCARD_REVIEW_SESSION_TOOL_NAME)).toBeUndefined();
            expect(tools.find((tool) => tool.name === TIMELINE_APP_ACTION_TOOL_NAME)).toBeUndefined();
            expect(tools.find((tool) => tool.name === TIMELINE_APP_TOOL_NAME)).toBeUndefined();
            expect(tools.find((tool) => tool.name === FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME)).toBeUndefined();
            expect(tools.find((tool) => tool.name === MASCOT_SHOP_APP_TOOL_NAME)).toBeUndefined();
            expect(tools.find((tool) => tool.name === MASCOT_SHOP_APP_ACTION_TOOL_NAME)).toBeUndefined();
            const hiddenCall = await client.callTool({
                name: TIMELINE_APP_ACTION_TOOL_NAME,
                arguments: { action: 'create_node', name: 'hidden', scope: 'global' },
            });
            expect(hiddenCall.isError).toBe(true);
            expect(hiddenCall.content.find((item) => item.type === 'text')?.text).toContain('Unknown tool');
        });

        it('loads tool config from SiYuan API in standalone mode', async () => {
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify({
                document: {
                    enabled: false,
                    actions: {},
                },
                userRulesText: 'Use the API-backed config.',
            });

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);

            const standaloneClient = new Client({ name: 'standalone-config-client', version: '1.0.0' });
            await standaloneClient.connect(clientTransport);

            const { tools } = await standaloneClient.listTools();
            expect(tools.map(t => t.name)).not.toContain('document');

            await standaloneClient.close();
        });

        it('falls back to default config when API config is invalid', async () => {
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = '{invalid json';

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);

            const fallbackClient = new Client({ name: 'default-config-client', version: '1.0.0' });
            await fallbackClient.connect(clientTransport);

            const { tools } = await fallbackClient.listTools();
            expect(tools.map(t => t.name)).toContain('document');

            await fallbackClient.close();
        });

        it('ignores SIYUAN_MCP_TOOLS when API config is unavailable', async () => {
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = '';
            process.env.SIYUAN_MCP_TOOLS = JSON.stringify({
                document: {
                    enabled: false,
                    actions: {},
                },
            });

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);

            const envIgnoredClient = new Client({ name: 'env-ignored-client', version: '1.0.0' });
            await envIgnoredClient.connect(clientTransport);

            const { tools } = await envIgnoredClient.listTools();
            expect(tools.map(t => t.name)).toContain('document');

            await envIgnoredClient.close();
        });

        it('warns once when API config is still in the legacy format', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify({
                notebook: ['list', 'rename'],
                remove_document: true,
            });

            await createSiYuanServer();
            await createSiYuanServer();

            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Detected legacy tool config format'));
        });

        it('elevates user custom rules in server instructions when configured', () => {
            const userRule = 'After creating a document, proactively set the icon when the user mentions it.';
            const instructions = buildServerInstructions(userRule);

            expect(instructions.trimStart().startsWith('# Active user custom rules')).toBe(true);
            expect(instructions).toContain('## Rule list');
            expect(instructions).toContain(userRule);
            expect(instructions.indexOf('# Active user custom rules')).toBeLessThan(instructions.indexOf('## Help and progressive disclosure'));
            expect(instructions).toContain('User custom rules do not override safety confirmation requirements, notebook permissions, disabled tools, or disabled actions.');
            expect(instructions).toContain(`fs(action="read", path="${USER_RULES_VIRTUAL_PATH}")`);
            expect(instructions).toContain('siyuan://help/user-rules');
            expect(instructions).toContain('siyuan://skills/index');
            expect(instructions).toContain('siyuan://skills/{name}');
        });

        it('formats multiline user custom rules as a bullet list', () => {
            const instructions = buildServerInstructions('Rule one\n\nRule two  \n  Rule three');

            expect(instructions).toContain('- Rule one');
            expect(instructions).toContain('- Rule two');
            expect(instructions).toContain('- Rule three');
        });

        it('omits user custom rule sections when no rules are configured', () => {
            const instructions = buildServerInstructions('');

            expect(instructions).not.toContain('# Active user custom rules');
            expect(instructions).not.toContain('## Rule list');
            expect(instructions).not.toContain('User custom rules override the general style and workflow suggestions below when they apply.');
        });

        it('injects agent siyuan memory as a lower-priority independent section', () => {
            const instructions = buildServerInstructions({
                userRulesText: 'Prefer Chinese titles.',
                agentSiyuanMemoryText: 'Workspace has Inbox and Projects notebooks.',
                agentSiyuanMemoryUpdatedAt: new Date().toISOString(),
            });

            expect(instructions).toContain('# Active user custom rules');
            expect(instructions).toContain('# Agent siyuan memory');
            expect(instructions).toContain('Status: fresh');
            expect(instructions).toContain('Last updated:');
            expect(instructions).toContain('Stale threshold: 7 days');
            expect(instructions).toContain('Config source: api file');
            expect(instructions).toContain('## What to write in /AGENTS.md');
            expect(instructions).toContain('Workspace has Inbox and Projects notebooks.');
            expect(instructions).toContain('lower priority than user requests, active user custom rules, safety confirmation requirements');
            expect(instructions.indexOf('# Active user custom rules')).toBeLessThan(instructions.indexOf('# Agent siyuan memory'));
            expect(instructions.indexOf('# Agent siyuan memory')).toBeLessThan(instructions.indexOf('## Help and progressive disclosure'));
        });

        it('prompts agents to ask before initializing missing agent siyuan memory', () => {
            const instructions = buildServerInstructions({
                userRulesText: '',
                agentSiyuanMemoryText: '',
                agentSiyuanMemoryUpdatedAt: '',
            });

            expect(instructions).toContain('# Agent siyuan memory');
            expect(instructions).toContain('Status: missing');
            expect(instructions).toContain('Last updated: not created');
            expect(instructions).toContain('ask the user whether to create `/AGENTS.md`');
            expect(instructions).toContain('(not created yet)');
        });

        it('prompts agents to ask before relying on stale agent siyuan memory', () => {
            const instructions = buildServerInstructions({
                userRulesText: '',
                agentSiyuanMemoryText: 'Old workspace state.',
                agentSiyuanMemoryUpdatedAt: '2020-01-01T00:00:00.000Z',
            });

            expect(instructions).toContain('Status: stale');
            expect(instructions).toContain('ask the user whether to refresh `/AGENTS.md`');
            expect(instructions).toContain('Old workspace state.');
        });

        it('marks agent memory with missing timestamp as stale while preserving content', () => {
            const instructions = buildServerInstructions({
                userRulesText: '',
                agentSiyuanMemoryText: 'Workspace state without timestamp.',
                agentSiyuanMemoryUpdatedAt: '',
                agentSiyuanMemoryConfigSource: 'api_file',
                agentSiyuanMemoryConfigOk: true,
            });

            expect(instructions).toContain('Status: stale');
            expect(instructions).toContain('Last updated: unknown');
            expect(instructions).toContain('Config source: api file');
            expect(instructions).toContain('Workspace state without timestamp.');
            expect(instructions).not.toContain('(not created yet)');
        });

        it('exposes config read failures in initialize instructions without blocking server startup', async () => {
            failConfigRead = true;

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);

            const fallbackClient = new Client({ name: 'config-failure-client', version: '1.0.0' });
            await fallbackClient.connect(clientTransport);
            const instructions = fallbackClient.getInstructions() ?? '';

            expect(instructions).toContain('# Agent siyuan memory');
            expect(instructions).toContain('Config source: default fallback; read failed: config read unavailable');
            expect(instructions).toContain('MCP could not read the configured virtual memory during initialize.');
            expect(instructions).not.toContain('ask the user whether to create `/AGENTS.md`');

            await fallbackClient.close();
        });

        it('injects configured agent memory into the MCP initialize result', async () => {
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify({
                userRulesText: '',
                agentSiyuanMemoryText: 'Workspace has Inbox and Projects notebooks.',
                agentSiyuanMemoryUpdatedAt: new Date().toISOString(),
            });

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);

            const memoryClient = new Client({ name: 'memory-initialize-client', version: '1.0.0' });
            await memoryClient.connect(clientTransport);
            const instructions = memoryClient.getInstructions() ?? '';

            expect(instructions).toContain('# Agent siyuan memory');
            expect(instructions).toContain('Status: fresh');
            expect(instructions).toContain('Config source: api file');
            expect(instructions).toContain('Workspace has Inbox and Projects notebooks.');

            await memoryClient.close();
        });

        it('includes block update guidance for multi-line content', () => {
            const instructions = buildServerInstructions('');

            expect(instructions).toContain('block(action=”update”) is best for single-block replacement');
            expect(instructions).toContain('Multi-line markdown may be truncated to the first line by SiYuan');
            expect(instructions).toContain('block(action=”append”), prepend, or insert');
        });

        it('makes the MCP App the sole flashcard presentation surface after a review session starts', () => {
            const instructions = buildServerInstructions('');

            expect(instructions).toContain('`flashcard_review_session` tool is available and succeeds');
            expect(instructions).toContain('complete prompts and reference answers remain available in structured output');
            expect(instructions).toContain('MUST NOT list, quote, restate, or reveal them');
            expect(instructions).toContain(`Reply with exactly “${FLASHCARD_APP_HANDOFF_MESSAGE}” and stop.`);
            expect(instructions).toContain('ordinary `flashcard` results retain their complete content');
        });

        it('explains that timeline App launches without a document are global-only', () => {
            const instructions = buildServerInstructions('');

            expect(instructions).toContain('Pass its `documentId` before launch');
            expect(instructions).toContain('the App is global-only and can display only global timeline nodes');
            expect(instructions).toContain('Omit `documentId` only when the user wants the global timeline');
        });

        it('directs basic path-style operations to the fs tool first', () => {
            const instructions = buildServerInstructions('');

            expect(instructions).toContain('For basic path-style notebook and document operations, use `fs`');
            expect(instructions).toContain('Treat `fs` as the default virtual filesystem interface');
            expect(instructions).toContain('fs(action="read", path="/Notebook/Folder/Doc")');
            expect(instructions).toContain('fs(action="write", path="/Notebook/Folder/Doc", markdown="...", overwrite=true)');
            expect(instructions).toContain('fs(action="mv", from="/Notebook/Old", to="/Notebook/New")');
            expect(instructions).toContain('Prefer `fs` for basic browse/read/write/edit/search/move/delete workflows.');
            expect(instructions).toContain(`fs(action="read", path="${USER_RULES_VIRTUAL_PATH}")`);
        });

        it('documents native SiYuan feature best practices in initialize instructions', () => {
            const instructions = buildServerInstructions('');

            expect(instructions).toContain('`fs` is a Markdown-oriented convenience layer.');
            expect(instructions).toContain('database rows and cells, flashcard deck bindings');
            expect(instructions).toContain('To add tags, write #tag# through fs.write');
            expect(instructions).toContain('tag(action=”rename”, oldLabel=..., newLabel=...)');
            expect(instructions).toContain('((block-id \'anchor text\'))');
            expect(instructions).toContain('search(action=”get_backlinks”|"search_refs")');
            expect(instructions).toContain('If a tool result includes attributeViews, databaseBlock, or avToolHint');
            expect(instructions).toContain('av(action=”get”, id=...)');
            expect(instructions).toContain('write actions such as add_rows, set_cells, remove_rows, add_column, and remove_column use avID');
            expect(instructions).toContain('flashcard(action=”create_card”, deckID=..., blockIDs=[...])');
            expect(instructions).toContain('Removing a flashcard binding is separate from deleting the underlying note blocks.');
        });

        it('formats MCP usage suggestions with type-specific emoji labels', () => {
            const instructions = buildServerInstructions('');

            expect(instructions).toContain('## Usage semantics');
            expect(instructions).toContain('Bookmarks🔖: Collect existing blocks through block attributes');
            expect(instructions).toContain('Tags🏷️: Use inline markdown tokens such as `#tag#`');
            expect(instructions).toContain('Flashcards🧠: Treat flashcards as review semantics, not layout');
            expect(instructions).toContain('MCP✍️: Prefer creating final content directly');
        });

        it('should list tools with expected names', async () => {
            const { tools } = await client.listTools();

            expect(tools.length).toBeGreaterThan(0);

            const toolNames = tools.map(t => t.name);
            expect(toolNames).toContain('notebook');
            expect(toolNames).toContain('document');
            expect(toolNames).toContain('block');
            expect(toolNames).toContain('av');
            expect(toolNames).toContain('search');
            expect(toolNames).toContain('file');
            expect(toolNames).toContain('tag');
            expect(toolNames).toContain('system');
            expect(toolNames).toContain('flashcard');
            expect(toolNames).toContain('mascot');
        });

        it('should have action enum in each tool input schema', async () => {
            const { tools } = await client.listTools();

            for (const tool of tools) {
                const schema = tool.inputSchema as Record<string, any>;
                expect(schema.properties?.action?.enum).toBeDefined();
                expect(schema.properties?.action?.enum.length).toBeGreaterThan(0);
            }
        });

        it('should have descriptions for all tools', async () => {
            const { tools } = await client.listTools();

            for (const tool of tools) {
                expect(tool.description).toBeTruthy();
                expect(tool.description!.length).toBeGreaterThan(10);
            }
        });

        it('reloads tool config on every list and call without waiting for a TTL', async () => {
            let tools = (await client.listTools()).tools;
            expect(tools.map(t => t.name)).toContain('document');

            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify({
                document: {
                    enabled: false,
                    actions: {},
                },
            });

            tools = (await client.listTools()).tools;
            expect(tools.map(t => t.name)).not.toContain('document');

            const result = await client.callTool({
                name: 'document',
                arguments: { action: 'get_doc', id: 'doc-1' },
            });
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain('Tool "document" is disabled.');
        });

        it('adds a light user custom rules reminder to tool descriptions when configured', async () => {
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify({
                userRulesText: 'Always set document icons.',
            });

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);

            const rulesClient = new Client({ name: 'rules-description-client', version: '1.0.0' });
            await rulesClient.connect(clientTransport);
            const { tools } = await rulesClient.listTools();

            expect(tools.length).toBeGreaterThan(0);
            for (const tool of tools) {
                expect(tool.description).toContain(USER_RULES_TOOL_DESCRIPTION_REMINDER);
                expect(tool.description).toContain(`fs(action="read", path="${USER_RULES_VIRTUAL_PATH}")`);
                expect(tool.description).not.toContain('Always set document icons.');
            }

            await rulesClient.close();
        });

        it('adds a light agent memory reminder to tool descriptions without embedding memory content', async () => {
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify({
                userRulesText: '',
                agentSiyuanMemoryText: 'Workspace has sensitive project map.',
                agentSiyuanMemoryUpdatedAt: new Date().toISOString(),
            });

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);

            const memoryDescriptionClient = new Client({ name: 'memory-description-client', version: '1.0.0' });
            await memoryDescriptionClient.connect(clientTransport);
            const { tools } = await memoryDescriptionClient.listTools();

            expect(tools.length).toBeGreaterThan(0);
            for (const tool of tools) {
                expect(tool.description).toContain(AGENT_MEMORY_TOOL_DESCRIPTION_REMINDER);
                expect(tool.description).not.toContain('Workspace has sensitive project map.');
            }

            await memoryDescriptionClient.close();
        });
    });

    describe('Resource listing', () => {
        it('should list available resources', async () => {
            const { resources } = await client.listResources();
            expect(resources.length).toBeGreaterThan(0);
            expect(resources.map((resource) => resource.uri)).toContain(USER_RULES_RESOURCE_URI);
            expect(resources.map((resource) => resource.uri)).toContain('siyuan://skills/index');
            expect(resources.map((resource) => resource.uri)).toContain('siyuan://skills/siyuan-mcp-create-edit');
        });

        it('reads the embedded skill index and a scenario skill', async () => {
            const index = await client.readResource({ uri: 'siyuan://skills/index' });
            const skill = await client.readResource({ uri: 'siyuan://skills/siyuan-mcp-create-edit' });
            const indexContent = index.contents[0];
            const skillContent = skill.contents[0];
            const indexText = indexContent && 'text' in indexContent ? indexContent.text : '';
            const skillText = skillContent && 'text' in skillContent ? skillContent.text : '';

            expect(indexText).toContain('# SiYuan MCP Skill Index');
            expect(skillText).toContain('name: siyuan-mcp-create-edit');
        });

        it('reads current user custom rules from the dynamic resource', async () => {
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify({
                userRulesText: 'Rule one\nRule two',
            });

            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);

            const resourceClient = new Client({ name: 'rules-resource-client', version: '1.0.0' });
            await resourceClient.connect(clientTransport);
            const resource = await resourceClient.readResource({ uri: USER_RULES_RESOURCE_URI });
            const firstContent = resource.contents[0];
            const text = firstContent && 'text' in firstContent ? firstContent.text : '';

            expect(text).toContain('# Active User Custom Rules');
            expect(text).toContain('- Rule one');
            expect(text).toContain('- Rule two');
            expect(text).toContain('do not override safety confirmation requirements');

            await resourceClient.close();
        });
    });

    describe('Scenario prompts', () => {
        it('lists prompts and returns embedded skill guidance with an optional task', async () => {
            const { prompts } = await client.listPrompts();
            expect(prompts).toHaveLength(scenarios.length);
            expect(prompts).toContainEqual(expect.objectContaining({
                name: 'siyuan_create_edit',
                arguments: [expect.objectContaining({ name: 'task', required: false })],
            }));
            expect(prompts).toContainEqual(expect.objectContaining({
                name: 'siyuan_timeline',
                arguments: [expect.objectContaining({ name: 'task', required: false })],
            }));

            const result = await client.getPrompt({
                name: 'siyuan_create_edit',
                arguments: { task: 'Append a concise project summary.' },
            });
            const content = result.messages[0]?.content;
            const text = content?.type === 'text' ? content.text : '';
            expect(result.messages[0]?.role).toBe('user');
            expect(text).toContain('name: siyuan-mcp-create-edit');
            expect(text).toContain('Append a concise project summary.');
        });

        it('rejects unknown prompts', async () => {
            await expect(client.getPrompt({ name: 'unknown' })).rejects.toThrow('Unknown prompt');
        });
    });

    describe('Error handling', () => {
        it('should return error for unknown tool', async () => {
            const result = await client.callTool({ name: 'nonexistent', arguments: {} });
            expect(result.isError).toBe(true);
        });

        it('should still create the server when SIYUAN_TOKEN is missing', async () => {
            delete process.env.SIYUAN_TOKEN;
            await expect(createSiYuanServer()).resolves.toBeTruthy();
        });
    });

    describe('Response debug metadata', () => {
        async function createClientWithStoredConfig(config: Record<string, unknown>) {
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/notebookPermissions'] = JSON.stringify({ 'nb-1': 'rwd' });
            storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify(config);
            const server = await createSiYuanServer();
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            await server.connect(serverTransport);
            const metadataClient = new Client({ name: 'metadata-client', version: '1.0.0' });
            await metadataClient.connect(clientTransport);
            return metadataClient;
        }

        it('omits successful uiRefresh metadata by default', async () => {
            const metadataClient = await createClientWithStoredConfig({
                writeSafety: { strictMode: false },
            });

            const result = await metadataClient.callTool({
                name: 'notebook',
                arguments: { action: 'rename', notebook: 'nb-1', name: 'Renamed' },
            });
            const payload = JSON.parse((result.content[0] as { text: string }).text);

            expect(payload).toMatchObject({ success: true, notebook: 'nb-1', name: 'Renamed' });
            expect(payload.uiRefresh).toBeUndefined();

            await metadataClient.close();
        });

        it('includes successful uiRefresh metadata when slim responses are disabled', async () => {
            const metadataClient = await createClientWithStoredConfig({
                debug: { slimResponses: false },
                writeSafety: { strictMode: false },
            });

            const result = await metadataClient.callTool({
                name: 'notebook',
                arguments: { action: 'rename', notebook: 'nb-1', name: 'Renamed' },
            });
            const payload = JSON.parse((result.content[0] as { text: string }).text);

            expect(payload.uiRefresh.operations).toEqual([{ type: 'reloadFiletree' }]);

            await metadataClient.close();
        });
    });

    describe('Puppy wage tracking', () => {
        it('increments total calls once for a successful tool call', async () => {
            await client.callTool({ name: 'system', arguments: { action: 'get_version' } });

            expect(JSON.parse(storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/puppyStats.json'])).toMatchObject({
                totalCalls: 1,
            });
            expect(JSON.parse(storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/puppyEvents.json'])).toMatchObject({
                tool: 'system',
                action: 'get_version',
                status: 'success',
                totalCalls: 1,
            });
            await vi.waitFor(() => {
                expect(storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/analytics.jsonl']).toBeTruthy();
            });
            const analyticsLine = storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/analytics.jsonl'];
            expect(analyticsLine).toBeTruthy();
            expect(JSON.parse(analyticsLine)).toMatchObject({
                tool: 'system',
                action: 'get_version',
                requestChars: expect.any(Number),
                responseChars: expect.any(Number),
                requestApproxTokens: expect.any(Number),
                responseApproxTokens: expect.any(Number),
                totalApproxTokens: expect.any(Number),
                tokenMode: 'approx_context_v1',
            });
        });

        it('increments total calls once for a failed tool call', async () => {
            const result = await client.callTool({ name: 'system', arguments: { action: 'conf', mode: 'get' } });

            expect(result.isError).toBe(true);
            expect(JSON.parse(storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/puppyStats.json'])).toMatchObject({
                totalCalls: 1,
            });
            expect(JSON.parse(storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/puppyEvents.json'])).toMatchObject({
                tool: 'system',
                action: 'conf',
                status: 'error',
                totalCalls: 1,
            });
        });

        it('keeps accumulating across calls without double-counting phases', async () => {
            await client.callTool({ name: 'system', arguments: { action: 'get_current_time' } });
            await client.callTool({ name: 'system', arguments: { action: 'get_version' } });

            expect(JSON.parse(storedFiles['/data/storage/petal/siyuan-plugins-mcp-sisyphus/puppyStats.json'])).toMatchObject({
                totalCalls: 2,
            });
        });
    });
});
