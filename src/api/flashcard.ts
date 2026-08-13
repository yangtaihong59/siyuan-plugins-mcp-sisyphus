import { SiYuanClient } from './client';

export interface Flashcard {
    deckID?: string;
    cardID?: string;
    blockID?: string;
    front?: string;
    back?: string;
    review?: {
        kind: 'heading' | 'cloze' | 'super-block' | 'list' | 'plain';
        prompt: string;
        referenceAnswer: string;
        gradable: boolean;
    };
    lapses?: number;
    reps?: number;
    state?: number | string;
    lastReview?: number;
    nextDues?: number[];
    [key: string]: unknown;
}

export interface FlashcardListResult {
    cards: Flashcard[];
    unreviewedCount?: number;
    unreviewedNewCardCount?: number;
    unreviewedOldCardCount?: number;
    [key: string]: unknown;
}

export interface FlashcardGetCardsResult {
    blocks?: Flashcard[];
    cards?: Flashcard[];
    total?: number;
    pageCount?: number;
    [key: string]: unknown;
}

export interface FlashcardDeck {
    id?: string;
    deckID?: string;
    name?: string;
    [key: string]: unknown;
}

export async function getRiffDecks(client: SiYuanClient): Promise<unknown> {
    return client.requestRead('/api/riff/getRiffDecks', {});
}

export async function getRiffDueCards(
    client: SiYuanClient,
    deckID?: string,
    reviewedCards?: Array<{ cardID: string; [key: string]: unknown }>,
): Promise<FlashcardListResult> {
    return client.requestRead<FlashcardListResult>('/api/riff/getRiffDueCards', {
        deckID: deckID ?? '',
        ...(reviewedCards !== undefined ? { reviewedCards } : {}),
    });
}

export async function getNotebookRiffDueCards(
    client: SiYuanClient,
    notebook: string,
    reviewedCards?: Array<{ cardID: string; [key: string]: unknown }>,
): Promise<FlashcardListResult> {
    return client.requestRead<FlashcardListResult>('/api/riff/getNotebookRiffDueCards', {
        notebook,
        ...(reviewedCards !== undefined ? { reviewedCards } : {}),
    });
}

export async function getTreeRiffDueCards(
    client: SiYuanClient,
    rootID: string,
    reviewedCards?: Array<{ cardID: string; [key: string]: unknown }>,
): Promise<FlashcardListResult> {
    return client.requestRead<FlashcardListResult>('/api/riff/getTreeRiffDueCards', {
        rootID,
        ...(reviewedCards !== undefined ? { reviewedCards } : {}),
    });
}

export async function reviewRiffCard(
    client: SiYuanClient,
    deckID: string,
    cardID: string,
    rating: number,
    reviewedCards?: Array<{ cardID: string; [key: string]: unknown }>,
): Promise<unknown> {
    return client.requestWrite('/api/riff/reviewRiffCard', {
        deckID,
        cardID,
        rating,
        ...(reviewedCards !== undefined ? { reviewedCards } : {}),
    });
}

export async function skipReviewRiffCard(
    client: SiYuanClient,
    deckID: string,
    cardID: string,
): Promise<unknown> {
    return client.requestWrite('/api/riff/skipReviewRiffCard', { deckID, cardID });
}

export async function addRiffCards(
    client: SiYuanClient,
    deckID: string,
    blockIDs: string[],
): Promise<unknown> {
    return client.requestWrite('/api/riff/addRiffCards', { deckID, blockIDs });
}

export async function removeRiffCards(
    client: SiYuanClient,
    deckID: string,
    blockIDs: string[],
): Promise<unknown> {
    return client.requestWrite('/api/riff/removeRiffCards', { deckID, blockIDs });
}

export async function getRiffCards(
    client: SiYuanClient,
    deckID: string,
    page: number,
    pageSize?: number,
): Promise<FlashcardGetCardsResult> {
    return client.requestRead<FlashcardGetCardsResult>('/api/riff/getRiffCards', {
        id: deckID,
        page,
        ...(pageSize !== undefined ? { pageSize } : {}),
    });
}

export async function getRiffCardsByBlockIDs(
    client: SiYuanClient,
    blockIDs: string[],
): Promise<{ blocks?: Flashcard[] }> {
    return client.requestRead<{ blocks?: Flashcard[] }>('/api/riff/getRiffCardsByBlockIDs', { blockIDs });
}
