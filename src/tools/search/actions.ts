import { defineActionSpecs, mutation, read } from '../../core/action-spec';

/** Every search action, declared once; core config, defaults and write-safety policy derive from it. */
export const SEARCH_ACTION_SPECS = defineActionSpecs({
    fulltext: { tier: 'basic', policy: read(), defaultEnabled: true },
    semantic: { tier: 'basic', policy: read(), defaultEnabled: true },
    query_sql: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_backlinks: { tier: 'basic', policy: read(), defaultEnabled: true },
    search_refs: { tier: 'advanced', policy: read(), defaultEnabled: true },
    find_replace: { tier: 'advanced', policy: mutation('manifest'), defaultEnabled: true, dangerous: true },
    search_assets: { tier: 'advanced', policy: read(), defaultEnabled: true },
    fulltext_asset_content: { tier: 'advanced', policy: read(), defaultEnabled: true },
    list_invalid_refs: { tier: 'advanced', policy: read(), defaultEnabled: true },
});
