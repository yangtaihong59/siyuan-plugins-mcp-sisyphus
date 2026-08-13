import { App } from '@modelcontextprotocol/ext-apps/app-with-deps';

import './style.css';

type JsonObject = Record<string, any>;

interface ReviewTrace {
    deckID: string;
    cardID: string;
    prompt: string;
    referenceAnswer: string;
    rating: number;
    elapsedMs: number;
}

const previewMode = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('preview')
    : null;

const root = document.querySelector<HTMLElement>('#app')!;
const app = new App(
    { name: 'SiYuan Sisyphus Apps', version: '1.0.0' },
    {},
    { autoResize: !previewMode, strict: true },
);

let lastToolInput: JsonObject = {};
let busy = false;
let notice = '';
let noticeError = false;
let pendingConfirmation = '';

const flashcardState = {
    cards: [] as JsonObject[],
    index: 0,
    revealed: false,
    selectionReason: '',
    omittedCards: [] as JsonObject[],
    cardStartedAt: Date.now(),
    reviewedCards: [] as Array<{ cardID: string; rating: number }>,
    traces: [] as ReviewTrace[],
    teachingSent: false,
    appActions: new Set<string>(),
};

const timelineState = {
    documentId: '',
    nodes: [] as JsonObject[],
    comparison: undefined as JsonObject | undefined,
    page: 1,
    appActions: new Set<string>(),
};

const shopState = {
    balance: undefined as number | undefined,
    totalEarned: undefined as number | undefined,
    items: [] as JsonObject[],
    pendingItems: [] as JsonObject[],
    appActions: new Set<string>(),
};

app.ontoolinput = (params) => {
    lastToolInput = isObject(params.arguments) ? params.arguments : {};
    if (typeof lastToolInput.documentId === 'string') timelineState.documentId = lastToolInput.documentId;
};

app.ontoolresult = (result) => {
    handleToolResult(result, String(lastToolInput.action ?? ''));
};

app.onhostcontextchanged = (context) => {
    applyTheme(context.theme);
};

root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button || button.disabled) return;
    void handleAction(button.dataset.action ?? '', button.dataset);
});

root.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (!form.matches('[data-form="timeline-create"]')) return;
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const scope = String(data.get('scope') ?? 'document');
    if (!name || !timelineAppCan('create_node')) return;
    void callTool('timeline_app_action', {
        action: 'create_node',
        name,
        scope,
        ...(scope === 'document' && timelineState.documentId ? { documentId: timelineState.documentId } : {}),
    }).then(() => refreshTimeline());
});

renderLoading('正在连接 MCP Host…');
if (previewMode) loadPreview(previewMode);
else void connectApp();

function loadPreview(mode: string) {
    if (mode === 'flashcard') loadFlashcardPreview();
    else if (mode === 'timeline') loadTimelinePreview();
    else if (mode === 'shop') loadShopPreview();
    else renderError(`未知预览：${mode}`);
}

function loadFlashcardPreview() {
    flashcardState.selectionReason = '优先选择了遗忘次数较多的组合导航卡，并搭配一张基础概念卡。';
    flashcardState.cards = [
        {
            cardID: 'preview-card-1',
            deckID: 'deck-navigation',
            state: '待复习',
            review: {
                kind: 'heading',
                prompt: '为什么组合导航中通常用位置、速度误差作为量测，而不是直接校正姿态？',
                referenceAnswer: '位置和速度能够由外部传感器独立观测，误差通过滤波器状态与姿态误差耦合，从而间接估计并校正姿态；直接姿态量测通常不可得。',
                gradable: true,
            },
        },
        {
            cardID: 'preview-card-2',
            deckID: 'deck-navigation',
            state: '新卡',
            review: {
                kind: 'cloze',
                prompt: '卡尔曼滤波的两个核心步骤是 ____ 与 ____。',
                referenceAnswer: '预测；更新',
                gradable: true,
            },
        },
    ];
    flashcardState.revealed = true;
    flashcardState.appActions = new Set(['review_card']);
    renderFlashcards();
}

function loadTimelinePreview() {
    timelineState.documentId = '20260810123456-sisyphus';
    timelineState.appActions = new Set(['list_nodes', 'compare_node', 'rollback_document', 'rollback_block']);
    timelineState.comparison = {
        documentId: timelineState.documentId,
        node: {
            tag: 'sisyphus-timeline/research-baseline',
            name: '实验基线',
            scope: 'document',
            created: Date.UTC(2026, 7, 10, 4, 30),
        },
        stats: { addedLines: 5, removedLines: 3 },
        changes: [
            {
                status: 'modified',
                changeKey: 'block-method',
                old: { markdown: '组合导航采用 15 维误差状态模型。' },
                current: { markdown: '组合导航采用 18 维误差状态模型，并补充杆臂误差。' },
                rollbackable: true,
            },
            {
                status: 'added',
                changeKey: 'block-result',
                current: { markdown: '实验结果：水平定位误差降低 23.6%。' },
                rollbackable: true,
            },
            {
                status: 'removed',
                changeKey: 'block-todo',
                old: { markdown: 'TODO：补充静态对准实验。' },
                rollbackable: true,
            },
        ],
    };
    renderTimeline();
}

