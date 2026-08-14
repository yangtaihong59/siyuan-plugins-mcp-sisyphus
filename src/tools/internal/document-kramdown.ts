import * as blockApi from '../../api/block';
import type { SiYuanClient } from '../../api/client';
import { APPROX_TOKEN_MODE, approximateTokensFromChars } from '../../shared/token-estimate';
import { joinEditableMarkdownBlocks, toEditableMarkdownBlock } from './kramdown-safe';

export interface OrderedDocumentBlock {
    id: string;
    type?: string;
    subtype?: string;
}

export interface DocumentBlockWindowOptions {
    blockStart?: number;
    blockLimit?: number;
    tokenBudget?: number;
    includeBlockIds?: boolean;
}

export interface DocumentOutlineItem {
    blockIndex: number;
    level: number;
    title: string;
    id?: string;
}

export interface DocumentBlockRef {
    blockIndex: number;
    id: string;
    type?: string;
    subtype?: string;
}

export interface DocumentBlockWindow {
    content: string;
    outline: DocumentOutlineItem[];
    blockStart: number;
    blockLimit: number;
    returnedBlocks: number;
    totalBlocks: number;
    tokenBudget: number;
    estimatedTokens: number;
    tokenMode: typeof APPROX_TOKEN_MODE;
    truncated: boolean;
    hasNextWindow: boolean;
    nextBlockStart?: number;
    budgetExceeded?: boolean;
    blockRefs?: DocumentBlockRef[];
}

export const DEFAULT_DOCUMENT_BLOCK_LIMIT = 50;
export const DEFAULT_DOCUMENT_TOKEN_BUDGET = 2000;
const SOFT_DOCUMENT_TOKEN_BUDGET_RATIO = 1.15;

const SELF_CONTAINED_BLOCK_TYPES = new Set([
    'l',
    'b',
    'callout',
    's',
    't',
    'table',
    'tb',
    'av',
    'code',
    'c',
    'math',
    'm',
    'html',
    'iframe',
    'widget',
    'query_embed',
]);

function normalizeBlockType(type: string | undefined): string | undefined {
    if (!type) return undefined;
    const normalized = type.trim();
    if (!normalized) return undefined;
    const lower = normalized.toLowerCase();
    if (!lower.startsWith('node')) return normalized;
    if (lower.includes('paragraph')) return 'p';
    if (lower.includes('heading')) return 'h';
    if (lower.includes('listitem')) return 'i';
    if (lower.includes('list')) return 'l';
    if (lower.includes('blockquote')) return 'b';
    if (lower.includes('callout')) return 'callout';
    if (lower.includes('superblock')) return 's';
    if (lower.includes('table')) return 't';
    if (lower.includes('codeblock')) return 'c';
    if (lower.includes('mathblock')) return 'm';
    if (lower.includes('attributeview')) return 'av';
    if (lower.includes('htmlblock')) return 'html';
    if (lower.includes('iframe')) return 'iframe';
    if (lower.includes('widget')) return 'widget';
    if (lower.includes('video')) return 'video';
    if (lower.includes('audio')) return 'audio';
    if (lower.includes('blockqueryembed')) return 'query_embed';
    if (lower.includes('thematicbreak')) return 'tb';
    return normalized;
}

function toOrderedBlock(value: unknown): OrderedDocumentBlock | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (!id) return null;
    return {
        id,
        type: normalizeBlockType(typeof record.type === 'string' ? record.type : undefined),
        subtype: typeof record.subtype === 'string' ? record.subtype : undefined,
    };
}

function blockContainsChildrenInOwnKramdown(block: OrderedDocumentBlock): boolean {
    return Boolean(block.type && SELF_CONTAINED_BLOCK_TYPES.has(block.type));
}

