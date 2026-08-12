<script lang="ts">
    import SettingPanel from "../../shared/setting-panel.svelte";
    import type { PermissionDisplaySettings } from "../tool-config-storage";

    export let group: string;
    export let display = false;
    export let notebooks: NotebookInfo[] = [];
    export let permissions: Record<string, NotebookPermission> = {};
    export let permissionDisplaySettings: PermissionDisplaySettings;
    export let permLoading = true;
    export let getLabel: (key: string, fallback: string) => string;
    export let onChanged: (event: CustomEvent<ChangeEvent>) => void | Promise<void>;

    interface NotebookInfo { id: string; name: string; closed?: boolean; }
    interface ChangeEvent { key: string; value: any; }
    type NotebookPermission = 'none' | 'r' | 'rw' | 'rwd';

    const permissionBadgeOrder: NotebookPermission[] = ["r", "rw", "rwd", "none"];

    function buildPermissionTreeDescription(): string {
        const badges = permissionBadgeOrder
            .map((permission) => `<span class="sisyphus-permission-badge" data-permission="${permission}">${permission.toUpperCase()}</span>`)
            .join("");
        const description = getLabel(
            "permission_tree_show_desc",
            "显示在每个笔记本根节点旁；子文档继承笔记本权限。",
        );
        return `<span class="sisyphus-permission-badge-list">${badges}</span><span>${description}</span>`;
    }

    function buildNotebookItem(nb: NotebookInfo): ISettingItem {
        return {
            type: "select",
            key: `perm__${nb.id}`,
            value: permissions[nb.id] ?? "r",
            title: nb.name,
            description: "",
            options: {
                none: getLabel("mcpPermNone", "禁止访问"),
                r: getLabel("mcpPermRead", "只读"),
                rw: getLabel("mcpPermReadWrite", "读写不可删除"),
                rwd: getLabel("mcpPermReadWriteDelete", "读写可删除"),
            },
        };
    }

    function buildPermItems(): ISettingItem[] {
        const items: ISettingItem[] = [
            {
                type: "checkbox",
                key: "permissionDisplay__showInFileTree",
                value: permissionDisplaySettings.showInFileTree,
                title: getLabel("permission_tree_show_title", "在文件树显示 MCP 权限"),
                description: buildPermissionTreeDescription(),
            },
        ];

        if (notebooks.length === 0) {
            items.push({
                type: "hint",
                key: "perm__hint",
                value: permLoading ? getLabel("mcpPermLoading", "Loading notebooks...") : getLabel("mcpPermEmpty", "No notebooks found."),
                title: "",
                description: "",
            });
            return items;
        }

        return [...items, ...notebooks.filter((nb) => !nb.closed).map(buildNotebookItem)];
    }

    function buildClosedPermItems(): ISettingItem[] {
        return notebooks.filter((nb) => nb.closed).map(buildNotebookItem);
    }

    let permItems: ISettingItem[] = [];
    let closedPermItems: ISettingItem[] = [];
    let permissionCounts: Record<NotebookPermission, number> = { none: 0, r: 0, rw: 0, rwd: 0 };

    $: {
        notebooks;
        permissions;
        permissionDisplaySettings;
        permLoading;
        getLabel;
        permItems = buildPermItems();
        closedPermItems = buildClosedPermItems();
        permissionCounts = notebooks
            .filter((notebook) => !notebook.closed)
            .reduce<Record<NotebookPermission, number>>((counts, notebook) => {
                counts[permissions[notebook.id] ?? "r"] += 1;
                return counts;
            }, { none: 0, r: 0, rw: 0, rwd: 0 });
    }
</script>

