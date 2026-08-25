import { describe, expect, it, vi } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { callBlockTool, BLOCK_VARIANTS } from '@/tools/block';
import { callDocumentTool, DOCUMENT_VARIANTS } from '@/tools/document';
import { callFileTool, FILE_VARIANTS } from '@/tools/file';
import { callFeedbackTool, FEEDBACK_VARIANTS } from '@/tools/feedback';
import { callNotebookTool, NOTEBOOK_VARIANTS } from '@/tools/notebook';
import { callFsTool, FS_VARIANTS } from '@/tools/fs';
import { callSearchTool, SEARCH_VARIANTS } from '@/tools/search';
import { callSystemTool, SYSTEM_VARIANTS } from '@/tools/system';
import { callTagTool, TAG_VARIANTS } from '@/tools/tag';
import { createMockClient } from '../../helpers/mock-client';
import { parseResult } from '../../helpers/parse-result';

type ToolCaller = (
    client: ReturnType<typeof createMockClient>,
    args: Record<string, unknown>,
    config: any,
    permMgr: any,
) => Promise<any>;

interface ContractCase {
    action: string;
    args: Record<string, unknown>;
    expectedEndpoint?: string;
}

const docRow = {
    id: 'doc-1',
    root_id: 'doc-1',
    box: 'nb-1',
    path: '/doc-1.sy',
    hpath: '/Doc 1',
    content: 'Doc 1',
    type: 'd',
};

function createPermMgr() {
    return {
        reload: vi.fn(async () => undefined),
        canRead: vi.fn(() => true),
        canWrite: vi.fn(() => true),
        canDelete: vi.fn(() => true),
        get: vi.fn(() => 'rwd'),
        set: vi.fn(async () => undefined),
    };
}

