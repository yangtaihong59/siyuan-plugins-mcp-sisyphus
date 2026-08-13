import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { DocumentMoveSchema, DocumentReorderSchema } from '@/core/types';
import { callDocumentTool, DOCUMENT_VARIANTS, listDocumentTools } from '@/tools/document';
import { createMockClient } from '../../helpers/mock-client';
import { parseResult } from '../../helpers/parse-result';

describe('document tool extended actions', () => {
    it('exposes filetree enhancement actions in the grouped schema', () => {
        const config = buildDefaultToolConfig();
        const [tool] = listDocumentTools(config.document);
        const actionDescription = tool.inputSchema.properties.action.description;
        expect(actionDescription).toContain('lookup');
        expect(actionDescription).toContain('duplicate');
        expect(actionDescription).not.toContain('create_empty');
        expect(actionDescription).not.toContain('get_path');
        expect(actionDescription).not.toContain('get_hpath');
        expect(actionDescription).not.toContain('get_ids');
        expect(actionDescription).toContain('heading_to_doc');
        expect(actionDescription).toContain('doc_to_heading');
        expect(actionDescription).toContain('get_outline');
    });
});

describe('document.get_outline', () => {
    it('returns the native heading tree after resolving document permission context', async () => {
        const outline = [{
            id: 'heading-1',
            name: 'Heading 1',
            depth: 0,
            blocks: [{
                id: 'heading-2',
                content: 'Heading 2',
                depth: 1,
                children: [],
            }],
            children: [],
        }];
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') {
                    return [{
                        id: 'doc-1',
                        root_id: 'doc-1',
                        box: 'nb-1',
                        path: '/doc-1.sy',
                        hpath: '/Doc 1',
                        content: 'Doc 1',
                        type: 'd',
                    }];
                }
                if (endpoint === '/api/outline/getDocOutline') {
                    expect(body).toEqual({
                        id: 'doc-1',
                        preview: true,
                        notebook: 'nb-1',
                    });
                    return outline;
                }
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canRead: vi.fn(() => true),
            get: vi.fn(() => 'r'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'get_outline', id: 'doc-1', preview: true },
            buildDefaultToolConfig().document,
            permMgr as never,
        );

        expect(parseResult(result)).toEqual({
            id: 'doc-1',
            notebook: 'nb-1',
            preview: true,
            headingCount: 2,
            outline,
        });
    });
});

describe('document.get_doc markdown', () => {
    it('publishes block-window parameters without legacy page/pageSize fields', () => {
        const variant = DOCUMENT_VARIANTS.find((item) => item.action === 'get_doc');

        expect(variant?.schema.properties?.page).toBeUndefined();
        expect(variant?.schema.properties?.pageSize).toBeUndefined();
        expect(variant?.schema.properties?.blockStart?.minimum).toBe(0);
        expect(variant?.schema.properties?.blockLimit?.maximum).toBe(200);
        expect(variant?.schema.properties?.tokenBudget?.maximum).toBe(32000);
    });

    it('returns editable kramdown with SiYuan double-link markdown', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getDocInfo') {
                    return { id: body?.id, rootID: 'doc-1', box: 'nb-1', path: '/doc-1.sy' };
                }
                if (endpoint === '/api/notebook/lsNotebooks') {
                    return { notebooks: [{ id: 'nb-1', name: 'Notebook', closed: false }] };
                }
                if (endpoint === '/api/query/sql') {
                    const stmt = String(body?.stmt ?? '');
                    if (stmt.includes("WHERE id = 'doc-1'")) {
                        return [{ id: 'doc-1', root_id: 'doc-1', box: 'nb-1', path: '/doc-1.sy', hpath: '/Doc 1', content: 'Doc 1', type: 'd' }];
                    }
                    return [];
                }
                if (endpoint === '/api/block/getChildBlocks') {
                    if (body?.id === 'doc-1') return [{ id: 'block-1', type: 'p' }];
                    return [];
                }
                if (endpoint === '/api/block/getBlockKramdown') {
                    return {
                        id: 'block-1',
                        kramdown: 'See <span data-type="block-ref" data-subtype="s" data-id="20240601010101-abcdefg">目标文档</span>\n{: id="block-1"}',
                    };
                }
                if (endpoint === '/api/filetree/getHPathByID') return '/Doc 1';
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canRead: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'get_doc', id: 'doc-1' },
            buildDefaultToolConfig().document,
            permMgr as never,
        );
        const parsed = parseResult(result);

        expect(parsed.content).toBe("See ((20240601010101-abcdefg '目标文档'))");
        expect(parsed.hPath).toBe('/Doc 1');
        expect(parsed).toMatchObject({
            blockStart: 0,
            blockLimit: 50,
            returnedBlocks: 1,
            totalBlocks: 1,
            tokenBudget: 2000,
            truncated: false,
            hasNextWindow: false,
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/export/exportMdContent', expect.anything());
    });

    it('rejects removed page/pageSize character pagination', async () => {
        const result = await callDocumentTool(
            createMockClient(),
            { action: 'get_doc', id: 'doc-1', page: 1, pageSize: 100 },
            buildDefaultToolConfig().document,
            {} as never,
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('validation_error');
        expect(result.content[0].text).toContain('character pagination was removed');
    });
});