{#if display && !permLoading && notebooks.length > 0}
    <section class="permission-overview" aria-label={getLabel("mcpPermOverview", "Permission overview")}>
        <div class="permission-overview__copy">
            <strong>{getLabel("mcpPermOverview", "Permission overview")}</strong>
            <span>{getLabel("mcpPermOverviewDesc", "Current access levels for open notebooks. Unconfigured notebooks default to read-only.")}</span>
        </div>
        <div class="permission-overview__stats">
            <span data-permission="r"><b>{permissionCounts.r}</b>{getLabel("mcpPermRead", "Read only")}</span>
            <span data-permission="rw"><b>{permissionCounts.rw}</b>{getLabel("mcpPermReadWrite", "Read/write")}</span>
            <span data-permission="rwd"><b>{permissionCounts.rwd}</b>{getLabel("mcpPermReadWriteDelete", "Read/write/delete")}</span>
            <span data-permission="none"><b>{permissionCounts.none}</b>{getLabel("mcpPermNone", "No access")}</span>
        </div>
    </section>
{/if}
<SettingPanel {group} settingItems={permItems} {display} on:changed={onChanged} />
{#if display && closedPermItems.length > 0}
    <details class="closed-notebooks">
        <summary>
            {getLabel("mcpPermClosedGroup", "已关闭笔记本")} ({closedPermItems.length})
        </summary>
        <SettingPanel group={`${group}__closed`} settingItems={closedPermItems} display={true} on:changed={onChanged} />
    </details>
{/if}

<style>
    .permission-overview {
        align-items: center;
        background: var(--mcp-config-surface-accent, var(--mcp-config-surface-raised, var(--b3-theme-surface)));
        border: 1px solid var(--mcp-config-border, var(--b3-border-color));
        border-radius: var(--mcp-config-card-radius, 10px);
        box-shadow: var(--mcp-config-shadow, none);
        display: flex;
        gap: 18px;
        justify-content: space-between;
        margin-bottom: var(--mcp-config-section-gap, 14px);
        padding: var(--mcp-config-card-padding, 16px 18px);
    }

    .permission-overview__copy {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
    }

    .permission-overview__copy strong {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: 14px;
        font-weight: var(--mcp-config-title-font-weight, 600);
    }

    .permission-overview__copy span {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        font-size: 12px;
        line-height: 1.5;
    }

    .permission-overview__stats {
        display: grid;
        flex: 0 0 auto;
        gap: 6px;
        grid-template-columns: repeat(4, minmax(58px, auto));
    }

    .permission-overview__stats > span {
        align-items: center;
        background: color-mix(in srgb, var(--b3-theme-primary) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--b3-theme-primary) 18%, transparent);
        border-radius: var(--mcp-config-control-radius, 8px);
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        display: flex;
        flex-direction: column;
        font-size: 10px;
        line-height: 1.25;
        min-height: 46px;
        padding: 5px 7px;
        text-align: center;
    }

    .permission-overview__stats b {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: 15px;
        font-weight: 650;
    }

    .permission-overview__stats [data-permission="none"] {
        background: color-mix(in srgb, var(--b3-theme-error) 8%, transparent);
        border-color: color-mix(in srgb, var(--b3-theme-error) 20%, transparent);
    }

    .permission-overview__stats [data-permission="rwd"] {
        background: color-mix(in srgb, var(--b3-theme-success, var(--b3-theme-primary)) 9%, transparent);
        border-color: color-mix(in srgb, var(--b3-theme-success, var(--b3-theme-primary)) 20%, transparent);
    }

    .closed-notebooks {
        background: var(--mcp-config-surface, var(--b3-theme-surface));
        border: 1px solid var(--mcp-config-border, var(--b3-border-color));
        border-radius: var(--mcp-config-card-radius, 10px);
        margin-top: var(--mcp-config-section-gap, 14px);
        overflow: hidden;
    }

    .closed-notebooks > summary {
        box-sizing: border-box;
        color: var(--b3-theme-on-surface);
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        line-height: 36px;
        list-style: revert;
        min-height: 32px;
        padding: 6px 16px;
        user-select: none;
    }

    .closed-notebooks[open] > summary {
        border-bottom: 1px solid var(--mcp-config-border, var(--b3-border-color));
    }

    .closed-notebooks :global(.config__settings-card) {
        border: 0;
        border-radius: 0;
        box-shadow: none;
    }

    @media (max-width: 768px) {
        .permission-overview {
            align-items: stretch;
            flex-direction: column;
        }

        .permission-overview__stats {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
