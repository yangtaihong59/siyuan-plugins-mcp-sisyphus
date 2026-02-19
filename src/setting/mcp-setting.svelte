<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { showMessage } from "siyuan";
    import SettingPanel from "../libs/components/setting-panel.svelte";

    // Props from plugin
    export let apiUrl: string = "http://127.0.0.1:6806";

    const dispatch = createEventDispatcher();

    // Configuration items
    const configItems: ISettingItem[] = [
        {
            type: 'textinput',
            title: 'mcpApiUrl',
            description: 'mcpApiUrlDesc',
            key: 'apiUrl',
            value: apiUrl,
            placeholder: 'http://127.0.0.1:6806'
        }
    ];

    /********** Events **********/
    interface ChangeEvent {
        key: string;
        value: any;
    }

    const onChanged = ({ detail }: CustomEvent<ChangeEvent>) => {
        if (detail.key === 'apiUrl') {
            apiUrl = detail.value;
        }
        dispatch('changed', { key: detail.key, value: detail.value });
    };

    export function saveSettings() {
        dispatch('save', { apiUrl });
        showMessage('✅ Settings saved');
    }

    export function resetDefaults() {
        apiUrl = "http://127.0.0.1:6806";
        dispatch('reset');
        showMessage('🔄 Settings reset to defaults');
    }
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <div class="config__tab-wrap">
        <SettingPanel
            group="Configuration"
            settingItems={configItems}
            display={true}
            on:changed={onChanged}
        >
            <div class="fn__flex b3-label info-message">
                <span>💡 MCP server runs as a separate process. Configure your MCP client (Cursor/Claude) to use:</span>
            </div>
            <div class="fn__flex b3-label code-block">
                <code>dist/mcp-server.cjs</code>
            </div>
        </SettingPanel>
    </div>
    
    <div class="action-buttons">
        <button 
            class="b3-button b3-button--success" 
            on:click={saveSettings}
        >
            💾 Save
        </button>
        <button 
            class="b3-button b3-button--warning" 
            on:click={resetDefaults}
        >
            🔄 Reset
        </button>
    </div>
</div>

<style lang="scss">
    .config__panel {
        height: 100%;
        flex-direction: column;
    }
    
    .info-message {
        margin: 1rem 0;
        padding: 0.75rem;
        background-color: rgba(33, 150, 243, 0.1);
        border-radius: 4px;
        color: var(--b3-theme-on-background);
        font-size: 0.9rem;
    }
    
    .code-block {
        margin-bottom: 1rem;
        padding: 0.5rem 0.75rem;
        background-color: var(--b3-theme-surface);
        border-radius: 4px;
        
        code {
            font-family: monospace;
            color: var(--b3-theme-primary);
        }
    }
    
    .action-buttons {
        display: flex;
        gap: 0.5rem;
        padding: 1rem;
        border-top: 1px solid var(--b3-border-color);
        background-color: var(--b3-theme-background);
    }
</style>
