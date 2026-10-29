import { describe, expect, it, vi } from 'vitest';

import { buildWriteImpactPreview, type WriteImpactPreview, type WriteImpactPreviewInput } from '@/mcp/write-impact-preview';
import { createMockPermissionManager } from '../../helpers/mock-permissions';

const NB = '20260101000000-nbaaaaa';
const NB2 = '20260101000001-nbbbbbb';
const DOC = '20260102000000-docaaaa';
const DOC2 = '20260102000001-docbbbb';
const B1 = '20260103000000-blocka1';
const B2 = '20260103000001-blocka2';
const B3 = '20260103000002-blocka3';
const H1 = '20260103000003-heading';

interface Fixture {
    rows?: Array<Record<string, unknown>>;
    kramdown?: Record<string, string>;
    children?: Record<string, Array<Record<string, unknown>>>;
    notebooks?: Array<Record<string, unknown>>;
    av?: Record<string, unknown>;
    sql?: (stmt: string) => unknown[] | undefined;
}

function createClient(fixture: Fixture = {}) {
    const rows = fixture.rows ?? [];
    const requestRead = vi.fn(async (endpoint: string, body?: Record<string, any>) => {
        if (endpoint === '/api/notebook/lsNotebooks') {
            return { notebooks: fixture.notebooks ?? [{ id: NB, name: 'Work', closed: false }, { id: NB2, name: 'Archive', closed: false }] };
        }
        if (endpoint === '/api/block/getBlockKramdown') return { id: body?.id, kramdown: fixture.kramdown?.[body?.id] ?? '' };
        if (endpoint === '/api/block/getChildBlocks') return fixture.children?.[body?.id] ?? [];
        if (endpoint === '/api/av/getAttributeView') return { av: fixture.av };
        if (endpoint === '/api/query/sql') {
            const stmt = String(body?.stmt ?? '');
            const custom = fixture.sql?.(stmt);
            if (custom) return custom;
            const ids = [...stmt.matchAll(/'(\d{14}-[a-z0-9]{7})'/g)].map((match) => match[1]);
            if (/^SELECT id, type/.test(stmt)) return rows.filter((row) => ids.includes(String(row.id)));
            return [];
        }
        return null;
    });
    return { requestRead, requestWrite: vi.fn(async () => { throw new Error('preview must not write'); }) } as any;
}

function permissions() {
    const permMgr = createMockPermissionManager();
    permMgr.getAll = vi.fn(() => ({ [NB]: 'rwd', [NB2]: 'rw' }));
    return permMgr;
}

async function preview(input: Partial<WriteImpactPreviewInput> & Pick<WriteImpactPreviewInput, 'category' | 'action' | 'args'>, fixture: Fixture = {}): Promise<WriteImpactPreview> {
    const client = input.client ?? createClient(fixture);
    const result = await buildWriteImpactPreview({ client, permMgr: permissions(), ...input });
    if ('error' in result) throw new Error(`unexpected preview error: ${result.error}`);
    expect(client.requestWrite).not.toHaveBeenCalled();
    return result;
}

const docRow = (id: string, title: string, hpath: string, box = NB, path = `/${id}.sy`) => ({ id, type: 'd', content: title, hpath, box, root_id: id, parent_id: '', path });
const blockRow = (id: string, content: string, parent = DOC, box = NB) => ({ id, type: 'p', content, hpath: '/Plans', box, root_id: DOC, parent_id: parent, path: `/${DOC}.sy` });

