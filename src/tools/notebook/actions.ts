import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every notebook action, declared once; core config, defaults and write-safety policy derive from it. */
export const NOTEBOOK_ACTION_SPECS = defineActionSpecs({
    list: { tier: 'basic', policy: read(), defaultEnabled: true },
    create: { tier: 'basic', policy: mutation(), defaultEnabled: true },
    set_open_state: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    remove: { tier: 'advanced', policy: mutation('state'), defaultEnabled: false, dangerous: true },
    rename: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    get_conf: { tier: 'basic', policy: read(), defaultEnabled: true },
    set_conf: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    set_icon: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    get_permissions: { tier: 'advanced', policy: read(), defaultEnabled: true },
    set_permission: { tier: 'advanced', policy: mutation('state'), defaultEnabled: false, dangerous: true },
    get_child_docs: { tier: 'basic', policy: read(), defaultEnabled: true },
});
