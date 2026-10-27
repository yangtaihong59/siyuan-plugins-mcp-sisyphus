import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every timeline action, declared once; core config, defaults and write-safety policy derive from it. */
export const TIMELINE_ACTION_SPECS = defineActionSpecs({
    list_nodes: { tier: 'basic', policy: read(), defaultEnabled: true },
    create_node: { tier: 'basic', policy: mutation(), defaultEnabled: true },
    compare_node: { tier: 'basic', policy: read(), defaultEnabled: true },
    delete_node: { tier: 'advanced', policy: mutation('state'), defaultEnabled: false, dangerous: true },
    rollback_document: { tier: 'advanced', policy: mutation('state'), defaultEnabled: false, dangerous: true },
    rollback_block: { tier: 'advanced', policy: mutation('state'), defaultEnabled: false, dangerous: true },
});
