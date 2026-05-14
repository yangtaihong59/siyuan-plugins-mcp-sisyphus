import { beforeEach, describe, expect, it, vi } from 'vitest';

const puppyInstances: Array<{
    args: unknown;
    $set: ReturnType<typeof vi.fn>;
    $destroy: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('siyuan', () => ({
    Plugin: class {},
    showMessage: vi.fn(),
    Dialog: class {},
}));

vi.mock('@/ui/setting/mcp-config.svelte', () => ({
    default: class {
        $destroy() {}
    },
}));

vi.mock('@/ui/components/ToolPuppy.svelte', () => ({
    default: class {
        private readonly instance: typeof puppyInstances[number];

        constructor(args: unknown) {
            this.instance = {
                args,
                $set: vi.fn(),
                $destroy: vi.fn(),
            };
            puppyInstances.push(this.instance);
        }

        $set(args: unknown) {
            this.instance.$set(args);
        }

        $destroy() {
            this.instance.$destroy();
        }
    },
}));

vi.mock('@/ui/version-control/VersionControlPanel.svelte', () => ({
    default: class {
        $destroy() {}
    },
}));

import SiyuanMCP from '@/index';
import { resetToolConfigWarningStateForTests } from '@/core/config';
import type { HttpServerSettings } from '@/ui/setting/tool-config-storage';

import { HttpServerLauncher } from '@/server-launcher';
import { showMessage } from 'siyuan';

class FakeElement {
    id = '';
    parentNode: FakeElement | null = null;
    children: FakeElement[] = [];

    appendChild(child: FakeElement) {
        child.remove();
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
    }

    get isConnected() {
        if (!this.parentNode) return false;
        return this.parentNode.isConnected;
    }

    set innerHTML(value: string) {
        if (value === '') {
            for (const child of this.children) {
                child.parentNode = null;
            }
            this.children = [];
        }
    }

    get innerHTML() {
        return '';
    }
}

class FakeBodyElement extends FakeElement {
    get isConnected() {
        return true;
    }
}

class FakeDocument {
    body = new FakeBodyElement();

    createElement(_tagName: string) {
        return new FakeElement();
    }

    querySelector(selector: string) {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string) {
        if (!selector.startsWith('#')) return [];
        const id = selector.slice(1);
        return this.body.children.filter((child) => child.id === id);
    }

    getElementById(id: string) {
        return this.querySelector(`#${id}`);
    }
}

function installFakeDom() {
    const document = new FakeDocument();
    (globalThis as any).document = document;
    (globalThis as any).HTMLElement = FakeElement;
    return document;
}

describe('HTTP settings sync', () => {
    let plugin: SiyuanMCP;
    let saveData: ReturnType<typeof vi.fn>;
    let loadData: ReturnType<typeof vi.fn>;
    let launcherStart: ReturnType<typeof vi.fn>;
    let launcherStop: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        resetToolConfigWarningStateForTests();
        vi.mocked(showMessage).mockClear();
        puppyInstances.length = 0;
        installFakeDom();
        document.body.innerHTML = '';
        plugin = new SiyuanMCP();
        loadData = vi.fn().mockResolvedValue(undefined);
        saveData = vi.fn().mockResolvedValue(undefined);
        launcherStart = vi.fn().mockResolvedValue(undefined);
        launcherStop = vi.fn().mockResolvedValue(undefined);

        Object.assign(plugin, {
            name: 'siyuan-plugins-mcp-sisyphus',
            loadData,
            saveData,
        });
        plugin.httpLauncher = {
            start: launcherStart,
            stop: launcherStop,
            getStatus: vi.fn(() => ({ running: false, host: '127.0.0.1', port: 36806 })),
        } as any;

        (globalThis as any).window = {
            siyuan: {
                config: {
                    api: { token: 'siyuan-token' },
                    system: { workspaceDir: '/mock/workspace' },
                },
            },
        };

        vi.restoreAllMocks();
    });

    it('syncs settings into plugin state before start', async () => {
        const next: HttpServerSettings = {
            enabled: false,
            host: '127.0.0.1',
            port: 39000,
            token: '12345678-token',
            authEnabled: true,
            tlsEnabled: false,
            tlsCertFile: '',
            tlsKeyFile: '',
            tlsCaFile: '',
        };

        await plugin.setHttpServerSettings(next);
        await plugin.startHttpServer();

        expect(plugin.httpSettings.port).toBe(39000);
        expect(saveData).toHaveBeenCalledWith('mcpHttpSettings', expect.objectContaining({ port: 39000 }));
        expect(launcherStart).toHaveBeenCalledWith(expect.objectContaining({
            host: '127.0.0.1',
            port: 39000,
            token: '12345678-token',
            siyuanToken: 'siyuan-token',
        }));
    });

    it('restarts running server with updated settings', async () => {
        const getStatus = vi.fn(() => ({ running: true, host: '127.0.0.1', port: 36806 }));
        plugin.httpLauncher = {
            start: launcherStart,
            stop: launcherStop,
            getStatus,
        } as any;

        const next: HttpServerSettings = {
            enabled: false,
            host: '0.0.0.0',
            port: 39001,
            token: 'updated-token',
            authEnabled: false,
            tlsEnabled: false,
            tlsCertFile: '',
            tlsKeyFile: '',
            tlsCaFile: '',
        };

        await plugin.updateHttpServerSettings(next);

        expect(launcherStop).toHaveBeenCalledTimes(1);
        expect(plugin.httpSettings).toEqual(expect.objectContaining({
            host: '0.0.0.0',
            port: 39001,
            authEnabled: false,
        }));
        expect(launcherStart).toHaveBeenCalledWith(expect.objectContaining({
            host: '0.0.0.0',
            port: 39001,
            token: undefined,
        }));
    });

    it('restarts a running HTTP server after user rules change', async () => {
        const getStatus = vi.fn(() => ({ running: true, host: '127.0.0.1', port: 36806 }));
        plugin.httpLauncher = {
            start: launcherStart,
            stop: launcherStop,
            getStatus,
        } as any;
        plugin.httpSettings = {
            enabled: true,
            host: '127.0.0.1',
            port: 36806,
            token: 'rules-token',
            authEnabled: true,
            tlsEnabled: false,
            tlsCertFile: '',
            tlsKeyFile: '',
            tlsCaFile: '',
        };

        const restarted = await plugin.refreshHttpServerAfterUserRulesChange();

        expect(restarted).toBe(true);
        expect(launcherStop).toHaveBeenCalledTimes(1);
        expect(launcherStart).toHaveBeenCalledWith(expect.objectContaining({
            host: '127.0.0.1',
            port: 36806,
            token: 'rules-token',
        }));
    });

    it('does not restart a stopped HTTP server after user rules change', async () => {
        const restarted = await plugin.refreshHttpServerAfterUserRulesChange();

        expect(restarted).toBe(false);
        expect(launcherStop).not.toHaveBeenCalled();
        expect(launcherStart).not.toHaveBeenCalled();
    });

    it('starts stopped server when auto-start is enabled in new settings', async () => {
        const next: HttpServerSettings = {
            enabled: true,
            host: '127.0.0.1',
            port: 39002,
            token: 'another-token',
            authEnabled: true,
            tlsEnabled: false,
            tlsCertFile: '',
            tlsKeyFile: '',
            tlsCaFile: '',
        };

        await plugin.updateHttpServerSettings(next);

        expect(launcherStop).not.toHaveBeenCalled();
        expect(launcherStart).toHaveBeenCalledWith(expect.objectContaining({
            port: 39002,
            token: 'another-token',
        }));
    });

    it('rejects HTTPS start when TLS cert or key path is missing', async () => {
        plugin.httpSettings = {
            enabled: true,
            host: '127.0.0.1',
            port: 39003,
            token: 'secure-token',
            authEnabled: true,
            tlsEnabled: true,
            tlsCertFile: '/tmp/cert.pem',
            tlsKeyFile: '',
            tlsCaFile: '',
        };

        await expect(plugin.startHttpServer()).rejects.toThrow('HTTPS requires both certificate and key file paths.');
        expect(launcherStart).not.toHaveBeenCalled();
    });

    it('reports unsupported launcher support when workspaceDir is missing', () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;

        expect(HttpServerLauncher.getSupportInfo()).toEqual({
            supported: false,
            reason: 'workspace_dir_unavailable',
        });
        expect(HttpServerLauncher.isSupported()).toBe(false);
    });

    it('skips launcher init without logging when current frontend is unsupported', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        plugin.httpLauncher = null;

        await plugin.onload();

        expect(plugin.httpLauncher).toBeNull();
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('registers the top bar button as the plugin settings entry', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const addTopBar = vi.fn();
        const openSetting = vi.spyOn(plugin, 'openSetting').mockImplementation(() => undefined);
        Object.assign(plugin, {
            addTopBar,
            i18n: { mcpToolsSettingTitle: 'SiYuan Sisyphus 设置' },
        });

        await plugin.onload();

        expect(addTopBar).toHaveBeenCalledWith(expect.objectContaining({
            title: 'SiYuan Sisyphus 设置',
            callback: expect.any(Function),
            position: 'right',
        }));
        const config = addTopBar.mock.calls[0][0];
        config.callback();
        expect(openSetting).toHaveBeenCalledTimes(1);
    });

    it('initializes launcher and auto-starts HTTP server when supported', async () => {
        const startSpy = vi.spyOn(HttpServerLauncher.prototype, 'start').mockResolvedValue(undefined);
        plugin.httpLauncher = null;

        await plugin.onload();

        expect(plugin.httpLauncher).toBeInstanceOf(HttpServerLauncher);
        expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({
            host: '127.0.0.1',
            port: 36806,
            siyuanToken: 'siyuan-token',
        }));
    });

    it('shows a one-time warning when persisted tool config uses the legacy format', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        loadData.mockImplementation(async (storageName: string) => {
            if (storageName === 'mcpToolsConfig') {
                return {
                    notebook: ['list', 'rename'],
                    remove_document: true,
                };
            }
            return undefined;
        });

        await plugin.onload();
        await plugin.onload();

        expect(showMessage).toHaveBeenCalledTimes(1);
        expect(showMessage).toHaveBeenCalledWith(expect.stringContaining('Detected legacy tool config format'));
    });

    it('mounts the puppy only once when layout becomes ready repeatedly', () => {
        plugin.onLayoutReady();
        plugin.onLayoutReady();

        expect(document.querySelectorAll('#sy-puppy-root')).toHaveLength(1);
        expect(puppyInstances).toHaveLength(1);
    });

    it('self-heals orphan puppy roots before remounting', () => {
        const orphanRoot = document.createElement('div');
        orphanRoot.id = 'sy-puppy-root';
        document.body.appendChild(orphanRoot);

        plugin.onLayoutReady();

        const roots = document.querySelectorAll('#sy-puppy-root');
        expect(roots).toHaveLength(1);
        expect(roots[0]).not.toBe(orphanRoot);
        expect(puppyInstances).toHaveLength(1);
    });

    it('destroys the puppy component and removes its root on unload', async () => {
        plugin.onLayoutReady();
        const mountedPuppy = puppyInstances[0];

        await plugin.onunload();

        expect(mountedPuppy.$destroy).toHaveBeenCalledTimes(1);
        expect(document.querySelector('#sy-puppy-root')).toBeNull();
    });

    it('pushes updated settings into the mounted puppy component', () => {
        plugin.onLayoutReady();
        const mountedPuppy = puppyInstances[0];

        plugin.updatePuppyTestSettings({
            visible: false,
            testModeEnabled: true,
            testModeIntervalMs: 1500,
            showBubble: true,
            showClickHint: false,
        });

        expect(mountedPuppy.$set).toHaveBeenCalledWith({
            visible: false,
            testModeEnabled: true,
            testModeIntervalMs: 1500,
            showBubble: true,
            showClickHint: false,
        });
    });
});