function loadShopPreview() {
    shopState.balance = 42;
    shopState.totalEarned = 128;
    shopState.appActions = new Set(['buy']);
    shopState.items = [
        { id: 'fish', label: '小鱼干', type: 'food', emoji: '🐟', cost: 3 },
        { id: 'cake', label: '草莓蛋糕', type: 'food', emoji: '🍰', cost: 6 },
        { id: 'yarn', label: '毛线球', type: 'toy', emoji: '🧶', cost: 8 },
        { id: 'box', label: '纸箱', type: 'toy', emoji: '📦', cost: 10 },
        { id: 'flower', label: '小花', type: 'gift', emoji: '🌼', cost: 12 },
        { id: 'crown', label: '猫猫皇冠', type: 'gift', emoji: '👑', cost: 20 },
    ];
    shopState.pendingItems = [shopState.items[0]];
    renderShop();
}

async function connectApp() {
    try {
        await app.connect();
        applyTheme(app.getHostContext()?.theme);
        window.setTimeout(() => {
            if (!root.querySelector('[data-view]')) renderWelcome();
        }, 250);
    } catch (error) {
        renderError(errorMessage(error));
    }
}

async function handleAction(action: string, data: DOMStringMap) {
    if (!['timeline-delete', 'timeline-rollback-document', 'timeline-rollback-block'].includes(action)) {
        pendingConfirmation = '';
    }
    switch (action) {
        case 'flash-reveal':
            flashcardState.revealed = true;
            renderFlashcards();
            return;
        case 'flash-discuss':
            await discussCurrentSession();
            return;
        case 'flash-rating':
            await reviewCurrentCard(Number(data.rating));
            return;
        case 'timeline-refresh':
            await refreshTimeline();
            return;
        case 'timeline-compare':
            await compareTimeline(data.tag ?? '');
            return;
        case 'timeline-delete':
            if (!confirmTimelineAction(`delete:${data.tag}`, '再次点击“删除”以确认。历史快照仍会保留。')) return;
            await callTool('timeline_app_action', {
                action: 'delete_node',
                tag: data.tag,
                ...(timelineState.documentId ? { documentId: timelineState.documentId } : {}),
            });
            await refreshTimeline();
            return;
        case 'timeline-rollback-document':
            if (!confirmTimelineAction(`rollback-document:${data.tag}`, '再次点击“回滚整个文档”以确认。')) return;
            await callTool('timeline_app_action', {
                action: 'rollback_document',
                documentId: timelineState.documentId,
                tag: data.tag,
            });
            await compareTimeline(data.tag ?? '');
            return;
        case 'timeline-rollback-block':
            if (!confirmTimelineAction(`rollback-block:${data.changeKey}`, '再次点击“恢复这个块”以确认。')) return;
            await callTool('timeline_app_action', {
                action: 'rollback_block',
                documentId: timelineState.documentId,
                tag: data.tag,
                changeKey: data.changeKey,
            });
            await compareTimeline(data.tag ?? '');
            return;
        case 'shop-refresh':
            await refreshShop();
            return;
        case 'shop-buy':
            queueShopItem(data.itemId ?? '');
            return;
        case 'shop-pickup-item':
            await collectShopItem(Number(data.pendingIndex));
            return;
    }
}

async function callTool(name: 'flashcard_review_app_action' | 'timeline_app_action' | 'mascot_shop_app_action', args: JsonObject) {
    if (busy) return undefined;
    busy = true;
    notice = '';
    renderBusyState();
    try {
        const result = previewMode
            ? simulatePreviewToolCall(name, args)
            : await callServerToolSafely(name, args);
        if (isToolError(result)) {
            throw new Error(toolErrorMessage(result));
        }
        handleToolResult(result, String(args.action ?? ''));
        return result;
    } catch (error) {
        notice = errorMessage(error);
        noticeError = true;
        renderCurrentView(name);
        return undefined;
    } finally {
        busy = false;
        renderBusyState();
    }
}

async function callServerToolSafely(
    name: 'flashcard_review_app_action' | 'timeline_app_action' | 'mascot_shop_app_action',
    args: JsonObject,
) {
    const action = String(args.action ?? '');
    if (!isAppMutation(action)) return app.callServerTool({ name, arguments: args });

    // validateOnly is guaranteed never to mutate, including when strict mode
    // is disabled. That lets one App bundle work with both server modes.
    const preflight = await app.callServerTool({
        name,
        arguments: { ...args, validateOnly: true },
    });
    if (isToolError(preflight)) {
        if (toolErrorCode(preflight) === 'strict_mode_disabled') {
            return app.callServerTool({ name, arguments: args });
        }
        return preflight;
    }

    const payload = resultPayload(preflight);
    const preconditionField = typeof payload?.preconditionField === 'string'
        ? payload.preconditionField
        : undefined;
    const hashFieldByPrecondition: Record<string, string> = {
        expectedStateHash: 'stateHash',
        expectedStructureHash: 'structureHash',
        expectedValueHash: 'valueHash',
        expectedManifestHash: 'manifestHash',
        expectedSourceHash: 'sourceHash',
    };
    const hashField = preconditionField ? hashFieldByPrecondition[preconditionField] : undefined;
    const currentHash = hashField && typeof payload?.[hashField] === 'string'
        ? payload[hashField]
        : undefined;
    if (preconditionField && !currentHash) {
        throw new Error(`安全预检没有返回 ${hashField ?? '状态 Hash'}。`);
    }
    return app.callServerTool({
        name,
        arguments: {
            ...args,
            requestId: createUuidV7(),
            ...(preconditionField && currentHash ? { [preconditionField]: currentHash } : {}),
        },
    });
}

