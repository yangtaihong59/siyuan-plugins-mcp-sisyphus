import { getLegacyToolConfigWarning, normalizeToolConfig, type ToolConfig } from "./tool-config";
import {
    TELEMETRY_CONFIG_STORAGE_KEY,
    buildDefaultTelemetryConfig,
    normalizeTelemetryConfig,
    type TelemetryConfig,
} from "./telemetry-config";

export {
    buildDefaultTelemetryConfig,
    normalizeTelemetryConfig,
    type TelemetryConfig,
} from "./telemetry-config";

const CONFIG_STORAGE_KEY = "mcpToolsConfig";
const PUPPY_SETTINGS_STORAGE_KEY = "puppySettings";
const HTTP_SETTINGS_STORAGE_KEY = "mcpHttpSettings";
const VERSION_CONTROL_SETTINGS_STORAGE_KEY = "versionControlSettings";

const DEFAULT_PUPPY_TEST_INTERVAL_MS = 2200;
const DEFAULT_HTTP_PORT = 36806;
const DEFAULT_HTTP_HOST = "127.0.0.1";
export const HTTP_BIND_HOST_OPTIONS = ["127.0.0.1", "0.0.0.0"] as const;
export type HttpServerHost = typeof HTTP_BIND_HOST_OPTIONS[number];
export const DEFAULT_PUPPY_APPEARANCE: PuppyAppearanceSettings = {
    bodyColor: "#4a7fff",
    pawColor: "#3060d0",
    eyeColor: "#1a1f3c",
};
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

const BODY_COLOR_PALETTE = [
    "#6f83a8", "#9a7384", "#6f938d", "#9a8662", "#81779f", "#789076", "#956f6a", "#6d8b99",
    "#f2eee7", "#e8e5dc", "#d7d9d5", "#efd9df", "#d7e2e8", "#d8e7df", "#f0e6d2", "#ece7df",
    "#ffffff", "#f5f5f2", "#d9d9d6", "#a8a8a3", "#6f6f6a", "#3f4242",
    "#5f7fbf", "#7890c2", "#4a6fa8", "#8a9ec4", "#6b7f9f",
    "#9f7769", "#b08a72", "#8f6558", "#a89775", "#c0a37c", "#7e5f57",
    "#3f536c", "#405d5c", "#504862", "#59606a", "#2f3f4a", "#47505f",
];
const PAW_COLOR_PALETTE = [
    "#536786", "#765765", "#55736f", "#766746", "#625a7c", "#5c7158", "#76534f", "#52707b",
    "#d8d2c7", "#cdc9bf", "#bfc2be", "#d8bdc6", "#bdccd3", "#bed1c8", "#d6c6a8", "#d2cabe",
    "#e6e6e2", "#dbdbd6", "#b9b9b4", "#868681", "#565652", "#2f3232",
    "#486a9c", "#5f77a5", "#385986", "#6f82a8", "#51647f",
    "#7f5e54", "#8f6b58", "#704c44", "#827254", "#987b55", "#60453f",
    "#2f4056", "#304a49", "#3c354b", "#444a52", "#26343d", "#363d49",
];
const EYE_COLOR_PALETTE = [
    "#252a35", "#30282c", "#253331", "#312d25", "#2c2835", "#293228", "#332827", "#253038",
    "#2f302d", "#343230", "#263131", "#362d31", "#28323a", "#26332c", "#3a3025", "#2e2d2b",
    "#1f1f1e", "#2a2a28", "#3a3a36", "#4a4a45", "#5a5a55", "#202323",
    "#1f2b40", "#25334a", "#1d2d44", "#2e394d", "#253040",
    "#3a2924", "#422f28", "#33251f", "#3f3526", "#473621", "#2f2421",
    "#1d2632", "#1e2b2a", "#282431", "#292e34", "#17252c", "#222832",
];

type PluginStorage = {
    loadData?: (storageName: string) => Promise<unknown>;
    saveData?: (storageName: string, content: unknown) => Promise<void>;
};

export interface ToolConfigLoadState {
    config: ToolConfig;
    warning: string | null;
}

export interface PuppySettings {
    visible: boolean;
    testModeEnabled: boolean;
    testModeIntervalMs: number;
    showBubble: boolean;
    showClickHint: boolean;
    appearance: PuppyAppearanceSettings;
}

export interface PuppyAppearanceSettings {
    bodyColor: string;
    pawColor: string;
    eyeColor: string;
}

export interface VersionControlSettings {
    enabled: boolean;
    showDebugMeta: boolean;
}

export function buildDefaultVersionControlSettings(): VersionControlSettings {
    return {
        enabled: true,
        showDebugMeta: false,
    };
}

