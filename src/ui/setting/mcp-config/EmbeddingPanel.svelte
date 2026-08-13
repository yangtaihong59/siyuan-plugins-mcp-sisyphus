<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { fetchPost, showMessage } from "siyuan";

    import {
        DEFAULT_EMBEDDING_CONFIG,
        MIN_EMBEDDING_CONFIG_VERSION,
        MIN_EMBEDDING_MANAGEMENT_VERSION,
        calculateEmbeddingProgress,
        embeddingChangeRequiresReindex,
        getEmbeddingCapabilities,
        mergeEmbeddingIntoAI,
        normalizeEmbeddingConfig,
        validateEmbeddingConfig,
        type EmbeddingCapabilities,
        type EmbeddingConfig,
        type EmbeddingStat,
    } from "../embedding-config";

    export let display = false;
    export let getLabel: (key: string, fallback: string) => string;

    let version = "";
    let capabilities: EmbeddingCapabilities = { configuration: false, management: false };
    let loading = true;
    let saving = false;
    let testing = false;
    let rebuilding = false;
    let retrying = false;
    let statsLoading = false;
    let loadError = "";
    let savedEmbedding: EmbeddingConfig = { ...DEFAULT_EMBEDDING_CONFIG };
    let draft: EmbeddingConfig = { ...DEFAULT_EMBEDDING_CONFIG };
    let stat: EmbeddingStat | undefined;
    let needsReindex = false;
    let statsTimer: number | undefined;

    $: dirty = JSON.stringify(draft) !== JSON.stringify(savedEmbedding);
    $: progress = calculateEmbeddingProgress(stat);

    function apiPost<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let completed = false;
            void fetchPost(endpoint, body, (response: any) => {
                completed = true;
                if (response?.code === 0) {
                    resolve(response.data as T);
                    return;
                }
                reject(new Error(response?.msg || `Request failed: ${endpoint}`));
            }).catch((error: unknown) => {
                if (!completed) reject(error);
            });
        });
    }

    function readAIFromConf(payload: unknown): Record<string, unknown> {
        const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const conf = data.conf && typeof data.conf === "object" ? data.conf as Record<string, unknown> : {};
        return conf.ai && typeof conf.ai === "object" ? conf.ai as Record<string, unknown> : {};
    }

    async function loadEmbeddingConfig() {
        const confPayload = await apiPost<unknown>("/api/system/getConf");
        const ai = readAIFromConf(confPayload);
        savedEmbedding = normalizeEmbeddingConfig(ai.embedding);
        draft = { ...savedEmbedding };
    }

    async function initialize() {
        loading = true;
        loadError = "";
        try {
            version = await apiPost<string>("/api/system/version");
            capabilities = getEmbeddingCapabilities(version);
            if (capabilities.configuration) {
                await loadEmbeddingConfig();
            }
            if (capabilities.management) {
                await refreshStats();
            }
        } catch (error) {
            loadError = error instanceof Error ? error.message : String(error);
        } finally {
            loading = false;
        }
    }

    function validationMessage(fields: string[]): string {
        const labels: Record<string, string> = {
            baseURL: getLabel("embedding_base_url", "Base URL"),
            apiKey: getLabel("embedding_api_key", "API Key"),
            name: getLabel("embedding_model_name", "Model"),
            timeout: getLabel("embedding_timeout", "Timeout"),
            dimensions: getLabel("embedding_dimensions", "Dimensions"),
        };
        return getLabel("embedding_validation_failed", "Please correct: {{fields}}")
            .replace("{{fields}}", fields.map((field) => labels[field] ?? field).join(", "));
    }

    async function saveEmbedding(showSuccess = true): Promise<boolean> {
        const invalidFields = validateEmbeddingConfig(draft);
        if (invalidFields.length > 0) {
            showMessage(validationMessage(invalidFields), undefined, "error");
            return false;
        }

        saving = true;
        try {
            const confPayload = await apiPost<unknown>("/api/system/getConf");
            const latestAI = readAIFromConf(confPayload);
            const previous = savedEmbedding;
            const nextAI = mergeEmbeddingIntoAI(latestAI, draft);
            const savedAI = await apiPost<Record<string, unknown>>("/api/setting/setAI", nextAI);
            const normalized = normalizeEmbeddingConfig(savedAI?.embedding ?? nextAI.embedding);
            savedEmbedding = normalized;
            draft = { ...normalized };
            needsReindex = needsReindex || embeddingChangeRequiresReindex(previous, normalized);

            const siyuan = (window as any)?.siyuan;
            if (siyuan?.config) siyuan.config.ai = savedAI;
            window.dispatchEvent(new CustomEvent("siyuan-ai-config-changed"));

            if (showSuccess) {
                showMessage(getLabel(
                    needsReindex ? "embedding_saved_reindex" : "embedding_saved",
                    needsReindex
                        ? "Embedding configuration saved. Rebuild the index before semantic search."
                        : "Embedding configuration saved.",
                ));
            }
            return true;
        } catch (error) {
            showMessage(getLabel("embedding_save_failed", "Failed to save embedding configuration: {{error}}")
                .replace("{{error}}", error instanceof Error ? error.message : String(error)), undefined, "error");
            return false;
        } finally {
            saving = false;
        }
    }

    async function saveAndTest() {
        testing = true;
        try {
            if (!await saveEmbedding(false)) return;
            const result = await apiPost<{ matched?: boolean; dimensions?: number; msg?: string }>("/api/ai/testEmbeddingModel");
            if (result?.matched) {
                const message = result.dimensions
                    ? getLabel("embedding_test_success_dimensions", "Connection succeeded. Vector dimensions: {{dimensions}}")
                        .replace("{{dimensions}}", String(result.dimensions))
                    : getLabel("embedding_test_success", "Embedding model connection succeeded.");
                showMessage(needsReindex ? `${message} ${getLabel("embedding_reindex_required", "Rebuild the index before semantic search.")}` : message);
            } else {
                showMessage(getLabel("embedding_test_failed", "Embedding model test failed: {{error}}")
                    .replace("{{error}}", result?.msg || getLabel("embedding_unknown_error", "Unknown error")), undefined, "error");
            }
        } catch (error) {
            showMessage(getLabel("embedding_test_failed", "Embedding model test failed: {{error}}")
                .replace("{{error}}", error instanceof Error ? error.message : String(error)), undefined, "error");
        } finally {
            testing = false;
        }
    }

    async function refreshStats() {
        if (!display || !capabilities.management || statsLoading) return;
        statsLoading = true;
        try {
            stat = await apiPost<EmbeddingStat>("/api/ai/embeddingStat");
        } catch {
            stat = undefined;
        } finally {
            statsLoading = false;
        }
    }

    async function rebuildIndex() {
        if (!window.confirm(getLabel(
            "embedding_rebuild_confirm",
            "Rebuilding recalculates embeddings for eligible blocks and may incur model usage costs. Continue?",
        ))) return;
        rebuilding = true;
        try {
            await apiPost("/api/ai/reindexEmbedding");
            needsReindex = false;
            showMessage(getLabel("embedding_rebuild_started", "Embedding index rebuild started."));
            await refreshStats();
        } catch (error) {
            showMessage(getLabel("embedding_rebuild_failed", "Failed to start embedding rebuild: {{error}}")
                .replace("{{error}}", error instanceof Error ? error.message : String(error)), undefined, "error");
        } finally {
            rebuilding = false;
        }
    }

    async function retryFailed() {
        retrying = true;
        try {
            await apiPost("/api/ai/retryFailedEmbedding");
            showMessage(getLabel("embedding_retry_started", "Failed embedding items were queued for retry."));
            await refreshStats();
        } catch (error) {
            showMessage(getLabel("embedding_retry_failed", "Failed to retry embedding items: {{error}}")
                .replace("{{error}}", error instanceof Error ? error.message : String(error)), undefined, "error");
        } finally {
            retrying = false;
        }
    }

    function touchDraft() {
        draft = { ...draft };
    }

    onMount(() => {
        void initialize();
        statsTimer = window.setInterval(() => void refreshStats(), 3000);
    });

    onDestroy(() => {
        if (statsTimer !== undefined) window.clearInterval(statsTimer);
    });

    $: if (display && capabilities.management && !loading) {
        void refreshStats();
    }
