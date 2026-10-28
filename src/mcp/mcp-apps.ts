import type { CallToolResult, ClientCapabilities } from '@modelcontextprotocol/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import type { SiYuanClient } from '../api/client';
import type { Flashcard } from '../api/flashcard';
import { createFlashcardReviewSessionData } from '../tools/flashcard/handlers';
import { FLASHCARD_VARIANTS } from '../tools/flashcard';
import { callMascotTool, MASCOT_VARIANTS } from '../tools/mascot';
import { callTimelineTool } from '../tools/timeline';
import { TIMELINE_VARIANTS } from '../tools/timeline';
import { buildAggregatedTool, createErrorResult } from '../tools/internal/shared';
import type { McpAppConfig, McpAppsConfig, TimelineAppAction, FlashcardReviewAppAction, MascotShopAppAction, ToolCategory, ToolConfig } from '../core/config';
import { withStructuredContent } from '../core/structured-result';
import type { PermissionManager } from '../core/permissions';
import type { ToolDescriptor, ToolResult } from '../core/tool-result';
import type { ToolCallPlan } from './tool-call-gate';

import MCP_APP_HTML from 'virtual:siyuan-mcp-app-html';
import {
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
    FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    MASCOT_SHOP_APP_ACTION_TOOL_NAME,
    MASCOT_SHOP_APP_TOOL_NAME,
    TIMELINE_APP_ACTION_TOOL_NAME,
    TIMELINE_APP_TOOL_NAME,
} from '../core/mcp-app-names';

export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
export const MCP_APP_LEGACY_RESOURCE_URI_META_KEY = 'ui/resourceUri';
export {
    FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME,
    FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    MASCOT_SHOP_APP_ACTION_TOOL_NAME,
    MASCOT_SHOP_APP_TOOL_NAME,
    TIMELINE_APP_ACTION_TOOL_NAME,
    TIMELINE_APP_TOOL_NAME,
};
export const FLASHCARD_APP_PRESENTATION_MODE = 'mcp-app-only';
export const FLASHCARD_APP_HANDOFF_MESSAGE = '复习界面已打开，请在卡片中完成本轮。';
export const FLASHCARD_APP_MODEL_INSTRUCTION = [
    'The MCP App is the sole review surface for this round even though the complete card prompts and reference answers remain visible to you in structuredContent.',
    'Do not list, quote, restate, or reveal any card prompt or answer.',
    'Do not start Q1, ask the user to answer in chat, assess an answer, assign a rating, or call flashcard(action="review_card") yourself.',
    `After this tool succeeds, reply with exactly "${FLASHCARD_APP_HANDOFF_MESSAGE}" and stop.`,
    'Resume discussing card content only if the user explicitly exits the App and requests chat-based review, or after the App sends its explicit post-review teaching handoff.',
].join(' ');
export const TIMELINE_APP_HANDOFF_MESSAGE = '时间线界面已打开，请在界面中选择节点并执行操作。';
export const TIMELINE_APP_SCOPE_INSTRUCTION = [
    'The Timeline App has no target-document picker after launch.',
    'If documentId is omitted, the App starts in global-only mode and can display only global timeline nodes; document-specific nodes are unavailable.',
    'When the user asks for a particular document timeline, resolve and pass that documentId before calling this tool. Omit documentId only when the user wants the global timeline.',
].join(' ');
export const TIMELINE_APP_MODEL_INSTRUCTION = [
    'The MCP App is the sole surface for user-initiated timeline mutations after this tool succeeds.',
    'Do not call timeline rollback actions yourself and never simulate a rollback with block.delete, document rewrites, or other editing tools.',
    `Reply with exactly "${TIMELINE_APP_HANDOFF_MESSAGE}" and stop.`,
].join(' ');
export const MASCOT_SHOP_APP_HANDOFF_MESSAGE = '猫猫商店已打开，请在界面中选择并购买物品。';
export const MASCOT_SHOP_APP_MODEL_INSTRUCTION = [
    'The MCP App is the sole purchase surface after this tool succeeds.',
    'Do not call mascot(action="buy") or purchase an item on the user’s behalf.',
    `Reply with exactly "${MASCOT_SHOP_APP_HANDOFF_MESSAGE}" and stop.`,
].join(' ');

const FLASHCARD_CANDIDATE_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const MAX_FLASHCARD_CANDIDATE_SNAPSHOTS = 100;