export function normalizeVersionControlSettings(raw: unknown): VersionControlSettings {
    const defaults = buildDefaultVersionControlSettings();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return defaults;
    }
    const record = raw as Record<string, unknown>;
    return {
        enabled: typeof record.enabled === "boolean" ? record.enabled : defaults.enabled,
        showDebugMeta: typeof record.showDebugMeta === "boolean" ? record.showDebugMeta : defaults.showDebugMeta,
    };
}

export function buildDefaultPuppySettings(): PuppySettings {
    return {
        visible: true,
        testModeEnabled: false,
        testModeIntervalMs: DEFAULT_PUPPY_TEST_INTERVAL_MS,
        showBubble: false,
        showClickHint: true,
        appearance: buildDefaultPuppyAppearance(),
    };
}

export function buildDefaultPuppyAppearance(): PuppyAppearanceSettings {
    return {
        ...DEFAULT_PUPPY_APPEARANCE,
    };
}

function pickRandomColor(palette: string[]): string {
    return palette[Math.floor(Math.random() * palette.length)] ?? palette[0];
}

export function buildRandomPuppyAppearance(): PuppyAppearanceSettings {
    return {
        bodyColor: pickRandomColor(BODY_COLOR_PALETTE),
        pawColor: pickRandomColor(PAW_COLOR_PALETTE),
        eyeColor: pickRandomColor(EYE_COLOR_PALETTE),
    };
}

export function normalizePuppyColor(raw: unknown, fallback: string): string {
    if (typeof raw !== "string") {
        return fallback;
    }
    const color = raw.trim();
    return HEX_COLOR_RE.test(color) ? color.toLowerCase() : fallback;
}

export function normalizePuppyAppearance(raw: unknown): PuppyAppearanceSettings {
    const defaults = buildDefaultPuppyAppearance();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return defaults;
    }
    const record = raw as Record<string, unknown>;
    return {
        bodyColor: normalizePuppyColor(record.bodyColor, defaults.bodyColor),
        pawColor: normalizePuppyColor(record.pawColor, defaults.pawColor),
        eyeColor: normalizePuppyColor(record.eyeColor, defaults.eyeColor),
    };
}

export function normalizePuppySettings(raw: unknown): PuppySettings {
    const defaults = buildDefaultPuppySettings();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return defaults;
    }

    const record = raw as Record<string, unknown>;
    const rawInterval = typeof record.testModeIntervalMs === "number" && Number.isFinite(record.testModeIntervalMs)
        ? Math.floor(record.testModeIntervalMs)
        : defaults.testModeIntervalMs;

    return {
        visible: typeof record.visible === "boolean" ? record.visible : defaults.visible,
        testModeEnabled: typeof record.testModeEnabled === "boolean" ? record.testModeEnabled : defaults.testModeEnabled,
        testModeIntervalMs: Math.max(800, Math.min(10000, rawInterval)),
        showBubble: typeof record.showBubble === "boolean" ? record.showBubble : defaults.showBubble,
        showClickHint: typeof record.showClickHint === "boolean" ? record.showClickHint : defaults.showClickHint,
        appearance: normalizePuppyAppearance(record.appearance),
    };
}

export async function loadPersistedToolConfigState(plugin?: PluginStorage): Promise<ToolConfigLoadState> {
    const raw = await plugin?.loadData?.(CONFIG_STORAGE_KEY);
    return {
        config: normalizeToolConfig(raw),
        warning: getLegacyToolConfigWarning(raw, `plugin storage "${CONFIG_STORAGE_KEY}"`),
    };
}

export async function loadPersistedToolConfig(plugin?: PluginStorage): Promise<ToolConfig> {
    return (await loadPersistedToolConfigState(plugin)).config;
}

export async function savePersistedToolConfig(config: ToolConfig, plugin?: PluginStorage): Promise<ToolConfig> {
    const normalized = normalizeToolConfig(config);
    if (plugin?.saveData) {
        await plugin.saveData(CONFIG_STORAGE_KEY, normalized);
    }
    return normalized;
}

export async function loadPersistedPuppySettings(plugin?: PluginStorage): Promise<PuppySettings> {
    const raw = await plugin?.loadData?.(PUPPY_SETTINGS_STORAGE_KEY);
    return normalizePuppySettings(raw);
}

export async function savePersistedPuppySettings(settings: PuppySettings, plugin?: PluginStorage): Promise<PuppySettings> {
    const normalized = normalizePuppySettings(settings);
    if (plugin?.saveData) {
        await plugin.saveData(PUPPY_SETTINGS_STORAGE_KEY, normalized);
    }
    return normalized;
}

export async function loadPersistedVersionControlSettings(plugin?: PluginStorage): Promise<VersionControlSettings> {
    const raw = await plugin?.loadData?.(VERSION_CONTROL_SETTINGS_STORAGE_KEY);
    return normalizeVersionControlSettings(raw);
}