function createContractClient() {
    return createMockClient({
        getBaseUrl: vi.fn(() => 'http://127.0.0.1:6806'),
        getAuthHeaders: vi.fn(() => ({ Authorization: 'Token test' })),
        requestFormData: vi.fn(async () => ({ errFiles: [], succMap: { 'asset.txt': 'assets/asset.txt' } })),
        writeFile: vi.fn(async () => undefined),
        readFileBinary: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])),
        request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
            if (endpoint.startsWith('/api/ui/')) return null;
            if (endpoint === '/api/query/sql') {
                const stmt = String(body?.stmt ?? '');
                if (stmt.includes("type = 'd'")) {
                    return stmt.includes("hpath = '/New Doc'") ? [] : [docRow];
                }
                if (stmt.includes("type IN ('p', 'h')")) {
                    return [{ id: 'block-1', root_id: 'doc-1', box: 'nb-1', path: '/doc-1.sy', hpath: '/Doc 1', type: 'p', sort: 1 }];
                }
                return [docRow];
            }
            if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: [{ id: 'nb-1', name: 'Notebook', closed: false }] };
            if (endpoint === '/api/notebook/createNotebook') return { notebook: { id: 'nb-1', name: body?.name ?? 'Notebook' } };
            if (endpoint === '/api/notebook/getNotebookConf') return { conf: { name: 'Notebook' } };
            if (endpoint === '/api/notebook/setNotebookConf') return { success: true };

            if (endpoint === '/api/filetree/createDocWithMd') return 'doc-1';
            if (endpoint === '/api/filetree/getPathByID') return { notebook: 'nb-1', path: '/doc-1.sy' };
            if (endpoint === '/api/filetree/getHPathByID') return body?.id === 'child-2' ? '/Doc 2' : '/Doc 1';
            if (endpoint === '/api/filetree/getHPathByPath') return '/Doc 1';
            if (endpoint === '/api/filetree/getIDsByHPath') return body?.path === '/New Doc' ? [] : ['doc-1'];
            if (endpoint === '/api/filetree/listDocsByPath') return { box: 'nb-1', files: [
                { id: 'child-1', box: 'nb-1', path: '/child-1.sy', name: 'Doc 1.sy', sort: 10 },
                { id: 'child-2', box: 'nb-1', path: '/child-2.sy', name: 'Doc 2.sy', sort: 20 },
            ] };
            if (endpoint === '/api/filetree/listDocTree') return { tree: [{ id: 'doc-1', path: '/doc-1.sy' }] };
            if (endpoint === '/api/filetree/searchDocs') return { docs: [{ id: 'doc-1', box: 'nb-1', path: '/doc-1.sy' }] };
            if (endpoint === '/api/filetree/getDoc') return { content: '<p>Doc</p>' };
            if (endpoint === '/api/outline/getDocOutline') return [{ id: 'heading-1', name: 'Heading', blocks: [], children: [] }];
            if (endpoint === '/api/filetree/createDailyNote') return { id: 'doc-1' };
            if (endpoint === '/api/filetree/duplicateDoc') return { id: 'doc-copy', notebook: 'nb-1', path: '/copy.sy' };
            if (endpoint === '/api/filetree/doc2Heading') return { srcTreeBox: 'nb-1', srcTreePath: '/doc-1.sy' };

            if (endpoint === '/api/block/insertBlock') return [{ doOperations: [{ id: 'block-new', parentID: body?.parentID }] }];
            if (endpoint === '/api/block/prependBlock') return [{ doOperations: [{ id: 'block-new', parentID: body?.parentID }] }];
            if (endpoint === '/api/block/appendBlock') return [{ doOperations: [{ id: 'block-new', parentID: body?.parentID }] }];
            if (endpoint === '/api/block/updateBlock') return { updated: true };
            if (endpoint === '/api/block/deleteBlock') return {};
            if (endpoint === '/api/block/moveBlock') return { moved: true };
            if (endpoint === '/api/block/getBlockKramdown') return { id: body?.id, kramdown: `content\n{: id="${body?.id ?? 'block-1'}"}` };
            if (endpoint === '/api/block/getBlockKramdowns') {
                return Object.fromEntries(((body?.ids as string[] | undefined) ?? []).map((id) => [id, `content ${id}`]));
            }
            if (endpoint === '/api/block/getChildBlocks') {
                if (body?.id === 'doc-1') return [{ id: 'child-block', type: 'p', box: 'nb-1', path: '/doc-1.sy' }];
                return [];
            }
            if (endpoint === '/api/block/getBlockInfo') return { id: body?.id, rootID: 'doc-1' };
            if (endpoint === '/api/block/getDocInfo') return { id: body?.id, rootID: body?.id, name: 'Doc 1' };
            if (endpoint === '/api/block/getBlockBreadcrumb') return [{ id: 'doc-1', name: 'Doc' }];
            if (endpoint === '/api/block/getBlockDOM') return { id: body?.id as string, dom: '<p>content</p>' };
            if (endpoint === '/api/block/getRecentUpdatedBlocks') return [{ id: 'block-1', rootID: 'doc-1', box: 'nb-1', path: '/doc-1.sy', type: 'p' }];
            if (endpoint === '/api/block/getBlocksWordCount') return { wordCount: 3 };
            if (endpoint === '/api/block/appendDailyNoteBlock') return [{ doOperations: [{ id: 'daily-block' }] }];
            if (endpoint === '/api/block/getDocsInfo') return [{ id: 'doc-1', name: 'Doc' }];
            if (endpoint === '/api/transactions') return body?.transactions ?? [];
            if (endpoint === '/api/attr/getBlockAttrs') return { memo: 'note' };

            if (endpoint === '/api/search/fullTextSearchBlock') return { blocks: [{ id: 'block-1', box: 'nb-1', path: '/doc-1.sy', content: 'match' }], matchedBlockCount: 1, matchedRootCount: 1, pageCount: 1 };
            if (endpoint === '/api/search/semanticSearchBlock') return { blocks: [{ id: 'block-1', box: 'nb-1', path: '/doc-1.sy', content: 'semantic match' }], matchedBlockCount: 1, matchedRootCount: 1, pageCount: 1 };
            if (endpoint === '/api/ref/getBacklinkDoc') return { backlinks: [{ id: 'block-1', box: 'nb-1', path: '/doc-1.sy' }] };
            if (endpoint === '/api/ref/getBackmentionDoc') return { backmentions: [{ id: 'block-2', box: 'nb-1', path: '/doc-1.sy' }] };
            if (endpoint === '/api/search/searchRefBlock') return { blocks: [{ id: 'block-1', box: 'nb-1', path: '/doc-1.sy' }] };
            if (endpoint === '/api/search/searchAsset') return [{ path: 'assets/asset.png' }];
            if (endpoint === '/api/search/fullTextSearchAssetContent') return { assetContents: [{ id: 'asset-1', box: 'nb-1', path: '/doc-1.sy' }] };
            if (endpoint === '/api/search/listInvalidBlockRefs') return { blocks: [{ id: 'bad-ref', box: 'nb-1', path: '/doc-1.sy' }] };
            if (endpoint === '/api/search/searchTemplate') return { k: body?.k ?? '', templates: [{ path: '/workspace/data/templates/demo.md', content: 'demo' }] };
            if (endpoint === '/api/search/removeTemplate') return null;

            if (endpoint === '/api/export/exportMdContent') return { hPath: '/Doc 1', content: 'markdown' };
            if (endpoint === '/api/export/exportMd') return { name: 'Doc 1', zip: '/export/doc-1.zip' };
            if (endpoint === '/api/export/exportResources') return { path: '/temp/export.zip' };
            if (endpoint === '/api/asset/getUnusedAssets') return ['assets/unused.png'];
            if (endpoint === '/api/asset/getDocAssets') return ['assets/doc.png'];
            if (endpoint === '/api/asset/getDocImageAssets') return ['assets/doc.png'];
            if (endpoint === '/api/asset/getImageOCRText') return { text: 'ocr text' };
            if (endpoint === '/api/asset/removeUnusedAssets') return { removed: 1 };
            if (endpoint === '/api/asset/renameAsset') return { newPath: 'assets/new.png' };
            if (endpoint === '/api/asset/deleteAsset') return { removed: true };
            if (endpoint === '/api/template/docSaveAsTemplate') return null;

            if (endpoint === '/api/system/getWorkspaceInfo') return { workspace: '/workspace' };
            if (endpoint === '/api/system/getNetwork') return { proxy: '' };
            if (endpoint === '/api/system/getConf') return { conf: { appearance: { mode: 0 } } };
            if (endpoint === '/api/sync/performSync') return { synced: true };
            if (endpoint === '/api/system/version') return '3.8.0';
            if (endpoint === '/api/system/currentTime') return 1710000000000;
            if (endpoint === '/api/notification/pushMsg') return { id: 'msg-1' };

            if (endpoint === '/api/tag/getTag') return { tags: [{ label: 'tag' }] };
            if (endpoint === '/api/search/searchTag') return { tags: [{ label: 'tag' }] };

            return null;
        }),
    });
}

