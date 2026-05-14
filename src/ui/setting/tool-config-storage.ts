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
}

export interface VersionControlSettings {
    showDebugMeta: boolean;
}

export function buildDefaultVersionControlSettings(): VersionControlSettings {
    return {
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
    host: string;
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
    const host = typeof record.host === "string" && record.host.trim().length > 0
        ? record.host.trim()
        : defaults.host;
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
