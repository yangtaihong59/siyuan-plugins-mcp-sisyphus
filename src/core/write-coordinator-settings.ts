import type { SiYuanClient } from '../api/client';
import { MIN_KERNEL_ENDPOINT_VERSION, supportsKernelEndpoint } from '../shared/siyuan-version';

export interface CliWriteCoordinatorEndpoint {
    url: string;
    token?: string;
}

export interface CliWriteCoordinatorSettings {
    /** Exactly one authority; transport failure never selects another owner. */
    owner?: 'kernel' | 'node';
    endpoints: CliWriteCoordinatorEndpoint[];
    /** Set when the kernel owner is configured on a SiYuan that cannot host it; no other owner is chosen. */
    unsupportedReason?: string;
}

const HTTP_SETTINGS_API_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpHttpSettings';

export async function loadWriteCoordinatorSettings(
    client: SiYuanClient,
    apiToken?: string,
): Promise<CliWriteCoordinatorSettings | undefined> {
    try {
        const raw = JSON.parse((await client.readFile(HTTP_SETTINGS_API_PATH)) || '{}') as Record<string, unknown>;
        const settings = selectWriteCoordinatorSettings(raw, client.getBaseUrl(), apiToken);
        if (settings?.owner === 'kernel') {
            const reason = await describeUnsupportedKernelEndpoint(client);
            if (reason) return { ...settings, unsupportedReason: reason };
        }
        return settings;
    } catch {
        return undefined;
    }
}

/** Undefined when supported or when the version cannot be read (the endpoint call then reports its own error). */
async function describeUnsupportedKernelEndpoint(client: SiYuanClient): Promise<string | undefined> {
    let version: unknown;
    try {
        version = await client.requestRead<string>('/api/system/version');
    } catch {
        return undefined;
    }
    if (typeof version !== 'string' || supportsKernelEndpoint(version)) return undefined;
    return `The plugin's Kernel endpoint is enabled, but SiYuan ${version} cannot host it (requires SiYuan ${MIN_KERNEL_ENDPOINT_VERSION} or later). Disable "Kernel endpoint" in the plugin's HTTP settings and enable the HTTP server instead, or upgrade SiYuan. No write was attempted.`;
}

/** One workspace owner. Enabling the kernel endpoint never creates a fallback pair. */
export function selectWriteCoordinatorSettings(
    raw: Record<string, unknown>, apiUrl: string, apiToken?: string,
): CliWriteCoordinatorSettings | undefined {
    if (raw.kernelEndpointEnabled === true) {
        const url = deriveKernelEndpointUrl(apiUrl);
        return url ? { owner: 'kernel', endpoints: [{ url, token: apiToken }] } : undefined;
    }
    if (raw.enabled === false) return undefined;
    const token = raw.authEnabled === true && typeof raw.token === 'string' ? raw.token : undefined;
    const port = typeof raw.port === 'number' ? raw.port : 36806;
    const configuredHost = typeof raw.host === 'string' ? raw.host : '127.0.0.1';
    const host = configuredHost === '0.0.0.0' || configuredHost === '::' ? '127.0.0.1' : configuredHost;
    const protocol = raw.tlsEnabled === true ? 'https' : 'http';
    return { owner: 'node', endpoints: [{ url: `${protocol}://${host}:${port}/mcp`, token }] };
}

const KERNEL_PRIVATE_BASE = '/plugin/private/siyuan-plugins-mcp-sisyphus';

/**
 * Derive the kernel-hosted coordinator endpoint from the kernel base URL.
 * Returns `<apiUrl>/plugin/private/<name>/mcp`, or undefined when the API URL
 * cannot be parsed. The trailing /mcp keeps parity with the standalone MCP
 * server path so `callCliWriteCoordinator` needs no special-casing.
 */
export function deriveKernelEndpointUrl(apiUrl: string): string | undefined {
    try {
        const base = new URL(apiUrl);
        base.pathname = `${KERNEL_PRIVATE_BASE}/mcp`;
        base.search = '';
        base.hash = '';
        return base.toString().replace(/\/+$/, '');
    } catch {
        return undefined;
    }
}
