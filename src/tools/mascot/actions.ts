import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every mascot action, declared once; core config, defaults and write-safety policy derive from it. */
export const MASCOT_ACTION_SPECS = defineActionSpecs({
    get_balance: { tier: 'basic', policy: read(), defaultEnabled: true },
    shop: { tier: 'basic', policy: read(), defaultEnabled: true },
    buy: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
});
