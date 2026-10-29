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
    blockLimit?: number;
    returnedBlocks: number;
    totalBlocks: number | null;
    outlineScope?: 'window';
    limitReason?: 'content_bytes' | 'block_limit' | 'token_budget';
    contentBytes?: number;
    maxContentBytes?: number;
    tokenBudget?: number;
    estimatedTokens: number;
    tokenMode: typeof APPROX_TOKEN_MODE;
    truncated: boolean;
    hasNextWindow: boolean;
    nextBlockStart?: number;
    budgetExceeded?: boolean;
    blockRefs?: DocumentBlockRef[];
}

export const MAX_DOCUMENT_CONTENT_BYTES = 256 * 1024;
export const MAX_DOCUMENT_RESPONSE_BYTES = 1024 * 1024;
const MAX_WINDOW_BLOCKS = 2000;
const MAX_SCANNED_BLOCKS = 50000;
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
    const blockLimit = options.blockLimit ?? MAX_WINDOW_BLOCKS;
    const tokenBudget = options.tokenBudget ?? Infinity;
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
        blockLimit: options.blockLimit,
        returnedBlocks,
        totalBlocks,
        tokenBudget: options.tokenBudget,
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
    if (new TextEncoder().encode(content).byteLength > MAX_DOCUMENT_CONTENT_BYTES) {
        throw new Error('Virtual document exceeds the 256 KiB content limit. Narrow the content before reading.');
    }
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

// Enumerate lazily: a window must not recursively load the whole document first.
async function* iterateDocumentBlocks(client: SiYuanClient, documentId: string): AsyncGenerator<OrderedDocumentBlock> {
    const visited = new Set([documentId]);
    let metadataBytes = 0;
    async function* visit(id: string, depth: number): AsyncGenerator<OrderedDocumentBlock> {
        if (depth > 128) throw new Error('Document nesting exceeds the safe read depth (128). Read a narrower subtree.');
        const children = await blockApi.getChildBlocks(client, id, MAX_DOCUMENT_RESPONSE_BYTES);
        metadataBytes += new TextEncoder().encode(JSON.stringify(children)).byteLength;
        if (metadataBytes > 4 * MAX_DOCUMENT_RESPONSE_BYTES) throw new Error('Document enumeration exceeds the 4 MiB metadata limit. Read a narrower subtree.');
        for (const child of children) {
            const block = toOrderedBlock(child);
            if (!block || visited.has(block.id)) continue;
            if (visited.size > MAX_SCANNED_BLOCKS) throw new Error('Document enumeration exceeds the 50000-block safety limit. Read a narrower subtree.');
            visited.add(block.id);
            yield block;
            if (!blockContainsChildrenInOwnKramdown(block)) yield* visit(block.id, depth + 1);
        }
    }
    yield* visit(documentId, 0);
}

export async function readDocumentBlockWindow(
    client: SiYuanClient,
    documentId: string,
    options: DocumentBlockWindowOptions = {},
    knownBlocks?: OrderedDocumentBlock[],
): Promise<DocumentBlockWindow> {
    const blockStart = options.blockStart ?? 0;
    const limit = options.blockLimit ?? MAX_WINDOW_BLOCKS;
    const budget = options.tokenBudget ?? Infinity;
    const blocks: OrderedDocumentBlock[] = [];
    const markdownBlocks: string[] = [];
    let blockIndex = 0;
    let contentBytes = 0;
    let contentChars = 0;
    let containsBody = false;
    let nonEmptyBlocks = 0;
    let limitReason: DocumentBlockWindow['limitReason'];
    for await (const block of knownBlocks ?? iterateDocumentBlocks(client, documentId)) {
        if (blockIndex < blockStart) { blockIndex++; continue; }
        if (blocks.length >= limit) { limitReason = 'block_limit'; break; }
        if (containsBody && approximateTokensFromChars(contentChars) > budget) { limitReason = 'token_budget'; break; }
        // Only one bounded request is in flight. Never prefetch the rest of the document.
        const result = await blockApi.getBlockKramdown(client, block.id, MAX_DOCUMENT_RESPONSE_BYTES);
        const markdown = toEditableMarkdownBlock({ kramdown: typeof result.kramdown === 'string' ? result.kramdown : '', type: block.type });
        const bytes = new TextEncoder().encode(markdown).byteLength;
        if (bytes > MAX_DOCUMENT_CONTENT_BYTES) {
            if (blocks.length) { limitReason = 'content_bytes'; break; }
            throw new Error(`Block ${block.id} exceeds the 256 KiB content limit. Inspect or split this block before reading; it cannot be returned whole safely.`);
        }
        const separator = markdown.length && nonEmptyBlocks ? 2 : 0;
        const nextBytes = contentBytes + separator + bytes;
        const nextChars = contentChars + separator + markdown.length;
        const nextTokens = approximateTokensFromChars(nextChars);
        if (nextBytes > MAX_DOCUMENT_CONTENT_BYTES) { limitReason = 'content_bytes'; break; }
        if (markdown.length && nextTokens > budget && nonEmptyBlocks && containsBody
            && nextTokens > Math.ceil(budget * SOFT_DOCUMENT_TOKEN_BUDGET_RATIO)) {
            limitReason = 'token_budget'; break;
        }
        blocks.push(block);
        markdownBlocks.push(markdown);
        contentBytes = nextBytes;
        contentChars = nextChars;
        blockIndex++;
        if (markdown.length) {
            nonEmptyBlocks++;
            if (block.type !== 'h') containsBody = true;
        }
    }
    const hasNextWindow = limitReason !== undefined;
    const estimatedTokens = approximateTokensFromChars(contentChars);
    return {
        content: markdownBlocks.filter(Boolean).join('\n\n'),
        outline: buildOutline(blocks, markdownBlocks, options.includeBlockIds ?? false)
            .map(item => ({ ...item, blockIndex: item.blockIndex + blockStart })),
        outlineScope: 'window',
        blockStart,
        blockLimit: options.blockLimit,
        returnedBlocks: blocks.length,
        totalBlocks: hasNextWindow ? null : blockIndex,
        tokenBudget: options.tokenBudget,
        estimatedTokens,
        tokenMode: APPROX_TOKEN_MODE,
        contentBytes,
        maxContentBytes: MAX_DOCUMENT_CONTENT_BYTES,
        truncated: hasNextWindow,
        hasNextWindow,
        ...(hasNextWindow ? { nextBlockStart: blockStart + blocks.length, limitReason } : {}),
        ...(estimatedTokens > budget ? { budgetExceeded: true } : {}),
        ...(options.includeBlockIds ? { blockRefs: blocks.map((block, index) => ({ ...block, blockIndex: blockStart + index })) } : {}),
    };
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

