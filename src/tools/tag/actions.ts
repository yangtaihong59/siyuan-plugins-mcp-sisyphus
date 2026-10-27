import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every tag action, declared once; core config, defaults and write-safety policy derive from it. */
export const TAG_ACTION_SPECS = defineActionSpecs({
    list: { tier: 'basic', policy: read(), defaultEnabled: true },
    rename: { tier: 'basic', policy: mutation('manifest'), defaultEnabled: true },
    remove: { tier: 'advanced', policy: mutation('manifest'), defaultEnabled: true, dangerous: true },
});