function simulatePreviewToolCall(
    _name: 'flashcard_review_app_action' | 'timeline_app_action' | 'mascot_shop_app_action',
    args: JsonObject,
) {
    const action = String(args.action ?? '');
    if (action === 'buy') {
        const item = shopState.items.find((candidate) => candidate.id === args.item_id);
        const cost = Number(item?.cost ?? 0);
        shopState.balance = Math.max(0, Number(shopState.balance ?? 0) - cost);
        return previewResult({ action, success: true, balance: shopState.balance, item_id: args.item_id });
    }
    if (action === 'review_card') return previewResult({ action, success: true, cardID: args.cardID, rating: args.rating });
    if (action === 'create_node') {
        notice = `已创建时间线节点“${String(args.name ?? '')}”。`;
        noticeError = false;
        return previewResult({ action, success: true });
    }
    if (action === 'delete_node' || action.startsWith('rollback_')) {
        notice = action === 'delete_node' ? '节点标签已删除，历史快照仍保留。' : '回滚完成。';
        noticeError = false;
        return previewResult({ action, success: true });
    }
    return previewResult({ action, success: true });
}

function previewResult(payload: JsonObject) {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
    };
}

function createUuidV7() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let timestamp = Date.now();
    for (let index = 5; index >= 0; index -= 1) {
        bytes[index] = timestamp & 0xff;
        timestamp = Math.floor(timestamp / 256);
    }
    bytes[6] = 0x70 | (bytes[6] & 0x0f);
    bytes[8] = 0x80 | (bytes[8] & 0x3f);
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function confirmTimelineAction(key: string, message: string) {
    if (pendingConfirmation === key) {
        pendingConfirmation = '';
        return true;
    }
    pendingConfirmation = key;
    notice = message;
    noticeError = true;
    renderTimeline();
    return false;
}

function handleToolResult(result: unknown, actionHint = '') {
    if (isToolError(result)) {
        renderError(toolErrorMessage(result));
        return;
    }
    updateAppPermissions(result);
    const payload = resultPayload(result);
    if (!payload) {
        renderError('工具没有返回可展示的结构化数据。');
        return;
    }
    const action = String(payload.action ?? (actionHint || lastToolInput.action) ?? '');
    if (isFlashcardAction(action)) updateFlashcardState(action, payload);
    else if (isTimelineAction(action)) updateTimelineState(action, payload);
    else if (isMascotAction(action)) updateShopState(action, payload);
    else renderJson(payload);
}

function updateFlashcardState(action: string, payload: JsonObject) {
    if (action === 'flashcard_review_session') {
        flashcardState.cards = Array.isArray(payload.cards) ? payload.cards : [];
        flashcardState.index = 0;
        flashcardState.revealed = false;
        flashcardState.selectionReason = String(payload.selectionReason ?? 'AI 已根据当前到期情况选择本轮卡片。');
        flashcardState.omittedCards = Array.isArray(payload.omittedCards) ? payload.omittedCards : [];
        flashcardState.reviewedCards = [];
        flashcardState.traces = [];
        flashcardState.teachingSent = false;
        flashcardState.cardStartedAt = Date.now();
        notice = flashcardState.omittedCards.length
            ? `${flashcardState.omittedCards.length} 张卡片已不再到期或不可读取，已自动略过。`
            : '';
        noticeError = false;
    } else if (action === 'review_card') {
        notice = '复习结果已记录';
        noticeError = false;
    }
    renderFlashcards();
}

function updateTimelineState(action: string, payload: JsonObject) {
    if (action === 'list_nodes') {
        timelineState.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
        timelineState.page = Number(payload.page ?? 1);
        timelineState.comparison = undefined;
    } else if (action === 'compare_node') {
        timelineState.comparison = payload;
        if (typeof payload.documentId === 'string') timelineState.documentId = payload.documentId;
    } else if (action === 'create_node') {
        notice = '时间线节点已创建';
        noticeError = false;
    } else if (action.startsWith('rollback_')) {
        notice = '回滚操作已完成';
        noticeError = false;
    }
    renderTimeline();
}

function updateAppPermissions(result: unknown) {
    if (!isObject(result) || !isObject(result._meta)) return;
    const timelinePermissions = result._meta['io.siyuan-sisyphus/timeline-permissions'];
    if (isObject(timelinePermissions)) timelineState.appActions = new Set(Array.isArray(timelinePermissions.appActions) ? timelinePermissions.appActions.map(String) : []);
    const flashcardPermissions = result._meta['io.siyuan-sisyphus/flashcard-review-permissions'];
    if (isObject(flashcardPermissions)) flashcardState.appActions = new Set(Array.isArray(flashcardPermissions.appActions) ? flashcardPermissions.appActions.map(String) : []);
    const shopPermissions = result._meta['io.siyuan-sisyphus/mascot-shop-permissions'];
    if (isObject(shopPermissions)) shopState.appActions = new Set(Array.isArray(shopPermissions.appActions) ? shopPermissions.appActions.map(String) : []);
}

function timelineAppCan(action: string) {
    return timelineState.appActions.has(action);
}

