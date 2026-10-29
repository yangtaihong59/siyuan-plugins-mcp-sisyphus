import { describe, expect, it, vi } from 'vitest';

import '@/mcp/tool-registry';
import { WriteOutcomeUnknownError } from '@/api/errors';
import { buildDefaultToolConfig } from '@/core/config';
import { getWriteBatchSize } from '@/core/write-safety-policy';
import { WriteSafetyCoordinator } from '@/mcp/write-safety-coordinator';
import { softLineBreakNote } from '@/mcp/write-impact-preview';
import { annotateHelpWithOneStep } from '@/mcp/write-safety-if-match';
import { callBlockTool } from '@/tools/block';
import { extractTopLevelInsertedIds, lastBlockOfHeadingSection } from '@/tools/block/handlers';
import { callDocumentTool } from '@/tools/document';
import { formatSafetyStatus, formatWritePreview } from '@/cli/write-guidance';
import { translatePresentationPayload } from '@/shared/invocation-format';
import { createMockClient } from '../../helpers/mock-client';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';
import { requestError } from '../../helpers/request-error';

const DOC_ID = '20261029000000-docaaaa';
const BLOCK_ID = '20261029000001-blkaaaa';
const CHILD_ID = '20261029000002-chldaaa';

function success(payload: Record<string, unknown>) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
}

function createWorld() {
    const world: any = { kramdown: { [BLOCK_ID]: 'parent', [CHILD_ID]: 'child' } };
    const client = {
        readFile: vi.fn(async () => { throw requestError('HTTP error: 404 Not Found'); }),
        writeFile: vi.fn(async () => undefined),
        requestRead: vi.fn(async (endpoint: string, payload?: { id?: string }) => {
            const id = payload?.id ?? BLOCK_ID;
            if (endpoint === '/api/block/checkBlockExist') return true;
            if (endpoint === '/api/block/getBlockInfo') return { id, box: 'nb-1', rootID: DOC_ID };
            if (endpoint === '/api/attr/getBlockAttrs') return { id };
            if (endpoint === '/api/block/getBlockKramdown') return { id, kramdown: world.kramdown[id] ?? '' };
            if (endpoint === '/api/block/getChildBlocks') return [];
            if (endpoint === '/api/block/getBlockDOM') return { dom: `<div data-node-id="${id}">${world.kramdown[id] ?? ''}</div>` };
            if (endpoint === '/api/query/sql') return [];
            return null;
        }),
        requestWrite: vi.fn(async () => { throw requestError('SiYuan API error: -1 - heading [x] is a leaf block and cannot have children'); }),
    } as any;
    const permMgr = createMockPermissionManager({ canWrite: () => true, canDelete: () => true });
    permMgr.getAll = vi.fn(() => ({ 'nb-1': 'rwd' }));
    return Object.assign(world, { client, permMgr });
}

const appendArgs = { action: 'append', parentID: BLOCK_ID, dataType: 'markdown', data: 'x' };

describe('definite kernel rejections are not_applied (round 12)', () => {
    it('classifies an API error on the only write as not_applied, and its replay too', async () => {
        const world = createWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const execute = vi.fn(async (_args: Record<string, unknown>, client?: any) => {
            await client.requestWrite('/api/block/appendBlock', {});
            return success({ ok: true });
        });
        const result = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'append', args: appendArgs,
            strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(result.safety).toMatchObject({ writeAttempted: true, writeExecuted: false, transactionState: 'not_applied', error: { code: 'not_applied' } });
        const entry = (coordinator as any).ledger.entries.get(result.safety.requestId);
        expect(entry).toMatchObject({ state: 'failed_before_execute' });

        const replay = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'append',
            args: { ...appendArgs, requestId: result.safety.requestId }, strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(replay.error.code).toBe('not_applied');
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('keeps outcome_unknown when a write may have landed', async () => {
        const world = createWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        world.client.requestWrite = vi.fn()
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(requestError('SiYuan API error: -1 - second step failed'));
        const partial = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'append', args: appendArgs,
            strictMode: true, oneStep: 'low_risk',
            execute: async (_args, client?: any) => {
                await client.requestWrite('/api/one', {});
                await client.requestWrite('/api/two', {});
                return success({ ok: true });
            },
        }));
        expect(partial).toMatchObject({ transactionState: 'unknown', error: { code: 'outcome_unknown' } });

        world.client.requestWrite = vi.fn(async () => { throw new WriteOutcomeUnknownError('/api/x', new Error('socket hang up')); });
        const lost = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'append', args: appendArgs,
            strictMode: true, oneStep: 'low_risk',
            execute: async (_args, client?: any) => {
                await client.requestWrite('/api/one', {});
                return success({ ok: true });
            },
        }));
        expect(lost.error.code).toBe('outcome_unknown');
    });
});

