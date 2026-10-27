import { z } from "zod";
import { FLASHCARD_ACTIONS } from "../../core/config";

export const FlashcardActionSchema = z.enum(FLASHCARD_ACTIONS);

const FlashcardScopeSchema = z.enum(["all", "deck", "notebook", "tree"]);

const FlashcardFilterSchema = z.enum(["due", "new", "old"]);

export const FlashcardListCardsSchema = z.object({
    action: z.literal("list_cards"),
    scope: FlashcardScopeSchema.describe('Query scope: "all", "deck", "notebook", or "tree"'),
    filter: FlashcardFilterSchema.default('due').describe('Filter returned cards: "due" (default), "new", or "old"'),
    deckID: z.string().optional().describe('Deck ID, required when scope=deck. For scope="all", omit deckID; an empty string is treated as omitted.'),
    notebook: z.string().optional().describe("Notebook ID, required when scope=notebook"),
    rootID: z.string().optional().describe("Root document/block ID, required when scope=tree"),
    reviewedCards: z.array(z.object({
        cardID: z.string().describe("Reviewed card ID"),
    }).passthrough()).optional().describe("Optional already-reviewed cards; SiYuan reads reviewedCards[].cardID"),
}).superRefine((value, ctx) => {
    const hasDeck = typeof value.deckID === "string" && value.deckID.length > 0;
    const hasNotebook = typeof value.notebook === "string";
    const hasRoot = typeof value.rootID === "string";

    if (value.scope === "all" && (hasDeck || hasNotebook || hasRoot)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scope="all" does not accept deckID, notebook, or rootID.' });
    }
    if (value.scope === "deck" && !hasDeck) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deckID"], message: 'deckID is required when scope="deck".' });
    }
    if (value.scope === "notebook" && !hasNotebook) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["notebook"], message: 'notebook is required when scope="notebook".' });
    }
    if (value.scope === "tree" && !hasRoot) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rootID"], message: 'rootID is required when scope="tree".' });
    }
});

export const FlashcardGetDecksSchema = z.object({
    action: z.literal("get_decks"),
});

export const FlashcardReviewCardSchema = z.object({
    action: z.literal("review_card"),
    deckID: z.string().describe("Deck ID"),
    cardID: z.string().describe("Card ID"),
    rating: z.number().optional().describe("Review rating passed through to the kernel"),
    skip: z.boolean().optional().describe("When true, skip the current card instead of submitting a rating"),
    reviewedCards: z.array(z.object({
        cardID: z.string().describe("Reviewed card ID"),
    }).passthrough()).optional().describe("Optional already-reviewed cards; SiYuan reads reviewedCards[].cardID"),
}).superRefine((value, ctx) => {
    if (value.skip !== true && value.rating === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rating is required unless skip=true.", path: ["rating"] });
    }
});

export const FlashcardCreateCardSchema = z.object({
    action: z.literal("create_card"),
    deckID: z.string().describe("Deck ID"),
    blockIDs: z.array(z.string()).min(1).describe("Existing block IDs to turn into flashcards"),
    mode: z.enum(["full", "attach"]).optional().describe('Compatibility option. SiYuan addRiffCards writes deck attrs and registers cards in both modes.'),
});

export const FlashcardRemoveCardSchema = z.object({
    action: z.literal("remove_card"),
    deckID: z.string().describe("Deck ID"),
    blockIDs: z.array(z.string()).min(1).describe("Existing block IDs to remove from flashcards"),
});

export const FlashcardGetCardsSchema = z.object({
    action: z.literal("get_cards"),
    deckID: z.string().describe("Deck ID (use empty string to query across all decks)"),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).max(512).optional().describe("Cards per page, default 32"),
});
