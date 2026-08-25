import { describe, expect, it, vi } from 'vitest';

import { AGENT_MEMORY_VIRTUAL_PATH, MCP_TOOLS_CONFIG_API_PATH, USER_RULES_VIRTUAL_PATH, buildDefaultToolConfig } from '@/core/config';
import { callFsTool, listFsTools } from '@/tools/fs';
import { createMockClient } from '../../helpers/mock-client';
import { parseResult } from '../../helpers/parse-result';

type PermissionLevel = 'rwd' | 'rw' | 'r' | 'none';

function createPermMgr(level: PermissionLevel | Record<string, PermissionLevel> = 'rwd') {
    const getLevel = (notebookId: string): PermissionLevel => {
        if (typeof level === 'string') return level;
        return level[notebookId] ?? 'r';
    };
    return {
        reload: vi.fn(async () => undefined),
        canRead: vi.fn((notebookId: string) => getLevel(notebookId) !== 'none'),
        canWrite: vi.fn((notebookId: string) => ['rw', 'rwd'].includes(getLevel(notebookId))),
        canDelete: vi.fn((notebookId: string) => getLevel(notebookId) === 'rwd'),
        get: vi.fn((notebookId: string) => getLevel(notebookId)),
    } as any;
}

function fsConfig() {
    return buildDefaultToolConfig().fs;
}

function createFsClient(options: { ambiguous?: boolean; missingPaths?: string[]; agentMemory?: string; agentMemoryUpdatedAt?: string; userRulesText?: string } = {}) {
    const missing = new Set(options.missingPaths ?? []);
    let storedConfig = {
        ...buildDefaultToolConfig(),
        userRulesText: options.userRulesText ?? '创建文档/日记后主动设图标',
        agentSiyuanMemoryText: options.agentMemory ?? '',
        agentSiyuanMemoryUpdatedAt: options.agentMemoryUpdatedAt ?? '',
    };
    return createMockClient({
        request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
            if (endpoint.startsWith('/api/ui/')) return null;
            if (endpoint === '/api/notebook/lsNotebooks') {
                return {
                    notebooks: options.ambiguous
                        ? [
                            { id: 'nb-1', name: 'Notebook', closed: false },
                            { id: 'nb-2', name: 'Archive', closed: false },
                        ]
                        : [{ id: 'nb-1', name: 'Notebook', closed: false }],
                };
            }
            if (endpoint === '/api/filetree/getIDsByHPath') {
                if (missing.has(String(body?.path))) return [];
                return [body?.notebook === 'nb-2' ? 'doc-2' : 'doc-1'];
            }
            if (endpoint === '/api/filetree/getPathByID') {
                return { notebook: body?.id === 'doc-2' ? 'nb-2' : 'nb-1', path: body?.id === 'doc-2' ? '/doc-2.sy' : '/doc-1.sy' };
            }
            if (endpoint === '/api/filetree/getHPathByID') {
                if (body?.id === 'child-1') return '/Doc 1/Child';
                if (body?.id === 'grand-1') return '/Doc 1/Child/Grand';
                return '/Doc 1';
            }
            if (endpoint === '/api/filetree/listDocsByPath') {
                const path = String(body?.path ?? '/');
                if (path === '/child.sy') {
                    return {
                        box: body?.notebook ?? 'nb-1',
                        files: [{ id: 'grand-1', box: body?.notebook ?? 'nb-1', path: '/grand.sy', name: 'Grand.sy', subFileCount: 0 }],
                    };
                }
                if (path === '/grand.sy') {
                    return { box: body?.notebook ?? 'nb-1', files: [] };
                }
                return {
                    box: body?.notebook ?? 'nb-1',
                    files: [
                        { id: body?.notebook === 'nb-2' ? 'child-2' : 'child-1', box: body?.notebook ?? 'nb-1', path: '/child.sy', name: 'Child.sy', icon: '1f4d4', subFileCount: 2 },
                    ],
                };
            }
            if (endpoint === '/api/filetree/listDocTree') {
                return {
                    tree: [
                        { id: 'child-1', path: '/child.sy', name: 'Child.sy', children: [{ id: 'grand-1', path: '/grand.sy', name: 'Grand.sy' }] },
                    ],
                };
            }
            if (endpoint === '/api/export/exportMdContent') {
                return { hPath: '/Doc 1', content: 'alpha\nbudget line\nBeta' };
            }
            if (endpoint === '/api/query/sql') {
                const stmt = String(body?.stmt ?? '');
                if (stmt.includes("type = 'd'")) return [];
                return [
                    { id: 'block-1', type: 'p', sort: 1 },
                    { id: 'block-2', type: 'p', sort: 2 },
                ];
            }
            if (endpoint === '/api/filetree/createDocWithMd') return 'new-doc';
            if (endpoint === '/api/block/getChildBlocks') {
                if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }, { id: 'block-2', type: 'p' }];
                return [];
            }
            if (endpoint === '/api/block/getBlockKramdown') {
                if (body?.id === 'block-1') return { id: 'block-1', kramdown: 'alpha\n{: id="block-1"}' };
                if (body?.id === 'block-2') return { id: 'block-2', kramdown: 'budget line\nBeta\n{: id="block-2"}' };
                return { id: body?.id, kramdown: '' };
            }
            if (endpoint === '/api/block/getBlockDOM') {
                if (body?.id === 'block-1') return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">alpha</div>' };
                if (body?.id === 'block-2') return { id: 'block-2', dom: '<div data-node-id="block-2" data-type="NodeParagraph">budget line<br>Beta</div>' };
                return { id: body?.id, dom: '' };
            }
            if (endpoint === '/api/block/deleteBlock') return {};
            if (endpoint === '/api/block/updateBlock') return { updated: true };
            if (endpoint === '/api/block/appendBlock') return [{ doOperations: [{ id: 'block-new' }] }];
            if (endpoint === '/api/filetree/removeDocByID') return null;
            if (endpoint === '/api/filetree/moveDocsByID') return null;
            if (endpoint === '/api/filetree/renameDocByID') return null;
            return null;
        }),
        readFile: vi.fn(async (path: string) => {
            if (path === MCP_TOOLS_CONFIG_API_PATH) {
                return JSON.stringify(storedConfig);
            }
            throw new Error(`Unexpected readFile path: ${path}`);
        }),
        writeFile: vi.fn(async (path: string, content: string) => {
            if (path === MCP_TOOLS_CONFIG_API_PATH) {
                storedConfig = JSON.parse(content);
                return;
            }
            throw new Error(`Unexpected writeFile path: ${path}`);
        }),
        getStoredConfig: () => storedConfig,
    });
}