function updateShopState(action: string, payload: JsonObject) {
    if (action === 'get_balance' || action === 'shop' || action === 'buy') {
        shopState.balance = numberOrUndefined(payload.balance);
        shopState.totalEarned = numberOrUndefined(payload.totalEarned);
    }
    if (action === 'shop') shopState.items = Array.isArray(payload.items) ? payload.items : [];
    renderShop();
}

function currentFlashcard() {
    return flashcardState.cards[flashcardState.index];
}

function reviewMaterial(card = currentFlashcard()) {
    const embedded = isObject(card?.review) ? card.review : {};
    const prompt = String(embedded.prompt ?? cardFace(card, ['front', 'question', 'content', 'markdown', 'name', 'memo', 'blockID', 'id']));
    const referenceAnswer = String(embedded.referenceAnswer ?? cardFace(card, ['back', 'answer']));
    return {
        kind: String(embedded.kind ?? 'plain'),
        prompt,
        referenceAnswer,
        gradable: embedded.gradable !== false && Boolean(referenceAnswer.trim()),
    };
}

async function discussCurrentSession() {
    if (!app.getHostCapabilities()?.message) {
        notice = '当前 Host 不支持从 App 发起主对话。';
        noticeError = true;
        renderFlashcards();
        return;
    }
    try {
        const counts = ratingCounts();
        const weakCards = flashcardState.traces.filter((trace) => trace.rating <= 2);
        const strongCards = flashcardState.traces.filter((trace) => trace.rating >= 3);
        const weakText = weakCards.length
            ? weakCards.map((trace, index) => [
                `${index + 1}. [${ratingEnglish(trace.rating)}] ${trace.prompt}`,
                `参考答案：${trace.referenceAnswer || '（无明确参考答案）'}`,
            ].join('\n')).join('\n')
            : '无';
        const strongText = strongCards.length
            ? strongCards.map((trace, index) => `${index + 1}. [${ratingEnglish(trace.rating)}] ${trace.prompt}`).join('\n')
            : '无';
        const message = [
            '以下是我刚完成的一轮思源闪卡复习。所有等级都是我的主观自评，你没有看到我的具体作答，不要声称知道我遗漏了哪些内容。',
            `AI 选卡理由：${flashcardState.selectionReason}`,
            `评分统计：Again ${counts[1]}，Hard ${counts[2]}，Good ${counts[3]}，Easy ${counts[4]}。`,
            '',
            '薄弱卡（包含参考答案，仅用于设计追问）：',
            weakText,
            '',
            '掌握较好的卡（不附答案）：',
            strongText,
            '',
            weakCards.length
                ? '请优先选择一张 Again，其次 Hard 的卡，采用苏格拉底式教学。第一条回复只问一个最有诊断价值的问题，不要复述完整答案，也不要一次提出多个问题；等我回答后再继续引导。'
                : '本轮没有 Again 或 Hard。请选择一张 Good/Easy 卡提出一个更高阶的迁移问题。第一条回复只问这一个问题，不要先讲解答案。',
        ].join('\n');
        await app.sendMessage({
            role: 'user',
            content: [{ type: 'text', text: message }],
        });
        flashcardState.teachingSent = true;
        notice = '已把本轮评分发送给 AI，请在主对话继续。';
        noticeError = false;
    } catch (error) {
        notice = `发送复盘请求失败：${errorMessage(error)}`;
        noticeError = true;
    }
    renderFlashcards();
}

async function reviewCurrentCard(rating: number) {
    const card = flashcardState.cards[flashcardState.index];
    if (!card || !flashcardState.revealed || ![1, 2, 3, 4].includes(rating)) return;
    const cardID = String(card.cardID ?? card.id ?? '');
    const deckID = String(card.deckID ?? '');
    if (!cardID || !deckID) {
        notice = '当前卡片缺少 cardID 或 deckID，无法提交复习结果。';
        noticeError = true;
        renderFlashcards();
        return;
    }
    const result = await callTool('flashcard_review_app_action', {
        action: 'review_card',
        deckID,
        cardID,
        rating,
        ...(flashcardState.reviewedCards.length ? { reviewedCards: flashcardState.reviewedCards } : {}),
    });
    if (!result) return;
    const material = reviewMaterial(card);
    const trace: ReviewTrace = {
        deckID,
        cardID,
        prompt: material.prompt,
        referenceAnswer: material.referenceAnswer,
        rating,
        elapsedMs: Date.now() - flashcardState.cardStartedAt,
    };
    flashcardState.traces.push(trace);
    flashcardState.reviewedCards.push({ cardID, rating });
    flashcardState.index += 1;
    flashcardState.revealed = false;
    flashcardState.cardStartedAt = Date.now();
    renderFlashcards();
}

function ratingCounts(): Record<number, number> {
    return flashcardState.traces.reduce<Record<number, number>>((counts, trace) => {
        counts[trace.rating] = (counts[trace.rating] ?? 0) + 1;
        return counts;
    }, { 1: 0, 2: 0, 3: 0, 4: 0 });
}

async function refreshTimeline() {
    if (!timelineAppCan('list_nodes')) {
        notice = '时间线 App 的列出节点权限未开启。';
        noticeError = true;
        renderTimeline();
        return;
    }
    const scope = timelineState.documentId ? 'all' : 'global';
    await callTool('timeline_app_action', {
        action: 'list_nodes',
        scope,
        ...(timelineState.documentId ? { documentId: timelineState.documentId } : {}),
        page: 1,
        pageSize: 50,
    });
}

