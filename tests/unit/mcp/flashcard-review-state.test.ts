import { describe, it, expect, vi } from 'vitest';
import { WriteSafetyCoordinator } from '@/mcp/write-safety-coordinator';
import { readFlashcardReviewState } from '@/tools/flashcard/review-state';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';

function fixture() {
    let reps = 0;
    const client = {
        readFile: vi.fn(async () => { throw Error('HTTP error: 404 Not Found'); }),
        writeFile: vi.fn(async () => undefined),
        requestRead: vi.fn(async (endpoint: string) => endpoint === '/api/block/getBlockInfo'
            ? { box: 'nb-1' }
            : { blocks: [{ id: 'block-1', riffCardID: 'card-1', riffCard: { reps, lapses: 0, state: reps ? 1 : 0, lastReview: reps ? '2026-10-20T00:00:00Z' : null, due: String(Date.now()) } }], pageCount: 1 }),
    } as any;
    const perm = createMockPermissionManager(); perm.getAll = () => ({ 'nb-1': 'rwd' });
    return { client, perm, change: () => { reps++; } };
}

describe('real riff review identity and state', () => {
    it('rejects block IDs, missing cards and wrong-deck IDs before execution', async () => {
        const f = fixture();
        await expect(readFlashcardReviewState(f.client, f.perm, 'deck-1', 'block-1')).rejects.toThrow('not blockID');
        f.client.requestRead.mockResolvedValue({ blocks: [], pageCount: 0 });
        await expect(readFlashcardReviewState(f.client, f.perm, 'other-deck', 'card-1')).rejects.toThrow('not resolved');
    });
    it('resolves native riffCardID on subsequent pages', async () => {
        const f = fixture();
        f.client.requestRead.mockImplementation(async (ep: string, args: any) => ep === '/api/block/getBlockInfo' ? { box: 'nb-1' } : {
            blocks: [{ id: 'block-1', riffCardID: args.page === 2 ? 'card-1' : 'other', riffCard: { reps: 0, state: 0 } }], pageCount: 2,
        });
        expect(await readFlashcardReviewState(f.client, f.perm, 'deck-1', 'card-1')).toMatchObject({ cardID: 'card-1', blockID: 'block-1', box: 'nb-1' });
    });
    it('rejects review without notebook write permission', async () => {
        const f = fixture(); f.perm.canWrite = () => false;
        await expect(readFlashcardReviewState(f.client, f.perm, 'deck-1', 'card-1')).rejects.toThrow('write permission');
    });
    it('hashes scheduling changes and replays a committed rating without executing twice', async () => {
        const f = fixture(); const coordinator = new WriteSafetyCoordinator(f.client);
        const execute = vi.fn(async () => { f.change(); return { content: [{ type: 'text' as const, text: '{"result":null}' }] }; });
        const base = { client: f.client, permMgr: f.perm, category: 'flashcard' as const, action: 'review_card', strictMode: true, execute };
        const pre = parseResult(await coordinator.run({ ...base, args: { action: 'review_card', deckID: 'deck-1', cardID: 'card-1', rating: 3, validateOnly: true } }));
        const out = parseResult(await coordinator.run({ ...base, args: pre.preflight.commitArgs }));
        expect(out.safety.transactionState).toBe('committed');
        expect(out.safety.resultHash).not.toBe(out.safety.previousHash);
        const replay = parseResult(await coordinator.run({ ...base, args: pre.preflight.commitArgs }));
        expect((replay.safety ?? replay).replayed).toBe(true); expect(execute).toHaveBeenCalledTimes(1);
    });
    it('rejects a stale rating after another reviewer changes this card', async () => {
        const f = fixture(); const coordinator = new WriteSafetyCoordinator(f.client); const execute = vi.fn();
        const base = { client: f.client, permMgr: f.perm, category: 'flashcard' as const, action: 'review_card', strictMode: true, execute };
        const pre = parseResult(await coordinator.run({ ...base, args: { action: 'review_card', deckID: 'deck-1', cardID: 'card-1', rating: 3, validateOnly: true } }));
        f.change(); const out = parseResult(await coordinator.run({ ...base, args: pre.preflight.commitArgs }));
        expect(out.error.code).toBe('state_changed'); expect(execute).not.toHaveBeenCalled();
    });
});
