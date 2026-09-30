import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SiYuanClient } from '@/api/client';
import type { ParsedArgs } from '@/cli/args';
import * as discover from '@/cli/discover-instances';
import * as pluginCheck from '@/cli/plugin-check';
import { loadCliRuntimeState } from '@/cli/runtime';

function cli(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
    return {
        command: 'list',
        rest: [],
        json: false,
        debug: false,
        ...overrides,
    };
}

function writeWorkspace(workspace: string, token: string, publishPort?: number): void {
    const confDir = join(workspace, 'conf');
    mkdirSync(confDir, { recursive: true });
    writeFileSync(join(confDir, 'conf.json'), JSON.stringify({
        api: { token },
        publish: publishPort ? { enable: true, port: publishPort } : { enable: false },
    }));
}

describe('cli runtime kernel discovery', () => {
    let dir = '';
    let configPath = '';
    let stderr = '';
    let jdyDir = '';
    let softwareDir = '';

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'sisyphus-discover-'));
        configPath = join(dir, 'config.json');
        jdyDir = join(dir, 'jdy');
        softwareDir = join(dir, 'software');
        writeWorkspace(jdyDir, 'jdy-token', 6810);
        writeWorkspace(softwareDir, 'soft-token');
        writeFileSync(configPath, JSON.stringify({
            currentProfile: 'jdylog',
            profiles: {
                jdylog: { apiUrl: 'http://127.0.0.1:63106', token: 'jdy-token' },
                software: { apiUrl: 'http://127.0.0.1:62820', token: 'soft-token' },
            },
        }, null, 2));
        delete process.env.SIYUAN_DISCOVER;
        delete process.env.SIYUAN_API_URL;
        delete process.env.SIYUAN_TOKEN;
        stderr = '';
        vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            stderr += String(chunk);
            return true;
        }) as typeof process.stderr.write);
        vi.spyOn(pluginCheck, 'ensureRequiredPluginInstalled').mockResolvedValue(undefined);
        vi.spyOn(SiYuanClient.prototype, 'readFile').mockResolvedValue('');
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function kernels() {
        return [
            { pid: 1, port: 63330, apiUrl: 'http://127.0.0.1:63330', workspace: jdyDir },
            { pid: 2, port: 62820, apiUrl: 'http://127.0.0.1:62820', workspace: softwareDir },
        ];
    }

    it('rewrites only the matched profile URL and keeps its token', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch');
        vi.spyOn(discover, 'discoverLocalKernels').mockResolvedValue(kernels());
        let seenUrl = '';
        vi.mocked(pluginCheck.ensureRequiredPluginInstalled).mockImplementation(async (client) => {
            seenUrl = client.getBaseUrl();
        });

        await loadCliRuntimeState(cli({ configPath }), { loadPermissions: false });

        const saved = JSON.parse(readFileSync(configPath, 'utf8'));
        expect(saved.currentProfile).toBe('jdylog');
        expect(saved.profiles.jdylog).toEqual({ apiUrl: 'http://127.0.0.1:63330', token: 'jdy-token' });
        expect(saved.profiles.software).toEqual({ apiUrl: 'http://127.0.0.1:62820', token: 'soft-token' });
        expect(seenUrl).toBe('http://127.0.0.1:63330');
        expect(stderr).toContain('Updated profile jdylog.');
        expect(stderr).not.toContain('6810');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('does not guess or rewrite when two kernels share the profile token', async () => {
        writeWorkspace(jdyDir, 'same-token');
        writeWorkspace(softwareDir, 'same-token');
        writeFileSync(configPath, JSON.stringify({
            currentProfile: 'jdylog',
            profiles: {
                jdylog: { apiUrl: 'http://127.0.0.1:63106', token: 'same-token' },
            },
        }));
        const before = readFileSync(configPath, 'utf8');
        vi.spyOn(discover, 'discoverLocalKernels').mockResolvedValue(kernels());

        await expect(loadCliRuntimeState(cli({ configPath }), { loadPermissions: false }))
            .rejects.toThrow('More than one running SiYuan kernel matches this profile');
        expect(readFileSync(configPath, 'utf8')).toBe(before);
    });

    it('probes kernel ports when the workspace file does not identify the token', async () => {
        vi.spyOn(discover, 'discoverLocalKernels').mockResolvedValue([
            { pid: 1, port: 63330, apiUrl: 'http://127.0.0.1:63330', workspace: jdyDir },
            { pid: 3, port: 62756, apiUrl: 'http://127.0.0.1:62756' },
        ]);
        vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const ok = String(input).includes(':62756');
            return { ok, json: async () => ({ code: 0 }) } as Response;
        });
        writeFileSync(configPath, JSON.stringify({
            currentProfile: 'jdylog',
            profiles: {
                jdylog: { apiUrl: 'http://127.0.0.1:63106', token: 'orphan-token' },
            },
        }));

        await loadCliRuntimeState(cli({ configPath }), { loadPermissions: false });

        expect(JSON.parse(readFileSync(configPath, 'utf8')).profiles.jdylog.apiUrl).toBe('http://127.0.0.1:62756');
    });

    it('leaves an explicit URL, environment URL, and disabled scan unchanged', async () => {
        const discoverSpy = vi.spyOn(discover, 'discoverLocalKernels').mockResolvedValue(kernels());
        const before = readFileSync(configPath, 'utf8');

        process.env.SIYUAN_DISCOVER = '0';
        await loadCliRuntimeState(cli({ configPath }), { loadPermissions: false });
        delete process.env.SIYUAN_DISCOVER;

        process.env.SIYUAN_API_URL = 'http://127.0.0.1:63106';
        await loadCliRuntimeState(cli({ configPath }), { loadPermissions: false });
        delete process.env.SIYUAN_API_URL;

        await loadCliRuntimeState(cli({ configPath, url: 'http://127.0.0.1:6810' }), { loadPermissions: false });

        expect(discoverSpy).not.toHaveBeenCalled();
        expect(readFileSync(configPath, 'utf8')).toBe(before);
    });

    it('keeps the saved URL when the process scan fails', async () => {
        vi.spyOn(discover, 'discoverLocalKernels').mockRejectedValue(new Error('ps failed'));
        let seenUrl = '';
        vi.mocked(pluginCheck.ensureRequiredPluginInstalled).mockImplementation(async (client) => {
            seenUrl = client.getBaseUrl();
        });

        await loadCliRuntimeState(cli({ configPath }), { loadPermissions: false });

        expect(seenUrl).toBe('http://127.0.0.1:63106');
        expect(JSON.parse(readFileSync(configPath, 'utf8')).profiles.jdylog.apiUrl).toBe('http://127.0.0.1:63106');
    });
});