async function compareTimeline(tag: string) {
    if (!timelineAppCan('compare_node')) {
        notice = '时间线 App 的比较节点权限未开启。';
        noticeError = true;
        renderTimeline();
        return;
    }
    if (!timelineState.documentId) {
        notice = '需要 documentId 才能比较文档时间线。请让模型使用文档范围调用 timeline/list_nodes。';
        noticeError = true;
        renderTimeline();
        return;
    }
    await callTool('timeline_app_action', {
        action: 'compare_node',
        documentId: timelineState.documentId,
        tag,
        page: 1,
        pageSize: 100,
    });
}

async function refreshShop() {
    await callTool('mascot_shop_app_action', { action: 'shop' });
}

async function buyItem(itemId: string) {
    if (!itemId) return undefined;
    return callTool('mascot_shop_app_action', { action: 'buy', item_id: itemId });
}

function pendingShopCost() {
    return shopState.pendingItems.reduce((total, item) => total + Number(item.cost ?? 0), 0);
}

function queueShopItem(itemId: string) {
    const item = shopState.items.find((candidate) => String(candidate.id ?? '') === itemId);
    if (!item) return;
    const remainingBalance = shopState.balance === undefined
        ? undefined
        : shopState.balance - pendingShopCost();
    if (remainingBalance !== undefined && Number(item.cost ?? 0) > remainingBalance) {
        notice = '余额不足，无法继续放入取货口。';
        noticeError = true;
        renderShop();
        return;
    }
    notice = '';
    noticeError = false;
    shopState.pendingItems.push(item);
    renderShop(shopState.pendingItems.length - 1);
}

async function collectShopItem(index: number) {
    const item = shopState.pendingItems[index];
    if (!item) return;
    const result = await buyItem(String(item.id ?? ''));
    if (!result) return;
    shopState.pendingItems.splice(index, 1);
    notice = `已取走 ${String(item.emoji ?? '🎁')} ${String(item.label ?? item.id ?? '商品')}，喂给猫猫吧。`;
    noticeError = false;
    renderShop();
}

