import { describe, expect, it, vi } from 'vitest';

import { ensureRequiredPluginInstalled, REQUIRED_PLUGIN_MANIFEST_PATH } from '@/cli/plugin-check';
import { PERMISSIONS_API_PATH } from '@/core/permissions';
import { requestError } from '../../helpers/request-error';

describe('cli/plugin-check', () => {
    it('passes when plugin manifest exists and permissions storage is readable', async () => {
        const client = {
            readFile: vi.fn(async (path: string) => {
                if (path === REQUIRED_PLUGIN_MANIFEST_PATH) {
                    return JSON.stringify({ name: 'siyuan-plugins-mcp-sisyphus' });
                }
                if (path === PERMISSIONS_API_PATH) {
                    return '{}';
                }
                throw new Error(`Unexpected path: ${path}`);
            }),
        } as any;

        await expect(ensureRequiredPluginInstalled(client)).resolves.toBeUndefined();
    });

    it('fails with an install hint when the plugin manifest is missing', async () => {
        const client = {
            readFile: vi.fn(async (path: string) => {
                if (path === REQUIRED_PLUGIN_MANIFEST_PATH) {
                    return '';
                }
                throw new Error(`Unexpected path: ${path}`);
            }),
        } as any;

        await expect(ensureRequiredPluginInstalled(client)).rejects.toThrow(/requires the SiYuan plugin/i);
    });

    it('fails with a setup hint when plugin permissions storage is not ready', async () => {
        const client = {
            readFile: vi.fn(async (path: string) => {
                if (path === REQUIRED_PLUGIN_MANIFEST_PATH) {
                    return JSON.stringify({ name: 'siyuan-plugins-mcp-sisyphus' });
                }
                if (path === PERMISSIONS_API_PATH) {
                    throw requestError('HTTP error: 500 Internal Server Error');
                }
                throw new Error(`Unexpected path: ${path}`);
            }),
        } as any;

        await expect(ensureRequiredPluginInstalled(client)).rejects.toThrow(/HTTP error: 500/i);
    });

    it('fails with a settings hint when plugin permissions storage is unreadable for local reasons', async () => {
        const client = {
            readFile: vi.fn(async (path: string) => {
                if (path === REQUIRED_PLUGIN_MANIFEST_PATH) {
                    return JSON.stringify({ name: 'siyuan-plugins-mcp-sisyphus' });
                }
                if (path === PERMISSIONS_API_PATH) {
                    throw new Error('file not found');
                }
                throw new Error(`Unexpected path: ${path}`);
            }),
        } as any;

        await expect(ensureRequiredPluginInstalled(client)).rejects.toThrow(/settings are not ready/i);
    });
});
