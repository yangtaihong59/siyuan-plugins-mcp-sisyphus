import {
    Plugin,
    showMessage,
    Dialog,
} from "siyuan";
import "./index.scss";

import {
    buildDefaultHttpServerSettings,
    buildDefaultPuppySettings,
    buildDefaultVersionControlSettings,
    hasValidHttpTlsFiles,
    loadPersistedHttpServerSettings,
    loadPersistedPuppySettings,
    loadPersistedToolConfigState,
    loadPersistedVersionControlSettings,
    savePersistedHttpServerSettings,
    savePersistedToolConfig,
    savePersistedVersionControlSettings,
    type HttpServerSettings,
    type PuppySettings,
    type VersionControlSettings,
} from "@/ui/setting/tool-config-storage";
import { emitToolConfigWarningOnce } from "@/core/config";
import McpConfig from "@/ui/setting/mcp-config.svelte";
import ToolPuppy from "@/ui/components/ToolPuppy.svelte";
import VersionControlPanel from "@/ui/version-control/VersionControlPanel.svelte";

import { HttpServerLauncher } from "@/server-launcher";

const PUPPY_ROOT_ID = "sy-puppy-root";
const VERSION_CONTROL_DOCK_TYPE = "sisyphusTimelineDock";
const VERSION_CONTROL_DOCK_ROOT_ID = "SisyphusTimelineDockPanel";
const VERSION_CONTROL_ICON = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 3a3 3 0 0 1 2 5.24v1.27l6 3V8.24A3 3 0 1 1 17 9v5a1 1 0 0 1-1.45.89L9 11.62v4.14A3 3 0 1 1 7 15.76V8.24A3 3 0 0 1 7 3Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm10 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM7 17a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>`;
const SETTINGS_ICON = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.12 5.07c-.61.24-1.18.56-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.06.65-.06.98s.02.66.07.98l-2.12 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.4.31.61.22l2.49-1c.51.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.24 1.18-.56 1.69-.98l2.49 1c.23.08.48 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.12-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"/></svg>`;

type CurrentDocumentContext = {
    id: string;
    title: string;
};

export default class SiyuanMCP extends Plugin {
    private puppyComponent: ToolPuppy | null = null;
    private versionControlPanel: VersionControlPanel | null = null;
    private versionControlContainer: HTMLElement | null = null;
    private currentDocument: CurrentDocumentContext = { id: "", title: "" };
    private puppyVisible = true;
    private puppyContainer: HTMLElement | null = null;
    private puppySettings: PuppySettings = buildDefaultPuppySettings();
    private versionControlSettings: VersionControlSettings = buildDefaultVersionControlSettings();
    public httpSettings: HttpServerSettings = buildDefaultHttpServerSettings();
    public httpLauncher: HttpServerLauncher | null = null;

    async onload() {
        const { config: normalized, warning } = await loadPersistedToolConfigState(this);
        if (warning) {
            emitToolConfigWarningOnce(warning, (message) => {
                console.warn(message);
                showMessage(message);
            });
        }
        await savePersistedToolConfig(normalized, this);
        this.puppySettings = await loadPersistedPuppySettings(this);
        this.puppyVisible = this.puppySettings.visible;
        this.httpSettings = await loadPersistedHttpServerSettings(this);
        this.versionControlSettings = await loadPersistedVersionControlSettings(this);

        (this as any).addCommand?.({
            langKey: "openSnapshotVersionControl",
            langText: this.i18n?.timeline_open_command || "打开文档时间线",
            hotkey: "",
            callback: () => this.openVersionControl(),
            editorCallback: (protyle: any) => this.openVersionControl(protyle),
        });
        (this as any).addTopBar?.({
            icon: SETTINGS_ICON,
            title: this.i18n?.mcpToolsSettingTitle || "SiYuan Sisyphus 设置",
            callback: () => this.openSetting(),
            position: "right",
        });
        this.registerVersionControlDock();
        this.registerVersionControlEvents();

        const support = HttpServerLauncher.getSupportInfo();
        if (!support.supported) {
            return;
        }

        const scriptPath = HttpServerLauncher.resolveServerScriptPath(this.name);
        if (!scriptPath) {
            return;
        }

        try {
            this.httpLauncher = new HttpServerLauncher(scriptPath);
            if (this.httpSettings.enabled) {
                try {
                    await this.startHttpServer();
                } catch (err) {
                    console.error("[MCP] auto-start HTTP server failed:", err);
                }
            }
        } catch (err) {
            console.error("[MCP] failed to init HttpServerLauncher:", err);
        }
    }

    async startHttpServer(): Promise<void> {
        if (!this.httpLauncher) return;
        if (!hasValidHttpTlsFiles(this.httpSettings)) {
            throw new Error("HTTPS requires both certificate and key file paths.");
        }
        const siyuanToken = (window as any)?.siyuan?.config?.api?.token ?? undefined;
        await this.httpLauncher.start({
            host: this.httpSettings.host,
            port: this.httpSettings.port,
            token: this.httpSettings.authEnabled ? this.httpSettings.token : undefined,
            siyuanApiUrl: "http://127.0.0.1:6806",
            siyuanToken,
            tlsCertFile: this.httpSettings.tlsEnabled && this.httpSettings.tlsCertFile ? this.httpSettings.tlsCertFile : undefined,
            tlsKeyFile: this.httpSettings.tlsEnabled && this.httpSettings.tlsKeyFile ? this.httpSettings.tlsKeyFile : undefined,
            tlsCaFile: this.httpSettings.tlsEnabled && this.httpSettings.tlsCaFile ? this.httpSettings.tlsCaFile : undefined,
        });
    }

