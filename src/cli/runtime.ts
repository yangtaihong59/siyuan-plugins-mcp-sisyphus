import { SiYuanClient } from '../api/client';
import {
    MCP_TOOLS_CONFIG_API_PATH,
    buildDefaultToolConfig,
    normalizeToolConfig,
    warnLegacyToolConfigOnce,
    type ToolConfig,
} from '../core/config';
import { PermissionManager } from '../core/permissions';
import { OfficialMcpBridge, type OfficialMcpRuntime } from '../core/official-mcp-bridge';
import { applyConfigToEnv, loadFileConfig, resolveConfig } from './config';
import { ensureRequiredPluginInstalled } from './plugin-check';

import type { ParsedArgs } from './args';

export interface CliRuntimeState {
    client: SiYuanClient;
    toolConfig: ToolConfig;
    permMgr: PermissionManager;
    officialMcpRuntime: OfficialMcpRuntime;
    writeCoordinator?: CliWriteCoordinatorSettings;
}

export interface CliWriteCoordinatorSettings {
    url: string;
    token?: string;
}

const HTTP_SETTINGS_API_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpHttpSettings';

export async function loadCliRuntimeState(
    cli: ParsedArgs,
    options: { loadPermissions?: boolean } = {},
): Promise<CliRuntimeState> {
    const fileConfig = loadFileConfig(cli.configPath);
    const resolved = resolveConfig(fileConfig, {
        cliUrl: cli.url,
        cliToken: cli.token,
        profile: cli.profile,
    });
    applyConfigToEnv(resolved);

    const client = new SiYuanClient({ baseUrl: resolved.apiUrl });
    if (resolved.token) client.setToken(resolved.token);

    await ensureRequiredPluginInstalled(client);

    const toolConfig = await loadToolConfigFromAPI(client);
    const permMgr = new PermissionManager(client);
    if (options.loadPermissions !== false) {
        await permMgr.load();
    }

    const officialMcpRuntime: OfficialMcpRuntime = {
        bridge: new OfficialMcpBridge(client),
        discoveryMode: 'blocking',
    };

    const writeCoordinator = toolConfig.writeSafety.strictMode
        ? await loadWriteCoordinatorSettings(client)
        : undefined;

    return { client, toolConfig, permMgr, officialMcpRuntime, writeCoordinator };
}

async function loadWriteCoordinatorSettings(client: SiYuanClient): Promise<CliWriteCoordinatorSettings | undefined> {
    try {
        const raw = JSON.parse(await client.readFile(HTTP_SETTINGS_API_PATH)) as Record<string, unknown>;
        if (raw.enabled === false) return undefined;
        const port = typeof raw.port === 'number' ? raw.port : 36806;
        const configuredHost = typeof raw.host === 'string' ? raw.host : '127.0.0.1';
        const host = configuredHost === '0.0.0.0' || configuredHost === '::' ? '127.0.0.1' : configuredHost;
        const protocol = raw.tlsEnabled === true ? 'https' : 'http';
        const token = raw.authEnabled === true && typeof raw.token === 'string' ? raw.token : undefined;
        return { url: `${protocol}://${host}:${port}/mcp`, token };
    } catch {
        return undefined;
    }
}

async function loadToolConfigFromAPI(client: SiYuanClient): Promise<ToolConfig> {
    try {
        const content = await client.readFile(MCP_TOOLS_CONFIG_API_PATH);
        if (!content) return buildDefaultToolConfig();

        const raw = JSON.parse(content);
        warnLegacyToolConfigOnce(raw, { source: `SiYuan API file "${MCP_TOOLS_CONFIG_API_PATH}"` });
        return normalizeToolConfig(raw);
    } catch {
        return buildDefaultToolConfig();
    }
}