describe('fs tool', () => {
    it('publishes block-window parameters for fs.read without legacy character pagination', () => {
        const [tool] = listFsTools(fsConfig());
        const schema = tool.inputSchema;
        const branches = schema['x-sisyphus-actionSchemas'] as Array<{ properties?: Record<string, any> }>;
        const readSchema = branches.find((branch) => branch.properties?.action?.const === 'read');
        const searchSchema = branches.find((branch) => branch.properties?.action?.const === 'search');

        expect(readSchema?.properties?.page).toBeUndefined();
        expect(readSchema?.properties?.pageSize).toBeUndefined();
        expect(readSchema?.properties?.blockStart?.minimum).toBe(0);
        expect(readSchema?.properties?.blockLimit?.maximum).toBe(200);
        expect(readSchema?.properties?.tokenBudget?.maximum).toBe(32000);
        expect(readSchema?.properties?.includeBlockIds?.type).toBe('boolean');
        expect(searchSchema?.properties?.pageSize?.maximum).toBe(200);
    });

    it('lists compact child documents without IDs or storage paths', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'ls', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.items).toEqual([{ name: 'Child', path: '/Notebook/Doc 1/Child', children: 2 }]);
        expect(JSON.stringify(parsed)).not.toContain('child-1');
        expect(JSON.stringify(parsed)).not.toContain('/child.sy');
        expect(JSON.stringify(parsed)).not.toContain('1f4d4');
    });

    it('filters root listing to readable notebooks', async () => {
        const client = createFsClient({ ambiguous: true });
        const result = await callFsTool(client, { action: 'ls', path: '/' }, fsConfig(), createPermMgr({ 'nb-1': 'r', 'nb-2': 'none' }));
        const parsed = parseResult(result);

        expect(parsed.items).toEqual([
            { name: 'AGENTS.md', path: AGENT_MEMORY_VIRTUAL_PATH, children: 0, virtual: true },
            { name: 'USER_RULES.md', path: USER_RULES_VIRTUAL_PATH, children: 0, virtual: true },
            { name: 'Notebook', path: '/Notebook', children: 1 },
        ]);
        expect(JSON.stringify(parsed)).not.toContain('/Archive');
    });

    it('accepts list as an alias for ls', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'list', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.items).toEqual([{ name: 'Child', path: '/Notebook/Doc 1/Child', children: 2 }]);
    });

    it('renders tree paths from human-readable hPath values instead of storage names', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'tree', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.tree).toEqual([
            {
                name: 'Child',
                path: '/Notebook/Doc 1/Child',
                children: [
                    {
                        name: 'Grand',
                        path: '/Notebook/Doc 1/Child/Grand',
                        children: [],
                    },
                ],
            },
        ]);
        expect(JSON.stringify(parsed)).not.toContain('child-1');
        expect(JSON.stringify(parsed)).not.toContain('grand-1');
        expect(JSON.stringify(parsed)).not.toContain('/child.sy');
        expect(JSON.stringify(parsed)).not.toContain('/grand.sy');
        expect(JSON.stringify(parsed)).not.toContain('Child.sy');
        expect(JSON.stringify(parsed)).not.toContain('Grand.sy');
    });

    it('filters root tree to readable notebooks', async () => {
        const client = createFsClient({ ambiguous: true });
        const result = await callFsTool(client, { action: 'tree', path: '/' }, fsConfig(), createPermMgr({ 'nb-1': 'r', 'nb-2': 'none' }));
        const parsed = parseResult(result);

        expect(parsed.tree).toHaveLength(3);
        expect(parsed.tree[0]).toEqual({ name: 'AGENTS.md', path: AGENT_MEMORY_VIRTUAL_PATH, children: [], virtual: true });
        expect(parsed.tree[1]).toEqual({ name: 'USER_RULES.md', path: USER_RULES_VIRTUAL_PATH, children: [], virtual: true });
        expect(parsed.tree[2].path).toBe('/Notebook');
        expect(JSON.stringify(parsed)).not.toContain('/Archive');
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/listDocTree', expect.anything());
    });

    it('keeps readable closed notebooks in the root tree without querying their document paths', async () => {
        const client = createFsClient({ ambiguous: true });
        client.request.mockImplementationOnce(async () => ({
            notebooks: [
                { id: 'nb-1', name: 'Notebook', closed: false },
                { id: 'nb-2', name: 'Archive', closed: true },
            ],
        }));

        const result = await callFsTool(client, { action: 'tree', path: '/' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.tree.at(-1)).toEqual({ name: 'Archive', path: '/Archive', children: [] });
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/listDocsByPath', expect.objectContaining({ notebook: 'nb-2' }));
    });

    it('builds a notebook-root tree without calling listDocTree on slash', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'tree', path: '/Notebook' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.tree[0]).toMatchObject({
            name: 'Child',
            path: '/Notebook/Doc 1/Child',
            children: [{ name: 'Grand', path: '/Notebook/Doc 1/Child/Grand', children: [] }],
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/listDocTree', expect.anything());
    });

    it('reads markdown in complete block windows with continuation metadata', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, {
            action: 'read',
            path: '/Notebook/Doc 1',
            blockLimit: 1,
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.path).toBe('/Notebook/Doc 1');
        expect(parsed.content).toBe('alpha');
        expect(parsed.truncated).toBe(true);
        expect(parsed.hasNextWindow).toBe(true);
        expect(parsed.returnedBlocks).toBe(1);
        expect(parsed.totalBlocks).toBe(2);
        expect(parsed.nextWindow).toMatchObject({
            action: 'read',
            path: '/Notebook/Doc 1',
            blockStart: 1,
            blockLimit: 1,
            tokenBudget: 2000,
        });
    });

    it('rejects removed page/pageSize character pagination', async () => {
        const result = await callFsTool(
            createFsClient(),
            { action: 'read', path: '/Notebook/Doc 1', page: 1, pageSize: 5 },
            fsConfig(),
            createPermMgr(),
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('validation_error');
        expect(result.content[0].text).toContain('character pagination was removed');
    });

    it('reads block refs as SiYuan double-link markdown instead of footnotes', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    const stmt = String(body?.stmt ?? '');
                    if (stmt.includes("type = 'd'")) return [];
                    return [{ id: 'block-1', type: 'p', sort: 1 }];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    if (body?.id === 'block-2') return { id: 'block-2', kramdown: '' };
                    return {
                        id: 'block-1',
                        kramdown: 'See <span data-type="block-ref" data-subtype="s" data-id="20240601010101-abcdefg">目标文档</span>\n{: id="block-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe("See ((20240601010101-abcdefg '目标文档'))");
        expect(parsed.content).not.toContain('[^');
    });

    it('reads paragraphs in block tree order instead of SQL sort order', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    const stmt = String(body?.stmt ?? '');
                    if (stmt.includes("type = 'd'")) return [];
                    return [
                        { id: 'block-2', type: 'p', sort: 1 },
                        { id: 'block-3', type: 'p', sort: 2 },
                        { id: 'block-1', type: 'p', sort: 3 },
                    ];
                }
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [
                        { id: 'block-1', type: 'p' },
                        { id: 'block-2', type: 'p' },
                        { id: 'block-3', type: 'p' },
                    ];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    if (body?.id === 'block-1') return { id: 'block-1', kramdown: '第一段\n{: id="block-1"}' };
                    if (body?.id === 'block-2') return { id: 'block-2', kramdown: '第二段\n{: id="block-2"}' };
                    if (body?.id === 'block-3') return { id: 'block-3', kramdown: '第三段\n{: id="block-3"}' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('第一段\n\n第二段\n\n第三段');
    });

    it('reads list kramdown once without leaking item IAL metadata', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'list-1', type: 'l' }];
                    throw new Error(`List item children should not be read separately: ${String(body?.id)}`);
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'list-1',
                        kramdown: '- 第一项\n  {: id="item-1"}\n- 第二项\n  {: id="item-2"}\n{: id="list-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('- 第一项\n- 第二项');
        expect(parsed.content).not.toContain('{:');
        expect(parsed.content.match(/第一项/g)).toHaveLength(1);
        expect(parsed.content.match(/第二项/g)).toHaveLength(1);
    });

    it('strips inline list item IAL metadata from fs.read output', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'list-1', type: 'l' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'list-1',
                        kramdown: '- {: updated="20260610150434" id="item-1"}列表项 A\n- {: id="item-2" updated="20260610150434"}列表项 B\n{: id="list-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('- 列表项 A\n- 列表项 B');
        expect(parsed.content).not.toContain('{:');
        expect(parsed.content).not.toContain('updated=');
    });

    it('does not strip inline IAL-looking text from non-list content', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'block-1', kramdown: 'literal {: id="not-metadata"} text\n{: id="block-1"}' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('literal {: id="not-metadata"} text');
    });

    it('does not strip standalone IAL-looking lines from non-list content', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'block-1', kramdown: 'literal line\n{: id="literal-not-metadata"}\nkeep me\n{: id="block-1"}' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('literal line\n{: id="literal-not-metadata"}\nkeep me');
    });

    it('does not strip IAL-looking lines inside fenced code blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'code-1', type: 'c' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'code-1', kramdown: '```ts\n{: id="literal"}\nconst x = 1;\n```\n{: id="code-1"}' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('```ts\n{: id="literal"}\nconst x = 1;\n```');
    });

    it('does not strip zero-width characters inside fenced code blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'code-1', type: 'c' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'code-1', kramdown: '```ts\nconst tag = "\u200B";\n```\n{: id="code-1"}' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('```ts\nconst tag = "\u200B";\n```');
    });

    it('does not strip IAL-looking or zero-width text inside math blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'math-1', type: 'm' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'math-1', kramdown: '$$\n{: id="literal"}\na\u200B+b\n$$\n{: id="math-1"}' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('$$\n{: id="literal"}\na\u200B+b\n$$');
    });

    it('reads blockquotes once without leaking quoted child IAL metadata', async () => {
        const baseClient = createFsClient();
        const childReads: string[] = [];
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    childReads.push(String(body?.id));
                    if (body?.id === 'doc-1') return [{ id: 'quote-1', type: 'NodeBlockquote' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'quote-1',
                        kramdown: '> 引用块测试\n> {: id="quote-child" updated="20260610151058"}\n>\n{: id="quote-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('> 引用块测试');
        expect(parsed.content).not.toContain('{:');
        expect(parsed.content.match(/引用块测试/g)).toHaveLength(1);
        expect(childReads).not.toContain('quote-1');
    });

    it('normalizes long SiYuan node type names before read traversal and IAL filtering', async () => {
        const baseClient = createFsClient();
        const childReads: string[] = [];
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    childReads.push(String(body?.id));
                    if (body?.id === 'doc-1') return [
                        { id: 'quote-1', type: 'NodeBlockquote' },
                        { id: 'super-1', type: 'NodeSuperBlock' },
                    ];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    if (body?.id === 'quote-1') {
                        return {
                            id: 'quote-1',
                            kramdown: '> [!NOTE]\n> Callout 内容\n> {: id="quote-child" updated="20260610182158"}\n>\n{: id="quote-1"}',
                        };
                    }
                    if (body?.id === 'super-1') {
                        return {
                            id: 'super-1',
                            kramdown: '{{{row\n左侧内容\n{: id="left-p" updated="20260610182158"}\n\n右侧内容\n{: id="right-p" updated="20260610182158"}\n}}}\n{: id="super-1"}',
                        };
                    }
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('> [!NOTE]\n> Callout 内容\n\n{{{row\n左侧内容\n\n右侧内容\n}}}');
        expect(parsed.content.match(/Callout 内容/g)).toHaveLength(1);
        expect(parsed.content).not.toContain('{:');
        expect(parsed.content).not.toContain('updated=');
        expect(parsed.complexBlockTypes).toEqual(['s']);
        expect(childReads).not.toContain('quote-1');
        expect(childReads).not.toContain('super-1');
    });

    it('normalizes long media node type names as complex fs blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [
                        { id: 'video-1', type: 'NodeVideo' },
                        { id: 'audio-1', type: 'NodeAudio' },
                    ];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    if (body?.id === 'video-1') {
                        return { id: 'video-1', kramdown: '<video src="assets/demo.mp4"></video>\n{: id="video-1"}' };
                    }
                    if (body?.id === 'audio-1') {
                        return { id: 'audio-1', kramdown: '<audio src="assets/demo.mp3"></audio>\n{: id="audio-1"}' };
                    }
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toContain('<video src="assets/demo.mp4"></video>');
        expect(parsed.content).toContain('<audio src="assets/demo.mp3"></audio>');
        expect(parsed.complexBlockTypes).toEqual(['video', 'audio']);
        expect(parsed.nonFidelityWarning).toContain('pure Markdown');
    });

    it('treats SiYuan callout blocks as self-contained blockquote-style containers', async () => {
        const baseClient = createFsClient();
        const childReads: string[] = [];
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    childReads.push(String(body?.id));
                    if (body?.id === 'doc-1') return [{ id: 'callout-1', type: 'callout' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'callout-1',
                        kramdown: '> [!NOTE]\n> Callout 内容\n> {: updated="20260610182357" id="callout-child"}\n>\n{: id="callout-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('> [!NOTE]\n> Callout 内容');
        expect(parsed.content.match(/Callout 内容/g)).toHaveLength(1);
        expect(parsed.content).not.toContain('{:');
        expect(childReads).not.toContain('callout-1');
    });

    it('preserves IAL-looking text inside quoted fenced code blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'quote-1', type: 'b' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'quote-1',
                        kramdown: '> ```ts\n> {: id="literal"}\n> const x = 1;\n> ```\n> {: id="quote-child" updated="20260610151058"}\n>\n{: id="quote-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('> ```ts\n> {: id="literal"}\n> const x = 1;\n> ```');
    });

    it('filters embedded IAL metadata from super block read views', async () => {
        const baseClient = createFsClient();
        const childReads: string[] = [];
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    childReads.push(String(body?.id));
                    if (body?.id === 'doc-1') return [{ id: 'super-1', type: 's' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'super-1',
                        kramdown: '{{{row\n- {: id="row-left" updated="20260610151058"}\n  {{{col\n  左侧内容\n  {: id="left-p" updated="20260610151058"}\n  }}}\n- {: id="row-right" updated="20260610151058"}\n  {{{col\n  右侧内容\n  {: id="right-p" updated="20260610151058"}\n  }}}\n}}}\n{: id="super-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toContain('{{{row');
        expect(parsed.content).toContain('左侧内容');
        expect(parsed.content).toContain('右侧内容');
        expect(parsed.content).not.toContain('{:');
        expect(parsed.content).not.toContain('updated=');
        expect(parsed.complexBlockTypes).toEqual(['s']);
        expect(parsed.nonFidelityWarning).toContain('pure Markdown');
        expect(childReads).not.toContain('super-1');
    });

    it('reads a mixed Markdown format matrix without generated IAL leakage or duplicate container children', async () => {
        const baseClient = createFsClient();
        const childReads: string[] = [];
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    childReads.push(String(body?.id));
                    if (body?.id === 'doc-1') return [
                        { id: 'heading-1', type: 'h' },
                        { id: 'paragraph-1', type: 'p' },
                        { id: 'list-1', type: 'l' },
                        { id: 'quote-1', type: 'b' },
                        { id: 'table-1', type: 't' },
                        { id: 'code-1', type: 'c' },
                        { id: 'math-1', type: 'm' },
                    ];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    const blocks: Record<string, string> = {
                        'heading-1': '## 标题\n{: id="heading-1"}',
                        'paragraph-1': '段落 **粗体** *斜体* ~~删除~~ `代码` <span data-type="tag">项目/会议</span> <span data-type="block-ref" data-id="20240601010101-abcdefg">目标文档</span>\n{: id="paragraph-1"}',
                        'list-1': '- [ ] {: id="task-1" updated="20260610151058"}任务\n- {: id="item-1" updated="20260610151058"}列表项\n{: id="list-1"}',
                        'quote-1': '> 引用内容\n> {: id="quote-child" updated="20260610151058"}\n>\n{: id="quote-1"}',
                        'table-1': '| 字段 | 值 |\n| --- | --- |\n| alpha | 42 |\n{: id="table-1"}',
                        'code-1': '```ts\n{: id="literal-code"}\nconst x = 1;\n```\n{: id="code-1"}',
                        'math-1': '$$\n{: id="literal-math"}\na+b\n$$\n{: id="math-1"}',
                    };
                    return { id: body?.id, kramdown: blocks[String(body?.id)] ?? '' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe([
            '## 标题',
            '段落 **粗体** *斜体* ~~删除~~ `代码` #项目/会议# ((20240601010101-abcdefg \'目标文档\'))',
            '- [ ] 任务\n- 列表项',
            '> 引用内容',
            '| 字段 | 值 |\n| --- | --- |\n| alpha | 42 |',
            '```ts\n{: id="literal-code"}\nconst x = 1;\n```',
            '$$\n{: id="literal-math"}\na+b\n$$',
        ].join('\n\n'));
        expect(parsed.content).not.toContain('updated=');
        expect(parsed.content.match(/引用内容/g)).toHaveLength(1);
        expect(parsed.content.match(/alpha \| 42/g)).toHaveLength(1);
        expect(childReads).not.toContain('list-1');
        expect(childReads).not.toContain('quote-1');
        expect(childReads).not.toContain('table-1');
        expect(childReads).not.toContain('code-1');
        expect(childReads).not.toContain('math-1');
    });

    it('normalizes HTML tag spans to editable #tag# markdown in fs.read output', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'block-1',
                        kramdown: '标签 <span data-type="tag">项目/会议</span> 完成\n{: id="block-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('标签 #项目/会议# 完成');
    });

    it('strips nested task-list item IAL metadata while preserving list markers', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'list-1', type: 'l' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'list-1',
                        kramdown: '- [ ] {: id="task-1"}任务 A\n  - {: id="child-1"}子项\n1. {: id="ordered-1"}有序项\n{: id="list-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('- [ ] 任务 A\n  - 子项\n1. 有序项');
    });

    it('reads agent memory as one complete synthetic block without document APIs', async () => {
        const client = createFsClient({ agentMemory: 'alpha\nworkspace memory' });
        const result = await callFsTool(client, {
            action: 'read',
            path: AGENT_MEMORY_VIRTUAL_PATH,
            tokenBudget: 1,
        }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            path: AGENT_MEMORY_VIRTUAL_PATH,
            virtual: true,
            updatedAt: null,
            content: 'alpha\nworkspace memory',
            returnedBlocks: 1,
            totalBlocks: 1,
            truncated: false,
            budgetExceeded: true,
        });
        expect(client.readFile).toHaveBeenCalledWith(MCP_TOOLS_CONFIG_API_PATH);
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/notebook/lsNotebooks', expect.anything());
    });

    it('reads user rules from the read-only virtual root file without document APIs', async () => {
        const client = createFsClient({ userRulesText: 'Rule one\nRule two' });
        const result = await callFsTool(client, { action: 'read', path: USER_RULES_VIRTUAL_PATH }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            path: USER_RULES_VIRTUAL_PATH,
            virtual: true,
            content: 'Rule one\nRule two',
        });
        expect(client.readFile).toHaveBeenCalledWith(MCP_TOOLS_CONFIG_API_PATH);
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/notebook/lsNotebooks', expect.anything());
    });

    it('returns empty content for the user rules virtual file when no rules are configured', async () => {
        const client = createFsClient({ userRulesText: '' });
        const result = await callFsTool(client, { action: 'read', path: USER_RULES_VIRTUAL_PATH }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            path: USER_RULES_VIRTUAL_PATH,
            virtual: true,
            content: '',
        });
    });

    it('rejects child paths under virtual root files', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'read', path: `${USER_RULES_VIRTUAL_PATH}/child` }, fsConfig(), createPermMgr());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(`${USER_RULES_VIRTUAL_PATH} is a virtual file and has no children`);
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
    });

    it('denies reads when notebook permission is none', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'read', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'permission_denied',
            current_permission: 'none',
            required_permission: 'read',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
    });

    it('creates a missing document with markdown', async () => {
        const client = createFsClient({ missingPaths: ['/New Doc'] });
        const result = await callFsTool(client, { action: 'write', path: '/Notebook/New Doc', markdown: '# New' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: '/Notebook/New Doc', id: 'new-doc', created: true });
        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/New Doc',
            markdown: '# New',
        });
        expect(parsed.uiRefresh.operations).toEqual([
            { type: 'reloadProtyle', id: 'new-doc' },
            { type: 'reloadFiletree' },
        ]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'new-doc' });
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('strips a duplicate leading title heading when creating a document', async () => {
        const client = createFsClient({ missingPaths: ['/New Doc'] });
        await callFsTool(client, { action: 'write', path: '/Notebook/New Doc', markdown: '# New Doc\n\nBody' }, fsConfig(), createPermMgr());

        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/New Doc',
            markdown: 'Body',
        });
    });

    it('keeps a leading h1 when it does not match the created document title', async () => {
        const client = createFsClient({ missingPaths: ['/New Doc'] });
        await callFsTool(client, { action: 'write', path: '/Notebook/New Doc', markdown: '# Different Heading\n\nBody' }, fsConfig(), createPermMgr());

        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/New Doc',
            markdown: '# Different Heading\n\nBody',
        });
    });

    it('expands naked block references when creating a document', async () => {
        const baseClient = createFsClient({ missingPaths: ['/New Doc'] });
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getBlockKramdown' && body?.id === '20260508123456-abcdefg') {
                    return { id: body.id, kramdown: '完整标题\n{: id="20260508123456-abcdefg"}' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        await callFsTool(client, { action: 'write', path: '/Notebook/New Doc', markdown: 'See ((20260508123456-abcdefg))' }, fsConfig(), createPermMgr());

        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/New Doc',
            markdown: "See ((20260508123456-abcdefg '完整标题'))",
        });
    });

    it('allows siyuan block links when creating a document with a hint', async () => {
        const client = createFsClient({ missingPaths: ['/New Doc'] });

        const result = await callFsTool(
            client,
            { action: 'write', path: '/Notebook/New Doc', markdown: '[目标](siyuan://blocks/20260508123456-abcdefg)' },
            fsConfig(),
            createPermMgr(),
        );
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.warning).toBe('siyuan://blocks Markdown links create mentions, not backlinks.');
        expect(parsed.hint).toContain('mentions, not backlinks');
        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/New Doc',
            markdown: '[目标](siyuan://blocks/20260508123456-abcdefg)',
        });
    });

    it('returns attribute-view guidance when reading a document with database blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'av-block-1', type: 'av' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown' && body?.id === 'av-block-1') {
                    return {
                        id: 'av-block-1',
                        kramdown: '<div data-type="NodeAttributeView" data-av-id="av-1"></div>\n{: id="av-block-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'read',
            path: '/Notebook/Doc 1',
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toContain('NodeAttributeView');
        expect(parsed.attributeViews).toEqual([{ blockID: 'av-block-1', avID: 'av-1' }]);
        expect(parsed.warning).toContain('Use av');
        expect(parsed.nonFidelityWarning).toContain('pure Markdown');
        expect(parsed.complexBlockTypes).toEqual(['av']);
        expect(parsed.recommendedReads).toEqual(['file.export_md', 'block.dom']);
    });

    it('writes agent memory through the virtual root file while preserving config', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'write', path: AGENT_MEMORY_VIRTUAL_PATH, markdown: 'New memory' }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: AGENT_MEMORY_VIRTUAL_PATH, virtual: true, overwritten: true });
        expect(client.getStoredConfig().agentSiyuanMemoryText).toBe('New memory');
        expect(client.getStoredConfig().agentSiyuanMemoryUpdatedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
        expect(parsed.updatedAt).toBe(client.getStoredConfig().agentSiyuanMemoryUpdatedAt);
        expect(client.getStoredConfig().userRulesText).toBe('创建文档/日记后主动设图标');
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/createDocWithMd', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/ui/reloadFiletree', expect.anything());
    });

    it('rejects writes to the read-only user rules virtual file', async () => {
        const client = createFsClient({ userRulesText: 'Existing rule' });
        const result = await callFsTool(client, { action: 'write', path: USER_RULES_VIRTUAL_PATH, markdown: 'New rule' }, fsConfig(), createPermMgr('none'));

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('read-only virtual file');
        expect(result.content[0].text).toContain('plugin settings');
        expect(client.getStoredConfig().userRulesText).toBe('Existing rule');
        expect(client.writeFile).not.toHaveBeenCalled();
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/createDocWithMd', expect.anything());
    });

    it('denies creates when notebook permission is read-only', async () => {
        const client = createFsClient({ missingPaths: ['/New Doc'] });
        const result = await callFsTool(client, { action: 'write', path: '/Notebook/New Doc', markdown: '# New' }, fsConfig(), createPermMgr('r'));
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'permission_denied',
            current_permission: 'r',
            required_permission: 'write',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/createDocWithMd', expect.anything());
    });

    it('overwrites an existing document body while preserving the document node', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'write', path: '/Notebook/Doc 1', markdown: 'replacement', overwrite: true }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: '/Notebook/Doc 1', id: 'doc-1', overwritten: true });
        expect(client.request).toHaveBeenCalledWith('/api/block/getChildBlocks', { id: 'doc-1' });
        expect(client.request).toHaveBeenCalledWith('/api/block/deleteBlock', { id: 'block-1' });
        expect(client.request).toHaveBeenCalledWith('/api/block/appendBlock', { dataType: 'markdown', data: 'replacement', parentID: 'doc-1' });
        expect(parsed.uiRefresh.operations).toEqual([
            { type: 'reloadProtyle', id: 'doc-1' },
            { type: 'reloadFiletree' },
        ]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('rejects overwrite when an existing document contains complex SiYuan blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'av-block-1', type: 'av' }];
                    if (body?.id === 'av-block-1') return [];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown' && body?.id === 'av-block-1') {
                    return {
                        id: 'av-block-1',
                        kramdown: '<div data-type="NodeAttributeView" data-av-id="av-1"></div>\n{: id="av-block-1"}',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'write',
            path: '/Notebook/Doc 1',
            markdown: 'replacement',
            overwrite: true,
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'complex_blocks_not_supported_by_fs',
            path: '/Notebook/Doc 1',
            id: 'doc-1',
            complexBlocks: [{ id: 'av-block-1', type: 'av' }],
        });
        expect(parsed.error.recommendedTools).toContain('av');
        expect(client.request).not.toHaveBeenCalledWith('/api/block/appendBlock', expect.anything());
    });

    it('denies overwrites when notebook permission is read-only', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'write', path: '/Notebook/Doc 1', markdown: 'replacement', overwrite: true }, fsConfig(), createPermMgr('r'));
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'permission_denied',
            current_permission: 'r',
            required_permission: 'write',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/block/deleteBlock', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/block/appendBlock', expect.anything());
    });

    it('replaces the first exact match within a document', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'budget', new: 'forecast' },
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: '/Notebook/Doc 1', changed: true, editsApplied: 1 });
        expect(client.request).toHaveBeenCalledWith('/api/block/getBlockKramdown', { id: 'block-1' });
        expect(client.request).toHaveBeenCalledWith('/api/block/getBlockKramdown', { id: 'block-2' });
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-2',
            dataType: 'dom',
            data: '<div data-node-id="block-2" data-type="NodeParagraph">forecast line<br>Beta</div>',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/block/deleteBlock', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/block/appendBlock', expect.anything());
        expect(parsed.uiRefresh.operations).toEqual([
            { type: 'reloadProtyle', id: 'doc-1' },
            { type: 'reloadFiletree' },
        ]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('replaces agent memory through the virtual root file', async () => {
        const client = createFsClient({ agentMemory: 'Notebook: Inbox\nNotebook: Projects' });
        const result = await callFsTool(client, {
            action: 'replace',
            path: AGENT_MEMORY_VIRTUAL_PATH,
            edit: { old: 'Inbox', new: 'Capture' },
        }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: AGENT_MEMORY_VIRTUAL_PATH, virtual: true, changed: true, editsApplied: 1 });
        expect(client.getStoredConfig().agentSiyuanMemoryText).toBe('Notebook: Capture\nNotebook: Projects');
        expect(client.getStoredConfig().agentSiyuanMemoryUpdatedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/block/appendBlock', expect.anything());
    });

    it('rejects replacements in the read-only user rules virtual file', async () => {
        const client = createFsClient({ userRulesText: 'Always set icons.' });
        const result = await callFsTool(client, {
            action: 'replace',
            path: USER_RULES_VIRTUAL_PATH,
            edit: { old: 'icons', new: 'emoji' },
        }, fsConfig(), createPermMgr('none'));

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('read-only virtual file');
        expect(client.getStoredConfig().userRulesText).toBe('Always set icons.');
        expect(client.writeFile).not.toHaveBeenCalled();
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
    });

    it('denies replacements when notebook permission is read-only', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'budget', new: 'forecast' },
        }, fsConfig(), createPermMgr('r'));
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'permission_denied',
            current_permission: 'r',
            required_permission: 'write',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/block/appendBlock', expect.anything());
    });

    it('allows replacements in ordinary blocks when the document also contains complex SiYuan blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [
                        { id: 'block-1', type: 'p' },
                        { id: 'av-block-1', type: 'av' },
                    ];
                    if (body?.id === 'av-block-1') return [];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    if (body?.id === 'block-1') return { id: 'block-1', kramdown: 'budget\n{: id="block-1"}' };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    if (body?.id === 'block-1') return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">budget</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'budget', new: 'forecast' },
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            success: true,
            changed: true,
            replacements: [{ index: 1, replaced: 1, replace_all: false }],
            skippedComplexBlocks: [{ id: 'av-block-1', type: 'av' }],
        });
        expect(parsed.warning).toContain('complex blocks');
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">forecast</div>',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/block/appendBlock', expect.anything());
    });

    it('allows replacements in non-complex Markdown blocks beyond paragraphs', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [
                        { id: 'table-1', type: 't' },
                        { id: 'widget-1', type: 'widget' },
                    ];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    if (body?.id === 'table-1') {
                        return {
                            id: 'table-1',
                            kramdown: '| 字段 | 值 |\n| --- | --- |\n| alpha | old-cell |\n{: id="table-1"}',
                        };
                    }
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    if (body?.id === 'table-1') {
                        return {
                            id: 'table-1',
                            dom: '<div data-node-id="table-1" data-type="NodeTable"><table><tbody><tr><td>alpha</td><td>old-cell</td></tr></tbody></table></div>',
                        };
                    }
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'old-cell', new: 'new-cell' },
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            success: true,
            changed: true,
            replacements: [{ index: 1, replaced: 1, replace_all: false }],
            skippedComplexBlocks: [{ id: 'widget-1', type: 'widget' }],
        });
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'table-1',
            dataType: 'dom',
            data: '<div data-node-id="table-1" data-type="NodeTable"><table><tbody><tr><td>alpha</td><td>new-cell</td></tr></tbody></table></div>',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/block/getBlockKramdown', { id: 'widget-1' });
        expect(client.request).not.toHaveBeenCalledWith('/api/block/getBlockDOM', { id: 'widget-1' });
    });

    it('does not replace text that only exists inside skipped complex blocks', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [
                        { id: 'block-1', type: 'p' },
                        { id: 'html-1', type: 'html' },
                    ];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    if (body?.id === 'block-1') return { id: 'block-1', kramdown: 'ordinary text\n{: id="block-1"}' };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    if (body?.id === 'block-1') return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">ordinary text</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'HTML_ONLY_TARGET', new: 'updated' },
        }, fsConfig(), createPermMgr());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('did not match any text in editable document blocks');
        expect(client.request).not.toHaveBeenCalledWith('/api/block/updateBlock', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/block/appendBlock', expect.anything());
    });

    it('supports sequential multi-edit replacements with replace_all', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }, { id: 'block-2', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    if (body?.id === 'block-1') return { id: 'block-1', kramdown: 'foo\n{: id="block-1"}' };
                    if (body?.id === 'block-2') return { id: 'block-2', kramdown: 'baz\nbaz\n{: id="block-2"}' };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    if (body?.id === 'block-1') return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">foo</div>' };
                    if (body?.id === 'block-2') return { id: 'block-2', dom: '<div data-node-id="block-2" data-type="NodeParagraph">baz<br>baz</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });
        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: [
                { old: 'foo', new: 'bar' },
                { old: 'baz', new: 'qux', replace_all: true },
            ],
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.replacements).toEqual([
            { index: 1, replaced: 1, replace_all: false },
            { index: 2, replaced: 2, replace_all: true },
        ]);
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">bar</div>',
        });
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-2',
            dataType: 'dom',
            data: '<div data-node-id="block-2" data-type="NodeParagraph">qux<br>qux</div>',
        });
    });

    it('replaces list item text copied from fs.read without requiring IAL metadata', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'list-1', type: 'l' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'list-1',
                        kramdown: '- {: updated="20260610150434" id="item-1"}列表项 A\n- {: id="item-2" updated="20260610150434"}列表项 B\n{: id="list-1"}',
                    };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return {
                        id: 'list-1',
                        dom: '<div data-node-id="list-1" data-type="NodeList"><div data-node-id="item-1" data-type="NodeListItem">列表项 A</div><div data-node-id="item-2" data-type="NodeListItem">列表项 B</div></div>',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: '- 列表项 A', new: '- 列表项 A 已更新' },
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.replacements).toEqual([{ index: 1, replaced: 1, replace_all: false }]);
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'list-1',
            dataType: 'dom',
            data: '<div data-node-id="list-1" data-type="NodeList"><div data-node-id="item-1" data-type="NodeListItem">列表项 A 已更新</div><div data-node-id="item-2" data-type="NodeListItem">列表项 B</div></div>',
        });
    });

    it('preserves existing inline formatting during document replace', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'block-1', kramdown: 'alpha **old** tail\n{: id="block-1"}' };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">alpha <strong>old</strong> tail</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'old', new: 'new' },
        }, fsConfig(), createPermMgr());

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">alpha <strong>new</strong> tail</div>',
        });
    });

    it('matches inline code replacements by plain text while preserving the code element', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'block-1', kramdown: 'alpha `hello world` tail\n{: id="block-1"}' };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">alpha <code>hello world</code> tail</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'hello world', new: 'goodbye world' },
        }, fsConfig(), createPermMgr());

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'dom',
            data: '<div data-node-id="block-1" data-type="NodeParagraph">alpha <code>goodbye world</code> tail</div>',
        });
    });

    it('does not match inline formatting delimiters as DOM logical text during replace', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'block-1', kramdown: 'alpha `hello world` tail\n{: id="block-1"}' };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">alpha <code>hello world</code> tail</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: '`hello world`', new: '`goodbye world`' },
        }, fsConfig(), createPermMgr());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('cannot safely map edit');
        expect(client.request).not.toHaveBeenCalledWith('/api/block/updateBlock', expect.anything());
    });

    it('replaces SiYuan double-link tokens in document DOM', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'block-1',
                        kramdown: "See ((20240601010101-abcdefg '旧文档'))\n{: id=\"block-1\"}",
                    };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return {
                        id: 'block-1',
                        dom: '<div data-node-id="block-1" data-type="NodeParagraph">See <span data-type="block-ref" data-subtype="s" data-id="20240601010101-abcdefg">旧文档</span></div>',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: {
                old: "((20240601010101-abcdefg '旧文档'))",
                new: "((20240602020202-hijklmn '新文档'))",
            },
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.replacements).toEqual([{ index: 1, replaced: 1, replace_all: false }]);
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: "See ((20240602020202-hijklmn '新文档'))",
        });
    });

    it('replaces a full paragraph containing a block reference in document DOM', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'block-1',
                        kramdown: '引用 ((20260609201939-1qvlh19 "测试笔记本")) 完成\n{: id="block-1"}',
                    };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return {
                        id: 'block-1',
                        dom: '<div data-node-id="block-1" data-type="NodeParagraph">引用 <span data-type="block-ref" data-subtype="s" data-id="20260609201939-1qvlh19"><span>测试笔记本</span></span> 完成</div>',
                    };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: {
                old: '引用 ((20260609201939-1qvlh19 "测试笔记本")) 完成',
                new: '替换后的普通文本',
            },
        }, fsConfig(), createPermMgr());

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '替换后的普通文本',
        });
    });

    it('replaces a full paragraph containing a tag in document DOM', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'block-1', kramdown: '这是一段 #测试标签# 内容\n{: id="block-1"}' };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">这是一段 <span data-type="tag">测试标签</span> 内容</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: '这是一段 #测试标签# 内容', new: '替换后的普通文本' },
        }, fsConfig(), createPermMgr());

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '替换后的普通文本',
        });
    });

    it('replaces a whole tag token with plain text in document DOM', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'block-1', kramdown: '这是一段 #测试标签# 内容\n{: id="block-1"}' };
                }
                if (endpoint === '/api/block/getBlockDOM') {
                    return { id: 'block-1', dom: '<div data-node-id="block-1" data-type="NodeParagraph">这是一段 <span data-type="tag">测试标签</span> 内容</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: '#测试标签#', new: '普通文本' },
        }, fsConfig(), createPermMgr());

        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-1',
            dataType: 'markdown',
            data: '这是一段 普通文本 内容',
        });
    });

    it('strips SiYuan zero-width tag markers from fs.read output', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return { id: 'block-1', kramdown: '这是一段 普通文本\u200B 内容\n{: id="block-1"}' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'read',
            path: '/Notebook/Doc 1',
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.content).toBe('这是一段 普通文本 内容');
    });

    it('fails when a replace edit does not match any text', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'missing', new: 'new text' },
        }, fsConfig(), createPermMgr());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('did not match any text');
    });

    it('skips ui refresh when replacement output is unchanged', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'budget', new: 'budget' },
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.changed).toBe(false);
        expect(parsed.uiRefresh).toBeUndefined();
        expect(client.request).not.toHaveBeenCalledWith('/api/block/updateBlock', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/ui/reloadProtyle', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/ui/reloadFiletree', expect.anything());
    });

    it('allows document replacements that write footnote-style references with a hint', async () => {
        const baseClient = createFsClient();
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-2', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown' && body?.id === 'block-2') {
                    return { id: 'block-2', kramdown: 'old [^1]\n{: id="block-2"}' };
                }
                if (endpoint === '/api/block/getBlockDOM' && body?.id === 'block-2') {
                    return { id: 'block-2', dom: '<div data-node-id="block-2" data-type="NodeParagraph">old [^1]</div>' };
                }
                return await baseClient.request(endpoint, body);
            }),
        });

        const result = await callFsTool(client, {
            action: 'replace',
            path: '/Notebook/Doc 1',
            edit: { old: 'old', new: 'new' },
        }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.warning).toBe('Footnote-style references create footnotes or note markers, not backlinks.');
        expect(parsed.hint).toContain('not SiYuan backlinks');
        expect(client.request).toHaveBeenCalledWith('/api/block/updateBlock', {
            id: 'block-2',
            dataType: 'dom',
            data: '<div data-node-id="block-2" data-type="NodeParagraph">new [^1]</div>',
        });
    });

    it('returns a compact ambiguity error for non-canonical paths', async () => {
        const client = createFsClient({ ambiguous: true });
        const result = await callFsTool(client, { action: 'read', path: '/Doc 1' }, fsConfig(), createPermMgr());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Ambiguous fs path');
        expect(result.content[0].text).toContain('/Notebook/Doc 1');
        expect(result.content[0].text).toContain('/Archive/Doc 1');
    });

    it('accepts a notebook-omitted path when it uniquely matches across readable notebooks', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'read', path: '/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.path).toBe('/Notebook/Doc 1');
        expect(parsed.content).toContain('alpha');
    });

    it('searches markdown lines with regex support', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'search', path: '/Notebook/Doc 1', query: '^budget', regex: true }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.data).toEqual([{ path: '/Notebook/Doc 1', line: 2, text: 'budget line' }]);
        expect(parsed.total).toBe(1);
    });

    it('searches only agent memory when scoped to the virtual root file', async () => {
        const client = createFsClient({ agentMemory: 'Inbox notebook\nProject archive' });
        const result = await callFsTool(client, { action: 'search', path: AGENT_MEMORY_VIRTUAL_PATH, query: 'inbox' }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(parsed.data).toEqual([{ path: AGENT_MEMORY_VIRTUAL_PATH, line: 1, text: 'Inbox notebook' }]);
        expect(parsed.virtual).toBe(true);
        expect(client.request).not.toHaveBeenCalledWith('/api/notebook/lsNotebooks', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
    });

    it('searches only user rules when scoped to the read-only virtual root file', async () => {
        const client = createFsClient({ userRulesText: 'Always set icons\nPrefer concise titles' });
        const result = await callFsTool(client, { action: 'search', path: USER_RULES_VIRTUAL_PATH, query: 'icons' }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(parsed.data).toEqual([{ path: USER_RULES_VIRTUAL_PATH, line: 1, text: 'Always set icons' }]);
        expect(parsed.virtual).toBe(true);
        expect(client.request).not.toHaveBeenCalledWith('/api/notebook/lsNotebooks', expect.anything());
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
    });

    it('includes virtual file matches in root search results', async () => {
        const client = createFsClient({
            agentMemory: 'budget workspace memory',
            userRulesText: 'Prefer budget summaries',
        });
        const result = await callFsTool(client, { action: 'search', path: '/', query: 'budget' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed.data).toEqual([
            { path: AGENT_MEMORY_VIRTUAL_PATH, line: 1, text: 'budget workspace memory' },
            { path: USER_RULES_VIRTUAL_PATH, line: 1, text: 'Prefer budget summaries' },
            { path: '/Notebook/Doc 1', line: 2, text: 'budget line' },
        ]);
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/listDocTree', expect.anything());
    });

    it('searches a notebook root without calling listDocTree on slash', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'search', path: '/Notebook', query: 'budget' }, fsConfig(), createPermMgr());

        expect(parseResult(result).data).toEqual([{ path: '/Notebook/Doc 1', line: 2, text: 'budget line' }]);
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/listDocTree', expect.anything());
    });

    it('denies scoped search when notebook permission is none', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'search', path: '/Notebook/Doc 1', query: 'budget' }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'permission_denied',
            current_permission: 'none',
            required_permission: 'read',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
    });

    it('filters root search to readable notebooks', async () => {
        const client = createFsClient({ ambiguous: true });
        const result = await callFsTool(client, { action: 'search', path: '/', query: 'budget' }, fsConfig(), createPermMgr({ 'nb-1': 'r', 'nb-2': 'none' }));
        const parsed = parseResult(result);

        expect(parsed.data).toEqual([{ path: '/Notebook/Doc 1', line: 2, text: 'budget line' }]);
        expect(JSON.stringify(parsed)).not.toContain('/Archive');
    });

    it('denies removes when notebook permission lacks delete access', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'rm', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr('rw'));
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'permission_denied',
            current_permission: 'rw',
            required_permission: 'delete',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/removeDocByID', expect.anything());
    });

    it('clears agent memory instead of hiding the virtual root file', async () => {
        const client = createFsClient({ agentMemory: 'Old memory' });
        const result = await callFsTool(client, { action: 'rm', path: AGENT_MEMORY_VIRTUAL_PATH }, fsConfig(), createPermMgr('none'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: AGENT_MEMORY_VIRTUAL_PATH, virtual: true, cleared: true });
        expect(client.getStoredConfig().agentSiyuanMemoryText).toBe('');
        expect(client.getStoredConfig().agentSiyuanMemoryUpdatedAt).toBe('');
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/removeDocByID', expect.anything());
    });

    it('rejects removing the read-only user rules virtual file', async () => {
        const client = createFsClient({ userRulesText: 'Existing rule' });
        const result = await callFsTool(client, { action: 'rm', path: USER_RULES_VIRTUAL_PATH }, fsConfig(), createPermMgr('none'));

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('read-only virtual file');
        expect(client.getStoredConfig().userRulesText).toBe('Existing rule');
        expect(client.writeFile).not.toHaveBeenCalled();
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/removeDocByID', expect.anything());
    });

    it('accepts remove as an alias for rm', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'remove', path: '/Notebook/Doc 1' }, fsConfig(), createPermMgr());
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: '/Notebook/Doc 1' });
        expect(client.request).toHaveBeenCalledWith('/api/filetree/removeDocByID', { id: 'doc-1' });
        expect(parsed.uiRefresh.operations).toEqual([
            { type: 'reloadProtyle', id: 'doc-1' },
            { type: 'reloadFiletree' },
        ]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('allows move or rename with write permission but no delete permission', async () => {
        const client = createFsClient({ missingPaths: ['/Renamed'] });
        const result = await callFsTool(client, { action: 'mv', from: '/Notebook/Doc 1', to: '/Notebook/Renamed' }, fsConfig(), createPermMgr('rw'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: '/Notebook/Doc 1', movedTo: '/Notebook/Renamed' });
        expect(client.request).toHaveBeenCalledWith('/api/filetree/moveDocsByID', { fromIDs: ['doc-1'], toID: 'nb-1' });
        expect(client.request).toHaveBeenCalledWith('/api/filetree/renameDocByID', { id: 'doc-1', title: 'Renamed' });
        expect(parsed.uiRefresh.operations).toEqual([
            { type: 'reloadProtyle', id: 'doc-1' },
            { type: 'reloadFiletree' },
        ]);
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadProtyle', { id: 'doc-1' });
        expect(client.request).toHaveBeenCalledWith('/api/ui/reloadFiletree', {});
    });

    it('rejects moving or renaming the virtual agent memory file', async () => {
        const client = createFsClient();
        const result = await callFsTool(client, { action: 'mv', from: AGENT_MEMORY_VIRTUAL_PATH, to: '/Notebook/Renamed' }, fsConfig(), createPermMgr());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('fixed virtual file');
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/moveDocsByID', expect.anything());
    });

    it('rejects moving or renaming the read-only user rules virtual file', async () => {
        const client = createFsClient({ userRulesText: 'Existing rule' });
        const result = await callFsTool(client, { action: 'mv', from: USER_RULES_VIRTUAL_PATH, to: '/Notebook/Renamed' }, fsConfig(), createPermMgr());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('read-only virtual file');
        expect(client.getStoredConfig().userRulesText).toBe('Existing rule');
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/moveDocsByID', expect.anything());
    });

    it('accepts move as an alias for mv', async () => {
        const client = createFsClient({ missingPaths: ['/Renamed'] });
        const result = await callFsTool(client, { action: 'move', from: '/Notebook/Doc 1', to: '/Notebook/Renamed' }, fsConfig(), createPermMgr('rw'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({ success: true, path: '/Notebook/Doc 1', movedTo: '/Notebook/Renamed' });
        expect(client.request).toHaveBeenCalledWith('/api/filetree/moveDocsByID', { fromIDs: ['doc-1'], toID: 'nb-1' });
    });

    it('denies move when the destination notebook is not writable', async () => {
        const client = createFsClient({ ambiguous: true, missingPaths: ['/New Name'] });
        const result = await callFsTool(client, { action: 'mv', from: '/Notebook/Doc 1', to: '/Archive/New Name' }, fsConfig(), createPermMgr({ 'nb-1': 'rw', 'nb-2': 'r' }));
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            type: 'permission_denied',
            current_permission: 'r',
            required_permission: 'write',
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/moveDocsByID', expect.anything());
    });

    function createReorderClient(initialOrder = ['doc-a', 'doc-b', 'doc-c'], initialSortMode = 2) {
        const documents = [
            { id: 'doc-a', path: '/doc-a.sy', hPath: '/A', name: 'A.sy', sort: 10 },
            { id: 'doc-b', path: '/doc-b.sy', hPath: '/B', name: 'B.sy', sort: 20 },
            { id: 'doc-c', path: '/doc-c.sy', hPath: '/C', name: 'C.sy', sort: 30 },
        ];
        let order = [...initialOrder];
        let sortMode = initialSortMode;
        const request = vi.fn(async (endpoint: string, body?: Record<string, any>) => {
            if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: [{ id: 'nb-1', name: 'Notebook', closed: false }] };
            if (endpoint === '/api/notebook/getNotebookConf') return { box: 'nb-1', name: 'Notebook', conf: { sortMode } };
            if (endpoint === '/api/filetree/listDocsByPath') {
                return { box: 'nb-1', files: order.map((id) => documents.find((item) => item.id === id)) };
            }
            if (endpoint === '/api/filetree/changeSort') {
                order = body?.paths.map((path: string) => documents.find((item) => item.path === path)?.id);
                return null;
            }
            if (endpoint === '/api/notebook/setNotebookConf') {
                sortMode = body?.conf.sortMode;
                return null;
            }
            if (endpoint.startsWith('/api/ui/')) return null;
            throw new Error(`Unexpected endpoint: ${endpoint}`);
        });
        return { client: createMockClient({ request }), request, getOrder: () => order, getSortMode: () => sortMode };
    }

    it('reorders every visible child by human-readable path and enables custom sorting', async () => {
        const { client, request, getOrder, getSortMode } = createReorderClient();
        const result = await callFsTool(client, {
            action: 'reorder',
            path: '/Notebook',
            orderedPaths: ['/Notebook/C', '/Notebook/A', '/Notebook/B'],
        }, fsConfig(), createPermMgr('rw'));
        const parsed = parseResult(result);

        expect(parsed).toMatchObject({
            success: true,
            path: '/Notebook',
            changed: true,
            orderChanged: true,
            sortModeChanged: true,
            previousOrder: ['/Notebook/A', '/Notebook/B', '/Notebook/C'],
            order: ['/Notebook/C', '/Notebook/A', '/Notebook/B'],
        });
        expect(getOrder()).toEqual(['doc-c', 'doc-a', 'doc-b']);
        expect(getSortMode()).toBe(6);
        expect(request).toHaveBeenCalledWith('/api/filetree/listDocsByPath', {
            notebook: 'nb-1', path: '/', sort: 6, maxListCount: 0, showHidden: false, ignoreMaxListHint: true,
        });
        expect(request).toHaveBeenCalledWith('/api/filetree/changeSort', { notebook: 'nb-1', paths: ['/doc-c.sy', '/doc-a.sy', '/doc-b.sy'] });
        expect(request).toHaveBeenCalledWith('/api/notebook/setNotebookConf', { notebook: 'nb-1', conf: { sortMode: 6 } });
    });

    it('returns changed=false when order and custom sort mode already match', async () => {
        const { client, request } = createReorderClient(['doc-c', 'doc-a', 'doc-b'], 6);
        const result = await callFsTool(client, {
            action: 'reorder',
            path: '/Notebook',
            orderedPaths: ['/Notebook/C', '/Notebook/A', '/Notebook/B'],
        }, fsConfig(), createPermMgr('rw'));

        expect(parseResult(result)).toMatchObject({ changed: false, orderChanged: false, sortModeChanged: false });
        expect(request).not.toHaveBeenCalledWith('/api/filetree/changeSort', expect.anything());
        expect(request).not.toHaveBeenCalledWith('/api/notebook/setNotebookConf', expect.anything());
    });

    it.each([
        [['/Notebook/A', '/Notebook/A', '/Notebook/C'], 'duplicates'],
        [['/Notebook/A', '/Notebook/B'], 'missing'],
        [['/Notebook/A', '/Notebook/B', '/Notebook/C', '/Notebook/Elsewhere'], 'unexpected'],
    ])('rejects an incomplete or invalid path permutation (%s)', async (orderedPaths, detail) => {
        const { client, request } = createReorderClient();
        const result = await callFsTool(client, { action: 'reorder', path: '/Notebook', orderedPaths }, fsConfig(), createPermMgr('rw'));

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(detail);
        expect(request).not.toHaveBeenCalledWith('/api/filetree/changeSort', expect.anything());
    });

    it('denies reorder when the notebook is read-only', async () => {
        const { client, request } = createReorderClient();
        const result = await callFsTool(client, {
            action: 'reorder', path: '/Notebook', orderedPaths: ['/Notebook/A', '/Notebook/B', '/Notebook/C'],
        }, fsConfig(), createPermMgr('r'));

        expect(result.isError).toBe(true);
        expect(parseResult(result).error).toMatchObject({ type: 'permission_denied', required_permission: 'write' });
        expect(request).not.toHaveBeenCalledWith('/api/filetree/changeSort', expect.anything());
    });
});
