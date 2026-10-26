import { describe, expect, it, vi } from 'vitest';
import { HttpSiYuanClient } from '@/api/client';
import { deleteTemplate, saveDocAsTemplate, writeTemplateSource } from '@/api/template';
import { WriteSafetyCoordinator } from '@/core/write-safety-coordinator';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';

// Keep the real HTTP client: a stubbed requestResource used to conceal the
// premature 404 exception that broke both new-template preflight and deletion.
function fixture() {
    const files = new Map<string, string>();
    const writes: string[] = [];
    let resourceStatus: number | undefined;
    const sourceID = '20261019000000-doc0001';
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
        const endpoint = new URL(url).pathname;
        const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
        if (endpoint.startsWith('/templates/')) {
            const text = files.get('/data' + endpoint);
            return new Response(text ?? 'missing', { status: resourceStatus ?? (text === undefined ? 404 : 200) });
        }
        if (endpoint === '/api/file/putFile') {
            const form = init.body as FormData;
            const p = String(form.get('path'));
            files.set(p, await (form.get('file') as Blob).text());
            if (p.startsWith('/data/templates/')) writes.push(p);
            return ok(null);
        }
        const args = JSON.parse(String(init.body ?? '{}'));
        if (endpoint === '/api/file/getFile') {
            return new Response(files.get(args.path) ?? '', { status: files.has(args.path) ? 200 : 404 });
        }
        if (endpoint === '/api/search/searchTemplate') return ok({ templates: [...files.keys()]
            .filter(p => p.startsWith('/data/templates/') && p.includes(args.k))
            .map(p => ({ path: '/workspace' + p, content: p })) });
        if (endpoint === '/api/search/removeTemplate') {
            const p = String(args.path).replace('/workspace', '');
            files.delete(p); writes.push(p); return ok(null);
        }
        if (endpoint === '/api/template/docSaveAsTemplate') {
            const p = '/data/templates/' + args.name + '.md';
            files.set(p, '# Source document'); writes.push(p); return ok(null);
        }
        if (endpoint === '/api/block/checkBlockExist') return ok(args.id === sourceID);
        if (endpoint === '/api/block/getBlockInfo') return ok({ id: sourceID, box: 'nb-1' });
        if (endpoint === '/api/attr/getBlockAttrs') return ok({});
        if (endpoint === '/api/block/getBlockKramdown') return ok({ kramdown: '# Source document' });
        if (endpoint === '/api/block/getBlockDOM') return ok({ dom: '<p>Source document</p>' });
        if (endpoint === '/api/block/getChildBlocks' || endpoint === '/api/query/sql') return ok([]);
        throw new Error(`Unexpected endpoint: ${endpoint}`);
    }) as typeof fetch;
    const client = new HttpSiYuanClient({ baseUrl: 'http://fixture.test' });
    const permMgr = createMockPermissionManager();
    permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
    const coordinator = new WriteSafetyCoordinator(client);
    const execute = vi.fn(async (args: Record<string, any>) => {
        const value = args.action === 'delete_template'
            ? await deleteTemplate(client, args.path)
            : args.action === 'save_doc_as_template'
                ? await saveDocAsTemplate(client, args.id, args.name, args.overwrite)
                : await writeTemplateSource(client, args.path, args.markdown);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, ...value }) }] };
    });
    const run = async (args: Record<string, any>) => parseResult(await coordinator.run({
        client, permMgr, category: 'file', action: args.action, args, strictMode: true, execute,
    }));
    const commit = async (args: Record<string, any>) => {
        const preflight = await run({ ...args, validateOnly: true });
        expect(preflight.error).toBeUndefined();
        expect(preflight.writeAttempted).toBe(false);
        const input = { ...args, requestId: preflight.requestId,
            ...(preflight.preconditionField ? { [preflight.preconditionField]: preflight[preflight.preconditionField] } : {}) };
        const result = await run(input);
        expect(result.safety).toMatchObject({ transactionState: 'committed', writeSafetyGuaranteed: true });
        const count = writes.length;
        const replay = await run(input);
        expect((replay.safety ?? replay).replayed).toBe(true);
        expect(writes).toHaveLength(count);
    };
    return { files, writes, sourceID, run, commit, setResourceStatus: (s: number) => { resourceStatus = s; } };
}

describe('strict template writes through the real HTTP client', () => {
    it('creates, overwrites and deletes a template, accepting an absent deletion postimage', async () => {
        const f = fixture();
        await f.commit({ action: 'create_template', path: 'nested/note.md', markdown: 'first' });
        expect(f.files.get('/data/templates/nested/note.md')).toBe('first');
        await f.commit({ action: 'create_template', path: 'nested/note.md', markdown: 'second', overwrite: true });
        expect(f.files.get('/data/templates/nested/note.md')).toBe('second');
        await f.commit({ action: 'delete_template', path: 'nested/note.md' });
        expect(f.files.has('/data/templates/nested/note.md')).toBe(false);
        expect(f.writes).toHaveLength(3);
    });

    it('preflights and saves a document to a new template without a placeholder file', async () => {
        const f = fixture();
        await f.commit({ action: 'save_doc_as_template', id: f.sourceID, name: 'new-note' });
        expect(f.files.get('/data/templates/new-note.md')).toBe('# Source document');
        expect(f.writes).toHaveLength(1);
    });

    it.each([401, 403, 500])('rejects template preflight on HTTP %s without writing', async (status) => {
        const f = fixture();
        f.setResourceStatus(status);
        const result = await f.run({ action: 'save_doc_as_template', id: f.sourceID, name: 'private', validateOnly: true });
        expect(result.error).toBeDefined();
        expect(result.writeAttempted).toBe(false);
        expect(f.writes).toHaveLength(0);
    });
});
