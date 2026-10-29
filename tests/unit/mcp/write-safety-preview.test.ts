import { describe, expect, it, vi } from 'vitest';

import { WriteSafetyCoordinator } from '@/mcp/write-safety-coordinator';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';
import { requestError } from '../../helpers/request-error';

const BLOCK = '20260812000000-abcdefg';
const PARENT = '20260812000001-parentx';

function success(payload: Record<string, unknown>) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
}

function createFixture(options: { spansFail?: boolean } = {}) {
    let kramdown = `Old text\n{: id="${BLOCK}" custom-owner="me"}`;
    const client = {
        readFile: vi.fn(async () => { throw requestError('HTTP error: 404 Not Found'); }),
        writeFile: vi.fn(async () => undefined),
        requestRead: vi.fn(async (endpoint: string, body?: Record<string, any>) => {
            if (endpoint === '/api/block/checkBlockExist') return true;
            if (endpoint === '/api/block/getBlockInfo') return { id: body?.id, box: 'nb-1' };
            if (endpoint === '/api/attr/getBlockAttrs') return { id: BLOCK, 'custom-owner': 'me' };
            if (endpoint === '/api/block/getBlockKramdown') return { id: body?.id, kramdown };
            if (endpoint === '/api/block/getChildBlocks') return [];
            if (endpoint === '/api/block/getBlockDOM') return { dom: `<div data-node-id="${BLOCK}">${kramdown}</div>` };
            if (endpoint === '/api/notebook/lsNotebooks') return { notebooks: [{ id: 'nb-1', name: 'Work', closed: false }] };
            if (endpoint === '/api/query/sql') {
                if (options.spansFail && String(body?.stmt).includes('FROM spans')) throw new Error('spans index unavailable');
                if (String(body?.stmt).startsWith('SELECT id, type')) {
                    return [{ id: BLOCK, type: 'p', content: 'Old text', hpath: '/Plans', box: 'nb-1', root_id: PARENT, parent_id: PARENT }];
                }
                return [];
            }
            return null;
        }),
    };
    const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
    permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
    return { client: client as never, permMgr, setKramdown: (next: string) => { kramdown = next; } };
}

describe('write safety coordinator preview', () => {
    it('attaches a preview to a strict preflight without changing commitArgs or the commit', async () => {
        const { client, permMgr, setKramdown } = createFixture();
        const coordinator = new WriteSafetyCoordinator(client);
        const business = { action: 'update', id: BLOCK, dataType: 'markdown', data: 'New text' };

        const summary = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', strictMode: true, execute: vi.fn(),
            args: { ...business, validateOnly: true },
        }));
        const full = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', strictMode: true, execute: vi.fn(),
            args: { ...business, validateOnly: true, preview: 'full' },
        }));

        expect(summary.preview).toMatchObject({
            detail: 'summary',
            targets: [{ id: BLOCK, kind: 'block', excerpt: 'Old text', hPath: '/Plans', notebook: { id: 'nb-1', name: 'Work', permission: 'rwd' } }],
            changes: [{ kind: 'content_update', before: 'Old text', after: 'New text', userAttributes: ['custom-owner'], attributesRestored: true }],
            risk: ['overwrites_content'],
        });
        expect(full.preview.detail).toBe('full');
        // The detail flag is response-only: same hash, same executable commit arguments.
        expect(full.expectedStateHash).toBe(summary.expectedStateHash);
        const strip = (commitArgs: Record<string, unknown>) => {
            const { requestId: _requestId, expectedStateHash: _hash, ...rest } = commitArgs;
            return rest;
        };
        expect(strip(full.preflight.commitArgs)).toEqual(strip(summary.preflight.commitArgs));
        expect(full.preflight.commitArgs).not.toHaveProperty('preview');
        expect(full.preflight).not.toHaveProperty('preview');

        const execute = vi.fn(async (args: Record<string, unknown>) => {
            expect(args).not.toHaveProperty('preview');
            setKramdown(`New text\n{: id="${BLOCK}" custom-owner="me"}`);
            return success({ success: true, action: 'update' });
        });
        const committed = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', strictMode: true, execute,
            args: full.preflight.commitArgs,
        }));
        expect(execute).toHaveBeenCalledTimes(1);
        expect(committed.safety).toMatchObject({ transactionState: 'committed', writeExecuted: true });
        expect(committed).not.toHaveProperty('preview');
    });

    it('accepts a stray preview flag on the commit without breaking the argument binding', async () => {
        const { client, permMgr, setKramdown } = createFixture();
        const coordinator = new WriteSafetyCoordinator(client);
        const business = { action: 'update', id: BLOCK, dataType: 'markdown', data: 'New text' };
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', strictMode: true, execute: vi.fn(),
            args: { ...business, validateOnly: true },
        }));
        const committed = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'update', strictMode: true,
            execute: vi.fn(async () => { setKramdown('New text'); return success({ success: true }); }),
            args: { ...preflight.preflight.commitArgs, preview: 'full' },
        }));
        expect(committed.safety).toMatchObject({ transactionState: 'committed' });
    });

    it('still returns the preflight when building the preview fails', async () => {
        const { client, permMgr } = createFixture({ spansFail: true });
        const coordinator = new WriteSafetyCoordinator(client);
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'tag', action: 'rename', strictMode: true, execute: vi.fn(),
            args: { action: 'rename', oldLabel: 'todo', newLabel: 'done', validateOnly: true },
        }));
        expect(preflight.validateOnly).toBe(true);
        expect(preflight.requestId).toMatch(/^[a-f0-9]+$/);
        expect(preflight.expectedManifestHash).toBeTruthy();
        expect(preflight.preflight.commitArgs).toMatchObject({ action: 'rename', oldLabel: 'todo', newLabel: 'done' });
        expect(preflight.preview).toEqual({ error: 'spans index unavailable' });
    });

    it('previews additive writes that have no state precondition', async () => {
        const { client, permMgr } = createFixture();
        const coordinator = new WriteSafetyCoordinator(client);
        const preflight = parseResult(await coordinator.run({
            client, permMgr, category: 'block', action: 'append', strictMode: true, execute: vi.fn(),
            args: { action: 'append', parentID: BLOCK, dataType: 'markdown', data: 'Appended', validateOnly: true },
        }));
        expect(preflight.preview).toMatchObject({
            detail: 'summary',
            changes: [{ kind: 'create_blocks', blockCount: 1, blocks: ['Appended'] }],
            risk: [],
        });
        expect(preflight.preview.changes[0].summary).toContain('Creates 1 top-level block(s) at the end of');
    });
});
