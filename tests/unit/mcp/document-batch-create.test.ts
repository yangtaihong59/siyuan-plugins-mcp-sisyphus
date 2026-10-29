import { describe, expect, it, vi } from 'vitest';

import '@/mcp/tool-registry';
import { buildDefaultToolConfig } from '@/core/config';
import { decideOneStep, getWriteBatchSize } from '@/core/write-safety-policy';
import { WriteSafetyCoordinator } from '@/mcp/write-safety-coordinator';
import { callDocumentTool } from '@/tools/document';
import { DocumentCreateSchema } from '@/tools/document/schemas';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';
import { requestError } from '../../helpers/request-error';

const NB = '20261029000000-nbaaaaa';
const docs = (count: number) => Array.from({ length: count }, (_, index) => ({ path: `/Batch/Doc ${index}` }));

/** A kernel that creates documents until `failAt`, then fails that call with `failure`. */
function createKernel(failAt?: number, failure?: Error) {
    const created: Array<{ id: string; path: string }> = [];
    let calls = 0;
    const client: any = {
        readFile: vi.fn(async () => { throw requestError('HTTP error: 404 Not Found'); }),
        writeFile: vi.fn(async () => undefined),
        requestWrite: vi.fn(async (endpoint: string, body: Record<string, any>) => {
            if (endpoint.startsWith('/api/ui/')) return null;
            if (endpoint !== '/api/filetree/createDocWithMd') throw new Error(`unexpected write ${endpoint}`);
            const index = calls++;
            if (index === failAt) throw failure;
            const id = `20261029000${String(100 + index).padStart(3, '0')}-doc${String(index).padStart(4, '0')}`;
            created.push({ id, path: body.path });
            return id;
        }),
        requestRead: vi.fn(async (endpoint: string, body?: Record<string, any>) => {
            if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: [{ id: NB, name: 'Lab', closed: false }] };
            if (endpoint === '/api/block/checkBlockExist') return created.some((doc) => doc.id === body?.id);
            if (endpoint === '/api/block/getBlockInfo') return { id: body?.id, rootID: body?.id, box: NB };
            if (endpoint === '/api/attr/getBlockAttrs') return {};
            if (endpoint === '/api/block/getBlockKramdown') return { kramdown: '' };
            if (endpoint === '/api/block/getChildBlocks' || endpoint === '/api/query/sql') return [];
            if (endpoint === '/api/block/getBlockDOM') return { dom: '<div></div>' };
            return null;
        }),
    };
    return { client, created, coordinator: undefined as WriteSafetyCoordinator | undefined };
}

async function runBatch(kernel: ReturnType<typeof createKernel>, args: Record<string, unknown>, oneStep: 'off' | 'low_risk' = 'low_risk') {
    const permMgr = createMockPermissionManager();
    permMgr.getAll = vi.fn(() => ({ [NB]: 'rwd' }));
    kernel.coordinator ??= new WriteSafetyCoordinator(kernel.client);
    const coordinator = kernel.coordinator;
    const config = buildDefaultToolConfig().document;
    return coordinator.run({
        client: kernel.client, permMgr, category: 'document', action: 'create', args, strictMode: true, oneStep,
        execute: (safeArgs, tracked = kernel.client) => callDocumentTool(tracked, safeArgs, config, permMgr),
    });
}

