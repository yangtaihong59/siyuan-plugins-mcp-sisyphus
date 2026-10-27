<script lang="ts">
    import { onMount, tick } from "svelte";
    import { fetchPost, showMessage } from "siyuan";

    import SettingPanel from "../../shared/setting-panel.svelte";
    import type { AnalyticsEvent, AnalyticsSummary } from "../../../core/analytics";
    import type { ToolConfig } from "../tool-config";
    import type { TelemetryConfig } from "../tool-config-storage";
    import { type HeatmapDay, type HeatmapMonth, type TransportChartItem, buildDailyHeatmap, buildHeatmapMonths, buildTelemetryItems, buildTransportGradient, formatApproxTokens, formatChars, formatDuration, formatTimestamp, readStorageFile, writeClipboardText } from "./telemetry-panel-logic";

    export let analyticsGroup: string;
    export let analyticsDisplay = true;
    export let telemetryGroup: string;
    export let telemetryDisplay = true;
    export let showTelemetry = true;
    export let telemetryConfig: TelemetryConfig;
    export let currentToolConfig: ToolConfig;
    export let getLabel: (key: string, fallback: string) => string;
    export let onChanged: (event: CustomEvent<ChangeEvent>) => void | Promise<void>;

    interface ChangeEvent { key: string; value: any; }

    interface TokenChartItem {
        key: string;
        label: string;
        value: number | null;
        meta: string;
    }

    let analyticsSummary: AnalyticsSummary | null = null;
    let recentAnalyticsEvents: AnalyticsEvent[] = [];
    let analyticsLoading = false;
    let analyticsError = "";
    let telemetryItems: ISettingItem[] = [];
    let telemetryPreviewJson = "";
    let tokenChart: TokenChartItem[] = [];
    let tokenChartMax = 1;
    let heatmapTrend: AnalyticsSummary["dailyTrend"] = [];
    let heatmapDays: HeatmapDay[] = [];
    let heatmapMonths: HeatmapMonth[] = [];
    let heatmapViewport: HTMLDivElement | null = null;
    let topActionMax = 1;
    let transportChart: TransportChartItem[] = [];
    let transportTotal = 0;
    let transportGradient = "var(--mcp-config-border, var(--b3-border-color)) 0 100%";

    async function loadAnalyticsSummary() {
        analyticsLoading = true;
        analyticsError = "";
        try {
            const { readAnalyticsEvents, computeAnalyticsSummary, getRecentAnalyticsEvents, MCP_INITIAL_COST_PATH, parseMcpInitialTokenCost } = await import("../../../core/analytics");
            const initialCost = parseMcpInitialTokenCost(await readStorageFile(MCP_INITIAL_COST_PATH).catch(() => null));
            const events = await readAnalyticsEvents({
                readFile: readStorageFile,
                writeFile: async () => { /* not used in read path */ },
                request: async () => { throw new Error("not implemented"); },
                readFileBinary: async () => { throw new Error("not implemented"); },
                getBaseUrl: () => "",
                getAuthHeaders: () => ({}),
                setToken: () => {},
            } as any, Number.POSITIVE_INFINITY);
            const summaryCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const heatmapCutoff = Date.now() - 52 * 7 * 24 * 60 * 60 * 1000;
            analyticsSummary = computeAnalyticsSummary(events.filter((event: any) => event.ts >= summaryCutoff), { initialCost });
            heatmapTrend = computeAnalyticsSummary(events.filter((event: any) => event.ts >= heatmapCutoff)).dailyTrend;
            recentAnalyticsEvents = getRecentAnalyticsEvents(events, 100);
        } catch (e) {
            analyticsError = e instanceof Error ? e.message : String(e);
            analyticsSummary = null;
            heatmapTrend = [];
            recentAnalyticsEvents = [];
        } finally {
            analyticsLoading = false;
        }
    }

    async function clearAnalyticsData() {
        try {
            const { ANALYTICS_PATH, ANALYTICS_ROTATED_PATH } = await import("../../../core/analytics");
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
            const { ANALYTICS_PATH, ANALYTICS_ROTATED_PATH, MCP_INITIAL_COST_PATH, computeAnalyticsSummary, parseJsonl, parseMcpInitialTokenCost } = await import("../../../core/analytics");
            const parts: string[] = [];
            try { parts.push(await readStorageFile(ANALYTICS_PATH)); } catch { /* ignore */ }
            try { parts.push(await readStorageFile(ANALYTICS_ROTATED_PATH)); } catch { /* ignore */ }
            const events = parseJsonl(parts.join("\n"));
            const initialCost = parseMcpInitialTokenCost(await readStorageFile(MCP_INITIAL_COST_PATH).catch(() => null));
            const summary = computeAnalyticsSummary(events, { initialCost });
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
            const { buildTelemetryPayload } = await import("../../../core/telemetry");
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

    function getCapturedText(value: unknown) {
        return typeof value === "string" && value.length > 0
            ? value
            : getLabel("analyticsRecentMissingText", "Not captured for this legacy event.");
    }

    function getHeatmapDayLabel(day: HeatmapDay): string {
        const calls = `${day.count} ${getLabel("analyticsCallCount", "call(s)")}`;
        const errors = day.errorCount > 0
            ? `, ${day.errorCount} ${getLabel("analyticsErrorShort", "err")}`
            : "";
        return `${day.date}: ${calls}${errors}`;
    }

    async function scrollHeatmapToLatest() {
        await tick();
        if (heatmapViewport) {
            heatmapViewport.scrollLeft = heatmapViewport.scrollWidth;
        }
    }

    async function copyRecentCall(event: any) {
        const payload = {
            tool: event.tool,
            action: event.action,
            status: event.status,
            timestamp: formatTimestamp(event.ts),
            timestampMs: event.ts,
            durationMs: event.durationMs,
            transport: event.transport,
            errorCode: event.errorCode,
            tokens: {
                inputApproxTokens: event.requestApproxTokens,
                outputApproxTokens: event.responseApproxTokens,
                totalApproxTokens: event.totalApproxTokens,
                inputChars: event.requestChars,
                outputChars: event.responseChars,
                tokenMode: event.tokenMode,
            },
            input: {
                text: getCapturedText(event.requestText),
                truncated: Boolean(event.requestTextTruncated),
            },
            output: {
                text: getCapturedText(event.responseText),
                truncated: Boolean(event.responseTextTruncated),
            },
        };

        try {
            await writeClipboardText(JSON.stringify(payload, null, 2));
            showMessage(getLabel("analyticsRecentCopied", "Call details copied"));
        } catch {
            showMessage(getLabel("analyticsRecentCopyFailed", "Failed to copy call details"));
        }
    }

    onMount(loadAnalyticsSummary);

    $: if (currentToolConfig) {
        void loadAnalyticsSummary();
    }

    $: telemetryItems = buildTelemetryItems(telemetryConfig, getLabel);
    $: tokenChart = [
        {
            key: "cli",
            label: getLabel("analyticsCliAvgTokens", "CLI Avg Tokens"),
            value: analyticsSummary?.tokenUsage?.cliAvgApproxTokens ?? null,
            meta: analyticsSummary?.tokenUsage?.cliMeasuredCalls
                ? `${analyticsSummary.tokenUsage.cliMeasuredCalls} ${getLabel("analyticsCallCount", "call(s)")}`
                : "",
        },
        {
            key: "mcp",
            label: getLabel("analyticsMcpAvgTokens", "MCP Avg Tokens"),
            value: analyticsSummary?.tokenUsage?.mcpAvgApproxTokens ?? null,
            meta: analyticsSummary?.tokenUsage?.mcpMeasuredCalls
                ? `${analyticsSummary.tokenUsage.mcpMeasuredCalls} ${getLabel("analyticsCallCount", "call(s)")}`
                : "",
        },
        {
            key: "initial",
            label: getLabel("analyticsMcpFirstConnect", "MCP First Connect"),
            value: analyticsSummary?.tokenUsage?.mcpInitialApproxTokens ?? null,
            meta: analyticsSummary?.tokenUsage?.mcpInitialChars != null
                ? `${analyticsSummary.tokenUsage.mcpInitialChars} ${getLabel("analyticsCharCount", "chars")}`
                : "",
        },
    ];
    $: tokenChartMax = Math.max(1, ...tokenChart.map((item) => item.value ?? 0));
    $: topActionMax = Math.max(1, ...(analyticsSummary?.topActions.map((action) => action.count) ?? []));
    $: heatmapDays = buildDailyHeatmap(heatmapTrend);
    $: heatmapMonths = buildHeatmapMonths(heatmapDays);
    $: if (analyticsDisplay && heatmapDays.length > 0) {
        void scrollHeatmapToLatest();
    }
    $: transportChart = [
        {
            key: "cli",
            label: getLabel("analyticsSourceCli", "CLI"),
            count: analyticsSummary?.transportDistribution?.cli ?? 0,
            color: "var(--analytics-cli-color)",
        },
        {
            key: "stdio",
            label: getLabel("analyticsSourceStdio", "stdio"),
            count: analyticsSummary?.transportDistribution?.stdio ?? 0,
            color: "var(--analytics-stdio-color)",
        },
        {
            key: "http",
            label: getLabel("analyticsSourceHttp", "http"),
            count: analyticsSummary?.transportDistribution?.http ?? 0,
            color: "var(--analytics-http-color)",
        },
    ];
    $: transportTotal = transportChart.reduce((sum, item) => sum + item.count, 0);
    $: transportGradient = buildTransportGradient(transportChart, transportTotal);
</script>

<SettingPanel group={analyticsGroup} settingItems={[]} display={analyticsDisplay}>
    <div class="analytics-section">
        {#if analyticsLoading}
            <div class="analytics-hint">{getLabel("analyticsLoading", "Loading analytics...")}</div>
        {:else if analyticsError}
            <div class="analytics-hint analytics-hint--error">{analyticsError}</div>
        {:else}
            {#if !analyticsSummary || analyticsSummary.totalCalls === 0}
                <div class="analytics-hint">{getLabel("analyticsEmpty", "No analytics data yet. Start using MCP tools to see usage statistics.")}</div>
            {/if}

            <div class="analytics-grid">
                <div class="analytics-card analytics-card--primary">
                    <div class="analytics-card__value">{analyticsSummary?.totalCalls ?? 0}</div>
                    <div class="analytics-card__label">{getLabel("analyticsTotalCalls", "Total Calls")}</div>
                </div>
                <div class="analytics-card analytics-card--error">
                    <div class="analytics-card__value">{analyticsSummary?.errorCalls ?? 0}</div>
                    <div class="analytics-card__label">{getLabel("analyticsErrors", "Errors")}</div>
                </div>
                <div class="analytics-card analytics-card--error">
                    <div class="analytics-card__value">{(((analyticsSummary?.errorRate ?? 0) * 100).toFixed(1))}%</div>
                    <div class="analytics-card__label">{getLabel("analyticsErrorRate", "Error Rate")}</div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card__value">{Math.round(analyticsSummary?.avgDurationMs ?? 0)}ms</div>
                    <div class="analytics-card__label">{getLabel("analyticsAvgDuration", "Avg Duration")}</div>
                </div>
            </div>

            {#if heatmapTrend.length > 0}
                <div class="analytics-block analytics-trend">
                    <div class="analytics-block__title">{getLabel("analyticsDailyTrend", "Daily activity (last 52 weeks)")}</div>
                    <div class="analytics-heatmap__viewport" bind:this={heatmapViewport}>
                        <div class="analytics-heatmap" role="grid" aria-label={getLabel("analyticsDailyTrend", "Daily activity (last 52 weeks)")}>
                            <div class="analytics-heatmap__months" aria-hidden="true">
                                {#each heatmapMonths as month}
                                    <span style={`grid-column: ${month.column}`}>{month.label}</span>
                                {/each}
                            </div>
                            <div class="analytics-heatmap__body">
                                <div class="analytics-heatmap__weekdays" aria-hidden="true">
                                    <span></span>
                                    <span>{getLabel("analyticsWeekdayMon", "Mon")}</span>
                                    <span></span>
                                    <span>{getLabel("analyticsWeekdayWed", "Wed")}</span>
                                    <span></span>
                                    <span>{getLabel("analyticsWeekdayFri", "Fri")}</span>
                                    <span></span>
                                </div>
                                <div class="analytics-heatmap__cells">
                                    {#each heatmapDays as day}
                                        <span
                                            class={`analytics-heatmap__cell analytics-heatmap__cell--level-${day.level}`}
                                            class:analytics-heatmap__cell--error={day.errorCount > 0}
                                            class:analytics-heatmap__cell--future={day.future}
                                            role="gridcell"
                                            aria-label={getHeatmapDayLabel(day)}
                                            title={getHeatmapDayLabel(day)}
                                        ></span>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            {/if}

            <div class="analytics-chart-grid">
                {#if analyticsSummary && analyticsSummary.topActions.length > 0}
                    <div class="analytics-block">
                        <div class="analytics-block__title">{getLabel("analyticsTopActions", "Top Actions")}</div>
                        <div class="analytics-bar-chart">
                            {#each analyticsSummary.topActions as action}
                                <div class="analytics-bar-chart__item">
                                    <div class="analytics-bar-chart__header">
                                        <span class="analytics-bar-chart__label" title={`${action.tool}.${action.action}`}>{action.tool}.{action.action}</span>
                                        <span class="analytics-bar-chart__summary">
                                            <span>~{Math.round(action.avgDurationMs)}ms</span>
                                            {#if action.errorCount > 0}
                                                <span class="analytics-bar-chart__error-label">{action.errorCount} {getLabel("analyticsErrorShort", "err")}</span>
                                            {/if}
                                            <strong class="analytics-bar-chart__value">{action.count}</strong>
                                        </span>
                                    </div>
                                    <div class="analytics-bar-chart__track" title={`${action.count} ${getLabel("analyticsCallCount", "call(s)")}`}>
                                        <span class="analytics-bar-chart__fill" style={`--bar-width: ${action.count / topActionMax * 100}%`}>
                                            {#if action.errorCount > 0}
                                                <span class="analytics-bar-chart__error" style={`--error-width: ${action.errorCount / action.count * 100}%`}></span>
                                            {/if}
                                        </span>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <div class="analytics-block analytics-transport">
                    <div class="analytics-block__title">{getLabel("analyticsTransport", "Invocation Source")}</div>
                    <div class="analytics-transport__content">
                        <div
                            class="analytics-donut"
                            role="img"
                            aria-label={`${getLabel("analyticsTransport", "Invocation Source")}: ${transportTotal}`}
                            style={`--transport-gradient: ${transportGradient}`}
                        >
                            <div class="analytics-donut__center">
                                <strong>{transportTotal}</strong>
                                <span>{getLabel("analyticsTotalCalls", "Total Calls")}</span>
                            </div>
                        </div>
                        <div class="analytics-legend">
                            {#each transportChart as item}
                                <div class="analytics-legend__item">
                                    <span class={`analytics-legend__swatch analytics-legend__swatch--${item.key}`}></span>
                                    <span class="analytics-legend__label">{item.label}</span>
                                    <strong>{item.count}</strong>
                                    <span class="analytics-legend__percent">{transportTotal > 0 ? `${(item.count / transportTotal * 100).toFixed(0)}%` : "0%"}</span>
                                </div>
                            {/each}
                        </div>
                    </div>
                </div>
            </div>

            <div class="analytics-block">
                <div class="analytics-block__title">{getLabel("analyticsTokenUsage", "Token Usage")}</div>
                <div class="analytics-token-chart">
                    {#each tokenChart as item}
                        <div class="analytics-token-chart__item">
                            <div class="analytics-token-chart__header">
                                <span>{item.label}</span>
                                <strong>{item.value != null ? `~${Math.round(item.value)}` : "—"}</strong>
                            </div>
                            <div class="analytics-token-chart__track">
                                <span
                                    class:analytics-token-chart__fill--initial={item.key === "initial"}
                                    class="analytics-token-chart__fill"
                                    style={`--bar-width: ${(item.value ?? 0) / tokenChartMax * 100}%`}
                                ></span>
                            </div>
                            <div class="analytics-token-chart__meta">{item.meta}</div>
                        </div>
                    {/each}
                </div>
                <div class="analytics-note">
                    {getLabel("analyticsTokenApproxHint", "Approximate token counts based on observed text length; MCP first-connection cost is shown separately from per-call averages.")}
                </div>
            </div>

            {#if recentAnalyticsEvents.length > 0}
                <div class="analytics-block analytics-recent">
                    <div class="analytics-block__title">{getLabel("analyticsRecentCalls", "Recent Calls")}</div>
                    <div class="analytics-note">
                        {getLabel("analyticsRecentCallsHint", "Shows the latest 100 local calls with captured input/output text and approximate token counts.")}
                    </div>
                    <div class="analytics-recent__list">
                        {#each recentAnalyticsEvents as event}
                            <details class:eventError={event.status === "error"} class="analytics-call">
                                <summary class="analytics-call__summary">
                                    <span class="analytics-call__main">
                                        <span class="analytics-call__name">{event.tool}.{event.action}</span>
                                        <span class="analytics-call__time">{formatTimestamp(event.ts)}</span>
                                    </span>
                                    <span class="analytics-call__aside">
                                        <span class="analytics-call__meta">
                                            <span class="analytics-call__status">{event.status}</span>
                                            <span>{formatDuration(event.durationMs)}</span>
                                            <span>{formatApproxTokens(event.totalApproxTokens)}</span>
                                        </span>
                                        <button class="b3-button b3-button--outline analytics-call__copy" type="button" on:click|preventDefault|stopPropagation={() => copyRecentCall(event)}>
                                            {getLabel("analyticsRecentCopy", "Copy")}
                                        </button>
                                    </span>
                                </summary>
                                <div class="analytics-call__body">
                                    <div class="analytics-call__stats">
                                        <span>{getLabel("analyticsRecentInputTokens", "Input")} {formatApproxTokens(event.requestApproxTokens)} / {formatChars(event.requestChars)} {getLabel("analyticsCharCount", "chars")}</span>
                                        <span>{getLabel("analyticsRecentOutputTokens", "Output")} {formatApproxTokens(event.responseApproxTokens)} / {formatChars(event.responseChars)} {getLabel("analyticsCharCount", "chars")}</span>
                                        <span>{getLabel("analyticsRecentTotalTokens", "Total")} {formatApproxTokens(event.totalApproxTokens)}</span>
                                    </div>
                                    {#if event.errorCode}
                                        <div class="analytics-call__error">{event.errorCode}</div>
                                    {/if}
                                    <div class="analytics-call__columns">
                                        <div class="analytics-call__pane">
                                            <div class="analytics-call__pane-title">
                                                {getLabel("analyticsRecentInput", "Input")}
                                                {#if event.requestTextTruncated}
                                                    <span>{getLabel("analyticsRecentTruncated", "truncated")}</span>
                                                {/if}
                                            </div>
                                            <pre>{getCapturedText(event.requestText)}</pre>
                                        </div>
                                        <div class="analytics-call__pane">
                                            <div class="analytics-call__pane-title">
                                                {getLabel("analyticsRecentOutput", "Output")}
                                                {#if event.responseTextTruncated}
                                                    <span>{getLabel("analyticsRecentTruncated", "truncated")}</span>
                                                {/if}
                                            </div>
                                            <pre>{getCapturedText(event.responseText)}</pre>
                                        </div>
                                    </div>
                                </div>
                            </details>
                        {/each}
                    </div>
                </div>
            {/if}
        {/if}

        <div class="analytics-actions">
            <button class="b3-button analytics-actions__primary" on:click={loadAnalyticsSummary}>
                {getLabel("analyticsRefresh", "Refresh")}
            </button>
            <button class="b3-button b3-button--outline" on:click={exportAnalyticsReport} disabled={!analyticsSummary || analyticsSummary.totalCalls === 0}>
                {getLabel("analyticsExport", "Export Report")}
            </button>
            <button class="b3-button b3-button--outline analytics-actions__danger" on:click={clearAnalyticsData}>
                {getLabel("analyticsClear", "Clear Data")}
            </button>
        </div>
    </div>
</SettingPanel>
{#if showTelemetry}
    <SettingPanel group={telemetryGroup} settingItems={telemetryItems} display={telemetryDisplay} on:changed={onChanged}>
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
        --analytics-cli-color: var(--b3-theme-primary, #4a7fff);
        --analytics-stdio-color: color-mix(in srgb, var(--b3-theme-primary, #4a7fff) 58%, #9b6cff);
        --analytics-http-color: var(--b3-theme-success, #3fb950);
        --analytics-error-color: var(--b3-theme-error, #d23f31);
        display: flex;
        flex-direction: column;
        gap: var(--mcp-config-section-gap, 14px);
        font-size: 13px;
    }

    .analytics-hint {
        padding: var(--mcp-config-card-padding, 16px);
        background: var(--mcp-config-surface-accent, var(--mcp-config-surface, var(--b3-theme-surface)));
        border: 1px solid var(--mcp-config-primary-border, var(--b3-border-color));
        border-radius: var(--mcp-config-card-radius, 8px);
        box-shadow: var(--mcp-config-shadow, none);
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        line-height: 1.6;
    }

    .analytics-hint--error {
        background: color-mix(in srgb, var(--b3-theme-error) 7%, var(--mcp-config-surface-raised, var(--b3-theme-surface)));
        border-color: color-mix(in srgb, var(--b3-theme-error) 24%, var(--b3-border-color));
        color: var(--b3-theme-error);
    }

    .analytics-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
    }

    .analytics-card {
        background: var(--mcp-config-surface-accent, var(--mcp-config-surface-raised, var(--b3-theme-surface)));
        border: 1px solid var(--mcp-config-border, var(--b3-border-color));
        border-radius: var(--mcp-config-card-radius, 8px);
        box-shadow: var(--mcp-config-shadow, none);
        min-height: 70px;
        padding: 14px;
        text-align: left;
        transition: border-color 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease;
    }

    .analytics-card:hover {
        border-color: color-mix(in srgb, var(--b3-theme-primary) 26%, var(--b3-border-color));
        box-shadow: 0 5px 16px color-mix(in srgb, var(--b3-theme-on-background) 6%, transparent);
        transform: translateY(-1px);
    }

    .analytics-card--primary {
        border-color: var(--mcp-config-primary-border, var(--b3-border-color));
    }

    .analytics-card--error {
        background: linear-gradient(135deg, color-mix(in srgb, var(--b3-theme-error) 7%, transparent), transparent 74%), var(--mcp-config-surface-raised, var(--b3-theme-surface));
    }

    .analytics-card__value {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: 20px;
        font-weight: 650;
        letter-spacing: -0.02em;
        line-height: 1.25;
    }

    .analytics-card__label {
        font-size: 11px;
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        margin-top: 4px;
    }

    .analytics-block {
        background: var(--mcp-config-surface, var(--b3-theme-surface));
        border: 1px solid var(--mcp-config-border, var(--b3-border-color));
        border-radius: var(--mcp-config-card-radius, 8px);
        box-shadow: var(--mcp-config-shadow, none);
        padding: var(--mcp-config-card-padding, 16px);
    }

    .analytics-block__title {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: var(--mcp-config-title-font-size, 14px);
        font-weight: var(--mcp-config-title-font-weight, 600);
        margin-bottom: 10px;
    }

    .analytics-chart-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(250px, 0.85fr);
        gap: var(--mcp-config-section-gap, 14px);
    }

    .analytics-heatmap__viewport {
        overflow-x: auto;
        padding: 3px 0 5px;
        scrollbar-width: thin;
    }

    .analytics-heatmap {
        --heatmap-gap: 3px;
        min-width: 600px;
        width: 100%;
    }

    .analytics-heatmap__months {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        display: grid;
        font-size: 10px;
        gap: var(--heatmap-gap);
        grid-template-columns: repeat(52, minmax(8px, 1fr));
        height: 18px;
        margin-left: 28px;
    }

    .analytics-heatmap__months span {
        white-space: nowrap;
    }

    .analytics-heatmap__body {
        display: flex;
        gap: 6px;
    }

    .analytics-heatmap__weekdays {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        display: grid;
        flex: 0 0 22px;
        font-size: 9px;
        gap: var(--heatmap-gap);
        grid-template-rows: repeat(7, 1fr);
        line-height: 1;
    }

    .analytics-heatmap__cells {
        display: grid;
        flex: 1;
        gap: var(--heatmap-gap);
        grid-auto-flow: column;
        grid-template-columns: repeat(52, minmax(8px, 1fr));
        grid-template-rows: repeat(7, auto);
    }

    .analytics-heatmap__cell {
        background: color-mix(in srgb, var(--b3-theme-on-background) 7%, transparent);
        border: 1px solid color-mix(in srgb, var(--b3-theme-on-background) 5%, transparent);
        border-radius: 2px;
        box-sizing: border-box;
        display: block;
        aspect-ratio: 1;
        width: 100%;
    }

    .analytics-heatmap__cell--level-1 {
        background: color-mix(in srgb, var(--analytics-http-color) 28%, var(--mcp-config-surface, var(--b3-theme-surface)));
        border-color: color-mix(in srgb, var(--analytics-http-color) 18%, transparent);
    }

    .analytics-heatmap__cell--level-2 {
        background: color-mix(in srgb, var(--analytics-http-color) 48%, var(--mcp-config-surface, var(--b3-theme-surface)));
        border-color: color-mix(in srgb, var(--analytics-http-color) 28%, transparent);
    }

    .analytics-heatmap__cell--level-3 {
        background: color-mix(in srgb, var(--analytics-http-color) 72%, var(--mcp-config-surface, var(--b3-theme-surface)));
        border-color: color-mix(in srgb, var(--analytics-http-color) 42%, transparent);
    }

    .analytics-heatmap__cell--level-4 {
        background: var(--analytics-http-color);
        border-color: color-mix(in srgb, var(--analytics-http-color) 74%, var(--b3-theme-on-background));
    }

    .analytics-heatmap__cell--error {
        box-shadow: inset 0 0 0 1px var(--analytics-error-color);
    }

    .analytics-heatmap__cell--future {
        background: transparent;
        border-color: transparent;
        box-shadow: none;
    }

    .analytics-bar-chart {
        display: flex;
        flex-direction: column;
        gap: 9px;
    }

    .analytics-token-chart {
        display: flex;
        flex-direction: column;
        gap: 13px;
    }

    .analytics-bar-chart__item,
    .analytics-token-chart__item {
        min-width: 0;
    }

    .analytics-bar-chart__header,
    .analytics-token-chart__header {
        align-items: center;
        display: flex;
        gap: 12px;
        justify-content: space-between;
        margin-bottom: 6px;
    }

    .analytics-bar-chart__header {
        gap: 8px;
        margin-bottom: 4px;
        min-height: 17px;
    }

    .analytics-bar-chart__label {
        font-family: var(--mcp-config-code-font);
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .analytics-bar-chart__value,
    .analytics-token-chart__header strong {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        flex: 0 0 auto;
        font-weight: 650;
    }

    .analytics-bar-chart__summary {
        align-items: center;
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        display: flex;
        flex: 0 0 auto;
        font-size: 10px;
        gap: 8px;
        white-space: nowrap;
    }

    .analytics-bar-chart__summary .analytics-bar-chart__value {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: 12px;
        min-width: 16px;
        text-align: right;
    }

    .analytics-bar-chart__track,
    .analytics-token-chart__track {
        background: color-mix(in srgb, var(--b3-theme-on-background) 8%, transparent);
        border-radius: 999px;
        height: 9px;
        overflow: hidden;
    }

    .analytics-bar-chart__track {
        height: 7px;
    }

    .analytics-bar-chart__fill,
    .analytics-token-chart__fill {
        background: linear-gradient(90deg, color-mix(in srgb, var(--b3-theme-primary) 70%, white), var(--b3-theme-primary));
        border-radius: inherit;
        display: block;
        height: 100%;
        overflow: hidden;
        position: relative;
        transition: width 0.2s ease;
        width: var(--bar-width);
    }

    .analytics-bar-chart__error {
        background: var(--analytics-error-color);
        height: 100%;
        position: absolute;
        right: 0;
        width: var(--error-width);
    }

    .analytics-token-chart__meta {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        display: flex;
        font-size: 11px;
        justify-content: space-between;
        margin-top: 4px;
        min-height: 16px;
    }

    .analytics-bar-chart__error-label {
        color: var(--analytics-error-color);
    }

    .analytics-transport__content {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 4px 0 2px;
    }

    .analytics-donut {
        align-items: center;
        background: conic-gradient(var(--transport-gradient));
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--b3-theme-on-background) 5%, transparent);
        display: flex;
        height: 132px;
        justify-content: center;
        width: 132px;
    }

    .analytics-donut__center {
        align-items: center;
        background: var(--mcp-config-surface, var(--b3-theme-surface));
        border-radius: 50%;
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--mcp-config-border, var(--b3-border-color)) 55%, transparent);
        display: flex;
        flex-direction: column;
        height: 82px;
        justify-content: center;
        width: 82px;
    }

    .analytics-donut__center strong {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: 22px;
        line-height: 1.1;
    }

    .analytics-donut__center span {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        font-size: 10px;
        margin-top: 4px;
    }

    .analytics-legend {
        display: flex;
        flex-direction: column;
        gap: 9px;
        width: 100%;
    }

    .analytics-legend__item {
        align-items: center;
        display: grid;
        gap: 7px;
        grid-template-columns: 9px minmax(54px, 1fr) auto 34px;
    }

    .analytics-legend__swatch {
        border-radius: 3px;
        height: 9px;
        width: 9px;
    }

    .analytics-legend__swatch--cli {
        background: var(--analytics-cli-color);
    }

    .analytics-legend__swatch--stdio {
        background: var(--analytics-stdio-color);
    }

    .analytics-legend__swatch--http {
        background: var(--analytics-http-color);
    }

    .analytics-legend__percent {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        font-size: 11px;
        text-align: right;
    }

    .analytics-token-chart {
        display: grid;
        gap: clamp(14px, 2vw, 24px);
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .analytics-token-chart__fill--initial {
        background: linear-gradient(90deg, color-mix(in srgb, var(--analytics-stdio-color) 72%, white), var(--analytics-stdio-color));
    }

    .analytics-actions {
        align-items: center;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding-top: 2px;
    }

    .analytics-actions__primary {
        min-width: 88px;
    }

    .analytics-actions__danger {
        border-color: color-mix(in srgb, var(--b3-theme-error) 28%, var(--b3-border-color));
        color: var(--b3-theme-error);
    }

    .analytics-note {
        margin-top: 10px;
        font-size: 12px;
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        line-height: 1.5;
    }

    .analytics-recent {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .analytics-recent .analytics-note {
        margin-top: 0;
    }

    .analytics-recent__list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 560px;
        overflow: auto;
        padding-right: 2px;
    }

    .analytics-call {
        border: 1px solid var(--mcp-config-border, var(--b3-border-color));
        border-radius: var(--mcp-config-card-radius, 8px);
        background: color-mix(in srgb, var(--b3-theme-background) 36%, transparent);
    }

    .analytics-call.eventError {
        border-color: var(--b3-theme-error);
    }

    .analytics-call__summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        cursor: pointer;
        list-style-position: outside;
    }

    .analytics-call__main {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 3px;
    }

    .analytics-call__name {
        font-weight: var(--mcp-config-title-font-weight, 500);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .analytics-call__time,
    .analytics-call__meta,
    .analytics-call__stats,
    .analytics-call__pane-title span {
        font-size: 11px;
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
    }

    .analytics-call__aside {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 0 0 auto;
    }

    .analytics-call__meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    .analytics-call__copy {
        flex: 0 0 auto;
        padding: 2px 8px;
        min-height: 24px;
        line-height: 20px;
    }

    .analytics-call__status {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
    }

    .analytics-call.eventError .analytics-call__status {
        color: var(--b3-theme-error);
    }

    .analytics-call__body {
        border-top: 1px solid var(--mcp-config-border, var(--b3-border-color));
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .analytics-call__stats {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }

    .analytics-call__error {
        color: var(--b3-theme-error);
        font-size: 12px;
    }

    .analytics-call__columns {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
    }

    .analytics-call__pane {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .analytics-call__pane-title {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-weight: var(--mcp-config-title-font-weight, 500);
    }

    .analytics-call__pane pre {
        margin: 0;
        max-height: 260px;
        overflow: auto;
        padding: 10px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-background);
        font-family: var(--mcp-config-code-font);
        font-size: 12px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .telemetry-section {
        display: flex;
        flex-direction: column;
        gap: var(--mcp-config-section-gap, 14px);
        font-size: 13px;
    }

    .telemetry-hint {
        padding: var(--mcp-config-card-padding, 16px);
        background: var(--b3-card-info-background, rgba(74, 127, 255, 0.1));
        border-left: 3px solid var(--b3-theme-primary, #4a7fff);
        border-radius: var(--mcp-config-card-radius, 8px);
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
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        overflow: auto;
        max-height: 240px;
        font-family: var(--mcp-config-code-font);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-all;
    }

    @media (max-width: 720px) {
        .analytics-grid {
            grid-template-columns: repeat(2, 1fr);
        }

        .analytics-chart-grid,
        .analytics-token-chart {
            grid-template-columns: 1fr;
        }

        .analytics-transport__content {
            align-items: center;
            flex-direction: row;
        }

        .analytics-donut {
            flex: 0 0 112px;
            height: 112px;
            width: 112px;
        }

        .analytics-donut__center {
            height: 70px;
            width: 70px;
        }

        .analytics-call__summary,
        .analytics-call__columns {
            grid-template-columns: 1fr;
        }

        .analytics-call__summary {
            align-items: flex-start;
            flex-direction: column;
        }

        .analytics-call__meta {
            justify-content: flex-start;
        }

        .analytics-call__aside {
            justify-content: space-between;
            width: 100%;
        }
    }

    @media (max-width: 430px) {
        .analytics-transport__content {
            flex-direction: column;
        }

    }
</style>
