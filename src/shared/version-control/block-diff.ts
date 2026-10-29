/** Block-level diff and restore planning between two snapshot versions; parsing and file bucketing live in snapshot-parse / snapshot-files. */
import { escapeRegExp } from '../text';
import { getDocumentIdFromSnapshotFile } from './snapshot-files';
import { isCodeBlock, isMathBlock, parseSnapshotBlocks } from './snapshot-parse';
import type { BlockDiffEntry, BlockDiffLineStats, BlockDiffStatus, InlineDiffKind, InlineDiffPart, RestoreAnchorSource, RestoreBlockPayload, RestoreInsertPlan, SnapshotBlock } from './snapshot-types';

export * from './snapshot-types';
export { parseSnapshotBlocks } from './snapshot-parse';
export { buildChangedFiles, getDocumentIdFromSnapshotFile, getFileTitle, getSnapshotFileId } from './snapshot-files';

const SIMPLE_BLOCK_TYPES = new Set(['p', 'h', 'i', 'l', 'c', 'm', 'b', 's', 't']);

export function diffSnapshotBlocks(oldContent: string, newContent: string): BlockDiffEntry[] {
    return diffBlocks(parseSnapshotBlocks(oldContent), parseSnapshotBlocks(newContent));
}

export function getBlockDiffLineStats(entries: BlockDiffEntry[]): BlockDiffLineStats {
    return entries.reduce<BlockDiffLineStats>((stats, entry) => {
        const entryStats = getEntryLineStats(entry);
        return {
            added: stats.added + entryStats.added,
            removed: stats.removed + entryStats.removed,
        };
    }, { added: 0, removed: 0 });
}

export function diffBlocks(oldBlocks: SnapshotBlock[], newBlocks: SnapshotBlock[]): BlockDiffEntry[] {
    const oldMatched = new Set<number>();
    const newMatched = new Set<number>();
    const entries: BlockDiffEntry[] = [];

    for (let newIndex = 0; newIndex < newBlocks.length; newIndex += 1) {
        const newBlock = newBlocks[newIndex];
        const oldIndex = findBestOldBlock(newBlock, oldBlocks, oldMatched);

        if (oldIndex < 0) {
            entries.push(createEntry('added', undefined, newBlock));
            newMatched.add(newIndex);
            continue;
        }

        const oldBlock = oldBlocks[oldIndex];
        oldMatched.add(oldIndex);
        newMatched.add(newIndex);
        entries.push(createEntry(blocksEqual(oldBlock, newBlock) ? 'unchanged' : 'modified', oldBlock, newBlock));
    }

    for (let oldIndex = 0; oldIndex < oldBlocks.length; oldIndex += 1) {
        if (!oldMatched.has(oldIndex)) {
            entries.push(createEntry('removed', oldBlocks[oldIndex], undefined));
        }
    }

    return entries.sort((a, b) => {
        const order = Math.min(a.oldBlock?.order ?? Infinity, a.newBlock?.order ?? Infinity) - Math.min(b.oldBlock?.order ?? Infinity, b.newBlock?.order ?? Infinity);
        if (order !== 0) return order;
        return statusRank(a.status) - statusRank(b.status);
    });
}

export function isSimpleAcceptableBlock(block?: SnapshotBlock): boolean {
    if (!block) return false;
    if (!block.id && !block.markdown.trim()) return false;
    if (!block.type) return true;
    return SIMPLE_BLOCK_TYPES.has(block.type);
}

export function getRestoreParentCandidates(entry: BlockDiffEntry, source?: RestoreAnchorSource): string[] {
    const candidates = [
        entry.oldBlock?.parentID,
        entry.oldBlock?.rootID,
        entry.newBlock?.parentID,
        entry.newBlock?.rootID,
        source?.documentId,
        getDocumentIdFromSnapshotFile(source?.newFile),
        getDocumentIdFromSnapshotFile(source?.oldFile),
    ];
    return candidates.filter((value, index, arr): value is string => {
        return typeof value === 'string' && value.length > 0 && arr.indexOf(value) === index;
    });
}

