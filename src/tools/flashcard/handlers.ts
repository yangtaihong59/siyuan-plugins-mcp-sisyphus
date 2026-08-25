import type { SiYuanClient } from '../../api/client';
import * as attributeApi from '../../api/block';
import * as flashcardApi from '../../api/flashcard';
import type { FlashcardAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import {
    FlashcardCreateCardSchema,
    FlashcardGetCardsSchema,
    FlashcardGetDecksSchema,
    FlashcardListCardsSchema,
    FlashcardRemoveCardSchema,
    FlashcardReviewCardSchema,
} from '../../core/types';
import type { ToolActionHandler } from '../internal/define-tool';
import { extractKramdownContentForEditing } from '../internal/kramdown-safe';
import { createJsonResult } from '../internal/shared';
import { sleep } from '../../shared/async';

type FlashcardActionHandler = ToolActionHandler;

const BUILTIN_DECK_ID = '20230218211946-2kw8jgx';
const NODE_ATTR_RIFF_DECKS = 'custom-riff-decks';
const BUILTIN_DECK_NAME = 'Built-in Deck';
const GET_CARDS_RETRY_ATTEMPTS = 5;
const GET_CARDS_RETRY_DELAY_MS = 300;
// SiYuan can persist custom-riff-decks before the corresponding built-in
// deck record becomes queryable. Keep the readback bounded, but allow the
// asynchronous riff index enough time under a busy workspace.
const FLASHCARD_BINDING_VERIFY_ATTEMPTS = 24;
const FLASHCARD_BINDING_VERIFY_DELAY_MS = 500;

type BlockAttrMap = Record<string, string>;

function isNewCardState(state: unknown): boolean {
    if (typeof state === 'string') {
        return ['new', '0'].includes(state.toLowerCase());
    }
    return state === 0;
}

function isOldCardState(state: unknown): boolean {
    if (typeof state === 'string') {
        return ['old', '1', 'review'].includes(state.toLowerCase());
    }
    return state === 1;
}

function filterCardsByState(cards: flashcardApi.Flashcard[], filter: 'due' | 'new' | 'old') {
    if (filter === 'due') return cards;
    if (filter === 'new') return cards.filter(card => isNewCardState(card.state));
    return cards.filter(card => isOldCardState(card.state));
}

function flashcardBlockID(card: flashcardApi.Flashcard): string | undefined {
    if (typeof card.blockID === 'string' && card.blockID.length > 0) return card.blockID;
    if (typeof card.id === 'string' && card.id.length > 0) return card.id;
    return undefined;
}

function flashcardFront(kramdown: string | undefined): string {
    if (!kramdown) return '';
    return extractKramdownContentForEditing(kramdown)
        .replace(/^#{1,6}[ \t]+/, '')
        .trim();
}

function inferReviewKind(blockType: unknown): NonNullable<flashcardApi.Flashcard['review']>['kind'] {
    const normalizedType = typeof blockType === 'string' ? blockType.toLowerCase() : '';
    if (normalizedType.includes('super') || normalizedType === 's') return 'super-block';
    if (normalizedType.includes('list') || ['i', 'l'].includes(normalizedType)) return 'list';
    if (normalizedType.includes('heading') || normalizedType === 'h') return 'heading';
    return 'plain';
}

function createReviewMaterial(
    promptSource: string,
    childAnswer: string,
    blockType: unknown,
): NonNullable<flashcardApi.Flashcard['review']> {
    const clozeAnswers: string[] = [];
    const clozePrompt = promptSource.replace(/==([^=\n][\s\S]*?)==/g, (_raw, answer: string) => {
        const normalized = answer.trim();
        if (normalized) clozeAnswers.push(normalized);
        return '____';
    });
    const hasCloze = clozeAnswers.length > 0;
    const referenceAnswer = hasCloze ? clozeAnswers.join('；') : childAnswer.trim();
    const prompt = (hasCloze ? clozePrompt : promptSource).trim();
    return {
        kind: hasCloze ? 'cloze' : inferReviewKind(blockType),
        prompt,
        referenceAnswer,
        gradable: Boolean(prompt && referenceAnswer),
    };
}

async function hydrateFlashcardContent(
    client: SiYuanClient,
    permMgr: PermissionManager,
    cards: flashcardApi.Flashcard[],
): Promise<flashcardApi.Flashcard[]> {
    try {
        await permMgr.reload();
    } catch {
        return cards;
    }

    const cardBlocks = await Promise.all(cards.map(async (card) => {
        const blockID = flashcardBlockID(card);
        if (!blockID) return { card, blockID, children: [] as Array<{ id: string; type?: string }> };
        let notebook = '';
        try {
            const info = await attributeApi.getBlockInfo(client, blockID) as Record<string, unknown> | null;
            notebook = typeof info?.box === 'string' ? info.box : '';
        } catch {
            return { card, blockID: undefined, children: [] as Array<{ id: string; type?: string }> };
        }
        if (!notebook || !permMgr.canRead(notebook)) {
            return { card, blockID: undefined, children: [] as Array<{ id: string; type?: string }> };
        }
        try {
            const children = await attributeApi.getChildBlocks(client, blockID);
            return {
                card,
                blockID,
                children: Array.isArray(children)
                    ? children.filter((child): child is typeof child & { id: string } => typeof child?.id === 'string')
                    : [],
            };
        } catch {
            return { card, blockID, children: [] as Array<{ id: string; type?: string }> };
        }
    }));

    const ids = [...new Set(cardBlocks.flatMap(({ blockID, children }) => [
        ...(blockID ? [blockID] : []),
        ...children.map((child) => child.id),
    ]))];
    if (ids.length === 0) return cards;

    let kramdowns: Record<string, string> = {};
    try {
        kramdowns = await attributeApi.getBlockKramdowns(client, ids, 'md') ?? {};
    } catch {
        return cards;
    }

    return cardBlocks.map(({ card, blockID, children }) => {
        if (!blockID) return card;
        const promptSource = flashcardFront(kramdowns[blockID]);
        const childAnswer = children
            .map((child) => extractKramdownContentForEditing(kramdowns[child.id] ?? '', child.type))
            .filter(Boolean)
            .join('\n\n');
        const blockType = card.type ?? (/^#{1,6}[ \t]+/.test(kramdowns[blockID] ?? '') ? 'h' : undefined);
        const review = createReviewMaterial(promptSource, childAnswer, blockType);
        if (!review.prompt && !review.referenceAnswer) return card;
        return {
            ...card,
            ...(review.prompt ? { front: review.prompt } : {}),
            ...(review.referenceAnswer ? { back: review.referenceAnswer } : {}),
            review,
        };
    });
}

export interface FlashcardReviewSessionCardRef {
    deckID: string;
    cardID: string;
}

export interface FlashcardReviewSessionInput {
    cards: FlashcardReviewSessionCardRef[];
    selectionReason: string;
}

function reviewSessionCardKey(card: FlashcardReviewSessionCardRef): string {
    return `${card.deckID}\u0000${card.cardID}`;
}

function hasReviewSessionPrompt(card: flashcardApi.Flashcard): boolean {
    const prompt = typeof card.review?.prompt === 'string' ? card.review.prompt : card.front;
    return typeof prompt === 'string' && prompt.trim().length > 0;
}

async function filterReadableFlashcards(
    client: SiYuanClient,
    permMgr: PermissionManager,
    cards: flashcardApi.Flashcard[],
): Promise<flashcardApi.Flashcard[]> {
    try {
        await permMgr.reload();
    } catch {
        return [];
    }

    const readable = await Promise.all(cards.map(async (card) => {
        const blockID = flashcardBlockID(card);
        if (!blockID) return false;
        try {
            const info = await attributeApi.getBlockInfo(client, blockID) as Record<string, unknown> | null;
            const notebook = typeof info?.box === 'string' ? info.box : '';
            return Boolean(notebook && permMgr.canRead(notebook));
        } catch {
            return false;
        }
    }));
    return cards.filter((_card, index) => readable[index]);
}

/**
 * Resolve an AI-selected review batch against the fixed candidate snapshot
 * captured by flashcard(action="list_cards", scope="all"). The API fallback
 * is retained for direct callers, while the MCP App path always supplies the
 * snapshot so SiYuan cannot redraw the due queue between selection and review.
 */
export async function createFlashcardReviewSessionData(
    client: SiYuanClient,
    permMgr: PermissionManager,
    input: FlashcardReviewSessionInput,
    candidateSnapshot?: flashcardApi.Flashcard[],
) {
    const seen = new Set<string>();
    const requested = input.cards.filter((card) => {
        const key = reviewSessionCardKey(card);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const duplicateCount = input.cards.length - requested.length;
    const hasCandidateSnapshot = candidateSnapshot !== undefined;
    const dueCardsAtSelection = candidateSnapshot
        ?? (await flashcardApi.getRiffDueCards(client, '')).cards;
    const requestedByCardID = new Map<string, FlashcardReviewSessionCardRef[]>();
    for (const card of requested) {
        const matches = requestedByCardID.get(card.cardID) ?? [];
        matches.push(card);
        requestedByCardID.set(card.cardID, matches);
    }
    const dueByKey = new Map<string, flashcardApi.Flashcard>();
    for (const card of Array.isArray(dueCardsAtSelection) ? dueCardsAtSelection : []) {
        const cardID = typeof card.cardID === 'string' ? card.cardID : '';
        if (!cardID) continue;

        const cardDeckID = typeof card.deckID === 'string' ? card.deckID : '';
        const requestedMatches = requestedByCardID.get(cardID) ?? [];
        const deckID = cardDeckID || (requestedMatches.length === 1 ? requestedMatches[0].deckID : '');
        if (!deckID) continue;

        const key = reviewSessionCardKey({ deckID, cardID });
        if (!seen.has(key)) continue;
        dueByKey.set(key, { ...card, deckID });
    }

    const dueCards = requested
        .map((card) => dueByKey.get(reviewSessionCardKey(card)))
        .filter((card): card is flashcardApi.Flashcard => Boolean(card));
    const readableCards = await filterReadableFlashcards(client, permMgr, dueCards);
    const hydratedCards = (hasCandidateSnapshot
        ? readableCards
        : await hydrateFlashcardContent(client, permMgr, readableCards))
        .filter(hasReviewSessionPrompt);
    const hydratedByKey = new Map(hydratedCards.map((card) => [
        reviewSessionCardKey({ deckID: String(card.deckID ?? ''), cardID: String(card.cardID ?? '') }),
        card,
    ]));
    const cards = requested
        .map((card) => hydratedByKey.get(reviewSessionCardKey(card)))
        .filter((card): card is flashcardApi.Flashcard => Boolean(card));
    const readableKeys = new Set(readableCards.map((card) => reviewSessionCardKey({
        deckID: String(card.deckID ?? ''),
        cardID: String(card.cardID ?? ''),
    })));
    const omittedCards: Array<FlashcardReviewSessionCardRef & {
        reason: 'not_due_or_missing' | 'unreadable' | 'content_unavailable';
    }> = [];
    for (const card of requested) {
        const key = reviewSessionCardKey(card);
        if (!dueByKey.has(key)) omittedCards.push({ ...card, reason: 'not_due_or_missing' });
        else if (!readableKeys.has(key)) omittedCards.push({ ...card, reason: 'unreadable' });
        else if (!hydratedByKey.has(key)) omittedCards.push({ ...card, reason: 'content_unavailable' });
    }

    if (cards.length === 0) {
        throw new Error('No selected flashcards are still due and readable. Ask the user to refresh the due-card candidates before starting another session.');
    }

    return {
        action: 'flashcard_review_session',
        selectionReason: input.selectionReason,
        requestedCount: input.cards.length,
        selectedCount: cards.length,
        duplicateCount,
        cards,
        omittedCards,
    };
}

function normalizeWritableDeckID(deckID: string): string {
    return deckID === '' ? BUILTIN_DECK_ID : deckID;
}

function normalizeDeckBinding(value: string | undefined): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function getDeckID(deck: unknown): string | undefined {
    if (!deck || typeof deck !== 'object') return undefined;
    const typedDeck = deck as Record<string, unknown>;
    if (typeof typedDeck.id === 'string' && typedDeck.id.length > 0) return typedDeck.id;
    if (typeof typedDeck.deckID === 'string' && typedDeck.deckID.length > 0) return typedDeck.deckID;
    return undefined;
}

async function getBlockAttrsSafe(client: SiYuanClient, blockID: string): Promise<BlockAttrMap> {
    const attrs = await attributeApi.getBlockAttrs(client, blockID);
    return attrs && typeof attrs === 'object' ? attrs : {};
}

async function ensureFlashcardTargetsWritable(client: SiYuanClient, blockIDs: string[]): Promise<void> {
    for (const blockID of blockIDs) {
        const attrs = await getBlockAttrsSafe(client, blockID);
        if (attrs.type === 'doc') {
            throw new Error(`Block "${blockID}" is a document block and cannot be turned into a flashcard. Pass a content block ID such as a paragraph or heading instead.`);
        }
    }
}

async function ensureDeckAvailable(client: SiYuanClient, deckID: string, action: 'create_card' | 'remove_card'): Promise<void> {
    if (deckID === BUILTIN_DECK_ID) return;
    const result = await flashcardApi.getRiffDecks(client);
    if (!Array.isArray(result) || !result.some((deck) => getDeckID(deck) === deckID)) {
        throw new Error(`flashcard/${action} requires an existing deckID. Deck "${deckID}" was not found.`);
    }
}

async function verifyFlashcardBindings(client: SiYuanClient, blockIDs: string[], deckID: string, action: 'create_card'): Promise<void> {
    for (const blockID of blockIDs) {
        const attrs = await getBlockAttrsSafe(client, blockID);
        const deckIDs = normalizeDeckBinding(attrs[NODE_ATTR_RIFF_DECKS]);
        if (!deckIDs.includes(deckID)) {
            throw new Error(`flashcard/${action} did not persist a valid deck binding for block "${blockID}". Expected ${NODE_ATTR_RIFF_DECKS} to include "${deckID}".`);
        }
    }
}

function extractFlashcardBlockResultEntries(result: { blocks?: flashcardApi.Flashcard[] } | null | undefined): flashcardApi.Flashcard[] {
    return Array.isArray(result?.blocks) ? result.blocks : [];
}

function getFlashcardResultBlockID(card: flashcardApi.Flashcard): string | undefined {
    return typeof card.id === 'string' && card.id.length > 0
        ? card.id
        : typeof card.blockID === 'string' && card.blockID.length > 0
            ? card.blockID
            : undefined;
}

function hasResolvedRiffCard(card: flashcardApi.Flashcard | undefined): boolean {
    if (!card || typeof card !== 'object') return false;
    if (typeof card.riffCardID === 'string' && card.riffCardID.length > 0) return true;
    return Boolean(card.riffCard);
}

async function verifyFlashcardDeckRecords(
    client: SiYuanClient,
    blockIDs: string[],
    mode: 'present' | 'absent',
    action: 'create_card' | 'remove_card',
): Promise<void> {
    const expected = new Set(blockIDs);
    for (let attempt = 0; attempt < FLASHCARD_BINDING_VERIFY_ATTEMPTS; attempt += 1) {
        const response = await flashcardApi.getRiffCardsByBlockIDs(client, blockIDs);
        const byBlockID = new Map<string, flashcardApi.Flashcard>();
        for (const card of extractFlashcardBlockResultEntries(response)) {
            const blockID = getFlashcardResultBlockID(card);
            if (blockID) byBlockID.set(blockID, card);
        }

        const satisfied = [...expected].every((blockID) => {
            const card = byBlockID.get(blockID);
            return mode === 'present' ? hasResolvedRiffCard(card) : !hasResolvedRiffCard(card);
        });
        if (satisfied) return;

        if (attempt < FLASHCARD_BINDING_VERIFY_ATTEMPTS - 1) {
            await sleep(FLASHCARD_BINDING_VERIFY_DELAY_MS);
        }
    }

    throw new Error(
        mode === 'present'
            ? `flashcard/${action} did not create readable riff card records for blocks: ${blockIDs.join(', ')}`
            : `flashcard/${action} did not fully remove readable riff card records for blocks: ${blockIDs.join(', ')}`,
    );
}

function normalizeGetCardsResult(result: flashcardApi.FlashcardGetCardsResult | null | undefined): flashcardApi.Flashcard[] {
    if (Array.isArray(result?.blocks)) return result.blocks;
    if (Array.isArray(result?.cards)) return result.cards;
    return [];
}

function isUnresolvedFlashcardBlock(card: flashcardApi.Flashcard): boolean {
    return (!card.type || card.type === '')
        && typeof card.content === 'string'
        && card.content.includes('不存在符合条件的内容块');
}

function needsGetCardsRetry(cards: flashcardApi.Flashcard[]): boolean {
    return cards.length > 0 && cards.some(isUnresolvedFlashcardBlock);
}

async function getStableRiffCards(
    client: SiYuanClient,
    deckID: string,
    page: number,
    pageSize?: number,
): Promise<flashcardApi.FlashcardGetCardsResult | null | undefined> {
    let lastResult = await flashcardApi.getRiffCards(client, deckID, page, pageSize);
    for (let attempt = 1; attempt < GET_CARDS_RETRY_ATTEMPTS; attempt += 1) {
        if (!needsGetCardsRetry(normalizeGetCardsResult(lastResult))) {
            return lastResult;
        }
        await sleep(GET_CARDS_RETRY_DELAY_MS);
        lastResult = await flashcardApi.getRiffCards(client, deckID, page, pageSize);
    }
    return lastResult;
}

const handleListCards: FlashcardActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FlashcardListCardsSchema.parse(rawArgs);
    const result = parsed.scope === 'all'
        ? await flashcardApi.getRiffDueCards(client, '', parsed.reviewedCards)
        : parsed.scope === 'deck'
            ? await flashcardApi.getRiffDueCards(client, parsed.deckID, parsed.reviewedCards)
            : parsed.scope === 'notebook'
                ? await flashcardApi.getNotebookRiffDueCards(client, parsed.notebook, parsed.reviewedCards)
                : await flashcardApi.getTreeRiffDueCards(client, parsed.rootID, parsed.reviewedCards);

    const safeResult = result ?? {} as flashcardApi.FlashcardListResult;
    const cards = filterCardsByState(Array.isArray(safeResult.cards) ? safeResult.cards : [], parsed.filter);
    return createJsonResult({
        ...safeResult,
        action: 'list_cards',
        scope: parsed.scope,
        filter: parsed.filter,
        ...(parsed.deckID ? { deckID: parsed.deckID } : {}),
        ...(parsed.notebook ? { notebook: parsed.notebook } : {}),
        ...(parsed.rootID ? { rootID: parsed.rootID } : {}),
        ...(parsed.reviewedCards !== undefined ? { reviewedCards: parsed.reviewedCards } : {}),
        cards: await hydrateFlashcardContent(client, permMgr, cards),
    });
};

const handleGetDecks: FlashcardActionHandler = async ({ client, rawArgs }) => {
    FlashcardGetDecksSchema.parse(rawArgs);
    const result = await flashcardApi.getRiffDecks(client);
    const decks = Array.isArray(result) ? [...result] : [];
    const hasBuiltinDeck = decks.some((deck) => {
        if (!deck || typeof deck !== 'object') return false;
        const typedDeck = deck as Record<string, unknown>;
        return typedDeck.id === BUILTIN_DECK_ID || typedDeck.deckID === BUILTIN_DECK_ID;
    });
    if (!hasBuiltinDeck) {
        decks.unshift({
            id: BUILTIN_DECK_ID,
            deckID: BUILTIN_DECK_ID,
            name: BUILTIN_DECK_NAME,
            builtin: true,
        });
    }
    return createJsonResult({
        action: 'get_decks',
        decks,
    });
};

const handleGetCards: FlashcardActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FlashcardGetCardsSchema.parse(rawArgs);
    const result = await getStableRiffCards(client, parsed.deckID, parsed.page ?? 1, parsed.pageSize);
    const cards = normalizeGetCardsResult(result);
    return createJsonResult({
        action: 'get_cards',
        deckID: parsed.deckID,
        page: parsed.page ?? 1,
        ...(parsed.pageSize !== undefined ? { pageSize: parsed.pageSize } : {}),
        cards: await hydrateFlashcardContent(client, permMgr, cards),
        total: result?.total,
        pageCount: result?.pageCount,
    });
};

const handleReviewCard: FlashcardActionHandler = async ({ client, rawArgs }) => {
    const parsed = FlashcardReviewCardSchema.parse(rawArgs);
    if (parsed.deckID === '') {
        throw new Error('flashcard/review_card requires a concrete deckID. Use flashcard/get_cards first to resolve the card deck, then retry.');
    }
    if (parsed.skip === true) {
        const result = await flashcardApi.skipReviewRiffCard(client, parsed.deckID, parsed.cardID);
        return createJsonResult({
            action: 'review_card',
            skip: true,
            deckID: parsed.deckID,
            cardID: parsed.cardID,
            result,
        });
    }
    const result = await flashcardApi.reviewRiffCard(client, parsed.deckID, parsed.cardID, parsed.rating!, parsed.reviewedCards);
    return createJsonResult({
        action: 'review_card',
        deckID: parsed.deckID,
        cardID: parsed.cardID,
        rating: parsed.rating!,
        ...(parsed.reviewedCards !== undefined ? { reviewedCards: parsed.reviewedCards } : {}),
        result,
    });
};

const handleCreateCard: FlashcardActionHandler = async ({ client, rawArgs }) => {
    const parsed = FlashcardCreateCardSchema.parse(rawArgs);
    const deckID = normalizeWritableDeckID(parsed.deckID);
    await ensureFlashcardTargetsWritable(client, parsed.blockIDs);
    await ensureDeckAvailable(client, deckID, 'create_card');
    const mode = parsed.mode ?? 'full';
    const result = await flashcardApi.addRiffCards(client, deckID, parsed.blockIDs);
    await verifyFlashcardBindings(client, parsed.blockIDs, deckID, 'create_card');
    if (deckID === BUILTIN_DECK_ID) {
        await verifyFlashcardDeckRecords(client, parsed.blockIDs, 'present', 'create_card');
    }
    return createJsonResult({
        action: 'create_card',
        mode,
        deckID: parsed.deckID,
        effectiveDeckID: deckID,
        blockIDs: parsed.blockIDs,
        result,
    });
};

const handleRemoveCard: FlashcardActionHandler = async ({ client, rawArgs }) => {
    const parsed = FlashcardRemoveCardSchema.parse(rawArgs);
    const deckID = normalizeWritableDeckID(parsed.deckID);
    await ensureDeckAvailable(client, deckID, 'remove_card');
    const result = await flashcardApi.removeRiffCards(client, deckID, parsed.blockIDs);
    if (deckID === BUILTIN_DECK_ID) {
        await verifyFlashcardDeckRecords(client, parsed.blockIDs, 'absent', 'remove_card');
    }
    return createJsonResult({
        action: 'remove_card',
        deckID: parsed.deckID,
        effectiveDeckID: deckID,
        blockIDs: parsed.blockIDs,
        result,
    });
};

export const FLASHCARD_ACTION_HANDLERS: Record<FlashcardAction, FlashcardActionHandler> = {
    list_cards: handleListCards,
    get_decks: handleGetDecks,
    get_cards: handleGetCards,
    review_card: handleReviewCard,
    create_card: handleCreateCard,
    remove_card: handleRemoveCard,
};
