import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every block action, declared once; core config, defaults and write-safety policy derive from it. */
export const BLOCK_ACTION_SPECS = defineActionSpecs({
    insert: { tier: 'basic', policy: mutation(), defaultEnabled: true },
    prepend: { tier: 'basic', policy: mutation(), defaultEnabled: true },
    append: { tier: 'basic', policy: mutation(), defaultEnabled: true },
    update: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    replace: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    delete: { tier: 'advanced', policy: mutation('state'), defaultEnabled: false, dangerous: true },
    move: { tier: 'advanced', policy: mutation('structure'), defaultEnabled: true, dangerous: true },
    set_fold_state: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    get_kramdown: { tier: 'basic', policy: read(), defaultEnabled: true },
    batch_kramdown: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_children: { tier: 'basic', policy: read(), defaultEnabled: true },
    transfer_references: { tier: 'advanced', policy: mutation('manifest'), defaultEnabled: true },
    set_attrs: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    get_attrs: { tier: 'basic', policy: read(), defaultEnabled: true },
    info: { tier: 'basic', policy: read(), defaultEnabled: true },
    breadcrumb: { tier: 'advanced', policy: read(), defaultEnabled: true },
    dom: { tier: 'advanced', policy: read(), defaultEnabled: true },
    recent_updated: { tier: 'advanced', policy: read(), defaultEnabled: true },
    word_count: { tier: 'advanced', policy: read(), defaultEnabled: true },
    add_to_daily_note: { tier: 'advanced', policy: mutation(), defaultEnabled: true },
    docs_info: { tier: 'advanced', policy: read(), defaultEnabled: true },
});
