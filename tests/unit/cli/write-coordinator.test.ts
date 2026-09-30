import { describe, expect, it } from 'vitest';

import { deriveKernelEndpointUrl } from '@/cli/runtime';


describe('deriveKernelEndpointUrl', () => {
    it('maps the kernel base URL to the private plugin /mcp path', () => {
        expect(deriveKernelEndpointUrl('http://127.0.0.1:6806'))
            .toBe('http://127.0.0.1:6806/plugin/private/siyuan-plugins-mcp-sisyphus/mcp');
        expect(deriveKernelEndpointUrl('http://siyuan.xupeidong.cn:5666'))
            .toBe('http://siyuan.xupeidong.cn:5666/plugin/private/siyuan-plugins-mcp-sisyphus/mcp');
    });

    it('drops any existing path, query, and hash from the base URL', () => {
        expect(deriveKernelEndpointUrl('https://siyuan.example.com:5666/stage/build/desktop/?r=abc#x'))
            .toBe('https://siyuan.example.com:5666/plugin/private/siyuan-plugins-mcp-sisyphus/mcp');
    });

    it('returns undefined when the API URL cannot be parsed', () => {
        expect(deriveKernelEndpointUrl('not a url')).toBeUndefined();
        expect(deriveKernelEndpointUrl('')).toBeUndefined();
    });
});

import { selectWriteCoordinatorSettings } from '@/cli/runtime';
import { selectOfficialTools } from '@/core/official-mcp-tools';

it('selects the kernel as sole owner even when the Node listener is off', () => {
    const settings = selectWriteCoordinatorSettings({ enabled: false, kernelEndpointEnabled: true }, 'http://example:6806', 'api-token');
    expect(settings).toEqual({ owner: 'kernel', endpoints: [{ url: 'http://example:6806/plugin/private/siyuan-plugins-mcp-sisyphus/mcp', token: 'api-token' }] });
    expect(selectWriteCoordinatorSettings({ enabled: true, kernelEndpointEnabled: true }, 'http://example:6806')?.endpoints).toHaveLength(1);
    expect(selectWriteCoordinatorSettings({ enabled: false }, 'http://example:6806')).toBeUndefined();
});

it('recognizes native MCP annotations and intersects optional capability metadata', () => {
    const tools = selectOfficialTools([
        { name: 'opaque', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
        { name: 'self', inputSchema: { type: 'object' } },
    ], [
        { name: 'opaque', source: 'plugin', ownerId: 'other' },
        { name: 'hidden', source: 'plugin' },
        { name: 'self', source: 'plugin', ownerId: 'siyuan-plugins-mcp-sisyphus' },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'opaque', source: 'plugin', readOnlyHint: true });
});
