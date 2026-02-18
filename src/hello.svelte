<!--
 Copyright (c) 2024 by frostime. All Rights Reserved.
 Author       : frostime
 Date         : 2023-11-19 12:30:45
 FilePath     : /src/hello.svelte
 LastEditTime : 2024-10-16 14:37:50
 Description  : 
-->
<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    // import { version } from "@/api";
    import { showMessage, fetchPost, Protyle } from "siyuan";

    export let app;
    export let blockID: string;

    let time: string = "";

    let divProtyle: HTMLDivElement;
    let protyle: any;

    onMount(async () => {
        // ver = await version();
        fetchPost("/api/system/currentTime", {}, (response) => {
            time = new Date(response.data).toString();
        });
        if (blockID) {
            protyle = await initProtyle();
        } else {
            divProtyle.innerHTML = "Please open a document first";
        }
    });

    onDestroy(() => {
        showMessage("Hello panel closed");
        protyle?.destroy();
    });

    async function initProtyle() {
        return new Protyle(app, divProtyle, {
            blockId: blockID
        });
    }
</script>

<div class="b3-dialog__content">
    <div>appId:</div>
    <div class="fn__hr"></div>
    <div class="plugin-sample__time">${app?.appId}</div>
    <div class="fn__hr"></div>
    <div class="fn__hr"></div>
    <div>API demo:</div>
    <div class="fn__hr" />
    <div class="plugin-sample__time">
        System current time: <span id="time">{time}</span>
    </div>
    <div class="fn__hr" />
    <div class="fn__hr" />
    <div>Protyle demo: id = {blockID}</div>
    <div class="fn__hr" />
    <div id="protyle" style="height: 360px;" bind:this={divProtyle}/>
</div>

