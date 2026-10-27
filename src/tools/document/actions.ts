import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every document action, declared once; core config, defaults and write-safety policy derive from it. */
export const DOCUMENT_ACTION_SPECS = defineActionSpecs({
    create: { tier: 'basic', policy: mutation(), defaultEnabled: true },
    lookup: { tier: 'basic', policy: read(), defaultEnabled: true },
    query: { tier: 'basic', policy: read(), defaultEnabled: true },
    ensure_link_targets: { tier: 'advanced', policy: mutation('structure'), defaultEnabled: true },
    rename: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    remove: { tier: 'advanced', policy: mutation('state'), defaultEnabled: false, dangerous: true },
    move: { tier: 'advanced', policy: mutation('structure'), defaultEnabled: true, dangerous: true },
    reorder: { tier: 'advanced', policy: mutation('structure'), defaultEnabled: true },
    get_child_blocks: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_child_docs: { tier: 'basic', policy: read(), defaultEnabled: true },
    set_attr: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    list_tree: { tier: 'advanced', policy: read(), defaultEnabled: true },
    search_docs: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_doc: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_outline: { tier: 'basic', policy: read(), defaultEnabled: true },
    create_daily_note: { tier: 'advanced', policy: mutation(), defaultEnabled: true },
    duplicate: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    heading_to_doc: { tier: 'advanced', policy: mutation('structure'), defaultEnabled: true },
    doc_to_heading: { tier: 'advanced', policy: mutation('structure'), defaultEnabled: true },
});
