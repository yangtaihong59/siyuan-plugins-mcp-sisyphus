import { describe, expect, it } from 'vitest';

import { buildDefaultHttpServerSettings, normalizeHttpServerSettings } from '@/ui/setting/tool-config-storage';

describe('HTTP server settings storage', () => {
    it('defaults to loopback binding', () => {
        expect(buildDefaultHttpServerSettings().host).toBe('127.0.0.1');
        expect(normalizeHttpServerSettings(undefined).host).toBe('127.0.0.1');
    });

    it('allows binding the HTTP server to all IPv4 interfaces', () => {
        expect(normalizeHttpServerSettings({ host: '0.0.0.0' }).host).toBe('0.0.0.0');
    });

    it('falls back to loopback for unsupported bind hosts', () => {
        expect(normalizeHttpServerSettings({ host: 'localhost' }).host).toBe('127.0.0.1');
        expect(normalizeHttpServerSettings({ host: '192.168.1.10' }).host).toBe('127.0.0.1');
    });
});
