import type { FlashcardAction } from '../../core/config';
import { FLASHCARD_ACTION_HINTS, FLASHCARD_GUIDANCE } from '../../core/help';
import {
    FlashcardActionSchema,
    FlashcardCreateCardSchema,
    FlashcardGetCardsSchema,
    FlashcardGetDecksSchema,
    FlashcardListCardsSchema,
    FlashcardRemoveCardSchema,
    FlashcardReviewCardSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant } from '../internal/shared';
import { FLASHCARD_ACTION_HANDLERS } from './handlers';

export const FLASHCARD_TOOL_NAME = 'flashcard';

export const FLASHCARD_VARIANTS: ActionVariant<FlashcardAction>[] = [
    createZodActionVariant('list_cards', FlashcardListCardsSchema, 'List due flashcards and optionally filter to new/old cards.'),
    createZodActionVariant('get_decks', FlashcardGetDecksSchema, 'Get flashcard deck definitions.'),
    createZodActionVariant('get_cards', FlashcardGetCardsSchema, 'List all cards in a deck with pagination (not limited to due cards).'),
    createZodActionVariant('review_card', FlashcardReviewCardSchema, 'Submit a review result or skip one flashcard.'),
    createZodActionVariant('create_card', FlashcardCreateCardSchema, 'Turn existing blocks into flashcards or attach existing blocks to a deck.'),
    createZodActionVariant('remove_card', FlashcardRemoveCardSchema, 'Remove existing blocks from a flashcard deck.'),
];

const flashcardTool = defineTool<FlashcardAction>({
    name: 'flashcard',
    description: '🃏 Flashcards: list decks and due cards, review with a 1-4 rating, turn content blocks into cards (create_card), remove cards from a deck.',
    variants: FLASHCARD_VARIANTS,
    actionSchema: FlashcardActionSchema,
    aggregateOptions: {
        guidance: FLASHCARD_GUIDANCE,
        actionHints: FLASHCARD_ACTION_HINTS,
    },
    handlers: FLASHCARD_ACTION_HANDLERS,
});

export const listFlashcardTools = flashcardTool.listTools;
export const callFlashcardTool = flashcardTool.callTool;
