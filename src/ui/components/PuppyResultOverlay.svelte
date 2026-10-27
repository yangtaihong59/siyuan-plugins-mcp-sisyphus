<script context="module" lang="ts">
    export type ResultState = 'none' | 'success' | 'error';
</script>

<script lang="ts">
    import type { PuppyState } from './puppy-tool-visuals';

    export let state: PuppyState = 'idle';
    export let resultState: ResultState = 'none';
</script>

{#if state === 'deleting' || state === 'dangerous'}
<g class="sy-puppy__overlay sy-puppy__overlay--alert">
    <circle class="sy-puppy__sweat" cx="84" cy="30" r="3" fill="#8fd2ff"/>
</g>
{/if}

{#if state === 'deleting'}
<g class="sy-puppy__overlay sy-puppy__overlay--delete">
    <line x1="75" y1="-24" x2="93" y2="-6" stroke="#ff4d6d" stroke-width="5" stroke-linecap="round"/>
    <line x1="93" y1="-24" x2="75" y2="-6" stroke="#ff4d6d" stroke-width="5" stroke-linecap="round"/>
</g>
{/if}

{#if state === 'dangerous'}
<g class="sy-puppy__overlay sy-puppy__overlay--danger">
    <rect x="81" y="-30" width="9" height="18" rx="3" fill="#ffd040" stroke="#1a1f3c" stroke-width="1.5"/>
    <circle cx="85" cy="-4" r="5" fill="#ffd040" stroke="#1a1f3c" stroke-width="1.5"/>
</g>
{/if}

{#if resultState === 'error'}
<g class="sy-puppy__error-mark">
    <line x1="12" y1="12" x2="24" y2="24" stroke="#ff4d6d" stroke-width="3" stroke-linecap="round"/>
    <line x1="24" y1="12" x2="12" y2="24" stroke="#ff4d6d" stroke-width="3" stroke-linecap="round"/>
</g>
{/if}

<style>
    :global(.sy-puppy--deleting .sy-puppy__overlay--delete) {
        animation: sy-puppy-delete-x 0.4s steps(2) infinite;
    }

    :global(.sy-puppy--dangerous .sy-puppy__overlay--danger) {
        animation: sy-puppy-danger-exclaim 0.5s steps(2) infinite;
    }

    :global(.sy-puppy__sweat) {
        animation: sy-puppy-sweat-drop 0.6s steps(2) infinite;
    }

    @keyframes sy-puppy-delete-x {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
    }

    @keyframes sy-puppy-danger-exclaim {
        0%, 100% { transform: scale(1); fill: #ffd040; }
        50% { transform: scale(1.35); fill: #ff4d6d; }
    }

    @keyframes sy-puppy-sweat-drop {
        0%, 100% { transform: translateY(0); opacity: 1; }
        50% { transform: translateY(6px); opacity: 0.5; }
    }
</style>
