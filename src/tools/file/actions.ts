import { defineActionSpecs, external, mutation, read } from '../../core/action-spec';

/** Every file action, declared once; core config, defaults and write-safety policy derive from it. */
export const FILE_ACTION_SPECS = defineActionSpecs({
    upload_asset: { tier: 'basic', policy: mutation('source'), defaultEnabled: true, dangerous: true },
    list_templates: { tier: 'basic', policy: read(), defaultEnabled: true },
    read_template: { tier: 'basic', policy: read(), defaultEnabled: true },
    create_template: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    update_template: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    delete_template: { tier: 'advanced', policy: mutation('state'), defaultEnabled: false, dangerous: true },
    save_doc_as_template: { tier: 'basic', policy: mutation('state'), defaultEnabled: true },
    render: { tier: 'advanced', policy: read(), defaultEnabled: true },
    export_md: { tier: 'basic', policy: read(), defaultEnabled: true },
    export_markdown_snapshot: { tier: 'basic', policy: read(), defaultEnabled: true },
    export_resources: { tier: 'advanced', policy: external(), defaultEnabled: true },
    list_unused_assets: { tier: 'advanced', policy: read(), defaultEnabled: true },
    get_doc_assets: { tier: 'basic', policy: read(), defaultEnabled: true },
    audit_image_refs: { tier: 'basic', policy: read(), defaultEnabled: true },
    read_image: { tier: 'basic', policy: read(), defaultEnabled: true },
    get_image_ocr_text: { tier: 'advanced', policy: read(), defaultEnabled: true },
    remove_unused_assets: { tier: 'advanced', policy: mutation('manifest'), defaultEnabled: true, dangerous: true },
    rename_asset: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true },
    delete_asset: { tier: 'advanced', policy: mutation('state'), defaultEnabled: true, dangerous: true },
    extract_doc: { tier: 'basic', policy: external(), defaultEnabled: true },
});
