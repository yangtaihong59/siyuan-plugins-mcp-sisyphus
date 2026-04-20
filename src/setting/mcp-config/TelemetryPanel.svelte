<script lang="ts">
    import { onMount } from "svelte";
    import { fetchPost, showMessage } from "siyuan";

    import SettingPanel from "../../libs/components/setting-panel.svelte";
    import type { TelemetryConfig } from "../tool-config-storage";

    export let analyticsGroup: string;
    export let telemetryGroup: string;
    export let showTelemetry = true;
    export let focusGroup: string;
    export let telemetryConfig: TelemetryConfig;
    export let getLabel: (key: string, fallback: string) => string;
    export let onChanged: (event: CustomEvent<ChangeEvent>) => void | Promise<void>;

    interface ChangeEvent { key: string; value: any; }

    let analyticsSummary: any = null;
    let analyticsLoading = false;
    let analyticsError = "";
    let telemetryItems: ISettingItem[] = [];
    let telemetryPreviewJson = "";

    function buildTelemetryItems(): ISettingItem[] {
        return [
            {
                type: "checkbox",
                key: "telemetry__enabled",
                value: telemetryConfig.enabled,
                title: getLabel("telemetry_enabled_title", "Enable Anonymous Telemetry"),
                description: getLabel("telemetry_enabled_desc", "Send aggregated usage statistics to help improve the MCP plugin. No note content, IDs, or paths are ever uploaded."),
            },
            {
                type: "select",
                key: "telemetry__interval",
                value: String(telemetryConfig.reportIntervalHours),
                title: getLabel("telemetry_interval_title", "Report Interval"),
                description: getLabel("telemetry_interval_desc", "How often to send a telemetry report."),
                options: {
                    "12": getLabel("telemetry_interval_option_12", "12 hours"),
                    "24": getLabel("telemetry_interval_option_24", "24 hours"),
                    "72": getLabel("telemetry_interval_option_72", "72 hours"),
                },
            },
            {
                type: "text",
                key: "telemetry__endpoint",
                value: telemetryConfig.endpoint ?? "",
                title: getLabel("telemetry_endpoint_title", "Telemetry Endpoint"),
                description: getLabel("telemetry_endpoint_desc", "Optional HTTPS endpoint for aggregated telemetry. Leave empty to disable all telemetry uploads."),
                placeholder: "https://example.com/v1/collect",
            },
        ];
    }

    async function loadAnalyticsSummary() {
        analyticsLoading = true;
        analyticsError = "";
        try {
            const { readAnalyticsEvents, computeAnalyticsSummary } = await import("../../mcp/analytics");
            const events = await readAnalyticsEvents({
                readFile: async (path: string) => {
                    return new Promise<string>((resolve, reject) => {
                        fetchPost("/api/file/getFile", { path }, (resp: any) => {
                            if (typeof resp === "string") {
                                resolve(resp);
                            } else if (resp?.data && typeof resp.data === "string") {
                                resolve(resp.data);
                            } else {
                                // getFile returns raw text on success; on failure resp may have code !== 0
                                reject(new Error("Failed to read file"));
                            }
                        });
                    });
                },
                writeFile: async () => { /* not used in read path */ },
                request: async () => { throw new Error("not implemented"); },
                readFileBinary: async () => { throw new Error("not implemented"); },
                getBaseUrl: () => "",
                getAuthHeaders: () => ({}),
                setToken: () => {},
            } as any, 7 * 24);
            analyticsSummary = computeAnalyticsSummary(events);
        } catch (e) {
            analyticsError = e instanceof Error ? e.message : String(e);
            analyticsSummary = null;
        } finally {
            analyticsLoading = false;
        }
    }

    async function clearAnalyticsData() {
        try {
            const { ANALYTICS_PATH, ANALYTICS_ROTATED_PATH } = await import("../../mcp/analytics");
            const clearFile = async (path: string) => {
                const formData = new FormData();
                formData.append("path", path);
                formData.append("isDir", "false");
                formData.append("modTime", String(Date.now()));
                formData.append("file", new File([""], "empty"));
                return new Promise<void>((resolve, reject) => {
                    fetchPost("/api/file/putFile", formData, (resp: any) => {
                        if (resp?.code === 0) resolve(); else reject();
                    });
                });
            };
            await Promise.all([clearFile(ANALYTICS_PATH), clearFile(ANALYTICS_ROTATED_PATH)]);
            showMessage(getLabel("analyticsCleared", "✅ Local analytics data cleared"));
            await loadAnalyticsSummary();
        } catch {
            showMessage(getLabel("analyticsClearFailed", "Failed to clear analytics data"));
        }
    }

    async function exportAnalyticsReport() {
        try {
            const { ANALYTICS_PATH, ANALYTICS_ROTATED_PATH, computeAnalyticsSummary, parseJsonl } = await import("../../mcp/analytics");
            const readFile = (path: string): Promise<string> => new Promise((resolve, reject) => {
                fetchPost("/api/file/getFile", { path }, (resp: any) => {
                    if (typeof resp === "string") resolve(resp);
                    else if (resp?.data && typeof resp.data === "string") resolve(resp.data);
                    else reject(new Error("Failed to read file"));
                });
            });
            const parts: string[] = [];
            try { parts.push(await readFile(ANALYTICS_PATH)); } catch { /* ignore */ }
            try { parts.push(await readFile(ANALYTICS_ROTATED_PATH)); } catch { /* ignore */ }
            const events = parseJsonl(parts.join("\n"));
            const summary = computeAnalyticsSummary(events);
            const report = {
                generatedAt: new Date().toISOString(),
                summary,
                rawEventCount: events.length,
            };
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `siyuan-mcp-analytics-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showMessage(getLabel("analyticsExported", "✅ Analytics report exported"));
        } catch {
            showMessage(getLabel("analyticsExportFailed", "Failed to export analytics report"));
        }
    }

    async function buildTelemetryPreview() {
        try {
            const { buildTelemetryPayload } = await import("../../mcp/telemetry");
            const client = {
                readFile: async (path: string) => {
                    return new Promise<string>((resolve, reject) => {
                        fetchPost("/api/file/getFile", { path }, (resp: any) => {
                            if (typeof resp === "string") resolve(resp);
                            else if (resp?.data && typeof resp.data === "string") resolve(resp.data);
                            else reject(new Error("Failed to read file"));
                        });
                    });
                },
                writeFile: async () => {},
                request: async () => { throw new Error("not implemented"); },
                readFileBinary: async () => { throw new Error("not implemented"); },
                getBaseUrl: () => "",
                getAuthHeaders: () => ({}),
                setToken: () => {},
            } as any;
            const payload = await buildTelemetryPayload(client, telemetryConfig.lastReportAt || Date.now() - telemetryConfig.reportIntervalHours * 60 * 60 * 1000);
            telemetryPreviewJson = payload ? JSON.stringify(payload, null, 2) : getLabel("telemetryPreviewEmpty", "No data to send yet.");
        } catch (e) {
            telemetryPreviewJson = e instanceof Error ? e.message : String(e);
        }
    }

    onMount(loadAnalyticsSummary);

    $: telemetryItems = buildTelemetryItems();
</script>

<SettingPanel group={analyticsGroup} settingItems={[]} display={focusGroup === analyticsGroup}>
    <div class="analytics-section">
        {#if analyticsLoading}
            <div class="analytics-hint">{getLabel("analyticsLoading", "Loading analytics...")}</div>
        {:else if analyticsError}
            <div class="analytics-hint analytics-hint--error">{analyticsError}</div>
        {:else if !analyticsSummary || analyticsSummary.totalCalls === 0}
            <div class="analytics-hint">{getLabel("analyticsEmpty", "No analytics data yet. Start using MCP tools to see usage statistics.")}</div>
        {:else}
            <div class="analytics-grid">
                <div class="analytics-card">
                    <div class="analytics-card__value">{analyticsSummary.totalCalls}</div>
                    <div class="analytics-card__label">{getLabel("analyticsTotalCalls", "Total Calls")}</div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card__value">{analyticsSummary.errorCalls}</div>
                    <div class="analytics-card__label">{getLabel("analyticsErrors", "Errors")}</div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card__value">{(analyticsSummary.errorRate * 100).toFixed(1)}%</div>
                    <div class="analytics-card__label">{getLabel("analyticsErrorRate", "Error Rate")}</div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card__value">{Math.round(analyticsSummary.avgDurationMs)}ms</div>
                    <div class="analytics-card__label">{getLabel("analyticsAvgDuration", "Avg Duration")}</div>
                </div>
            </div>

            {#if analyticsSummary.topActions.length > 0}
                <div class="analytics-block">
                    <div class="analytics-block__title">{getLabel("analyticsTopActions", "Top Actions")}</div>
                    <div class="analytics-list">
                        {#each analyticsSummary.topActions as action}
                            <div class="analytics-list__item">
                                <span class="analytics-list__name">{action.tool}.{action.action}</span>
                                <span class="analytics-list__count">{action.count}</span>
                                <span class="analytics-list__meta">{action.errorCount > 0 ? `${action.errorCount} err` : ''} ~{Math.round(action.avgDurationMs)}ms</span>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}

            {#if analyticsSummary.dailyTrend.length > 0}
                <div class="analytics-block">
                    <div class="analytics-block__title">{getLabel("analyticsDailyTrend", "Daily Trend (last 7 days)")}</div>
                    <div class="analytics-list">
                        {#each analyticsSummary.dailyTrend.slice(-7) as day}
                            <div class="analytics-list__item">
                                <span class="analytics-list__name">{day.date}</span>
                                <span class="analytics-list__count">{day.count}</span>
                                <span class="analytics-list__meta">{day.errorCount > 0 ? `${day.errorCount} err` : ''}</span>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}

            <div class="analytics-block">
                <div class="analytics-block__title">{getLabel("analyticsTransport", "Invocation Source")}</div>
                <div class="analytics-list">
                    <div class="analytics-list__item">
                        <span class="analytics-list__name">{getLabel("analyticsSourceCli", "cli")}</span>
                        <span class="analytics-list__count">{analyticsSummary.transportDistribution.cli}</span>
                    </div>
                    <div class="analytics-list__item">
                        <span class="analytics-list__name">{getLabel("analyticsSourceStdio", "stdio")}</span>
                        <span class="analytics-list__count">{analyticsSummary.transportDistribution.stdio}</span>
                    </div>
                    <div class="analytics-list__item">
                        <span class="analytics-list__name">{getLabel("analyticsSourceHttp", "http")}</span>
                        <span class="analytics-list__count">{analyticsSummary.transportDistribution.http}</span>
                    </div>
                </div>
            </div>
        {/if}

        <div class="analytics-actions">
            <button class="b3-button b3-button--outline" on:click={loadAnalyticsSummary}>
                {getLabel("analyticsRefresh", "Refresh")}
            </button>
            <button class="b3-button b3-button--outline" on:click={exportAnalyticsReport} disabled={!analyticsSummary || analyticsSummary.totalCalls === 0}>
                {getLabel("analyticsExport", "Export Report")}
            </button>
            <button class="b3-button b3-button--outline" on:click={clearAnalyticsData}>
                {getLabel("analyticsClear", "Clear Data")}
            </button>
        </div>
    </div>
</SettingPanel>
{#if showTelemetry}
    <SettingPanel group={telemetryGroup} settingItems={telemetryItems} display={focusGroup === telemetryGroup} on:changed={onChanged}>
        <div class="telemetry-section">
            <div class="telemetry-hint">
                {getLabel("telemetryHint", "Telemetry sends only aggregated statistics (call counts, error rates, average durations). No note content, IDs, or paths are ever included.")}
            </div>
            {#if telemetryConfig.enabled}
                <div class="telemetry-preview">
                    <button class="b3-button b3-button--outline" on:click={buildTelemetryPreview}>
                        {getLabel("telemetryPreview", "Preview data to send")}
                    </button>
                    {#if telemetryPreviewJson}
                        <pre class="telemetry-preview__code">{telemetryPreviewJson}</pre>
                    {/if}
                </div>
            {/if}
        </div>
    </SettingPanel>
{/if}

<style lang="scss">
    .analytics-section {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-size: 13px;
    }

    .analytics-hint {
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 4px;
        color: var(--b3-theme-on-surface-light);
    }

    .analytics-hint--error {
        color: var(--b3-theme-error);
    }

    .analytics-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
    }

    .analytics-card {
        background: var(--b3-theme-surface);
        border-radius: 6px;
        padding: 12px;
        text-align: center;
    }

    .analytics-card__value {
        font-size: 18px;
        font-weight: 600;
        color: var(--b3-theme-primary);
    }

    .analytics-card__label {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        margin-top: 4px;
    }

    .analytics-block {
        background: var(--b3-theme-surface);
        border-radius: 6px;
        padding: 12px;
    }

    .analytics-block__title {
        font-weight: 500;
        margin-bottom: 8px;
    }

    .analytics-list__item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid var(--b3-border-color);
    }

    .analytics-list__item:last-child {
        border-bottom: none;
    }

    .analytics-list__name {
        flex: 1;
    }

    .analytics-list__count {
        min-width: 48px;
        text-align: right;
        font-weight: 500;
    }

    .analytics-list__meta {
        min-width: 80px;
        text-align: right;
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
    }

    .analytics-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .telemetry-section {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-size: 13px;
    }

    .telemetry-hint {
        padding: 12px;
        background: var(--b3-card-info-background, rgba(74, 127, 255, 0.1));
        border-left: 3px solid var(--b3-theme-primary, #4a7fff);
        border-radius: 3px;
    }

    .telemetry-preview {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .telemetry-preview__code {
        margin: 0;
        padding: 10px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        overflow: auto;
        max-height: 240px;
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-all;
    }

    @media (max-width: 720px) {
        .analytics-grid {
            grid-template-columns: repeat(2, 1fr);
        }
    }
</style>
