<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import SettingPanel from "../libs/components/setting-panel.svelte";
    import { getFile, putFile } from "../api";

    // Props from plugin
    export let plugin: any;

    // Config file path in SiYuan data directory
    const CONFIG_FILE_PATH = "/plugins/siyuan-mcp-sisyphus/mcp-tools.json";

    // Tool key mapping: internal key -> display key
    const toolKeyMap: Record<string, string> = {
        // Notebooks
        'notebooks_list_notebooks': 'list_notebooks',
        'notebooks_create_notebook': 'create_notebook',
        'notebooks_open_notebook': 'open_notebook',
        'notebooks_close_notebook': 'close_notebook',
        'notebooks_remove_notebook': 'remove_notebook',
        'notebooks_rename_notebook': 'rename_notebook',
        'notebooks_get_notebook_conf': 'get_notebook_conf',
        'notebooks_set_notebook_conf': 'set_notebook_conf',
        // Documents
        'documents_create_document': 'create_document',
        'documents_rename_document': 'rename_document',
        'documents_rename_document_by_id': 'rename_document_by_id',
        'documents_remove_document': 'remove_document',
        'documents_remove_document_by_id': 'remove_document_by_id',
        'documents_move_documents': 'move_documents',
        'documents_move_documents_by_id': 'move_documents_by_id',
        'documents_get_document_path': 'get_document_path',
        'documents_get_hpath_by_path': 'get_hpath_by_path',
        'documents_get_hpath_by_id': 'get_hpath_by_id',
        'documents_get_ids_by_hpath': 'get_ids_by_hpath',
        // Blocks
        'blocks_insert_block': 'insert_block',
        'blocks_prepend_block': 'prepend_block',
        'blocks_append_block': 'append_block',
        'blocks_update_block': 'update_block',
        'blocks_delete_block': 'delete_block',
        'blocks_move_block': 'move_block',
        'blocks_fold_block': 'fold_block',
        'blocks_unfold_block': 'unfold_block',
        'blocks_get_block_kramdown': 'get_block_kramdown',
        'blocks_get_child_blocks': 'get_child_blocks',
        'blocks_transfer_block_ref': 'transfer_block_ref',
        'blocks_set_block_attrs': 'set_block_attrs',
        'blocks_get_block_attrs': 'get_block_attrs',
        // Files
        'files_upload_asset': 'upload_asset',
        'files_render_template': 'render_template',
        'files_render_sprig': 'render_sprig',
        'files_export_md_content': 'export_md_content',
        'files_export_resources': 'export_resources',
        'files_push_msg': 'push_msg',
        'files_push_err_msg': 'push_err_msg',
        'files_get_version': 'get_version',
        'files_get_current_time': 'get_current_time',
    };

    // Default config (all tools enabled, except dangerous delete operations)
    const defaultConfig: Record<string, boolean> = {};
    Object.values(toolKeyMap).forEach(key => {
        defaultConfig[key] = true;
    });
    // Disable dangerous delete operations by default
    defaultConfig['remove_notebook'] = false;
    defaultConfig['remove_document'] = false;
    defaultConfig['remove_document_by_id'] = false;
    defaultConfig['delete_block'] = false;

    // Current config - reactive
    let config: Record<string, boolean> = { ...defaultConfig };

    // Groups - use i18n
    const defaultGroups = ["📚 Notebooks", "📝 Documents", "🧱 Blocks", "📁 Files"];
    let groups: string[] = defaultGroups;
    let focusGroup = defaultGroups[0];
    
    // Update groups when plugin.i18n is available
    $: if (plugin?.i18n && plugin.i18n.Notebooks) {
        groups = [
            `📚 ${plugin.i18n.Notebooks}`,
            `📝 ${plugin.i18n.Documents}`,
            `🧱 ${plugin.i18n.Blocks}`,
            `📁 ${plugin.i18n.Files}`
        ];
        // Update focusGroup if current one is not in new groups
        if (!groups.includes(focusGroup)) {
            focusGroup = groups[0];
        }
    }

    // Save config to file system
    async function saveConfigToFile(): Promise<boolean> {
        try {
            const dirPath = "/plugins/siyuan-mcp-sisyphus";
            const configContent = JSON.stringify(config, null, 2);
            // Create directory by putting an empty file first
            await putFile(dirPath, true, new Blob([]));
            // Save config file
            await putFile(CONFIG_FILE_PATH, false, new Blob([configContent], { type: "application/json" }));
            console.debug('Saved config to file:', CONFIG_FILE_PATH);
            return true;
        } catch (error) {
            console.error('Failed to save config to file:', error);
            return false;
        }
    }

    // Load config from file system
    async function loadConfigFromFile(): Promise<Record<string, boolean> | null> {
        try {
            const content = await getFile(CONFIG_FILE_PATH);
            if (content) {
                const parsed = JSON.parse(content);
                console.debug('Loaded config from file:', CONFIG_FILE_PATH);
                return parsed;
            }
            return null;
        } catch (error) {
            // File may not exist yet, which is fine
            console.debug('No config file found, using defaults');
            return null;
        }
    }

    // Load saved config on mount - prioritize file system
    onMount(async () => {
        if (plugin) {
            // Try loading from file system first
            const fileConfig = await loadConfigFromFile();
            if (fileConfig) {
                config = { ...defaultConfig, ...fileConfig };
            } else {
                // Fallback to plugin data storage
                const saved = await plugin.loadData('mcpToolsConfig');
                if (saved) {
                    config = { ...defaultConfig, ...saved };
                }
            }
            updateCheckboxValues();
        }
    });

    // Update all checkbox values in the setting items
    function updateCheckboxValues() {
        // Trigger reactive updates by reassigning
        if (plugin?.i18n) {
            notebooksItems = notebooksItems.map(item => ({
                ...item,
                value: config[toolKeyMap[item.key]] ?? defaultConfig[toolKeyMap[item.key]] ?? true
            }));
            documentsItems = documentsItems.map(item => ({
                ...item,
                value: config[toolKeyMap[item.key]] ?? defaultConfig[toolKeyMap[item.key]] ?? true
            }));
            blocksItems = blocksItems.map(item => ({
                ...item,
                value: config[toolKeyMap[item.key]] ?? defaultConfig[toolKeyMap[item.key]] ?? true
            }));
            filesItems = filesItems.map(item => ({
                ...item,
                value: config[toolKeyMap[item.key]] ?? defaultConfig[toolKeyMap[item.key]] ?? true
            }));
        }
    }

    // Notebooks: 8 tools - use i18n
    let notebooksItems: ISettingItem[] = [
        { type: 'checkbox', title: 'list_notebooks', description: 'List all notebooks in the workspace', key: 'notebooks_list_notebooks', value: true },
        { type: 'checkbox', title: 'create_notebook', description: 'Create a new notebook', key: 'notebooks_create_notebook', value: true },
        { type: 'checkbox', title: 'open_notebook', description: 'Open a notebook', key: 'notebooks_open_notebook', value: true },
        { type: 'checkbox', title: 'close_notebook', description: 'Close a notebook', key: 'notebooks_close_notebook', value: true },
        { type: 'checkbox', title: 'remove_notebook', description: 'Remove a notebook', key: 'notebooks_remove_notebook', value: false },
        { type: 'checkbox', title: 'rename_notebook', description: 'Rename a notebook', key: 'notebooks_rename_notebook', value: true },
        { type: 'checkbox', title: 'get_notebook_conf', description: 'Get notebook configuration', key: 'notebooks_get_notebook_conf', value: true },
        { type: 'checkbox', title: 'set_notebook_conf', description: 'Set notebook configuration', key: 'notebooks_set_notebook_conf', value: true },
    ];
    $: if (plugin?.i18n) {
        notebooksItems = [
        { type: 'checkbox', title: plugin.i18n.list_notebooks, description: plugin.i18n.desc_list_notebooks, key: 'notebooks_list_notebooks', value: true },
        { type: 'checkbox', title: plugin.i18n.create_notebook, description: plugin.i18n.desc_create_notebook, key: 'notebooks_create_notebook', value: true },
        { type: 'checkbox', title: plugin.i18n.open_notebook, description: plugin.i18n.desc_open_notebook, key: 'notebooks_open_notebook', value: true },
        { type: 'checkbox', title: plugin.i18n.close_notebook, description: plugin.i18n.desc_close_notebook, key: 'notebooks_close_notebook', value: true },
        { type: 'checkbox', title: plugin.i18n.remove_notebook, description: plugin.i18n.desc_remove_notebook, key: 'notebooks_remove_notebook', value: false },
        { type: 'checkbox', title: plugin.i18n.rename_notebook, description: plugin.i18n.desc_rename_notebook, key: 'notebooks_rename_notebook', value: true },
        { type: 'checkbox', title: plugin.i18n.get_notebook_conf, description: plugin.i18n.desc_get_notebook_conf, key: 'notebooks_get_notebook_conf', value: true },
        { type: 'checkbox', title: plugin.i18n.set_notebook_conf, description: plugin.i18n.desc_set_notebook_conf, key: 'notebooks_set_notebook_conf', value: true },
        ];
    }

    // Documents: 11 tools - use i18n
    let documentsItems: ISettingItem[] = [
        { type: 'checkbox', title: 'create_document', description: 'Create a new document with markdown content', key: 'documents_create_document', value: true },
        { type: 'checkbox', title: 'rename_document', description: 'Rename a document by path', key: 'documents_rename_document', value: true },
        { type: 'checkbox', title: 'rename_document_by_id', description: 'Rename a document by ID', key: 'documents_rename_document_by_id', value: true },
        { type: 'checkbox', title: 'remove_document', description: 'Remove a document by path', key: 'documents_remove_document', value: false },
        { type: 'checkbox', title: 'remove_document_by_id', description: 'Remove a document by ID', key: 'documents_remove_document_by_id', value: false },
        { type: 'checkbox', title: 'move_documents', description: 'Move multiple documents to a new location', key: 'documents_move_documents', value: true },
        { type: 'checkbox', title: 'move_documents_by_id', description: 'Move multiple documents by ID', key: 'documents_move_documents_by_id', value: true },
        { type: 'checkbox', title: 'get_document_path', description: 'Get file path by document ID', key: 'documents_get_document_path', value: true },
        { type: 'checkbox', title: 'get_hpath_by_path', description: 'Get hierarchical path by file path', key: 'documents_get_hpath_by_path', value: true },
        { type: 'checkbox', title: 'get_hpath_by_id', description: 'Get hierarchical path by document ID', key: 'documents_get_hpath_by_id', value: true },
        { type: 'checkbox', title: 'get_ids_by_hpath', description: 'Get document IDs by hierarchical path', key: 'documents_get_ids_by_hpath', value: true },
    ];
    $: if (plugin?.i18n) {
        documentsItems = [
        { type: 'checkbox', title: plugin.i18n.create_document, description: plugin.i18n.desc_create_document, key: 'documents_create_document', value: true },
        { type: 'checkbox', title: plugin.i18n.rename_document, description: plugin.i18n.desc_rename_document, key: 'documents_rename_document', value: true },
        { type: 'checkbox', title: plugin.i18n.rename_document_by_id, description: plugin.i18n.desc_rename_document_by_id, key: 'documents_rename_document_by_id', value: true },
        { type: 'checkbox', title: plugin.i18n.remove_document, description: plugin.i18n.desc_remove_document, key: 'documents_remove_document', value: false },
        { type: 'checkbox', title: plugin.i18n.remove_document_by_id, description: plugin.i18n.desc_remove_document_by_id, key: 'documents_remove_document_by_id', value: false },
        { type: 'checkbox', title: plugin.i18n.move_documents, description: plugin.i18n.desc_move_documents, key: 'documents_move_documents', value: true },
        { type: 'checkbox', title: plugin.i18n.move_documents_by_id, description: plugin.i18n.desc_move_documents_by_id, key: 'documents_move_documents_by_id', value: true },
        { type: 'checkbox', title: plugin.i18n.get_document_path, description: plugin.i18n.desc_get_document_path, key: 'documents_get_document_path', value: true },
        { type: 'checkbox', title: plugin.i18n.get_hpath_by_path, description: plugin.i18n.desc_get_hpath_by_path, key: 'documents_get_hpath_by_path', value: true },
        { type: 'checkbox', title: plugin.i18n.get_hpath_by_id, description: plugin.i18n.desc_get_hpath_by_id, key: 'documents_get_hpath_by_id', value: true },
        { type: 'checkbox', title: plugin.i18n.get_ids_by_hpath, description: plugin.i18n.desc_get_ids_by_hpath, key: 'documents_get_ids_by_hpath', value: true },
        ];
    }

    // Blocks: 13 tools - use i18n
    let blocksItems: ISettingItem[] = [
        { type: 'checkbox', title: 'insert_block', description: 'Insert a new block at specified position', key: 'blocks_insert_block', value: true },
        { type: 'checkbox', title: 'prepend_block', description: 'Insert a block at the beginning of parent', key: 'blocks_prepend_block', value: true },
        { type: 'checkbox', title: 'append_block', description: 'Insert a block at the end of parent', key: 'blocks_append_block', value: true },
        { type: 'checkbox', title: 'update_block', description: 'Update block content', key: 'blocks_update_block', value: true },
        { type: 'checkbox', title: 'delete_block', description: 'Delete a block', key: 'blocks_delete_block', value: false },
        { type: 'checkbox', title: 'move_block', description: 'Move a block to new position', key: 'blocks_move_block', value: true },
        { type: 'checkbox', title: 'fold_block', description: 'Fold a block (collapse children)', key: 'blocks_fold_block', value: true },
        { type: 'checkbox', title: 'unfold_block', description: 'Unfold a block (expand children)', key: 'blocks_unfold_block', value: true },
        { type: 'checkbox', title: 'get_block_kramdown', description: 'Get block content in kramdown format', key: 'blocks_get_block_kramdown', value: true },
        { type: 'checkbox', title: 'get_child_blocks', description: 'Get all child blocks of a parent', key: 'blocks_get_child_blocks', value: true },
        { type: 'checkbox', title: 'transfer_block_ref', description: 'Transfer block references', key: 'blocks_transfer_block_ref', value: true },
        { type: 'checkbox', title: 'set_block_attrs', description: 'Set block attributes', key: 'blocks_set_block_attrs', value: true },
        { type: 'checkbox', title: 'get_block_attrs', description: 'Get block attributes', key: 'blocks_get_block_attrs', value: true },
    ];
    $: if (plugin?.i18n) {
        blocksItems = [
        { type: 'checkbox', title: plugin.i18n.insert_block, description: plugin.i18n.desc_insert_block, key: 'blocks_insert_block', value: true },
        { type: 'checkbox', title: plugin.i18n.prepend_block, description: plugin.i18n.desc_prepend_block, key: 'blocks_prepend_block', value: true },
        { type: 'checkbox', title: plugin.i18n.append_block, description: plugin.i18n.desc_append_block, key: 'blocks_append_block', value: true },
        { type: 'checkbox', title: plugin.i18n.update_block, description: plugin.i18n.desc_update_block, key: 'blocks_update_block', value: true },
        { type: 'checkbox', title: plugin.i18n.delete_block, description: plugin.i18n.desc_delete_block, key: 'blocks_delete_block', value: false },
        { type: 'checkbox', title: plugin.i18n.move_block, description: plugin.i18n.desc_move_block, key: 'blocks_move_block', value: true },
        { type: 'checkbox', title: plugin.i18n.fold_block, description: plugin.i18n.desc_fold_block, key: 'blocks_fold_block', value: true },
        { type: 'checkbox', title: plugin.i18n.unfold_block, description: plugin.i18n.desc_unfold_block, key: 'blocks_unfold_block', value: true },
        { type: 'checkbox', title: plugin.i18n.get_block_kramdown, description: plugin.i18n.desc_get_block_kramdown, key: 'blocks_get_block_kramdown', value: true },
        { type: 'checkbox', title: plugin.i18n.get_child_blocks, description: plugin.i18n.desc_get_child_blocks, key: 'blocks_get_child_blocks', value: true },
        { type: 'checkbox', title: plugin.i18n.transfer_block_ref, description: plugin.i18n.desc_transfer_block_ref, key: 'blocks_transfer_block_ref', value: true },
        { type: 'checkbox', title: plugin.i18n.set_block_attrs, description: plugin.i18n.desc_set_block_attrs, key: 'blocks_set_block_attrs', value: true },
        { type: 'checkbox', title: plugin.i18n.get_block_attrs, description: plugin.i18n.desc_get_block_attrs, key: 'blocks_get_block_attrs', value: true },
        ];
    }

    // Files: 9 tools - use i18n
    let filesItems: ISettingItem[] = [
        { type: 'checkbox', title: 'upload_asset', description: 'Upload file to assets directory', key: 'files_upload_asset', value: true },
        { type: 'checkbox', title: 'render_template', description: 'Render a template with document context', key: 'files_render_template', value: true },
        { type: 'checkbox', title: 'render_sprig', description: 'Render a Sprig template', key: 'files_render_sprig', value: true },
        { type: 'checkbox', title: 'export_md_content', description: 'Export document as Markdown', key: 'files_export_md_content', value: true },
        { type: 'checkbox', title: 'export_resources', description: 'Export resources as ZIP', key: 'files_export_resources', value: true },
        { type: 'checkbox', title: 'push_msg', description: 'Push a notification message', key: 'files_push_msg', value: true },
        { type: 'checkbox', title: 'push_err_msg', description: 'Push an error message', key: 'files_push_err_msg', value: true },
        { type: 'checkbox', title: 'get_version', description: 'Get SiYuan version', key: 'files_get_version', value: true },
        { type: 'checkbox', title: 'get_current_time', description: 'Get current system time', key: 'files_get_current_time', value: true },
    ];
    $: if (plugin?.i18n) {
        filesItems = [
        { type: 'checkbox', title: plugin.i18n.upload_asset, description: plugin.i18n.desc_upload_asset, key: 'files_upload_asset', value: true },
        { type: 'checkbox', title: plugin.i18n.render_template, description: plugin.i18n.desc_render_template, key: 'files_render_template', value: true },
        { type: 'checkbox', title: plugin.i18n.render_sprig, description: plugin.i18n.desc_render_sprig, key: 'files_render_sprig', value: true },
        { type: 'checkbox', title: plugin.i18n.export_md_content, description: plugin.i18n.desc_export_md_content, key: 'files_export_md_content', value: true },
        { type: 'checkbox', title: plugin.i18n.export_resources, description: plugin.i18n.desc_export_resources, key: 'files_export_resources', value: true },
        { type: 'checkbox', title: plugin.i18n.push_msg, description: plugin.i18n.desc_push_msg, key: 'files_push_msg', value: true },
        { type: 'checkbox', title: plugin.i18n.push_err_msg, description: plugin.i18n.desc_push_err_msg, key: 'files_push_err_msg', value: true },
        { type: 'checkbox', title: plugin.i18n.get_version, description: plugin.i18n.desc_get_version, key: 'files_get_version', value: true },
        { type: 'checkbox', title: plugin.i18n.get_current_time, description: plugin.i18n.desc_get_current_time, key: 'files_get_current_time', value: true },
        ];
    }

    /********** Events **********/
    interface ChangeEvent {
        group: string;
        key: string;
        value: any;
    }

    const onChanged = async (event: CustomEvent<ChangeEvent>) => {
        const { group, key, value } = event.detail;
        console.debug(`Setting changed: ${group} - ${key} = ${value}`);

        // Update config
        const displayKey = toolKeyMap[key];
        if (displayKey) {
            config[displayKey] = value;
            // Save to file system
            await saveConfigToFile();
            // Also save to plugin data as backup
            if (plugin) {
                await plugin.saveData('mcpToolsConfig', config);
                console.debug('Saved mcpToolsConfig:', config);
            }
        }
    };

    // Public method to save settings (called by parent)
    export async function saveSettings() {
        // Save to file system
        const success = await saveConfigToFile();
        // Also save to plugin data as backup
        if (plugin) {
            await plugin.saveData('mcpToolsConfig', config);
        }
        if (success) {
            showMessage(plugin?.i18n?.mcpConfigSaved || '✅ MCP Tools configuration saved to file');
        } else {
            showMessage(plugin?.i18n?.mcpConfigSavedBackup || '⚠️ MCP Tools configuration saved (backup only)');
        }
    }

    // Public method to reset defaults
    export async function resetDefaults() {
        config = { ...defaultConfig };
        updateCheckboxValues();
        // Save to file system
        await saveConfigToFile();
        // Also save to plugin data as backup
        if (plugin) {
            await plugin.saveData('mcpToolsConfig', config);
        }
        showMessage(plugin?.i18n?.mcpConfigReset || '🔄 MCP Tools configuration reset to defaults');
    }
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <ul class="b3-tab-bar b3-list b3-list--background">
        {#each groups as group}
            <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
            <li
                data-name="mcp-config"
                class:b3-list-item--focus={group === focusGroup}
                class="b3-list-item"
                on:click={() => {
                    focusGroup = group;
                }}
                on:keydown={() => {}}
            >
                <span class="b3-list-item__text">{group}</span>
            </li>
        {/each}
    </ul>
    <div class="config__tab-wrap">
        <SettingPanel
            group={groups[0]}
            settingItems={notebooksItems}
            display={focusGroup === groups[0]}
            on:changed={onChanged}
        >
        </SettingPanel>
        <SettingPanel
            group={groups[1]}
            settingItems={documentsItems}
            display={focusGroup === groups[1]}
            on:changed={onChanged}
        >
        </SettingPanel>
        <SettingPanel
            group={groups[2]}
            settingItems={blocksItems}
            display={focusGroup === groups[2]}
            on:changed={onChanged}
        >
        </SettingPanel>
        <SettingPanel
            group={groups[3]}
            settingItems={filesItems}
            display={focusGroup === groups[3]}
            on:changed={onChanged}
        >
        </SettingPanel>
    </div>
</div>

<style lang="scss">
    .config__panel {
        height: 100%;
    }
    .config__panel > ul > li {
        padding-left: 1rem;
    }
    .config__tab-wrap {
        max-height: calc(100vh - 250px);
        overflow-y: auto;
        overflow-x: hidden;
        scroll-behavior: smooth;
    }
</style>
