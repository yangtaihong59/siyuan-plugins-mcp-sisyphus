import type { SiYuanClient } from '../../api/client';
import type { PermissionManager } from '../../core/permissions';
import { safetyError } from '../../core/write-safety-ledger';
import { sleep } from '../../shared/async';

/** getRiffCards returns blocks with riffCardID/riffCard, not due-card DTOs. */
export async function readFlashcardReviewState(
    client: SiYuanClient, permMgr: PermissionManager, deckID: string, cardID: string,
) {
    for (let attempt = 0; attempt < 12; attempt++) {
        let unresolved = false;
        for (let page = 1; page <= 1000; page++) {
            const result = await client.requestRead<{
                blocks?: Array<Record<string, any>>;
                pageCount?: number;
            }>('/api/riff/getRiffCards', { id: deckID, page, pageSize: 100 });
            const rows = result?.blocks ?? [];
            for (const row of rows) {
                if (!row.riffCardID || !row.riffCard) unresolved = true;
                if (row.riffCardID !== cardID || !row.riffCard) continue;
                const info = await client.requestRead<{ box: string }>('/api/block/getBlockInfo', { id: row.id });
                await permMgr.reload();
                if (!info?.box || !permMgr.canWrite(info.box)) {
                    throw safetyError('permission_denied', 'Reviewing this flashcard requires write permission for its notebook.');
                }
                const card = row.riffCard;
                return {
                    deckID, cardID, blockID: row.id, box: info.box,
                    reps: card.reps, lapses: card.lapses, state: card.state, lastReview: card.lastReview,
                    // New-card due timestamps are synthesized on each read.
                    ...(card.state !== 0 && card.state !== 'new' ? { due: card.due } : {}),
                };
            }
            if (page >= (result?.pageCount ?? 1)) break;
            if (page === 1000) throw safetyError('invalid_arguments', 'Deck exceeds the bounded review lookup. Use a smaller deck.');
        }
        if (!unresolved) break;
        if (attempt < 11) await sleep(250);
    }
    throw safetyError('invalid_arguments',
        'cardID was not resolved in this deck. Use flashcard.list_cards(scope="deck", filter="due", deckID) and copy its cardID, not blockID.');
}