export async function savePersistedVersionControlSettings(settings: VersionControlSettings, plugin?: PluginStorage): Promise<VersionControlSettings> {
    const normalized = normalizeVersionControlSettings(settings);
    if (plugin?.saveData) {
        await plugin.saveData(VERSION_CONTROL_SETTINGS_STORAGE_KEY, normalized);
    }
    return normalized;
}

export interface HttpServerSettings {
    enabled: boolean;
    host: HttpServerHost;
    port: number;
    token: string;
    authEnabled: boolean;
    tlsEnabled: boolean;
    tlsCertFile: string;
    tlsKeyFile: string;
    tlsCaFile: string;
}

export function hasValidHttpTlsFiles(settings: HttpServerSettings): boolean {
    if (!settings.tlsEnabled) {
        return true;
    }
    return Boolean(settings.tlsCertFile.trim() && settings.tlsKeyFile.trim());
}

function generateRandomToken(): string {
    const bytes = new Uint8Array(32);
    if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildDefaultHttpServerSettings(): HttpServerSettings {
    return {
        enabled: true,
        host: DEFAULT_HTTP_HOST,
        port: DEFAULT_HTTP_PORT,
        token: generateRandomToken(),
        authEnabled: true,
        tlsEnabled: false,
        tlsCertFile: "",
        tlsKeyFile: "",
        tlsCaFile: "",
    };
}

export function normalizeHttpServerHost(raw: unknown): HttpServerHost {
    if (typeof raw !== "string") {
        return DEFAULT_HTTP_HOST;
    }
    const host = raw.trim();
    return HTTP_BIND_HOST_OPTIONS.includes(host as HttpServerHost) ? host as HttpServerHost : DEFAULT_HTTP_HOST;
}

export function normalizeHttpServerSettings(raw: unknown): HttpServerSettings {
    const defaults = buildDefaultHttpServerSettings();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return defaults;
    }
    const record = raw as Record<string, unknown>;
    const rawPort = typeof record.port === "number" && Number.isFinite(record.port)
        ? Math.floor(record.port)
        : defaults.port;
    const port = Math.max(1, Math.min(65535, rawPort));
    const host = normalizeHttpServerHost(record.host);
    const token = typeof record.token === "string" && record.token.length >= 8
        ? record.token
        : defaults.token;
    return {
        enabled: typeof record.enabled === "boolean" ? record.enabled : defaults.enabled,
        host,
        port,
        token,
        authEnabled: typeof record.authEnabled === "boolean" ? record.authEnabled : defaults.authEnabled,
        tlsEnabled: typeof record.tlsEnabled === "boolean" ? record.tlsEnabled : defaults.tlsEnabled,
        tlsCertFile: typeof record.tlsCertFile === "string" ? record.tlsCertFile : defaults.tlsCertFile,
        tlsKeyFile: typeof record.tlsKeyFile === "string" ? record.tlsKeyFile : defaults.tlsKeyFile,
        tlsCaFile: typeof record.tlsCaFile === "string" ? record.tlsCaFile : defaults.tlsCaFile,
    };
}

export function regenerateHttpServerToken(settings: HttpServerSettings): HttpServerSettings {
    return { ...settings, token: generateRandomToken() };
}

export async function loadPersistedHttpServerSettings(plugin?: PluginStorage): Promise<HttpServerSettings> {
    const raw = await plugin?.loadData?.(HTTP_SETTINGS_STORAGE_KEY);
    const normalized = normalizeHttpServerSettings(raw);
    // Persist back if first load (token was just generated)
    if (!raw && plugin?.saveData) {
        await plugin.saveData(HTTP_SETTINGS_STORAGE_KEY, normalized);
    }
    return normalized;
}

export async function savePersistedHttpServerSettings(settings: HttpServerSettings, plugin?: PluginStorage): Promise<HttpServerSettings> {
    const normalized = normalizeHttpServerSettings(settings);
    if (plugin?.saveData) {
        await plugin.saveData(HTTP_SETTINGS_STORAGE_KEY, normalized);
    }
    return normalized;
}

export async function loadPersistedTelemetryConfig(plugin?: PluginStorage): Promise<TelemetryConfig> {
    const raw = await plugin?.loadData?.(TELEMETRY_CONFIG_STORAGE_KEY);
    return normalizeTelemetryConfig(raw);
}

export async function savePersistedTelemetryConfig(config: TelemetryConfig, plugin?: PluginStorage): Promise<TelemetryConfig> {
    const normalized = normalizeTelemetryConfig(config);
    if (plugin?.saveData) {
        await plugin.saveData(TELEMETRY_CONFIG_STORAGE_KEY, normalized);
    }
    return normalized;
}