interface FlashcardCandidateSnapshot {
    createdAt: number;
    cards: Flashcard[];
}

const flashcardCandidateSnapshots = new Map<string, FlashcardCandidateSnapshot>();

function pruneFlashcardCandidateSnapshots(now: number): void {
    for (const [token, snapshot] of flashcardCandidateSnapshots) {
        if (now - snapshot.createdAt > FLASHCARD_CANDIDATE_SNAPSHOT_TTL_MS) {
            flashcardCandidateSnapshots.delete(token);
        }
    }
    while (flashcardCandidateSnapshots.size >= MAX_FLASHCARD_CANDIDATE_SNAPSHOTS) {
        const oldestToken = flashcardCandidateSnapshots.keys().next().value;
        if (typeof oldestToken !== 'string') break;
        flashcardCandidateSnapshots.delete(oldestToken);
    }
}

function storeFlashcardCandidateSnapshot(cards: Flashcard[]): string {
    const now = Date.now();
    pruneFlashcardCandidateSnapshots(now);
    const token = randomUUID();
    flashcardCandidateSnapshots.set(token, {
        createdAt: now,
        cards: cards.map((card) => ({ ...card })),
    });
    return token;
}

function readFlashcardCandidateSnapshot(token: string): Flashcard[] | undefined {
    const now = Date.now();
    pruneFlashcardCandidateSnapshots(now);
    const snapshot = flashcardCandidateSnapshots.get(token);
    if (!snapshot) return undefined;
    return snapshot.cards.map((card) => ({ ...card }));
}

export const MCP_APP_RESOURCE_URIS = {
    flashcard: 'ui://siyuan-sisyphus/flashcard',
    timeline: 'ui://siyuan-sisyphus/timeline',
    mascot: 'ui://siyuan-sisyphus/shop',
} as const;

function createModelFacingAppMeta(resourceUri: string) {
    return {
        ui: {
            resourceUri,
            visibility: ['model'],
        },
        // MCP Apps hosts are required to accept both forms. Keep the legacy
        // key until Claude Desktop and other hosts consistently read the
        // preferred nested `ui.resourceUri` metadata.
        [MCP_APP_LEGACY_RESOURCE_URI_META_KEY]: resourceUri,
    };
}

const FlashcardReviewSessionInputSchema = z.object({
    candidateToken: z.string().uuid(),
    cards: z.array(z.object({
        deckID: z.string().min(1),
        cardID: z.string().min(1),
    }).strict()).min(1).max(20),
    selectionReason: z.string().trim().min(1).max(1000),
}).strict();

const TimelineAppInputSchema = z.object({
    documentId: z.string().trim().min(1).optional(),
    tag: z.string().trim().min(1).optional(),
}).strict().refine((value) => !value.tag || Boolean(value.documentId), {
    message: 'documentId is required when tag is provided.',
});

const MascotShopAppInputSchema = z.object({}).strict();

const FLASHCARD_REVIEW_SESSION_TOOL: ToolDescriptor = {
    name: FLASHCARD_REVIEW_SESSION_TOOL_NAME,
    title: 'Start SiYuan Flashcard Review',
    description: [
        'Open a classic MCP App review session for 1-20 currently due SiYuan flashcards selected by the model.',
        'Immediately before this tool, call flashcard(action="list_cards", scope="all", filter="due").',
        'Copy candidateToken from that result and select only from its exact cards array; do not use get_cards, deck inventories, candidates from an earlier turn, or guessed IDs.',
        'Prioritize cards with more lapses, learning/review states, and older review history while keeping a useful topic mix.',
        'Pass the selected deckID/cardID pairs in the desired review order and briefly explain the selection in selectionReason.',
        'This tool only prepares the UI. Ratings are written through an App-only action tool hidden from the model.',
        FLASHCARD_APP_MODEL_INSTRUCTION,
    ].join(' '),
    inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            candidateToken: {
                type: 'string',
                format: 'uuid',
                description: 'Opaque candidateToken copied unchanged from the immediately preceding flashcard(action="list_cards", scope="all", filter="due") result.',
            },
            cards: {
                type: 'array',
                minItems: 1,
                maxItems: 20,
                description: 'Cards copied only from the exact cards array returned by the immediately preceding flashcard(action="list_cards", scope="all", filter="due") call, in review order.',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        deckID: { type: 'string', minLength: 1 },
                        cardID: { type: 'string', minLength: 1 },
                    },
                    required: ['deckID', 'cardID'],
                },
            },
            selectionReason: {
                type: 'string',
                minLength: 1,
                maxLength: 1000,
                description: 'A concise user-facing explanation of why this batch was selected. Do not quote card prompts or reference answers.',
            },
        },
        required: ['candidateToken', 'cards', 'selectionReason'],
    },
    outputSchema: {
        type: 'object',
        additionalProperties: true,
    },
    annotations: {
        title: 'Start SiYuan Flashcard Review',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    },
    _meta: createModelFacingAppMeta(MCP_APP_RESOURCE_URIS.flashcard),
};

