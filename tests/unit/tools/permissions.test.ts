import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryToolConfig } from '@/core/config';
import { callBlockTool } from '@/tools/block';
import { callDocumentTool } from '@/tools/document';
import { callSearchTool } from '@/tools/search';

import * as blockApi from '@/api/block';
import * as documentApi from '@/api/document';
import * as notebookApi from '@/api/notebook';
import * as searchApi from '@/api/search';
import * as contextTools from '@/tools/internal/context';

import { parseResult } from '../../helpers/parse-result';

const searchConfig: CategoryToolConfig<'fulltext' | 'query_sql' | 'get_backlinks' | 'search_refs'> = {
    enabled: true,
    actions: {
        fulltext: true,
        query_sql: true,
        get_backlinks: true,
        search_refs: true,
    },
};

const blockConfig: CategoryToolConfig<'insert' | 'prepend' | 'append' | 'update' | 'delete' | 'move' | 'set_fold_state' | 'get_kramdown' | 'get_children' | 'transfer_references' | 'set_attrs' | 'get_attrs' | 'info' | 'breadcrumb' | 'dom' | 'recent_updated' | 'word_count'> = {
    enabled: true,
    actions: {
        insert: true,
        prepend: true,
        append: true,
        update: true,
        delete: true,
        move: true,
        set_fold_state: true,
        get_kramdown: true,
        get_children: true,
        transfer_references: true,
        set_attrs: true,
        get_attrs: true,
        info: true,
        breadcrumb: true,
        dom: true,
        recent_updated: true,
        word_count: true,
    },
};

const documentConfig: CategoryToolConfig<'create' | 'lookup' | 'rename' | 'remove' | 'move' | 'get_child_blocks' | 'get_child_docs' | 'set_attr' | 'list_tree' | 'search_docs' | 'get_doc' | 'create_daily_note'> = {
    enabled: true,
    actions: {
        create: true,
        rename: true,
        remove: true,
        move: true,
        lookup: true,
        get_child_blocks: true,
        get_child_docs: true,
        set_attr: true,
        list_tree: true,
        search_docs: true,
        get_doc: true,
        create_daily_note: true,
    },
};

const permMgr = {
    reload: vi.fn(async () => undefined),
    canRead: vi.fn((notebookId: string) => notebookId !== 'blocked'),
    canWrite: vi.fn(() => true),
    canDelete: vi.fn(() => true),
    get: vi.fn((notebookId: string) => notebookId === 'blocked' ? 'none' : 'rwd'),
};

