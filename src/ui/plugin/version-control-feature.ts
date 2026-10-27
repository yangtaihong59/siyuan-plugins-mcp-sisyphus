import { Plugin, showMessage, getAllEditor } from "siyuan";

import { appendHttpLifecycleLog } from "@/server-launcher";
import { getTimelineNodeSelectionKey, type TimelineNodeSelection } from "@/shared/version-control/timeline";
import { buildDefaultVersionControlSettings, type VersionControlSettings } from "@/ui/setting/tool-config-storage";
import SnapshotPanel from "@/ui/version-control/SnapshotPanel.svelte";
import VersionDiffPanel from "@/ui/version-control/VersionDiffPanel.svelte";

/*
 * Snapshot / diff docks, their command and protyle tracking. Owned by the
 * plugin entry, which only forwards lifecycle and settings changes.
 */

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
    `<symbol id="${VERSION_CONTROL_ICON_ID}" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M4 5h6v14H4zM14 5h6v14h-6z"/></symbol>`,
].join("");

type CurrentDocumentContext = {
    id: string;
    title: string;
};

export class VersionControlFeature {
    private snapshotPanel: SnapshotPanel | null = null;
    private diffPanel: VersionDiffPanel | null = null;
    private snapshotContainer: HTMLElement | null = null;
    private diffContainer: HTMLElement | null = null;
    currentDocument: CurrentDocumentContext = { id: "", title: "" };
    timelineSelection: TimelineNodeSelection | null = null;
    versionControlSettings: VersionControlSettings = buildDefaultVersionControlSettings();
    private snapshotDockRegistered = false;
    private diffDockRegistered = false;
    private versionControlCommandRegistered = false;
    private versionControlEventsRegistered = false;
    private versionControlIconRegistered = false;
    versionControlSettingsLoaded = false;
    private snapshotDockElement: HTMLElement | null = null;
    private diffDockElement: HTMLElement | null = null;
    private snapshotDockRegistration: { config?: any; model?: any } | null = null;
    private diffDockRegistration: { config?: any; model?: any } | null = null;
    private snapshotDockRegisteredType = "";
    private diffDockRegisteredType = "";

    constructor(private readonly plugin: Plugin) {}

    openVersionControl(protyle?: unknown): void {
        if (!this.versionControlSettings.enabled) {
            showMessage(this.plugin.i18n?.timeline_disabled_msg || "文档时间树已关闭");
            return;
        }
        this.syncVersionControlFeature();
        const context = this.getDocumentContextFromProtyle(protyle) ?? this.currentDocument;
        this.updateVersionControlDocument(context, { force: true });
        this.showSnapshotDock();
    }

    syncVersionControlFeature() {
        appendHttpLifecycleLog(`[timeline] sync feature: enabled=${this.versionControlSettings.enabled}`);
        if (!this.versionControlSettings.enabled) {
            this.disableVersionControlFeature();
            return;
        }
        this.enableVersionControlFeature();
    }

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

    registerVersionControlIcon() {
        if (this.versionControlIconRegistered) return;
        const addIcons = (this.plugin as any).addIcons;
        if (typeof addIcons !== "function") return;
        addIcons.call(this.plugin, VERSION_CONTROL_ICON_SYMBOLS);
        this.versionControlIconRegistered = true;
    }

    private registerVersionControlCommand() {
        if (!this.versionControlSettingsLoaded) return;
        if (this.versionControlCommandRegistered) return;
        const addCommand = (this.plugin as any).addCommand;
        if (typeof addCommand !== "function") return;
        addCommand.call(this.plugin, {
            langKey: "openSnapshotVersionControl",
            langText: this.plugin.i18n?.timeline_open_command || "打开文档快照",
            hotkey: "",
            callback: () => this.openVersionControl(),
            editorCallback: (protyle: any) => this.openVersionControl(protyle),
        });
        this.versionControlCommandRegistered = true;
    }

    private unregisterVersionControlCommand() {
        if (!this.versionControlCommandRegistered) return;
        const commands = (this.plugin as any).commands;
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

        const addDock = (this.plugin as any).addDock;
        if (typeof addDock !== "function") return;
        const registration = addDock.call(this.plugin, {
            config: {
                position: SNAPSHOT_DOCK_POSITION,
                size: { width: 320, height: 0 },
                icon: SNAPSHOT_ICON_ID,
                title: this.plugin.i18n?.snapshot_dock_title || "文档快照",
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

        const addDock = (this.plugin as any).addDock;
        if (typeof addDock !== "function") return;
        const registration = addDock.call(this.plugin, {
            config: {
                position: VERSION_CONTROL_DOCK_POSITION,
                size: { width: 720, height: 0 },
                icon: VERSION_CONTROL_ICON_ID,
                title: this.plugin.i18n?.diff_dock_title || "文档 Diff",
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
            this.plugin.name ? `${this.plugin.name}${type}` : "",
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

        const pluginDocks = (this.plugin as any).docks;
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
                i18n: this.plugin.i18n ?? {},
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
                i18n: this.plugin.i18n ?? {},
                onOpenSnapshot: () => this.showSnapshotDock(),
            },
        });
    }

    private registerVersionControlEvents() {
        if (!this.versionControlSettingsLoaded) return;
        if (!this.versionControlSettings.enabled || this.versionControlEventsRegistered) return;
        const eventBus = (this.plugin as any).eventBus;
        if (typeof eventBus?.on !== "function") return;
        eventBus.on("switch-protyle", this.handleVersionControlProtyleChange as any);
        eventBus.on("loaded-protyle-dynamic", this.handleVersionControlProtyleChange as any);
        eventBus.on("loaded-protyle-static", this.handleVersionControlProtyleChange as any);
        this.versionControlEventsRegistered = true;
    }

    unregisterVersionControlEvents() {
        if (!this.versionControlEventsRegistered) return;
        const eventBus = (this.plugin as any).eventBus;
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

    updateVersionControlDocument(context: CurrentDocumentContext, options: { force?: boolean } = {}) {
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

    unmountVersionControlDocks() {
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
            this.plugin.name ? `${this.plugin.name}${fallbackType}` : "",
            fallbackType,
        ].filter((value, index, values): value is string => (
            typeof value === "string" && value.length > 0 && values.indexOf(value) === index
        ));
    }

    private removeVersionControlDockRegistry(dockTypes: string[], layout: any) {
        const pluginDocks = (this.plugin as any).docks;
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
