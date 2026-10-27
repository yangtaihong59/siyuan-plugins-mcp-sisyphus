import ToolPuppy from "@/ui/components/ToolPuppy.svelte";
import { buildDefaultPuppySettings, type PuppySettings } from "@/ui/setting/tool-config-storage";

const PUPPY_ROOT_ID = "sy-puppy-root";

/** The desktop mascot overlay; mounted once both its settings and the layout are ready. */
export class PuppyFeature {
    private puppyComponent: ToolPuppy | null = null;
    private puppyContainer: HTMLElement | null = null;
    puppySettings: PuppySettings = buildDefaultPuppySettings();
    puppySettingsLoaded = false;

    mountPuppy() {
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

    unmountPuppy() {
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
}
