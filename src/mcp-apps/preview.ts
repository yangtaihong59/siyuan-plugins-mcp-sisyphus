/** Development-only preview fixtures (?preview=flashcard|timeline|shop); see previewMode in index.ts. */
import { flashcardState, shopState, timelineState } from './state';

export function applyFlashcardPreview() {
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
}

export function applyTimelinePreview() {
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
}

export function applyShopPreview() {
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
}
