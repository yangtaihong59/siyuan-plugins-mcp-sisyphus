import { getWorkspaceApiUrl } from './shared/workspace-api-url';
import {
    Plugin,
    showMessage,
    Dialog,
    getAllEditor,
} from "siyuan";
import "./index.scss";

import {
    buildDefaultHttpServerSettings,
    buildDefaultPermissionDisplaySettings,
    buildDefaultPuppySettings,
    buildDefaultVersionControlSettings,
    hasValidHttpTlsFiles,
    loadPersistedHttpServerSettings,
    loadPersistedPermissionDisplaySettings,
    normalizePermissionDisplaySettings,
    loadPersistedPuppySettings,
    loadPersistedToolConfigState,
    loadPersistedVersionControlSettings,
    savePersistedHttpServerSettings,
    savePersistedToolConfig,
    savePersistedVersionControlSettings,
    type HttpServerSettings,
    type PermissionDisplaySettings,
    type PuppySettings,
    type VersionControlSettings,
} from "@/ui/setting/tool-config-storage";
import {
    clearPermissionTreeIndicators,
    decoratePermissionTree,
    getNextNotebookPermission,
    normalizeNotebookPermissions,
    PERMISSION_TREE_BADGE_CLASS,
    PERMISSION_TREE_CHANGED_EVENT,
    PERMISSION_TREE_ROOT_SELECTOR,
    type NotebookPermission,
    type PermissionTreeLabels,
} from "@/ui/permission-tree-indicator";
import { emitToolConfigWarningOnce } from "@/core/config";
import { submitFeedback, type FeedbackInput, type FeedbackSubmitResult } from "@/core/feedback";
import McpConfig from "@/ui/setting/mcp-config.svelte";
import ToolPuppy from "@/ui/components/ToolPuppy.svelte";
import SnapshotPanel from "@/ui/version-control/SnapshotPanel.svelte";
import VersionDiffPanel from "@/ui/version-control/VersionDiffPanel.svelte";
import {
    getTimelineNodeSelectionKey,
    type TimelineNodeSelection,
} from "@/ui/version-control/timeline";

import { HttpServerLauncher, appendHttpLifecycleLog } from "@/server-launcher";

const PUPPY_ROOT_ID = "sy-puppy-root";
const SNAPSHOT_DOCK_TYPE = "sisyphusSnapshotDock";
const SNAPSHOT_DOCK_POSITION = "LeftTop";
const SNAPSHOT_DOCK_ROOT_ID = "SisyphusSnapshotDockPanel";
const SNAPSHOT_ICON_ID = "iconSisyphusSnapshotDock";
const VERSION_CONTROL_DOCK_TYPE = "sisyphusTimelineDock";
const VERSION_CONTROL_DOCK_POSITION = "RightBottom";
const VERSION_CONTROL_DOCK_ROOT_ID = "SisyphusTimelineDockPanel";
const VERSION_CONTROL_ICON_ID = "iconSisyphusTimelineDock";
const VERSION_CONTROL_ICON_SYMBOLS = [
    `<symbol id="${SNAPSHOT_ICON_ID}" viewBox="0 0 24 24"><path fill="currentColor" d="M7 3a3 3 0 0 1 2 5.24v1.27l6 3V8.24A3 3 0 1 1 17 9v5a1 1 0 0 1-1.45.89L9 11.62v4.14A3 3 0 1 1 7 15.76V8.24A3 3 0 0 1 7 3Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm10 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM7 17a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></symbol>`,
    `<symbol id="${VERSION_CONTROL_ICON_ID}" viewBox="0 0 24 24"><path fill="currentColor" d="M4 5h6v14H4V5Zm10 0h6v14h-6V5ZM6 8v2h2V8H6Zm10 0v2h2V8h-2ZM6 13v2h2v-2H6Zm10 0v2h2v-2h-2Z"/></symbol>`,
].join("");

type CurrentDocumentContext = {
    id: string;
    title: string;
};

export default class SiyuanMCP extends Plugin {
    private puppyComponent: ToolPuppy | null = null;
    private snapshotPanel: SnapshotPanel | null = null;
    private diffPanel: VersionDiffPanel | null = null;
    private snapshotContainer: HTMLElement | null = null;
    private diffContainer: HTMLElement | null = null;
    private currentDocument: CurrentDocumentContext = { id: "", title: "" };
    private timelineSelection: TimelineNodeSelection | null = null;
    private puppyContainer: HTMLElement | null = null;
    private puppySettings: PuppySettings = buildDefaultPuppySettings();
    private puppySettingsLoaded = false;
    private layoutReady = false;
    private versionControlSettings: VersionControlSettings = buildDefaultVersionControlSettings();
    private snapshotDockRegistered = false;
    private diffDockRegistered = false;
    private versionControlCommandRegistered = false;
    private versionControlEventsRegistered = false;
    private versionControlIconRegistered = false;
    private versionControlSettingsLoaded = false;
    private snapshotDockElement: HTMLElement | null = null;
    private diffDockElement: HTMLElement | null = null;
    private snapshotDockRegistration: { config?: any; model?: any } | null = null;
    private diffDockRegistration: { config?: any; model?: any } | null = null;
    private snapshotDockRegisteredType = "";
    private diffDockRegisteredType = "";
    private permissionDisplaySettings: PermissionDisplaySettings = buildDefaultPermissionDisplaySettings();
    private permissionDisplaySettingsLoaded = false;
    private permissionTreePermissions: Record<string, NotebookPermission> = {};
    private permissionTreeObserver: MutationObserver | null = null;
    private permissionTreeEventsRegistered = false;
    private permissionTreeClickRegistered = false;
    private permissionTreeFrame: number | null = null;
    private permissionTreeLoadVersion = 0;
    public httpSettings: HttpServerSettings = buildDefaultHttpServerSettings();
    public httpLauncher: HttpServerLauncher | null = null;