describe('tool permission and filtering behavior', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        permMgr.reload.mockClear();
        permMgr.canRead.mockImplementation((notebookId: string) => notebookId !== 'blocked');
        permMgr.canWrite.mockImplementation(() => true);
        permMgr.canDelete.mockImplementation(() => true);
        permMgr.get.mockImplementation((notebookId: string) => notebookId === 'blocked' ? 'none' : 'rwd');
    });

    it('rejects raw SQL when notebook permissions cannot be enforced safely', async () => {
        vi.spyOn(notebookApi, 'listNotebooks').mockResolvedValue({
            notebooks: [
                { id: 'allowed', name: 'Allowed', closed: false },
                { id: 'blocked', name: 'Blocked', closed: false },
            ],
        } as never);
        const querySpy = vi.spyOn(searchApi, 'querySQL');

        const result = await callSearchTool({} as never, {
            action: 'query_sql',
            stmt: 'SELECT * FROM blocks LIMIT 2',
        }, searchConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(result.isError).toBe(true);
        expect(parsed.error).toMatchObject({
            code: 'raw_sql_unavailable_with_restricted_notebooks',
            reason: 'permission_scope_not_enforceable',
        });
        expect(querySpy).not.toHaveBeenCalled();
    });

    it('returns unattributable SQL rows unchanged when every notebook is readable', async () => {
        vi.spyOn(notebookApi, 'listNotebooks').mockResolvedValue({
            notebooks: [{ id: 'allowed', name: 'Allowed', closed: false }],
        } as never);
        permMgr.canRead.mockReturnValue(true);
        vi.spyOn(searchApi, 'querySQL').mockResolvedValue([
            { id: 'allowed-row', content: 'visible' },
            { n: 2 },
        ]);
        const docInfoSpy = vi.spyOn(blockApi, 'getDocInfo');
        const pathSpy = vi.spyOn(documentApi, 'getPathByID');

        const result = await callSearchTool({} as never, {
            action: 'query_sql',
            stmt: 'SELECT id FROM blocks LIMIT 2',
        }, searchConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.data).toHaveLength(2);
        expect(parsed.data[0].id).toBe('allowed-row');
        expect(parsed.data[1]).toEqual({ n: 2 });
        expect(docInfoSpy).not.toHaveBeenCalled();
        expect(pathSpy).not.toHaveBeenCalled();
    });

    it('adds partial-result metadata to backlinks when permission filtering happens', async () => {
        vi.spyOn(searchApi, 'querySQL').mockImplementation(async (client, stmt) => {
            if (stmt.includes("WHERE id = 'root-doc'")) {
                return [{
                    id: 'root-doc',
                    root_id: 'root-doc',
                    box: 'allowed',
                    path: '/root-doc.sy',
                    hpath: '/root-doc',
                    content: 'root-doc',
                    type: 'd',
                }];
            }
            return [];
        });
        vi.spyOn(blockApi, 'getDocInfo').mockResolvedValue({
            id: 'root-doc',
            rootID: 'root-doc',
            name: 'root-doc.sy',
        } as never);
        vi.spyOn(documentApi, 'getPathByID').mockResolvedValue({
            notebook: 'allowed',
            path: '/root-doc.sy',
        });
        vi.spyOn(searchApi, 'getBacklinkDoc').mockResolvedValue({
            backlinks: [
                { id: '1', box: 'allowed' },
                { id: '2', box: 'blocked' },
            ],
            backmentions: [],
        } as never);

        const result = await callSearchTool({} as never, {
            action: 'get_backlinks',
            id: 'root-doc',
            mode: 'links',
        }, searchConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.backlinks).toHaveLength(1);
        expect(parsed.filteredOutCount).toBe(1);
        expect(parsed.partial).toBe(true);
        expect(parsed.reason).toBe('permission_filtered');
    });

    it('falls back to SQL when SiYuan backlink API returns null', async () => {
        vi.spyOn(searchApi, 'querySQL').mockImplementation(async (_client, stmt) => {
            if (stmt.includes("WHERE id = 'target-block'") && stmt.includes('LIMIT 1')) {
                return [{
                    id: 'target-block',
                    root_id: 'root-doc',
                    box: 'allowed',
                    path: '/root-doc.sy',
                    hpath: '/root-doc',
                    content: 'Target Title',
                    type: 'h',
                }];
            }
            if (stmt.includes("FROM spans s")) {
                return [{
                    id: 'ref-block',
                    root_id: 'source-doc',
                    box: 'allowed',
                    path: '/source-doc.sy',
                    hpath: '/source-doc',
                    type: 'p',
                    content: 'ref paragraph',
                    markdown: "see ((target-block 'Target Title'))",
                }];
            }
            if (stmt.includes('FROM blocks') && stmt.includes("instr(content, 'Target Title') > 0")) {
                return [{
                    id: 'mention-block',
                    root_id: 'source-doc',
                    box: 'allowed',
                    path: '/source-doc.sy',
                    hpath: '/source-doc',
                    type: 'p',
                    content: 'Target Title appears here',
                    markdown: 'Target Title appears here',
                }];
            }
            return [];
        });
        vi.spyOn(blockApi, 'getDocInfo').mockResolvedValue({
            id: 'target-block',
            rootID: 'root-doc',
            name: 'root-doc.sy',
        } as never);
        vi.spyOn(documentApi, 'getPathByID').mockResolvedValue({
            notebook: 'allowed',
            path: '/root-doc.sy',
        });
        vi.spyOn(searchApi, 'getBacklinkDoc').mockResolvedValue(null as never);
        vi.spyOn(searchApi, 'getBackmentionDoc').mockResolvedValue(null as never);

        const result = await callSearchTool({} as never, {
            action: 'get_backlinks',
            id: 'target-block',
        }, searchConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.backlinks).toHaveLength(1);
        expect(parsed.backlinks[0].id).toBe('ref-block');
        expect(parsed.backmentions).toHaveLength(1);
        expect(parsed.backmentions[0].id).toBe('mention-block');
        expect(parsed.sourcePayloadMissing).toBe(true);
        expect(parsed.fallbackQuery).toBe('sql');
        expect(parsed.resultConfidence).toBe('fallback');
        expect(parsed.warning).toMatch(/SQL fallback/);
    });

    it('falls back to SQL when SiYuan backmention API returns null', async () => {
        vi.spyOn(searchApi, 'querySQL').mockImplementation(async (_client, stmt) => {
            if (stmt.includes("WHERE id = 'target-block'") && stmt.includes('LIMIT 1')) {
                return [{
                    id: 'target-block',
                    root_id: 'root-doc',
                    box: 'allowed',
                    path: '/root-doc.sy',
                    hpath: '/root-doc',
                    content: 'Target Title',
                    type: 'h',
                }];
            }
            if (stmt.includes('FROM blocks') && stmt.includes("instr(content, 'Target Title') > 0")) {
                return [{
                    id: 'mention-block',
                    root_id: 'source-doc',
                    box: 'allowed',
                    path: '/source-doc.sy',
                    hpath: '/source-doc',
                    type: 'p',
                    content: 'Target Title appears here',
                    markdown: 'Target Title appears here',
                }];
            }
            return [];
        });
        vi.spyOn(blockApi, 'getDocInfo').mockResolvedValue({
            id: 'target-block',
            rootID: 'root-doc',
            name: 'root-doc.sy',
        } as never);
        vi.spyOn(documentApi, 'getPathByID').mockResolvedValue({
            notebook: 'allowed',
            path: '/root-doc.sy',
        });
        vi.spyOn(searchApi, 'getBackmentionDoc').mockResolvedValue(null as never);

        const result = await callSearchTool({} as never, {
            action: 'get_backlinks',
            id: 'target-block',
            mode: 'mentions',
        }, searchConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.backmentions).toHaveLength(1);
        expect(parsed.backmentions[0].id).toBe('mention-block');
        expect(parsed.sourcePayloadMissing).toBe(true);
        expect(parsed.fallbackQuery).toBe('sql');
        expect(parsed.resultConfidence).toBe('fallback');
        expect(parsed.warning).toMatch(/SQL fallback/);
    });

    it('retries resolve hpath when SiYuan is still indexing', async () => {
        vi.spyOn(contextTools, 'ensurePermissionForDocumentId').mockResolvedValue({
            context: { documentId: 'doc-1', notebook: 'allowed', path: '/doc-1.sy' },
            denied: null,
        } as never);
        vi.spyOn(documentApi, 'getHPathByID')
            .mockRejectedValueOnce(new Error('SiYuan API error: -1 - indexing'))
            .mockResolvedValueOnce('/Projects/New Doc');

        const result = await callDocumentTool({} as never, {
            action: 'lookup',
            id: 'doc-1',
            include: ['hpath'],
        }, documentConfig, permMgr as never);

        expect(parseResult(result)).toEqual({
            humanPath: {
                notebookName: 'allowed',
                hPath: '/Projects/New Doc',
            },
            idPath: {
                id: 'doc-1',
                notebook: 'allowed',
                path: '/doc-1.sy',
            },
        });
        expect(documentApi.getHPathByID).toHaveBeenCalledTimes(2);
    });

    it('prefers SQL ownership resolution for readable docs when filetree APIs misreport notebook', async () => {
        vi.spyOn(searchApi, 'querySQL').mockImplementation(async (_client, stmt) => {
            if (stmt.includes("WHERE id = 'doc-in-allowed'")) {
                return [{
                    id: 'doc-in-allowed',
                    root_id: 'doc-in-allowed',
                    box: 'allowed',
                    path: '/doc-in-allowed.sy',
                    hpath: '/doc-in-allowed',
                    content: 'Doc In Allowed',
                    type: 'd',
                }];
            }
            return [];
        });
        vi.spyOn(blockApi, 'getDocInfo').mockResolvedValue({
            id: 'doc-in-allowed',
            rootID: 'doc-in-allowed',
            name: 'doc-in-allowed.sy',
        } as never);
        vi.spyOn(documentApi, 'getPathByID').mockResolvedValue({
            notebook: 'blocked',
            path: '/doc-in-allowed.sy',
        });
        vi.spyOn(searchApi, 'getBacklinkDoc').mockResolvedValue({
            backlinks: [{ id: '1', box: 'allowed' }],
            backmentions: [],
        } as never);

        const result = await callSearchTool({} as never, {
            action: 'get_backlinks',
            id: 'doc-in-allowed',
            mode: 'links',
        }, searchConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.error).toBeUndefined();
        expect(parsed.backlinks).toHaveLength(1);
        expect(parsed.backlinks[0].id).toBe('1');
    });

    it('filters recent updates before applying count', async () => {
        vi.spyOn(blockApi, 'getRecentUpdatedBlocks').mockResolvedValue([
            { id: '1', box: 'allowed', root_id: 'doc-a', path: '/doc-a.sy', type: 'p', content: 'a' },
            { id: '2', box: 'blocked', root_id: 'doc-b', path: '/doc-b.sy', type: 'p', content: 'b' },
            { id: '3', box: 'allowed', root_id: 'doc-a', path: '/doc-a.sy', type: 'h', content: 'c' },
        ]);
        vi.spyOn(searchApi, 'querySQL').mockImplementation(async (_client, stmt) => {
            if (stmt.includes("WHERE id = 'doc-a'")) {
                return [{
                    id: 'doc-a',
                    root_id: 'doc-a',
                    box: 'allowed',
                    path: '/doc-a.sy',
                    hpath: '/Doc A',
                    content: 'Doc A',
                    type: 'd',
                }];
            }
            return [];
        });
        vi.spyOn(blockApi, 'getDocInfo').mockResolvedValue({
            id: 'doc-a',
            rootID: 'doc-a',
            name: 'Doc A.sy',
        } as never);
        vi.spyOn(documentApi, 'getPathByID').mockResolvedValue({
            notebook: 'allowed',
            path: '/doc-a.sy',
        });

        const result = await callBlockTool({} as never, {
            action: 'recent_updated',
            count: 2,
        }, blockConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.items).toHaveLength(2);
        expect(parsed.items[0].id).toBe('1');
        expect(parsed.documents).toEqual([{
            documentId: 'doc-a',
            notebook: 'allowed',
            path: '/doc-a.sy',
            hPath: '/Doc A',
            name: 'Doc A',
            updatedBlockCount: 2,
            sampleBlocks: [
                { id: '1', type: 'p', content: 'a', path: '/doc-a.sy' },
                { id: '3', type: 'h', content: 'c', path: '/doc-a.sy' },
            ],
        }]);
        expect(parsed.primaryView).toBe('documents');
        expect(parsed.count).toBe(2);
        expect(parsed.documentCount).toBe(1);
        expect(parsed.containsLowLevelBlocks).toBe(true);
        expect(parsed.grouping).toBe('document');
        expect(parsed.filteredOutCount).toBe(1);
        expect(parsed.partial).toBe(true);
    });

    it('applies storage-path filtering to search_docs results', async () => {
        vi.spyOn(documentApi, 'searchDocs').mockResolvedValue({
            files: [
                { id: '1', box: 'allowed', path: '/projects/alpha/doc-1.sy', name: 'Doc 1' },
                { id: '2', box: 'allowed', path: '/archive/doc-2.sy', name: 'Doc 2' },
                { id: '3', box: 'blocked', path: '/projects/alpha/doc-3.sy', name: 'Doc 3' },
            ],
        });

        const result = await callDocumentTool({} as never, {
            action: 'search_docs',
            notebook: 'allowed',
            query: 'Doc',
            path: '/projects/alpha',
        }, documentConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.files).toHaveLength(1);
        expect(parsed.files[0].id).toBe('1');
        expect(parsed.pathApplied).toBe(true);
        expect(parsed.filteredOutCount).toBe(2);
        expect(parsed.pathFilteredOutCount).toBe(1);
        expect(parsed.partial).toBe(true);
    });

    it('adds an icon reminder to document create results', async () => {
        vi.spyOn(documentApi, 'createDoc').mockResolvedValue('doc-1');

        const result = await callDocumentTool({} as never, {
            action: 'create',
            notebook: 'allowed',
            path: '/Test Doc',
            markdown: '# Test',
        }, documentConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.id).toBe('doc-1');
        expect(parsed.iconHint).toContain('document(action="set_attr"');
        expect(parsed.iconHint).toContain('Unicode hex code string');
    });

    it('creates parentPath + title documents through the reliable path flow', async () => {
        vi.spyOn(documentApi, 'createDoc').mockResolvedValue('doc-real');
        vi.spyOn(documentApi, 'createEmptyDoc').mockResolvedValue({ id: 'raw-create-result' });

        const result = await callDocumentTool({} as never, {
            action: 'create',
            notebook: 'allowed',
            parentPath: '/AI Interface Root 202604270724',
            title: 'Child Doc 202604270724',
            markdown: '# Test',
        }, documentConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(documentApi.createDoc).toHaveBeenCalledWith(
            expect.anything(),
            'allowed',
            '/AI Interface Root 202604270724/Child Doc 202604270724',
            '# Test',
        );
        expect(parsed.id).toBe('doc-real');
        expect(parsed.path).toBe('/AI Interface Root 202604270724/Child Doc 202604270724');
        expect(documentApi.createEmptyDoc).not.toHaveBeenCalled();
    });

    it('converts storage parentPath before title-based document creation', async () => {
        vi.spyOn(documentApi, 'getHPathByPath').mockResolvedValue('/AI Interface Root 202604270724');
        vi.spyOn(documentApi, 'createDoc').mockResolvedValue('doc-real');

        const result = await callDocumentTool({} as never, {
            action: 'create',
            notebook: 'allowed',
            parentPath: '/20260427072400-abcdefg.sy',
            title: 'Child Doc 202604270724',
            markdown: '# Test',
        }, documentConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(documentApi.getHPathByPath).toHaveBeenCalledWith(
            expect.anything(),
            'allowed',
            '/20260427072400-abcdefg.sy',
        );
        expect(documentApi.createDoc).toHaveBeenCalledWith(
            expect.anything(),
            'allowed',
            '/AI Interface Root 202604270724/Child Doc 202604270724',
            '# Test',
        );
        expect(parsed.id).toBe('doc-real');
        expect(parsed.path).toBe('/AI Interface Root 202604270724/Child Doc 202604270724');
        expect(parsed.resolvedParentPath).toBe('/AI Interface Root 202604270724');
    });

    it('adds an icon reminder to daily note create results', async () => {
        vi.spyOn(documentApi, 'createDailyNote').mockResolvedValue({
            id: 'daily-1',
            path: '/daily/2026-04-03.sy',
        } as never);
        vi.spyOn(documentApi, 'getHPathByID').mockResolvedValue('/Daily Note/2026-04-03');

        const result = await callDocumentTool({} as never, {
            action: 'create_daily_note',
            notebook: 'allowed',
        }, documentConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.id).toBe('daily-1');
        expect(parsed.iconHint).toContain('document(action="set_attr"');
        expect(parsed.iconHint).toContain('Unicode hex code string');
    });

    it('caches repeated getDocInfo lookups while enriching list_tree', async () => {
        const getDocInfo = vi.spyOn(blockApi, 'getDocInfo').mockResolvedValue({
            id: 'doc-1',
            rootID: 'doc-1',
            name: 'Doc One.sy',
            icon: '1f4d4',
        } as never);
        vi.spyOn(documentApi, 'listDocTree').mockResolvedValue({
            tree: [
                { id: 'doc-1' },
                { id: 'doc-1' },
            ],
        });

        const result = await callDocumentTool({} as never, {
            action: 'list_tree',
            notebook: 'allowed',
            path: '/',
        }, documentConfig, permMgr as never);
        const parsed = parseResult(result);

        expect(parsed.tree).toHaveLength(2);
        expect(parsed.tree[0].name).toBe('Doc One');
        expect(getDocInfo).toHaveBeenCalledTimes(1);
    });
});