const TIMELINE_APP_TOOL: ToolDescriptor = {
    name: TIMELINE_APP_TOOL_NAME,
    title: 'Open SiYuan Timeline',
    description: [
        'Open exactly one SiYuan Timeline MCP App for the user.',
        TIMELINE_APP_SCOPE_INSTRUCTION,
        'Add tag with documentId to open that historical diff directly.',
        TIMELINE_APP_MODEL_INSTRUCTION,
    ].join(' '),
    inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
            documentId: {
                type: 'string',
                minLength: 1,
                description: 'SiYuan document block ID required for a document timeline. If omitted, the App is global-only and can show only global nodes.',
            },
            tag: { type: 'string', minLength: 1, description: 'Optional timeline tag; requires documentId.' },
        },
    },
    outputSchema: { type: 'object', additionalProperties: true },
    annotations: { title: 'Open SiYuan Timeline', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: createModelFacingAppMeta(MCP_APP_RESOURCE_URIS.timeline),
};

const MASCOT_SHOP_APP_TOOL: ToolDescriptor = {
    name: MASCOT_SHOP_APP_TOOL_NAME,
    title: 'Open Sisyphus Mascot Shop',
    description: ['Open exactly one mascot shop MCP App and hand purchasing to the user.', MASCOT_SHOP_APP_MODEL_INSTRUCTION].join(' '),
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    outputSchema: { type: 'object', additionalProperties: true },
    annotations: { title: 'Open Sisyphus Mascot Shop', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: createModelFacingAppMeta(MCP_APP_RESOURCE_URIS.mascot),
};

const MCP_APP_RESOURCES = [
    {
        app: 'flashcardReview',
        uri: MCP_APP_RESOURCE_URIS.flashcard,
        name: 'siyuan_flashcard_review',
        title: 'SiYuan Flashcard Review',
        description: 'Review SiYuan flashcards, reveal answers, and submit ratings.',
        mimeType: MCP_APP_MIME_TYPE,
    },
    {
        app: 'timeline',
        uri: MCP_APP_RESOURCE_URIS.timeline,
        name: 'siyuan_timeline',
        title: 'SiYuan Timeline',
        description: 'Browse timeline nodes, inspect block diffs, and request rollbacks.',
        mimeType: MCP_APP_MIME_TYPE,
    },
    {
        app: 'mascotShop',
        uri: MCP_APP_RESOURCE_URIS.mascot,
        name: 'siyuan_mascot_shop',
        title: 'Sisyphus Mascot Shop',
        description: 'View the mascot balance and buy food, drinks, and treats.',
        mimeType: MCP_APP_MIME_TYPE,
    },
] as const;

export function supportsMcpApps(capabilities: ClientCapabilities | undefined): boolean {
    const extension = capabilities?.extensions?.[MCP_APPS_EXTENSION_ID] as { mimeTypes?: unknown } | undefined;
    return Array.isArray(extension?.mimeTypes) && extension.mimeTypes.includes(MCP_APP_MIME_TYPE);
}

function buildAppActionTool<Action extends string>(
    sourceName: ToolCategory,
    name: string,
    title: string,
    description: string,
    config: McpAppConfig<Action>,
    variants: Parameters<typeof buildAggregatedTool>[3],
): ToolDescriptor | undefined {
    const tool = buildAggregatedTool(
        sourceName,
        description,
        config,
        variants,
    )[0];
    if (!tool) return undefined;
    return {
        ...tool,
        name,
        title,
        description,
        _meta: {
            ui: { visibility: ['app'] },
        },
    };
}

export function decorateToolsWithMcpApps(
    tools: ToolDescriptor[],
    enabled: boolean,
    appConfig?: McpAppsConfig,
): ToolDescriptor[] {
    if (!enabled || !appConfig) return tools;

    const additions: ToolDescriptor[] = [];
    if (appConfig.timeline.enabled) {
        additions.push({ ...TIMELINE_APP_TOOL });
        const actionTool = buildAppActionTool(
            'timeline', TIMELINE_APP_ACTION_TOOL_NAME, 'SiYuan Timeline App Actions',
            'App-only timeline operations. Hidden from the model and callable only from the Timeline MCP App.',
            appConfig.timeline,
            TIMELINE_VARIANTS.filter((variant) => variant.action in appConfig.timeline.actions),
        );
        if (actionTool) additions.push(actionTool);
    }
    if (appConfig.flashcardReview.enabled) {
        additions.push({ ...FLASHCARD_REVIEW_SESSION_TOOL });
        const actionTool = buildAppActionTool(
            'flashcard', FLASHCARD_REVIEW_APP_ACTION_TOOL_NAME, 'SiYuan Flashcard Review App Actions',
            'App-only flashcard review submission. Hidden from the model and callable only from the Flashcard MCP App.',
            appConfig.flashcardReview,
            FLASHCARD_VARIANTS.filter((variant) => variant.action in appConfig.flashcardReview.actions),
        );
        if (actionTool) additions.push(actionTool);
    }
    if (appConfig.mascotShop.enabled) {
        additions.push({ ...MASCOT_SHOP_APP_TOOL });
        const actionTool = buildAppActionTool(
            'mascot', MASCOT_SHOP_APP_ACTION_TOOL_NAME, 'Sisyphus Mascot Shop App Actions',
            'App-only mascot shop operations. Hidden from the model and callable only from the Shop MCP App.',
            appConfig.mascotShop,
            MASCOT_VARIANTS.filter((variant) => variant.action in appConfig.mascotShop.actions),
        );
        if (actionTool) additions.push(actionTool);
    }
    const existingNames = new Set(tools.map((tool) => tool.name));
    return [...tools, ...additions.filter((tool) => !existingNames.has(tool.name))];
}

export async function callFlashcardReviewSessionTool(
    client: SiYuanClient,
    permMgr: PermissionManager,
    rawArgs: unknown,
    config?: McpAppConfig<FlashcardReviewAppAction>,
) {
    const parsed = FlashcardReviewSessionInputSchema.parse(rawArgs);
    const candidateSnapshot = readFlashcardCandidateSnapshot(parsed.candidateToken);
    if (!candidateSnapshot) {
        throw new Error('The due-card candidate snapshot is missing or expired. Call flashcard(action="list_cards", scope="all", filter="due") again, then copy its new candidateToken and select only from that result.');
    }
    const payload = await createFlashcardReviewSessionData(client, permMgr, {
        cards: parsed.cards,
        selectionReason: parsed.selectionReason,
    }, candidateSnapshot);
    const modelVisibleSummary = {
        action: payload.action,
        presentationMode: FLASHCARD_APP_PRESENTATION_MODE,
        selectedCount: payload.selectedCount,
        omittedCount: payload.omittedCards.length,
        duplicateCount: payload.duplicateCount,
        selectionReason: payload.selectionReason,
        message: FLASHCARD_APP_HANDOFF_MESSAGE,
        modelInstruction: FLASHCARD_APP_MODEL_INSTRUCTION,
    };
    return {
        content: [{
            type: 'text' as const,
            text: JSON.stringify(modelVisibleSummary, null, 2),
        }],
        structuredContent: {
            ...payload,
            presentationMode: FLASHCARD_APP_PRESENTATION_MODE,
            message: FLASHCARD_APP_HANDOFF_MESSAGE,
            modelInstruction: FLASHCARD_APP_MODEL_INSTRUCTION,
        },
        _meta: {
            'io.siyuan-sisyphus/flashcard-review-permissions': {
                appActions: Object.entries(config?.actions ?? { review_card: true }).filter(([, value]) => value).map(([key]) => key),
            },
        },
    };
}

function attachPresentation(
    result: { content: CallToolResult['content']; isError?: boolean; structuredContent?: Record<string, unknown> },
    message: string,
    modelInstruction: string,
    payloadExtras: Record<string, unknown> = {},
) {
    let payload = result.structuredContent;
    if (!payload) {
        const text = result.content.find((item) => item.type === 'text')?.text;
        if (text) {
            try {
                const parsed = JSON.parse(text) as unknown;
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    payload = parsed as Record<string, unknown>;
                }
            } catch {
                // App entry tools normally return JSON. Preserve the existing
                // presentation-only fallback if an action returns plain text.
            }
        }
    }
    const structuredContent = {
        ...(payload ?? {}),
        ...payloadExtras,
        presentationMode: 'mcp-app-only',
        message,
        modelInstruction,
    };
    return {
        ...result,
        content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
    };
}