describe('document create batch (docs)', () => {
    it('validates the batch shape: exclusive with single fields, unique paths, at most 20', () => {
        expect(DocumentCreateSchema.safeParse({ action: 'create', notebook: NB, docs: docs(20) }).success).toBe(true);
        expect(DocumentCreateSchema.safeParse({ action: 'create', notebook: NB, docs: docs(21) }).success).toBe(false);
        expect(DocumentCreateSchema.safeParse({ action: 'create', notebook: NB, docs: docs(2), path: '/X' }).success).toBe(false);
        for (const path of ['/', '//', 'Doc', ' '])
            expect(DocumentCreateSchema.safeParse({ action: 'create', notebook: NB, docs: [{ path }] }).success).toBe(false);
        const repeated = DocumentCreateSchema.safeParse({ action: 'create', notebook: NB, docs: [{ path: '/A/B' }, { path: '/A//B/' }] });
        expect(repeated.success).toBe(false);
        expect(JSON.stringify(repeated.error?.issues)).toContain('docs[1].path repeats docs[0].path');
    });

    it('stays one-step tier 1 up to 20 docs; larger lists fall back to the two-step flow', () => {
        expect(getWriteBatchSize({ docs: docs(20) })).toBe(20);
        expect(decideOneStep('low_risk', 'document', 'create', { notebook: NB, docs: docs(20) })).toEqual({ allowed: true, tier: 1 });
        expect(decideOneStep('low_risk', 'document', 'create', { notebook: NB, docs: docs(21) })).toEqual({ allowed: false, tier: 1, reason: 'batch_too_large' });
    });

    it('creates every document in order in one step and lists each in the preview', async () => {
        const kernel = createKernel();
        const result = parseResult(await runBatch(kernel, { action: 'create', notebook: NB, docs: [{ path: '/P', markdown: 'Body' }, { path: '/P/C1' }, { path: '/P/C2' }] }));
        expect(result.success).toBe(true);
        expect(result.safety.transactionState).toBe('committed');
        expect(result.oneStep.tier).toBe(1);
        expect(kernel.created.map((doc) => doc.path)).toEqual(['/P', '/P/C1', '/P/C2']);
        expect(result.created.map((item: any) => item.id)).toEqual(kernel.created.map((doc) => doc.id));
        expect(result.preview.changes.map((change: any) => change.kind)).toEqual(['create_documents', 'create_document', 'create_document', 'create_document']);
        expect(result.preview.changes[2].summary).toContain('at Lab:/P/C1');
    });

    it('stops at an explicit rejection and reports created, failed (not_applied) and never-sent items', async () => {
        const kernel = createKernel(1, requestError('SiYuan API error: -1 invalid path'));
        const raw = await runBatch(kernel, { action: 'create', notebook: NB, docs: [{ path: '/A' }, { path: '/B' }, { path: '/C' }] });
        const result = parseResult(raw);
        expect(raw.isError).toBe(true);
        expect(kernel.client.requestWrite.mock.calls.filter(([endpoint]: [string]) => endpoint === '/api/filetree/createDocWithMd')).toHaveLength(2);
        expect(result.safety).toMatchObject({ transactionState: 'partial', writeExecuted: true });
        expect(result.overallState).toBe('partial');
        expect(result.created).toEqual([{ index: 0, path: '/A', id: kernel.created[0].id }]);
        expect(result.failed).toMatchObject({ index: 1, path: '/B', state: 'not_applied' });
        expect(result.notApplied).toEqual([{ index: 2, path: '/C' }]);
        expect(result.error.message).toContain('1 of 3 document(s) were created');
        expect(result.error.details).toContain('not_applied, never sent (1)');
    });

    it('marks the failed item unknown when its outcome cannot be known', async () => {
        const kernel = createKernel(1, requestError('Request timeout after 30000ms'));
        const result = parseResult(await runBatch(kernel, { action: 'create', notebook: NB, docs: [{ path: '/A' }, { path: '/B' }, { path: '/C' }] }));
        expect(result.safety.transactionState).toBe('unknown');
        expect(result.failed).toMatchObject({ index: 1, state: 'unknown' });
        expect(result.notApplied).toEqual([{ index: 2, path: '/C' }]);
        expect(result.error.message).toContain('first check whether /B exists');
    });

    it('classifies a rejected first item as not_applied: nothing was created', async () => {
        const kernel = createKernel(0, requestError('SiYuan API error: -1 invalid path'));
        const result = parseResult(await runBatch(kernel, { action: 'create', notebook: NB, docs: [{ path: '/A' }, { path: '/B' }] }));
        expect(result.safety.transactionState).toBe('not_applied');
        expect(kernel.created).toHaveLength(0);
    });

    it('runs through the two-step flow when one-step is off', async () => {
        const kernel = createKernel();
        const args = { action: 'create', notebook: NB, docs: [{ path: '/A' }, { path: '/A/B' }] };
        const preflight = parseResult(await runBatch(kernel, { ...args, validateOnly: true }, 'off'));
        expect(kernel.created).toHaveLength(0);
        expect(preflight.preview.changes[0].summary).toContain('Creates 2 document(s) in Lab');
        const committed = parseResult(await runBatch(kernel, preflight.preflight.commitArgs, 'off'));
        expect(committed.safety.transactionState).toBe('committed');
        expect(committed.count).toBe(2);
    });
});
