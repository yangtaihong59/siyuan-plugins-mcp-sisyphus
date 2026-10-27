import { defineActionSpecs, mutation, read } from '../../core/action-spec';

// Dangerous AV actions replace persistent configuration or can write a relation
// graph across databases; a normal AV write confirmation would hide their scope.
/** Every av action, declared once; core config, defaults and write-safety policy derive from it. */
export const AV_ACTION_SPECS = defineActionSpecs({
    search: { tier: 'basic', policy: read(), defaultEnabled: true },
    get: { tier: 'basic', policy: read(), defaultEnabled: true },
    query: { tier: 'basic', policy: read(), defaultEnabled: true },
    create: { tier: 'basic', policy: mutation(), defaultEnabled: true },
    add_rows: { tier: 'advanced', policy: mutation(), defaultEnabled: true },
    remove_rows: { tier: 'advanced', policy: mutation('manifest'), defaultEnabled: true },
    add_column: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    remove_column: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    set_cells: { tier: 'advanced', policy: mutation('manifest'), defaultEnabled: true },
    set_column_options: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
    duplicate_rows: { tier: 'advanced', policy: mutation('manifest'), defaultEnabled: true, dangerous: true },
    duplicate: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    // View configuration is a W2 mutation even though it does not edit
    // rows. A stale carrier can otherwise make the kernel fall back to a
    // different view, so every action requires the strict state lease.
    add_view: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    update_view: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
    set_new_item_templates: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
    create_from_template: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
    configure_two_way_relation: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
    configure_rollup: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
    set_relation: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
});