</script>

<section class:fn__none={!display} class="embedding-panel">
    {#if loading}
        <div class="embedding-card embedding-callout">{getLabel("embedding_loading", "Loading embedding configuration…")}</div>
    {:else if loadError}
        <div class="embedding-card embedding-callout embedding-callout--error">
            <strong>{getLabel("embedding_load_failed_title", "Unable to load embedding configuration")}</strong>
            <span>{loadError}</span>
        </div>
    {:else if !capabilities.configuration}
        <div class="embedding-card embedding-callout">
            <strong>{getLabel("embedding_unsupported_title", "Current SiYuan version does not support semantic search")}</strong>
            <span>{getLabel("embedding_unsupported_desc", "SiYuan {{current}} is installed. Upgrade to {{minimum}} or newer.")
                .replace("{{current}}", version || "-")
                .replace("{{minimum}}", MIN_EMBEDDING_CONFIG_VERSION)}</span>
        </div>
    {:else}
        {#if !capabilities.management}
            <div class="embedding-card embedding-callout">
                <strong>{getLabel("embedding_management_unsupported_title", "Model configuration is available")}</strong>
                <span>{getLabel("embedding_management_unsupported_desc", "Upgrade to SiYuan {{minimum}} or newer for connection testing and index management.")
                    .replace("{{minimum}}", MIN_EMBEDDING_MANAGEMENT_VERSION)}</span>
            </div>
        {/if}

        <div class="embedding-card embedding-form">
            <label class="embedding-row embedding-row--switch">
                <span><strong>{getLabel("embedding_enabled", "Enable semantic search")}</strong><small>{getLabel("embedding_enabled_desc", "Use the configured model to index blocks and run vector similarity search.")}</small></span>
                <input class="b3-switch" type="checkbox" bind:checked={draft.enabled} on:change={touchDraft} />
            </label>
            <label class="embedding-row">
                <span><strong>{getLabel("embedding_base_url", "Base URL")}</strong><small>{getLabel("embedding_base_url_desc", "OpenAI-compatible base URL; requests are sent to /embeddings.")}</small></span>
                <input class="b3-text-field" type="url" bind:value={draft.baseURL} on:input={touchDraft} placeholder="https://api.openai.com/v1" />
            </label>
            <label class="embedding-row">
                <span><strong>{getLabel("embedding_api_key", "API Key")}</strong><small>{getLabel("embedding_api_key_desc", "Stored by SiYuan's native AI configuration; never copied into plugin storage or telemetry.")}</small></span>
                <input class="b3-text-field" type="password" bind:value={draft.apiKey} on:input={touchDraft} autocomplete="off" />
            </label>
            <label class="embedding-row">
                <span><strong>{getLabel("embedding_model_name", "Model")}</strong><small>{getLabel("embedding_model_name_desc", "For example, text-embedding-3-small.")}</small></span>
                <input class="b3-text-field" type="text" bind:value={draft.name} on:input={touchDraft} placeholder="text-embedding-3-small" />
            </label>
            <label class="embedding-row">
                <span><strong>{getLabel("embedding_dimensions", "Dimensions")}</strong><small>{getLabel("embedding_dimensions_desc", "Use 0 for the model default. Custom dimensions require a compatible model.")}</small></span>
                <input class="b3-text-field embedding-number" type="number" min="0" step="1" bind:value={draft.dimensions} on:input={touchDraft} />
            </label>
            <label class="embedding-row">
                <span><strong>{getLabel("embedding_timeout", "Timeout")}</strong><small>{getLabel("embedding_timeout_desc", "Embedding request timeout, from 1 to 600 seconds.")}</small></span>
                <span class="embedding-unit"><input class="b3-text-field embedding-number" type="number" min="1" max="600" step="1" bind:value={draft.timeout} on:input={touchDraft} /><em>s</em></span>
            </label>
            <div class="embedding-actions">
                <button class="b3-button b3-button--outline" type="button" disabled={saving || testing || !dirty} on:click={() => void saveEmbedding()}>{saving ? getLabel("embedding_saving", "Saving…") : getLabel("embedding_save", "Save configuration")}</button>
                <button class="b3-button" type="button" disabled={saving || testing || !capabilities.management} on:click={() => void saveAndTest()}>{testing ? getLabel("embedding_testing", "Testing…") : getLabel("embedding_save_test", "Save and test")}</button>
            </div>
            {#if needsReindex}
                <div class="embedding-reindex-hint">{getLabel("embedding_reindex_required", "Rebuild the index before semantic search.")}</div>
            {/if}
        </div>

        {#if capabilities.management}
            <div class="embedding-card embedding-index">
                <div class="embedding-index__header">
                    <div><strong>{getLabel("embedding_index_title", "Embedding index")}</strong><small>{getLabel("embedding_index_desc", "Progress excludes blocks ignored by length or workspace embeddingignore rules.")}</small></div>
                    <button class="b3-button b3-button--outline" type="button" disabled={rebuilding || !savedEmbedding.enabled} on:click={() => void rebuildIndex()}>{rebuilding ? getLabel("embedding_rebuilding", "Starting…") : getLabel("embedding_rebuild", "Rebuild index")}</button>
                </div>
                {#if !stat?.enabled}
                    <div class="embedding-empty">{getLabel("embedding_index_disabled", "Enable and save an embedding model to build the index.")}</div>
                {:else}
                    <div class="embedding-progress" aria-label={`${Math.round(progress.percent)}%`}><span class:embedding-progress__fill--active={!progress.done} style={`width:${progress.percent}%`}></span></div>
                    <div class="embedding-stats">
                        <span>{getLabel("embedding_indexed", "Indexed")} <b>{stat.indexed}</b> / {stat.total}</span>
                        <span>{getLabel("embedding_pending", "Pending")} <b>{stat.pending}</b></span>
                        <span>{getLabel("embedding_failed", "Failed")} <b>{stat.failed}</b></span>
                        <span>{getLabel("embedding_ignored_length", "Length ignored")} <b>{stat.ignoredByLen}</b></span>
                        <span>{getLabel("embedding_ignored_config", "Config ignored")} <b>{stat.ignoredByConfig}</b></span>
                    </div>
                    {#if stat.failed > 0}
                        <button class="b3-button b3-button--outline" type="button" disabled={retrying} on:click={() => void retryFailed()}>{retrying ? getLabel("embedding_retrying", "Retrying…") : getLabel("embedding_retry_failed_items", "Retry failed items")}</button>
                    {/if}
                {/if}
            </div>
        {/if}
    {/if}
</section>

<style>
    .embedding-panel { display: flex; flex-direction: column; gap: var(--mcp-config-section-gap, 16px); }
    .embedding-card { background: var(--mcp-config-surface, var(--b3-theme-surface)); border: 1px solid var(--mcp-config-border, var(--b3-border-color)); border-radius: var(--mcp-config-card-radius, 12px); box-shadow: var(--mcp-config-shadow, none); overflow: hidden; }
    .embedding-callout { display: flex; flex-direction: column; gap: 5px; padding: var(--mcp-config-card-padding, 17px 19px); }
    .embedding-callout--error { border-color: color-mix(in srgb, var(--b3-theme-error) 38%, var(--b3-border-color)); }
    .embedding-callout span, .embedding-row small, .embedding-index small { color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light)); display: block; font-size: 12px; font-weight: 400; }
    .embedding-row { align-items: center; border-bottom: 1px solid var(--mcp-config-border, var(--b3-border-color)); display: flex; gap: 24px; justify-content: space-between; padding: var(--mcp-config-card-padding, 17px 19px); }
    .embedding-row > span:first-child { flex: 1; min-width: 0; }
    .embedding-row > input:not(.b3-switch), .embedding-unit { flex: 0 1 360px; width: min(360px, 46%); }
    .embedding-row .b3-text-field { box-sizing: border-box; width: 100%; }
    .embedding-number { max-width: 140px; }
    .embedding-unit { align-items: center; display: flex; gap: 8px; justify-content: flex-end; }
    .embedding-unit em { color: var(--mcp-config-caption-color); font-style: normal; }
    .embedding-actions { display: flex; gap: 10px; justify-content: flex-end; padding: 16px 19px; }
    .embedding-reindex-hint { background: var(--mcp-config-primary-soft); color: var(--b3-theme-primary); padding: 10px 19px; }
    .embedding-index { padding: var(--mcp-config-card-padding, 17px 19px); }
    .embedding-index__header { align-items: center; display: flex; gap: 20px; justify-content: space-between; }
    .embedding-progress { background: color-mix(in srgb, var(--b3-theme-on-surface) 10%, transparent); border-radius: 999px; height: 8px; margin: 18px 0 12px; overflow: hidden; }
    .embedding-progress span { background: var(--b3-theme-primary); display: block; height: 100%; transition: width 240ms ease; }
    .embedding-progress__fill--active { background-image: linear-gradient(-45deg, rgba(255,255,255,.22) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.22) 50%, rgba(255,255,255,.22) 75%, transparent 75%, transparent); background-size: 32px 32px; animation: embedding-stripes 600ms linear infinite; }
    .embedding-stats { display: grid; gap: 8px 16px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin-bottom: 14px; }
    .embedding-stats span { color: var(--mcp-config-caption-color); }
    .embedding-stats b { color: var(--mcp-config-title-color); }
    .embedding-empty { color: var(--mcp-config-caption-color); padding-top: 16px; }
    @keyframes embedding-stripes { to { background-position: 32px 0; } }
    @media (max-width: 760px) {
        .embedding-row { align-items: stretch; flex-direction: column; gap: 10px; }
        .embedding-row > input:not(.b3-switch), .embedding-unit { flex-basis: auto; width: 100%; }
        .embedding-row--switch { align-items: center; flex-direction: row; }
        .embedding-actions, .embedding-index__header { align-items: stretch; flex-direction: column; }
        .embedding-actions button { width: 100%; }
    }
</style>