    async onload() {
        appendHttpLifecycleLog("[plugin] onload begin");
        this.registerVersionControlIcon();

        const { config: normalized, warning } = await loadPersistedToolConfigState(this);
        if (warning) {
            emitToolConfigWarningOnce(warning, (message) => {
                console.warn(message);
                showMessage(message);
            });
        }
        await savePersistedToolConfig(normalized, this);
        this.puppySettings = await loadPersistedPuppySettings(this);
        this.puppySettingsLoaded = true;
        if (this.layoutReady) {
            this.mountPuppy();
        }
        this.httpSettings = await loadPersistedHttpServerSettings(this);
        this.versionControlSettings = await loadPersistedVersionControlSettings(this);
        this.versionControlSettingsLoaded = true;
        this.permissionDisplaySettings = await loadPersistedPermissionDisplaySettings(this);
        this.permissionDisplaySettingsLoaded = true;
        appendHttpLifecycleLog(`[plugin] settings loaded: httpEnabled=${this.httpSettings.enabled} timelineEnabled=${this.versionControlSettings.enabled}`);
        this.syncVersionControlFeature();
        this.syncPermissionTreeFeature();

        const support = HttpServerLauncher.getSupportInfo();
        if (!support.supported) {
            appendHttpLifecycleLog(`[plugin] HTTP launcher unsupported: ${support.reason ?? "unknown"}`);
            return;
        }

        const scriptPath = HttpServerLauncher.resolveServerScriptPath(this.name);
        if (!scriptPath) {
            appendHttpLifecycleLog("[plugin] HTTP launcher unsupported: server script path unavailable");
            return;
        }

        try {
            this.httpLauncher = new HttpServerLauncher(scriptPath);
            appendHttpLifecycleLog(`[plugin] HTTP launcher initialized: ${scriptPath}`);
            if (this.httpSettings.enabled) {
                try {
                    await this.startHttpServer();
                } catch (err) {
                    appendHttpLifecycleLog(`[plugin] auto-start HTTP server failed: ${err instanceof Error ? err.message : String(err)}`);
                    console.error("[MCP] auto-start HTTP server failed:", err);
                }
            }
        } catch (err) {
            appendHttpLifecycleLog(`[plugin] failed to init HTTP launcher: ${err instanceof Error ? err.message : String(err)}`);
            console.error("[MCP] failed to init HttpServerLauncher:", err);
        }
    }

    async startHttpServer(): Promise<void> {
        if (!this.httpLauncher) {
            appendHttpLifecycleLog("[plugin] start HTTP skipped: launcher unavailable");
            return;
        }
        if (!hasValidHttpTlsFiles(this.httpSettings)) {
            appendHttpLifecycleLog("[plugin] start HTTP rejected: missing TLS certificate or key");
            throw new Error("HTTPS requires both certificate and key file paths.");
        }
        appendHttpLifecycleLog(`[plugin] start HTTP requested: ${this.httpSettings.host}:${this.httpSettings.port}`);
        const siyuanToken = (window as any)?.siyuan?.config?.api?.token ?? undefined;
        const siyuanApiUrl = getWorkspaceApiUrl(window.location?.origin);
        await this.httpLauncher.start({
            host: this.httpSettings.host,
            port: this.httpSettings.port,
            token: this.httpSettings.authEnabled ? this.httpSettings.token : undefined,
            siyuanApiUrl,
            siyuanToken,
            tlsCertFile: this.httpSettings.tlsEnabled && this.httpSettings.tlsCertFile ? this.httpSettings.tlsCertFile : undefined,
            tlsKeyFile: this.httpSettings.tlsEnabled && this.httpSettings.tlsKeyFile ? this.httpSettings.tlsKeyFile : undefined,
            tlsCaFile: this.httpSettings.tlsEnabled && this.httpSettings.tlsCaFile ? this.httpSettings.tlsCaFile : undefined,
            skillsExtensionEnabled: this.httpSettings.skillsExtensionEnabled,
        });
    }

    async stopHttpServer(): Promise<void> {
        appendHttpLifecycleLog("[plugin] stop HTTP requested");
        await this.httpLauncher?.stop();
    }

    getHttpServerSupportInfo() {
        return HttpServerLauncher.getSupportInfo();
    }

    async setHttpServerSettings(next: HttpServerSettings): Promise<HttpServerSettings> {
        this.httpSettings = await savePersistedHttpServerSettings(next, this);
        return this.httpSettings;
    }

    async updateHttpServerSettings(next: HttpServerSettings): Promise<HttpServerSettings> {
        const wasRunning = this.httpLauncher?.getStatus().running ?? false;
        appendHttpLifecycleLog(`[plugin] update HTTP settings: wasRunning=${wasRunning} nextEnabled=${next.enabled} host=${next.host} port=${next.port}`);
        if ((wasRunning || next.enabled) && !hasValidHttpTlsFiles(next)) {
            throw new Error("HTTPS requires both certificate and key file paths.");
        }
        if (wasRunning) {
            try { await this.stopHttpServer(); } catch (err) { console.error("[MCP] stop before update failed:", err); }
        }
        await this.setHttpServerSettings(next);
        if (wasRunning || next.enabled) {
            try {
                await this.startHttpServer();
            } catch (err) {
                appendHttpLifecycleLog(`[plugin] restart after settings change failed: ${err instanceof Error ? err.message : String(err)}`);
                console.error("[MCP] restart after settings change failed:", err);
            }
        }
        return this.httpSettings;
    }

    async refreshHttpServerAfterInstructionConfigChange(): Promise<boolean> {
        const wasRunning = this.httpLauncher?.getStatus().running ?? false;
        appendHttpLifecycleLog(`[plugin] refresh HTTP after instruction config change: wasRunning=${wasRunning}`);
        if (!wasRunning) {
            return false;
        }
        if (!hasValidHttpTlsFiles(this.httpSettings)) {
            throw new Error("HTTPS requires both certificate and key file paths.");
        }
        try {
            await this.stopHttpServer();
        } catch (err) {
            console.error("[MCP] stop before user rules refresh failed:", err);
        }
        await this.startHttpServer();
        return true;
    }

    async refreshHttpServerAfterUserRulesChange(): Promise<boolean> {
        return this.refreshHttpServerAfterInstructionConfigChange();
    }

    private mountPuppy() {
        const existingRoots = Array.from(document.querySelectorAll<HTMLElement>(`#${PUPPY_ROOT_ID}`));
        const isMounted =
            Boolean(this.puppyComponent) &&
            this.puppyContainer instanceof HTMLElement &&
            this.puppyContainer.id === PUPPY_ROOT_ID &&
            this.puppyContainer.isConnected;
        const hasForeignOrDuplicateRoot = existingRoots.some((root) => root !== this.puppyContainer);

        if (isMounted && !hasForeignOrDuplicateRoot) {
            return;
        }

        this.unmountPuppy();
        for (const root of existingRoots) {
            root.remove();
        }

        this.puppyContainer = document.createElement("div");
        this.puppyContainer.id = PUPPY_ROOT_ID;
        document.body.appendChild(this.puppyContainer);
        this.puppyComponent = new ToolPuppy({
            target: this.puppyContainer,
            props: {
                visible: this.puppySettings.visible,
                testModeEnabled: this.puppySettings.testModeEnabled,
                testModeIntervalMs: this.puppySettings.testModeIntervalMs,
                showBubble: this.puppySettings.showBubble,
                showClickHint: this.puppySettings.showClickHint,
                appearance: this.puppySettings.appearance,
            },
        });
    }