function expectEndpointCalled(client: ReturnType<typeof createContractClient>, endpoint: string, fetchMock: ReturnType<typeof vi.fn>) {
    const requestCalls = client.request.mock.calls;
    const formCalls = client.requestFormData.mock.calls;
    const writeFileCalls = client.writeFile.mock.calls;
    const fetchCalls = fetchMock.mock.calls;
    expect(
        requestCalls.some(([actual]) => actual === endpoint)
        || formCalls.some(([actual]) => actual === endpoint)
        || (endpoint === '/api/file/putFile' && writeFileCalls.length > 0)
        || fetchCalls.some(([actual]) => typeof actual === 'string' && actual.endsWith(endpoint)),
    ).toBe(true);
}

async function runContracts(
    toolName: keyof ReturnType<typeof buildDefaultToolConfig>,
    variants: Array<{ action: string }>,
    caller: ToolCaller,
    cases: ContractCase[],
) {
    const declared = variants.map((variant) => variant.action);
    expect(cases.map((item) => item.action).sort()).toEqual(declared.sort());

    for (const contract of cases) {
        const client = createContractClient();
        const permMgr = createPermMgr();
        const config = (buildDefaultToolConfig() as any)[toolName];
        config.actions[contract.action] = true;
        const fetchMock = vi.fn(async () => new Response('template markdown', { status: 200 }));
        global.fetch = fetchMock as never;
        const result = await caller(client, contract.args, config, permMgr);
        const parsed = parseResult(result);
        expect(parsed && typeof parsed === 'object' && 'error' in parsed ? parsed.error : undefined, `${toolName}.${contract.action}`).toBeUndefined();
        if (contract.expectedEndpoint) {
            expectEndpointCalled(client, contract.expectedEndpoint, fetchMock);
        }
    }
}

