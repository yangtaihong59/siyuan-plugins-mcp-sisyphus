import { beforeEach, describe, expect, it, vi } from 'vitest';

const puppyInstances: Array<{
    args: unknown;
    $set: ReturnType<typeof vi.fn>;
    $destroy: ReturnType<typeof vi.fn>;
}> = [];

const snapshotPanelInstances: Array<{
    args: unknown;
    $set: ReturnType<typeof vi.fn>;
    $destroy: ReturnType<typeof vi.fn>;
}> = [];

const diffPanelInstances: Array<{
    args: unknown;
    $set: ReturnType<typeof vi.fn>;
    $destroy: ReturnType<typeof vi.fn>;
}> = [];

const PLUGIN_NAME = 'siyuan-plugins-mcp-sisyphus';
const SNAPSHOT_DOCK_TYPE = 'sisyphusSnapshotDock';
const SNAPSHOT_REGISTERED_DOCK_TYPE = `${PLUGIN_NAME}${SNAPSHOT_DOCK_TYPE}`;
const SNAPSHOT_ICON_ID = 'iconSisyphusSnapshotDock';
const TIMELINE_DOCK_TYPE = 'sisyphusTimelineDock';
const TIMELINE_REGISTERED_DOCK_TYPE = `${PLUGIN_NAME}${TIMELINE_DOCK_TYPE}`;
const TIMELINE_ICON_ID = 'iconSisyphusTimelineDock';
const { getAllEditorMock } = vi.hoisted(() => ({ getAllEditorMock: vi.fn(() => []) }));

