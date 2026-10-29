<!--
 Copyright (c) 2024 by frostime. All Rights Reserved.
 Author       : frostime
 Date         : 2024-06-01 20:03:50
 FilePath     : /src/ui/shared/Form/form-wrap.svelte
 LastEditTime : 2024-07-19 15:28:57
 Description  : The setting item container
-->
<script lang="ts">
    export let title: string; // Displayint Setting Title
    export let description: string; // Displaying Setting Text
    export let direction: 'row' | 'column' = 'column';
</script>

{#if direction === "row"}
    <div class="item-wrap b3-label" data-key="CustomCSS">
        <div class="fn__block">
            <span class="title">{title}</span>
            {#if description}
                <div class="b3-label__text">{@html description}</div>
            {/if}
            <div class="fn__hr"></div>
            <div style="display: flex; flex-direction: column; gap: 5px; position: relative;">
                <slot />
            </div>
        </div>
    </div>
{:else}
    <div class="item-wrap fn__flex b3-label config__item">
        <div class="fn__flex-1">
            <span class="title">{title}</span>
            {#if description}
                <div class="b3-label__text">
                    {@html description}
                </div>
            {/if}
        </div>
        <span class="fn__space" />
        <slot />
    </div>
{/if}

<style>
    span.title {
        display: block;
        color: var(--mcp-config-title-color, var(--b3-theme-on-background));
        font-size: var(--mcp-config-title-font-size, 14px);
        font-weight: var(--mcp-config-title-font-weight, 500);
        line-height: 1.5;
    }

    .item-wrap.b3-label {
        box-sizing: border-box;
        display: flex;
        height: auto;
        min-height: 0;
        max-height: none;
        overflow: visible;
        width: 100%;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none !important;
        padding: var(--mcp-config-card-padding, 16px 18px);
        margin: 0;
        transition: background 0.14s ease;
    }

    .item-wrap.b3-label:not(:last-child) {
        border-bottom: 1px solid var(--mcp-config-border, var(--b3-border-color));
    }

    .item-wrap.b3-label:hover {
        background: color-mix(in srgb, var(--b3-list-hover) 46%, transparent);
    }

    .item-wrap.fn__flex {
        align-items: flex-start;
        gap: 24px;
    }

    .item-wrap.fn__flex > .fn__flex-1 {
        min-width: 0;
    }

    .item-wrap.fn__flex > .fn__space {
        flex: 0 0 auto;
        width: 0;
        min-width: 0;
    }

    /* SiYuan's base.css sets .b3-label__text to 14px !important; keep the settings caption size. */
    .b3-label__text {
        margin-top: 4px;
        color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
        font-size: 12px !important;
        line-height: 1.55;
    }

    @media (max-width: 768px) {
        .item-wrap.fn__flex {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
        }
        .item-wrap.b3-label {
            padding: 13px 14px;
        }
        .item-wrap.fn__flex > .fn__space {
            display: none;
        }
    }
</style>