export function getRestoreInsertPlan(
    entry: BlockDiffEntry,
    entries: BlockDiffEntry[],
    source?: RestoreAnchorSource,
): RestoreInsertPlan {
    const parentIDs = getRestoreParentCandidates(entry, source);
    const nextID = findNearestCurrentSibling(entry, entries, 'after');
    const previousID = findNearestCurrentSibling(entry, entries, 'before');
    return {
        parentIDs,
        ...(nextID ? { nextID } : {}),
        ...(previousID ? { previousID } : {}),
    };
}

export function getRestoreBlockPayload(entry: BlockDiffEntry): RestoreBlockPayload {
    const block = entry.oldBlock;
    if (!block) return { dataType: 'markdown', data: '' };

    const rawDom = typeof block.raw === 'string' ? block.raw.trim() : '';
    if (shouldWriteRawDom(block, block.id, rawDom)) {
        return {
            dataType: 'dom',
            data: rawDom.replace(/data-node-id=(["'])[^"']+\1/i, `data-node-id="${block.id}"`),
            id: block.id,
        };
    }

    const markdown = block.markdown || block.text;
    return {
        dataType: 'markdown',
        data: block.id ? withBlockIdIal(markdown, block.id) : markdown,
        ...(block.id ? { id: block.id } : {}),
    };
}

export function getUpdateBlockPayload(entry: BlockDiffEntry): RestoreBlockPayload {
    const block = entry.oldBlock;
    if (!block) return { dataType: 'markdown', data: '' };

    const rawDom = typeof block.raw === 'string' ? block.raw.trim() : '';
    if (shouldWriteRawDom(block, entry.newBlock?.id, rawDom)) {
        return {
            dataType: 'dom',
            data: rawDom.replace(/data-node-id=(["'])[^"']+\1/i, `data-node-id="${entry.newBlock.id}"`),
            id: entry.newBlock.id,
        };
    }

    const markdown = block.markdown || block.text;
    if (isCodeBlock(block.type, block.subtype)) {
        return {
            dataType: 'markdown',
            data: extractFencedCodeBody(markdown),
            ...(block.id ? { id: block.id } : {}),
        };
    }

    if (isMathBlock(block.type, block.subtype)) {
        return {
            dataType: 'markdown',
            data: extractMathBlockBody(markdown),
            ...(block.id ? { id: block.id } : {}),
        };
    }

    return {
        dataType: 'markdown',
        data: markdown,
        ...(block.id ? { id: block.id } : {}),
    };
}

function createEntry(status: BlockDiffStatus, oldBlock?: SnapshotBlock, newBlock?: SnapshotBlock): BlockDiffEntry {
    const target = newBlock ?? oldBlock;
    const canAcceptBlock = status !== 'unchanged' && (
        status === 'removed'
            ? isSimpleAcceptableBlock(oldBlock)
            : isSimpleAcceptableBlock(target)
    );
    const inlineParts = status === 'modified' && oldBlock && newBlock
        ? diffInlineParts(oldBlock.markdown || oldBlock.text, newBlock.markdown || newBlock.text)
        : undefined;
    return {
        key: `${status}:${oldBlock?.id ?? oldBlock?.order ?? 'none'}:${newBlock?.id ?? newBlock?.order ?? 'none'}`,
        status,
        oldBlock,
        newBlock,
        ...(inlineParts ? { oldParts: inlineParts.oldParts, newParts: inlineParts.newParts } : {}),
        canAcceptBlock,
        ...(canAcceptBlock ? {} : { acceptReason: status === 'unchanged' ? '内容未变化' : '复杂块仅支持查看或整篇回档' }),
    };
}

function shouldWriteRawDom(block: SnapshotBlock, targetId: string | undefined, rawDom: string): targetId is string {
    if (!targetId || !rawDom || !/data-node-id=["'][^"']+["']/i.test(rawDom)) return false;
    return isCodeBlock(block.type, block.subtype);
}

function getEntryLineStats(entry: BlockDiffEntry): BlockDiffLineStats {
    if (entry.status === 'unchanged') return { added: 0, removed: 0 };
    if (entry.status === 'added') return { added: countDisplayLines(getBlockDisplayText(entry.newBlock)), removed: 0 };
    if (entry.status === 'removed') return { added: 0, removed: countDisplayLines(getBlockDisplayText(entry.oldBlock)) };

    if (entry.oldParts || entry.newParts) {
        return {
            added: countChangedPartLines(entry.newParts, 'added'),
            removed: countChangedPartLines(entry.oldParts, 'removed'),
        };
    }

    return {
        added: countDisplayLines(getBlockDisplayText(entry.newBlock)),
        removed: countDisplayLines(getBlockDisplayText(entry.oldBlock)),
    };
}

function getBlockDisplayText(block: SnapshotBlock | undefined): string {
    return block?.markdown || block?.text || '';
}

function countDisplayLines(value: string): number {
    if (!value) return 0;
    return value.replace(/\r\n/g, '\n').replace(/\n$/u, '').split('\n').length;
}

function countChangedPartLines(parts: InlineDiffPart[] | undefined, kind: InlineDiffKind): number {
    if (!parts?.length) return 0;
    const changedLines = new Set<number>();
    let lineIndex = 0;

    for (const part of parts) {
        const lineBreaks = (part.text.match(/\n/g) ?? []).length;
        if (part.kind === kind && part.text.length > 0) {
            for (let offset = 0; offset <= lineBreaks; offset += 1) {
                changedLines.add(lineIndex + offset);
            }
        }
        lineIndex += lineBreaks;
    }

    return changedLines.size;
}

function diffInlineParts(oldText: string, newText: string): { oldParts: InlineDiffPart[]; newParts: InlineDiffPart[] } {
    const oldTokens = tokenizeInlineDiff(oldText);
    const newTokens = tokenizeInlineDiff(newText);
    const matches = buildLcsMatches(oldTokens, newTokens);
    const oldParts: InlineDiffPart[] = [];
    const newParts: InlineDiffPart[] = [];
    let oldIndex = 0;
    let newIndex = 0;

    for (const match of matches) {
        appendDiffPart(oldParts, oldTokens.slice(oldIndex, match.oldIndex).join(''), 'removed');
        appendDiffPart(newParts, newTokens.slice(newIndex, match.newIndex).join(''), 'added');
        appendDiffPart(oldParts, oldTokens[match.oldIndex], 'same');
        appendDiffPart(newParts, newTokens[match.newIndex], 'same');
        oldIndex = match.oldIndex + 1;
        newIndex = match.newIndex + 1;
    }

    appendDiffPart(oldParts, oldTokens.slice(oldIndex).join(''), 'removed');
    appendDiffPart(newParts, newTokens.slice(newIndex).join(''), 'added');

    return { oldParts, newParts };
}

function tokenizeInlineDiff(value: string): string[] {
    const tokens: string[] = [];
    let buffer = '';
    let bufferKind: 'word' | 'space' | 'punctuation' | undefined;

    for (const char of Array.from(value)) {
        if (isCjkChar(char)) {
            flushInlineBuffer(tokens, buffer);
            buffer = '';
            bufferKind = undefined;
            tokens.push(char);
            continue;
        }

        const kind = getInlineTokenKind(char);
        if (bufferKind && bufferKind !== kind) {
            flushInlineBuffer(tokens, buffer);
            buffer = '';
        }
        buffer += char;
        bufferKind = kind;
    }

    flushInlineBuffer(tokens, buffer);
    return tokens;
}

function flushInlineBuffer(tokens: string[], value: string): void {
    if (value) tokens.push(value);
}

function getInlineTokenKind(char: string): 'word' | 'space' | 'punctuation' {
    if (/\s/u.test(char)) return 'space';
    if (/[\p{L}\p{N}_-]/u.test(char)) return 'word';
    return 'punctuation';
}

function isCjkChar(char: string): boolean {
    return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char);
}

function buildLcsMatches(oldTokens: string[], newTokens: string[]): Array<{ oldIndex: number; newIndex: number }> {
    const rows = oldTokens.length + 1;
    const cols = newTokens.length + 1;
    const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

    for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
        for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
            matrix[oldIndex][newIndex] = oldTokens[oldIndex] === newTokens[newIndex]
                ? matrix[oldIndex + 1][newIndex + 1] + 1
                : Math.max(matrix[oldIndex + 1][newIndex], matrix[oldIndex][newIndex + 1]);
        }
    }

    const matches: Array<{ oldIndex: number; newIndex: number }> = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldTokens.length && newIndex < newTokens.length) {
        if (oldTokens[oldIndex] === newTokens[newIndex]) {
            matches.push({ oldIndex, newIndex });
            oldIndex += 1;
            newIndex += 1;
        } else if (matrix[oldIndex + 1][newIndex] >= matrix[oldIndex][newIndex + 1]) {
            oldIndex += 1;
        } else {
            newIndex += 1;
        }
    }

    return matches;
}

function appendDiffPart(parts: InlineDiffPart[], text: string, kind: InlineDiffKind): void {
    if (!text) return;
    const previous = parts[parts.length - 1];
    if (previous?.kind === kind) {
        previous.text += text;
        return;
    }
    parts.push({ text, kind });
}

function findNearestCurrentSibling(
    entry: BlockDiffEntry,
    entries: BlockDiffEntry[],
    direction: 'before' | 'after',
): string | undefined {
    const oldBlock = entry.oldBlock;
    if (!oldBlock) return undefined;
    const candidates = entries
        .filter((candidate) => {
            if (candidate === entry || !candidate.newBlock?.id || !candidate.oldBlock) return false;
            if (!sameRestoreScope(oldBlock, candidate.oldBlock)) return false;
            return direction === 'before'
                ? candidate.oldBlock.order < oldBlock.order
                : candidate.oldBlock.order > oldBlock.order;
        })
        .sort((left, right) => {
            return direction === 'before'
                ? right.oldBlock!.order - left.oldBlock!.order
                : left.oldBlock!.order - right.oldBlock!.order;
        });
    return candidates[0]?.newBlock?.id;
}

function sameRestoreScope(left: SnapshotBlock, right: SnapshotBlock): boolean {
    const leftParent = left.parentID || left.rootID || '';
    const rightParent = right.parentID || right.rootID || '';
    if (!leftParent || !rightParent) return left.depth === right.depth;
    return leftParent === rightParent;
}

function findBestOldBlock(newBlock: SnapshotBlock, oldBlocks: SnapshotBlock[], oldMatched: Set<number>): number {
    if (newBlock.id) {
        const exactIndex = oldBlocks.findIndex((oldBlock, index) => !oldMatched.has(index) && oldBlock.id === newBlock.id);
        if (exactIndex >= 0) return exactIndex;
    }

    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < oldBlocks.length; index += 1) {
        if (oldMatched.has(index)) continue;
        const score = similarity(normalizeText(oldBlocks[index].text), normalizeText(newBlock.text));
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }

    return bestScore >= 0.72 ? bestIndex : -1;
}

function blocksEqual(left: SnapshotBlock, right: SnapshotBlock): boolean {
    return normalizeText(left.markdown || left.text) === normalizeText(right.markdown || right.text)
        && (left.type ?? '') === (right.type ?? '')
        && (left.subtype ?? '') === (right.subtype ?? '');
}

function withBlockIdIal(markdown: string, id: string): string {
    const trimmed = markdown.trimEnd();
    if (!trimmed) return `{: id="${id}"}`;
    if (new RegExp(`\\{:\\s+id=["']${escapeRegExp(id)}["']\\s*\\}\\s*$`, 'i').test(trimmed)) {
        return trimmed;
    }
    return `${trimmed}\n{: id="${id}"}`;
}

function extractFencedCodeBody(markdown: string): string {
    const match = markdown.match(/^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*(?:\{:[^}]+\}\s*)?$/);
    return match ? match[2] : markdown;
}

function extractMathBlockBody(markdown: string): string {
    const match = markdown.match(/^\s*\$\$\s*\n?([\s\S]*?)\n?\$\$\s*(?:\{:[^}]+\}\s*)?$/);
    return match ? match[1] : markdown;
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function similarity(left: string, right: string): number {
    if (!left || !right) return 0;
    if (left === right) return 1;
    const maxLength = Math.max(left.length, right.length);
    if (maxLength === 0) return 1;
    return 1 - levenshtein(left, right, 120) / maxLength;
}

function levenshtein(left: string, right: string, cap: number): number {
    const a = left.slice(0, cap);
    const b = right.slice(0, cap);
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = new Array(b.length + 1);

    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous.splice(0, previous.length, ...current);
    }

    return previous[b.length] + Math.abs(left.length - a.length) + Math.abs(right.length - b.length);
}

function statusRank(status: BlockDiffStatus): number {
    if (status === 'unchanged') return 0;
    if (status === 'modified') return 1;
    if (status === 'removed') return 2;
    return 3;
}
