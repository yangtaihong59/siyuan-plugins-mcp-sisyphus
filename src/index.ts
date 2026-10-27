import { getWorkspaceApiUrl } from './shared/workspace-api-url';
import {
    Plugin,
    showMessage,
    Dialog,
} from "siyuan";
import "./index.scss";

import {
    buildDefaultHttpServerSettings,
    hasValidHttpTlsFiles,
    loadPersistedHttpServerSettings,
    loadPersistedPermissionDisplaySettings,
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
import { emitToolConfigWarningOnce } from "@/core/config";
import { submitFeedback, type FeedbackInput, type FeedbackSubmitResult } from "@/core/feedback";
import McpConfig from "@/ui/setting/mcp-config.svelte";
import { createFeedbackFetch } from "@/ui/plugin/feedback-fetch";
import { PermissionTreeFeature } from "@/ui/plugin/permission-tree-feature";
import { PuppyFeature } from "@/ui/plugin/puppy-feature";
import { VersionControlFeature } from "@/ui/plugin/version-control-feature";

import { HttpServerLauncher, appendHttpLifecycleLog } from "@/server-launcher";

export default class SiyuanMCP extends Plugin {
    private layoutReady = false;
    private readonly versionControl = new VersionControlFeature(this);
    private readonly permissionTree = new PermissionTreeFeature(this, () => this.layoutReady);
    private readonly puppy = new PuppyFeature();
    public httpSettings: HttpServerSettings = buildDefaultHttpServerSettings();
    public httpLauncher: HttpServerLauncher | null = null;

    async onload() {
        appendHttpLifecycleLog("[plugin] onload begin");
        this.versionControl.registerVersionControlIcon();
        this.permissionTree.registerNewNotebookPermission();

        const { config: normalized, warning } = await loadPersistedToolConfigState(this);
        if (warning) {
            emitToolConfigWarningOnce(warning, (message) => {
                console.warn(message);
                showMessage(message);
            });
        }
        await savePersistedToolConfig(normalized, this);
        this.puppy.puppySettings = await loadPersistedPuppySettings(this);
        this.puppy.puppySettingsLoaded = true;
        if (this.layoutReady) {
            this.puppy.mountPuppy();
        }
        this.httpSettings = await loadPersistedHttpServerSettings(this);
        this.versionControl.versionControlSettings = await loadPersistedVersionControlSettings(this);
        this.versionControl.versionControlSettingsLoaded = true;
        this.permissionTree.permissionDisplaySettings = await loadPersistedPermissionDisplaySettings(this);
        this.permissionTree.permissionDisplaySettingsLoaded = true;
        appendHttpLifecycleLog(`[plugin] settings loaded: httpEnabled=${this.httpSettings.enabled} timelineEnabled=${this.versionControl.versionControlSettings.enabled}`);
        this.versionControl.syncVersionControlFeature();
        this.permissionTree.syncPermissionTreeFeature();

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


    onLayoutReady() {
        this.layoutReady = true;
        if (this.puppy.puppySettingsLoaded) {
            this.puppy.mountPuppy();
        }
        if (this.versionControl.versionControlSettingsLoaded) this.versionControl.syncVersionControlFeature();
        if (this.permissionTree.permissionDisplaySettingsLoaded) this.permissionTree.syncPermissionTreeFeature();
    }

    updatePuppyTestSettings(settings: PuppySettings) {
        this.puppy.updatePuppyTestSettings(settings);
    }

    async updateVersionControlSettings(settings: VersionControlSettings): Promise<void> {
        this.versionControl.versionControlSettings = await savePersistedVersionControlSettings(settings, this);
        appendHttpLifecycleLog(`[timeline] settings updated: enabled=${this.versionControl.versionControlSettings.enabled} showDebugMeta=${this.versionControl.versionControlSettings.showDebugMeta}`);
        this.versionControl.syncVersionControlFeature();
    }

    updatePermissionDisplaySettings(settings: PermissionDisplaySettings): void {
        this.permissionTree.updatePermissionDisplaySettings(settings);
    }

    refreshPermissionTreeIndicators(permissions?: unknown): void {
        this.permissionTree.refreshPermissionTreeIndicators(permissions);
    }

    openVersionControl(protyle?: unknown): void {
        this.versionControl.openVersionControl(protyle);
    }

    async submitFeedback(input: FeedbackInput): Promise<FeedbackSubmitResult> {
        return submitFeedback(input, createFeedbackFetch());
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
        this.puppy.puppySettingsLoaded = false;
        this.permissionTree.permissionDisplaySettingsLoaded = false;
        this.permissionTree.disablePermissionTreeFeature();
        this.permissionTree.unregisterNewNotebookPermission();
        this.versionControl.unregisterVersionControlEvents();
        this.versionControl.unmountVersionControlDocks();
        this.puppy.unmountPuppy();
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




}