export async function callTimelineAppTool(
    client: SiYuanClient,
    permMgr: PermissionManager,
    rawArgs: unknown,
    config: McpAppConfig<TimelineAppAction>,
) {
    const parsed = TimelineAppInputSchema.parse(rawArgs ?? {});
    const action = parsed.tag ? 'compare_node' : 'list_nodes';
    if (config.actions[action] !== true) throw new Error(`Timeline App action "${action}" is disabled.`);
    const args = parsed.tag
        ? { action, documentId: parsed.documentId, tag: parsed.tag, page: 1, pageSize: 100 }
        : { action, scope: parsed.documentId ? 'all' : 'global', ...(parsed.documentId ? { documentId: parsed.documentId } : {}), page: 1, pageSize: 50 };
    const result = await callTimelineTool(client, args, config, permMgr);
    return {
        ...attachPresentation(result, TIMELINE_APP_HANDOFF_MESSAGE, TIMELINE_APP_MODEL_INSTRUCTION, { action }),
        _meta: {
            'io.siyuan-sisyphus/timeline-permissions': {
                appActions: Object.entries(config.actions).filter(([, value]) => value).map(([key]) => key),
            },
        },
    };
}

export async function callMascotShopAppTool(
    client: SiYuanClient,
    permMgr: PermissionManager,
    rawArgs: unknown,
    config: McpAppConfig<MascotShopAppAction>,
) {
    MascotShopAppInputSchema.parse(rawArgs ?? {});
    if (config.actions.shop !== true) throw new Error('Mascot Shop App action "shop" is disabled.');
    const result = await callMascotTool(client, { action: 'shop' }, config, permMgr);
    return {
        ...attachPresentation(result, MASCOT_SHOP_APP_HANDOFF_MESSAGE, MASCOT_SHOP_APP_MODEL_INSTRUCTION),
        _meta: {
            'io.siyuan-sisyphus/mascot-shop-permissions': {
                appActions: Object.entries(config.actions).filter(([, value]) => value).map(([key]) => key),
            },
        },
    };
}

