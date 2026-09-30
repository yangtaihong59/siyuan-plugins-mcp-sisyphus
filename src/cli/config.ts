import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ProfileEntry {
    apiUrl?: string;
    token?: string;
}

export interface FileConfig {
    apiUrl?: string;
    token?: string;
    currentProfile?: string;
    profiles?: Record<string, ProfileEntry>;
}

export interface NormalizedFileConfig {
    currentProfile: string;
    profiles: Record<string, ProfileEntry>;
}

export interface ResolvedConfig {
    apiUrl: string;
    token: string;
    profileName: string;
}

const DEFAULT_PROFILE = 'default';
const DEFAULT_API_URL = 'http://127.0.0.1:6806';

export function getDefaultConfigPath(): string {
    return join(homedir(), '.siyuan-sisyphus', 'config.json');
}

export function getLegacyConfigPath(): string {
    return join(homedir(), '.siyuan-mcp', 'config.json');
}

export function getWritableConfigPath(configPath?: string): string {
    return configPath ?? getDefaultConfigPath();
}

/** Path loadFileConfig actually reads, including the legacy ~/.siyuan-mcp fallback. */
export function getReadableConfigPath(configPath?: string): string {
    return resolveReadableConfigPath(configPath);
}

export function loadFileConfig(configPath?: string): FileConfig {
    const resolved = resolveReadableConfigPath(configPath);
    if (!existsSync(resolved)) return {};
    try {
        const raw = readFileSync(resolved, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};

        const record = parsed as Record<string, unknown>;
        const profiles = readProfiles(record.profiles);
        return {
            apiUrl: typeof record.apiUrl === 'string' ? record.apiUrl : undefined,
            token: typeof record.token === 'string' ? record.token : undefined,
            currentProfile: typeof record.currentProfile === 'string' ? record.currentProfile : undefined,
            profiles,
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`[siyuan-sisyphus] Failed to load config at ${resolved}: ${msg}`);
    }
}

export function normalizeFileConfig(fileConfig: FileConfig): NormalizedFileConfig {
    const normalizedProfiles = sanitizeProfiles(fileConfig.profiles);
    if (Object.keys(normalizedProfiles).length > 0) {
        const currentProfile = typeof fileConfig.currentProfile === 'string' && fileConfig.currentProfile
            ? fileConfig.currentProfile
            : firstProfileName(normalizedProfiles);
        return {
            currentProfile: normalizedProfiles[currentProfile] ? currentProfile : firstProfileName(normalizedProfiles),
            profiles: normalizedProfiles,
        };
    }

    const apiUrl = typeof fileConfig.apiUrl === 'string' && fileConfig.apiUrl
        ? fileConfig.apiUrl
        : DEFAULT_API_URL;
    const token = typeof fileConfig.token === 'string' ? fileConfig.token : '';
    return {
        currentProfile: DEFAULT_PROFILE,
        profiles: {
            [DEFAULT_PROFILE]: { apiUrl, token },
        },
    };
}

export function resolveConfig(
    fileConfig: FileConfig,
    options: { cliUrl?: string; cliToken?: string; profile?: string } = {},
): ResolvedConfig {
    const normalized = normalizeFileConfig(fileConfig);
    const requestedProfile = options.profile || normalized.currentProfile || DEFAULT_PROFILE;
    const profileConfig = normalized.profiles[requestedProfile];

    if (options.profile && !profileConfig) {
        throw new Error(
            `Unknown profile "${options.profile}". Available profiles: ${Object.keys(normalized.profiles).join(', ') || DEFAULT_PROFILE}.`,
        );
    }

    const activeProfile = profileConfig ?? normalized.profiles[normalized.currentProfile] ?? normalized.profiles[DEFAULT_PROFILE] ?? {};
    const apiUrl = options.cliUrl || process.env.SIYUAN_API_URL || activeProfile.apiUrl || DEFAULT_API_URL;
    const token = options.cliToken || process.env.SIYUAN_TOKEN || activeProfile.token || '';

    return { apiUrl, token, profileName: requestedProfile };
}

export function applyConfigToEnv(config: ResolvedConfig): void {
    process.env.SIYUAN_API_URL = config.apiUrl;
    if (config.token) {
        process.env.SIYUAN_TOKEN = config.token;
    } else {
        delete process.env.SIYUAN_TOKEN;
    }
}

export function saveNormalizedConfig(config: NormalizedFileConfig, configPath?: string): string {
    const target = getWritableConfigPath(configPath);
    const dir = dirname(target);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(target, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    return target;
}

export function setProfile(
    fileConfig: FileConfig,
    profileName: string,
    profile: ProfileEntry,
    options: { makeCurrent?: boolean } = {},
): NormalizedFileConfig {
    const normalized = normalizeFileConfig(fileConfig);
    const existing = normalized.profiles[profileName] ?? {};
    const next: NormalizedFileConfig = {
        currentProfile: options.makeCurrent ? profileName : normalized.currentProfile,
        profiles: {
            ...normalized.profiles,
            [profileName]: {
                apiUrl: profile.apiUrl ?? existing.apiUrl ?? DEFAULT_API_URL,
                token: profile.token ?? existing.token ?? '',
            },
        },
    };

    if (!next.profiles[next.currentProfile]) next.currentProfile = profileName;
    return next;
}

export function setCurrentProfile(fileConfig: FileConfig, profileName: string): NormalizedFileConfig {
    const normalized = normalizeFileConfig(fileConfig);
    if (!normalized.profiles[profileName]) {
        throw new Error(`Unknown profile "${profileName}".`);
    }
    return { ...normalized, currentProfile: profileName };
}

function resolveReadableConfigPath(configPath?: string): string {
    if (configPath) return configPath;

    const defaultPath = getDefaultConfigPath();
    if (existsSync(defaultPath)) return defaultPath;

    const legacyPath = getLegacyConfigPath();
    if (existsSync(legacyPath)) return legacyPath;

    return defaultPath;
}

function readProfiles(value: unknown): Record<string, ProfileEntry> | undefined {
    if (!value || typeof value !== 'object') return undefined;

    const out: Record<string, ProfileEntry> = {};
    for (const [name, rawEntry] of Object.entries(value as Record<string, unknown>)) {
        if (!rawEntry || typeof rawEntry !== 'object') continue;
        const entry = rawEntry as Record<string, unknown>;
        const apiUrl = typeof entry.apiUrl === 'string' ? entry.apiUrl : undefined;
        const token = typeof entry.token === 'string' ? entry.token : undefined;
        if (!apiUrl && token === undefined) continue;
        out[name] = { apiUrl, token };
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeProfiles(profiles?: Record<string, ProfileEntry>): Record<string, ProfileEntry> {
    if (!profiles) return {};

    const out: Record<string, ProfileEntry> = {};
    for (const [name, entry] of Object.entries(profiles)) {
        if (!name) continue;
        const apiUrl = typeof entry?.apiUrl === 'string' && entry.apiUrl ? entry.apiUrl : undefined;
        const token = typeof entry?.token === 'string' ? entry.token : undefined;
        if (!apiUrl && token === undefined) continue;
        out[name] = { apiUrl, token };
    }
    return out;
}

function firstProfileName(profiles: Record<string, ProfileEntry>): string {
    return Object.keys(profiles)[0] ?? DEFAULT_PROFILE;
}
