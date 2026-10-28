import type { SiYuanClient } from '../api/client';
import { PERMISSIONS_API_PATH } from '../core/permissions';
import { SiYuanRequestError } from '../api/errors';

export const REQUIRED_PLUGIN_NAME = 'siyuan-plugins-mcp-sisyphus';
export const REQUIRED_PLUGIN_MANIFEST_PATH = `/data/plugins/${REQUIRED_PLUGIN_NAME}/plugin.json`;

type PluginManifest = {
    name?: unknown;
};

function formatPluginInstallMessage(): string {
    return [
        `This CLI requires the SiYuan plugin "${REQUIRED_PLUGIN_NAME}".`,
        'Install and enable the plugin in SiYuan first, then open the plugin settings panel and configure permissions before retrying.',
    ].join(' ');
}

function formatPluginNotReadyMessage(details?: string): string {
    const suffix = details ? ` Details: ${details}` : '';
    return [
        `The required SiYuan plugin "${REQUIRED_PLUGIN_NAME}" appears to be installed, but its settings are not ready yet.`,
        'Enable the plugin in SiYuan, open its settings panel once, and save/configure notebook permissions before retrying.',
    ].join(' ') + suffix;
}

function isConnectivityOrAuthError(error: unknown): boolean {
    if (error instanceof SiYuanRequestError) {
        return error.kind === 'timeout'
            || (error.kind === 'http' && (error.status === 401 || error.status === 403 || (error.status ?? 0) >= 500));
    }
    const message = error instanceof Error ? error.message : String(error);
    return /unauthorized/i.test(message)
        || /forbidden/i.test(message)
        || /timeout/i.test(message)
        || /fetch failed/i.test(message)
        || /network/i.test(message)
        || /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/i.test(message);
}

function parsePluginManifest(content: string): PluginManifest {
    try {
        return JSON.parse(content) as PluginManifest;
    } catch (error) {
        throw new Error(
            `Found "${REQUIRED_PLUGIN_NAME}" at ${REQUIRED_PLUGIN_MANIFEST_PATH}, but its plugin.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function ensureRequiredPluginInstalled(client: SiYuanClient): Promise<void> {
    let manifestText = '';

    try {
        manifestText = await client.readFile(REQUIRED_PLUGIN_MANIFEST_PATH);
    } catch (error) {
        if (isConnectivityOrAuthError(error)) {
            throw error;
        }
        throw new Error(formatPluginInstallMessage());
    }

    if (!manifestText.trim()) {
        throw new Error(formatPluginInstallMessage());
    }

    const manifest = parsePluginManifest(manifestText);
    if (manifest.name !== REQUIRED_PLUGIN_NAME) {
        throw new Error(formatPluginInstallMessage());
    }

    try {
        await client.readFile(PERMISSIONS_API_PATH);
    } catch (error) {
        if (isConnectivityOrAuthError(error)) {
            throw error;
        }
        throw new Error(formatPluginNotReadyMessage(error instanceof Error ? error.message : String(error)));
    }
}
