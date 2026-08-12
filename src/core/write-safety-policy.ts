import {
    ACTIONS_BY_CATEGORY,
    type ToolActionMap,
    type ToolCategory,
} from './config';

export type WritePrecondition = 'none' | 'state' | 'structure' | 'value' | 'manifest' | 'source';

export type ActionSafetyPolicy =
    | { mode: 'read' }
    | { mode: 'external' }
    | {
        mode: 'mutation';
        precondition: WritePrecondition;
        validateOnly: boolean;
    };

const read = (): ActionSafetyPolicy => ({ mode: 'read' });
const external = (): ActionSafetyPolicy => ({ mode: 'external' });
const mutation = (
    precondition: WritePrecondition = 'none',
    validateOnly = precondition !== 'none',
): ActionSafetyPolicy => ({ mode: 'mutation', precondition, validateOnly });

/**
 * Authoritative classification for every Sisyphus-owned action. Adding an
 * action to config.ts without adding it here is a type/test failure instead
 * of silently exposing an unprotected mutation.
 */
export const ACTION_SAFETY_POLICIES: {
    [Category in ToolCategory]: Record<ToolActionMap[Category], ActionSafetyPolicy>;
} = {
    fs: {
        ls: read(), tree: read(), read: read(), search: read(),
        write: mutation('state'), replace: mutation('manifest'), rm: mutation('state'), mv: mutation('structure'),
    },
    notebook: {
        list: read(), get_conf: read(), get_permissions: read(), get_child_docs: read(),
        create: mutation(), set_open_state: mutation('state'), remove: mutation('state'), rename: mutation('state'),
        set_conf: mutation('state'), set_icon: mutation('state'), set_permission: mutation('state'),
    },
    document: {
        lookup: read(), get_child_blocks: read(), get_child_docs: read(), list_tree: read(), search_docs: read(),
        get_doc: read(), get_outline: read(),
        create: mutation(), create_daily_note: mutation(), duplicate: mutation('state'), rename: mutation('state'),
        remove: mutation('state'), move: mutation('structure'), set_attr: mutation('state'),
        heading_to_doc: mutation('structure'), doc_to_heading: mutation('structure'),
    },
    block: {
        get_kramdown: read(), batch_kramdown: read(), get_children: read(), get_attrs: read(), info: read(),
        breadcrumb: read(), dom: read(), recent_updated: read(), word_count: read(), docs_info: read(),
        insert: mutation(), prepend: mutation(), append: mutation(), add_to_daily_note: mutation(),
        update: mutation('state'), replace: mutation('state'), delete: mutation('state'), move: mutation('structure'),
        set_fold_state: mutation('state'), transfer_references: mutation('manifest'), set_attrs: mutation('state'),
    },
    av: {
        get: read(), render: mutation(), get_attribute_view_keys: read(), get_attribute_view_filter_sort: read(),
        search: read(), get_primary_key_values: read(),
        add_rows: mutation(), remove_rows: mutation('manifest'), add_column: mutation('state'),
        remove_column: mutation('state'), set_cells: mutation('manifest'), duplicate: mutation('state'),
    },
    file: {
        list_templates: read(), read_template: read(), render: read(), export_md: read(), list_unused_assets: read(),
        get_doc_assets: read(), get_image_ocr_text: read(),
        upload_asset: mutation('source'), create_template: mutation('state'), update_template: mutation('state'),
        delete_template: mutation('state'), save_doc_as_template: mutation('state'), export_resources: external(),
        remove_unused_assets: mutation('manifest'), rename_asset: mutation('state'), delete_asset: mutation('state'),
        extract_doc: external(),
    },
    search: {
        fulltext: read(), query_sql: read(), get_backlinks: read(), search_refs: read(), search_assets: read(),
        fulltext_asset_content: read(), list_invalid_refs: read(), find_replace: mutation('manifest'),
    },
    tag: { list: read(), rename: mutation('manifest'), remove: mutation('manifest') },
    timeline: {
        list_nodes: read(), compare_node: read(), create_node: mutation(), delete_node: mutation('state'),
        rollback_document: mutation('state'), rollback_block: mutation('state'),
    },
    system: {
        workspace_info: read(), network: read(), conf: read(), changelog: read(), get_version: read(),
        get_current_time: read(), notify: external(), perform_sync: external(),
    },
    flashcard: {
        list_cards: read(), get_decks: read(), get_cards: read(), review_card: mutation('state'),
        create_card: mutation(), remove_card: mutation('state'),
    },
    extension: { list: read(), validate_package: read(), diagnose_plugin_mcp: read() },
    mascot: { get_balance: read(), shop: read(), buy: mutation('state') },
    feedback: { submit: external() },
};

export const PRECONDITION_FIELD: Record<Exclude<WritePrecondition, 'none'>, string> = {
    state: 'expectedStateHash',
    structure: 'expectedStructureHash',
    value: 'expectedValueHash',
    manifest: 'expectedManifestHash',
    source: 'expectedSourceHash',
};

export function getActionSafetyPolicy(
    category: ToolCategory,
    action: string,
    args: Record<string, unknown> = {},
): ActionSafetyPolicy {
    // Dynamic official-MCP actions are external and may have unknown effects.
    // The named Sisyphus diagnostics above are local/read-only exceptions and
    // must remain declared in ACTION_SAFETY_POLICIES as the action set grows.
    if (category === 'extension'
        && action !== 'list'
        && action !== 'validate_package'
        && action !== 'diagnose_plugin_mcp'
        && action !== 'help') return external();
    const policy = (ACTION_SAFETY_POLICIES[category] as Record<string, ActionSafetyPolicy>)[action];
    if (!policy) return read();

    // Creating a new fs document is additive. Overwrite=true modifies an
    // existing document and therefore needs a current-state precondition.
    if (category === 'fs' && action === 'write' && args.overwrite !== true) {
        return mutation();
    }
    if (category === 'file' && action === 'create_template' && args.overwrite !== true) {
        return mutation();
    }
    // renderAttributeView is read-only unless the caller explicitly asks the
    // kernel to create a missing database.
    if (category === 'av' && action === 'render') {
        return args.createIfNotExist === true ? mutation() : read();
    }
    return policy;
}

export function assertActionSafetyPoliciesComplete(): void {
    for (const [category, actions] of Object.entries(ACTIONS_BY_CATEGORY) as Array<[
        ToolCategory,
        readonly string[],
    ]>) {
        const policies = ACTION_SAFETY_POLICIES[category] as Record<string, ActionSafetyPolicy>;
        for (const action of actions) {
            if (!policies[action]) throw new Error(`Missing write-safety policy for ${category}.${action}.`);
        }
    }
}