describe('ifMatch target labels (round 12)', () => {
    it('labels a read hash with its target and names a cross-target ifMatch', async () => {
        const world = createWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const parent = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'get_children', args: { action: 'get_children', id: BLOCK_ID },
            strictMode: true, oneStep: 'low_risk', execute: vi.fn(async () => success({ data: [{ id: CHILD_ID }] })),
        }));
        expect(parent.ifMatchTarget).toBe(BLOCK_ID);
        const execute = vi.fn();
        const wrong = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update',
            args: { action: 'update', id: CHILD_ID, dataType: 'markdown', data: 'next', ifMatch: parent.ifMatch },
            strictMode: true, oneStep: 'low_risk', execute,
        }));
        expect(wrong.error).toMatchObject({ code: 'state_changed', ifMatchTarget: CHILD_ID, ifMatchIssuedFor: BLOCK_ID });
        expect(wrong.error.message).toContain(`read of ${BLOCK_ID}, not of ${CHILD_ID}`);
        expect(wrong.error.hint).toContain(`block(action="get_kramdown", id="${CHILD_ID}")`);
        expect(execute).not.toHaveBeenCalled();
    });

    it('labels one-step receipt target excerpts as the content before the write', async () => {
        const world = createWorld();
        const coordinator = new WriteSafetyCoordinator(world.client);
        const read = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'get_kramdown', args: { action: 'get_kramdown', id: CHILD_ID },
            strictMode: true, oneStep: 'low_risk', execute: vi.fn(async () => success({ kramdown: 'child' })),
        }));
        const committed = parseResult(await coordinator.run({
            client: world.client, permMgr: world.permMgr, category: 'block', action: 'update',
            args: { action: 'update', id: CHILD_ID, dataType: 'markdown', data: 'next', ifMatch: read.ifMatch },
            strictMode: true, oneStep: 'low_risk',
            execute: vi.fn(async () => { world.kramdown[CHILD_ID] = 'next'; return success({ success: true, changed: true }); }),
        }));
        expect(committed.safety.transactionState).toBe('committed');
        for (const target of committed.preview.targets) expect(target).not.toHaveProperty('excerpt');
        expect(formatSafetyStatus(committed.safety, committed.oneStep)).toContain('tier 2: overwrite guarded by --if-match');
    });
});

