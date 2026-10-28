<script lang="ts">
    import { onMount, tick } from "svelte";
    import { fetchPost, showMessage } from "siyuan";

    import SettingPanel from "../../shared/setting-panel.svelte";
    import type { AnalyticsEvent, AnalyticsSummary } from "../../../core/analytics";
    import type { ToolConfig } from "@/core/config";
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
    @use "./TelemetryPanel";
</style>
