import { describe, expect, it } from 'vitest';

import { buildDefaultHttpServerSettings, normalizeHttpServerSettings } from '@/ui/setting/tool-config-storage';

describe('HTTP server settings storage', () => {
    it('defaults to loopback binding', () => {
        expect(buildDefaultHttpServerSettings().host).toBe('127.0.0.1');
        expect(normalizeHttpServerSettings(undefined).host).toBe('127.0.0.1');
        expect(buildDefaultHttpServerSettings().skillsExtensionEnabled).toBe(true);
    });

    it('allows binding the HTTP server to all IPv4 interfaces', () => {
        expect(normalizeHttpServerSettings({ host: '0.0.0.0' }).host).toBe('0.0.0.0');
    });

    it('falls back to loopback for unsupported bind hosts', () => {
        expect(normalizeHttpServerSettings({ host: 'localhost' }).host).toBe('127.0.0.1');
        expect(normalizeHttpServerSettings({ host: '192.168.1.10' }).host).toBe('127.0.0.1');
    });

    it('normalizes the Skills over MCP switch while preserving old HTTP configs', () => {
        const migrated = normalizeHttpServerSettings({ port: 39000 });
        expect(migrated.skillsExtensionEnabled).toBe(true);

        const enabled = normalizeHttpServerSettings({
            skillsExtensionEnabled: true,
        });
        expect(enabled.skillsExtensionEnabled).toBe(true);
        expect(enabled).not.toHaveProperty('skillsExtensionCatalog');
    });
});

it('preserves normalized kernel options when saving unrelated HTTP settings', () => {
    const settings = normalizeHttpServerSettings({ kernelOptions: { readMaxMiB: 24, readRetries: 2, allowedOrigins: ['https://client.example'] } });
    const next = normalizeHttpServerSettings({ ...settings, port: 39001 });
    expect(next.kernelOptions).toMatchObject({ readMaxMiB: 24, readRetries: 2, allowedOrigins: ['https://client.example'] });
});
