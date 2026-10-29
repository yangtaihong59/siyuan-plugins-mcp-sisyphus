/** Per-App view state. Objects are shared and mutated by index.ts; nothing here renders. */
import type { JsonObject } from './format';

export interface ReviewTrace {
    deckID: string;
    cardID: string;
    prompt: string;
    referenceAnswer: string;
    rating: number;
    elapsedMs: number;
}

export const flashcardState = {
    cards: [] as JsonObject[],
    index: 0,
    revealed: false,
    selectionReason: '',
    omittedCards: [] as JsonObject[],
    cardStartedAt: Date.now(),
    reviewedCards: [] as Array<{ cardID: string; rating: number }>,
    traces: [] as ReviewTrace[],
    teachingSent: false,
    appActions: new Set<string>(),
};

export const timelineState = {
    documentId: '',
    nodes: [] as JsonObject[],
    comparison: undefined as JsonObject | undefined,
    page: 1,
    appActions: new Set<string>(),
};

export const shopState = {
    balance: undefined as number | undefined,
    totalEarned: undefined as number | undefined,
    items: [] as JsonObject[],
    pendingItems: [] as JsonObject[],
    appActions: new Set<string>(),
};
