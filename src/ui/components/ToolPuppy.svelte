<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { getIdleMotionDelayMs, pickNextIdleMotion, type IdleMotion } from './puppy-motion';
    import { parsePuppyEventPayload, shouldShowWageCard, type PuppyEventPayload } from './puppy-interactions';
    import { formatBubbleText, getFeedProp, shouldShowBalanceCard, type FeedPropKind } from './puppy-bubble';
    import { loadPuppyPosition, savePuppyPosition } from './puppy-position';
    import { createJsonFilePoller, type Poller } from './puppy-polling';
    import { moveDrag, startDrag, type DragSession } from './puppy-drag';
    import { createTestModeRunner, type TestModeRunner } from './puppy-test-mode';
    import PuppyAwakeSVG from './PuppyAwakeSVG.svelte';
    import PuppyBubble from './PuppyBubble.svelte';
    import PuppySleepingSVG from './PuppySleepingSVG.svelte';
    import { resolveActionState, resolveToolVariant, RANDOM_TEST_ACTIONS, type PuppyState, type TestActionEntry, type ToolVariant } from './puppy-tool-visuals';
    import { buildDefaultPuppyAppearance, type PuppyAppearanceSettings } from '../setting/tool-config-storage';

    export let visible = false;
    export let testModeEnabled = false;
    export let testModeIntervalMs = 2200;
    export let showBubble = false;
    export let showClickHint = true;
    export let appearance: PuppyAppearanceSettings = buildDefaultPuppyAppearance();

    const EVENTS_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/puppyEvents.json';
    const API_FILE_ENDPOINT = '/api/file/getFile';
    const POLL_INTERVAL = 500;
    const IDLE_TIMEOUT = 3000;
    const RESULT_DISPLAY_TIME = 2400;
    const POINTER_RELEASE_TIME = 260;
    const PETTING_RESPONSE_TIME = 760;
    const HEART_DISPLAY_TIME = 980;
    const FEED_PROP_DISPLAY_TIME = 10000;
    const CLICK_HINT_DISPLAY_TIME = 2600;

    type ResultState = 'none' | 'success' | 'error';
    type PointerState = 'none' | 'pointer-press' | 'pointer-drag' | 'pointer-release' | 'pointer-pet';

    const TEST_SUCCESS_WEIGHT = 0.8;

    let state: PuppyState = 'idle';
    let resultState: ResultState = 'none';
    let toolVariant: ToolVariant = 'none';
    let toolAction = '';
    let bubbleText = '';
    let lastSeq = 0;
    let poller: Poller;
    let idleTimer: ReturnType<typeof setTimeout>;
    let resultTimer: ReturnType<typeof setTimeout>;
    let blinkTimer: ReturnType<typeof setInterval>;
    let idleMotionTimer: ReturnType<typeof setTimeout> | undefined;
    let pointerReleaseTimer: ReturnType<typeof setTimeout> | undefined;
    let heartTimer: ReturnType<typeof setTimeout> | undefined;
    let feedPropTimer: ReturnType<typeof setTimeout> | undefined;
    let clickHintTimer: ReturnType<typeof setTimeout> | undefined;
    let testRunner: TestModeRunner;
    let mounted = false;

    let posX: number;
    let posY: number;
    let dragSession: DragSession | null = null;

    let blinking = false;
    let idleMotion: IdleMotion = 'stand';
    let pointerState: PointerState = 'none';
    let balance = 0;
    let heartBurstVisible = false;
    let heartBurstSeq = 0;
    let showWageCard = false;
    let feedPropVisible = false;
    let feedPropEmoji = '';
    let feedPropKind: FeedPropKind = 'none';
    let feedPropSeq = 0;
    let mascotItemLabel = '';
    let mascotItemType = '';
    let mascotItemEmoji = '';
    let clickHintText = '';

    const MASCOT_CLICK_HINT = '我是 MCP 插件提供的猫猫，可在设置里关闭这个提示。';

    function bubbleMeta() {
        return { balance, mascotItemLabel };
    }

    function pickRandomAction(): TestActionEntry {
        return RANDOM_TEST_ACTIONS[Math.floor(Math.random() * RANDOM_TEST_ACTIONS.length)];
    }

    function applyDisplayEvent(tool: string, action: string, status: 'running' | 'success' | 'error') {
        const nextTool = resolveToolVariant(tool);
        if (status === 'running') {
            state = resolveActionState(action);
            resultState = 'none';
            toolVariant = nextTool;
            toolAction = action;
            showWageCard = shouldShowBalanceCard(tool, action) || shouldShowWageCard();
            bubbleText = formatBubbleText(tool, action, status, bubbleMeta(), true);
            clearTimeout(resultTimer);
            resetIdleTimer();
            return;
        }

        state = resolveActionState(action);
        resultState = status;
        toolVariant = nextTool;
        toolAction = action;
        const nextBubbleText = formatBubbleText(tool, action, status, bubbleMeta(), true);
        if (tool === 'mascot' && status === 'success' && action !== 'get_balance') {
            triggerPettingHeart();
            triggerFeedProp(action, nextBubbleText);
        }
        bubbleText = nextBubbleText;
        clearTimeout(resultTimer);
        resultTimer = setTimeout(() => resetIdleTimer(), RESULT_DISPLAY_TIME);
    }

    function clearIdleMotionTimer() {
        if (idleMotionTimer) clearTimeout(idleMotionTimer);
        idleMotionTimer = undefined;
    }

    function clearPointerReleaseTimer() {
        if (pointerReleaseTimer) clearTimeout(pointerReleaseTimer);
        pointerReleaseTimer = undefined;
    }

    function clearHeartTimer() {
        if (heartTimer) clearTimeout(heartTimer);
        heartTimer = undefined;
    }

    function clearFeedPropTimer() {
        if (feedPropTimer) clearTimeout(feedPropTimer);
        feedPropTimer = undefined;
    }

    function clearClickHintTimer() {
        if (clickHintTimer) clearTimeout(clickHintTimer);
        clickHintTimer = undefined;
    }

    function triggerClickHint() {
        if (!showClickHint) return;
        clickHintText = MASCOT_CLICK_HINT;
        clearClickHintTimer();
        clickHintTimer = setTimeout(() => {
            clickHintText = '';
        }, CLICK_HINT_DISPLAY_TIME);
    }

    function triggerFeedProp(action: string, bubble: string) {
        const feedProp = getFeedProp(action, bubble, mascotItemEmoji, mascotItemType);
        if (!feedProp) return;
        feedPropSeq += 1;
        feedPropVisible = true;
        feedPropEmoji = feedProp.emoji;
        feedPropKind = feedProp.kind;
        clearFeedPropTimer();
        feedPropTimer = setTimeout(() => {
            feedPropVisible = false;
            feedPropEmoji = '';
            feedPropKind = 'none';
        }, FEED_PROP_DISPLAY_TIME);
    }

    function shouldCycleIdleMotion() {
        return mounted && visible && state === 'idle' && pointerState === 'none' && !testModeEnabled;
    }

    function scheduleIdleMotion() {
        clearIdleMotionTimer();
        if (!shouldCycleIdleMotion()) {
            idleMotion = 'stand';
            return;
        }
        idleMotionTimer = setTimeout(() => {
            idleMotion = pickNextIdleMotion(idleMotion);
            scheduleIdleMotion();
        }, getIdleMotionDelayMs(idleMotion));
    }

    function setPointerState(next: PointerState) {
        clearPointerReleaseTimer();
        if (next !== 'none' && idleMotion !== 'stand') {
            idleMotion = 'stand';
        }
        pointerState = next;
        if (next === 'none') {
            scheduleIdleMotion();
            return;
        }
        clearIdleMotionTimer();
        if (next === 'pointer-release' || next === 'pointer-pet') {
            pointerReleaseTimer = setTimeout(() => {
                pointerState = 'none';
                scheduleIdleMotion();
            }, next === 'pointer-pet' ? PETTING_RESPONSE_TIME : POINTER_RELEASE_TIME);
        }
    }

    function syncTestMode() {
        if (!mounted) return;
        if (testModeEnabled) {
            stopPolling();
            clearIdleMotionTimer();
            idleMotion = 'stand';
            testRunner?.start();
            return;
        }
        testRunner?.stop();
        stopPolling();
        startPolling();
        setIdle();
        scheduleIdleMotion();
    }

    function loadPosition() {
        const { x, y } = loadPuppyPosition(window.innerWidth, window.innerHeight);
        posX = x;
        posY = y;
    }

    function savePosition() {
        savePuppyPosition({ x: posX, y: posY });
    }

    function beginPointerInteraction(clientX: number, clientY: number) {
        dragSession = startDrag(clientX, clientY, posX, posY);
        if (pointerState === 'pointer-pet') {
            clearPointerReleaseTimer();
            clearIdleMotionTimer();
            return;
        }
        setPointerState('pointer-press');
    }

    function onMouseDown(e: MouseEvent) {
        beginPointerInteraction(e.clientX, e.clientY);
        e.preventDefault();
    }

    function onTouchStart(e: TouchEvent) {
        const touch = e.touches[0];
        if (!touch) return;
        beginPointerInteraction(touch.clientX, touch.clientY);
        e.preventDefault();
    }

    function onMouseMove(e: MouseEvent) {
        if (!dragSession) return;
        const moved = moveDrag(dragSession, e.clientX, e.clientY);
        dragSession = moved.session;
        posX = moved.posX;
        posY = moved.posY;
        if (moved.pointerState === 'pointer-drag' || pointerState !== 'pointer-pet') {
            setPointerState(moved.pointerState);
        }
    }

    function onTouchMove(e: TouchEvent) {
        if (!dragSession) return;
        const touch = e.touches[0];
        if (!touch) return;
        const moved = moveDrag(dragSession, touch.clientX, touch.clientY);
        dragSession = moved.session;
        posX = moved.posX;
        posY = moved.posY;
        if (moved.pointerState === 'pointer-drag' || pointerState !== 'pointer-pet') {
            setPointerState(moved.pointerState);
        }
        e.preventDefault();
    }

    function triggerPettingHeart() {
        heartBurstSeq += 1;
        heartBurstVisible = true;
        clearHeartTimer();
        heartTimer = setTimeout(() => {
            heartBurstVisible = false;
        }, HEART_DISPLAY_TIME);
    }

    function onMouseUp() {
        if (!dragSession) return;
        const shouldSave = dragSession.pointerMoved;
        if (shouldSave) {
            savePosition();
        } else {
            posX = dragSession.baseX;
            posY = dragSession.baseY;
            triggerPettingHeart();
            triggerClickHint();
        }
        dragSession = null;
        setPointerState(shouldSave ? 'pointer-release' : 'pointer-pet');
    }

    function onTouchEnd() {
        onMouseUp();
    }

    function setIdle() {
        state = 'idle';
        resultState = 'none';
        toolVariant = 'none';
        toolAction = '';
        showWageCard = false;
        bubbleText = '';
        scheduleIdleMotion();
    }

    function clearTransientDisplayState() {
        setIdle();
        balance = 0;
        mascotItemLabel = '';
        mascotItemType = '';
        mascotItemEmoji = '';
        heartBurstVisible = false;
        feedPropVisible = false;
        feedPropEmoji = '';
        feedPropKind = 'none';
        clickHintText = '';
    }

    function resetIdleTimer() {
        clearTimeout(idleTimer);
        clearIdleMotionTimer();
        idleTimer = setTimeout(() => {
            setIdle();
        }, IDLE_TIMEOUT);
    }

    function stopPolling() {
        poller?.stop();
    }

    function startPolling() {
        if (testModeEnabled || !visible) return;
        poller?.start();
    }

    function handlePolledEvent(event: PuppyEventPayload) {
        if (testModeEnabled) return;
        balance = event.balance;
        mascotItemLabel = event.itemLabel ?? '';
        mascotItemType = event.itemType ?? '';
        mascotItemEmoji = event.itemEmoji ?? '';
        if (event.seq <= lastSeq) return;
        lastSeq = event.seq;

        const tool = event.tool || '';
        const action = event.action || 'unknown';
        const status = event.status || 'running';
        const nextTool = resolveToolVariant(tool);

        if (status === 'running') {
            state = resolveActionState(action);
            resultState = 'none';
            toolVariant = nextTool;
            toolAction = action;
            showWageCard = shouldShowBalanceCard(tool, action) || shouldShowWageCard();
            bubbleText = formatBubbleText(tool, action, status, bubbleMeta());
            clearTimeout(resultTimer);
            resetIdleTimer();
        } else if (status === 'success') {
            state = resolveActionState(action);
            resultState = 'success';
            toolVariant = nextTool;
            toolAction = action;
            const nextBubbleText = formatBubbleText(tool, action, status, bubbleMeta());
            if (tool === 'mascot' && action !== 'get_balance') {
                triggerPettingHeart();
                triggerFeedProp(action, nextBubbleText);
            }
            bubbleText = nextBubbleText;
            clearTimeout(resultTimer);
            resultTimer = setTimeout(() => resetIdleTimer(), RESULT_DISPLAY_TIME);
        } else if (status === 'error') {
            state = resolveActionState(action);
            resultState = 'error';
            toolVariant = nextTool;
            toolAction = action;
            bubbleText = formatBubbleText(tool, action, status, bubbleMeta());
            clearTimeout(resultTimer);
            resultTimer = setTimeout(() => resetIdleTimer(), RESULT_DISPLAY_TIME);
        }
    }

    function startBlink() {
        blinkTimer = setInterval(() => {
            if (state === 'idle' || state === 'reading') {
                blinking = true;
                setTimeout(() => { blinking = false; }, 160);
            }
        }, 2600);
    }

    onMount(() => {
        mounted = true;
        testRunner = createTestModeRunner({
            pickAction: pickRandomAction,
            applyEvent: applyDisplayEvent,
            getIntervalMs: () => testModeIntervalMs,
            successWeight: TEST_SUCCESS_WEIGHT,
        });
        poller = createJsonFilePoller({
            endpoint: API_FILE_ENDPOINT,
            path: EVENTS_PATH,
            intervalMs: POLL_INTERVAL,
            parse: parsePuppyEventPayload,
            onValue: handlePolledEvent,
        });
        loadPosition();
        startPolling();
        startBlink();
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
        syncTestMode();
        scheduleIdleMotion();
    });

    onDestroy(() => {
        stopPolling();
        clearInterval(blinkTimer);
        testRunner?.stop();
        clearIdleMotionTimer();
        clearPointerReleaseTimer();
        clearHeartTimer();
        clearFeedPropTimer();
        clearClickHintTimer();
        clearTimeout(idleTimer);
        clearTimeout(resultTimer);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
    });

    function resetToDefaultPosition() {
        posX = 20;
        posY = 20;
    }

    let prevVisible = visible;
    $: isSleeping = state === 'idle' && idleMotion === 'sleep';
    $: isYawning = state === 'idle' && idleMotion === 'yawn';
    $: if (mounted) {
        if (visible && !testModeEnabled) {
            startPolling();
        } else {
            stopPolling();
            if (!visible) {
                clearTransientDisplayState();
            }
        }
        if (visible && !prevVisible) {
            resetToDefaultPosition();
        }
        prevVisible = visible;
    }
    let eyeState: 'blink' | 'happy' | 'sad' | 'danger' | 'flat' | 'normal';
    $: eyeState = pointerState === 'pointer-pet' ? 'happy' :
        isSleeping || isYawning ? 'blink' :
        blinking ? 'blink' :
        resultState === 'success' ? 'happy' :
        resultState === 'error' ? 'sad' :
        state === 'dangerous' ? 'danger' :
        state === 'reading' ? 'flat' :
        'normal';

    $: containerClass = state === 'idle' ? 'sy-puppy--idle' :
        state === 'reading' ? 'sy-puppy--reading' :
        state === 'writing' ? 'sy-puppy--writing' :
        state === 'deleting' ? 'sy-puppy--deleting' :
        state === 'moving' ? 'sy-puppy--moving' :
        state === 'dangerous' ? 'sy-puppy--dangerous' :
        'sy-puppy--idle';

    $: bubbleToneClass = resultState === 'error' ? 'sy-puppy__bubble--error' : '';

    $: bubblePositionClass = toolVariant === 'search' || toolVariant === 'block' || toolVariant === 'system' || toolVariant === 'av'
        ? 'sy-puppy__bubble--high sy-puppy__bubble--left'
        : toolVariant === 'notebook' || toolVariant === 'document'
            ? 'sy-puppy__bubble--right'
            : toolVariant === 'file' || toolVariant === 'tag' || toolVariant === 'mascot'
                ? 'sy-puppy__bubble--left'
                : '';

    $: bubbleOffsetClass = resultState === 'error' ? 'sy-puppy__bubble--error-offset' : '';
    $: bubbleTailClass = toolVariant === 'notebook' || toolVariant === 'document'
        ? 'sy-puppy__bubble--tail-right'
        : toolVariant === 'search' || toolVariant === 'block' || toolVariant === 'system' || toolVariant === 'av' || toolVariant === 'file' || toolVariant === 'tag' || toolVariant === 'mascot'
            ? 'sy-puppy__bubble--tail-left'
            : 'sy-puppy__bubble--tail-center';

    $: idleMotionClass = state === 'idle' ? `sy-puppy--idle-${idleMotion}` : '';
    $: pointerClass = pointerState !== 'none' ? `sy-puppy--${pointerState}` : '';
    $: toolClass = toolVariant !== 'none'
        ? `sy-puppy--tool-${toolVariant} ${toolAction ? `sy-puppy--action-${toolVariant}-${toolAction}` : ''}`
        : '';
    $: wageCardClass = showWageCard ? 'sy-puppy--show-wage-card' : '';
    $: appearanceStyle = [
        `--sy-puppy-body-color: ${appearance.bodyColor}`,
        `--sy-puppy-paw-color: ${appearance.pawColor}`,
        `--sy-puppy-eye-color: ${appearance.eyeColor}`,
    ].join('; ');
    $: mounted, testModeEnabled, testModeIntervalMs, visible, syncTestMode();
