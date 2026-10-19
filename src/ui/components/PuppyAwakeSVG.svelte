<script lang="ts">
    import PuppyResultOverlay, { type ResultState } from './PuppyResultOverlay.svelte';
    import type { PuppyState } from './puppy-tool-visuals';

    export let state: PuppyState = 'idle';
    export let resultState: ResultState = 'none';
    export let eyeState: 'blink' | 'happy' | 'sad' | 'danger' | 'flat' | 'normal' = 'normal';
    export let balance = 0;
    export let bodyColor = '#4a7fff';
    export let pawColor = '#3060d0';
    export let eyeColor = '#1a1f3c';

    $: appearanceStyle = [
        `--sy-puppy-body-color: ${bodyColor}`,
        `--sy-puppy-paw-color: ${pawColor}`,
        `--sy-puppy-eye-color: ${eyeColor}`,
    ].join('; ');
</script>

    <div class="sy-puppy__char" style={appearanceStyle}>
        <svg viewBox="0 0 96 96" width="52" height="52" xmlns="http://www.w3.org/2000/svg" overflow="visible">
            <g class="sy-puppy__cat">
                <rect x="18" y="0" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="0" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="6" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="6" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="6" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="6" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="0" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="0" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="6" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="6" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="6" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="6" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="12" width="6" height="6" fill="#4a7fff"/>
                <rect x="6" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="84" y="18" width="6" height="6" fill="#4a7fff"/>
                <rect x="6" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="84" y="24" width="6" height="6" fill="#4a7fff"/>
                <rect x="6" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="84" y="30" width="6" height="6" fill="#4a7fff"/>
                <rect x="6" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="84" y="36" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="42" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="48" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="54" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="60" width="6" height="6" fill="#4a7fff"/>
                <rect x="12" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="24" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="30" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="36" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="42" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="48" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="54" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="60" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="66" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="72" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="78" y="66" width="6" height="6" fill="#4a7fff"/>
                <rect x="18" y="72" width="6" height="6" fill="#3060d0" class="sy-puppy__paw sy-puppy__paw--left"/>
                <rect x="24" y="72" width="6" height="6" fill="#3060d0" class="sy-puppy__paw sy-puppy__paw--left"/>
                <rect x="18" y="78" width="6" height="6" fill="#3060d0" class="sy-puppy__paw sy-puppy__paw--left"/>
                <rect x="24" y="78" width="6" height="6" fill="#3060d0" class="sy-puppy__paw sy-puppy__paw--left"/>
                <rect x="66" y="72" width="6" height="6" fill="#3060d0" class="sy-puppy__paw sy-puppy__paw--right"/>
                <rect x="72" y="72" width="6" height="6" fill="#3060d0" class="sy-puppy__paw sy-puppy__paw--right"/>
                <rect x="66" y="78" width="6" height="6" fill="#3060d0" class="sy-puppy__paw sy-puppy__paw--right"/>
                <rect x="72" y="78" width="6" height="6" fill="#3060d0" class="sy-puppy__paw sy-puppy__paw--right"/>
                <g class="sy-puppy__tail-chain">
                    <rect x="84" y="60" width="6" height="6" fill="#4a7fff" class="sy-puppy__tail-root"/>
                    <g class="sy-puppy__tail sy-puppy__tail--2">
                        <rect x="84" y="66" width="6" height="6" fill="#4a7fff"/>
                        <g class="sy-puppy__tail sy-puppy__tail--3">
                            <rect x="90" y="72" width="6" height="6" fill="#4a7fff"/>
                        </g>
                    </g>
                </g>

                <g class="sy-puppy__eyes">
                    {#if eyeState === 'blink'}
                        <rect x="18" y="24" width="12" height="3" fill="#1a1f3c"/>
                        <rect x="66" y="24" width="12" height="3" fill="#1a1f3c"/>
                    {:else if eyeState === 'happy'}
                        <rect x="20" y="20" width="8" height="4" fill="#1a1f3c"/>
                        <rect x="68" y="20" width="8" height="4" fill="#1a1f3c"/>
                    {:else if eyeState === 'sad'}
                        <rect x="20" y="28" width="8" height="4" fill="#1a1f3c"/>
                        <rect x="68" y="28" width="8" height="4" fill="#1a1f3c"/>
                    {:else if eyeState === 'danger'}
                        <line x1="18" y1="24" x2="30" y2="36" stroke="#1a1f3c" stroke-width="3" class="sy-puppy__eye-x"/>
                        <line x1="30" y1="24" x2="18" y2="36" stroke="#1a1f3c" stroke-width="3" class="sy-puppy__eye-x"/>
                        <line x1="66" y1="24" x2="78" y2="36" stroke="#1a1f3c" stroke-width="3" class="sy-puppy__eye-x"/>
                        <line x1="78" y1="24" x2="66" y2="36" stroke="#1a1f3c" stroke-width="3" class="sy-puppy__eye-x"/>
                    {:else if eyeState === 'flat'}
                        <rect x="18" y="27" width="12" height="2" fill="#1a1f3c"/>
                        <rect x="66" y="27" width="12" height="2" fill="#1a1f3c"/>
                    {:else}
                        <rect x="18" y="24" width="6" height="6" fill="#1a1f3c"/>
                        <rect x="24" y="24" width="6" height="6" fill="#1a1f3c"/>
                        <rect x="66" y="24" width="6" height="6" fill="#1a1f3c"/>
                        <rect x="72" y="24" width="6" height="6" fill="#1a1f3c"/>
                    {/if}
                </g>
                <g class="sy-puppy__idle-detail sy-puppy__idle-yawn-mouth" aria-hidden="true">
                    <rect x="42" y="39" width="12" height="12" rx="3" fill="#1a1f3c"/>
                    <rect x="45" y="46" width="6" height="3" rx="1" fill="#ff8fa3"/>
                </g>
            </g>

            <g class="sy-puppy__tools">
                <g class="sy-puppy__prop sy-puppy__tool sy-puppy__tool--notebook">
                    <rect x="-42" y="24" width="30" height="36" rx="3" fill="#6f7cff" stroke="#1a1f3c" stroke-width="2"/>
                    <rect x="-14" y="24" width="4" height="36" rx="1.5" fill="#4d5ce0" stroke="#1a1f3c" stroke-width="1"/>
                    <line x1="-34" y1="34" x2="-22" y2="34" stroke="#dfe4ff" stroke-width="2"/>
                    <line x1="-34" y1="41" x2="-20" y2="41" stroke="#dfe4ff" stroke-width="2"/>
                    <line x1="-34" y1="48" x2="-22" y2="48" stroke="#dfe4ff" stroke-width="2"/>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--notebook-create sy-puppy__tool-mark--notebook-open">
                        <line x1="-36" y1="28" x2="-28" y2="28" stroke="#c4ff72" stroke-width="2"/>
                        <line x1="-32" y1="24" x2="-32" y2="32" stroke="#c4ff72" stroke-width="2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--notebook-close sy-puppy__tool-mark--notebook-remove">
                        <line x1="-36" y1="26" x2="-28" y2="34" stroke="#ff9aa8" stroke-width="2"/>
                        <line x1="-28" y1="26" x2="-36" y2="34" stroke="#ff9aa8" stroke-width="2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--notebook-rename sy-puppy__tool-mark--notebook-set_icon">
                        <rect x="-37" y="26" width="8" height="8" fill="#ffd040" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--notebook-list sy-puppy__tool-mark--notebook-get_child_docs">
                        <line x1="-38" y1="27" x2="-27" y2="27" stroke="#fff" stroke-width="2"/>
                        <line x1="-38" y1="31" x2="-27" y2="31" stroke="#fff" stroke-width="2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--notebook-get_conf sy-puppy__tool-mark--notebook-set_conf">
                        <circle cx="-33" cy="30" r="4" fill="#d9f4ff" stroke="#1a1f3c" stroke-width="1"/>
                        <rect x="-34.5" y="25" width="3" height="2" fill="#1a1f3c"/>
                        <rect x="-34.5" y="33" width="3" height="2" fill="#1a1f3c"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--notebook-get_permissions sy-puppy__tool-mark--notebook-set_permission">
                        <rect x="-37" y="25" width="8" height="9" fill="#ffd040" stroke="#1a1f3c" stroke-width="1"/>
                        <path d="M-35 25v-2a2 2 0 0 1 4 0v2" fill="none" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                </g>

                <g class="sy-puppy__prop sy-puppy__tool sy-puppy__tool--document">
                    <rect x="-42" y="4" width="28" height="34" fill="#fff" stroke="#1a1f3c" stroke-width="2"/>
                    <polygon points="-22,4 -14,12 -22,12" fill="#d7ddea"/>
                    <line x1="-36" y1="16" x2="-20" y2="16" stroke="#b0b8d0" stroke-width="2"/>
                    <line x1="-36" y1="24" x2="-19" y2="24" stroke="#b0b8d0" stroke-width="2"/>
                    <line x1="-36" y1="32" x2="-22" y2="32" stroke="#b0b8d0" stroke-width="2"/>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--document-create sy-puppy__tool-mark--document-create_daily_note">
                        <rect x="-39" y="7" width="10" height="10" fill="#c4ff72" stroke="#1a1f3c" stroke-width="1"/>
                        <line x1="-34" y1="9" x2="-34" y2="15" stroke="#1a1f3c" stroke-width="1.4"/>
                        <line x1="-37" y1="12" x2="-31" y2="12" stroke="#1a1f3c" stroke-width="1.4"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--document-search_docs sy-puppy__tool-mark--document-get_doc">
                        <circle cx="-33" cy="12" r="4" fill="#d9f4ff" stroke="#1a1f3c" stroke-width="1"/>
                        <line x1="-30" y1="15" x2="-27" y2="18" stroke="#1a1f3c" stroke-width="1.5"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--document-move sy-puppy__tool-mark--document-rename">
                        <line x1="-37" y1="11" x2="-29" y2="11" stroke="#ff9500" stroke-width="2"/>
                        <polygon points="-30,8 -26,11 -30,14" fill="#ff9500"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--document-remove">
                        <line x1="-37" y1="8" x2="-29" y2="16" stroke="#ff4d6d" stroke-width="2"/>
                        <line x1="-29" y1="8" x2="-37" y2="16" stroke="#ff4d6d" stroke-width="2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--document-resolve">
                        <circle cx="-34" cy="12" r="3" fill="#8fd2ff" stroke="#1a1f3c" stroke-width="1"/>
                        <line x1="-31" y1="15" x2="-28" y2="18" stroke="#1a1f3c" stroke-width="1.5"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--document-get_child_blocks sy-puppy__tool-mark--document-get_child_docs sy-puppy__tool-mark--document-list_tree">
                        <line x1="-38" y1="9" x2="-34" y2="9" stroke="#17b26a" stroke-width="1.5"/>
                        <line x1="-36" y1="9" x2="-36" y2="18" stroke="#17b26a" stroke-width="1.5"/>
                        <line x1="-36" y1="14" x2="-31" y2="14" stroke="#17b26a" stroke-width="1.5"/>
                        <line x1="-36" y1="18" x2="-31" y2="18" stroke="#17b26a" stroke-width="1.5"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--document-set_attr">
                        <rect x="-39" y="7" width="11" height="8" fill="#ffd040" stroke="#1a1f3c" stroke-width="1"/>
                        <polygon points="-38,14 -35,10 -32,13 -29,9 -28,15 -39,15" fill="#4a7fff"/>
                    </g>
                </g>

                <g class="sy-puppy__prop sy-puppy__tool sy-puppy__tool--block">
                    <rect x="8" y="-34" width="20" height="10" fill="#ff9500" stroke="#1a1f3c" stroke-width="1.5"/>
                    <rect x="28" y="-34" width="20" height="10" fill="#e08000" stroke="#1a1f3c" stroke-width="1.5"/>
                    <rect x="18" y="-24" width="20" height="10" fill="#ffb74d" stroke="#1a1f3c" stroke-width="1.5"/>
                    <rect x="38" y="-24" width="20" height="10" fill="#ff9500" stroke="#1a1f3c" stroke-width="1.5"/>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-insert sy-puppy__tool-mark--block-prepend sy-puppy__tool-mark--block-append">
                        <rect x="44" y="-41" width="10" height="10" fill="#c4ff72" stroke="#1a1f3c" stroke-width="1"/>
                        <line x1="49" y1="-39" x2="49" y2="-33" stroke="#1a1f3c" stroke-width="1.4"/>
                        <line x1="46" y1="-36" x2="52" y2="-36" stroke="#1a1f3c" stroke-width="1.4"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-update sy-puppy__tool-mark--block-set_attrs">
                        <rect x="44" y="-41" width="10" height="10" fill="#6f7cff" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-delete">
                        <line x1="45" y1="-40" x2="53" y2="-32" stroke="#ff4d6d" stroke-width="2"/>
                        <line x1="53" y1="-40" x2="45" y2="-32" stroke="#ff4d6d" stroke-width="2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-move sy-puppy__tool-mark--block-transfer_references">
                        <line x1="44" y1="-36" x2="54" y2="-36" stroke="#8fd2ff" stroke-width="2"/>
                        <polygon points="51,-39 56,-36 51,-33" fill="#8fd2ff"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-fold sy-puppy__tool-mark--block-unfold">
                        <polygon points="45,-40 53,-40 49,-33" fill="#ffd040" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-get_kramdown sy-puppy__tool-mark--block-dom">
                        <text x="44" y="-33" font-size="8" font-family="monospace" font-weight="700" fill="#6f7cff">MD</text>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-get_children sy-puppy__tool-mark--block-breadcrumb">
                        <line x1="45" y1="-39" x2="49" y2="-39" stroke="#17b26a" stroke-width="1.5"/>
                        <line x1="47" y1="-39" x2="47" y2="-31" stroke="#17b26a" stroke-width="1.5"/>
                        <line x1="47" y1="-35" x2="53" y2="-35" stroke="#17b26a" stroke-width="1.5"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-get_attrs sy-puppy__tool-mark--block-info">
                        <circle cx="49" cy="-36" r="4" fill="#d9f4ff" stroke="#1a1f3c" stroke-width="1"/>
                        <text x="47" y="-33" font-size="6" font-family="monospace" font-weight="700" fill="#1a1f3c">i</text>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--block-exists sy-puppy__tool-mark--block-word_count sy-puppy__tool-mark--block-recent_updated">
                        <circle cx="49" cy="-36" r="4" fill="#c4ff72" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                </g>

                <g class="sy-puppy__prop sy-puppy__tool sy-puppy__tool--av">
                    <rect x="78" y="-28" width="34" height="28" rx="3" fill="#eff4ff" stroke="#1a1f3c" stroke-width="2"/>
                    <rect x="78" y="-28" width="34" height="6" rx="2" fill="#6f7cff" stroke="#1a1f3c" stroke-width="1.5"/>
                    <line x1="89" y1="-22" x2="89" y2="0" stroke="#9db2ff" stroke-width="1.5"/>
                    <line x1="100" y1="-22" x2="100" y2="0" stroke="#9db2ff" stroke-width="1.5"/>
                    <line x1="78" y1="-14" x2="112" y2="-14" stroke="#9db2ff" stroke-width="1.5"/>
                    <line x1="78" y1="-7" x2="112" y2="-7" stroke="#9db2ff" stroke-width="1.5"/>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--av-get sy-puppy__tool-mark--av-search sy-puppy__tool-mark--av-query">
                        <circle cx="106" cy="-22" r="4" fill="#d9f4ff" stroke="#1a1f3c" stroke-width="1"/>
                        <line x1="109" y1="-19" x2="112" y2="-16" stroke="#1a1f3c" stroke-width="1.5"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--av-add_rows sy-puppy__tool-mark--av-duplicate">
                        <rect x="102" y="-27" width="8" height="8" fill="#c4ff72" stroke="#1a1f3c" stroke-width="1"/>
                        <line x1="106" y1="-25" x2="106" y2="-21" stroke="#1a1f3c" stroke-width="1.2"/>
                        <line x1="104" y1="-23" x2="108" y2="-23" stroke="#1a1f3c" stroke-width="1.2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--av-remove_rows sy-puppy__tool-mark--av-remove_column">
                        <line x1="102" y1="-26" x2="110" y2="-18" stroke="#ff4d6d" stroke-width="2"/>
                        <line x1="110" y1="-26" x2="102" y2="-18" stroke="#ff4d6d" stroke-width="2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--av-add_column">
                        <line x1="104" y1="-27" x2="104" y2="-18" stroke="#ffd040" stroke-width="2"/>
                        <line x1="100" y1="-23" x2="108" y2="-23" stroke="#ffd040" stroke-width="2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--av-set_cells">
                        <rect x="102" y="-27" width="8" height="8" fill="#8fd2ff" stroke="#1a1f3c" stroke-width="1"/>
                        <rect x="104" y="-25" width="4" height="4" fill="#1a1f3c"/>
                    </g>
                </g>

                <g class="sy-puppy__prop sy-puppy__tool sy-puppy__tool--file">
                    <rect x="90" y="52" width="32" height="28" fill="#ddeeff" stroke="#1a1f3c" stroke-width="2"/>
                    <rect x="93" y="48" width="26" height="8" fill="#c8dcff" stroke="#1a1f3c" stroke-width="1.5"/>
                    <line x1="98" y1="66" x2="112" y2="66" stroke="#1a1f3c" stroke-width="2.5" stroke-linecap="round"/>
                    <polygon points="110,61 118,66 110,71" fill="#1a1f3c"/>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--file-upload_asset">
                        <line x1="106" y1="75" x2="106" y2="60" stroke="#4a7fff" stroke-width="2.5"/>
                        <polygon points="106,56 101,62 111,62" fill="#4a7fff"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--file-export_md sy-puppy__tool-mark--file-export_resources">
                        <line x1="106" y1="58" x2="106" y2="73" stroke="#17b26a" stroke-width="2.5"/>
                        <polygon points="106,77 101,71 111,71" fill="#17b26a"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--file-render">
                        <text x="97" y="74" font-size="14" font-family="monospace" font-weight="700" fill="#6f7cff">{'{}'}</text>
                    </g>
                </g>

                <g class="sy-puppy__prop sy-puppy__tool sy-puppy__tool--search">
                    <circle cx="48" cy="-16" r="12" fill="rgba(220, 244, 255, 0.9)" stroke="#1a1f3c" stroke-width="3.5"/>
                    <circle cx="44" cy="-20" r="4" fill="rgba(255,255,255,0.85)"/>
                    <circle cx="48" cy="-16" r="8.5" fill="none" stroke="#8fd2ff" stroke-width="2"/>
                    <line x1="58" y1="-6" x2="72" y2="8" stroke="#1a1f3c" stroke-width="4" stroke-linecap="round"/>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--search-fulltext">
                        <text x="40" y="-12" font-size="9" font-family="monospace" font-weight="700" fill="#4a7fff">T</text>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--search-query_sql">
                        <text x="38" y="-12" font-size="8" font-family="monospace" font-weight="700" fill="#ff9500">SQL</text>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--tag-list">
                        <text x="40" y="-12" font-size="9" font-family="monospace" font-weight="700" fill="#17b26a">#</text>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--search-get_backlinks sy-puppy__tool-mark--search-get_backlinks">
                        <text x="40" y="-12" font-size="9" font-family="monospace" font-weight="700" fill="#6f7cff">↩</text>
                    </g>
                </g>

                <g class="sy-puppy__prop sy-puppy__tool sy-puppy__tool--tag">
                    <path d="M96 10h22l8 12-8 12H96z" fill="#ffd040" stroke="#1a1f3c" stroke-width="2"/>
                    <circle cx="104" cy="22" r="3" fill="#fff" stroke="#1a1f3c" stroke-width="1.2"/>
                    <line x1="96" y1="22" x2="86" y2="22" stroke="#1a1f3c" stroke-width="2"/>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--tag-list">
                        <line x1="110" y1="17" x2="118" y2="17" stroke="#fff" stroke-width="2"/>
                        <line x1="110" y1="22" x2="118" y2="22" stroke="#fff" stroke-width="2"/>
                        <line x1="110" y1="27" x2="118" y2="27" stroke="#fff" stroke-width="2"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--tag-rename">
                        <rect x="112" y="16" width="5" height="10" fill="#4a7fff"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--tag-remove">
                        <line x1="111" y1="18" x2="118" y2="25" stroke="#ff4d6d" stroke-width="2"/>
                        <line x1="118" y1="18" x2="111" y2="25" stroke="#ff4d6d" stroke-width="2"/>
                    </g>
                </g>

                <g class="sy-puppy__prop sy-puppy__tool sy-puppy__tool--system">
                    <rect x="90" y="-10" width="32" height="30" rx="3" fill="#d9f4ff" stroke="#1a1f3c" stroke-width="2"/>
                    <circle cx="106" cy="4" r="7" fill="#8fd2ff" stroke="#1a1f3c" stroke-width="1.5"/>
                    <line x1="106" y1="4" x2="112" y2="-1" stroke="#1a1f3c" stroke-width="1.8" stroke-linecap="round"/>
                    <line x1="95" y1="15" x2="117" y2="15" stroke="#1a1f3c" stroke-width="2"/>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--system-notify">
                        <circle cx="116" cy="-2" r="4" fill="#17b26a" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--system-notify">
                        <circle cx="116" cy="-2" r="4" fill="#ff4d6d" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--system-network">
                        <path d="M98 -4 L102 -8 L106 -4 L110 -8 L114 -4" fill="none" stroke="#4a7fff" stroke-width="1.5"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--system-conf">
                        <rect x="113" y="-6" width="5" height="5" fill="#ffd040" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--system-workspace_info">
                        <rect x="112" y="-7" width="8" height="8" fill="#c8dcff" stroke="#1a1f3c" stroke-width="1"/>
                        <path d="M112 1h8l-2 3h-10z" fill="#8fd2ff" stroke="#1a1f3c" stroke-width="1"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--system-changelog">
                        <line x1="112" y1="-5" x2="119" y2="-5" stroke="#fff" stroke-width="1.6"/>
                        <line x1="112" y1="-1" x2="119" y2="-1" stroke="#fff" stroke-width="1.6"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--system-get_version">
                        <rect x="111" y="-6" width="10" height="4" fill="#fff" stroke="#1a1f3c" stroke-width="1"/>
                        <rect x="112" y="-5" width="6" height="2" fill="#17b26a"/>
                    </g>
                    <g class="sy-puppy__tool-mark sy-puppy__tool-mark--system-get_version sy-puppy__tool-mark--system-get_current_time">
                        <text x="113" y="0" font-size="7" font-family="monospace" font-weight="700" fill="#6f7cff">v</text>
                    </g>
                </g>

                <g class="sy-puppy__prop sy-puppy__wage-card">
                    <rect x="28" y="55" width="38" height="24" rx="3" fill="#6f7cff" stroke="#1a1f3c" stroke-width="2"/>
                    <rect x="31" y="59" width="32" height="4" rx="1" fill="#dfe8ff"/>
                    <rect x="32" y="67" width="8" height="6" rx="1" fill="#ffd78c" stroke="#1a1f3c" stroke-width="1"/>
                    <rect x="44" y="68" width="7" height="2" fill="#dfe8ff"/>
                    <rect x="44" y="72" width="10" height="2" fill="#dfe8ff"/>
                    <text x="58" y="75" text-anchor="end" font-size="8" font-family="monospace" font-weight="700" fill="#ffffff">{balance}</text>
                </g>
            </g>

            <PuppyResultOverlay {state} {resultState} />
        </svg>
    </div>


<style>
    :global(.sy-puppy__char) {
        overflow: visible;
        filter: drop-shadow(0 8px 16px rgba(40, 59, 97, 0.18));
    }

    :global(.sy-puppy__cat > rect:not(.sy-puppy__paw)) {
        fill: var(--sy-puppy-body-color, #4a7fff);
    }

    :global(.sy-puppy__paw) {
        fill: var(--sy-puppy-paw-color, #3060d0);
        transform-origin: center top;
    }

    :global(.sy-puppy__tail-chain rect) {
        fill: var(--sy-puppy-body-color, #4a7fff);
    }

    :global(.sy-puppy__eyes rect) {
        fill: var(--sy-puppy-eye-color, #1a1f3c);
    }

    :global(.sy-puppy__eyes line) {
        stroke: var(--sy-puppy-eye-color, #1a1f3c);
    }

    :global(.sy-puppy__idle-detail) {
        opacity: 0;
        pointer-events: none;
        transform-box: fill-box;
        transform-origin: center;
    }

    :global(.sy-puppy__idle-yawn-mouth > rect:first-child) {
        fill: var(--sy-puppy-eye-color, #1a1f3c);
    }

    :global(.sy-puppy__cat),
    :global(.sy-puppy__prop),
    :global(.sy-puppy__overlay),
    :global(.sy-puppy__error-mark),
    :global(.sy-puppy__sweat) {
        transform-box: fill-box;
        transform-origin: center;
    }

    :global(.sy-puppy__tail) {
        transform-box: view-box;
    }

    :global(.sy-puppy__tail--2) {
        transform-origin: 87px 66px;
    }

    :global(.sy-puppy__tail--3) {
        transform-origin: 90px 72px;
    }

    :global(.sy-puppy__tool) {
        opacity: 0;
        transition: opacity 0.12s ease;
    }

    :global(.sy-puppy__tool-mark) {
        opacity: 0;
        transform-box: fill-box;
        transform-origin: center;
        transition: opacity 0.12s ease;
        pointer-events: none;
    }

    :global(.sy-puppy__tool-mark text) {
        paint-order: stroke;
        stroke: rgba(26, 31, 60, 0.15);
        stroke-width: 0.6px;
    }

    :global(.sy-puppy__tool--notebook) { transform-origin: -26px 42px; }
    :global(.sy-puppy__tool--document) { transform-origin: -28px 22px; }
    :global(.sy-puppy__tool--block) { transform-origin: 34px -22px; }
    :global(.sy-puppy__tool--av) { transform-origin: 96px -14px; }
    :global(.sy-puppy__tool--search) { transform-origin: 48px -12px; }
    :global(.sy-puppy__tool--file) { transform-origin: 104px 66px; }
    :global(.sy-puppy__tool--tag) { transform-origin: 106px 22px; }
    :global(.sy-puppy__tool--system) { transform-origin: 106px 4px; }
    :global(.sy-puppy__wage-card) {
        opacity: 0;
        transform-box: fill-box;
        transform-origin: 46px 68px;
        pointer-events: none;
    }

    :global(.sy-puppy--tool-notebook .sy-puppy__tool--notebook),
    :global(.sy-puppy--tool-document .sy-puppy__tool--document),
    :global(.sy-puppy--tool-block .sy-puppy__tool--block),
    :global(.sy-puppy--tool-av .sy-puppy__tool--av),
    :global(.sy-puppy--tool-file .sy-puppy__tool--file),
    :global(.sy-puppy--tool-search .sy-puppy__tool--search),
    :global(.sy-puppy--tool-tag .sy-puppy__tool--tag),
    :global(.sy-puppy--tool-system .sy-puppy__tool--system) {
        opacity: 1;
    }

    :global(.sy-puppy--show-wage-card .sy-puppy__wage-card) {
        opacity: 1;
        animation: sy-puppy-wage-card-show 0.42s steps(3);
    }

    :global(.sy-puppy--action-notebook-create .sy-puppy__tool-mark--notebook-create),
    :global(.sy-puppy--action-notebook-open .sy-puppy__tool-mark--notebook-open),
    :global(.sy-puppy--action-notebook-close .sy-puppy__tool-mark--notebook-close),
    :global(.sy-puppy--action-notebook-remove .sy-puppy__tool-mark--notebook-remove),
    :global(.sy-puppy--action-notebook-rename .sy-puppy__tool-mark--notebook-rename),
    :global(.sy-puppy--action-notebook-set_icon .sy-puppy__tool-mark--notebook-set_icon),
    :global(.sy-puppy--action-notebook-list .sy-puppy__tool-mark--notebook-list),
    :global(.sy-puppy--action-notebook-get_child_docs .sy-puppy__tool-mark--notebook-get_child_docs),
    :global(.sy-puppy--action-notebook-get_conf .sy-puppy__tool-mark--notebook-get_conf),
    :global(.sy-puppy--action-notebook-set_conf .sy-puppy__tool-mark--notebook-set_conf),
    :global(.sy-puppy--action-notebook-get_permissions .sy-puppy__tool-mark--notebook-get_permissions),
    :global(.sy-puppy--action-notebook-set_permission .sy-puppy__tool-mark--notebook-set_permission),
    :global(.sy-puppy--action-document-create .sy-puppy__tool-mark--document-create),
    :global(.sy-puppy--action-document-create_daily_note .sy-puppy__tool-mark--document-create_daily_note),
    :global(.sy-puppy--action-document-search_docs .sy-puppy__tool-mark--document-search_docs),
    :global(.sy-puppy--action-document-get_doc .sy-puppy__tool-mark--document-get_doc),
    :global(.sy-puppy--action-document-move .sy-puppy__tool-mark--document-move),
    :global(.sy-puppy--action-document-rename .sy-puppy__tool-mark--document-rename),
    :global(.sy-puppy--action-document-remove .sy-puppy__tool-mark--document-remove),
    :global(.sy-puppy--action-document-resolve .sy-puppy__tool-mark--document-resolve),
    :global(.sy-puppy--action-document-get_child_blocks .sy-puppy__tool-mark--document-get_child_blocks),
    :global(.sy-puppy--action-document-get_child_docs .sy-puppy__tool-mark--document-get_child_docs),
    :global(.sy-puppy--action-document-list_tree .sy-puppy__tool-mark--document-list_tree),
    :global(.sy-puppy--action-document-set_icon .sy-puppy__tool-mark--document-set_icon),
    :global(.sy-puppy--action-document-set_attr .sy-puppy__tool-mark--document-set_attr),
    :global(.sy-puppy--action-document-clear_cover .sy-puppy__tool-mark--document-clear_cover),
    :global(.sy-puppy--action-block-insert .sy-puppy__tool-mark--block-insert),
    :global(.sy-puppy--action-block-prepend .sy-puppy__tool-mark--block-prepend),
    :global(.sy-puppy--action-block-append .sy-puppy__tool-mark--block-append),
    :global(.sy-puppy--action-block-update .sy-puppy__tool-mark--block-update),
    :global(.sy-puppy--action-block-set_attrs .sy-puppy__tool-mark--block-set_attrs),
    :global(.sy-puppy--action-block-delete .sy-puppy__tool-mark--block-delete),
    :global(.sy-puppy--action-block-move .sy-puppy__tool-mark--block-move),
    :global(.sy-puppy--action-block-transfer_references .sy-puppy__tool-mark--block-transfer_references),
    :global(.sy-puppy--action-block-fold .sy-puppy__tool-mark--block-fold),
    :global(.sy-puppy--action-block-unfold .sy-puppy__tool-mark--block-unfold),
    :global(.sy-puppy--action-block-get_kramdown .sy-puppy__tool-mark--block-get_kramdown),
    :global(.sy-puppy--action-block-dom .sy-puppy__tool-mark--block-dom),
    :global(.sy-puppy--action-block-get_children .sy-puppy__tool-mark--block-get_children),
    :global(.sy-puppy--action-block-breadcrumb .sy-puppy__tool-mark--block-breadcrumb),
    :global(.sy-puppy--action-block-get_attrs .sy-puppy__tool-mark--block-get_attrs),
    :global(.sy-puppy--action-block-info .sy-puppy__tool-mark--block-info),
    :global(.sy-puppy--action-block-exists .sy-puppy__tool-mark--block-exists),
    :global(.sy-puppy--action-block-word_count .sy-puppy__tool-mark--block-word_count),
    :global(.sy-puppy--action-block-recent_updated .sy-puppy__tool-mark--block-recent_updated),
    :global(.sy-puppy--action-av-get .sy-puppy__tool-mark--av-get),
    :global(.sy-puppy--action-av-search .sy-puppy__tool-mark--av-search),
    :global(.sy-puppy--action-av-query .sy-puppy__tool-mark--av-query),
    :global(.sy-puppy--action-av-add_rows .sy-puppy__tool-mark--av-add_rows),
    :global(.sy-puppy--action-av-remove_rows .sy-puppy__tool-mark--av-remove_rows),
    :global(.sy-puppy--action-av-add_column .sy-puppy__tool-mark--av-add_column),
    :global(.sy-puppy--action-av-remove_column .sy-puppy__tool-mark--av-remove_column),
    :global(.sy-puppy--action-av-set_cells .sy-puppy__tool-mark--av-set_cells),
    :global(.sy-puppy--action-av-duplicate .sy-puppy__tool-mark--av-duplicate),
    :global(.sy-puppy--action-file-upload_asset .sy-puppy__tool-mark--file-upload_asset),
    :global(.sy-puppy--action-file-export_md .sy-puppy__tool-mark--file-export_md),
    :global(.sy-puppy--action-file-export_resources .sy-puppy__tool-mark--file-export_resources),
    :global(.sy-puppy--action-file-render .sy-puppy__tool-mark--file-render),
    :global(.sy-puppy--action-file-render .sy-puppy__tool-mark--file-render),
    :global(.sy-puppy--action-search-fulltext .sy-puppy__tool-mark--search-fulltext),
    :global(.sy-puppy--action-search-query_sql .sy-puppy__tool-mark--search-query_sql),
    :global(.sy-puppy--action-tag-list .sy-puppy__tool-mark--tag-list),
    :global(.sy-puppy--action-search-get_backlinks .sy-puppy__tool-mark--search-get_backlinks),
    :global(.sy-puppy--action-search-get_backlinks .sy-puppy__tool-mark--search-get_backlinks),
    :global(.sy-puppy--action-tag-list .sy-puppy__tool-mark--tag-list),
    :global(.sy-puppy--action-tag-rename .sy-puppy__tool-mark--tag-rename),
    :global(.sy-puppy--action-tag-remove .sy-puppy__tool-mark--tag-remove),
    :global(.sy-puppy--action-system-notify .sy-puppy__tool-mark--system-notify),
    :global(.sy-puppy--action-system-notify .sy-puppy__tool-mark--system-notify),
    :global(.sy-puppy--action-system-network .sy-puppy__tool-mark--system-network),
    :global(.sy-puppy--action-system-conf .sy-puppy__tool-mark--system-conf),
    :global(.sy-puppy--action-system-conf .sy-puppy__tool-mark--system-conf),
    :global(.sy-puppy--action-system-workspace_info .sy-puppy__tool-mark--system-workspace_info),
    :global(.sy-puppy--action-system-changelog .sy-puppy__tool-mark--system-changelog),
    :global(.sy-puppy--action-system-get_version .sy-puppy__tool-mark--system-get_version),
    :global(.sy-puppy--action-system-get_version .sy-puppy__tool-mark--system-get_version),
    :global(.sy-puppy--action-system-get_current_time .sy-puppy__tool-mark--system-get_current_time) {
        opacity: 1;
        animation: sy-puppy-tool-mark-pop 0.4s steps(2) infinite;
    }

    :global(.sy-puppy--idle .sy-puppy__cat) {
        animation: sy-puppy-ear-twitch 2.6s steps(1) infinite;
    }

    :global(.sy-puppy--idle .sy-puppy__tail--2),
    :global(.sy-puppy--idle .sy-puppy__tail--3) {
        animation: sy-puppy-tail-sway 2.4s steps(3) infinite;
    }

    :global(.sy-puppy--idle .sy-puppy__tail--2) {
        animation-delay: 0.16s;
    }

    :global(.sy-puppy--idle .sy-puppy__tail--3) {
        animation-delay: 0.32s;
    }

    :global(.sy-puppy--idle-stand .sy-puppy__cat) {
        animation: sy-puppy-idle-stand 2.1s ease-in-out infinite, sy-puppy-ear-twitch 2.8s steps(1) infinite;
    }

    :global(.sy-puppy--idle-look .sy-puppy__cat) {
        animation: sy-puppy-idle-look 1.9s ease-in-out infinite, sy-puppy-ear-twitch 2.4s steps(1) infinite;
    }

    :global(.sy-puppy--idle-look .sy-puppy__paw--left) {
        animation: sy-puppy-paw-shift-left 1.9s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-peek .sy-puppy__cat) {
        animation: sy-puppy-idle-peek 2.2s steps(4) infinite;
    }

    :global(.sy-puppy--idle-peek .sy-puppy__paw--left) {
        animation: sy-puppy-paw-peek 2.2s steps(4) infinite;
    }

    :global(.sy-puppy--idle-peek .sy-puppy__tail--2),
    :global(.sy-puppy--idle-peek .sy-puppy__tail--3) {
        animation: sy-puppy-tail-curious 2.2s steps(3) infinite;
    }

    :global(.sy-puppy--idle-sit .sy-puppy__cat) {
        animation: sy-puppy-idle-sit 2.2s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-sit .sy-puppy__paw--left),
    :global(.sy-puppy--idle-sit .sy-puppy__paw--right) {
        animation: sy-puppy-paw-tuck 2.2s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-groom .sy-puppy__cat) {
        animation: sy-puppy-idle-groom 1.5s steps(2) infinite;
    }

    :global(.sy-puppy--idle-groom .sy-puppy__paw--left) {
        animation: sy-puppy-groom-paw-left 1.5s steps(2) infinite;
    }

    :global(.sy-puppy--idle-groom .sy-puppy__paw--right) {
        animation: sy-puppy-groom-paw-right 1.5s steps(2) infinite;
    }

    :global(.sy-puppy--idle-stretch .sy-puppy__cat) {
        transform-origin: center bottom;
        animation: sy-puppy-idle-stretch 3.2s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-stretch .sy-puppy__paw--left) {
        animation: sy-puppy-paw-stretch-left 3.2s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-stretch .sy-puppy__paw--right) {
        animation: sy-puppy-paw-stretch-right 3.2s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-stretch .sy-puppy__tail--2),
    :global(.sy-puppy--idle-stretch .sy-puppy__tail--3) {
        animation: sy-puppy-tail-stretch 3.2s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-yawn .sy-puppy__cat) {
        animation: sy-puppy-idle-yawn 2.8s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-yawn .sy-puppy__idle-yawn-mouth) {
        opacity: 1;
        animation: sy-puppy-yawn-mouth 2.8s steps(3) infinite;
    }

    :global(.sy-puppy--idle-yawn .sy-puppy__paw--left),
    :global(.sy-puppy--idle-yawn .sy-puppy__paw--right) {
        animation: sy-puppy-paw-yawn 2.8s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-scratch .sy-puppy__cat) {
        animation: sy-puppy-idle-scratch 1.35s steps(2) infinite;
    }

    :global(.sy-puppy--idle-scratch .sy-puppy__paw--left) {
        animation: sy-puppy-paw-scratch-brace 1.35s steps(2) infinite;
    }

    :global(.sy-puppy--idle-scratch .sy-puppy__paw--right) {
        animation: sy-puppy-paw-scratch 1.35s steps(2) infinite;
    }

    :global(.sy-puppy--idle-scratch .sy-puppy__tail--2),
    :global(.sy-puppy--idle-scratch .sy-puppy__tail--3) {
        animation: sy-puppy-tail-scratch 1.35s steps(2) infinite;
    }

    :global(.sy-puppy--idle-tail-play .sy-puppy__cat) {
        transform-origin: 70% 75%;
        animation: sy-puppy-idle-tail-play 2.6s steps(4) infinite;
    }

    :global(.sy-puppy--idle-tail-play .sy-puppy__paw--right) {
        animation: sy-puppy-paw-tail-play 2.6s steps(4) infinite;
    }

    :global(.sy-puppy--idle-tail-play .sy-puppy__tail--2),
    :global(.sy-puppy--idle-tail-play .sy-puppy__tail--3) {
        animation: sy-puppy-tail-dodge 0.65s steps(3) infinite;
    }

    :global(.sy-puppy--idle-lie .sy-puppy__cat) {
        animation: sy-puppy-idle-lie 2.8s ease-in-out infinite, sy-puppy-ear-twitch 4s steps(1) infinite;
    }

    :global(.sy-puppy--idle-lie .sy-puppy__paw--left),
    :global(.sy-puppy--idle-lie .sy-puppy__paw--right) {
        animation: sy-puppy-paw-sprawl 2.8s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-lie .sy-puppy__tail--2),
    :global(.sy-puppy--idle-lie .sy-puppy__tail--3) {
        animation-duration: 3.6s;
    }

    :global(.sy-puppy--idle-sleep .sy-puppy__cat) {
        animation: sy-puppy-idle-sleep 3.2s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-sleep .sy-puppy__paw--left),
    :global(.sy-puppy--idle-sleep .sy-puppy__paw--right) {
        animation: sy-puppy-paw-sleep 3.2s ease-in-out infinite;
    }

    :global(.sy-puppy--idle-sleep .sy-puppy__tail--2),
    :global(.sy-puppy--idle-sleep .sy-puppy__tail--3) {
        animation: sy-puppy-tail-rest 4.2s ease-in-out infinite;
    }

    :global(.sy-puppy.sy-puppy--pointer-press .sy-puppy__cat) {
        animation: sy-puppy-pointer-press 0.14s ease-out forwards;
    }

    :global(.sy-puppy.sy-puppy--pointer-drag .sy-puppy__cat) {
        animation: sy-puppy-pointer-drag 0.52s steps(2) infinite;
    }

    :global(.sy-puppy.sy-puppy--pointer-drag .sy-puppy__paw--left),
    :global(.sy-puppy.sy-puppy--pointer-drag .sy-puppy__paw--right) {
        animation: sy-puppy-pointer-grip 0.52s steps(2) infinite;
    }

    :global(.sy-puppy.sy-puppy--pointer-drag .sy-puppy__tail--2),
    :global(.sy-puppy.sy-puppy--pointer-drag .sy-puppy__tail--3) {
        animation: sy-puppy-tail-trail 0.52s steps(2) infinite;
    }

    :global(.sy-puppy.sy-puppy--pointer-release .sy-puppy__cat) {
        animation: sy-puppy-pointer-release 0.26s ease-out forwards;
    }

    :global(.sy-puppy.sy-puppy--pointer-release .sy-puppy__paw--left),
    :global(.sy-puppy.sy-puppy--pointer-release .sy-puppy__paw--right) {
        animation: sy-puppy-pointer-release-paw 0.26s ease-out forwards;
    }

    :global(.sy-puppy.sy-puppy--pointer-pet .sy-puppy__cat) {
        transform-origin: center bottom;
        animation: sy-puppy-pointer-pet 0.76s cubic-bezier(0.2, 0.72, 0.25, 1) forwards;
    }

    :global(.sy-puppy.sy-puppy--pointer-pet .sy-puppy__paw--left),
    :global(.sy-puppy.sy-puppy--pointer-pet .sy-puppy__paw--right) {
        animation: sy-puppy-pointer-pet-paw 0.76s cubic-bezier(0.2, 0.72, 0.25, 1) forwards;
    }

    :global(.sy-puppy.sy-puppy--pointer-pet .sy-puppy__tail--2) {
        animation: sy-puppy-petting-tail-middle 0.38s ease-in-out 2;
    }

    :global(.sy-puppy.sy-puppy--pointer-pet .sy-puppy__tail--3) {
        animation: sy-puppy-petting-tail-tip 0.38s ease-in-out 2;
    }

    :global(.sy-puppy--reading .sy-puppy__cat) {
        animation: sy-puppy-reading-body 1s ease-in-out infinite;
    }

    :global(.sy-puppy--writing .sy-puppy__cat) {
        animation: sy-puppy-writing-body 0.28s steps(2) infinite;
    }

    :global(.sy-puppy--writing .sy-puppy__paw--left),
    :global(.sy-puppy--writing .sy-puppy__paw--right) {
        animation: sy-puppy-writing-paw 0.42s steps(2) infinite;
    }

    :global(.sy-puppy--moving .sy-puppy__cat) {
        animation: sy-puppy-moving-body 0.5s steps(2) infinite;
    }

    :global(.sy-puppy--deleting .sy-puppy__cat) {
        animation: sy-puppy-delete-body 0.18s steps(2) infinite;
    }

    :global(.sy-puppy--dangerous .sy-puppy__cat) {
        animation: sy-puppy-danger-body 0.15s steps(2) infinite;
    }

    :global(.sy-puppy--error .sy-puppy__cat) {
        animation: sy-puppy-error-shake 0.22s steps(2) infinite;
    }

    :global(.sy-puppy--tool-notebook .sy-puppy__tool--notebook) {
        animation: sy-puppy-notebook-idle 1.1s ease-in-out infinite;
    }

    :global(.sy-puppy--tool-document .sy-puppy__tool--document) {
        animation: sy-puppy-document-idle 1.1s ease-in-out infinite;
    }

    :global(.sy-puppy--tool-block .sy-puppy__tool--block) {
        animation: sy-puppy-block-idle 0.8s steps(2) infinite;
    }

    :global(.sy-puppy--tool-av .sy-puppy__tool--av) {
        animation: sy-puppy-av-idle 1.1s ease-in-out infinite;
    }

    :global(.sy-puppy--tool-file .sy-puppy__tool--file) {
        animation: sy-puppy-file-idle 1.2s ease-in-out infinite;
    }

    :global(.sy-puppy--tool-search .sy-puppy__tool--search) {
        animation: sy-puppy-search-idle 1.2s steps(4) infinite;
    }

    :global(.sy-puppy--tool-tag .sy-puppy__tool--tag) {
        animation: sy-puppy-tag-idle 1s ease-in-out infinite;
    }

    :global(.sy-puppy--tool-system .sy-puppy__tool--system) {
        animation: sy-puppy-system-idle 1s ease-in-out infinite;
    }

    :global(.sy-puppy--tool-notebook .sy-puppy__cat),
    :global(.sy-puppy--tool-document .sy-puppy__cat) {
        transform-origin: 28px 54px;
    }

    :global(.sy-puppy--tool-file .sy-puppy__cat),
    :global(.sy-puppy--tool-tag .sy-puppy__cat),
    :global(.sy-puppy--tool-system .sy-puppy__cat),
    :global(.sy-puppy--tool-mascot .sy-puppy__cat) {
        transform-origin: 68px 54px;
    }

    :global(.sy-puppy--tool-block .sy-puppy__cat),
    :global(.sy-puppy--tool-search .sy-puppy__cat),
    :global(.sy-puppy--tool-av .sy-puppy__cat) {
        transform-origin: 48px 34px;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-notebook .sy-puppy__paw--left),
    :global(.sy-puppy--reading.sy-puppy--tool-document .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-notebook .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-document .sy-puppy__paw--left) {
        animation: sy-puppy-paw-reach-left 0.46s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-notebook .sy-puppy__paw--right),
    :global(.sy-puppy--reading.sy-puppy--tool-document .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-notebook .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-document .sy-puppy__paw--right) {
        animation: sy-puppy-paw-brace-right 0.46s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-file .sy-puppy__paw--right),
    :global(.sy-puppy--reading.sy-puppy--tool-tag .sy-puppy__paw--right),
    :global(.sy-puppy--reading.sy-puppy--tool-system .sy-puppy__paw--right),
    :global(.sy-puppy--reading.sy-puppy--tool-mascot .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-file .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-tag .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-system .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-mascot .sy-puppy__paw--right) {
        animation: sy-puppy-paw-reach-right 0.46s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-file .sy-puppy__paw--left),
    :global(.sy-puppy--reading.sy-puppy--tool-tag .sy-puppy__paw--left),
    :global(.sy-puppy--reading.sy-puppy--tool-system .sy-puppy__paw--left),
    :global(.sy-puppy--reading.sy-puppy--tool-mascot .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-file .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-tag .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-system .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-mascot .sy-puppy__paw--left) {
        animation: sy-puppy-paw-brace-left 0.46s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-block .sy-puppy__paw--left),
    :global(.sy-puppy--reading.sy-puppy--tool-search .sy-puppy__paw--left),
    :global(.sy-puppy--reading.sy-puppy--tool-av .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-block .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-av .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-search .sy-puppy__paw--left),
    :global(.sy-puppy--writing.sy-puppy--tool-search .sy-puppy__paw--left) {
        animation: sy-puppy-paw-reach-up-left 0.4s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-block .sy-puppy__paw--right),
    :global(.sy-puppy--reading.sy-puppy--tool-search .sy-puppy__paw--right),
    :global(.sy-puppy--reading.sy-puppy--tool-av .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-block .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-av .sy-puppy__paw--right),
    :global(.sy-puppy--writing.sy-puppy--tool-search .sy-puppy__paw--right) {
        animation: sy-puppy-paw-reach-up-right 0.4s steps(2) infinite 0.08s;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-notebook .sy-puppy__cat) {
        animation: sy-puppy-read-left-book 1s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-document .sy-puppy__cat) {
        animation: sy-puppy-read-left-sheet 1s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-search .sy-puppy__cat) {
        animation: sy-puppy-track-search 1s steps(3) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-av .sy-puppy__cat) {
        animation: sy-puppy-track-search 1s steps(3) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-system .sy-puppy__cat) {
        animation: sy-puppy-monitor-right 1s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-mascot .sy-puppy__cat) {
        animation: sy-puppy-monitor-right 1s steps(2) infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-notebook .sy-puppy__tool--notebook),
    :global(.sy-puppy--reading.sy-puppy--tool-document .sy-puppy__tool--document),
    :global(.sy-puppy--reading.sy-puppy--tool-tag .sy-puppy__tool--tag) {
        animation-duration: 0.9s;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-search .sy-puppy__tool--search) {
        animation: sy-puppy-search-scan 1s ease-in-out infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-av .sy-puppy__tool--av) {
        animation: sy-puppy-search-scan 1s ease-in-out infinite;
    }

    :global(.sy-puppy--reading.sy-puppy--tool-system .sy-puppy__tool--system) {
        animation: sy-puppy-system-pulse 0.95s ease-in-out infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-block .sy-puppy__tool--block) {
        animation: sy-puppy-block-build 0.42s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-av .sy-puppy__tool--av) {
        animation: sy-puppy-block-build 0.42s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-block .sy-puppy__cat) {
        animation: sy-puppy-build-reach 0.42s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-av .sy-puppy__cat) {
        animation: sy-puppy-build-reach 0.42s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-file .sy-puppy__tool--file) {
        animation: sy-puppy-file-shuffle 0.42s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-file .sy-puppy__cat) {
        animation: sy-puppy-push-right 0.42s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-search .sy-puppy__tool--search),
    :global(.sy-puppy--writing.sy-puppy--tool-system .sy-puppy__tool--system) {
        animation: sy-puppy-tool-tap 0.4s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-search .sy-puppy__cat),
    :global(.sy-puppy--writing.sy-puppy--tool-system .sy-puppy__cat) {
        animation: sy-puppy-tap-up 0.4s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-notebook .sy-puppy__tool--notebook),
    :global(.sy-puppy--writing.sy-puppy--tool-document .sy-puppy__tool--document),
    :global(.sy-puppy--writing.sy-puppy--tool-tag .sy-puppy__tool--tag) {
        animation: sy-puppy-tool-lean 0.4s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-notebook .sy-puppy__cat),
    :global(.sy-puppy--writing.sy-puppy--tool-document .sy-puppy__cat) {
        animation: sy-puppy-write-left 0.4s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-tag .sy-puppy__cat) {
        animation: sy-puppy-stamp-right 0.4s steps(2) infinite;
    }

    :global(.sy-puppy--writing.sy-puppy--tool-mascot .sy-puppy__cat) {
        animation: sy-puppy-push-right 0.42s steps(2) infinite;
    }

    :global(.sy-puppy--moving .sy-puppy__tool) {
        animation-name: sy-puppy-move-prop;
        animation-duration: 0.5s;
        animation-timing-function: steps(2);
        animation-iteration-count: infinite;
    }


    @keyframes sy-puppy-bubble-in {
        from { opacity: 0; transform: translateX(-50%) translateY(4px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    @keyframes sy-puppy-bubble-in-left {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
    }

    @keyframes sy-puppy-bubble-in-down {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
    }

    @keyframes sy-puppy-heart-rise {
        0% { opacity: 0; transform: translateY(10px) scale(0.7); }
        25% { opacity: 1; transform: translateY(2px) scale(1); }
        100% { opacity: 0; transform: translateY(-18px) scale(1.15); }
    }

    @keyframes sy-puppy-feed-pop {
        0% { opacity: 0; transform: translate(10px, 8px) scale(0.6) rotate(10deg); }
        65% { opacity: 1; transform: translate(-2px, -1px) scale(1.08) rotate(-6deg); }
        100% { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); }
    }

    @keyframes sy-puppy-feed-idle {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-3px) rotate(4deg); }
    }

    @keyframes sy-puppy-wage-card-show {
        0% { transform: translate(4px, 8px) rotate(14deg) scale(0.7); }
        60% { transform: translate(-1px, -2px) rotate(-8deg) scale(1.06); }
        100% { transform: translate(0, 0) rotate(0deg) scale(1); }
    }

    @keyframes sy-puppy-bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
    }

    @keyframes sy-puppy-idle-stand {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translateY(-2px) rotate(-1deg); }
    }

    @keyframes sy-puppy-idle-look {
        0%, 100% { transform: translateX(0) rotate(0deg); }
        30% { transform: translateX(-2px) rotate(-4deg); }
        70% { transform: translateX(1px) rotate(3deg); }
    }

    @keyframes sy-puppy-idle-peek {
        0%, 18%, 100% { transform: translateX(0) rotate(0deg); }
        36%, 68% { transform: translateX(-5px) translateY(-1px) rotate(-5deg); }
        52% { transform: translateX(-7px) translateY(-2px) rotate(-7deg); }
    }

    @keyframes sy-puppy-idle-sit {
        0%, 100% { transform: translateY(0) scaleY(1); }
        50% { transform: translateY(3px) scaleY(0.95); }
    }

    @keyframes sy-puppy-idle-groom {
        0%, 100% { transform: translateX(0) rotate(0deg); }
        50% { transform: translateX(-4px) translateY(1px) rotate(-7deg); }
    }

    @keyframes sy-puppy-idle-stretch {
        0%, 16%, 100% { transform: translate(0, 0) scale(1); }
        38%, 72% { transform: translateY(3px) scaleX(1.08) scaleY(0.92) rotate(-2deg); }
        54% { transform: translateY(4px) scaleX(1.12) scaleY(0.88) rotate(-3deg); }
    }

    @keyframes sy-puppy-idle-yawn {
        0%, 14%, 100% { transform: translateY(0) scaleY(1); }
        38%, 75% { transform: translateY(2px) scaleY(0.96); }
        56% { transform: translateY(4px) scaleY(0.91) scaleX(1.03); }
    }

    @keyframes sy-puppy-idle-scratch {
        0%, 100% { transform: translateX(0) rotate(0deg); }
        35% { transform: translateX(-1px) rotate(-2deg); }
        70% { transform: translateX(1px) rotate(2deg); }
    }

    @keyframes sy-puppy-idle-tail-play {
        0%, 16%, 100% { transform: translate(0, 0) rotate(0deg); }
        34%, 66% { transform: translate(3px, 1px) rotate(4deg); }
        50% { transform: translate(5px, 2px) rotate(7deg) scaleX(1.02); }
    }

    @keyframes sy-puppy-idle-lie {
        0%, 100% { transform: translateY(3px) scaleY(0.9) scaleX(1.03); }
        50% { transform: translateY(4px) scaleY(0.88) scaleX(1.05); }
    }

    @keyframes sy-puppy-idle-sleep {
        0%, 100% { transform: translateY(5px) scaleY(0.85) scaleX(1.08); }
        50% { transform: translateY(6px) scaleY(0.82) scaleX(1.1); }
    }

    @keyframes sy-puppy-idle-paw {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(2px); }
    }

    @keyframes sy-puppy-paw-sprawl {
        0%, 100% { transform: translateY(3px) scaleY(0.82) scaleX(1.08); }
        50% { transform: translateY(4px) scaleY(0.78) scaleX(1.12); }
    }

    @keyframes sy-puppy-paw-sleep {
        0%, 100% { transform: translateY(5px) scaleY(0.72) scaleX(1.14); }
        50% { transform: translateY(6px) scaleY(0.68) scaleX(1.18); }
    }

    @keyframes sy-puppy-paw-shift-left {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        50% { transform: translate(-1px, 1px) rotate(-6deg); }
    }

    @keyframes sy-puppy-paw-peek {
        0%, 18%, 100% { transform: translate(0, 0) rotate(0deg); }
        36%, 68% { transform: translate(-3px, 2px) rotate(-8deg); }
        52% { transform: translate(-5px, 2px) rotate(-12deg); }
    }

    @keyframes sy-puppy-paw-tuck {
        0%, 100% { transform: translateY(0) scaleY(1); }
        50% { transform: translateY(2px) scaleY(0.92); }
    }

    @keyframes sy-puppy-groom-paw-left {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        50% { transform: translate(8px, -12px) rotate(-22deg); }
    }

    @keyframes sy-puppy-groom-paw-right {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        50% { transform: translate(-1px, 2px) rotate(4deg); }
    }

    @keyframes sy-puppy-paw-stretch-left {
        0%, 16%, 100% { transform: translate(0, 0) rotate(0deg); }
        40%, 72% { transform: translate(-5px, 5px) rotate(-8deg); }
        54% { transform: translate(-7px, 6px) rotate(-10deg); }
    }

    @keyframes sy-puppy-paw-stretch-right {
        0%, 16%, 100% { transform: translate(0, 0) rotate(0deg); }
        40%, 72% { transform: translate(5px, 5px) rotate(8deg); }
        54% { transform: translate(7px, 6px) rotate(10deg); }
    }

    @keyframes sy-puppy-paw-yawn {
        0%, 14%, 100% { transform: translateY(0) scaleY(1); }
        42%, 72% { transform: translateY(3px) scaleY(0.9); }
    }

    @keyframes sy-puppy-yawn-mouth {
        0%, 18%, 88%, 100% { transform: scale(0.2); opacity: 0; }
        38%, 72% { transform: scale(0.8, 1); opacity: 1; }
        54% { transform: scale(1, 1.16); opacity: 1; }
    }

    @keyframes sy-puppy-paw-scratch-brace {
        0%, 100% { transform: translateY(1px) rotate(-2deg); }
        50% { transform: translateY(2px) rotate(2deg); }
    }

    @keyframes sy-puppy-paw-scratch {
        0%, 100% { transform: translate(3px, -43px) rotate(-18deg); }
        50% { transform: translate(-1px, -48px) rotate(-30deg); }
    }

    @keyframes sy-puppy-paw-tail-play {
        0%, 18%, 100% { transform: translate(0, 0) rotate(0deg); }
        38%, 68% { transform: translate(9px, -2px) rotate(16deg); }
        52% { transform: translate(13px, -4px) rotate(24deg); }
    }

    @keyframes sy-puppy-tail-rest {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(2deg); }
    }

    @keyframes sy-puppy-tail-curious {
        0%, 100% { transform: rotate(0deg); }
        35% { transform: rotate(-3deg); }
        70% { transform: rotate(5deg); }
    }

    @keyframes sy-puppy-tail-stretch {
        0%, 16%, 100% { transform: rotate(0deg); }
        40%, 72% { transform: rotate(-6deg); }
        54% { transform: rotate(-10deg); }
    }

    @keyframes sy-puppy-tail-scratch {
        0%, 100% { transform: rotate(-2deg); }
        50% { transform: rotate(5deg); }
    }

    @keyframes sy-puppy-tail-dodge {
        0%, 100% { transform: rotate(-4deg); }
        33% { transform: rotate(-10deg); }
        66% { transform: rotate(8deg); }
    }

    @keyframes sy-puppy-sleep-z {
        0% {
            transform: translate(0, 0) scale(0.85);
            opacity: 0;
        }
        18% {
            opacity: 1;
        }
        100% {
            transform: translate(5px, -12px) scale(1.08);
            opacity: 0;
        }
    }

    @keyframes sy-puppy-tail-wag {
        0%, 100% { transform: rotate(0deg); }
        33% { transform: rotate(-5deg); }
        66% { transform: rotate(5deg); }
    }

    @keyframes sy-puppy-tail-sway {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(3deg); }
    }

    @keyframes sy-puppy-tail-trail {
        0%, 100% { transform: rotate(-2deg); }
        50% { transform: rotate(7deg); }
    }

    @keyframes sy-puppy-ear-twitch {
        0%, 100% { transform: scaleY(1); }
        50% { transform: scaleY(0.95); }
    }

    @keyframes sy-puppy-pointer-press {
        from { transform: translateY(0) scale(1); }
        to { transform: translateY(1px) scale(1, 0.99); }
    }

    @keyframes sy-puppy-pointer-drag {
        0%, 100% { transform: translate(0, 2px) rotate(-4deg); }
        50% { transform: translate(2px, -1px) rotate(4deg); }
    }

    @keyframes sy-puppy-pointer-grip {
        0%, 100% { transform: translateY(0) rotate(6deg); }
        50% { transform: translateY(1px) rotate(-4deg); }
    }

    @keyframes sy-puppy-pointer-release {
        0% { transform: translateY(2px) scale(1.02, 0.97); }
        70% { transform: translateY(-3px) scale(0.99, 1.02); }
        100% { transform: translateY(0) scale(1); }
    }

    @keyframes sy-puppy-pointer-release-paw {
        0% { transform: translateY(2px) rotate(8deg); }
        100% { transform: translateY(0) rotate(0deg); }
    }

    @keyframes sy-puppy-pointer-pet {
        0% { transform: translateY(1px) scale(1.01, 0.985) rotate(0deg); }
        24% { transform: translateY(3px) scale(1.015, 0.975) rotate(-1deg); }
        52% { transform: translateY(1px) scale(1.005, 0.99) rotate(1deg); }
        76% { transform: translateY(2px) scale(1.01, 0.985) rotate(-1deg); }
        100% { transform: translateY(0) scale(1) rotate(0deg); }
    }

    @keyframes sy-puppy-pointer-pet-paw {
        0% { transform: translateY(0); }
        30% { transform: translateY(2px); }
        62% { transform: translateY(1px); }
        100% { transform: translateY(0); }
    }

    @keyframes sy-puppy-petting-tail-middle {
        0%, 100% { transform: rotate(0deg); }
        45% { transform: rotate(4deg); }
        72% { transform: rotate(-2deg); }
    }

    @keyframes sy-puppy-petting-tail-tip {
        0%, 100% { transform: rotate(0deg); }
        35% { transform: rotate(12deg); }
        70% { transform: rotate(-6deg); }
    }

    @keyframes sy-puppy-reading-body {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(-4deg) translateY(-1px); }
    }

    @keyframes sy-puppy-read-left-book {
        0%, 100% { transform: translateX(0) rotate(0deg); }
        50% { transform: translateX(-5px) rotate(-10deg); }
    }

    @keyframes sy-puppy-read-left-sheet {
        0%, 100% { transform: translateX(0) rotate(0deg); }
        50% { transform: translateX(-6px) rotate(-8deg) translateY(-2px); }
    }

    @keyframes sy-puppy-track-search {
        0%, 100% { transform: rotate(-3deg) translateY(0); }
        25% { transform: rotate(-11deg) translateY(-1px); }
        75% { transform: rotate(8deg) translateY(-1px); }
    }

    @keyframes sy-puppy-monitor-right {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(8deg) translateX(3px); }
    }

    @keyframes sy-puppy-writing-body {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(3deg) translateY(-2px); }
    }

    @keyframes sy-puppy-build-reach {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px) rotate(-2deg); }
    }

    @keyframes sy-puppy-push-right {
        0%, 100% { transform: translateX(0) rotate(0deg); }
        50% { transform: translateX(4px) rotate(3deg); }
    }

    @keyframes sy-puppy-tap-up {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px) rotate(2deg); }
    }

    @keyframes sy-puppy-write-left {
        0%, 100% { transform: translateX(0) rotate(0deg); }
        50% { transform: translateX(-3px) rotate(-5deg); }
    }

    @keyframes sy-puppy-stamp-right {
        0%, 100% { transform: translateX(0) rotate(0deg); }
        50% { transform: translateX(4px) rotate(4deg); }
    }

    @keyframes sy-puppy-writing-paw {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
    }

    @keyframes sy-puppy-paw-reach-left {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        50% { transform: translate(-4px, -1px) rotate(-12deg); }
    }

    @keyframes sy-puppy-paw-reach-right {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        50% { transform: translate(4px, -1px) rotate(12deg); }
    }

    @keyframes sy-puppy-paw-brace-left {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        50% { transform: translate(-1px, 1px) rotate(-3deg); }
    }

    @keyframes sy-puppy-paw-brace-right {
        0%, 100% { transform: translate(0, 0) rotate(0deg); }
        50% { transform: translate(1px, 1px) rotate(3deg); }
    }

    @keyframes sy-puppy-paw-reach-up-left {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translate(-1px, -6px) rotate(-4deg); }
    }

    @keyframes sy-puppy-paw-reach-up-right {
        0%, 100% { transform: translateY(0) rotate(0deg); }
        50% { transform: translate(1px, -6px) rotate(4deg); }
    }

    @keyframes sy-puppy-moving-body {
        0%, 100% { transform: translateX(-4px) rotate(-4deg); }
        50% { transform: translateX(4px) rotate(4deg); }
    }

    @keyframes sy-puppy-delete-body {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(2px); }
    }

    @keyframes sy-puppy-danger-body {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(-2px); }
    }

    @keyframes sy-puppy-error-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-2px); }
        75% { transform: translateX(2px); }
    }

    @keyframes sy-puppy-notebook-idle {
        0%, 100% { transform: translateY(0) rotate(-2deg); }
        50% { transform: translateY(-3px) rotate(2deg); }
    }

    @keyframes sy-puppy-document-idle {
        0%, 100% { transform: translateY(0) rotate(-4deg); }
        50% { transform: translateY(-4px) rotate(-8deg); }
    }

    @keyframes sy-puppy-block-idle {
        0%, 100% { transform: translateY(-6px); }
        50% { transform: translateY(0); }
    }

    @keyframes sy-puppy-av-idle {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(-1px, -1px) scale(1.02); }
    }

    @keyframes sy-puppy-file-idle {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(6px); }
    }

    @keyframes sy-puppy-search-idle {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-14px); }
        50% { transform: translateX(0); }
        75% { transform: translateX(14px); }
    }

    @keyframes sy-puppy-tag-idle {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(10deg) translateY(-1px); }
    }

    @keyframes sy-puppy-system-idle {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(5deg) translateY(-2px); }
    }

    @keyframes sy-puppy-block-build {
        0%, 100% { transform: translateY(-10px); }
        50% { transform: translateY(2px); }
    }

    @keyframes sy-puppy-file-shuffle {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(10px); }
    }

    @keyframes sy-puppy-tool-tap {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-8px); }
    }

    @keyframes sy-puppy-tool-lean {
        0%, 100% { transform: rotate(0deg); }
        50% { transform: rotate(-10deg) translateY(-3px); }
    }

    @keyframes sy-puppy-move-prop {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(10px); }
    }

    @keyframes sy-puppy-search-scan {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-16px) translateY(2px); }
        80% { transform: translateX(16px) translateY(-2px); }
    }

    @keyframes sy-puppy-system-pulse {
        0%, 100% { transform: scale(1) rotate(0deg); }
        50% { transform: scale(1.08) rotate(4deg); }
    }

    @keyframes sy-puppy-tool-mark-pop {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-1px) scale(1.06); }
    }

</style>