export function listMcpAppResources(config?: McpAppsConfig) {
    return MCP_APP_RESOURCES
        .filter((resource) => !config || config[resource.app].enabled)
        .map(({ app: _app, ...resource }) => ({ ...resource }));
}

export function readMcpAppResource(uri: string, config?: McpAppsConfig) {
    const definition = MCP_APP_RESOURCES.find((resource) => resource.uri === uri);
    if (!definition || (config && !config[definition.app].enabled)) return undefined;

    return {
        uri: definition.uri,
        mimeType: MCP_APP_MIME_TYPE,
        text: MCP_APP_HTML,
        _meta: {
            ui: {
                prefersBorder: true,
            },
        },
    };
}

export function compactMcpAppToolResult<T extends {
    content: CallToolResult['content'];
    isError?: boolean;
    structuredContent?: unknown;
    _meta?: Record<string, unknown>;
}>(
    toolName: string,
    action: string,
    result: T,
    enabled: boolean,
    appConfig?: McpAppsConfig,
): T {
    const timelineResult = enabled
        && appConfig?.timeline.enabled
        && (toolName === TIMELINE_APP_TOOL_NAME || toolName === TIMELINE_APP_ACTION_TOOL_NAME)
        ? {
            ...result,
            _meta: {
                ...result._meta,
                'io.siyuan-sisyphus/timeline-permissions': {
                    appActions: Object.entries(appConfig.timeline.actions)
                        .filter(([, actionEnabled]) => actionEnabled)
                        .map(([appAction]) => appAction),
                },
            },
        } as T
        : result;
    if (!enabled || timelineResult.isError || toolName !== 'flashcard' || action !== 'list_cards') {
        return timelineResult;
    }

    const payload = timelineResult.structuredContent && typeof timelineResult.structuredContent === 'object' && !Array.isArray(timelineResult.structuredContent)
        ? timelineResult.structuredContent as Record<string, unknown>
        : {};
    const rawCards = Array.isArray(payload.cards) ? payload.cards : [];
    const isReviewCandidatePool = payload.scope === 'all' && payload.filter === 'due';
    const fallbackDeckID = typeof payload.deckID === 'string' ? payload.deckID : '';
    const snapshotCards: Flashcard[] = [];
    const cards = rawCards.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const card = value as Record<string, unknown>;
        const review = card.review && typeof card.review === 'object' && !Array.isArray(card.review)
            ? card.review as Record<string, unknown>
            : {};
        const deckID = typeof card.deckID === 'string' ? card.deckID : fallbackDeckID;
        const cardID = typeof card.cardID === 'string' ? card.cardID : '';
        if (!deckID || !cardID) return [];
        const prompt = typeof review.prompt === 'string'
            ? review.prompt
            : typeof card.front === 'string'
                ? card.front
                : '';
        if (!prompt.trim()) return [];
        snapshotCards.push(card as Flashcard);
        return [{
            deckID,
            cardID,
            front: prompt,
            ...(card.state !== undefined ? { state: card.state } : {}),
            ...(card.reps !== undefined ? { reps: card.reps } : {}),
            ...(card.lapses !== undefined ? { lapses: card.lapses } : {}),
            ...(card.lastReview !== undefined ? { lastReview: card.lastReview } : {}),
            ...(card.nextDues !== undefined ? { nextDues: card.nextDues } : {}),
        }];
    });
    const summary = {
        action,
        candidateView: isReviewCandidatePool
            ? 'ai-selectable-due-flashcards'
            : 'flashcard-list-not-eligible-for-review-session',
        ...(isReviewCandidatePool
            ? { candidateToken: storeFlashcardCandidateSnapshot(snapshotCards) }
            : {}),
        cardCount: cards.length,
        unreviewedCount: payload?.unreviewedCount ?? payload?.total ?? cards.length,
        scope: payload?.scope,
        filter: payload?.filter,
        cards,
        selectionGuidance: isReviewCandidatePool
            ? `This candidateToken and exact cards array form a fixed snapshot and are the only eligible source for the next review session. Select 1-20 cards from it, preserve candidateToken and every deckID/cardID exactly, and call flashcard_review_session immediately. Do not use get_cards, deck inventories, earlier results, or guessed IDs. Prefer higher lapses and older review history while keeping a useful topic mix. After flashcard_review_session succeeds, the MCP App becomes the sole review surface: do not restate cards, start Q1, ask for chat answers, or rate cards yourself; reply exactly "${FLASHCARD_APP_HANDOFF_MESSAGE}" and stop.`
            : 'This result cannot start a review session. Call flashcard(action="list_cards", scope="all", filter="due") to obtain an eligible cards snapshot and candidateToken.',
    };
    return {
        ...timelineResult,
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary,
    };
}

/** Final projection every transport applies before handing a tool result to the client. */
export function finalizeToolResult(
    name: string,
    action: string,
    result: ToolResult,
    appsEnabled: boolean,
    config: Pick<ToolConfig, 'mcpApps'>,
): CallToolResult {
    return compactMcpAppToolResult(name, action, withStructuredContent(result), appsEnabled, config.mcpApps);
}

/** Run an App session tool; failures become the same tool-error shape as any other tool. */
export async function executeAppTool(
    name: string,
    plan: Extract<ToolCallPlan, { kind: 'app' }>,
    client: SiYuanClient,
    permMgr: PermissionManager,
    input: unknown,
): Promise<CallToolResult> {
    try {
        const result = plan.app === 'flashcard'
            ? await callFlashcardReviewSessionTool(client, permMgr, input, plan.config as never)
            : plan.app === 'timeline'
                ? await callTimelineAppTool(client, permMgr, input, plan.config as never)
                : await callMascotShopAppTool(client, permMgr, input, plan.config as never);
        return withStructuredContent(result as ToolResult);
    } catch (error) {
        return withStructuredContent(createErrorResult(error, { tool: name }));
    }
}