function chineseCount(value: number) {
    if (!Number.isInteger(value) || value < 0 || value >= 100) return String(value);
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (value < 10) return digits[value];
    if (value === 10) return '十';
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${tens === 1 ? '' : digits[tens]}十${ones === 0 ? '' : digits[ones]}`;
}

function renderFlashcards() {
    const card = flashcardState.cards[flashcardState.index];
    const total = flashcardState.cards.length;
    const material = reviewMaterial(card);
    const reference = flashcardState.revealed ? `
        <section class="reference-answer">
            <span>参考答案</span>
            <p>${escapeHtml(material.referenceAnswer || '这张卡没有明确的参考答案')}</p>
        </section>` : '';
    const body = card ? `
        <section class="selection-reason"><span>AI 选卡</span><p>${escapeHtml(flashcardState.selectionReason)}</p></section>
        <section class="flashcard classic-card ${flashcardState.revealed ? 'revealed' : ''}">
            <div class="coach-meta">
                <span class="eyebrow">${escapeHtml(String(card.state ?? '待复习'))}</span>
                <span class="coach-badge">${flashcardState.index + 1} / ${total}</span>
            </div>
            <div class="coach-question">${escapeHtml(material.prompt || '这张卡没有可展示的题面')}</div>
            ${reference}
            ${flashcardState.revealed
                ? '<p class="self-rating-hint">根据你刚才回忆的难度，为这张卡评分。</p>'
                : '<button class="reveal-action" data-action="flash-reveal">显示答案</button>'}
        </section>
        <div class="ratings ${flashcardState.revealed ? '' : 'muted'}">
            ${ratingButton(1, '重来', 'Again')}
            ${ratingButton(2, '困难', 'Hard')}
            ${ratingButton(3, '良好', 'Good')}
            ${ratingButton(4, '简单', 'Easy')}
        </div>` : `<section class="session-complete">
            ${renderReviewSummary()}
            ${flashcardState.traces.length ? `<button class="primary-action discuss-button" data-action="flash-discuss" ${flashcardState.teachingSent ? 'disabled' : ''}>${flashcardState.teachingSent ? '已发送到主对话' : '让 AI 讲解本轮'}</button>` : ''}
        </section>`;

    renderShell('flashcard', '🃏', '闪卡复习', `本轮 ${total} 张 · 已完成 ${flashcardState.traces.length}`, body, '', 'flashcard-compact');
}

function renderReviewSummary() {
    const counts = ratingCounts();
    const rows = flashcardState.traces.map((trace) => `<li>
        <span class="summary-rating rating-${trace.rating}">${escapeHtml(ratingLabel(trace.rating))}</span>
        <span>${escapeHtml(trace.prompt)}</span>
    </li>`).join('');
    return `<div class="summary-hero"><span>🎉</span><div><strong>这一组已经复习完了</strong><p>评分已经写入思源，是否让 AI 教学由你决定。</p></div></div>
        <div class="rating-counts">
            ${ratingCount(1, 'Again', counts[1])}
            ${ratingCount(2, 'Hard', counts[2])}
            ${ratingCount(3, 'Good', counts[3])}
            ${ratingCount(4, 'Easy', counts[4])}
        </div>
        <ol class="review-summary-list">${rows}</ol>`;
}

function renderTimeline() {
    const comparison = timelineState.comparison;
    let content: string;
    if (comparison) {
        const node = isObject(comparison.node) ? comparison.node : {};
        const tag = String(node.tag ?? lastToolInput.tag ?? '');
        const changes = Array.isArray(comparison.changes) ? comparison.changes : [];
        const addedLines = Number(comparison.stats?.addedLines ?? 0);
        const removedLines = Number(comparison.stats?.removedLines ?? 0);
        const nodeName = String(node.name ?? '历史节点');
        content = `
            <div class="timeline-diff-toolbar">
                <button class="diff-back" data-action="timeline-refresh" title="${timelineAppCan('list_nodes') ? '返回时间线' : '时间线 App 的列出节点权限未开启'}" aria-label="返回时间线" ${timelineAppCan('list_nodes') ? '' : 'disabled'}>←</button>
                <div class="diff-toolbar-meta">
                    <strong>文档 ${escapeHtml(shortId(timelineState.documentId))}</strong>
                    <span class="diff-line-summary" aria-label="新增 ${addedLines} 行，删除 ${removedLines} 行">
                        <b class="added">+${addedLines}</b><b class="removed">-${removedLines}</b>
                    </span>
                    <span class="scope-badge ${node.scope === 'global' ? 'global' : ''}">${node.scope === 'global' ? '全局' : '文档'}</span>
                </div>
                <button class="diff-document-rollback" data-action="timeline-rollback-document" data-tag="${escapeAttr(tag)}" title="${timelineAppCan('rollback_document') ? '整篇回退到历史版本' : 'MCP App 的整篇回退权限未开启'}" aria-label="整篇回退到历史版本" ${timelineAppCan('rollback_document') ? '' : 'disabled'}>
                    ${restoreDocumentIcon()}
                </button>
            </div>
            <div class="diff-version-line">
                <div class="diff-version-card old"><span>历史版本</span><strong>${escapeHtml(nodeName)}</strong><time>${escapeHtml(formatTime(node.created))}</time></div>
                <span class="diff-version-arrow" aria-hidden="true">→</span>
                <div class="diff-version-card current"><span>当前状态</span></div>
            </div>
            <section class="unified-diff-list">${changes.length ? changes.map((change: JsonObject, index: number) => renderUnifiedDiff(change, tag, index === 0)).join('') : emptyState('✓', '没有差异', '当前文档与这个节点一致。')}</section>`;
    } else {
        const nodes = timelineState.nodes;
        const createForm = `
            <form class="create-form" data-form="timeline-create">
                <input name="name" placeholder="节点名称" maxlength="80" required />
                <select name="scope">
                    ${timelineState.documentId ? '<option value="document">当前文档</option>' : ''}
                    <option value="global">全局</option>
                </select>
                <button type="submit" title="${timelineAppCan('create_node') ? '创建节点' : 'MCP App 的创建节点权限未开启'}" ${timelineAppCan('create_node') ? '' : 'disabled'}>创建节点</button>
            </form>`;
        content = `${createForm}<section class="timeline-list">${nodes.length ? nodes.map(renderTimelineNode).join('') : emptyState('🕓', '还没有时间线节点', '创建一个节点，之后就能比较和回滚。')}</section>`;
    }
    renderShell(
        'timeline',
        '🕓',
        '文档时间线',
        timelineState.documentId ? `文档 ${shortId(timelineState.documentId)}` : '全局节点',
        content,
        '',
        comparison ? 'timeline-comparison' : '',
        false,
    );
}

function renderShop(dispensingIndex = -1) {
    const items = shopState.items;
    const pendingCost = pendingShopCost();
    const displayBalance = shopState.balance === undefined
        ? undefined
        : Math.max(0, shopState.balance - pendingCost);
    const machineMessage = shopState.pendingItems.length > 0
        ? `已出货${chineseCount(shopState.pendingItems.length)}件，取走喂给猫猫吧`
        : 'READY · 请选择商品';
    const pendingItems = shopState.pendingItems.map((item, index) => {
        const offset = (index % 7) - 3;
        const rotation = ((index * 7) % 17) - 8;
        const label = String(item.label ?? item.id ?? '商品');
        const animationClass = index === dispensingIndex ? ' is-dispensing' : '';
        return `<button class="vending-pending-item${animationClass}" data-action="shop-pickup-item" data-pending-index="${index}" style="left:calc(50% + ${offset * 13}px);z-index:${index + 2}" aria-label="取走 ${escapeAttr(label)}"><span style="transform:rotate(${rotation}deg)">${escapeHtml(String(item.emoji ?? '🎁'))}</span></button>`;
    }).join('');
    const content = `
        <section class="vending-machine">
            <div class="vending-marquee"><span>24H</span><strong>猫猫自动商店</strong><i aria-hidden="true"></i></div>
            <div class="vending-main">
                <section class="vending-window" aria-label="自动售货机商品货道">
                    <div class="vending-grid">${items.length ? items.map((item, index) => {
                        const affordable = shopState.appActions.has('buy') && (displayBalance === undefined || Number(item.cost ?? 0) <= displayBalance);
                        return `<article class="vending-item">
                            <span class="vending-code">${String(index + 1).padStart(2, '0')}</span>
                            <div class="vending-coil" aria-hidden="true"></div>
                            <div class="item-emoji">${escapeHtml(String(item.emoji ?? '🎁'))}</div>
                            <div class="vending-item-label"><strong>${escapeHtml(String(item.label ?? item.id ?? '商品'))}</strong><span>${escapeHtml(String(item.type ?? 'item'))}</span></div>
                            <button data-action="shop-buy" data-item-id="${escapeAttr(String(item.id ?? ''))}" ${affordable ? '' : 'disabled'}><b>●</b> ${escapeHtml(String(item.cost ?? 0))}</button>
                        </article>`;
                    }).join('') : emptyState('▦', '正在补货', '点击刷新读取当前商品。')}</div>
                </section>
                <aside class="vending-console">
                    <div class="vending-screen">
                        <span class="vending-online"><i></i> ONLINE</span>
                        <small>可用余额</small>
                        <strong>${displayBalance ?? '—'} <b>●</b></strong>
                        <em>累计 ${shopState.totalEarned ?? '—'}</em>
                    </div>
                    <div class="vending-instruction"><span>01</span><b>选择商品</b><span>02</span><b>确认价格</b><span>03</span><b>下方取货</b></div>
                    <div class="vending-reader" aria-hidden="true"><i></i><span>COIN / PASS</span></div>
                </aside>
            </div>
            <div class="vending-output">
                <div class="vending-slot">
                    <div class="vending-shutter" aria-hidden="true"></div>
                    <div class="vending-pile">${pendingItems}</div>
                    <span>点击商品取走 · PICK UP</span>
                </div>
                <div class="vending-message" aria-live="polite"><i></i>${machineMessage}</div>
            </div>
        </section>`;
    renderShell('shop', '▣', '猫猫自动商店', '24 小时营业 · 每次成功调用工具可获得 1 金币', content, '<button data-action="shop-refresh">刷新商品</button>', 'vending-shop-app');
}

function renderTimelineNode(node: JsonObject) {
    const tag = String(node.tag ?? '');
    const canCompare = Boolean(timelineState.documentId && tag && timelineAppCan('compare_node'));
    return `<article class="timeline-node">
        <div class="node-dot"></div>
        <div class="node-main">
            <strong>${escapeHtml(String(node.name ?? '未命名节点'))}</strong>
            <span>${formatTime(node.created)} · ${node.scope === 'global' ? '全局' : '当前文档'}</span>
            <code>${escapeHtml(shortId(String(node.snapshotId ?? '')))}</code>
        </div>
        <div class="node-actions">
            <button data-action="timeline-compare" data-tag="${escapeAttr(tag)}" title="${canCompare ? '比较节点' : '共享的比较节点权限未开启或缺少文档'}" ${canCompare ? '' : 'disabled'}>比较</button>
            <button class="ghost-danger" data-action="timeline-delete" data-tag="${escapeAttr(tag)}" title="${timelineAppCan('delete_node') ? '删除节点' : 'MCP App 的删除节点权限未开启'}" ${timelineAppCan('delete_node') ? '' : 'disabled'}>删除</button>
        </div>
    </article>`;
}

function renderUnifiedDiff(change: JsonObject, tag: string, firstChange: boolean) {
    const status = String(change.status ?? 'modified');
    const oldText = blockText(change.old);
    const currentText = blockText(change.current);
    const removedRow = status === 'removed' || status === 'modified'
        ? `<div class="unified-diff-row removed"><span class="line-marker">-</span><pre>${escapeHtml(oldText)}</pre></div>`
        : '';
    const addedRow = status === 'added' || status === 'modified'
        ? `<div class="unified-diff-row added"><span class="line-marker">+</span><pre>${escapeHtml(currentText)}</pre></div>`
        : '';
    const unchangedRow = status === 'unchanged'
        ? `<div class="unified-diff-row unchanged"><span class="line-marker"> </span><pre>${escapeHtml(currentText || oldText)}</pre></div>`
        : '';
    return `<article class="unified-diff-block status-${escapeAttr(status)}">
        ${removedRow}${addedRow}${unchangedRow}
        ${change.rollbackable ? `<button class="block-restore ${firstChange ? 'first-change' : ''}" data-action="timeline-rollback-block" data-tag="${escapeAttr(tag)}" data-change-key="${escapeAttr(String(change.changeKey ?? ''))}" title="${timelineAppCan('rollback_block') ? '还原块' : 'MCP App 的块级回退权限未开启'}" aria-label="还原块" ${timelineAppCan('rollback_block') ? '' : 'disabled'}>${restoreBlockIcon()}</button>` : `<small class="diff-reason">${escapeHtml(String(change.reason ?? '该变更无法安全恢复'))}</small>`}
    </article>`;
}

function restoreBlockIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M5 12h9.5A5.5 5.5 0 0 1 20 17.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function restoreDocumentIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.8 3.5h3.95L19 7.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-8.5A2.25 2.25 0 0 1 6 18.25V9.9M14.5 3.75V8h4.25M4.8 9.4V8.5a5 5 0 0 1 5-5h.65M2 6.55 4.8 9.4l2.85-2.85" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function renderShell(view: string, icon: string, title: string, subtitle: string, content: string, actions = '', shellClass = '', showHeader = true) {
    const header = showHeader ? `<header class="app-header">
            <div class="app-icon">${icon}</div>
            <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
            <div class="header-actions">${actions}</div>
        </header>` : '';
    root.innerHTML = `<section class="app-shell ${escapeAttr(shellClass)}" data-view="${escapeAttr(view)}">
        ${header}
        ${notice ? `<div class="notice ${noticeError ? 'error' : ''}" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(notice)}</div>` : ''}
        <div class="view-content">${content}</div>
        <div class="busy-bar ${busy ? 'active' : ''}"></div>
    </section>`;
    renderBusyState();
}

function renderBusyState() {
    root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        if (busy) button.setAttribute('aria-busy', 'true');
        else button.removeAttribute('aria-busy');
    });
    root.querySelector('.busy-bar')?.classList.toggle('active', busy);
}

function renderCurrentView(tool: string) {
    if (tool === 'flashcard_review_app_action') renderFlashcards();
    else if (tool === 'timeline_app_action') renderTimeline();
    else if (tool === 'mascot_shop_app_action') renderShop();
}

function renderWelcome() {
    renderShell('welcome', '🪨', 'SiYuan Sisyphus', '交互界面已经就绪', `
        <div class="welcome-grid">
            <button disabled><span>🃏</span><strong>请让 AI 选择到期卡</strong></button>
            <button data-action="timeline-refresh" ${timelineAppCan('list_nodes') ? '' : 'disabled'}><span>🕓</span><strong>查看时间线</strong></button>
            <button data-action="shop-refresh"><span>🐾</span><strong>打开商店</strong></button>
        </div>`);
}

function renderLoading(message: string) {
    root.innerHTML = `<section class="center-state"><div class="spinner"></div><p>${escapeHtml(message)}</p></section>`;
}

function renderError(message: string) {
    root.innerHTML = `<section class="center-state error-state"><div>!</div><h2>无法加载界面</h2><p>${escapeHtml(message)}</p></section>`;
}

function renderJson(payload: JsonObject) {
    renderShell('json', '📦', '工具结果', String(payload.action ?? 'structuredContent'), `<pre class="json-view">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`);
}

function resultPayload(result: any): JsonObject | undefined {
    if (isObject(result?.structuredContent)) return result.structuredContent;
    const text = Array.isArray(result?.content)
        ? result.content.find((item: JsonObject) => item?.type === 'text')?.text
        : undefined;
    if (typeof text !== 'string') return undefined;
    try {
        const parsed = JSON.parse(text);
        return isObject(parsed) ? parsed : { value: parsed };
    } catch {
        return { value: text };
    }
}

function isToolError(result: unknown) {
    return isObject(result) && result.isError === true;
}

function toolErrorMessage(result: unknown) {
    const payload = resultPayload(result);
    const error = isObject(payload?.error) ? payload.error : undefined;
    return String(error?.message ?? payload?.message ?? payload?.value ?? '工具调用失败。');
}

function toolErrorCode(result: unknown) {
    const payload = resultPayload(result);
    const error = isObject(payload?.error) ? payload.error : undefined;
    return String(error?.code ?? '');
}

function ratingButton(rating: number, label: string, english: string) {
    return `<button data-action="flash-rating" data-rating="${rating}" ${flashcardState.revealed && flashcardState.appActions.has('review_card') ? '' : 'disabled'}><strong>${label}</strong><span>${english}</span></button>`;
}

function ratingLabel(rating: number) {
    return ({ 1: '重来', 2: '困难', 3: '良好', 4: '简单' } as Record<number, string>)[rating] ?? String(rating);
}

function ratingEnglish(rating: number) {
    return ({ 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' } as Record<number, string>)[rating] ?? String(rating);
}

function ratingCount(rating: number, label: string, count: number) {
    return `<div class="rating-count rating-${rating}"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`;
}

function emptyState(icon: string, title: string, detail: string) {
    return `<div class="empty-state"><span>${icon}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function cardFace(card: JsonObject | undefined, keys: string[]) {
    if (!card) return '';
    for (const key of keys) {
        if (typeof card[key] === 'string' && card[key].trim()) return stripHtml(card[key]).trim();
    }
    return '';
}

function blockText(block: unknown) {
    if (!isObject(block)) return '';
    return String(block.markdown ?? block.content ?? block.text ?? '');
}

function stripHtml(value: string) {
    const template = document.createElement('template');
    template.innerHTML = value;
    return template.content.textContent ?? value;
}

function applyTheme(theme: unknown) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

function formatTime(value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '未知时间';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(number));
}

function shortId(value: string) {
    if (!value) return '—';
    return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function isFlashcardAction(action: string) {
    return ['flashcard_review_session', 'review_card'].includes(action);
}

function isTimelineAction(action: string) {
    return ['list_nodes', 'create_node', 'compare_node', 'delete_node', 'rollback_document', 'rollback_block'].includes(action);
}

function isMascotAction(action: string) {
    return ['get_balance', 'shop', 'buy'].includes(action);
}

function isAppMutation(action: string) {
    return [
        'review_card',
        'create_node',
        'delete_node',
        'rollback_document',
        'rollback_block',
        'buy',
    ].includes(action);
}

function isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberOrUndefined(value: unknown) {
    return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function escapeAttr(value: string) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}
