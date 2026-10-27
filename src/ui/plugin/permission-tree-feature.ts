import { Plugin, showMessage } from "siyuan";

import { NEW_NOTEBOOK_PERMISSION } from "@/shared/constants";
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
import {
    buildDefaultPermissionDisplaySettings,
    normalizePermissionDisplaySettings,
    type PermissionDisplaySettings,
} from "@/ui/setting/tool-config-storage";

/*
 * File-tree permission badges plus the always-on grant for notebooks created
 * in the SiYuan UI. The badges follow the display setting; the grant does not.
 */
export class PermissionTreeFeature {
    permissionDisplaySettings: PermissionDisplaySettings = buildDefaultPermissionDisplaySettings();
    permissionDisplaySettingsLoaded = false;
    permissionTreePermissions: Record<string, NotebookPermission> = {};
    private permissionTreeObserver: MutationObserver | null = null;
    private permissionTreeEventsRegistered = false;
    private newNotebookPermissionRegistered = false;
    private permissionTreeClickRegistered = false;
    private permissionTreeFrame: number | null = null;
    private permissionTreeLoadVersion = 0;

    constructor(
        private readonly plugin: Plugin,
        private readonly isLayoutReady: () => boolean,
    ) {}

    updatePermissionDisplaySettings(settings: PermissionDisplaySettings): void {
        this.permissionDisplaySettings = normalizePermissionDisplaySettings(settings);
        this.syncPermissionTreeFeature();
    }

    refreshPermissionTreeIndicators(permissions?: unknown): void {
        if (permissions !== undefined) {
            this.permissionTreePermissions = normalizeNotebookPermissions(permissions);
            this.emitPermissionTreeChange();
        }
        if (!this.permissionDisplaySettings.showInFileTree || !this.isLayoutReady()) return;
        this.schedulePermissionTreeDecoration();
    }

    syncPermissionTreeFeature() {
        if (!this.permissionDisplaySettingsLoaded || !this.isLayoutReady()) return;
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

    disablePermissionTreeFeature() {
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
        const eventBus = (this.plugin as any).eventBus;
        if (typeof eventBus?.on !== "function") return;
        eventBus.on("ws-main", this.handlePermissionTreeWebSocket as any);
        this.permissionTreeEventsRegistered = true;
    }

    private unregisterPermissionTreeEvents() {
        if (!this.permissionTreeEventsRegistered) return;
        const eventBus = (this.plugin as any).eventBus;
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
        const raw = await this.plugin.loadData("notebookPermissions");
        if (
            loadVersion !== this.permissionTreeLoadVersion ||
            !this.isLayoutReady() ||
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
            if (!this.isLayoutReady() || !this.permissionDisplaySettings.showInFileTree) return;
            decoratePermissionTree(document, this.permissionTreePermissions, this.getPermissionTreeLabels());
        });
    }

    private getPermissionTreeLabels(): PermissionTreeLabels {
        return {
            names: {
                none: this.plugin.i18n?.mcpPermNone || "无权限",
                r: this.plugin.i18n?.mcpPermRead || "只读",
                rw: this.plugin.i18n?.mcpPermReadWrite || "读写不可删除",
                rwd: this.plugin.i18n?.mcpPermReadWriteDelete || "读写可删除",
            },
            defaultSuffix: this.plugin.i18n?.permission_tree_default_suffix || "（默认）",
            pluginName: this.plugin.i18n?.permission_tree_plugin_name || "插件：思源 sisyphus MCP & CLI & GIT",
            notebookScope: this.plugin.i18n?.permission_tree_scope || "应用于整个笔记本及其子文档",
            clickToChange: this.plugin.i18n?.permission_tree_click_hint || "点击切换权限",
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
            await this.plugin.saveData("notebookPermissions", this.permissionTreePermissions);
            this.emitPermissionTreeChange();
        } catch (error) {
            this.permissionTreePermissions = previousPermissions;
            decoratePermissionTree(document, this.permissionTreePermissions, this.getPermissionTreeLabels());
            console.error("[MCP] failed to update notebook permission from file tree:", error);
            showMessage(this.plugin.i18n?.permission_tree_save_failed || "权限保存失败，已恢复原状态");
        } finally {
            delete target.dataset.saving;
            target.removeAttribute("aria-busy");
        }
    };

    // Notebooks created in the SiYuan UI after install get NEW_NOTEBOOK_PERMISSION,
    // matching notebook(action="create"). Independent of the file-tree badge setting.
    registerNewNotebookPermission() {
        if (this.newNotebookPermissionRegistered) return;
        const eventBus = (this.plugin as any).eventBus;
        if (typeof eventBus?.on !== "function") return;
        eventBus.on("ws-main", this.handleNewNotebookWebSocket as any);
        this.newNotebookPermissionRegistered = true;
    }

    unregisterNewNotebookPermission() {
        if (!this.newNotebookPermissionRegistered) return;
        (this.plugin as any).eventBus?.off?.("ws-main", this.handleNewNotebookWebSocket as any);
        this.newNotebookPermissionRegistered = false;
    }

    readonly handleNewNotebookWebSocket = async (event: CustomEvent<{ cmd?: string; data?: { box?: { id?: string }; existed?: boolean } }>) => {
        const detail = event?.detail;
        const notebookId = detail?.data?.box?.id;
        // existed=true means an existing notebook directory was reopened; leave its default.
        if (detail?.cmd !== "createnotebook" || detail.data?.existed !== false || !notebookId) return;
        try {
            const permissions = normalizeNotebookPermissions(await this.plugin.loadData("notebookPermissions"));
            if (Object.prototype.hasOwnProperty.call(permissions, notebookId)) return;
            permissions[notebookId] = NEW_NOTEBOOK_PERMISSION;
            await this.plugin.saveData("notebookPermissions", permissions);
            this.permissionTreePermissions = permissions;
            this.emitPermissionTreeChange();
            this.schedulePermissionTreeDecoration();
        } catch (error) {
            console.error("[MCP] failed to grant permission for new notebook:", error);
        }
    };

    private readonly handlePermissionTreeWebSocket = (event: CustomEvent<{ cmd?: string }>) => {
        if (event?.detail?.cmd === "reloadFiletree") {
            void this.loadPermissionTreePermissions();
        }
    };
}