async function collectDocumentBlocksInTreeOrder(
    client: SiYuanClient,
    parentId: string,
    output: OrderedDocumentBlock[],
    visited: Set<string>,
): Promise<void> {
    const children = await blockApi.getChildBlocks(client, parentId);
    for (const child of children) {
        const block = toOrderedBlock(child);
        if (!block) continue;
        if (visited.has(block.id)) continue;
        visited.add(block.id);
        output.push(block);
        if (!blockContainsChildrenInOwnKramdown(block)) {
            await collectDocumentBlocksInTreeOrder(client, block.id, output, visited);
        }
    }
}

export async function listDocumentBlocksInTreeOrder(client: SiYuanClient, documentId: string): Promise<OrderedDocumentBlock[]> {
    const blocks: OrderedDocumentBlock[] = [];
    await collectDocumentBlocksInTreeOrder(client, documentId, blocks, new Set([documentId]));
    return blocks;
}

function headingLevel(block: OrderedDocumentBlock, markdown: string): number | undefined {
    const subtypeMatch = block.subtype?.match(/^h([1-6])$/i);
    if (subtypeMatch) return Number(subtypeMatch[1]);
    const markdownMatch = markdown.match(/^\s{0,3}(#{1,6})\s+/);
    return markdownMatch?.[1].length;
}

function headingTitle(markdown: string): string | undefined {
    const firstLine = markdown.split(/\r?\n/, 1)[0] ?? '';
    const match = firstLine.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    return match?.[1]?.trim() || undefined;
}

function buildOutline(
    blocks: OrderedDocumentBlock[],
    markdownBlocks: string[],
    includeBlockIds: boolean,
): DocumentOutlineItem[] {
    const outline: DocumentOutlineItem[] = [];
    blocks.forEach((block, blockIndex) => {
        if (block.type !== 'h') return;
        const markdown = markdownBlocks[blockIndex] ?? '';
        const level = headingLevel(block, markdown);
        const title = headingTitle(markdown);
        if (!level || !title) return;
        outline.push({
            blockIndex,
            level,
            title,
            ...(includeBlockIds ? { id: block.id } : {}),
        });
    });
    return outline;
}

function buildWindowFromMarkdownBlocks(
    blocks: OrderedDocumentBlock[],
    markdownBlocks: string[],
    options: DocumentBlockWindowOptions,
): DocumentBlockWindow {
    const blockStart = options.blockStart ?? 0;
    const blockLimit = options.blockLimit ?? DEFAULT_DOCUMENT_BLOCK_LIMIT;
    const tokenBudget = options.tokenBudget ?? DEFAULT_DOCUMENT_TOKEN_BUDGET;
    const includeBlockIds = options.includeBlockIds ?? false;
    const totalBlocks = blocks.length;
    const contentParts: string[] = [];
    const selectedRefs: DocumentBlockRef[] = [];
    let returnedBlocks = 0;
    let contentChars = 0;
    let containsBody = false;

    if (blockStart < totalBlocks) {
        const end = Math.min(totalBlocks, blockStart + blockLimit);
        for (let blockIndex = blockStart; blockIndex < end; blockIndex += 1) {
            const markdown = markdownBlocks[blockIndex] ?? '';
            const separatorChars = markdown.length > 0 && contentParts.length > 0 ? 2 : 0;
            const nextChars = contentChars + separatorChars + markdown.length;
            const nextTokens = approximateTokensFromChars(nextChars);
            const exceedsBudget = nextTokens > tokenBudget;
            const isHeading = blocks[blockIndex]?.type === 'h';
            const isLeadingHeadingOrFirstBody = contentParts.length > 0 && !containsBody;
            const withinSoftBudget = nextTokens <= Math.ceil(tokenBudget * SOFT_DOCUMENT_TOKEN_BUDGET_RATIO);

            if (markdown.length > 0 && exceedsBudget && contentParts.length > 0 && !isLeadingHeadingOrFirstBody && !withinSoftBudget) break;

            returnedBlocks += 1;
            if (includeBlockIds) {
                const block = blocks[blockIndex];
                selectedRefs.push({
                    blockIndex,
                    id: block.id,
                    ...(block.type ? { type: block.type } : {}),
                    ...(block.subtype ? { subtype: block.subtype } : {}),
                });
            }
            if (markdown.length > 0) {
                contentParts.push(markdown);
                contentChars = nextChars;
                if (!isHeading) containsBody = true;
            }
            if (exceedsBudget && containsBody) break;
        }
    }

    const estimatedTokens = approximateTokensFromChars(contentChars);
    const nextBlockStart = blockStart + returnedBlocks;
    const hasNextWindow = nextBlockStart < totalBlocks;
    return {
        content: contentParts.join('\n\n'),
        outline: buildOutline(blocks, markdownBlocks, includeBlockIds),
        blockStart,
        blockLimit,
        returnedBlocks,
        totalBlocks,
        tokenBudget,
        estimatedTokens,
        tokenMode: APPROX_TOKEN_MODE,
        truncated: hasNextWindow,
        hasNextWindow,
        ...(hasNextWindow ? { nextBlockStart } : {}),
        ...(estimatedTokens > tokenBudget ? { budgetExceeded: true } : {}),
        ...(includeBlockIds ? { blockRefs: selectedRefs } : {}),
    };
}

function extractSyntheticOutline(markdown: string): DocumentOutlineItem[] {
    const outline: DocumentOutlineItem[] = [];
    let fence: { marker: '`' | '~'; length: number } | null = null;
    for (const line of markdown.split(/\r?\n/)) {
        const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fenceMatch) {
            const marker = fenceMatch[1][0] as '`' | '~';
            if (!fence) fence = { marker, length: fenceMatch[1].length };
            else if (marker === fence.marker && fenceMatch[1].length >= fence.length) fence = null;
            continue;
        }
        if (fence) continue;
        const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
        if (!match) continue;
        outline.push({ blockIndex: 0, level: match[1].length, title: match[2].trim() });
    }
    return outline;
}

export function createSyntheticDocumentBlockWindow(
    content: string,
    options: DocumentBlockWindowOptions = {},
): DocumentBlockWindow {
    const blocks = content.length > 0 ? [{ id: 'synthetic', type: 'p' }] : [];
    const window = buildWindowFromMarkdownBlocks(blocks, content.length > 0 ? [content] : [], {
        ...options,
        includeBlockIds: false,
    });
    return {
        ...window,
        outline: extractSyntheticOutline(content),
    };
}

export async function readDocumentBlockWindow(
    client: SiYuanClient,
    documentId: string,
    options: DocumentBlockWindowOptions = {},
    knownBlocks?: OrderedDocumentBlock[],
): Promise<DocumentBlockWindow> {
    const blocks = knownBlocks ?? await listDocumentBlocksInTreeOrder(client, documentId);
    const markdownBlocks = await Promise.all(blocks.map(async (block) => {
        const result = await blockApi.getBlockKramdown(client, block.id);
        return toEditableMarkdownBlock({
            kramdown: typeof result.kramdown === 'string' ? result.kramdown : '',
            type: block.type,
        });
    }));
    return buildWindowFromMarkdownBlocks(blocks, markdownBlocks, options);
}

export async function readDocumentEditableMarkdown(
    client: SiYuanClient,
    documentId: string,
    knownBlocks?: OrderedDocumentBlock[],
): Promise<string> {
    const blocks = knownBlocks ?? await listDocumentBlocksInTreeOrder(client, documentId);
    if (blocks.length === 0) return '';

    const kramdownBlocks = await Promise.all(blocks.map(async (block) => {
        const result = await blockApi.getBlockKramdown(client, block.id);
        return {
            kramdown: typeof result.kramdown === 'string' ? result.kramdown : '',
            type: block.type,
        };
    }));

    return joinEditableMarkdownBlocks(kramdownBlocks);
}

export async function readDocumentKramdownMarkdown(
    client: SiYuanClient,
    documentId: string,
    knownBlocks?: OrderedDocumentBlock[],
): Promise<string> {
    return readDocumentEditableMarkdown(client, documentId, knownBlocks);
}
