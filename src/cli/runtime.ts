import { existsSync } from 'node:fs';

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
import { PRIMARY_CLI_COMMAND } from '../shared/constants';
import { applyConfigToEnv, getReadableConfigPath, getWritableConfigPath, loadFileConfig, resolveConfig, saveNormalizedConfig, setProfile } from './config';
import {
    discoverLocalKernels,
    formatDiscoveredKernels,
    probeKernelToken,
    resolveDiscoveredApiUrl,
    shouldAutoDiscover,
} from './discover-instances';
import { ensureRequiredPluginInstalled } from './plugin-check';
import { writeStatus } from './render';

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
    const apiUrl = await retargetLoopbackProfile(cli, resolved.apiUrl, resolved.token, resolved.profileName);
    applyConfigToEnv({ ...resolved, apiUrl });

    const client = new SiYuanClient({ baseUrl: apiUrl });
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

async function retargetLoopbackProfile(
    cli: ParsedArgs,
    apiUrl: string,
    token: string,
    profileName: string,
): Promise<string> {
    if (!shouldAutoDiscover({
        cliUrl: cli.url,
        envUrl: process.env.SIYUAN_API_URL,
        apiUrl,
        discoverDisabled: process.env.SIYUAN_DISCOVER === '0',
    })) {
        return apiUrl;
    }

    let instances;
    try {
        instances = await discoverLocalKernels();
    } catch {
        return apiUrl;
    }

    const decision = await resolveDiscoveredApiUrl({
        apiUrl,
        token,
        instances,
        probeKernel: probeKernelToken,
    });
    if (decision.ambiguous) {
        throw new Error([
            'More than one running SiYuan kernel matches this profile. Pass --url to choose one:',
            formatDiscoveredKernels(decision.ambiguous),
            `Run \`${PRIMARY_CLI_COMMAND} instances\` to list kernel APIs. Publish-service ports are not kernel APIs.`,
        ].join('\n'));
    }
    if (decision.staleUnmatched) {
        throw new Error([
            `Saved API URL ${apiUrl} is not a running SiYuan kernel. Running kernels:`,
            formatDiscoveredKernels(decision.staleUnmatched),
            `The profile token did not match these workspaces. Pass --url, or run \`${PRIMARY_CLI_COMMAND} instances\`.`,
            'Publish-service ports are not kernel APIs.',
        ].join('\n'));
    }
    if (!decision.retargeted || !decision.instance) return apiUrl;

    const configPath = cli.configPath ? getWritableConfigPath(cli.configPath) : getReadableConfigPath();
    let persisted = false;
    if (existsSync(configPath)) {
        try {
            const updated = setProfile(loadFileConfig(configPath), profileName, { apiUrl: decision.apiUrl });
            saveNormalizedConfig(updated, configPath);
            persisted = true;
        } catch {
            persisted = false;
        }
    }
    const workspace = decision.instance.workspace ? ` (${decision.instance.workspace})` : '';
    const saved = persisted ? `Updated profile ${profileName}.` : `Profile ${profileName} was not rewritten.`;
    writeStatus('info', `Using SiYuan kernel ${decision.apiUrl}${workspace}. ${saved}`, process.stderr);
    return decision.apiUrl;
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