vi.mock('siyuan', () => ({
    Plugin: class {},
    showMessage: vi.fn(),
    Dialog: class {},
    getAllEditor: getAllEditorMock,
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

vi.mock('@/ui/version-control/SnapshotPanel.svelte', () => ({
    default: class {
        private readonly instance: typeof snapshotPanelInstances[number];

        constructor(args: unknown) {
            this.instance = {
                args,
                $set: vi.fn(),
                $destroy: vi.fn(),
            };
            snapshotPanelInstances.push(this.instance);
        }

        $set(args: unknown) {
            this.instance.$set(args);
        }

        $destroy() {
            this.instance.$destroy();
        }
    },
}));

vi.mock('@/ui/version-control/VersionDiffPanel.svelte', () => ({
    default: class {
        private readonly instance: typeof diffPanelInstances[number];

        constructor(args: unknown) {
            this.instance = {
                args,
                $set: vi.fn(),
                $destroy: vi.fn(),
            };
            diffPanelInstances.push(this.instance);
        }

        $set(args: unknown) {
            this.instance.$set(args);
        }

        $destroy() {
            this.instance.$destroy();
        }
    },
}));

import SiyuanMCP from '@/index';
import { resetToolConfigWarningStateForTests } from '@/core/config';
import type { HttpServerSettings } from '@/ui/setting/tool-config-storage';

import { HttpServerLauncher } from '@/server-launcher';
import { showMessage } from 'siyuan';

class FakeElement {
    id = '';
    className = '';
    parentNode: FakeElement | null = null;
    children: FakeElement[] = [];
    private readonly attributes: Record<string, string> = {};

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

    setAttribute(name: string, value: string) {
        this.attributes[name] = value;
        if (name === 'class') {
            this.className = value;
        }
    }

    getAttribute(name: string) {
        return this.attributes[name] ?? null;
    }

    closest(selector: string) {
        if (selector !== '.dock__item') return null;
        let element: FakeElement | null = this;
        while (element) {
            if (element.className.split(/\s+/).includes('dock__item')) {
                return element;
            }
            element = element.parentNode;
        }
        return null;
    }

    querySelector(selector: string) {
        if (!selector.startsWith('#')) return null;
        const child = new FakeElement();
        child.id = selector.slice(1);
        this.appendChild(child);
        return child;
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
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            return this.body.children.filter((child) => child.id === id);
        }

        const dockTypes = Array.from(selector.matchAll(/\[data-type="([^"]+)"\]/g)).map((match) => match[1]);
        const dockTypeSuffixes = Array.from(selector.matchAll(/\[data-type\$="([^"]+)"\]/g)).map((match) => match[1]);
        const dockIds = Array.from(selector.matchAll(/\[data-id="([^"]+)"\]/g)).map((match) => match[1]);
        const dockIdSuffixes = Array.from(selector.matchAll(/\[data-id\$="([^"]+)"\]/g)).map((match) => match[1]);
        const dockIcons = Array.from(selector.matchAll(/\[data-icon="([^"]+)"\]/g)).map((match) => match[1]);
        if (dockTypes.length === 0 && dockTypeSuffixes.length === 0 && dockIds.length === 0 && dockIdSuffixes.length === 0 && dockIcons.length === 0) return [];
        return this.body.children.filter((child) => (
            child.className.split(/\s+/).includes('dock__item') &&
            (
                dockTypes.includes(child.getAttribute('data-type') ?? '') ||
                dockTypeSuffixes.some((suffix) => (child.getAttribute('data-type') ?? '').endsWith(suffix)) ||
                dockIds.includes(child.getAttribute('data-id') ?? '') ||
                dockIdSuffixes.some((suffix) => (child.getAttribute('data-id') ?? '').endsWith(suffix)) ||
                dockIcons.includes(child.getAttribute('data-icon') ?? '')
            )
        ));
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
    let addDock: ReturnType<typeof vi.fn>;
    let addIcons: ReturnType<typeof vi.fn>;
    let eventBusOn: ReturnType<typeof vi.fn>;
    let eventBusOff: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        resetToolConfigWarningStateForTests();
        vi.mocked(showMessage).mockClear();
        getAllEditorMock.mockReset().mockReturnValue([]);
        puppyInstances.length = 0;
        snapshotPanelInstances.length = 0;
        diffPanelInstances.length = 0;
        installFakeDom();
        document.body.innerHTML = '';
        plugin = new SiyuanMCP();
        loadData = vi.fn().mockResolvedValue(undefined);
        saveData = vi.fn().mockResolvedValue(undefined);
        launcherStart = vi.fn().mockResolvedValue(undefined);
        launcherStop = vi.fn().mockResolvedValue(undefined);
        addDock = vi.fn((options) => ({
            config: { ...options.config, type: `${PLUGIN_NAME}${options.type}` },
            model: { type: `${PLUGIN_NAME}${options.type}` },
        }));
        addIcons = vi.fn();
        eventBusOn = vi.fn();
        eventBusOff = vi.fn();

        Object.assign(plugin, {
            name: PLUGIN_NAME,
            loadData,
            saveData,
            addDock,
            addIcons,
            commands: [],
            docks: {
                [SNAPSHOT_REGISTERED_DOCK_TYPE]: {},
                [TIMELINE_REGISTERED_DOCK_TYPE]: {},
            },
            eventBus: {
                on: eventBusOn,
                off: eventBusOff,
            },
        });
        plugin.httpLauncher = {
            start: launcherStart,
            stop: launcherStop,
            getStatus: vi.fn(() => ({ running: false, host: '127.0.0.1', port: 36806 })),
        } as any;

        (globalThis as any).window = {
            location: { origin: 'http://127.0.0.1:52208' },
            siyuan: {
                layout: {
                    rightDock: {
                        toggleModel: vi.fn(),
                        showDock: vi.fn(),
                        remove: vi.fn(),
                        data: {
                            [TIMELINE_REGISTERED_DOCK_TYPE]: {},
                        },
                    },
                    leftDock: {
                        toggleModel: vi.fn(),
                        showDock: vi.fn(),
                        remove: vi.fn(),
                        data: {
                            [SNAPSHOT_REGISTERED_DOCK_TYPE]: {},
                        },
                    },
                    bottomDock: {
                        toggleModel: vi.fn(),
                        showDock: vi.fn(),
                        remove: vi.fn(),
                        data: {},
                    },
                },
                config: {
                    api: { token: 'siyuan-token' },
                    system: { workspaceDir: '/mock/workspace' },
                    uiLayout: {
                        left: { data: [] },
                        right: { data: [] },
                        bottom: { data: [] },
                    },
                },
            },
        };

        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
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
            skillsExtensionEnabled: true,
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
            skillsExtensionEnabled: true,
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
            skillsExtensionEnabled: false,
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

    it('restarts a running HTTP server after instruction config changes', async () => {
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
            skillsExtensionEnabled: false,
        };

        const restarted = await plugin.refreshHttpServerAfterInstructionConfigChange();

        expect(restarted).toBe(true);
        expect(launcherStop).toHaveBeenCalledTimes(1);
        expect(launcherStart).toHaveBeenCalledWith(expect.objectContaining({
            host: '127.0.0.1',
            port: 36806,
            token: 'rules-token',
        }));
    });

    it('does not restart a stopped HTTP server after instruction config changes', async () => {
        const restarted = await plugin.refreshHttpServerAfterInstructionConfigChange();

        expect(restarted).toBe(false);
        expect(launcherStop).not.toHaveBeenCalled();
        expect(launcherStart).not.toHaveBeenCalled();
    });

    it('keeps the old user-rules refresh method as a compatibility alias', async () => {
        const getStatus = vi.fn(() => ({ running: true, host: '127.0.0.1', port: 36806 }));
        plugin.httpLauncher = {
            start: launcherStart,
            stop: launcherStop,
            getStatus,
        } as any;

        const restarted = await plugin.refreshHttpServerAfterUserRulesChange();

        expect(restarted).toBe(true);
        expect(launcherStop).toHaveBeenCalledTimes(1);
        expect(launcherStart).toHaveBeenCalledTimes(1);
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
            skillsExtensionEnabled: false,
        };

        await plugin.updateHttpServerSettings(next);

        expect(launcherStop).not.toHaveBeenCalled();
        expect(launcherStart).toHaveBeenCalledWith(expect.objectContaining({
            port: 39002,
            token: 'another-token',
        }));
    });

    it('passes the current workspace origin and token together, including non-default ports', async () => {
        (globalThis as any).window.siyuan.config.api = { token: 'workspace-token' };
        await plugin.startHttpServer();
        expect(launcherStart).toHaveBeenCalledWith(expect.objectContaining({
            siyuanApiUrl: 'http://127.0.0.1:52208', siyuanToken: 'workspace-token',
        }));
        (globalThis as any).window.location.origin = 'https://notes.example.test:8443';
        await plugin.startHttpServer();
        expect(launcherStart).toHaveBeenLastCalledWith(expect.objectContaining({ siyuanApiUrl: 'https://notes.example.test:8443' }));
    });

    it.each([
        ['https://127.0.0.1:56602', 'http://127.0.0.1:56602'],
        ['https://localhost:56602', 'http://localhost:56602'],
        ['https://[::1]:56602', 'http://[::1]:56602'],
        ['https://127.0.0.1', 'http://127.0.0.1:443'],
        ['https://127.0.0.1.example.test:8443', 'https://127.0.0.1.example.test:8443'],
    ])('connects to the exact desktop kernel port for %s', async (origin, expected) => {
        (globalThis as any).window.location.origin = origin;
        await plugin.startHttpServer();
        expect(launcherStart).toHaveBeenLastCalledWith(expect.objectContaining({ siyuanApiUrl: expected }));
    });

    it('refuses to send the workspace token to a guessed origin', async () => {
        (globalThis as any).window.location.origin = 'null';
        await expect(plugin.startHttpServer()).rejects.toThrow('current SiYuan workspace API origin');
        expect(launcherStart).not.toHaveBeenCalled();
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
            skillsExtensionEnabled: false,
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

    it('does not register a top bar button for plugin settings', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const addTopBar = vi.fn();
        const openSetting = vi.spyOn(plugin, 'openSetting').mockImplementation(() => undefined);
        Object.assign(plugin, {
            addTopBar,
            i18n: { mcpToolsSettingTitle: 'SiYuan Sisyphus 设置' },
        });

        await plugin.onload();

        expect(addTopBar).not.toHaveBeenCalled();
        expect(openSetting).not.toHaveBeenCalled();
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

    it.each([false, true])('starts HTTP with timeline disabled and missing dock buttons (stale registry: %s)', async (staleRegistry) => {
        const startSpy = vi.spyOn(HttpServerLauncher.prototype, 'start').mockResolvedValue(undefined);
        plugin.httpLauncher = null;
        loadData.mockImplementation(async (storageName: string) => (
            storageName === 'versionControlSettings' ? { enabled: false } : undefined
        ));
        const { leftDock, rightDock } = (globalThis as any).window.siyuan.layout;
        if (!staleRegistry) {
            leftDock.data = {};
            rightDock.data = {};
            (plugin as any).docks = {};
        }
        for (const dock of [leftDock, rightDock]) {
            // SiYuan reads the button's getAttribute without checking for null.
            dock.toggleModel.mockImplementation((type: string) => {
                document.querySelector(`.dock__item[data-type="${type}"]`)!.getAttribute('data-index');
            });
            // remove() also calls toggleModel internally.
            dock.remove.mockImplementation((type: string) => dock.toggleModel(type));
        }

        await expect(plugin.onload()).resolves.toBeUndefined();
        expect(() => plugin.onLayoutReady()).not.toThrow();
        expect(() => plugin.onLayoutReady()).not.toThrow();

        expect(plugin.httpLauncher).toBeInstanceOf(HttpServerLauncher);
        expect(startSpy).toHaveBeenCalledTimes(1);
        expect(addDock).not.toHaveBeenCalled();
        for (const dock of [leftDock, rightDock]) {
            expect(dock.toggleModel).not.toHaveBeenCalled();
            expect(dock.remove).not.toHaveBeenCalled();
            expect(dock.data).toEqual({});
        }
        expect((plugin as any).docks).toEqual({});
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

    it('mounts the puppy only once after settings load when layout becomes ready repeatedly', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;

        await plugin.onload();

        expect(puppyInstances).toHaveLength(0);

        plugin.onLayoutReady();
        plugin.onLayoutReady();

        expect(document.querySelectorAll('#sy-puppy-root')).toHaveLength(1);
        expect(puppyInstances).toHaveLength(1);
        expect((puppyInstances[0].args as any).props.visible).toBe(false);
    });

    it('does not mount the puppy before delayed settings finish loading', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        let resolveToolConfig: (value: unknown) => void = () => {};
        loadData.mockImplementation((storageName: string) => {
            if (storageName === 'mcpToolsConfig') {
                return new Promise((resolve) => {
                    resolveToolConfig = resolve;
                });
            }
            if (storageName === 'puppySettings') {
                return Promise.resolve({ visible: false });
            }
            return Promise.resolve(undefined);
        });

        const loading = plugin.onload();
        plugin.onLayoutReady();

        expect(puppyInstances).toHaveLength(0);
        expect(document.querySelector('#sy-puppy-root')).toBeNull();

        resolveToolConfig(undefined);
        await loading;

        expect(puppyInstances).toHaveLength(1);
        expect((puppyInstances[0].args as any).props.visible).toBe(false);
    });

    it('preserves an explicitly enabled persisted puppy setting', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        loadData.mockImplementation((storageName: string) => {
            if (storageName === 'puppySettings') {
                return Promise.resolve({ visible: true });
            }
            return Promise.resolve(undefined);
        });

        await plugin.onload();
        plugin.onLayoutReady();

        expect(puppyInstances).toHaveLength(1);
        expect((puppyInstances[0].args as any).props.visible).toBe(true);
    });

    it('does not mount the puppy when unloaded during delayed settings loading', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        let resolveToolConfig: (value: unknown) => void = () => {};
        loadData.mockImplementation((storageName: string) => {
            if (storageName === 'mcpToolsConfig') {
                return new Promise((resolve) => {
                    resolveToolConfig = resolve;
                });
            }
            return Promise.resolve(undefined);
        });

        const loading = plugin.onload();
        plugin.onLayoutReady();
        await plugin.onunload();
        resolveToolConfig(undefined);
        await loading;

        expect(puppyInstances).toHaveLength(0);
        expect(document.querySelector('#sy-puppy-root')).toBeNull();
    });

    it('defers timeline dock registration until persisted timeline settings are loaded', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const addCommand = vi.fn((command) => {
            (plugin as any).commands.push(command);
        });
        Object.assign(plugin, { addCommand });
        let resolveFirstLoad: (value: unknown) => void = () => {};
        let firstLoad = true;
        loadData.mockImplementation(() => {
            if (firstLoad) {
                firstLoad = false;
                return new Promise((resolve) => {
                    resolveFirstLoad = resolve;
                });
            }
            return Promise.resolve(undefined);
        });

        const loading = plugin.onload();

        expect(addIcons).toHaveBeenCalledTimes(1);
        expect(addIcons).toHaveBeenCalledWith(expect.stringContaining('<symbol id="iconSisyphusSnapshotDock"'));
        expect(addIcons).toHaveBeenCalledWith(expect.stringContaining('<symbol id="iconSisyphusTimelineDock"'));
        expect(addDock).not.toHaveBeenCalled();
        expect(addCommand).not.toHaveBeenCalled();
        expect(eventBusOn).not.toHaveBeenCalled();

        resolveFirstLoad(undefined);
        await loading;
        plugin.onLayoutReady();
        plugin.onLayoutReady();

        expect(addDock).toHaveBeenCalledTimes(2);
        expect(addDock.mock.calls[0][0].config).toEqual(expect.objectContaining({
            position: 'LeftTop',
            icon: SNAPSHOT_ICON_ID,
            size: { width: 320, height: 0 },
            show: true,
        }));
        expect(addDock.mock.calls[1][0].config).toEqual(expect.objectContaining({
            position: 'RightBottom',
            icon: TIMELINE_ICON_ID,
            size: { width: 720, height: 0 },
            show: false,
        }));
        expect(addCommand).toHaveBeenCalledTimes(1);
        expect(eventBusOn).toHaveBeenCalledTimes(4);
        expect(eventBusOn).toHaveBeenCalledWith("ws-main", expect.any(Function));
    });

    it('passes loaded timeline settings into the dock panel when it initializes', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        loadData.mockImplementation((storageName: string) => {
            if (storageName === 'versionControlSettings') {
                return Promise.resolve({ showDebugMeta: true });
            }
            return Promise.resolve(undefined);
        });

        await plugin.onload();
        addDock.mock.calls[0][0].init({ element: new FakeElement() });
        addDock.mock.calls[1][0].init({ element: new FakeElement() });

        expect(snapshotPanelInstances).toHaveLength(1);
        expect(diffPanelInstances).toHaveLength(1);
        expect((snapshotPanelInstances[0].args as any).props.showDebugMeta).toBe(true);
        expect((diffPanelInstances[0].args as any).props.showDebugMeta).toBe(true);
    });

    it('uses dock visibility defaults only when no saved manual state exists', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        (globalThis as any).window.siyuan.config.uiLayout.left.data = [[{
            type: SNAPSHOT_REGISTERED_DOCK_TYPE,
            show: false,
        }]];
        (globalThis as any).window.siyuan.config.uiLayout.right.data = [[{
            type: TIMELINE_REGISTERED_DOCK_TYPE,
            show: true,
        }]];

        await plugin.onload();

        expect(addDock.mock.calls[0][0].config.show).toBe(false);
        expect(addDock.mock.calls[1][0].config.show).toBe(true);
    });

    it('hydrates the initially open snapshot dock from the active editor', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const editorElement = document.createElement('div');
        document.body.appendChild(editorElement);
        getAllEditorMock.mockReturnValue([{
            protyle: {
                element: editorElement,
                block: { rootID: 'doc-active' },
                title: 'Active Doc',
            },
        }]);

        await plugin.onload();
        addDock.mock.calls[0][0].init({ element: new FakeElement() });

        expect((snapshotPanelInstances[0].args as any).props).toEqual(expect.objectContaining({
            currentDocumentId: 'doc-active',
            currentDocumentTitle: 'Active Doc',
        }));
    });

    it('re-registers the timeline dock when layout refresh drops its dock data', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;

        await plugin.onload();
        expect(addDock).toHaveBeenCalledTimes(2);

        const rightDock = (globalThis as any).window.siyuan.layout.rightDock;
        const leftDock = (globalThis as any).window.siyuan.layout.leftDock;
        rightDock.data = {};
        leftDock.data = {};
        (plugin as any).docks = {};
        (globalThis as any).window.siyuan.config.uiLayout.right.data = [];

        plugin.onLayoutReady();

        expect(addDock).toHaveBeenCalledTimes(4);
    });

    it('disables the timeline dock, command, events, and panel when persisted setting is off', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const addCommand = vi.fn((command) => {
            (plugin as any).commands.push(command);
        });
        Object.assign(plugin, { addCommand });
        loadData.mockImplementation((storageName: string) => {
            if (storageName === 'versionControlSettings') {
                return Promise.resolve({ enabled: false, showDebugMeta: true });
            }
            return Promise.resolve(undefined);
        });

        await plugin.onload();
        plugin.openVersionControl();

        const rightDock = (globalThis as any).window.siyuan.layout.rightDock;
        const leftDock = (globalThis as any).window.siyuan.layout.leftDock;
        expect(addDock).not.toHaveBeenCalled();
        expect(addCommand).not.toHaveBeenCalled();
        expect(eventBusOn).not.toHaveBeenCalled();
        expect(snapshotPanelInstances).toHaveLength(0);
        expect(diffPanelInstances).toHaveLength(0);
        expect(leftDock.remove).not.toHaveBeenCalled();
        expect(rightDock.remove).not.toHaveBeenCalled();
        expect(rightDock.toggleModel).not.toHaveBeenCalledWith(TIMELINE_REGISTERED_DOCK_TYPE, true, false, false, true);
        expect(showMessage).toHaveBeenCalledWith('文档时间树已关闭');
    });

    it('unregisters timeline runtime hooks when settings are turned off after enablement', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const addCommand = vi.fn((command) => {
            (plugin as any).commands.push(command);
        });
        Object.assign(plugin, { addCommand });

        await plugin.onload();
        addDock.mock.calls[0][0].init({ element: new FakeElement() });
        addDock.mock.calls[1][0].init({ element: new FakeElement() });

        expect(addCommand).toHaveBeenCalledTimes(1);
        expect((plugin as any).commands).toHaveLength(1);
        expect(eventBusOn).toHaveBeenCalledTimes(3);
        expect(snapshotPanelInstances).toHaveLength(1);
        expect(diffPanelInstances).toHaveLength(1);

        await plugin.updateVersionControlSettings({ enabled: false, showDebugMeta: true });

        const rightDock = (globalThis as any).window.siyuan.layout.rightDock;
        const leftDock = (globalThis as any).window.siyuan.layout.leftDock;
        expect((plugin as any).commands).toHaveLength(0);
        expect(eventBusOff).toHaveBeenCalledTimes(3);
        expect(snapshotPanelInstances[0].$destroy).toHaveBeenCalledTimes(1);
        expect(diffPanelInstances[0].$destroy).toHaveBeenCalledTimes(1);
        expect(leftDock.remove).not.toHaveBeenCalled();
        expect(rightDock.remove).not.toHaveBeenCalled();
        expect(leftDock.data).toEqual({});
        expect(rightDock.data).toEqual({});
    });

    it('does not stop a running HTTP server when timeline is disabled', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        plugin.httpLauncher = {
            start: launcherStart,
            stop: launcherStop,
            getStatus: vi.fn(() => ({ running: true, host: '127.0.0.1', port: 36806 })),
        } as any;

        await plugin.onload();
        await plugin.updateVersionControlSettings({ enabled: false, showDebugMeta: false });

        expect(launcherStop).not.toHaveBeenCalled();
        expect(launcherStart).not.toHaveBeenCalled();
        expect(plugin.httpLauncher?.getStatus().running).toBe(true);
    });

    it('removes the registered prefixed timeline sidebar button and layout entry when disabled at runtime', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const addCommand = vi.fn((command) => {
            (plugin as any).commands.push(command);
        });
        Object.assign(plugin, { addCommand });
        const sidebarButton = document.createElement('button');
        sidebarButton.className = 'dock__item';
        sidebarButton.setAttribute('data-type', TIMELINE_REGISTERED_DOCK_TYPE);
        document.body.appendChild(sidebarButton);
        (globalThis as any).window.siyuan.config.uiLayout.right.data = [[
            {
                type: TIMELINE_REGISTERED_DOCK_TYPE,
                icon: TIMELINE_ICON_ID,
                show: true,
                size: { width: 420, height: 0 },
            },
        ]];

        await plugin.onload();
        await plugin.updateVersionControlSettings({ enabled: false, showDebugMeta: false });

        const rightDock = (globalThis as any).window.siyuan.layout.rightDock;
        expect(rightDock.toggleModel).toHaveBeenCalledWith(TIMELINE_REGISTERED_DOCK_TYPE, false, true, true, true);
        expect(rightDock.remove).toHaveBeenCalledWith(TIMELINE_REGISTERED_DOCK_TYPE);
        expect(rightDock.toggleModel).toHaveBeenCalledTimes(1);
        expect(rightDock.remove).toHaveBeenCalledTimes(1);
        expect((plugin as any).docks[TIMELINE_REGISTERED_DOCK_TYPE]).toBeUndefined();
        expect(rightDock.data[TIMELINE_REGISTERED_DOCK_TYPE]).toBeUndefined();
        expect(document.querySelector(`[data-type="${TIMELINE_REGISTERED_DOCK_TYPE}"]`)).toBeNull();
        expect((globalThis as any).window.siyuan.config.uiLayout.right.data).toEqual([]);

        await plugin.updateVersionControlSettings({ enabled: false, showDebugMeta: false });
        expect(rightDock.toggleModel).toHaveBeenCalledTimes(1);
        expect(rightDock.remove).toHaveBeenCalledTimes(1);

        await plugin.updateVersionControlSettings({ enabled: true, showDebugMeta: false });
        expect(addDock).toHaveBeenCalledTimes(4);
    });

    it('cleans up an unmounted dock button without calling remove on a missing model', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const button = document.createElement('button');
        button.className = 'dock__item';
        button.setAttribute('data-type', TIMELINE_REGISTERED_DOCK_TYPE);
        document.body.appendChild(button);
        const rightDock = (globalThis as any).window.siyuan.layout.rightDock;
        rightDock.data = {};
        rightDock.remove.mockImplementation(() => {
            throw new TypeError('Cannot read properties of undefined (reading parent)');
        });

        await plugin.onload();
        await plugin.updateVersionControlSettings({ enabled: false, showDebugMeta: false });

        expect(rightDock.toggleModel).toHaveBeenCalledTimes(1);
        expect(rightDock.toggleModel).toHaveBeenCalledWith(TIMELINE_REGISTERED_DOCK_TYPE, false, true, true, true);
        expect(rightDock.remove).not.toHaveBeenCalled();
        expect(button.isConnected).toBe(false);
    });

    it('removes timeline sidebar buttons identified only by the timeline icon', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const iconOnlyButton = document.createElement('button');
        iconOnlyButton.className = 'dock__item';
        iconOnlyButton.setAttribute('data-icon', TIMELINE_ICON_ID);
        document.body.appendChild(iconOnlyButton);

        await plugin.onload();
        await plugin.updateVersionControlSettings({ enabled: false, showDebugMeta: false });

        expect(document.querySelector(`[data-icon="${TIMELINE_ICON_ID}"]`)).toBeNull();
    });

    it('opens the snapshot dock through toggleModel when available', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;

        await plugin.onload();
        plugin.openVersionControl();

        const leftDock = (globalThis as any).window.siyuan.layout.leftDock;
        expect(leftDock.toggleModel).toHaveBeenCalledWith(SNAPSHOT_REGISTERED_DOCK_TYPE, true, false, false, true);
        expect(leftDock.showDock).not.toHaveBeenCalled();
    });

    it('falls back to showDock when toggleModel is unavailable', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        const leftDock = (globalThis as any).window.siyuan.layout.leftDock;
        leftDock.toggleModel = undefined;

        await plugin.onload();
        plugin.openVersionControl();

        expect(leftDock.showDock).toHaveBeenCalledTimes(1);
    });

    it('stores a snapshot selection before opening and mounting the diff dock', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        await plugin.onload();
        const snapshotDock = addDock.mock.calls.find(([options]) => options.type === SNAPSHOT_DOCK_TYPE)?.[0];
        const diffDock = addDock.mock.calls.find(([options]) => options.type === TIMELINE_DOCK_TYPE)?.[0];
        snapshotDock.init({ element: new FakeElement() });
        (plugin as any).currentDocument = { id: 'doc-1', title: 'Doc 1' };
        (plugin as any).updateVersionControlDocument({ id: 'doc-1', title: 'Doc 1' }, { force: true });
        const selection = {
            documentId: 'doc-1',
            documentTitle: 'Doc 1',
            node: {
                name: 'node-a',
                created: 1,
                snapshotId: 'snapshot-a',
                tag: 'sisyphustimeline_doc-1_node-a',
                scope: 'document',
            },
        };

        (snapshotPanelInstances[0].args as any).props.onSelectNode(selection);

        const rightDock = (globalThis as any).window.siyuan.layout.rightDock;
        expect(rightDock.toggleModel).toHaveBeenCalledWith(TIMELINE_REGISTERED_DOCK_TYPE, true, false, false, true);
        expect(diffPanelInstances).toHaveLength(0);

        diffDock.init({ element: new FakeElement() });
        expect((diffPanelInstances[0].args as any).props.selection).toEqual(selection);
    });

    it('clears the selected diff when the active document changes', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        await plugin.onload();
        addDock.mock.calls[0][0].init({ element: new FakeElement() });
        addDock.mock.calls[1][0].init({ element: new FakeElement() });
        (plugin as any).currentDocument = { id: 'doc-1', title: 'Doc 1' };
        (plugin as any).timelineSelection = {
            documentId: 'doc-1',
            documentTitle: 'Doc 1',
            node: { name: 'A', created: 1, snapshotId: 'snapshot-a', scope: 'document' },
        };

        (plugin as any).updateVersionControlDocument({ id: 'doc-2', title: 'Doc 2' });

        expect(diffPanelInstances[0].$set).toHaveBeenLastCalledWith(expect.objectContaining({
            currentDocumentId: 'doc-2',
            selection: null,
        }));
        expect(snapshotPanelInstances[0].$set).toHaveBeenLastCalledWith(expect.objectContaining({
            currentDocumentId: 'doc-2',
            selectedNodeKey: '',
        }));
    });

    it('self-heals orphan puppy roots before remounting', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        await plugin.onload();
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
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        await plugin.onload();
        plugin.onLayoutReady();
        const mountedPuppy = puppyInstances[0];

        await plugin.onunload();

        expect(mountedPuppy.$destroy).toHaveBeenCalledTimes(1);
        expect(document.querySelector('#sy-puppy-root')).toBeNull();
    });

    it('pushes updated settings into the mounted puppy component', async () => {
        delete (globalThis as any).window.siyuan.config.system.workspaceDir;
        await plugin.onload();
        plugin.onLayoutReady();
        const mountedPuppy = puppyInstances[0];

        plugin.updatePuppyTestSettings({
            visible: false,
            testModeEnabled: true,
            testModeIntervalMs: 1500,
            showBubble: true,
            showClickHint: false,
            appearance: {
                bodyColor: '#ff7aa8',
                pawColor: '#d94878',
                eyeColor: '#26211a',
            },
        });

        expect(mountedPuppy.$set).toHaveBeenCalledWith({
            visible: false,
            testModeEnabled: true,
            testModeIntervalMs: 1500,
            showBubble: true,
            showClickHint: false,
            appearance: {
                bodyColor: '#ff7aa8',
                pawColor: '#d94878',
                eyeColor: '#26211a',
            },
        });
    });
});
