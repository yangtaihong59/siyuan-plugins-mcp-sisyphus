/* Pure helpers for TelemetryPanel: heatmap/series builders and formatting. */
import { fetchPost } from "siyuan";
import type { AnalyticsSummary } from "../../../core/analytics";
import type { TelemetryConfig } from "../tool-config-storage";

export interface HeatmapDay {
    date: string;
    count: number;
    errorCount: number;
    level: number;
    future: boolean;
}

export interface HeatmapMonth {
    label: string;
    column: number;
}

export interface TransportChartItem {
    key: "cli" | "stdio" | "http";
    label: string;
    count: number;
    color: string;
}

export function buildTelemetryItems(
    currentTelemetryConfig: TelemetryConfig,
    label: (key: string, fallback: string) => string,
): ISettingItem[] {
    return [
        {
            type: "checkbox",
            key: "telemetry__enabled",
            value: currentTelemetryConfig.enabled,
            title: label("telemetry_enabled_title", "Enable Anonymous Telemetry"),
            description: label("telemetry_enabled_desc", "Send aggregated usage statistics to help improve the MCP plugin. No note content, IDs, or paths are ever uploaded."),
        },
        {
            type: "select",
            key: "telemetry__interval",
            value: String(currentTelemetryConfig.reportIntervalHours),
            title: label("telemetry_interval_title", "Report Interval"),
            description: label("telemetry_interval_desc", "How often to send a telemetry report."),
            options: {
                "12": label("telemetry_interval_option_12", "12 hours"),
                "24": label("telemetry_interval_option_24", "24 hours"),
                "72": label("telemetry_interval_option_72", "72 hours"),
            },
        },
        {
            type: "textinput",
            key: "telemetry__endpoint",
            value: currentTelemetryConfig.endpoint ?? "",
            title: label("telemetry_endpoint_title", "Telemetry Endpoint"),
            description: label("telemetry_endpoint_desc", "Optional HTTPS endpoint for aggregated telemetry. Leave empty to disable all telemetry uploads."),
            placeholder: "https://example.com/v1/collect",
        },
    ];
}

export function readStorageFile(path: string): Promise<string> {
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
}

/** SiYuan's UI language as a BCP 47 tag, so dates follow the UI rather than the OS locale. */
export function getUiLocale(lang: unknown = (globalThis as any).window?.siyuan?.config?.lang): string | undefined {
    if (typeof lang !== "string" || !lang) return undefined;
    const tag = lang === "zh_CHT" ? "zh-TW" : lang.replace(/_/g, "-");
    try {
        return Intl.DateTimeFormat.supportedLocalesOf(tag).length > 0 ? tag : undefined;
    } catch {
        return undefined;
    }
}

export function formatTimestamp(ts: number, locale = getUiLocale()) {
    if (!Number.isFinite(ts)) return "—";
    return new Date(ts).toLocaleString(locale);
}

export function formatApproxTokens(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? `~${Math.round(value)}` : "—";
}

export function formatChars(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}

export function formatDuration(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}ms` : "—";
}

export function buildDailyHeatmap(trend: AnalyticsSummary["dailyTrend"]): HeatmapDay[] {
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const days = new Map(trend.map((day) => [day.date, day]));
    const today = new Date();
    const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const currentWeekStart = utcToday - today.getUTCDay() * millisecondsPerDay;
    const rangeStart = currentWeekStart - 51 * 7 * millisecondsPerDay;
    const result = Array.from({ length: 52 * 7 }, (_, index) => {
        const timestamp = rangeStart + index * millisecondsPerDay;
        const key = new Date(timestamp).toISOString().slice(0, 10);
        const existing = days.get(key);
        return {
            date: key,
            count: existing?.count ?? 0,
            errorCount: existing?.errorCount ?? 0,
            level: 0,
            future: timestamp > utcToday,
        };
    });
    const maxCount = Math.max(1, ...result.map((day) => day.count));

    return result.map((day) => ({
        ...day,
        level: day.count > 0 ? Math.max(1, Math.ceil(day.count / maxCount * 4)) : 0,
    }));
}

export function buildHeatmapMonths(days: HeatmapDay[], locale = getUiLocale()): HeatmapMonth[] {
    const months: HeatmapMonth[] = [];
    const formatter = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });

    for (let week = 0; week < 52; week += 1) {
        const weekDays = days.slice(week * 7, week * 7 + 7);
        const monthStart = weekDays.find((day) => new Date(`${day.date}T00:00:00Z`).getUTCDate() === 1);
        if (week === 0 || monthStart) {
            const date = new Date(`${(monthStart ?? weekDays[0]).date}T00:00:00Z`);
            const label = formatter.format(date);
            if (months.length === 0 || months[months.length - 1].label !== label) {
                months.push({ label, column: week + 1 });
            }
        }
    }

    return months;
}

export function buildTransportGradient(items: TransportChartItem[], total: number): string {
    if (total === 0) {
        return "var(--mcp-config-border, var(--b3-border-color)) 0 100%";
    }

    let cursor = 0;
    return items.map((item) => {
        const start = cursor;
        cursor += item.count / total * 100;
        return `${item.color} ${start}% ${cursor}%`;
    }).join(", ");
}

export async function writeClipboardText(text: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
        throw new Error("copy failed");
    }
}