    private unmountPuppy() {
        this.puppyComponent?.$destroy();
        this.puppyComponent = null;

        if (this.puppyContainer) {
            this.puppyContainer.remove();
            this.puppyContainer = null;
        }

        const orphanRoots = document.querySelectorAll<HTMLElement>(`#${PUPPY_ROOT_ID}`);
        for (const root of orphanRoots) {
            root.remove();
        }
    }

    onLayoutReady() {
        this.layoutReady = true;
        if (this.puppySettingsLoaded) {
            this.mountPuppy();
        }
        if (this.versionControlSettingsLoaded) this.syncVersionControlFeature();
        if (this.permissionDisplaySettingsLoaded) this.syncPermissionTreeFeature();
    }


    updatePuppyTestSettings(settings: PuppySettings) {
        this.puppySettings = settings;
        if (this.puppyComponent) {
            this.puppyComponent.$set({
                visible: settings.visible,
                testModeEnabled: settings.testModeEnabled,
                testModeIntervalMs: settings.testModeIntervalMs,
                showBubble: settings.showBubble,
                showClickHint: settings.showClickHint,
                appearance: settings.appearance,
            });
        }
    }

    async updateVersionControlSettings(settings: VersionControlSettings): Promise<void> {
        this.versionControlSettings = await savePersistedVersionControlSettings(settings, this);
        appendHttpLifecycleLog(`[timeline] settings updated: enabled=${this.versionControlSettings.enabled} showDebugMeta=${this.versionControlSettings.showDebugMeta}`);
        this.syncVersionControlFeature();
    }

    updatePermissionDisplaySettings(settings: PermissionDisplaySettings): void {
        this.permissionDisplaySettings = normalizePermissionDisplaySettings(settings);
        this.syncPermissionTreeFeature();
    }

    refreshPermissionTreeIndicators(permissions?: unknown): void {
        if (permissions !== undefined) {
            this.permissionTreePermissions = normalizeNotebookPermissions(permissions);
            this.emitPermissionTreeChange();
        }
        if (!this.permissionDisplaySettings.showInFileTree || !this.layoutReady) return;
        this.schedulePermissionTreeDecoration();
    }

    async submitFeedback(input: FeedbackInput): Promise<FeedbackSubmitResult> {
        return submitFeedback(input, this.createFeedbackFetch());
    }

