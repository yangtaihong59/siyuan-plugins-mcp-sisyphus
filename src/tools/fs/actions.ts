import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every fs action, declared once; core config, defaults and write-safety policy derive from it. */
export const FS_ACTION_SPECS = defineActionSpecs({
    ls: { tier: 'basic', policy: read(), defaultEnabled: true },
    tree: { tier: 'basic', policy: read(), defaultEnabled: true },
    read: { tier: 'basic', policy: read(), defaultEnabled: true },
    write: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    replace: { tier: 'basic', policy: mutation('manifest'), defaultEnabled: true },
    rm: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
    mv: { tier: 'advanced', policy: mutation('structure'), defaultEnabled: true, dangerous: true },
    reorder: { tier: 'basic', policy: mutation('structure'), defaultEnabled: true },
    search: { tier: 'basic', policy: read(), defaultEnabled: true },
});
