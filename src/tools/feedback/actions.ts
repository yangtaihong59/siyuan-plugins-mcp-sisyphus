import { defineActionSpecs, external } from '../../core/action-spec';

/** Every feedback action, declared once; core config, defaults and write-safety policy derive from it. */
export const FEEDBACK_ACTION_SPECS = defineActionSpecs({
    submit: { tier: 'basic', policy: external(), defaultEnabled: true },
});