    async stopHttpServer(): Promise<void> {
        await this.httpLauncher?.stop();
    }

    async setHttpServerSettings(next: HttpServerSettings): Promise<HttpServerSettings> {
        this.httpSettings = await savePersistedHttpServerSettings(next, this);
        return this.httpSettings;
    }

    async updateHttpServerSettings(next: HttpServerSettings): Promise<HttpServerSettings> {
        const wasRunning = this.httpLauncher?.getStatus().running ?? false;
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
                console.error("[MCP] restart after settings change failed:", err);
            }
        }
        return this.httpSettings;
    }

    async refreshHttpServerAfterUserRulesChange(): Promise<boolean> {
        const wasRunning = this.httpLauncher?.getStatus().running ?? false;
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
                visible: this.puppyVisible,
                testModeEnabled: this.puppySettings.testModeEnabled,
                testModeIntervalMs: this.puppySettings.testModeIntervalMs,
                showBubble: this.puppySettings.showBubble,
                showClickHint: this.puppySettings.showClickHint,
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
        this.mountPuppy();
    }


    updatePuppyTestSettings(settings: PuppySettings) {
        this.puppySettings = settings;
        this.puppyVisible = settings.visible;
        if (this.puppyComponent) {
            this.puppyComponent.$set({
                visible: settings.visible,
                testModeEnabled: settings.testModeEnabled,
                testModeIntervalMs: settings.testModeIntervalMs,
                showBubble: settings.showBubble,
                showClickHint: settings.showClickHint,
            });
        }
    }

    async updateVersionControlSettings(settings: VersionControlSettings): Promise<void> {
        this.versionControlSettings = await savePersistedVersionControlSettings(settings, this);
        this.versionControlPanel?.$set({
            showDebugMeta: this.versionControlSettings.showDebugMeta,
        });
    }

    async onunload() {
        this.unregisterVersionControlEvents();
        this.unmountVersionControlDock();
        this.unmountPuppy();
        if (this.httpLauncher) {
            try {
                await this.stopHttpServer();
            } catch (err) {
                console.error("[MCP] stop HTTP server during unload failed:", err);
            }
        }
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
            width: "800px",
            destroyCallback: () => {
                //You'd better destroy the component when the dialog is closed
                pannel.$destroy();
            }
        });
        let pannel = new McpConfig({
            target: dialog.element.querySelector("#SettingPanel"),
            props: {
                plugin: this
            }
        });
    }

    openVersionControl(protyle?: unknown): void {
        const context = this.getDocumentContextFromProtyle(protyle) ?? this.currentDocument;
        this.updateVersionControlDocument(context);
        this.showVersionControlDock();
    }

    private registerVersionControlDock() {
        (this as any).addDock?.({
            config: {
                position: "RightBottom",
                size: { width: 420, height: null },
                icon: VERSION_CONTROL_ICON,
                title: this.i18n?.timeline_dock_title || "文档时间线",
                show: true,
            },
            data: {},
            type: VERSION_CONTROL_DOCK_TYPE,
            init: (dock: any) => {
                const element = dock?.element as HTMLElement | undefined;
                if (!element) return;
                element.innerHTML = `<div id="${VERSION_CONTROL_DOCK_ROOT_ID}" style="height: 100%;"></div>`;
                this.versionControlContainer = element.querySelector(`#${VERSION_CONTROL_DOCK_ROOT_ID}`);
                if (!this.versionControlContainer) return;
                this.versionControlPanel = new VersionControlPanel({
                    target: this.versionControlContainer,
                    props: {
                        currentDocumentId: this.currentDocument.id,
                        currentDocumentTitle: this.currentDocument.title,
                        showDebugMeta: this.versionControlSettings.showDebugMeta,
                        i18n: this.i18n ?? {},
                    },
                });
            },
            destroy: () => this.unmountVersionControlDock(),
        });
    }

    private registerVersionControlEvents() {
        (this as any).eventBus?.on?.("switch-protyle", this.handleVersionControlProtyleChange as any);
        (this as any).eventBus?.on?.("loaded-protyle-dynamic", this.handleVersionControlProtyleChange as any);
        (this as any).eventBus?.on?.("loaded-protyle-static", this.handleVersionControlProtyleChange as any);
    }

    private unregisterVersionControlEvents() {
        (this as any).eventBus?.off?.("switch-protyle", this.handleVersionControlProtyleChange as any);
        (this as any).eventBus?.off?.("loaded-protyle-dynamic", this.handleVersionControlProtyleChange as any);
        (this as any).eventBus?.off?.("loaded-protyle-static", this.handleVersionControlProtyleChange as any);
    }

    private readonly handleVersionControlProtyleChange = (event: CustomEvent<{ protyle?: unknown }>) => {
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

    private updateVersionControlDocument(context: CurrentDocumentContext) {
        this.currentDocument = context;
        this.versionControlPanel?.$set({
            currentDocumentId: context.id,
            currentDocumentTitle: context.title,
        });
    }

    private showVersionControlDock() {
        const layout = (window as any)?.siyuan?.layout;
        layout?.rightDock?.showDock?.();
        layout?.leftDock?.showDock?.();
    }

    private unmountVersionControlDock() {
        this.versionControlPanel?.$destroy();
        this.versionControlPanel = null;
        if (this.versionControlContainer) {
            this.versionControlContainer.innerHTML = "";
            this.versionControlContainer = null;
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