    private createFeedbackFetch(): typeof fetch {
        const req = this.getNodeRequire();
        if (req) {
            try {
                const https = req("https") as typeof import("https");
                const http = req("http") as typeof import("http");
                return ((url: string, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
                    const target = new URL(url);
                    const transport = target.protocol === "http:" ? http : https;
                    const headers = init.headers instanceof Headers
                        ? Object.fromEntries(init.headers.entries())
                        : (init.headers ?? {}) as Record<string, string>;
                    const rawBody = init.body
                        ? (typeof init.body === "string" || Buffer.isBuffer(init.body) ? init.body : String(init.body))
                        : undefined;
                    const request = transport.request(target, {
                        method: init.method ?? "GET",
                        headers: {
                            ...headers,
                            ...(rawBody && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")
                                ? { "Content-Length": Buffer.byteLength(rawBody) }
                                : {}),
                        },
                    }, (response) => {
                        const chunks: Buffer[] = [];
                        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                        response.on("end", () => {
                            const responseHeaders = new Headers();
                            for (const [key, value] of Object.entries(response.headers)) {
                                if (Array.isArray(value)) {
                                    for (const item of value) responseHeaders.append(key, item);
                                } else if (typeof value === "string") {
                                    responseHeaders.set(key, value);
                                }
                            }
                            resolve(new Response(Buffer.concat(chunks), {
                                status: response.statusCode ?? 0,
                                statusText: response.statusMessage ?? "",
                                headers: responseHeaders,
                            }));
                        });
                    });
                    request.on("error", reject);
                    if (rawBody) {
                        request.write(rawBody);
                    }
                    request.end();
                })) as typeof fetch;
            } catch {
                // Fall through to global fetch below.
            }
        }
        if (typeof fetch === "function") {
            return fetch.bind(globalThis);
        }
        throw new Error("Feedback submission is unavailable in this environment.");
    }

    private getNodeRequire(): NodeRequire | undefined {
        if (typeof require === "function") {
            try {
                require("https");
                return require;
            } catch { /* not Node require */ }
        }
        if (typeof window !== "undefined") {
            const w = window as unknown as { require?: NodeRequire };
            if (typeof w.require === "function") return w.require;
        }
        return undefined;
    }

    onDataChanged(): void {
        // SiYuan 3.8.3 reloads plugins that inherit the default data-change hook.
        // MCP calls persist stats, events and the write ledger under petal storage;
        // reloading here kills the HTTP worker (and its active write leases).
        // Runtime data is read through the API/pollers; settings UI changes use
        // their explicit update methods. Storage notifications must not restart us.
    }

    async onunload() {
        appendHttpLifecycleLog("[plugin] onunload begin");
        this.layoutReady = false;
        this.puppySettingsLoaded = false;
        this.permissionDisplaySettingsLoaded = false;
        this.disablePermissionTreeFeature();
        this.unregisterVersionControlEvents();
        this.unmountVersionControlDocks();
        this.unmountPuppy();
        if (this.httpLauncher) {
            try {
                await this.stopHttpServer();
            } catch (err) {
                appendHttpLifecycleLog(`[plugin] stop HTTP during unload failed: ${err instanceof Error ? err.message : String(err)}`);
                console.error("[MCP] stop HTTP server during unload failed:", err);
            }
        }
        appendHttpLifecycleLog("[plugin] onunload end");
    }

    uninstall() {
        this.removeData("mcpToolsConfig").catch(e => {
            showMessage(`uninstall [${this.name}] remove data [mcpToolsConfig] fail: ${e.msg}`);
        });
    }

    /**
     * A custom setting pannel provided by svelte
     */
    openSetting(): void {
        const isMobileEnv = typeof window !== "undefined" && (
            (window as any)?.siyuan?.config?.system?.os === "android" ||
            (window as any)?.siyuan?.config?.system?.os === "ios" ||
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        );

        if (isMobileEnv && document.getElementById("model")) {
            const modelElement = document.getElementById("model");
            modelElement.style.transform = "translateY(0px)";
            modelElement.style.zIndex = (++(window as any).siyuan.zIndex).toString();
            const iconElement = modelElement.querySelector(".toolbar__icon");
            if (iconElement) {
                iconElement.classList.add("fn__none");
            }
            const titleElement = modelElement.querySelector(".toolbar__text") as HTMLElement;
            if (titleElement) {
                titleElement.textContent = this.i18n.mcpToolsSettingTitle;
                titleElement.style.display = "block";
                titleElement.style.overflow = "visible";
                titleElement.style.width = "100%";
                titleElement.style.textAlign = "center";
                titleElement.style.color = "var(--b3-theme-on-background)";
            }
            const modelMainElement = modelElement.querySelector("#modelMain") as HTMLElement;
            modelMainElement.innerHTML = `<div id="SettingPanel" style="height: 100%;"></div>`;

            let pannel = new McpConfig({
                target: modelMainElement.querySelector("#SettingPanel"),
                props: { plugin: this }
            });

            const closeBtn = document.getElementById("modelClose");
            const onClose = () => {
                pannel.$destroy();
                modelMainElement.innerHTML = "";
                if (closeBtn) {
                    closeBtn.removeEventListener("click", onClose);
                }
            };
            if (closeBtn) {
                closeBtn.addEventListener("click", onClose);
            }

            // Also observe #modelMain in case other code clears it before close button is clicked
            const observer = new MutationObserver(() => {
                if (!modelMainElement.querySelector("#SettingPanel")) {
                    pannel.$destroy();
                    observer.disconnect();
                    if (closeBtn) {
                        closeBtn.removeEventListener("click", onClose);
                    }
                }
            });
            observer.observe(modelMainElement, { childList: true });
            return;
        }

        let dialog = new Dialog({
            title: this.i18n.mcpToolsSettingTitle,
            content: `<div id="SettingPanel" style="height: 100%;"></div>`,
            width: "min(1120px, calc(100vw - 56px))",
            height: "min(680px, calc(100vh - 72px))",
            destroyCallback: () => {
                //You'd better destroy the component when the dialog is closed
                pannel.$destroy();
            }
        });
        dialog.element.classList.add("sisyphus-settings-dialog");
        let pannel = new McpConfig({
            target: dialog.element.querySelector("#SettingPanel"),
            props: {
                plugin: this
            }
        });
    }

    openVersionControl(protyle?: unknown): void {
        if (!this.versionControlSettings.enabled) {
            showMessage(this.i18n?.timeline_disabled_msg || "文档时间树已关闭");
            return;
        }
        this.syncVersionControlFeature();
        const context = this.getDocumentContextFromProtyle(protyle) ?? this.currentDocument;
        this.updateVersionControlDocument(context, { force: true });
        this.showSnapshotDock();
    }

    private syncVersionControlFeature() {
        appendHttpLifecycleLog(`[timeline] sync feature: enabled=${this.versionControlSettings.enabled}`);
        if (!this.versionControlSettings.enabled) {
            this.disableVersionControlFeature();
            return;
        }
        this.enableVersionControlFeature();
    }

    private syncPermissionTreeFeature() {
        if (!this.permissionDisplaySettingsLoaded || !this.layoutReady) return;
        if (!this.permissionDisplaySettings.showInFileTree) {
            this.disablePermissionTreeFeature();
            return;
        }
        this.enablePermissionTreeFeature();
    }

    private enablePermissionTreeFeature() {
        this.registerPermissionTreeEvents();
        this.registerPermissionTreeClick();
        this.registerPermissionTreeObserver();
        void this.loadPermissionTreePermissions();
    }

    private disablePermissionTreeFeature() {
        this.permissionTreeLoadVersion += 1;
        this.unregisterPermissionTreeEvents();
        this.unregisterPermissionTreeClick();
        this.permissionTreeObserver?.disconnect();
        this.permissionTreeObserver = null;
        if (
            this.permissionTreeFrame !== null &&
            typeof window !== "undefined" &&
            typeof window.cancelAnimationFrame === "function"
        ) {
            window.cancelAnimationFrame(this.permissionTreeFrame);
        }
        this.permissionTreeFrame = null;
        if (typeof document !== "undefined") {
            clearPermissionTreeIndicators(document);
        }
    }

    private registerPermissionTreeEvents() {
        if (this.permissionTreeEventsRegistered) return;
        const eventBus = (this as any).eventBus;
        if (typeof eventBus?.on !== "function") return;
        eventBus.on("ws-main", this.handlePermissionTreeWebSocket as any);
        this.permissionTreeEventsRegistered = true;
    }

    private unregisterPermissionTreeEvents() {
        if (!this.permissionTreeEventsRegistered) return;
        const eventBus = (this as any).eventBus;
        eventBus?.off?.("ws-main", this.handlePermissionTreeWebSocket as any);
        this.permissionTreeEventsRegistered = false;
    }

    private registerPermissionTreeClick() {
        if (this.permissionTreeClickRegistered || typeof document.addEventListener !== "function") return;
        document.addEventListener("click", this.handlePermissionTreeBadgeClick, true);
        this.permissionTreeClickRegistered = true;
    }

    private unregisterPermissionTreeClick() {
        if (!this.permissionTreeClickRegistered || typeof document.removeEventListener !== "function") return;
        document.removeEventListener("click", this.handlePermissionTreeBadgeClick, true);
        this.permissionTreeClickRegistered = false;
    }

    private registerPermissionTreeObserver() {
        if (this.permissionTreeObserver || typeof MutationObserver === "undefined" || !document.body) return;
        this.permissionTreeObserver = new MutationObserver((mutations) => {
            const touchesPermissionTree = mutations.some((mutation) => (
                Array.from(mutation.addedNodes).some((node) => {
                    if (!(node instanceof Element)) return false;
                    return Boolean(
                        node.matches(".file-tree, .sy__file, ul[data-url], li[data-type=\"navigation-root\"]") ||
                        node.closest("li[data-type=\"navigation-root\"]") ||
                        node.querySelector(PERMISSION_TREE_ROOT_SELECTOR)
                    );
                })
            ));
            if (touchesPermissionTree) {
                this.schedulePermissionTreeDecoration();
            }
        });
        this.permissionTreeObserver.observe(document.body, { childList: true, subtree: true });
    }

    private async loadPermissionTreePermissions() {
        const loadVersion = ++this.permissionTreeLoadVersion;
        const raw = await this.loadData("notebookPermissions");
        if (
            loadVersion !== this.permissionTreeLoadVersion ||
            !this.layoutReady ||
            !this.permissionDisplaySettings.showInFileTree
        ) return;
        this.permissionTreePermissions = normalizeNotebookPermissions(raw);
        this.emitPermissionTreeChange();
        this.schedulePermissionTreeDecoration();
    }

    private schedulePermissionTreeDecoration() {
        if (this.permissionTreeFrame !== null || typeof window === "undefined") return;
        if (typeof window.requestAnimationFrame !== "function") {
            decoratePermissionTree(document, this.permissionTreePermissions, this.getPermissionTreeLabels());
            return;
        }
        this.permissionTreeFrame = window.requestAnimationFrame(() => {
            this.permissionTreeFrame = null;
            if (!this.layoutReady || !this.permissionDisplaySettings.showInFileTree) return;
            decoratePermissionTree(document, this.permissionTreePermissions, this.getPermissionTreeLabels());
        });
    }

    private getPermissionTreeLabels(): PermissionTreeLabels {
        return {
            names: {
                none: this.i18n?.mcpPermNone || "无权限",
                r: this.i18n?.mcpPermRead || "只读",
                rw: this.i18n?.mcpPermReadWrite || "读写不可删除",
                rwd: this.i18n?.mcpPermReadWriteDelete || "读写可删除",
            },
            defaultSuffix: this.i18n?.permission_tree_default_suffix || "（默认）",
            pluginName: this.i18n?.permission_tree_plugin_name || "插件：思源 sisyphus MCP & CLI & GIT",
            notebookScope: this.i18n?.permission_tree_scope || "应用于整个笔记本及其子文档",
            clickToChange: this.i18n?.permission_tree_click_hint || "点击切换权限",
        };
    }

    private emitPermissionTreeChange() {
        if (
            typeof window === "undefined" ||
            typeof window.dispatchEvent !== "function" ||
            typeof CustomEvent === "undefined"
        ) return;
        window.dispatchEvent(new CustomEvent(PERMISSION_TREE_CHANGED_EVENT, {
            detail: { permissions: { ...this.permissionTreePermissions } },
        }));
    }

    private readonly handlePermissionTreeBadgeClick = async (event: MouseEvent) => {
        const target = event.target instanceof Element
            ? event.target.closest<HTMLElement>(`.${PERMISSION_TREE_BADGE_CLASS}`)
            : null;
        if (!target) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (target.dataset.saving === "true") return;

        const notebookId = target.dataset.notebookId?.trim() ?? "";
        if (!notebookId) return;

        const previousPermissions = { ...this.permissionTreePermissions };
        const currentPermission = this.permissionTreePermissions[notebookId] ?? "r";
        this.permissionTreePermissions = {
            ...this.permissionTreePermissions,
            [notebookId]: getNextNotebookPermission(currentPermission),
        };
        target.dataset.saving = "true";
        target.setAttribute("aria-busy", "true");
        decoratePermissionTree(document, this.permissionTreePermissions, this.getPermissionTreeLabels());

        try {
            await this.saveData("notebookPermissions", this.permissionTreePermissions);
            this.emitPermissionTreeChange();
        } catch (error) {
            this.permissionTreePermissions = previousPermissions;
            decoratePermissionTree(document, this.permissionTreePermissions, this.getPermissionTreeLabels());
            console.error("[MCP] failed to update notebook permission from file tree:", error);
            showMessage(this.i18n?.permission_tree_save_failed || "权限保存失败，已恢复原状态");
        } finally {
            delete target.dataset.saving;
            target.removeAttribute("aria-busy");
        }
    };

    private readonly handlePermissionTreeWebSocket = (event: CustomEvent<{ cmd?: string }>) => {
        if (event?.detail?.cmd === "reloadFiletree") {
            void this.loadPermissionTreePermissions();
        }
    };

    private enableVersionControlFeature() {
        appendHttpLifecycleLog("[timeline] enable feature");
        const activeDocument = this.getActiveDocumentContext();
        if (activeDocument) this.currentDocument = activeDocument;
        this.registerVersionControlIcon();
        this.registerVersionControlCommand();
        this.registerVersionControlDocks();
        this.registerVersionControlEvents();
        this.ensureVersionControlPanelsMounted();
        this.snapshotPanel?.$set({
            showDebugMeta: this.versionControlSettings.showDebugMeta,
        });
        this.diffPanel?.$set({
            showDebugMeta: this.versionControlSettings.showDebugMeta,
        });
    }

    private disableVersionControlFeature() {
        appendHttpLifecycleLog("[timeline] disable feature");
        this.unregisterVersionControlCommand();
        this.unregisterVersionControlEvents();
        this.timelineSelection = null;
        this.unmountVersionControlPanels();
        this.removeVersionControlDocks();
    }

    private registerVersionControlIcon() {
        if (this.versionControlIconRegistered) return;
        const addIcons = (this as any).addIcons;
        if (typeof addIcons !== "function") return;
        addIcons.call(this, VERSION_CONTROL_ICON_SYMBOLS);
        this.versionControlIconRegistered = true;
    }

    private registerVersionControlCommand() {
        if (!this.versionControlSettingsLoaded) return;
        if (this.versionControlCommandRegistered) return;
        const addCommand = (this as any).addCommand;
        if (typeof addCommand !== "function") return;
        addCommand.call(this, {
            langKey: "openSnapshotVersionControl",
            langText: this.i18n?.timeline_open_command || "打开文档快照",
            hotkey: "",
            callback: () => this.openVersionControl(),
            editorCallback: (protyle: any) => this.openVersionControl(protyle),
        });
        this.versionControlCommandRegistered = true;
    }

    private unregisterVersionControlCommand() {
        if (!this.versionControlCommandRegistered) return;
        const commands = (this as any).commands;
        if (Array.isArray(commands)) {
            for (let i = commands.length - 1; i >= 0; i--) {
                if (commands[i]?.langKey === "openSnapshotVersionControl") {
                    commands.splice(i, 1);
                }
            }
        }
        this.versionControlCommandRegistered = false;
    }

    private registerVersionControlDocks() {
        if (!this.versionControlSettingsLoaded || !this.versionControlSettings.enabled) return;
        this.registerSnapshotDock();
        this.registerDiffDock();
    }

    private registerSnapshotDock() {
        if (this.snapshotDockRegistered) {
            if (this.isDockRegistrationAlive(
                SNAPSHOT_DOCK_POSITION,
                this.getSnapshotDockTypes(),
                this.snapshotDockElement,
            )) return;
            appendHttpLifecycleLog("[timeline] snapshot dock registration stale; re-register");
            const dockTypes = this.getSnapshotDockTypes();
            this.unmountSnapshotDock();
            this.removeVersionControlDockButtons(dockTypes, SNAPSHOT_DOCK_TYPE, SNAPSHOT_ICON_ID);
            this.snapshotDockRegistered = false;
            this.snapshotDockRegistration = null;
            this.snapshotDockRegisteredType = "";
        }

        const addDock = (this as any).addDock;
        if (typeof addDock !== "function") return;
        const registration = addDock.call(this, {
            config: {
                position: SNAPSHOT_DOCK_POSITION,
                size: { width: 320, height: 0 },
                icon: SNAPSHOT_ICON_ID,
                title: this.i18n?.snapshot_dock_title || "文档快照",
                show: this.getInitialDockVisibility(SNAPSHOT_DOCK_POSITION, this.getSnapshotDockTypes(), true),
            },
            data: {},
            type: SNAPSHOT_DOCK_TYPE,
            init: (dock: any) => {
                const element = dock?.element as HTMLElement | undefined;
                if (!element) return;
                this.snapshotDockElement = element;
                this.mountSnapshotPanel(element);
            },
            update: () => this.updateVersionControlDocument(this.currentDocument, { force: true }),
            destroy: () => this.unmountSnapshotDock(),
        });
        this.snapshotDockRegistered = true;
        this.snapshotDockRegistration = registration ?? null;
        this.snapshotDockRegisteredType = this.getRegisteredDockType(registration, SNAPSHOT_DOCK_TYPE);
    }

    private registerDiffDock() {
        if (this.diffDockRegistered) {
            if (this.isDockRegistrationAlive(
                VERSION_CONTROL_DOCK_POSITION,
                this.getDiffDockTypes(),
                this.diffDockElement,
            )) return;
            appendHttpLifecycleLog("[timeline] diff dock registration stale; re-register");
            const dockTypes = this.getDiffDockTypes();
            this.unmountDiffDock();
            this.removeVersionControlDockButtons(dockTypes, VERSION_CONTROL_DOCK_TYPE, VERSION_CONTROL_ICON_ID);
            this.diffDockRegistered = false;
            this.diffDockRegistration = null;
            this.diffDockRegisteredType = "";
        }

        const addDock = (this as any).addDock;
        if (typeof addDock !== "function") return;
        const registration = addDock.call(this, {
            config: {
                position: VERSION_CONTROL_DOCK_POSITION,
                size: { width: 720, height: 0 },
                icon: VERSION_CONTROL_ICON_ID,
                title: this.i18n?.diff_dock_title || "文档 Diff",
                show: this.getInitialDockVisibility(VERSION_CONTROL_DOCK_POSITION, this.getDiffDockTypes(), false),
            },
            data: {},
            type: VERSION_CONTROL_DOCK_TYPE,
            init: (dock: any) => {
                const element = dock?.element as HTMLElement | undefined;
                if (!element) return;
                this.diffDockElement = element;
                this.mountDiffPanel(element);
            },
            update: () => this.updateVersionControlDocument(this.currentDocument, { force: true }),
            destroy: () => this.unmountDiffDock(),
        });
        this.diffDockRegistered = true;
        this.diffDockRegistration = registration ?? null;
        this.diffDockRegisteredType = this.getRegisteredDockType(registration, VERSION_CONTROL_DOCK_TYPE);
    }

    private getRegisteredDockType(registration: { config?: any; model?: any } | null, type: string): string {
        return firstNonEmptyString([
            registration?.config?.type,
            registration?.model?.type,
            this.name ? `${this.name}${type}` : "",
            type,
        ]);
    }

    private getInitialDockVisibility(position: string, dockTypes: string[], fallback: boolean): boolean {
        const dockLayout = (window as any)?.siyuan?.config?.uiLayout?.[getDockLayoutKey(position)];
        if (!Array.isArray(dockLayout?.data)) return fallback;
        for (const group of dockLayout.data) {
            if (!Array.isArray(group)) continue;
            const item = group.find((entry) => dockTypes.includes(entry?.type));
            if (typeof item?.show === "boolean") return item.show;
        }
        return fallback;
    }

    private isDockRegistrationAlive(position: string, dockTypes: string[], element: HTMLElement | null): boolean {
        if (element?.isConnected) return true;
        if (dockTypes.length === 0) return false;

        const layout = (window as any)?.siyuan?.layout;
        const targetDock = getDockByPosition(layout, position);
        const dockData = targetDock?.data;
        if (dockData && typeof dockData === "object") {
            for (const dockType of dockTypes) {
                if (Object.prototype.hasOwnProperty.call(dockData, dockType)) return true;
            }
        }

        const uiLayout = (window as any)?.siyuan?.config?.uiLayout;
        const dockLayout = uiLayout?.[getDockLayoutKey(position)];
        if (Array.isArray(dockLayout?.data)) {
            for (const group of dockLayout.data) {
                if (!Array.isArray(group)) continue;
                if (group.some((item) => dockTypes.includes(item?.type))) return true;
            }
        }

        const pluginDocks = (this as any).docks;
        if (!layout && pluginDocks && typeof pluginDocks === "object") {
            for (const dockType of dockTypes) {
                if (Object.prototype.hasOwnProperty.call(pluginDocks, dockType)) return true;
            }
        }

        return false;
    }

    private ensureVersionControlPanelsMounted() {
        if (!this.snapshotPanel && this.snapshotDockElement) this.mountSnapshotPanel(this.snapshotDockElement);
        if (!this.diffPanel && this.diffDockElement) this.mountDiffPanel(this.diffDockElement);
    }

    private mountSnapshotPanel(element: HTMLElement) {
        if (!this.versionControlSettings.enabled) return;
        if (!this.versionControlSettingsLoaded) return;
        this.unmountSnapshotPanel();
        element.innerHTML = `<div id="${SNAPSHOT_DOCK_ROOT_ID}" style="height: 100%;"></div>`;
        this.snapshotContainer = element.querySelector(`#${SNAPSHOT_DOCK_ROOT_ID}`);
        if (!this.snapshotContainer) return;
        this.snapshotPanel = new SnapshotPanel({
            target: this.snapshotContainer,
            props: {
                currentDocumentId: this.currentDocument.id,
                currentDocumentTitle: this.currentDocument.title,
                selectedNodeKey: getTimelineNodeSelectionKey(this.timelineSelection),
                showDebugMeta: this.versionControlSettings.showDebugMeta,
                i18n: this.i18n ?? {},
                onSelectNode: (selection: TimelineNodeSelection | null) => this.selectTimelineNode(selection),
            },
        });
    }

    private mountDiffPanel(element: HTMLElement) {
        if (!this.versionControlSettings.enabled || !this.versionControlSettingsLoaded) return;
        this.unmountDiffPanel();
        element.innerHTML = `<div id="${VERSION_CONTROL_DOCK_ROOT_ID}" style="height: 100%;"></div>`;
        this.diffContainer = element.querySelector(`#${VERSION_CONTROL_DOCK_ROOT_ID}`);
        if (!this.diffContainer) return;
        this.diffPanel = new VersionDiffPanel({
            target: this.diffContainer,
            props: {
                currentDocumentId: this.currentDocument.id,
                currentDocumentTitle: this.currentDocument.title,
                selection: this.timelineSelection,
                showDebugMeta: this.versionControlSettings.showDebugMeta,
                i18n: this.i18n ?? {},
                onOpenSnapshot: () => this.showSnapshotDock(),
            },
        });
    }

    private registerVersionControlEvents() {
        if (!this.versionControlSettingsLoaded) return;
        if (!this.versionControlSettings.enabled || this.versionControlEventsRegistered) return;
        const eventBus = (this as any).eventBus;
        if (typeof eventBus?.on !== "function") return;
        eventBus.on("switch-protyle", this.handleVersionControlProtyleChange as any);
        eventBus.on("loaded-protyle-dynamic", this.handleVersionControlProtyleChange as any);
        eventBus.on("loaded-protyle-static", this.handleVersionControlProtyleChange as any);
        this.versionControlEventsRegistered = true;
    }

    private unregisterVersionControlEvents() {
        if (!this.versionControlEventsRegistered) return;
        const eventBus = (this as any).eventBus;
        eventBus?.off?.("switch-protyle", this.handleVersionControlProtyleChange as any);
        eventBus?.off?.("loaded-protyle-dynamic", this.handleVersionControlProtyleChange as any);
        eventBus?.off?.("loaded-protyle-static", this.handleVersionControlProtyleChange as any);
        this.versionControlEventsRegistered = false;
    }

    private readonly handleVersionControlProtyleChange = (event: CustomEvent<{ protyle?: unknown }>) => {
        if (!this.versionControlSettings.enabled) return;
        const context = this.getDocumentContextFromProtyle(event?.detail?.protyle);
        if (context) this.updateVersionControlDocument(context);
    };

    private getDocumentContextFromProtyle(protyle: unknown): CurrentDocumentContext | null {
        if (!protyle || typeof protyle !== "object") return null;
        const record = protyle as Record<string, any>;
        const block = record.block && typeof record.block === "object" ? record.block : {};
        const id = firstNonEmptyString([
            block.rootID,
            block.id,
            record.rootID,
            record.id,
        ]);
        if (!id) return null;
        return {
            id,
            title: firstNonEmptyString([
                record.title,
                block.name,
                block.content,
                getDocumentTitleFromPath(record.hpath),
                getDocumentTitleFromPath(record.path),
                this.currentDocument.id === id ? this.currentDocument.title : "",
            ]) || id,
        };
    }

    private getActiveDocumentContext(): CurrentDocumentContext | null {
        if (typeof getAllEditor !== "function") return null;
        const editors = getAllEditor();
        if (!Array.isArray(editors) || editors.length === 0) return null;
        const visibleEditors = editors.filter((editor: any) => {
            const element = editor?.protyle?.element as HTMLElement | undefined;
            if (!element?.isConnected) return false;
            if (typeof getComputedStyle !== "function") return true;
            const style = getComputedStyle(element);
            return style.display !== "none" && style.visibility !== "hidden";
        });
        const activeEditor = visibleEditors.find((editor: any) => (
            editor?.protyle?.element?.closest?.(".layout__wnd--active")
        )) ?? visibleEditors.at(-1) ?? editors.at(-1);
        return this.getDocumentContextFromProtyle(activeEditor?.protyle ?? activeEditor);
    }

    private updateVersionControlDocument(context: CurrentDocumentContext, options: { force?: boolean } = {}) {
        if (!this.versionControlSettings.enabled) return;
        const documentChanged = this.currentDocument.id !== context.id;
        this.currentDocument = context;
        if (documentChanged) this.timelineSelection = null;
        void options;
        this.snapshotPanel?.$set({
            currentDocumentId: context.id,
            currentDocumentTitle: context.title,
            selectedNodeKey: getTimelineNodeSelectionKey(this.timelineSelection),
        });
        this.diffPanel?.$set({
            currentDocumentId: context.id,
            currentDocumentTitle: context.title,
            selection: this.timelineSelection,
        });
    }

    private selectTimelineNode(selection: TimelineNodeSelection | null) {
        if (selection && selection.documentId !== this.currentDocument.id) return;
        this.timelineSelection = selection;
        this.snapshotPanel?.$set({
            selectedNodeKey: getTimelineNodeSelectionKey(selection),
        });
        this.diffPanel?.$set({
            currentDocumentId: this.currentDocument.id,
            currentDocumentTitle: this.currentDocument.title,
            selection,
        });
        if (selection) this.showDiffDock();
    }

    private showSnapshotDock() {
        if (!this.versionControlSettings.enabled) return;
        const layout = (window as any)?.siyuan?.layout;
        const targetDock = getDockByPosition(layout, SNAPSHOT_DOCK_POSITION);
        if (typeof targetDock?.toggleModel === "function") {
            targetDock.toggleModel(this.getSnapshotDockTypes()[0] ?? SNAPSHOT_DOCK_TYPE, true, false, false, true);
            return;
        }
        targetDock?.showDock?.();
    }

    private showDiffDock() {
        if (!this.versionControlSettings.enabled) return;
        const layout = (window as any)?.siyuan?.layout;
        const targetDock = getDockByPosition(layout, VERSION_CONTROL_DOCK_POSITION);
        if (typeof targetDock?.toggleModel === "function") {
            targetDock.toggleModel(this.getDiffDockTypes()[0] ?? VERSION_CONTROL_DOCK_TYPE, true, false, false, true);
            return;
        }
        targetDock?.showDock?.();
    }

    private unmountSnapshotPanel() {
        this.snapshotPanel?.$destroy();
        this.snapshotPanel = null;
        if (this.snapshotContainer) this.snapshotContainer.innerHTML = "";
        this.snapshotContainer = null;
    }

    private unmountDiffPanel() {
        this.diffPanel?.$destroy();
        this.diffPanel = null;
        if (this.diffContainer) this.diffContainer.innerHTML = "";
        this.diffContainer = null;
    }

    private unmountVersionControlPanels() {
        this.unmountSnapshotPanel();
        this.unmountDiffPanel();
    }

    private unmountSnapshotDock() {
        this.unmountSnapshotPanel();
        this.snapshotDockElement = null;
    }

    private unmountDiffDock() {
        this.unmountDiffPanel();
        this.diffDockElement = null;
    }

    private unmountVersionControlDocks() {
        this.unmountSnapshotDock();
        this.unmountDiffDock();
    }

    private removeVersionControlDocks() {
        appendHttpLifecycleLog("[timeline] remove docks");
        const layout = (window as any)?.siyuan?.layout;
        const snapshotTypes = this.getSnapshotDockTypes();
        const diffTypes = this.getDiffDockTypes();
        this.removeDockFromPosition(layout, SNAPSHOT_DOCK_POSITION, snapshotTypes);
        this.removeDockFromPosition(layout, VERSION_CONTROL_DOCK_POSITION, diffTypes);
        const allTypes = [...new Set([...snapshotTypes, ...diffTypes])];
        this.removeVersionControlDockRegistry(allTypes, layout);
        this.removeVersionControlDockLayout(allTypes);
        this.removeVersionControlDockButtons(snapshotTypes, SNAPSHOT_DOCK_TYPE, SNAPSHOT_ICON_ID);
        this.removeVersionControlDockButtons(diffTypes, VERSION_CONTROL_DOCK_TYPE, VERSION_CONTROL_ICON_ID);
        this.snapshotDockRegistered = false;
        this.diffDockRegistered = false;
        this.snapshotDockElement = null;
        this.diffDockElement = null;
        this.snapshotDockRegistration = null;
        this.diffDockRegistration = null;
        this.snapshotDockRegisteredType = "";
        this.diffDockRegisteredType = "";
    }

    private removeDockFromPosition(layout: any, position: string, dockTypes: string[]) {
        const targetDock = getDockByPosition(layout, position);
        if (!targetDock || typeof document === "undefined") return;
        for (const dockType of dockTypes) {
            // SiYuan's toggleModel (also called by remove) requires an existing button.
            const button = document.querySelector(`.dock__item[data-type="${escapeCssAttributeValue(dockType)}"]`);
            if (!button) continue;
            targetDock.toggleModel?.(dockType, false, true, true, true);
            // A registered but unopened dock may not have a model yet.
            if (targetDock.data?.[dockType]) targetDock.remove?.(dockType);
        }
    }

    private getSnapshotDockTypes(): string[] {
        return this.getDockTypes(this.snapshotDockRegistration, this.snapshotDockRegisteredType, SNAPSHOT_DOCK_TYPE);
    }

    private getDiffDockTypes(): string[] {
        return this.getDockTypes(this.diffDockRegistration, this.diffDockRegisteredType, VERSION_CONTROL_DOCK_TYPE);
    }

    private getDockTypes(
        registration: { config?: any; model?: any } | null,
        registeredType: string,
        fallbackType: string,
    ): string[] {
        return [
            registration?.config?.type,
            registration?.model?.type,
            registeredType,
            this.name ? `${this.name}${fallbackType}` : "",
            fallbackType,
        ].filter((value, index, values): value is string => (
            typeof value === "string" && value.length > 0 && values.indexOf(value) === index
        ));
    }

    private removeVersionControlDockRegistry(dockTypes: string[], layout: any) {
        const pluginDocks = (this as any).docks;
        if (pluginDocks && typeof pluginDocks === "object") {
            for (const dockType of dockTypes) {
                delete pluginDocks[dockType];
            }
        }

        for (const dock of [layout?.leftDock, layout?.rightDock, layout?.bottomDock]) {
            const dockData = dock?.data;
            if (!dockData || typeof dockData !== "object") continue;
            for (const dockType of dockTypes) {
                delete dockData[dockType];
            }
        }
    }

    private removeVersionControlDockLayout(dockTypes: string[]) {
        const uiLayout = (window as any)?.siyuan?.config?.uiLayout;
        for (const position of ["left", "right", "bottom"]) {
            const dock = uiLayout?.[position];
            if (!Array.isArray(dock?.data)) continue;
            dock.data = dock.data
                .map((group: any) => Array.isArray(group)
                    ? group.filter((item) => !dockTypes.includes(item?.type))
                    : group)
                .filter((group: any) => !Array.isArray(group) || group.length > 0);
        }
    }

    private removeVersionControlDockButtons(dockTypes: string[], fallbackType: string, iconId: string) {
        if (typeof document === "undefined") return;
        for (const dockType of dockTypes) {
            const escapedDockType = escapeCssAttributeValue(dockType);
            const selectors = [
                `.dock__item[data-type="${escapedDockType}"]`,
                `.dock__item[data-id="${escapedDockType}"]`,
                `[data-type="${escapedDockType}"].dock__item`,
                `[data-id="${escapedDockType}"].dock__item`,
                `.dock__item[data-type$="${escapeCssAttributeValue(fallbackType)}"]`,
                `.dock__item[data-id$="${escapeCssAttributeValue(fallbackType)}"]`,
            ];
            for (const element of Array.from(document.querySelectorAll<HTMLElement>(selectors.join(", ")))) {
                const dockItem = element.closest?.(".dock__item") as HTMLElement | null;
                (dockItem ?? element).remove();
            }
        }

        const escapedIconId = escapeCssAttributeValue(`#${iconId}`);
        const iconSelectors = [
            `.dock__item[data-icon="${escapeCssAttributeValue(iconId)}"]`,
            `.dock__item use[href="${escapedIconId}"]`,
            `.dock__item use[xlink\\:href="${escapedIconId}"]`,
            `.dock__item [href="${escapedIconId}"]`,
            `.dock__item [xlink\\:href="${escapedIconId}"]`,
        ];
        for (const element of Array.from(document.querySelectorAll<HTMLElement>(iconSelectors.join(", ")))) {
            const dockItem = element.closest?.(".dock__item") as HTMLElement | null;
            (dockItem ?? element).remove();
        }
    }

}

function firstNonEmptyString(values: unknown[]): string {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function getDocumentTitleFromPath(path: unknown): string {
    if (typeof path !== "string" || !path.trim()) return "";
    const segment = path.split("/").filter(Boolean).at(-1) ?? "";
    return segment.replace(/\.sy$/i, "") || "";
}

function getDockByPosition(layout: any, position: string): any {
    if (position.startsWith("Left")) return layout?.leftDock;
    if (position.startsWith("Bottom")) return layout?.bottomDock;
    return layout?.rightDock;
}

function getDockLayoutKey(position: string): "left" | "right" | "bottom" {
    if (position.startsWith("Left")) return "left";
    if (position.startsWith("Bottom")) return "bottom";
    return "right";
}

function escapeCssAttributeValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