describe('document.move schema', () => {
    it('declares the same move shapes accepted by runtime validation', () => {
        const move = DOCUMENT_VARIANTS.find((variant) => variant.action === 'move');

        expect(move?.schema.required).toEqual(['action']);
        expect(move?.schema.properties?.notebook).toBeUndefined();
        expect(move?.schema.properties?.path).toBeUndefined();
        expect(move?.schema.properties?.fromPaths?.type).toBe('array');
        expect(move?.schema.properties?.toNotebook?.type).toBe('string');
        expect(move?.schema.properties?.toPath?.type).toBe('string');
        expect(move?.schema.properties?.fromIDs?.type).toBe('array');
        expect(move?.schema.properties?.toID?.type).toBe('string');
    });

    it('accepts both runtime-suggested move shapes', () => {
        expect(DocumentMoveSchema.safeParse({
            action: 'move',
            fromIDs: ['20260424090835-7zk12km'],
            toID: '20260424090835-mgazf66',
        }).success).toBe(true);

        expect(DocumentMoveSchema.safeParse({
            action: 'move',
            fromPaths: ['/20260424090835-rx6ds6g/20260424090835-7zk12km.sy'],
            toNotebook: '20260424090835-rx6ds6g',
            toPath: '/20260424090835-rx6ds6g/20260424090835-mgazf66.sy',
        }).success).toBe(true);
    });

    it('ignores blank legacy path fields instead of switching validation modes', () => {
        const result = DocumentMoveSchema.safeParse({
            action: 'move',
            path: '',
            notebook: '',
            fromIDs: ['20260424090835-7zk12km'],
            toID: '20260424090835-mgazf66',
        });

        expect(result.success).toBe(true);
    });

    it('returns a concise tool validation error when fromIDs is not an array', async () => {
        const config = buildDefaultToolConfig().document;
        config.actions.move = true;
        const result = await callDocumentTool(
            {} as never,
            { action: 'move', fromIDs: '20260422174709-kti2yfj', toID: '20260407011653-t80igcv' },
            config,
            {} as never,
        );
        const payload = JSON.parse(result.content[0].text);

        expect(result.isError).toBe(true);
        expect(payload.error.type).toBe('validation_error');
        expect(payload.error.message).toBe('Invalid arguments for document(action="move").');
        expect(payload.error.fields[0].path).toBe('fromIDs');
        expect(payload.error.fields[0].message).toBe('fromIDs has an invalid type.');
    });

    it('returns a specific unknown_action error for unsupported actions', async () => {
        const result = await callDocumentTool(
            {} as never,
            { action: 'not_exist_action', id: '20210808180117-czbujy4' },
            buildDefaultToolConfig().document,
            {} as never,
        );
        const payload = JSON.parse(result.content[0].text);

        expect(result.isError).toBe(true);
        expect(payload.error.type).toBe('unknown_action');
        expect(payload.error.message).toBe('Unknown action "not_exist_action" for tool "document".');
        expect(payload.error.validActions).toContain('create');
        expect(payload.error.validActions).toContain('help');
        expect(payload.error.validActions).not.toContain('not_exist_action');
    });
});

