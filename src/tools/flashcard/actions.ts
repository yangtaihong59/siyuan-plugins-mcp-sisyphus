import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every flashcard action, declared once; core config, defaults and write-safety policy derive from it. */
export const FLASHCARD_ACTION_SPECS = defineActionSpecs({
    list_cards: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_decks: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_cards: { tier: 'basic', policy: read(), defaultEnabled: true },
    review_card: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    create_card: { tier: 'advanced', policy: mutation(), defaultEnabled: true },
    remove_card: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
});