</script>

{#if visible}
<div
    class="sy-puppy {containerClass} {idleMotionClass} {pointerClass} {toolClass} {wageCardClass}"
    style="left: {posX}px; top: {posY}px; {appearanceStyle};"
    on:mousedown={onMouseDown}
    on:touchstart={onTouchStart}
    role="status"
    aria-label="Tool call status"
>
    <PuppyBubble
        {clickHintText}
        {showBubble}
        {bubbleText}
        {bubbleToneClass}
        {bubblePositionClass}
        {bubbleOffsetClass}
        {bubbleTailClass}
        {showWageCard}
        {balance}
        {heartBurstSeq}
        {heartBurstVisible}
        {feedPropSeq}
        {feedPropVisible}
        {feedPropKind}
        {feedPropEmoji}
    />
    <PuppySleepingSVG {isSleeping} />
    <PuppyAwakeSVG
        {state}
        {resultState}
        {eyeState}
        {balance}
        bodyColor={appearance.bodyColor}
        pawColor={appearance.pawColor}
        eyeColor={appearance.eyeColor}
    />
</div>
{/if}

<style>
    .sy-puppy {
        position: fixed;
        z-index: 9999;
        cursor: grab;
        user-select: none;
        touch-action: none;
    }

    .sy-puppy:active {
        cursor: grabbing;
    }
</style>