describe('document.reorder', () => {
    function createPermMgr(level: 'rwd' | 'rw' | 'r' = 'rw') {
        return {
            reload: vi.fn(async () => undefined),
            canRead: vi.fn(() => level !== 'r'),
            canWrite: vi.fn(() => level === 'rw' || level === 'rwd'),
            canDelete: vi.fn(() => level === 'rwd'),
            get: vi.fn(() => level),
        } as never;
    }

    function createNestedReorderClient(initialOrder = ['doc-a', 'doc-b', 'doc-c'], initialSortMode = 1) {
        const documents = [
            { id: 'doc-a', path: '/parent/doc-a.sy', hPath: '/Parent/A', name: 'A.sy', sort: 10 },
            { id: 'doc-b', path: '/parent/doc-b.sy', hPath: '/Parent/B', name: 'B.sy', sort: 20 },
            { id: 'doc-c', path: '/parent/doc-c.sy', hPath: '/Parent/C', name: 'C.sy', sort: 30 },
        ];
        let order = [...initialOrder];
        let sortMode = initialSortMode;
        const request = vi.fn(async (endpoint: string, body?: Record<string, any>) => {
            if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: [{ id: 'nb-1', name: 'Notebook', closed: false }] };
            if (endpoint === '/api/query/sql') {
                return [{ id: 'parent-doc', root_id: 'parent-doc', box: 'nb-1', path: '/parent.sy', hpath: '/Parent', content: 'Parent', type: 'd' }];
            }
            if (endpoint === '/api/notebook/getNotebookConf') return { box: 'nb-1', name: 'Notebook', conf: { sortMode } };
            if (endpoint === '/api/filetree/listDocsByPath') return { box: 'nb-1', files: order.map((id) => documents.find((item) => item.id === id)) };
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

    it('publishes the ID entry schema and rejects an empty permutation', () => {
        const variant = DOCUMENT_VARIANTS.find((item) => item.action === 'reorder');
        expect(variant?.schema.required).toEqual(['action', 'parentID', 'orderedIDs']);
        expect(variant?.schema.properties?.orderedIDs?.type).toBe('array');
        expect(DocumentReorderSchema.safeParse({ action: 'reorder', parentID: 'parent-doc', orderedIDs: [] }).success).toBe(false);
    });

    it('reorders nested child documents by ID and enables custom sorting', async () => {
        const { client, request, getOrder, getSortMode } = createNestedReorderClient();
        const result = await callDocumentTool(client, {
            action: 'reorder', parentID: 'parent-doc', orderedIDs: ['doc-c', 'doc-a', 'doc-b'],
        }, buildDefaultToolConfig().document, createPermMgr());

        expect(parseResult(result)).toMatchObject({
            success: true,
            parentID: 'parent-doc',
            notebook: 'nb-1',
            changed: true,
            orderChanged: true,
            sortModeChanged: true,
            previousOrder: ['doc-a', 'doc-b', 'doc-c'],
            order: ['doc-c', 'doc-a', 'doc-b'],
        });
        expect(getOrder()).toEqual(['doc-c', 'doc-a', 'doc-b']);
        expect(getSortMode()).toBe(6);
        expect(request).toHaveBeenCalledWith('/api/filetree/listDocsByPath', {
            notebook: 'nb-1', path: '/parent.sy', sort: 6, maxListCount: 0, showHidden: false, ignoreMaxListHint: true,
        });
        expect(request).toHaveBeenCalledWith('/api/filetree/changeSort', {
            notebook: 'nb-1', paths: ['/parent/doc-c.sy', '/parent/doc-a.sy', '/parent/doc-b.sy'],
        });
    });

    it.each([
        [['doc-a', 'doc-a', 'doc-c'], 'duplicates'],
        [['doc-a', 'doc-b'], 'missing'],
        [['doc-a', 'doc-b', 'doc-c', 'outside-parent'], 'unexpected'],
    ])('rejects duplicate, missing, and cross-parent IDs (%s)', async (orderedIDs, detail) => {
        const { client, request } = createNestedReorderClient();
        const result = await callDocumentTool(client, {
            action: 'reorder', parentID: 'parent-doc', orderedIDs,
        }, buildDefaultToolConfig().document, createPermMgr());

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(detail);
        expect(request).not.toHaveBeenCalledWith('/api/filetree/changeSort', expect.anything());
    });

    it('denies reorder when the parent notebook is read-only', async () => {
        const { client, request } = createNestedReorderClient();
        const result = await callDocumentTool(client, {
            action: 'reorder', parentID: 'parent-doc', orderedIDs: ['doc-a', 'doc-b', 'doc-c'],
        }, buildDefaultToolConfig().document, createPermMgr('r'));

        expect(result.isError).toBe(true);
        expect(parseResult(result).error).toMatchObject({ type: 'permission_denied', required_permission: 'write' });
        expect(request).not.toHaveBeenCalledWith('/api/filetree/changeSort', expect.anything());
    });
});

describe('document.lookup path compatibility', () => {
    it('strips duplicate leading title heading when creating a document', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/filetree/createDocWithMd') return 'doc-1';
                if (endpoint.startsWith('/api/ui/')) return null;
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canWrite: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'create', notebook: 'nb-1', path: '/Inbox/New Child', markdown: '# New Child\n\nBody' },
            buildDefaultToolConfig().document,
            permMgr as never,
        );

        expect(parseResult(result)).toMatchObject({ success: true, id: 'doc-1' });
        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/Inbox/New Child',
            markdown: 'Body',
        });
    });

    it('keeps a leading h1 when it does not match the document title', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/filetree/createDocWithMd') return 'doc-1';
                if (endpoint.startsWith('/api/ui/')) return null;
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canWrite: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        await callDocumentTool(
            client,
            { action: 'create', notebook: 'nb-1', path: '/Inbox/New Child', markdown: '# Different Heading\n\nBody' },
            buildDefaultToolConfig().document,
            permMgr as never,
        );

        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/Inbox/New Child',
            markdown: '# Different Heading\n\nBody',
        });
    });

    it('expands naked block references when creating a document', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/block/getBlockKramdown' && body?.id === '20260508123456-abcdefg') {
                    return { id: body.id, kramdown: '完整标题\n{: id="20260508123456-abcdefg"}' };
                }
                if (endpoint === '/api/filetree/createDocWithMd') return 'doc-1';
                if (endpoint.startsWith('/api/ui/')) return null;
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canWrite: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        await callDocumentTool(
            client,
            { action: 'create', notebook: 'nb-1', path: '/Inbox/New Child', markdown: 'See ((20260508123456-abcdefg))' },
            buildDefaultToolConfig().document,
            permMgr as never,
        );

        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/Inbox/New Child',
            markdown: "See ((20260508123456-abcdefg '完整标题'))",
        });
    });

    it('falls back to the id as anchor when a naked block reference cannot be resolved during document creation', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/block/getBlockKramdown') throw new Error('missing block');
                if (endpoint === '/api/block/getBlockInfo') throw new Error('missing block');
                if (endpoint === '/api/filetree/createDocWithMd') return 'doc-1';
                if (endpoint.startsWith('/api/ui/')) return null;
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canWrite: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'create', notebook: 'nb-1', path: '/Inbox/New Child', markdown: 'See ((20250321001215-j3k2u2v))' },
            buildDefaultToolConfig().document,
            permMgr as never,
        );
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.warning).toBe('Some naked block references used the block ID as fallback anchor text.');
        expect(parsed.hint).toContain('fallback anchor text');
        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/Inbox/New Child',
            markdown: "See ((20250321001215-j3k2u2v '20250321001215-j3k2u2v'))",
        });
    });

    it('allows siyuan block links when creating a document with a hint', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/filetree/createDocWithMd') return 'doc-1';
                if (endpoint.startsWith('/api/ui/')) return null;
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canWrite: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'create', notebook: 'nb-1', path: '/Inbox/New Child', markdown: '[目标](siyuan://blocks/20260508123456-abcdefg)' },
            buildDefaultToolConfig().document,
            permMgr as never,
        );
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.warning).toBe('siyuan://blocks Markdown links create mentions, not backlinks.');
        expect(parsed.hint).toContain('mentions, not backlinks');
        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/Inbox/New Child',
            markdown: '[目标](siyuan://blocks/20260508123456-abcdefg)',
        });
    });

    it('allows footnote-style references when creating a document with a hint', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/filetree/createDocWithMd') return 'doc-1';
                if (endpoint.startsWith('/api/ui/')) return null;
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canWrite: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'create', notebook: 'nb-1', path: '/Inbox/New Child', markdown: '正文[^1]\n\n[^1]: 角注内容' },
            buildDefaultToolConfig().document,
            permMgr as never,
        );
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.warning).toBe('Footnote-style references create footnotes or note markers, not backlinks.');
        expect(parsed.hint).toContain('not SiYuan backlinks');
        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/Inbox/New Child',
            markdown: '正文[^1]\n\n[^1]: 角注内容',
        });
    });

    it('allows footnote-looking text inside code blocks when creating a document', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/filetree/createDocWithMd') return 'doc-1';
                if (endpoint.startsWith('/api/ui/')) return null;
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canWrite: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };
        const markdown = '```\\n[^1] 教程：这是脚注语法示例\\n```';

        const result = await callDocumentTool(
            client,
            { action: 'create', notebook: 'nb-1', path: '/Inbox/New Child', markdown },
            buildDefaultToolConfig().document,
            permMgr as never,
        );
        const parsed = parseResult(result);

        expect(result.isError).toBeUndefined();
        expect(parsed.warning).toBe('Footnote-style references create footnotes or note markers, not backlinks.');
        expect(client.request).toHaveBeenCalledWith('/api/filetree/createDocWithMd', {
            notebook: 'nb-1',
            path: '/Inbox/New Child',
            markdown,
        });
    });

    it('adds notebookName when resolving a document by hpath', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/notebook/lsNotebooks') {
                    return { notebooks: [{ id: 'nb-1', name: 'Project Notes', icon: '', sort: 0, closed: false }] };
                }
                if (endpoint === '/api/filetree/getIDsByHPath') return ['doc-1'];
                if (endpoint === '/api/filetree/getPathByID') return { notebook: 'nb-1', path: '/doc-1.sy' };
                if (endpoint === '/api/block/getDocInfo') return { id: 'doc-1' };
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canRead: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'lookup', notebook: 'nb-1', hpath: '/Projects/Plan', include: ['id', 'path', 'hpath'] },
            buildDefaultToolConfig().document,
            permMgr as never,
        );
        const payload = parseResult(result) as Record<string, unknown>;

        expect(payload).toEqual({
            humanPath: {
                notebookName: 'Project Notes',
                hPath: '/Projects/Plan',
            },
            idPath: {
                id: 'doc-1',
                ids: ['doc-1'],
                notebook: 'nb-1',
                path: '/doc-1.sy',
            },
        });
    });

    it('falls back to SQL when getIDsByHPath misses duplicate hpath documents', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/notebook/lsNotebooks') {
                    return { notebooks: [{ id: 'nb-1', name: 'Project Notes', icon: '', sort: 0, closed: false }] };
                }
                if (endpoint === '/api/filetree/getIDsByHPath') return [];
                if (endpoint === '/api/query/sql') {
                    const stmt = String(body?.stmt ?? '');
                    if (stmt.includes("hpath = '/Projects/Plan'")) {
                        return [{ id: 'doc-2' }, { id: 'doc-1' }];
                    }
                    if (stmt.includes("id = 'doc-2'")) {
                        return [{
                            id: 'doc-2',
                            root_id: 'doc-2',
                            box: 'nb-1',
                            path: '/doc-2.sy',
                            hpath: '/Projects/Plan',
                            content: 'Plan',
                            type: 'd',
                        }];
                    }
                    throw new Error(`Unexpected SQL: ${stmt}`);
                }
                if (endpoint === '/api/filetree/getPathByID') return { notebook: 'nb-1', path: '/doc-2.sy' };
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canRead: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'lookup', notebook: 'nb-1', hpath: '/Projects/Plan', include: ['ids', 'path', 'hpath'] },
            buildDefaultToolConfig().document,
            permMgr as never,
        );
        const payload = parseResult(result) as Record<string, unknown>;

        expect(result.isError).toBeUndefined();
        expect(payload).toEqual({
            humanPath: {
                notebookName: 'Project Notes',
                hPath: '/Projects/Plan',
            },
            idPath: {
                ids: ['doc-2', 'doc-1'],
                notebook: 'nb-1',
                path: '/doc-2.sy',
            },
        });
    });

    it('interprets non-storage path input as hpath and returns the storage path', async () => {
        const client = createMockClient({
            request: vi.fn(async (endpoint: string) => {
                if (endpoint === '/api/notebook/lsNotebooks') {
                    return { notebooks: [{ id: 'nb-1', name: 'Project Notes', icon: '', sort: 0, closed: false }] };
                }
                if (endpoint === '/api/filetree/getIDsByHPath') return ['doc-1'];
                if (endpoint === '/api/filetree/getPathByID') return { notebook: 'nb-1', path: '/doc-1.sy' };
                throw new Error(`Unexpected endpoint: ${endpoint}`);
            }),
        });
        const permMgr = {
            reload: vi.fn(async () => undefined),
            canRead: vi.fn(() => true),
            get: vi.fn(() => 'rwd'),
        };

        const result = await callDocumentTool(
            client,
            { action: 'lookup', notebook: 'nb-1', path: '/AI Interface Root 20260427_144409', include: ['id', 'path', 'hpath'] },
            buildDefaultToolConfig().document,
            permMgr as never,
        );
        const payload = parseResult(result) as Record<string, unknown>;

        expect(result.isError).toBeUndefined();
        expect(payload).toEqual({
            humanPath: {
                notebookName: 'Project Notes',
                hPath: '/AI Interface Root 20260427_144409',
            },
            idPath: {
                id: 'doc-1',
                ids: ['doc-1'],
                notebook: 'nb-1',
                path: '/doc-1.sy',
            },
        });
        expect(client.request).not.toHaveBeenCalledWith('/api/filetree/getHPathByPath', expect.anything());
    });
});
