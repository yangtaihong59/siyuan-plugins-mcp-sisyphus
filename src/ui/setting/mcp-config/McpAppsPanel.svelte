<script lang="ts">
    import type { McpAppsConfig, ToolConfig } from "@/core/config";

    export let display = false;
    export let config: ToolConfig;
    export let getLabel: (key: string, fallback: string) => string;
    export let onChanged: (event: CustomEvent<{ key: string; value: any }>) => void | Promise<void>;

    const definitions: Array<{
        key: keyof McpAppsConfig;
        icon: string;
        title: string;
        description: string;
        actions: Array<{ key: string; title: string; description: string }>;
    }> = [
        {
            key: "timeline", icon: "🕓", title: "文档时间线",
            description: "AI 只负责打开界面；节点浏览、比较与回退由你在 App 中执行。",
            actions: [
                { key: "list_nodes", title: "列出节点", description: "在 App 中刷新全局或文档时间线。" },
                { key: "compare_node", title: "比较节点", description: "在同一界面查看历史版本 Diff。" },
                { key: "create_node", title: "创建节点", description: "手动创建全局或文档快照节点。" },
                { key: "delete_node", title: "删除节点", description: "移除节点标签并保留底层快照。" },
                { key: "rollback_document", title: "回退整个文档", description: "由用户确认后恢复历史文档。" },
                { key: "rollback_block", title: "恢复单个块", description: "由用户在 Diff 中选择需要恢复的块。" },
            ],
        },
        {
            key: "flashcardReview", icon: "🃏", title: "闪卡复习",
            description: "AI 选择本轮卡片，答案揭示与评分只在复习 App 中完成。",
            actions: [{ key: "review_card", title: "提交复习评分", description: "允许 App 写入重来、困难、良好、简单或跳过结果。" }],
        },
        {
            key: "mascotShop", icon: "🐾", title: "猫猫商店",
            description: "AI 只负责打开商店；刷新、选择和购买均由你操作。",
            actions: [
                { key: "get_balance", title: "读取余额", description: "允许 App 显示当前金币。" },
                { key: "shop", title: "刷新商品", description: "允许 App 加载商品与最新余额。" },
                { key: "buy", title: "购买商品", description: "允许用户在 App 中消费金币。" },
            ],
        },
    ];

    function change(key: string, value: boolean) {
        void onChanged(new CustomEvent("changed", { detail: { key, value } }));
    }
</script>

<div class="apps-page" class:fn__none={!display}>
    <div class="apps-note">
        <strong>{getLabel("mcpAppsPermissionTitle", "人工操作权限与 AI 权限相互独立")}</strong>
        <span>{getLabel("mcpAppsPermissionDesc", "这里的开关只控制 MCP App 及人在 App 中执行的操作；AI 直调权限仍在 Tool 设置页管理。")}</span>
    </div>
    <div class="apps-grid">
        {#each definitions as definition}
            <section class="app-card" class:app-card--disabled={!config.mcpApps[definition.key].enabled}>
                <header>
                    <span class="app-card__icon" aria-hidden="true">{definition.icon}</span>
                    <div><h3>{getLabel(`mcpApp_${definition.key}_title`, definition.title)}</h3><p>{getLabel(`mcpApp_${definition.key}_desc`, definition.description)}</p></div>
                    <label class="switch" title={getLabel("mcpAppEnabled", "启用 App")}>
                        <input type="checkbox" checked={config.mcpApps[definition.key].enabled} on:change={(event) => change(`mcpApps__${definition.key}__enabled`, event.currentTarget.checked)} />
                        <span></span>
                    </label>
                </header>
                <div class="app-actions">
                    {#each definition.actions as action}
                        <label class="app-action">
                            <span><strong>{getLabel(`mcpApp_${definition.key}_${action.key}`, action.title)}</strong><small>{getLabel(`desc_mcpApp_${definition.key}_${action.key}`, action.description)}</small></span>
                            <input type="checkbox" disabled={!config.mcpApps[definition.key].enabled} checked={Boolean(config.mcpApps[definition.key].actions[action.key])} on:change={(event) => change(`mcpApps__${definition.key}__action__${action.key}`, event.currentTarget.checked)} />
                        </label>
                    {/each}
                </div>
            </section>
        {/each}
    </div>
</div>

<style>
    .apps-page,.apps-grid{display:flex;flex-direction:column;gap:16px}.apps-page{max-width:var(--mcp-config-content-max-width,920px)}.apps-note{background:var(--mcp-config-primary-soft);border:1px solid var(--mcp-config-primary-border);border-radius:var(--mcp-config-card-radius);display:flex;flex-direction:column;gap:4px;padding:14px 16px}.apps-note span,.app-card p,.app-action small{color:var(--mcp-config-caption-color);font-size:12px;line-height:1.55}.app-card{background:var(--mcp-config-surface-raised);border:1px solid var(--mcp-config-border);border-radius:var(--mcp-config-card-radius);box-shadow:var(--mcp-config-shadow);overflow:hidden}.app-card--disabled{opacity:.72}.app-card header{align-items:flex-start;display:grid;gap:12px;grid-template-columns:40px 1fr auto;padding:17px 19px}.app-card__icon{align-items:center;background:var(--mcp-config-primary-soft);border-radius:10px;display:flex;font-size:21px;height:40px;justify-content:center;width:40px}.app-card h3{font-size:14px;margin:1px 0 4px}.app-card p{margin:0}.app-actions{border-top:1px solid var(--mcp-config-border);display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.app-action{align-items:center;border-bottom:1px solid var(--mcp-config-border);display:flex;gap:12px;justify-content:space-between;padding:12px 19px}.app-action:nth-child(odd){border-right:1px solid var(--mcp-config-border)}.app-action span{display:flex;flex-direction:column;gap:2px}.app-action strong{font-size:13px}.app-action input{accent-color:var(--b3-theme-primary);flex:0 0 auto}.switch input{position:absolute;opacity:0}.switch span{background:var(--b3-border-color);border-radius:20px;cursor:pointer;display:block;height:22px;position:relative;width:40px}.switch span:after{background:white;border-radius:50%;content:"";height:16px;left:3px;position:absolute;top:3px;transition:.18s;width:16px}.switch input:checked+span{background:var(--b3-theme-primary)}.switch input:checked+span:after{transform:translateX(18px)}@media(max-width:560px){.app-actions{grid-template-columns:1fr}.app-action:nth-child(odd){border-right:0}.app-card header{grid-template-columns:36px 1fr auto;padding:14px}.app-card__icon{height:36px;width:36px}.app-action{padding:11px 14px}}
</style>
