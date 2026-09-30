import { existsSync } from 'node:fs';

import { loadWriteCoordinatorSettings, type CliWriteCoordinatorSettings } from '../core/write-coordinator-settings';
export { deriveKernelEndpointUrl, loadWriteCoordinatorSettings, selectWriteCoordinatorSettings } from '../core/write-coordinator-settings';
export type { CliWriteCoordinatorSettings, CliWriteCoordinatorEndpoint } from '../core/write-coordinator-settings';
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

    const writeCoordinator = await loadWriteCoordinatorSettings(client, resolved.token);

    return { client, toolConfig, permMgr, officialMcpRuntime, writeCoordinator };
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