describe('write impact preview', () => {
    it('block.update shows before/after text and the user attributes the update restores', async () => {
        const result = await preview({
            category: 'block', action: 'update',
            args: { action: 'update', id: B1, dataType: 'markdown', data: 'New text', validateOnly: true },
            before: { hash: 'h', targetIds: [B1], summary: {}, state: { liveBlocks: { [B1]: {
                kramdown: { id: B1, kramdown: 'Old **text**\n{: id="20260103000000-blocka1" custom-status="done" name="alpha"}' },
                attrs: { id: B1, 'custom-status': 'done', name: 'alpha', updated: '1' },
            } } } },
        }, { rows: [blockRow(B1, 'Old text'), docRow(DOC, 'Plans', '/Plans')] });

        expect(result.changes[0]).toMatchObject({
            kind: 'content_update',
            id: B1,
            before: 'Old **text**',
            after: 'New text',
            userAttributes: ['custom-status', 'name'],
            attributesRestored: true,
        });
        expect(result.changes[0].summary).toContain('custom-status, name are kept');
        expect(result.targets[0]).toMatchObject({ id: B1, kind: 'block', excerpt: 'Old text', hPath: '/Plans', notebook: { id: NB, name: 'Work', permission: 'rwd' } });
        expect(result.risk).toEqual(['overwrites_content']);
    });

    it('block.update says DOM input does not restore attributes and truncates only in summary detail', async () => {
        const long = 'x'.repeat(500);
        const state = { liveBlocks: { [B1]: { kramdown: { kramdown: `${long}\n{: id="${B1}"}` }, attrs: { bookmark: '★' } } } };
        const args = { action: 'update', id: B1, dataType: 'dom', data: `<div>${long}</div>` };
        const summary = await preview({ category: 'block', action: 'update', args, before: { hash: 'h', targetIds: [B1], summary: {}, state } });
        expect(summary.detail).toBe('summary');
        expect(String(summary.changes[0].before)).toHaveLength(200);
        expect(summary.changes[0]).toMatchObject({ attributesRestored: false, userAttributes: ['bookmark'] });
        expect(summary.changes[0].summary).toContain('not restored');

        const full = await preview({ category: 'block', action: 'update', args: { ...args, preview: 'full' }, before: { hash: 'h', targetIds: [B1], summary: {}, state } });
        expect(full.detail).toBe('full');
        expect(full.changes[0].before).toBe(long);
        expect(full.changes[0].after).toBe(long);
    });

    it('block.replace applies the edits read-only and warns about an edit that will not match', async () => {
        const result = await preview({
            category: 'block', action: 'replace',
            args: { action: 'replace', id: B1, edit: [{ old: 'cat', new: 'dog', replace_all: true }, { old: 'missing', new: 'x' }] },
            before: { hash: 'h', targetIds: [B1], summary: {}, state: { liveBlocks: { [B1]: { kramdown: { kramdown: `a cat and a cat\n{: id="${B1}"}` } } } } },
        });
        expect(result.changes[0]).toMatchObject({ kind: 'content_replace', before: 'a cat and a cat', after: 'a dog and a dog' });
        expect(result.changes[0].summary).toContain('Edit #2 does not match');
        expect((result.changes[0].edits as any[])[0]).toMatchObject({ occurrences: 2, replaced: 2 });
    });

    it('fs.write overwrite compares the current body with the new one and flags an emptied document', async () => {
        const result = await preview({
            category: 'fs', action: 'write',
            args: { action: 'write', path: '/Work/Plans', markdown: '', overwrite: true },
            before: { hash: 'h', targetIds: [], summary: {}, state: { fsPaths: { '/Work/Plans': { notebookID: NB, hpath: '/Plans', rootID: DOC, blocks: [{ id: B1 }, { id: B2 }], markdown: 'First\n\nSecond' } } } },
        }, { rows: [docRow(DOC, 'Plans', '/Plans')] });
        expect(result.changes[0]).toMatchObject({ kind: 'content_overwrite', before: 'First Second', after: '' });
        expect(result.changes[0].summary).toContain('(2 blocks now)');
        expect(result.risk).toEqual(['empties_source', 'overwrites_content']);
        expect(result.targets[0]).toMatchObject({ id: DOC, kind: 'document', title: 'Plans' });
    });

    it('fs.replace shows each edit with match context', async () => {
        const result = await preview({
            category: 'fs', action: 'replace',
            args: { action: 'replace', path: '/Work/Plans', edit: { old: 'Q1', new: 'Q2' } },
            before: { hash: 'h', targetIds: [], summary: {}, state: { fsPaths: { '/Work/Plans': { rootID: DOC, markdown: 'Goals for Q1.\n\nReview Q1.' } } } },
        });
        const edit = (result.changes[0].edits as any[])[0];
        expect(edit).toMatchObject({ occurrences: 2, replaced: 1 });
        expect(edit.examples[0]).toEqual({ before: 'Goals for Q1. Review Q1.', after: 'Goals for Q2. Review Q1.' });
        expect(result.changes[0]).not.toHaveProperty('after');
    });

    it('block.delete reports the block and its children', async () => {
        const result = await preview({
            category: 'block', action: 'delete', args: { action: 'delete', id: B1 },
            before: { hash: 'h', targetIds: [B1], summary: {}, state: { liveBlocks: { [B1]: { kramdown: { kramdown: `> quoted\n{: id="${B1}"}` }, children: [{ id: B2 }, { id: B3 }] } } } },
        }, { rows: [{ ...blockRow(B1, 'quoted'), type: 'b' }] });
        expect(result.changes[0]).toMatchObject({ kind: 'delete', childBlockCount: 2 });
        expect(result.changes[0].summary).toContain('Deletes b block');
        expect(result.changes[0].summary).toContain('Work:/Plans');
        expect(result.risk).toEqual(['deletes']);
    });

    it('document.remove counts blocks and child documents', async () => {
        const result = await preview({ category: 'document', action: 'remove', args: { action: 'remove', id: DOC } }, {
            rows: [docRow(DOC, 'Plans', '/Plans')],
            sql: (stmt) => stmt.includes('GROUP BY root_id') ? [{ root_id: DOC, n: 12 }]
                : stmt.includes('COUNT(*) AS n FROM blocks WHERE type') ? [{ n: 3 }] : undefined,
        });
        expect(result.changes[0]).toMatchObject({ kind: 'delete', title: 'Plans', blockCount: 12, childDocumentCount: 3 });
        expect(result.changes[0].summary).toBe('Removes document «Plans» at Work:/Plans (11 content blocks) and its 3 child document(s).');
        expect(result.risk).toEqual(['deletes']);
    });

    it('fs.rm uses the probed document', async () => {
        const result = await preview({
            category: 'fs', action: 'rm', args: { action: 'rm', path: '/Work/Plans' },
            before: { hash: 'h', targetIds: [], summary: {}, state: { fsPaths: { '/Work/Plans': { notebookID: NB, rootID: DOC, blocks: [{ id: B1 }] } } } },
        }, { rows: [docRow(DOC, 'Plans', '/Plans')], sql: (stmt) => stmt.includes('COUNT(*) AS n FROM blocks WHERE type') ? [{ n: 0 }] : undefined });
        expect(result.changes[0].summary).toBe('Removes document /Work/Plans (1 content block).');
        expect(result.risk).toContain('deletes');
    });

    it('block.move describes from and to, and flags a cross-notebook move', async () => {
        const result = await preview({
            category: 'block', action: 'move', args: { action: 'move', id: B2, parentID: DOC2 },
            before: { hash: 'h', targetIds: [], summary: {}, state: { siblingOrder: { [DOC]: [B1, B2] } } },
        }, { rows: [blockRow(B1, 'First'), blockRow(B2, 'Second'), docRow(DOC, 'Plans', '/Plans'), docRow(DOC2, 'Old', '/Old', NB2)] });
        expect(result.changes[0]).toMatchObject({
            kind: 'move',
            from: 'Work:/Plans, after «First»',
            to: 'Archive:/Old, first inside document «Old»',
        });
        expect(result.risk).toEqual(['cross_notebook']);
    });

    it('document.move shows the destination path and moved child documents', async () => {
        const result = await preview({ category: 'document', action: 'move', args: { action: 'move', fromIDs: [DOC], toID: NB2 } }, {
            rows: [docRow(DOC, 'Plans', '/Plans')],
            sql: (stmt) => stmt.includes('COUNT(*) AS n FROM blocks WHERE type') ? [{ n: 2 }] : undefined,
        });
        expect(result.changes[0]).toMatchObject({ kind: 'move', from: 'Work:/Plans', to: 'Archive:/Plans' });
        expect(result.changes[0].summary).toContain('with its 2 child document(s)');
        expect(result.risk).toEqual(['cross_notebook']);
    });

    it('fs.mv reports both paths', async () => {
        const result = await preview({
            category: 'fs', action: 'mv', args: { action: 'mv', from: '/Work/Plans', to: '/Work/Done/Plans' },
            before: { hash: 'h', targetIds: [], summary: {}, state: { fsPaths: { '/Work/Plans': { notebookID: NB, rootID: DOC } } } },
        }, { rows: [docRow(DOC, 'Plans', '/Plans')] });
        expect(result.changes[0]).toMatchObject({ kind: 'move', from: '/Work/Plans', to: '/Work/Done/Plans' });
        expect(result.risk).toEqual([]);
    });

    it.each(['document', 'fs'] as const)('%s.reorder lists the old and new order by title', async (category) => {
        const children = [
            { id: B1, hPath: '/Plans/Alpha' },
            { id: B2, hPath: '/Plans/Beta' },
            { id: B3, hPath: '/Plans/Gamma' },
        ];
        const result = await preview({
            category, action: 'reorder', args: { action: 'reorder' },
            before: { hash: 'h', targetIds: [], summary: {}, state: { reorder: { notebook: NB, parentID: DOC, children, requestedIDs: [B3, B1, B2] } } },
        }, { rows: [docRow(DOC, 'Plans', '/Plans')] });
        expect(result.changes[0]).toMatchObject({
            kind: 'reorder',
            before: ['Alpha', 'Beta', 'Gamma'],
            after: ['Gamma', 'Alpha', 'Beta'],
            moves: [{ title: 'Gamma', from: 3, to: 1 }, { title: 'Alpha', from: 1, to: 2 }, { title: 'Beta', from: 2, to: 3 }],
        });
    });

    const conversion = (targetPath = '/', previousPath = '', targetNotebook = NB) => ({
        source: { id: H1, notebook: NB, path: `/${DOC}.sy`, documentId: DOC },
        target: { notebook: targetNotebook, path: targetPath, documentId: targetPath === '/' ? '' : DOC2, id: targetPath === '/' ? '' : DOC2 },
        targetPath,
        previousPath,
    });

    it('document.heading_to_doc counts moved blocks and flags an emptied source', async () => {
        const result = await preview({
            category: 'document', action: 'heading_to_doc',
            args: { action: 'heading_to_doc', headingID: H1, targetNotebook: NB },
            conversion: conversion(),
        }, {
            rows: [docRow(DOC, 'Meeting', '/Meeting')],
            kramdown: { [H1]: `## Action items\n{: id="${H1}"}` },
            children: { [H1]: [{ id: B1 }, { id: B2 }], [DOC]: [{ id: H1 }, { id: B1 }, { id: B2 }] },
        });
        expect(result.changes[0]).toMatchObject({
            kind: 'heading_to_doc',
            movedBlockCount: 3,
            newDocument: { title: 'Action items', hPath: '/Action items', placement: 'at the notebook root', notebook: { id: NB, name: 'Work' } },
            source: { id: DOC, title: 'Meeting', topLevelBlocksBefore: 3, topLevelBlocksAfter: 0, becomesEmpty: true },
        });
        expect(result.changes[0].summary).toContain('The source document becomes EMPTY.');
        expect(result.risk).toEqual(['empties_source']);
    });

    it('document.heading_to_doc under a parent document keeps the rest of the source', async () => {
        const result = await preview({
            category: 'document', action: 'heading_to_doc',
            args: { action: 'heading_to_doc', headingID: H1, targetNotebook: NB2, targetPath: `/${DOC2}.sy` },
            conversion: conversion(`/${DOC2}.sy`, '', NB2),
        }, {
            rows: [docRow(DOC, 'Meeting', '/Meeting'), docRow(DOC2, 'Projects', '/Projects', NB2)],
            kramdown: { [H1]: `# Notes\n{: id="${H1}"}` },
            children: { [H1]: [{ id: B1 }], [DOC]: [{ id: B3 }, { id: H1 }, { id: B1 }] },
        });
        expect(result.changes[0]).toMatchObject({
            movedBlockCount: 2,
            newDocument: { title: 'Notes', hPath: '/Projects/Notes', notebook: { id: NB2, name: 'Archive' } },
            source: { topLevelBlocksAfter: 1, becomesEmpty: false },
        });
        expect(result.risk).toEqual(['cross_notebook']);
    });

    it('document.doc_to_heading names both documents and their block counts', async () => {
        const result = await preview({
            category: 'document', action: 'doc_to_heading',
            args: { action: 'doc_to_heading', srcID: DOC, targetID: H1, after: true },
            conversion: { source: { id: DOC, notebook: NB, path: `/${DOC}.sy`, documentId: DOC }, target: { id: H1, notebook: NB, path: `/${DOC2}.sy`, documentId: DOC2 }, targetPath: `/${DOC2}.sy`, previousPath: '' },
        }, {
            rows: [docRow(DOC, 'Draft', '/Draft'), docRow(DOC2, 'Report', '/Report')],
            kramdown: { [H1]: `## Appendix\n{: id="${H1}"}` },
            children: { [DOC]: [{ id: B1 }, { id: B2 }], [DOC2]: [{ id: H1 }, { id: B3 }] },
        });
        expect(result.changes[0]).toMatchObject({
            kind: 'doc_to_heading',
            source: { id: DOC, title: 'Draft', topLevelBlocks: 2 },
            target: { id: DOC2, title: 'Report', topLevelBlocksBefore: 2, position: 'after' },
        });
        expect(result.changes[0].summary).toContain('after heading «Appendix»');
        expect(result.risk).toEqual(['deletes']);
    });

    it('search.find_replace counts matches with IALs stripped and gives examples', async () => {
        const kramdown = `Alpha beta alpha\n{: id="${B1}" custom-alpha="alpha"}\n\nNo match here\n{: id="${B2}"}\n\nalpha again\n{: id="${B3}"}\n\n{: id="${DOC}" title="alpha"}`;
        const result = await preview({
            category: 'search', action: 'find_replace',
            args: { action: 'find_replace', k: 'alpha', r: 'omega', ids: [DOC] },
        }, { kramdown: { [DOC]: kramdown } });
        expect(result.changes[0]).toMatchObject({ kind: 'find_replace', matchCount: 2, affectedBlockCount: 2 });
        expect(result.changes[0].examples).toEqual([
            { blockID: B1, before: 'Alpha beta alpha', after: 'Alpha beta omega' },
            { blockID: B3, before: 'alpha again', after: 'omega again' },
        ]);
        expect(result.risk).toEqual(['irreversible', 'overwrites_content']);
    });

    it('search.find_replace caps examples at five in summary detail and flags a large batch', async () => {
        const blocks = Array.from({ length: 25 }, (_, index) => `foo ${index}\n{: id="20260103${String(index).padStart(6, '0')}-blockxx"}`).join('\n\n');
        const result = await preview({ category: 'search', action: 'find_replace', args: { action: 'find_replace', k: 'foo', r: 'bar', ids: [DOC] } }, { kramdown: { [DOC]: blocks } });
        expect(result.changes[0]).toMatchObject({ matchCount: 25, affectedBlockCount: 25, examplesOmitted: 20 });
        expect(result.changes[0].examples).toHaveLength(5);
        expect(result.changes[0].summary).toContain('Showing 5 of 25 match(es) (5 of 25 block(s)); preview="full" lists all.');
        expect(result.risk).toContain('large_batch');
        const full = await preview({ category: 'search', action: 'find_replace', args: { action: 'find_replace', k: 'foo', r: 'bar', ids: [DOC], preview: 'full' } }, { kramdown: { [DOC]: blocks } });
        expect(full.changes[0].examples).toHaveLength(25);
        expect(full.changes[0].examplesOmitted).toBeUndefined();
        expect(full.changes[0].summary).not.toContain('Showing');
    });

    it('search.find_replace full detail still stops at a hard cap and says so', async () => {
        const blocks = Array.from({ length: 205 }, (_, index) => `foo ${index}\n{: id="20260103${String(index).padStart(6, '0')}-blockxx"}`).join('\n\n');
        const result = await preview({ category: 'search', action: 'find_replace', args: { action: 'find_replace', k: 'foo', r: 'bar', ids: [DOC], preview: 'full' } }, { kramdown: { [DOC]: blocks } });
        expect(result.changes[0].examples).toHaveLength(200);
        expect(result.changes[0]).toMatchObject({ examplesOmitted: 5 });
        expect(result.changes[0].summary).toContain('a full preview lists at most 200');
    });

    it('search.find_replace without matches says nothing will change and raises no risk', async () => {
        const result = await preview({ category: 'search', action: 'find_replace', args: { action: 'find_replace', k: 'zzz', r: 'y', ids: [DOC] } }, { kramdown: { [DOC]: `text\n{: id="${B1}"}` } });
        expect(result.changes[0]).toMatchObject({ matchCount: 0, affectedBlockCount: 0, examples: [] });
        expect(result.changes[0].summary).toContain('the commit would change nothing');
        expect(result.risk).toEqual([]);
    });

    it('tag.rename counts carriers, reports a merge and closed notebooks', async () => {
        const result = await preview({ category: 'tag', action: 'rename', args: { action: 'rename', oldLabel: 'todo', newLabel: 'done' } }, {
            notebooks: [{ id: NB, name: 'Work', closed: false }, { id: NB2, name: 'Archive', closed: true }],
            rows: [blockRow(B1, 'Buy milk #todo#')],
            sql: (stmt) => stmt.includes("content = 'todo'") ? [{ box: NB, block_id: B1 }, { box: NB, block_id: B2 }]
                : stmt.includes("content = 'done'") ? [{ box: NB, block_id: B3 }] : undefined,
        });
        expect(result.changes[0]).toMatchObject({ kind: 'tag_rename', blockCount: 2, notebookCount: 1, closedNotebooksSkipped: ['Archive'] });
        expect(result.changes[0].summary).toContain('#done# already exists on 1 block(s)');
        expect(result.targets[0]).toEqual({ id: 'todo', kind: 'tag', title: '#todo#' });
        expect(result.risk).toEqual(['irreversible', 'workspace_wide']);
    });

    it('tag.rename lists closed notebooks without read access apart from merely closed ones', async () => {
        const NB3 = '20260101000002-nbccccc';
        const permMgr = createMockPermissionManager();
        permMgr.getAll = vi.fn(() => ({ [NB]: 'rwd', [NB2]: 'rw', [NB3]: 'none' }));
        const result = await preview({ category: 'tag', action: 'rename', permMgr, args: { action: 'rename', oldLabel: 'todo', newLabel: 'done' } }, {
            notebooks: [{ id: NB, name: 'Work', closed: false }, { id: NB2, name: 'Archive', closed: true }, { id: NB3, name: 'Private', closed: true }],
            sql: (stmt) => stmt.includes("content = 'todo'") ? [{ box: NB, block_id: B1 }] : undefined,
        });
        expect(result.changes[0]).toMatchObject({ closedNotebooksSkipped: ['Archive'], closedUnreadableNotebooksSkipped: ['Private'] });
        expect(result.changes[0].summary).toContain('SiYuan skips closed notebooks (Archive). Closed notebook(s) without read access (Private) are skipped too.');
    });

    it('tag.remove reports the blocks that lose the tag', async () => {
        const result = await preview({ category: 'tag', action: 'remove', args: { action: 'remove', label: '#todo#' } }, {
            sql: (stmt) => stmt.includes('FROM spans') ? [{ box: NB, block_id: B1 }] : undefined,
        });
        expect(result.changes[0].summary).toContain('Removes the tag #todo# (and its sub-tags) from 1 block(s)');
        expect(result.risk).toEqual(['deletes', 'irreversible', 'workspace_wide']);
    });

    const AV = '20260104000000-avaaaaa';
    const ROW1 = '20260104000001-rowaaaa';
    const ROW2 = '20260104000002-rowbbbb';
    const avDefinition = {
        id: AV,
        name: 'Tasks',
        keyValues: [
            { key: { id: 'k-name', name: 'Name', type: 'block' }, values: [
                { blockID: ROW1, block: { id: B1, content: 'Write report' } },
                { blockID: ROW2, block: { id: B2, content: 'Ship release' } },
            ] },
            { key: { id: 'k-status', name: 'Status', type: 'select' }, values: [
                { blockID: ROW1, type: 'select', mSelect: [{ content: 'Doing' }] },
            ] },
        ],
    };

    it('av.remove_rows names the rows', async () => {
        const result = await preview({
            category: 'av', action: 'remove_rows', args: { action: 'remove_rows', avID: AV, rowIDs: [ROW1, ROW2] },
            before: { hash: 'h', targetIds: [], summary: {}, state: { av: { av: avDefinition } } },
        });
        expect(result.changes[0]).toMatchObject({ kind: 'av_remove_rows', rows: [{ id: ROW1, title: 'Write report' }, { id: ROW2, title: 'Ship release' }] });
        expect(result.targets[0]).toEqual({ id: AV, kind: 'av', title: 'Tasks' });
        expect(result.risk).toEqual(['deletes', 'irreversible']);
    });

    it('av.remove_column counts the values that disappear', async () => {
        const result = await preview({
            category: 'av', action: 'remove_column', args: { action: 'remove_column', avID: AV, keyID: 'k-status' },
            before: { hash: 'h', targetIds: [], summary: {}, state: { av: { av: avDefinition } } },
        });
        expect(result.changes[0]).toMatchObject({ kind: 'av_remove_column', column: { id: 'k-status', name: 'Status', type: 'select' }, nonEmptyValueCount: 1, values: [{ row: 'Write report', value: 'Doing' }] });
    });

    it('av.set_cells shows current and next values', async () => {
        const result = await preview({
            category: 'av', action: 'set_cells',
            args: { action: 'set_cells', avID: AV, cells: [
                { rowID: ROW1, columnID: 'k-status', valueType: 'select', option: 'Done' },
                { rowID: ROW2, columnID: 'k-status', valueType: 'select', option: 'Todo' },
            ] },
        }, { av: avDefinition });
        expect(result.changes[0].cells).toEqual([
            { row: 'Write report', rowID: ROW1, column: 'Status', columnID: 'k-status', current: 'Doing', next: 'Done' },
            { row: 'Ship release', rowID: ROW2, column: 'Status', columnID: 'k-status', current: '', next: 'Todo' },
        ]);
        expect(result.changes[0].summary).toBe('Sets 2 cell(s) in 2 row(s); 1 currently hold a value that will be replaced.');
        expect(result.risk).toEqual(['overwrites_content']);
    });

    it('av.remove_rows counts the non-empty cells that are lost', async () => {
        const result = await preview({
            category: 'av', action: 'remove_rows', args: { action: 'remove_rows', avID: AV, rowIDs: [ROW1] },
        }, { av: avDefinition });
        expect(result.changes[0]).toMatchObject({ lostCellCount: 1 });
        expect(result.changes[0].summary).toContain('Removes 1 row(s) and their 1 non-empty cell value(s)');
    });

    it('av.rename shows database and column names old → new and labels the column, not a block', async () => {
        const result = await preview({
            category: 'av', action: 'rename', args: { action: 'rename', avID: AV, name: 'Projects', keyID: 'k-name', keyName: 'Task' },
        }, { av: avDefinition });
        expect(result.changes[0]).toMatchObject({ kind: 'av_rename', before: 'Tasks', after: 'Projects' });
        expect(result.changes[0].summary).toBe('Renames the database «Tasks» → «Projects».');
        expect(result.changes[1]).toMatchObject({ kind: 'av_rename_column', columns: [{ id: 'k-name', before: 'Name', after: 'Task' }] });
        expect(result.changes[1].summary).toContain('Renames column «Name» (block, primary key) → «Task».');
        expect(result.targets).toEqual([{ id: AV, kind: 'av', title: 'Tasks' }]);
    });

    it('av.add_column names the new column and its type', async () => {
        const result = await preview({
            category: 'av', action: 'add_column', args: { action: 'add_column', avID: AV, keyName: 'Hours', keyType: 'number', previousKeyID: 'k-status' },
        }, { av: avDefinition });
        expect(result.changes[0]).toMatchObject({ kind: 'av_add_column', column: { name: 'Hours', type: 'number' } });
        expect(result.changes[0].summary).toContain('Adds column «Hours» (number) after column «Status»');
        expect(result.changes[0].summary).toContain('2 row(s)');
    });

    it('av.add_rows lists each row with its primary text and cell values', async () => {
        const result = await preview({
            category: 'av', action: 'add_rows', args: { action: 'add_rows', avID: AV, rows: [
                { clientKey: 'a', primaryKeyText: 'Plan', cells: [{ columnID: 'k-status', valueType: 'select', option: 'Todo' }] },
                { clientKey: 'b', primaryKeyText: 'Review' },
            ] },
        }, { av: avDefinition });
        expect(result.changes[0]).toMatchObject({
            kind: 'av_add_rows',
            rowCount: 2,
            rows: [{ row: 'Plan', cells: 'Status = Todo' }, { row: 'Review' }],
        });
        expect(result.changes[0].summary).toBe('Adds 2 detached row(s) with 1 cell value(s); the database grows from 2 to 4 row(s).');
    });

    it('other av actions name the database instead of a bare block id', async () => {
        const result = await preview({
            category: 'av', action: 'update_view', args: { action: 'update_view', avID: AV, viewID: 'v1' },
        }, { av: avDefinition });
        expect(result.targets).toEqual([{ id: AV, kind: 'av', title: 'Tasks' }]);
        expect(result.changes[0].summary).toBe('av.update_view will modify database «Tasks».');
    });

    it('block.append counts the top-level blocks the Markdown creates', async () => {
        const result = await preview({
            category: 'block', action: 'append',
            args: { action: 'append', parentID: DOC, dataType: 'markdown', data: '## Heading\nFirst para\n\nSecond para\n\n- a\n- b\n\n  continued\n\n```js\nx\n\ny\n```' },
        }, { rows: [docRow(DOC, 'Plans', '/Plans')] });
        expect(result.changes[0]).toMatchObject({ kind: 'create_blocks', blockCount: 5 });
        expect(result.changes[0].blocks).toEqual(['## Heading', 'First para', 'Second para', '- a - b continued', '```js x y ```']);
        expect(result.changes[0].summary).toContain('Creates 5 top-level block(s) at the end of document «Plans» in Work:/Plans');
    });

    it('block targets show their position among siblings and the preceding heading', async () => {
        const result = await preview({
            category: 'block', action: 'delete', args: { action: 'delete', id: B2 },
        }, {
            rows: [blockRow(B2, 'Second'), docRow(DOC, 'Plans', '/Plans')],
            children: { [DOC]: [{ id: B1, type: 'p', content: 'First' }, { id: H1, type: 'h', content: 'Risks' }, { id: B2, type: 'p', content: 'Second' }, { id: B3, type: 'p', content: 'Third' }] },
        });
        expect(result.targets[0].position).toBe('#3 of 4 top-level blocks in «Plans», under heading «Risks»');
    });

    it('block position uses the flat document list even when the index parents the block to a heading', async () => {
        const result = await preview({
            category: 'block', action: 'delete', args: { action: 'delete', id: B2 },
        }, {
            rows: [{ ...blockRow(B2, 'Second'), parent_id: H1 }, docRow(DOC, 'Plans', '/Plans')],
            children: {
                [DOC]: [{ id: H1, type: 'h', content: 'Risks' }, { id: B1, type: 'p', content: 'First' }, { id: B2, type: 'p', content: 'Second' }],
                [H1]: [{ id: B1, type: 'p' }, { id: B2, type: 'p' }],
            },
        });
        expect(result.targets[0].position).toBe('#3 of 3 top-level blocks in «Plans», under heading «Risks»');
    });

    it('block.set_attrs lists every key with current → next and flags replaced values', async () => {
        const result = await preview({
            category: 'block', action: 'set_attrs', args: { action: 'set_attrs', id: B1, attrs: { 'custom-status': 'done', 'custom-owner': '', 'custom-new': 'x' } },
            before: { hash: 'h', targetIds: [B1], summary: {}, state: { liveBlocks: { [B1]: { attrs: { id: B1, 'custom-status': 'todo', 'custom-owner': 'amy' } } } } },
        }, { rows: [blockRow(B1, 'Old text')] });
        expect(result.changes[0].attrs).toEqual([
            { key: 'custom-new', current: '(none)', next: 'x', status: 'added' },
            { key: 'custom-owner', current: 'amy', next: '(removed)', status: 'removed' },
            { key: 'custom-status', current: 'todo', next: 'done', status: 'replaced' },
        ]);
        expect(result.changes[0].summary).toContain('1 added, 1 replaced, 1 removed');
        expect(result.risk).toEqual(['overwrites_content']);
    });

    it('document.create shows the resolved final hPath and the body blocks', async () => {
        const result = await preview({
            category: 'document', action: 'create', args: { action: 'create', notebook: NB, parentPath: '/Plans', title: 'Draft', markdown: 'One\n\nTwo' },
        });
        expect(result.changes[0]).toMatchObject({ kind: 'create_document', hPath: '/Plans/Draft' });
        expect(result.changes[0].summary).toBe('Creates document «Draft» at Work:/Plans/Draft.');
        expect(result.changes[1]).toMatchObject({ kind: 'create_blocks', blockCount: 2 });
        expect(result.targets[1]).toMatchObject({ id: '/Plans/Draft', kind: 'path' });
    });

    it('timeline.create_node names the document and the snapshot', async () => {
        const result = await preview({
            category: 'timeline', action: 'create_node', args: { action: 'create_node', scope: 'document', documentId: DOC, name: 'Before edit' },
        }, { rows: [docRow(DOC, 'Plans', '/Plans')] });
        expect(result.changes[0].summary).toBe('Creates timeline snapshot «Before edit» of document «Plans» at Work:/Plans. Nothing in the document changes.');
        expect(result.targets[0]).toMatchObject({ id: DOC, kind: 'document', title: 'Plans' });
    });

    it('create-like generic actions say "will create"', async () => {
        const result = await preview({ category: 'flashcard', action: 'add_card', args: { action: 'add_card', blockIDs: [B1] } }, { rows: [blockRow(B1, 'Card')] });
        expect(result.changes[0].summary).toContain('flashcard.add_card will create content in «Card»');
    });

    it('falls back to a generic summary with the key arguments', async () => {
        const result = await preview({ category: 'document', action: 'set_attr', args: { action: 'set_attr', id: DOC, attrs: { icon: '1f4d4' }, validateOnly: true, requestId: 'abcd' } }, {
            rows: [docRow(DOC, 'Plans', '/Plans')],
        });
        expect(result.changes).toEqual([{
            kind: 'generic',
            summary: 'document.set_attr will modify document «Plans».',
            args: { id: DOC, attrs: { icon: '1f4d4' } },
        }]);
        expect(result.targets).toEqual([{ id: DOC, kind: 'document', title: 'Plans', hPath: '/Plans', notebook: { id: NB, name: 'Work', permission: 'rwd' } }]);
        expect(result.risk).toEqual([]);
    });

    it('av.create says what the new database will contain', async () => {
        const result = await preview({ category: 'av', action: 'create', args: { action: 'create', parentID: DOC } }, { rows: [docRow(DOC, 'Plans', '/Plans')] });
        expect(result.changes[0].kind).toBe('create_database');
        expect(result.changes[0].summary).toContain('Inserts a new database block (table view, 0 rows) into document «Plans»');
        expect(result.changes[0].summary).toContain('default single-select column');
        expect(result.changes[0].summary).toContain('removeDefaultColumn');
        expect(result.changes[0].summary).toContain('as its first block');
        expect(result.changes[0]).toMatchObject({ position: { first: true } });
    });

    it('av.create names the block the database is appended after', async () => {
        const result = await preview({ category: 'av', action: 'create', args: { action: 'create', parentID: DOC } }, {
            rows: [docRow(DOC, 'Plans', '/Plans')],
            children: { [DOC]: [{ id: B1, type: 'p', content: 'First' }, { id: B2, type: 'p', content: 'Last paragraph' }] },
        });
        expect(result.changes[0].summary).toContain(`into document «Plans», at the end, appended after «Last paragraph» (${B2})`);
        expect(result.changes[0]).toMatchObject({ position: { appendedAfter: B2 } });
    });

    it('document.duplicate names the copy and where it lands', async () => {
        const result = await preview({ category: 'document', action: 'duplicate', args: { action: 'duplicate', id: DOC } }, {
            rows: [docRow(DOC, 'Plans', '/Work/Plans')],
            sql: (stmt) => stmt.includes('GROUP BY root_id') ? [{ root_id: DOC, n: 3 }] : undefined,
        });
        expect(result.changes[0]).toMatchObject({ kind: 'duplicate_document', newTitle: 'Plans (Duplicated <date time>)', destination: '/Work' });
        expect(result.changes[0].summary).toContain('Duplicates document «Plans» (2 content blocks) as a new sibling in Work:/Work');
    });

    it('document.rename, notebook.rename and block.set_fold_state have specific summaries', async () => {
        const renamed = await preview({ category: 'document', action: 'rename', args: { action: 'rename', id: DOC, title: 'New name' } }, { rows: [docRow(DOC, 'Plans', '/Plans')] });
        expect(renamed.changes[0]).toMatchObject({ kind: 'rename_document', from: 'Plans', to: 'New name' });
        const notebook = await preview({ category: 'notebook', action: 'rename', args: { action: 'rename', notebook: NB, name: 'Office' } });
        expect(notebook.changes[0].summary).toBe('Renames notebook «Work» to «Office». Its ID, documents and permission stay.');
        const folded = await preview({ category: 'block', action: 'set_fold_state', args: { action: 'set_fold_state', id: B1, folded: true } }, { rows: [blockRow(B1, 'Heading')], children: { [B1]: [{ id: B2 }] } });
        expect(folded.changes[0].summary).toBe('Folds «Heading» (1 child block(s) hidden). Content does not change.');
    });

    it('never fails: a read error becomes { error }', async () => {
        const state: Record<string, unknown> = {};
        Object.defineProperty(state, 'liveBlocks', { get() { throw new Error('probe state unreadable'); } });
        const result = await buildWriteImpactPreview({
            client: createClient(), permMgr: permissions(), category: 'block', action: 'update',
            args: { action: 'update', id: B1, dataType: 'markdown', data: 'x' },
            before: { hash: 'h', targetIds: [], summary: {}, state },
        });
        expect(result).toEqual({ error: 'probe state unreadable' });
    });
});