describe('help, preview and receipts (round 12)', () => {
    const helpResult = (topic: string, payload: Record<string, unknown> = {}) => annotateHelpWithOneStep(
        topic === 'add_rows' ? 'av' : topic === 'create' ? 'document' : 'block', { action: 'help', topic },
        success({ tool: 'x', action: topic, ...payload }),
    );

    it('mentions the batch limit only for actions with an item list', () => {
        expect(parseResult(helpResult('create')).oneStep.rule).toContain('(docs lists of up to 20 entries)');
        expect(parseResult(helpResult('prepend')).oneStep.rule).not.toContain('20');
        expect(parseResult(helpResult('insert')).oneStep.rule).toContain('(blocks lists of up to 20 entries)');
    });

    it('drops the preflight flag from tier-1 examples when one-step is on', () => {
        const help = parseResult(helpResult('add_rows', { examples: [{ title: 'Add rows (preflight first)', mcp: { action: 'add_rows', avID: 'a', rows: [], validateOnly: true } }] }));
        expect(help.examples[0].title).toBe('Add rows');
        expect(help.examples[0].mcp).not.toHaveProperty('validateOnly');
    });

    it('counts block insert blocks[] toward the one-step batch limit', () => {
        expect(getWriteBatchSize({ blocks: Array.from({ length: 21 }, () => ({})) })).toBe(21);
    });

    it('notes lines folded into one paragraph and prints it in the CLI preview', () => {
        expect(softLineBreakNote('first\nsecond')).toBe('2 lines → 1 paragraph: a single newline is a soft line break inside one paragraph. Separate paragraphs with a blank line.');
        expect(softLineBreakNote('first\n\nsecond')).toBeUndefined();
        expect(softLineBreakNote('- a\n- b')).toBeUndefined();
        const lines = formatWritePreview({ targets: [], changes: [{ kind: 'create_blocks', summary: 'Creates 1 block', note: 'folded' }], risk: [] });
        expect(lines).toContain('        note: folded');
    });

    it('returns every top-level block ID an append created', () => {
        const data = `<div data-node-id="a" data-node-index="1"><div>x</div></div><div data-subtype="u" data-node-id="b" data-node-index="2"><div data-node-id="b1"></div></div>`;
        expect(extractTopLevelInsertedIds({ doOperations: [{ id: 'a', data }] })).toEqual(['a', 'b']);
        expect(extractTopLevelInsertedIds({ doOperations: [{ id: 'a' }] })).toEqual(['a']);
    });

    it('finds the last block of a heading section', () => {
        const children = [
            { id: 'h1', type: 'h', subType: 'h2' }, { id: 'p1', type: 'p' }, { id: 'h3', type: 'h', subType: 'h3' }, { id: 'p2', type: 'p' },
            { id: 'h2b', type: 'h', subType: 'h2' }, { id: 'p3', type: 'p' },
        ];
        expect(lastBlockOfHeadingSection(children, 'h1')).toBe('p2');
        expect(lastBlockOfHeadingSection(children, 'h2b')).toBe('p3');
        expect(lastBlockOfHeadingSection(children, 'missing')).toBeUndefined();
    });
});

describe('tool errors that point to the right call (round 12)', () => {
    const permMgr = { reload: async () => undefined, canWrite: () => true, canRead: () => true, canDelete: () => true, get: () => 'rwd' };

    function headingClient() {
        return createMockClient({
            request: vi.fn(async (endpoint: string, body?: Record<string, unknown>) => {
                if (endpoint === '/api/query/sql') return [{ id: body?.id ?? 'h-1', root_id: 'doc-1', box: 'nb-1', path: '/doc-1.sy', hpath: '/Doc', content: 'Doc', type: 'h' }];
                if (endpoint === '/api/block/getChildBlocks') return [{ id: 'h-1', type: 'h', subType: 'h2' }, { id: 'p-1', type: 'p' }, { id: 'h-2', type: 'h', subType: 'h1' }];
                if (endpoint === '/api/block/appendBlock' || endpoint === '/api/block/prependBlock') {
                    throw requestError('SiYuan API error: -1 - heading [h-1] is a leaf block and cannot have children; to place a block below this heading, pass previousID=<heading id> or previousID=<last block below the heading> instead of parentID');
                }
                return null;
            }),
        });
    }

    it.each([
        ['append', 'previousID="p-1"'],
        ['prepend', 'previousID="h-1"'],
    ])('turns a heading parent rejection on %s into the insert call', async (action, anchor) => {
        const result = await callBlockTool(headingClient(), { action, parentID: 'h-1', dataType: 'markdown', data: 'x' }, buildDefaultToolConfig().block, permMgr as never);
        const parsed = parseResult(result);
        expect(result.isError).toBe(true);
        expect(parsed.error.type).toBe('api_error');
        expect(parsed.error.message).toContain('block(action="insert"');
        expect(parsed.error.message).toContain(anchor);
        expect(parsed.error.message).toContain(`block ${action} has no previousID`);
    });

    it('points non-custom document attributes to block set_attrs', async () => {
        const result = await callDocumentTool(createMockClient(), { action: 'set_attr', id: DOC_ID, attrs: { 'custom-type': 'meeting', alias: 'x' } }, buildDefaultToolConfig().document, permMgr as never);
        const parsed = parseResult(result);
        expect(parsed.error.type).toBe('validation_error');
        expect(parsed.error.fields[0].message).toContain('block(action="set_attrs"');
        expect(parsed.error.fields[0].message).toContain('icon, cover and custom-*');
        expect(parsed.error.fields[0].message).toContain('alias is not one of them');
        const cli = translatePresentationPayload(parsed, 'cli') as any;
        expect(cli.error.fields[0].message).toContain('siyuan-sisyphus block set-attrs --id <document id>');
    });
});
