<script lang="ts">
    import SettingPanel from "../../shared/setting-panel.svelte";

    export let group: string;
    export let display = false;
    export let notebooks: NotebookInfo[] = [];
    export let permissions: Record<string, NotebookPermission> = {};
    export let permLoading = true;
    export let getLabel: (key: string, fallback: string) => string;
    export let onChanged: (event: CustomEvent<ChangeEvent>) => void | Promise<void>;

    interface NotebookInfo { id: string; name: string; }
    interface ChangeEvent { key: string; value: any; }
    type NotebookPermission = 'none' | 'r' | 'rw' | 'rwd';

    function buildPermItems(): ISettingItem[] {
        if (notebooks.length === 0) {
            return [{
                type: "hint",
                key: "perm__hint",
                value: permLoading ? getLabel("mcpPermLoading", "Loading notebooks...") : getLabel("mcpPermEmpty", "No notebooks found."),
                title: "",
                description: "",
            }];
        }

        return notebooks.map((nb) => ({
            type: "select",
            key: `perm__${nb.id}`,
            value: permissions[nb.id] ?? "r",
            title: nb.name,
            description: getLabel("mcpPermDesc", "MCP 访问权限：无权限 / 只读 / 读写不可删除 / 读写可删除"),
            options: {
                none: getLabel("mcpPermNone", "禁止访问"),
                r: getLabel("mcpPermRead", "只读"),
                rw: getLabel("mcpPermReadWrite", "读写不可删除"),
                rwd: getLabel("mcpPermReadWriteDelete", "读写可删除"),
            },
        }));
    }

    let permItems: ISettingItem[] = [];

    $: {
        notebooks;
        permissions;
        permLoading;
        getLabel;
        permItems = buildPermItems();
    }
</script>

<SettingPanel {group} settingItems={permItems} {display} on:changed={onChanged} />