describe('tool action contract coverage', () => {
    it('covers every fs action with a minimal endpoint contract', async () => {
        await runContracts('fs', FS_VARIANTS, callFsTool as ToolCaller, [
            { action: 'ls', args: { action: 'ls', path: '/Notebook/Doc 1' }, expectedEndpoint: '/api/filetree/listDocsByPath' },
            { action: 'tree', args: { action: 'tree', path: '/Notebook' }, expectedEndpoint: '/api/filetree/listDocsByPath' },
            { action: 'read', args: { action: 'read', path: '/Notebook/Doc 1' }, expectedEndpoint: '/api/block/getBlockKramdown' },
            { action: 'write', args: { action: 'write', path: '/Notebook/New Doc', markdown: 'hello' }, expectedEndpoint: '/api/filetree/createDocWithMd' },
            { action: 'replace', args: { action: 'replace', path: '/Notebook/Doc 1', edit: { old: 'content', new: 'updated' } }, expectedEndpoint: '/api/block/getBlockKramdown' },
            { action: 'rm', args: { action: 'rm', path: '/Notebook/Doc 1' }, expectedEndpoint: '/api/filetree/removeDocByID' },
            { action: 'mv', args: { action: 'mv', from: '/Notebook/Doc 1', to: '/Notebook/Renamed' }, expectedEndpoint: '/api/filetree/moveDocsByID' },
            { action: 'reorder', args: { action: 'reorder', path: '/Notebook', orderedPaths: ['/Notebook/Doc 2', '/Notebook/Doc 1'] }, expectedEndpoint: '/api/filetree/changeSort' },
            { action: 'search', args: { action: 'search', path: '/Notebook/Doc 1', query: 'markdown' }, expectedEndpoint: '/api/export/exportMdContent' },
        ]);
    });

    it('covers every notebook action with a minimal endpoint contract', async () => {
        await runContracts('notebook', NOTEBOOK_VARIANTS, callNotebookTool as ToolCaller, [
            { action: 'list', args: { action: 'list' }, expectedEndpoint: '/api/notebook/lsNotebooks' },
            { action: 'create', args: { action: 'create', name: 'Notebook' }, expectedEndpoint: '/api/notebook/createNotebook' },
            { action: 'set_open_state', args: { action: 'set_open_state', notebook: 'nb-1', opened: true }, expectedEndpoint: '/api/notebook/openNotebook' },
            { action: 'remove', args: { action: 'remove', notebook: 'nb-1' }, expectedEndpoint: '/api/notebook/removeNotebook' },
            { action: 'rename', args: { action: 'rename', notebook: 'nb-1', name: 'Renamed' }, expectedEndpoint: '/api/notebook/renameNotebook' },
            { action: 'get_conf', args: { action: 'get_conf', notebook: 'nb-1' }, expectedEndpoint: '/api/notebook/getNotebookConf' },
            { action: 'set_conf', args: { action: 'set_conf', notebook: 'nb-1', conf: {} }, expectedEndpoint: '/api/notebook/setNotebookConf' },
            { action: 'set_icon', args: { action: 'set_icon', notebook: 'nb-1', icon: '1f4d4' }, expectedEndpoint: '/api/notebook/setNotebookIcon' },
            { action: 'get_permissions', args: { action: 'get_permissions' }, expectedEndpoint: '/api/notebook/lsNotebooks' },
            { action: 'set_permission', args: { action: 'set_permission', notebook: 'nb-1', permission: 'rw' }, expectedEndpoint: '/api/ui/reloadFiletree' },
            { action: 'get_child_docs', args: { action: 'get_child_docs', notebook: 'nb-1' }, expectedEndpoint: '/api/filetree/listDocsByPath' },
        ]);
    });

    it('covers every document action with a minimal endpoint contract', async () => {
        await runContracts('document', DOCUMENT_VARIANTS, callDocumentTool as ToolCaller, [
            { action: 'create', args: { action: 'create', notebook: 'nb-1', path: '/Doc', markdown: 'hello' }, expectedEndpoint: '/api/filetree/createDocWithMd' },
            { action: 'lookup', args: { action: 'lookup', id: 'doc-1' }, expectedEndpoint: '/api/filetree/getPathByID' },
            { action: 'ensure_link_targets', args: { action: 'ensure_link_targets', notebook: 'nb-1', parentId: 'doc-1', mode: 'resolve', targets: [{ key: 'parent', id: 'doc-1' }] }, expectedEndpoint: '/api/filetree/listDocsByPath' },
            { action: 'rename', args: { action: 'rename', id: 'doc-1', title: 'Renamed' }, expectedEndpoint: '/api/filetree/renameDocByID' },
            { action: 'remove', args: { action: 'remove', id: 'doc-1' }, expectedEndpoint: '/api/filetree/removeDocByID' },
            { action: 'move', args: { action: 'move', fromIDs: ['doc-1'], toID: 'doc-parent' }, expectedEndpoint: '/api/filetree/moveDocsByID' },
            { action: 'reorder', args: { action: 'reorder', parentID: 'nb-1', orderedIDs: ['child-2', 'child-1'] }, expectedEndpoint: '/api/filetree/changeSort' },
            { action: 'get_child_blocks', args: { action: 'get_child_blocks', id: 'doc-1' }, expectedEndpoint: '/api/block/getChildBlocks' },
            { action: 'get_child_docs', args: { action: 'get_child_docs', id: 'doc-1' }, expectedEndpoint: '/api/filetree/listDocsByPath' },
            { action: 'set_attr', args: { action: 'set_attr', id: 'doc-1', attrs: { icon: '1f4d4' } }, expectedEndpoint: '/api/transactions' },
            { action: 'list_tree', args: { action: 'list_tree', notebook: 'nb-1', path: '/' }, expectedEndpoint: '/api/filetree/listDocsByPath' },
            { action: 'search_docs', args: { action: 'search_docs', notebook: 'nb-1', query: 'Doc' }, expectedEndpoint: '/api/filetree/searchDocs' },
            { action: 'get_doc', args: { action: 'get_doc', id: 'doc-1', mode: 'html' }, expectedEndpoint: '/api/filetree/getDoc' },
            { action: 'get_outline', args: { action: 'get_outline', id: 'doc-1' }, expectedEndpoint: '/api/outline/getDocOutline' },
            { action: 'create_daily_note', args: { action: 'create_daily_note', notebook: 'nb-1' }, expectedEndpoint: '/api/filetree/createDailyNote' },
            { action: 'duplicate', args: { action: 'duplicate', id: 'doc-1' }, expectedEndpoint: '/api/filetree/duplicateDoc' },
            { action: 'heading_to_doc', args: { action: 'heading_to_doc', headingID: 'doc-1', targetNotebook: 'nb-1' }, expectedEndpoint: '/api/filetree/heading2Doc' },
            { action: 'doc_to_heading', args: { action: 'doc_to_heading', srcID: 'doc-1', targetID: 'doc-2' }, expectedEndpoint: '/api/filetree/doc2Heading' },
        ]);
    });

    it('covers every block action with a minimal endpoint contract', async () => {
        await runContracts('block', BLOCK_VARIANTS, callBlockTool as ToolCaller, [
            { action: 'insert', args: { action: 'insert', dataType: 'markdown', data: 'hello', parentID: 'doc-1' }, expectedEndpoint: '/api/block/insertBlock' },
            { action: 'prepend', args: { action: 'prepend', dataType: 'markdown', data: 'hello', parentID: 'doc-1' }, expectedEndpoint: '/api/block/prependBlock' },
            { action: 'append', args: { action: 'append', dataType: 'markdown', data: 'hello', parentID: 'doc-1' }, expectedEndpoint: '/api/block/appendBlock' },
            { action: 'update', args: { action: 'update', id: 'doc-1', dataType: 'markdown', data: 'updated' }, expectedEndpoint: '/api/block/updateBlock' },
            { action: 'replace', args: { action: 'replace', id: 'doc-1', edit: { old: 'content', new: 'updated' } }, expectedEndpoint: '/api/block/getBlockKramdown' },
            { action: 'delete', args: { action: 'delete', id: 'doc-1' }, expectedEndpoint: '/api/block/deleteBlock' },
            { action: 'move', args: { action: 'move', id: 'doc-1', parentID: 'doc-parent' }, expectedEndpoint: '/api/block/moveBlock' },
            { action: 'set_fold_state', args: { action: 'set_fold_state', id: 'doc-1', folded: true }, expectedEndpoint: '/api/block/foldBlock' },
            { action: 'get_kramdown', args: { action: 'get_kramdown', id: 'doc-1' }, expectedEndpoint: '/api/block/getBlockKramdown' },
            { action: 'batch_kramdown', args: { action: 'batch_kramdown', ids: ['doc-1'] }, expectedEndpoint: '/api/block/getBlockKramdowns' },
            { action: 'get_children', args: { action: 'get_children', id: 'doc-1' }, expectedEndpoint: '/api/block/getChildBlocks' },
            { action: 'transfer_references', args: { action: 'transfer_references', fromID: 'doc-1', toID: 'doc-2' }, expectedEndpoint: '/api/block/transferBlockRef' },
            { action: 'set_attrs', args: { action: 'set_attrs', id: 'doc-1', attrs: { memo: 'note' } }, expectedEndpoint: '/api/transactions' },
            { action: 'get_attrs', args: { action: 'get_attrs', id: 'doc-1' }, expectedEndpoint: '/api/attr/getBlockAttrs' },
            { action: 'info', args: { action: 'info', id: 'doc-1' }, expectedEndpoint: '/api/block/getBlockInfo' },
            { action: 'breadcrumb', args: { action: 'breadcrumb', id: 'doc-1' }, expectedEndpoint: '/api/block/getBlockBreadcrumb' },
            { action: 'dom', args: { action: 'dom', id: 'doc-1' }, expectedEndpoint: '/api/block/getBlockDOM' },
            { action: 'recent_updated', args: { action: 'recent_updated' }, expectedEndpoint: '/api/block/getRecentUpdatedBlocks' },
            { action: 'word_count', args: { action: 'word_count', ids: ['doc-1'] }, expectedEndpoint: '/api/block/getBlocksWordCount' },
            { action: 'add_to_daily_note', args: { action: 'add_to_daily_note', notebook: 'nb-1', dataType: 'markdown', data: 'hello', position: 'append' }, expectedEndpoint: '/api/block/appendDailyNoteBlock' },
            { action: 'docs_info', args: { action: 'docs_info', id: 'doc-1' }, expectedEndpoint: '/api/block/getDocsInfo' },
        ]);
    });

    it('covers every search action with a minimal endpoint contract', async () => {
        await runContracts('search', SEARCH_VARIANTS, callSearchTool as ToolCaller, [
            { action: 'fulltext', args: { action: 'fulltext', query: 'Doc' }, expectedEndpoint: '/api/search/fullTextSearchBlock' },
            { action: 'semantic', args: { action: 'semantic', query: 'meaning' }, expectedEndpoint: '/api/search/semanticSearchBlock' },
            { action: 'query_sql', args: { action: 'query_sql', stmt: 'SELECT * FROM blocks LIMIT 1' }, expectedEndpoint: '/api/query/sql' },
            { action: 'get_backlinks', args: { action: 'get_backlinks', id: 'doc-1' }, expectedEndpoint: '/api/ref/getBacklinkDoc' },
            { action: 'search_refs', args: { action: 'search_refs', id: 'doc-1' }, expectedEndpoint: '/api/search/searchRefBlock' },
            { action: 'find_replace', args: { action: 'find_replace', k: 'old', r: 'new', ids: ['doc-1'] }, expectedEndpoint: '/api/search/findReplace' },
            { action: 'search_assets', args: { action: 'search_assets', k: 'asset' }, expectedEndpoint: '/api/search/searchAsset' },
            { action: 'fulltext_asset_content', args: { action: 'fulltext_asset_content', query: 'asset' }, expectedEndpoint: '/api/search/fullTextSearchAssetContent' },
            { action: 'list_invalid_refs', args: { action: 'list_invalid_refs' }, expectedEndpoint: '/api/search/listInvalidBlockRefs' },
        ]);
    });

    it('covers every file action with a minimal endpoint contract', async () => {
        await runContracts('file', FILE_VARIANTS, callFileTool as ToolCaller, [
            { action: 'upload_asset', args: { action: 'upload_asset', assetsDirPath: '/assets/', localFilePath: 'package.json' }, expectedEndpoint: '/api/asset/upload' },
            { action: 'list_templates', args: { action: 'list_templates', query: 'demo' }, expectedEndpoint: '/api/search/searchTemplate' },
            { action: 'read_template', args: { action: 'read_template', path: 'demo.md' }, expectedEndpoint: '/templates/demo.md' },
            { action: 'create_template', args: { action: 'create_template', path: 'new-template.md', markdown: 'template', overwrite: true }, expectedEndpoint: '/api/file/putFile' },
            { action: 'update_template', args: { action: 'update_template', path: 'demo.md', markdown: 'template' }, expectedEndpoint: '/api/file/putFile' },
            { action: 'delete_template', args: { action: 'delete_template', path: 'demo.md' }, expectedEndpoint: '/api/search/removeTemplate' },
            { action: 'save_doc_as_template', args: { action: 'save_doc_as_template', id: 'doc-1', name: 'demo', overwrite: true }, expectedEndpoint: '/api/template/docSaveAsTemplate' },
            { action: 'render', args: { action: 'render', engine: 'template', id: 'doc-1', path: '/templates/demo.action' }, expectedEndpoint: '/api/template/render' },
            { action: 'export_md', args: { action: 'export_md', id: 'doc-1' }, expectedEndpoint: '/api/export/exportMdContent' },
            { action: 'export_markdown_snapshot', args: { action: 'export_markdown_snapshot', notebookID: 'nb-1', documentIDs: ['doc-1'] }, expectedEndpoint: '/api/export/exportMdContent' },
            { action: 'export_resources', args: { action: 'export_resources', paths: ['assets/demo.png'] }, expectedEndpoint: '/api/export/exportResources' },
            { action: 'list_unused_assets', args: { action: 'list_unused_assets' }, expectedEndpoint: '/api/asset/getUnusedAssets' },
            { action: 'get_doc_assets', args: { action: 'get_doc_assets', id: 'doc-1' }, expectedEndpoint: '/api/asset/getDocAssets' },
            { action: 'audit_image_refs', args: { action: 'audit_image_refs', id: 'doc-1', expectedRefs: ['assets/doc.png'] }, expectedEndpoint: '/api/asset/getDocImageAssets' },
            { action: 'read_image', args: { action: 'read_image', id: 'doc-1', path: 'assets/doc.png' }, expectedEndpoint: '/api/asset/getDocImageAssets' },
            { action: 'get_image_ocr_text', args: { action: 'get_image_ocr_text', path: 'assets/demo.png' }, expectedEndpoint: '/api/asset/getImageOCRText' },
            { action: 'remove_unused_assets', args: { action: 'remove_unused_assets' }, expectedEndpoint: '/api/asset/removeUnusedAssets' },
            { action: 'rename_asset', args: { action: 'rename_asset', oldPath: 'assets/old.png', newName: 'new.png' }, expectedEndpoint: '/api/asset/renameAsset' },
            { action: 'delete_asset', args: { action: 'delete_asset', path: 'assets/old.png' }, expectedEndpoint: '/api/asset/removeUnusedAsset' },
            { action: 'extract_doc', args: { action: 'extract_doc', id: 'doc-1', outputDir: '/tmp/siyuan-contract-extract' }, expectedEndpoint: '/api/export/exportMdContent' },
        ]);
    });

    it('covers every system action with a minimal endpoint contract', async () => {
        await runContracts('system', SYSTEM_VARIANTS, callSystemTool as ToolCaller, [
            { action: 'workspace_info', args: { action: 'workspace_info' }, expectedEndpoint: '/api/system/getWorkspaceInfo' },
            { action: 'network', args: { action: 'network' }, expectedEndpoint: '/api/system/getNetwork' },
            { action: 'conf', args: { action: 'conf' }, expectedEndpoint: '/api/system/getConf' },
            { action: 'notify', args: { action: 'notify', msg: 'hello', level: 'info' }, expectedEndpoint: '/api/notification/pushMsg' },
            { action: 'changelog', args: { action: 'changelog', fromVersion: '0.4.8' } },
            { action: 'perform_sync', args: { action: 'perform_sync' }, expectedEndpoint: '/api/sync/performSync' },
            { action: 'get_version', args: { action: 'get_version' }, expectedEndpoint: '/api/system/version' },
            { action: 'get_current_time', args: { action: 'get_current_time' }, expectedEndpoint: '/api/system/currentTime' },
        ]);
    });

    it('covers every tag action with a minimal endpoint contract', async () => {
        await runContracts('tag', TAG_VARIANTS, callTagTool as ToolCaller, [
            { action: 'list', args: { action: 'list' }, expectedEndpoint: '/api/tag/getTag' },
            { action: 'rename', args: { action: 'rename', oldLabel: 'old', newLabel: 'new' }, expectedEndpoint: '/api/tag/renameTag' },
            { action: 'remove', args: { action: 'remove', label: 'old' }, expectedEndpoint: '/api/tag/removeTag' },
        ]);
    });

    it('keeps feedback action contracts covered separately from SiYuan API endpoints', () => {
        expect(FEEDBACK_VARIANTS.map((variant) => variant.action)).toEqual(['submit']);
        expect(callFeedbackTool).toEqual(expect.any(Function));
    });
});
