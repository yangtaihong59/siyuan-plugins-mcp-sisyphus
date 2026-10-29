<!--
 Copyright (c) 2023 by frostime All Rights Reserved.
 Author       : frostime
 Date         : 2023-07-01 19:23:50
 FilePath     : /src/ui/shared/setting-panel.svelte
 LastEditTime : 2024-08-09 21:41:07
 Description  : 
-->
<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import Form from './Form';

    export let group: string;
    export let settingItems: ISettingItem[];
    export let display: boolean = true;

    const dispatch = createEventDispatcher();

    function onClick( {detail}) {
        dispatch("click", { key: detail.key });
    }
    function onChanged( {detail}) {
        dispatch("changed", {group: group, ...detail});
    }

    $: fn__none = display ? "" : "fn__none";

</script>

<div class="config__tab-container {fn__none}" data-name={group}>
    <slot />
    {#if settingItems.length > 0}
        <div class="config__settings-card">
            {#each settingItems as item (`${item.key}:${JSON.stringify(item.value)}`)}
                <Form.Wrap
                    title={item.title}
                    description={item.description}
                    direction={item?.direction}
                >
                    {#if item?.children?.length}
                        <div class:config__input-group={item.layout !== "inline"} class:config__inline-group={item.layout === "inline"}>
                            {#if item.layout === "inline"}
                                {#each item.children as child (`${child.key}:${JSON.stringify(child.value)}`)}
                                    <div class="config__inline-child">
                                        <div class="config__child-input">
                                            <Form.Input
                                                type={child.type}
                                                key={child.key}
                                                value={child.value}
                                                fnSize={child?.inputCompact === true ? false : true}
                                                style={child?.inputStyle ?? ""}
                                                placeholder={child?.placeholder}
                                                options={child?.options}
                                                slider={child?.slider}
                                                button={child?.button}
                                                on:click={onClick}
                                                on:changed={onChanged}
                                            />
                                            {#if child.unit}
                                                <span class="config__child-unit">{child.unit}</span>
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                            {/if}
                            <div class="config__main-input">
                                <Form.Input
                                    type={item.type}
                                    key={item.key}
                                    value={item.value}
                                    fnSize={item?.inputCompact === true ? false : true}
                                    style={item?.inputStyle ?? ""}
                                    placeholder={item?.placeholder}
                                    options={item?.options}
                                    slider={item?.slider}
                                    button={item?.button}
                                    on:click={onClick}
                                    on:changed={onChanged}
                                />
                            </div>
                            {#if item.layout !== "inline"}
                                {#each item.children as child (`${child.key}:${JSON.stringify(child.value)}`)}
                                    <div class="config__child-item">
                                        <div class="config__child-meta">
                                            {#if child.title}
                                                <div class="config__child-title">{child.title}</div>
                                            {/if}
                                            {#if child.description}
                                                <div class="b3-label__text">{@html child.description}</div>
                                            {/if}
                                        </div>
                                        <div class="config__child-input">
                                            <Form.Input
                                                type={child.type}
                                                key={child.key}
                                                value={child.value}
                                                fnSize={child?.inputCompact === true ? false : true}
                                                style={child?.inputStyle ?? ""}
                                                placeholder={child?.placeholder}
                                                options={child?.options}
                                                slider={child?.slider}
                                                button={child?.button}
                                                on:click={onClick}
                                                on:changed={onChanged}
                                            />
                                            {#if child.unit}
                                                <span class="config__child-unit">{child.unit}</span>
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                            {/if}
                        </div>
                    {:else}
                        <Form.Input
                            type={item.type}
                            key={item.key}
                            value={item.value}
                            fnSize={item?.inputCompact === true ? false : true}
                            style={item?.inputStyle ?? ""}
                            placeholder={item?.placeholder}
                            options={item?.options}
                            slider={item?.slider}
                            button={item?.button}
                            on:click={onClick}
                            on:changed={onChanged}
                        />
                    {/if}
                </Form.Wrap>
            {/each}
        </div>
    {/if}
</div>

<style>
    .config__tab-container {
        display: flex;
        flex-direction: column;
        gap: var(--mcp-config-section-gap, 14px);
        font-size: 13px;
        line-height: 1.5;
    }

    .config__settings-card {
        background: var(--mcp-config-surface, var(--b3-theme-surface));
        border: 1px solid var(--mcp-config-border, var(--b3-border-color));
        border-radius: var(--mcp-config-card-radius, 10px);
        box-shadow: var(--mcp-config-shadow, none);
        overflow: hidden;
    }

    .config__input-group {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
        min-width: 260px;
    }

    .config__main-input {
        display: flex;
        justify-content: flex-end;
        width: 100%;
    }

    .config__inline-group {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
    }

    .config__child-item {
        width: 100%;
        padding-top: 10px;
        border-top: 1px dashed var(--b3-border-color);
    }

    .config__child-meta {
        margin-bottom: 8px;
        text-align: left;
    }

    .config__child-title {
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: var(--mcp-config-title-font-size, 14px);
        font-weight: var(--mcp-config-title-font-weight, 500);
        margin-bottom: 4px;
    }

    /* Overrides SiYuan's 14px !important, as in form-wrap. */
    .config__child-meta .b3-label__text {
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        font-size: 12px !important;
        line-height: 1.55;
    }

    .config__child-input {
        display: flex;
        justify-content: flex-end;
    }

    .config__inline-child {
        display: flex;
        align-items: center;
        padding: 0;
        border-top: none;
    }

    .config__inline-child .config__child-input {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 6px;
    }

    .config__inline-child .config__child-input :global(input[type="number"]) {
        width: 72px;
        min-width: 72px;
    }

    .config__child-unit {
        color: var(--b3-theme-on-surface-light);
        font-size: 0.9em;
    }

    @media (max-width: 960px) {
        .config__inline-group {
            justify-content: flex-start;
        }

        .config__main-input {
            width: auto;
        }
    }

    @media (max-width: 768px) {
        .config__input-group {
            align-items: stretch;
            min-width: auto;
            width: 100%;
        }

        .config__main-input {
            justify-content: flex-end;
            width: 100%;
        }

        .config__child-input {
            justify-content: flex-end;
            width: 100%;
        }

        .config__inline-group {
            flex-wrap: wrap;
        }
    }
</style>
