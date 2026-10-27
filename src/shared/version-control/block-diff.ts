export type BlockDiffStatus = 'unchanged' | 'modified' | 'added' | 'removed';
export type InlineDiffKind = 'same' | 'removed' | 'added';

export interface InlineDiffPart {
    text: string;
    kind: InlineDiffKind;
}

export interface SnapshotBlock {
    id?: string;
    parentID?: string;
    rootID?: string;
    type?: string;
    subtype?: string;
    text: string;
    markdown: string;
    raw?: unknown;
    order: number;
    depth: number;
}

export interface BlockDiffEntry {
    key: string;
    status: BlockDiffStatus;
    oldBlock?: SnapshotBlock;
    newBlock?: SnapshotBlock;
    oldParts?: InlineDiffPart[];
    newParts?: InlineDiffPart[];
    canAcceptBlock: boolean;
    acceptReason?: string;
}

export interface BlockDiffLineStats {
    added: number;
    removed: number;
}

export interface RepoSnapshotFileChange {
    id?: string;
    fileID?: string;
    path?: string;
    title?: string;
    name?: string;
    hSize?: string;
    updated?: number | string;
    rootID?: string;
    docID?: string;
    blockID?: string;
    [key: string]: unknown;
}

export type DiffBucket = 'modified' | 'added' | 'removed';

export interface ChangedSnapshotFile {
    key: string;
    kind: DiffBucket;
    title: string;
    oldFile?: RepoSnapshotFileChange;
    newFile?: RepoSnapshotFileChange;
    documentId?: string;
}

export interface RestoreAnchorSource {
    documentId?: string;
    oldFile?: RepoSnapshotFileChange;
    newFile?: RepoSnapshotFileChange;
}

export interface RestoreInsertPlan {
    parentIDs: string[];
    nextID?: string;
    previousID?: string;
}

export interface RestoreBlockPayload {
    dataType: 'markdown' | 'dom';
    data: string;
    id?: string;
}

const SIMPLE_BLOCK_TYPES = new Set(['p', 'h', 'i', 'l', 'c', 'm', 'b', 's', 't']);
const CHILD_KEYS = ['children', 'blocks', 'content', 'items', 'rows'];

export function parseSnapshotBlocks(content: string): SnapshotBlock[] {
    const trimmed = content.trim();
    if (!trimmed) return [];

    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined) {
        const blocks: SnapshotBlock[] = [];
        collectJsonBlocks(parsed, blocks, 0);
        if (blocks.length > 0) return blocks;
    }

    if (/^\s*</.test(trimmed)) {
        const htmlBlocks = parseHtmlBlocks(trimmed);
        if (htmlBlocks.length > 0) return htmlBlocks;
    }

    return parseTextBlocks(content);
}

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

export function buildChangedFiles(diff: Record<string, RepoSnapshotFileChange[] | unknown>): ChangedSnapshotFile[] {
    const updatesLeft = asDocumentFileArray(diff.updatesLeft);
    const updatesRight = asDocumentFileArray(diff.updatesRight);
    const addsLeft = asDocumentFileArray(diff.addsLeft);
    const removesRight = asDocumentFileArray(diff.removesRight);
    const changed: ChangedSnapshotFile[] = [];
    const usedRight = new Set<number>();

    for (const [index, oldFile] of updatesLeft.entries()) {
        const match = findMatchingFile(oldFile, updatesRight, usedRight);
        changed.push(createChangedFile('modified', oldFile, match?.file, index));
        if (match) usedRight.add(match.index);
    }

    for (const [index, newFile] of updatesRight.entries()) {
        if (!usedRight.has(index) && updatesLeft.length === 0) {
            changed.push(createChangedFile('modified', undefined, newFile, index));
        }
    }

    for (const [index, file] of addsLeft.entries()) {
        changed.push(createChangedFile('added', undefined, file, index));
    }

    for (const [index, file] of removesRight.entries()) {
        changed.push(createChangedFile('removed', file, undefined, index));
    }

    return changed.filter((file, index, arr) => arr.findIndex((other) => other.key === file.key) === index);
}

export function getSnapshotFileId(file: RepoSnapshotFileChange | undefined): string {
    if (!file) return '';
    const fileID = file.fileID;
    if (typeof fileID === 'string' && fileID.trim()) return fileID;
    const id = file.id;
    return typeof id === 'string' ? id : '';
}

export function getDocumentIdFromSnapshotFile(file: unknown): string | undefined {
    if (!file || typeof file !== 'object') return undefined;
    const record = file as Record<string, unknown>;
    for (const key of ['rootID', 'docID', 'blockID']) {
        const value = record[key];
        if (typeof value === 'string' && isSiYuanId(value)) return value;
    }
    for (const key of ['path', 'name', 'title']) {
        const value = record[key];
        if (typeof value !== 'string') continue;
        const match = value.match(/([0-9]{14}-[a-z0-9]{7})\.sy\b/i) || value.match(/\b([0-9]{14}-[a-z0-9]{7})\b/i);
        if (match?.[1]) return match[1];
    }
    return undefined;
}

export function getFileTitle(file: RepoSnapshotFileChange | undefined): string {
    if (!file) return '';
    for (const key of ['title', 'name', 'path']) {
        const value = file[key];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
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

function tryParseJson(content: string): unknown {
    try {
        return JSON.parse(content);
    } catch {
        return undefined;
    }
}

function collectJsonBlocks(value: unknown, blocks: SnapshotBlock[], depth: number, parentType?: string): void {
    if (Array.isArray(value)) {
        for (const item of value) collectJsonBlocks(item, blocks, depth, parentType);
        return;
    }
    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    const type = typeof record.type === 'string' ? record.type : undefined;
    const subtype = typeof record.subtype === 'string' ? record.subtype : undefined;
    const parentID = firstString(record, ['parentID', 'parentId', 'parent_id']);
    const explicitRootID = firstString(record, ['rootID', 'rootId', 'root_id']);
    const rootID = explicitRootID || (type === 'd' && id ? id : '');
    const explicitMarkdown = firstString(record, ['markdown', 'kramdown']);
    const sourceText = buildSnapshotText(record, type);
    const markdown = explicitMarkdown || buildSnapshotMarkdown(record, type, subtype, sourceText);
    const hasOwnText = Boolean(firstString(record, ['content', 'text', 'name', 'title', 'fcontent', 'value', 'data', 'code', 'source', 'body', 'formula', 'latex', 'src', 'dataSrc', 'data-src']));

    const isNestedContentFragment = !id && !type && (isCodeBlock(parentType, undefined) || isMathBlock(parentType, undefined));

    if (!isNestedContentFragment && (id || type || explicitMarkdown || hasOwnText)) {
        blocks.push({
            ...(id ? { id } : {}),
            ...(parentID ? { parentID } : {}),
            ...(rootID ? { rootID } : {}),
            ...(type ? { type } : {}),
            ...(subtype ? { subtype } : {}),
            text: stripMarkup(sourceText || markdown || id || ''),
            markdown,
            raw: value,
            order: blocks.length,
            depth,
        });
    }

    for (const key of CHILD_KEYS) {
        const child = record[key];
        if (child && (Array.isArray(child) || typeof child === 'object')) {
            collectJsonBlocks(child, blocks, depth + 1, type);
        }
    }
}

function parseHtmlBlocks(content: string): SnapshotBlock[] {
    const blocks: SnapshotBlock[] = [];
    const nodes = extractHtmlNodeBlocks(content);

    for (const node of nodes) {
        const { attrs, inner, raw } = node;
        const id = getAttr(attrs, 'data-node-id');
        if (!id) continue;
        const domType = getAttr(attrs, 'data-type');
        const type = normalizeDomBlockType(domType);
        if (type === 'l' && hasNestedListItems(inner)) continue;
        const subtype = getAttr(attrs, 'data-subtype');
        const parentID = getAttr(attrs, 'data-parent-id');
        const rootID = getAttr(attrs, 'data-root-id') || getAttr(attrs, 'data-doc-id') || (type === 'd' ? id : undefined);
        const htmlText = extractHtmlBlockText(type, attrs, inner);
        const markdown = buildHtmlSnapshotMarkdown(type, subtype, htmlText, inner, attrs, raw);
        blocks.push({
            id,
            ...(parentID ? { parentID } : {}),
            ...(rootID ? { rootID } : {}),
            ...(type ? { type } : {}),
            ...(subtype ? { subtype } : {}),
            text: stripMarkup(htmlText),
            markdown,
            raw,
            order: blocks.length,
            depth: 0,
        });
    }

    return blocks;
}

function extractHtmlNodeBlocks(content: string): Array<{ attrs: string; inner: string; raw: string }> {
    const nodes: Array<{ attrs: string; inner: string; raw: string }> = [];
    const startPattern = /<([a-z][\w:-]*)\b([^>]*\bdata-node-id=["'][^"']+["'][^>]*)>/gi;
    let match: RegExpExecArray | null;

    while ((match = startPattern.exec(content)) !== null) {
        const tag = match[1];
        const attrs = match[2] ?? '';
        const openEnd = startPattern.lastIndex;
        const closeEnd = findMatchingHtmlClose(content, tag, openEnd);
        if (closeEnd < 0) continue;
        const closeStart = content.lastIndexOf(`</${tag}>`, closeEnd);
        if (closeStart < openEnd) continue;
        nodes.push({
            attrs,
            inner: content.slice(openEnd, closeStart),
            raw: content.slice(match.index, closeEnd),
        });
        if (normalizeDomBlockType(getAttr(attrs, 'data-type')) === 'l') {
            nodes.push(...extractHtmlNodeBlocks(content.slice(openEnd, closeStart)));
        }
        startPattern.lastIndex = closeEnd;
    }

    return nodes;
}

function hasNestedListItems(inner: string): boolean {
    return /\bdata-type=["']NodeListItem["']/i.test(inner);
}

function findMatchingHtmlClose(content: string, tag: string, start: number): number {
    const pattern = new RegExp(`</?${escapeRegExp(tag)}(?:\\s[^>]*)?>`, 'gi');
    pattern.lastIndex = start;
    let depth = 1;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
        if (match[0][1] === '/') {
            depth -= 1;
            if (depth === 0) return pattern.lastIndex;
        } else if (!/\/>$/.test(match[0])) {
            depth += 1;
        }
    }

    return -1;
}

function extractHtmlBlockText(type: string | undefined, attrs: string, inner: string): string {
    const dataContent = getAttr(attrs, 'data-content');
    if (dataContent) return decodeHtml(dataContent);

    if (isCodeBlock(type, undefined)) {
        const editable = firstHtmlEditableContent(inner);
        if (editable) return decodeHtml(stripHtmlPreservingBreaks(editable));
        return decodeHtml(stripMarkup(removeProtyleActionToolbar(inner)));
    }

    if (isHtmlLikeBlock(type, undefined)) {
        return getHtmlBlockText(attrs, inner);
    }

    return decodeHtml(stripMarkup(inner));
}

function firstHtmlEditableContent(html: string): string {
    const matches = [...html.matchAll(/<([a-z][\w:-]*)\b(?=[^>]*contenteditable=["'](?:true|plaintext-only)["'])[^>]*>([\s\S]*?)<\/\1>/gi)];
    const content = matches
        .map((match) => stripHtmlPreservingBreaks(match[2] ?? ''))
        .filter(Boolean)
        .filter((value) => !looksLikeLanguage(value));
    return content.at(-1) ?? '';
}

function stripHtmlPreservingBreaks(value: string): string {
    return value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>\s*<div\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
}

function extractHtmlCodeLanguage(attrs: string, inner: string): string {
    const dataSubtype = getAttr(attrs, 'data-subtype');
    if (dataSubtype) return normalizeLanguage(dataSubtype);

    const languageMatch = inner.match(/class=["'][^"']*protyle-action__language[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    return normalizeLanguage(decodeHtml(stripMarkup(languageMatch?.[1] ?? '')));
}

function removeProtyleActionToolbar(html: string): string {
    return html.replace(/<div\b(?=[^>]*class=["'][^"']*protyle-action[^"']*["'])[^>]*>[\s\S]*?<\/div>/gi, '');
}

function getAttr(attrs: string, name: string): string | undefined {
    const match = attrs.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'));
    return match?.[1];
}

function normalizeDomBlockType(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const lower = value.toLowerCase();
    if (lower.includes('heading')) return 'h';
    if (lower.includes('paragraph')) return 'p';
    if (lower.includes('listitem')) return 'i';
    if (lower.includes('list')) return 'l';
    if (lower.includes('code')) return 'c';
    if (lower.includes('math') || lower.includes('formula')) return 'm';
    if (lower.includes('table')) return 't';
    if (lower.includes('blockquote')) return 'b';
    if (lower.includes('superblock')) return 's';
    if (lower.includes('document')) return 'd';
    if (lower.includes('html') || lower.includes('iframe') || lower.includes('video') || lower.includes('audio')) return 'html';
    if (lower.includes('av')) return 'av';
    return undefined;
}

function buildSnapshotText(record: Record<string, unknown>, type: string | undefined): string {
    const subtype = firstString(record, ['subtype']);

    if (isCodeBlock(type, subtype)) {
        return firstString(record, ['fcontent', 'text', 'value', 'data', 'code', 'source', 'body'])
            || codeContentAsBody(record)
            || collectNestedSnapshotText(record);
    }

    if (isMathBlock(type, subtype)) {
        return firstString(record, ['content', 'fcontent', 'text', 'value', 'data', 'formula', 'latex', 'source', 'body'])
            || collectNestedSnapshotText(record);
    }

    if (isHtmlLikeBlock(type, subtype)) {
        return firstString(record, ['content', 'markdown', 'kramdown', 'text', 'value', 'data', 'src', 'dataSrc', 'data-src', 'source'])
            || collectNestedSnapshotText(record);
    }

    return firstString(record, ['content', 'text', 'name', 'title', 'fcontent', 'value', 'data'])
        || collectNestedSnapshotText(record);
}

function buildSnapshotMarkdown(
    record: Record<string, unknown>,
    type: string | undefined,
    subtype: string | undefined,
    sourceText: string,
): string {
    if (!sourceText) return '';

    if (isCodeBlock(type, subtype)) {
        const language = getCodeLanguage(record, subtype);
        return `\`\`\`${language}\n${sourceText}\n\`\`\``;
    }

    if (isMathBlock(type, subtype)) {
        if (isInlineMathBlock(type, subtype)) return `$${sourceText}$`;
        return `$$\n${sourceText}\n$$`;
    }

    if (isHeadingBlock(type, subtype)) {
        const level = getHeadingLevel(subtype);
        return `${'#'.repeat(level)} ${sourceText}`;
    }

    if (isListItemBlock(type, subtype)) {
        return `${getListPrefix(record, subtype)}${sourceText}`;
    }

    if (isQuoteBlock(type, subtype)) {
        return sourceText
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n');
    }

    if (isHtmlLikeBlock(type, subtype)) {
        return buildHtmlBlockMarkdown(sourceText, record);
    }

    return sourceText;
}

function buildHtmlSnapshotMarkdown(
    type: string | undefined,
    subtype: string | undefined,
    text: string,
    inner: string,
    attrs = '',
    raw = '',
): string {
    if (isHtmlLikeBlock(type, subtype)) {
        return getHtmlBlockMarkdown(attrs, inner, raw);
    }

    const markdown = htmlInlineToMarkdown(inner);
    const fallback = markdown || text || decodeHtml(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim());
    if (!fallback) return '';

    if (isCodeBlock(type, subtype)) {
        const language = normalizeLanguage(subtype) || extractHtmlCodeLanguage(attrs, inner);
        return `\`\`\`${language}\n${fallback}\n\`\`\``;
    }

    if (isMathBlock(type, subtype)) {
        if (isInlineMathBlock(type, subtype)) return `$${fallback}$`;
        return `$$\n${fallback}\n$$`;
    }

    if (isHeadingBlock(type, subtype)) {
        return `${'#'.repeat(getHeadingLevel(subtype))} ${fallback}`;
    }

    if (isListItemBlock(type, subtype)) {
        return `${getListPrefix({}, subtype)}${fallback}`;
    }

    if (isQuoteBlock(type, subtype)) {
        return fallback
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n');
    }

    return fallback;
}

function buildHtmlBlockMarkdown(sourceText: string, record: Record<string, unknown>): string {
    const trimmed = sourceText.trim();
    if (/^<[a-z][\w:-]*\b/i.test(trimmed)) return trimmed;

    const src = firstString(record, ['src', 'dataSrc', 'data-src', 'source', 'url'])
        || firstStringDeep(record, ['src', 'dataSrc', 'data-src', 'source', 'url'])
        || trimmed;
    if (!src) return trimmed;

    return `<div data-src="${escapeHtmlAttr(src)}"></div>`;
}

function getHtmlBlockMarkdown(attrs: string, inner: string, raw: string): string {
    const embedded = extractFirstHtmlTag(inner);
    if (embedded) return embedded;

    const rawTrimmed = raw.trim();
    if (rawTrimmed) return rawTrimmed;

    const src = getHtmlBlockSource(attrs, inner);
    if (src) return `<div data-src="${escapeHtmlAttr(src)}"></div>`;

    return decodeHtml(inner).trim();
}

function getHtmlBlockText(attrs: string, inner: string): string {
    const html = extractFirstHtmlTag(inner);
    const src = getHtmlBlockSource(attrs, inner);
    return decodeHtml(src || stripMarkup(html || inner)).trim();
}

function extractFirstHtmlTag(html: string): string {
    const paired = /<([a-z][\w:-]*)\b[^>]*>[\s\S]*?<\/\1>/i.exec(html);
    if (paired?.[0]) return decodeHtml(paired[0].trim());

    const selfClosing = /<[a-z][\w:-]*\b[^>]*\/?>/i.exec(html);
    return selfClosing?.[0] ? decodeHtml(selfClosing[0].trim()) : '';
}

function getHtmlBlockSource(attrs: string, inner: string): string {
    const embeddedAttrs = extractFirstHtmlAttrs(inner);
    return decodeHtml(
        getAttr(embeddedAttrs, 'src')
        || getAttr(embeddedAttrs, 'data-src')
        || getAttr(attrs, 'src')
        || getAttr(attrs, 'data-src')
        || '',
    );
}

function extractFirstHtmlAttrs(html: string): string {
    const match = html.match(/<[a-z][\w:-]*\b([^>]*)>/i);
    return match?.[1] ?? '';
}

function escapeHtmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function htmlInlineToMarkdown(html: string): string {
    let value = removeProtyleActionToolbar(html)
        .replace(/<div\b(?=[^>]*class=["'][^"']*protyle-attr[^"']*["'])[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>\s*<div\b[^>]*>/gi, '\n');

    value = value.replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => {
        const src = decodeHtml(getAttr(attrs, 'src') ?? '');
        if (!src) return '';
        const alt = decodeHtml(getAttr(attrs, 'alt') ?? '');
        return `![${alt}](${src})`;
    });

    value = replacePairedInlineTag(value, 'a', (attrs, content) => {
        const href = decodeHtml(getAttr(attrs, 'href') ?? getAttr(attrs, 'data-href') ?? '');
        return href ? `[${content}](${href})` : content;
    });
    value = replacePairedInlineTag(value, 'strong|b', (_attrs, content) => `**${content}**`);
    value = replacePairedInlineTag(value, 'em|i', (_attrs, content) => `*${content}*`);
    value = replacePairedInlineTag(value, 's|strike|del', (_attrs, content) => `~~${content}~~`);
    value = replacePairedInlineTag(value, 'u', (_attrs, content) => `<u>${content}</u>`);
    value = replacePairedInlineTag(value, 'mark', (_attrs, content) => `==${content}==`);
    value = replacePairedInlineTag(value, 'sup', (_attrs, content) => `^${content}^`);
    value = replacePairedInlineTag(value, 'sub', (_attrs, content) => `~${content}~`);
    value = replacePairedInlineTag(value, 'code', (_attrs, content) => `\`${content}\``);
    value = replacePairedInlineTag(value, 'span', (attrs, content) => wrapInlineMarkdownByDataType(content, attrs));

    return decodeHtml(stripUnconvertedHtml(value)).trim();
}

function replacePairedInlineTag(
    value: string,
    tagPattern: string,
    replace: (attrs: string, content: string) => string,
): string {
    const pattern = new RegExp(`<(${tagPattern})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'gi');
    let previous = '';
    let next = value;
    while (next !== previous) {
        previous = next;
        next = next.replace(pattern, (_match, _tag: string, attrs: string, content: string) => replace(attrs, content));
    }
    return next;
}

function wrapInlineMarkdownByDataType(content: string, attrs: string): string {
    const rawType = getAttr(attrs, 'data-type') ?? '';
    const types = rawType.split(/\s+/).filter(Boolean);
    if (types.includes('a')) {
        const href = decodeHtml(getAttr(attrs, 'data-href') ?? getAttr(attrs, 'href') ?? '');
        return href ? `[${content}](${href})` : content;
    }

    let result = content;
    if (types.includes('code')) result = `\`${result}\``;
    if (types.includes('strong')) result = `**${result}**`;
    if (types.includes('em')) result = `*${result}*`;
    if (types.includes('s') || types.includes('strike') || types.includes('del')) result = `~~${result}~~`;
    if (types.includes('u')) result = `<u>${result}</u>`;
    if (types.includes('mark')) result = `==${result}==`;
    if (types.includes('sup')) result = `^${result}^`;
    if (types.includes('sub')) result = `~${result}~`;
    return result;
}

function stripUnconvertedHtml(value: string): string {
    return value.replace(/<[^>]+>/g, (tag) => /^<\/?u(?:\s|>)/i.test(tag) ? tag : '');
}

function isCodeBlock(type: string | undefined, subtype: string | undefined): boolean {
    return type === 'c' || type === 'code' || subtype === 'code';
}

function isMathBlock(type: string | undefined, subtype: string | undefined): boolean {
    return type === 'm' || type === 'formula' || subtype === 'math' || subtype === 'latex';
}

function isHtmlLikeBlock(type: string | undefined, subtype: string | undefined): boolean {
    return type === 'html'
        || type === 'iframe'
        || type === 'video'
        || type === 'audio'
        || subtype === 'html'
        || subtype === 'iframe'
        || subtype === 'video'
        || subtype === 'audio';
}

function isInlineMathBlock(type: string | undefined, subtype: string | undefined): boolean {
    return type === 'formula' || subtype === 'inline-math' || subtype === 'inlineMath';
}

function isHeadingBlock(type: string | undefined, subtype: string | undefined): boolean {
    return type === 'h' || /^h[1-6]$/.test(subtype ?? '');
}

function isListItemBlock(type: string | undefined, subtype: string | undefined): boolean {
    return type === 'i' || type === 'task' || subtype === 'task' || subtype === 'u' || subtype === 'o' || subtype === 't';
}

function isQuoteBlock(type: string | undefined, subtype: string | undefined): boolean {
    return type === 'b' || subtype === 'quote';
}

function getHeadingLevel(subtype: string | undefined): number {
    const match = subtype?.match(/^h([1-6])$/);
    return match ? Number(match[1]) : 1;
}

function getListPrefix(record: Record<string, unknown>, subtype: string | undefined): string {
    if (isTaskListItem(record, subtype)) {
        return getBooleanDeep(record, ['checked', 'done', 'completed'])
            ? '- [x] '
            : '- [ ] ';
    }

    if (subtype === 'o' || subtype === 'ordered') {
        const marker = firstString(record, ['marker', 'number', 'index']) || firstNumberString(record, ['marker', 'number', 'index']);
        return marker && /^\d+$/.test(marker) ? `${marker}. ` : '1. ';
    }

    return '- ';
}

function isTaskListItem(record: Record<string, unknown>, subtype: string | undefined): boolean {
    if (subtype === 'task' || subtype === 't') return true;
    return getBooleanDeep(record, ['checked', 'done', 'completed']) !== undefined;
}

function getCodeLanguage(record: Record<string, unknown>, subtype: string | undefined): string {
    const explicitLanguage = firstStringDeep(record, ['language', 'lang', 'codeLang', 'codeLanguage']);
    if (explicitLanguage) return normalizeLanguage(explicitLanguage);

    if (subtype && subtype !== 'code') return normalizeLanguage(subtype);

    const content = firstString(record, ['content']);
    return looksLikeLanguage(content) ? normalizeLanguage(content) : '';
}

function codeContentAsBody(record: Record<string, unknown>): string {
    const content = firstString(record, ['content']);
    return looksLikeLanguage(content) ? '' : content;
}

function collectNestedSnapshotText(record: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const key of ['children', 'blocks', 'items', 'rows', 'lines', 'line', 'content', 'data', 'value']) {
        const value = record[key];
        if (value && (Array.isArray(value) || typeof value === 'object')) {
            collectTextFragments(value, parts, 0);
        }
    }
    return parts.join('\n').trim();
}

function collectTextFragments(value: unknown, parts: string[], depth: number): void {
    if (depth > 8 || value === null || value === undefined) return;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && !looksLikeBlockId(trimmed)) parts.push(trimmed);
        return;
    }

    if (typeof value === 'number' || typeof value === 'boolean') return;

    if (Array.isArray(value)) {
        for (const item of value) collectTextFragments(item, parts, depth + 1);
        return;
    }

    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const direct = firstString(record, ['markdown', 'kramdown', 'fcontent', 'text', 'code', 'source', 'body', 'formula', 'latex', 'content', 'value', 'data']);
    if (direct && !looksLikeLanguageOnlyRecord(record, direct)) {
        parts.push(direct);
        return;
    }

    for (const key of ['children', 'blocks', 'items', 'rows', 'lines', 'line', 'content', 'data', 'value']) {
        collectTextFragments(record[key], parts, depth + 1);
    }
}

function looksLikeLanguageOnlyRecord(record: Record<string, unknown>, value: string): boolean {
    return isCodeBlock(firstString(record, ['type']), firstString(record, ['subtype']))
        && record.content === value
        && looksLikeLanguage(value);
}

function looksLikeBlockId(value: string): boolean {
    return /^[0-9]{14}-[a-z0-9]{7}$/i.test(value);
}

function normalizeLanguage(value: string | undefined): string {
    const language = (value ?? '').trim();
    return looksLikeLanguage(language) ? language : '';
}

function looksLikeLanguage(value: string | undefined): boolean {
    return Boolean(value && /^[\w#+.-]{1,40}$/.test(value.trim()));
}

function firstStringDeep(record: Record<string, unknown>, keys: string[]): string {
    const direct = firstString(record, keys);
    if (direct) return direct;

    for (const containerKey of ['attrs', 'attributes', 'properties', 'ial']) {
        const container = record[containerKey];
        if (container && typeof container === 'object') {
            const nested = firstString(container as Record<string, unknown>, keys);
            if (nested) return nested;
        }
    }

    return '';
}

function getBooleanDeep(record: Record<string, unknown>, keys: string[]): boolean | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', '1', 'yes', 'y', 'checked', 'done'].includes(normalized)) return true;
            if (['false', '0', 'no', 'n', 'unchecked', 'todo'].includes(normalized)) return false;
        }
    }

    for (const containerKey of ['attrs', 'attributes', 'properties', 'ial']) {
        const container = record[containerKey];
        if (container && typeof container === 'object') {
            const nested = getBooleanDeep(container as Record<string, unknown>, keys);
            if (nested !== undefined) return nested;
        }
    }

    return undefined;
}

function firstNumberString(record: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
}

function withBlockIdIal(markdown: string, id: string): string {
    const trimmed = markdown.trimEnd();
    if (!trimmed) return `{: id="${id}"}`;
    if (new RegExp(`\\{:\\s+id=["']${escapeRegExp(id)}["']\\s*\\}\\s*$`, 'i').test(trimmed)) {
        return trimmed;
    }
    return `${trimmed}\n{: id="${id}"}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractFencedCodeBody(markdown: string): string {
    const match = markdown.match(/^\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*(?:\{:[^}]+\}\s*)?$/);
    return match ? match[2] : markdown;
}

function extractMathBlockBody(markdown: string): string {
    const match = markdown.match(/^\s*\$\$\s*\n?([\s\S]*?)\n?\$\$\s*(?:\{:[^}]+\}\s*)?$/);
    return match ? match[1] : markdown;
}

function parseTextBlocks(content: string): SnapshotBlock[] {
    const chunks = splitMarkdownBlocks(content);

    return chunks.map((chunk, index) => {
        const idMatch = chunk.match(/\b([0-9]{14}-[a-z0-9]{7})\b/i);
        const type = inferMarkdownType(chunk);
        return {
            ...(idMatch?.[1] ? { id: idMatch[1] } : {}),
            type,
            text: stripMarkup(chunk) || (isHtmlLikeBlock(type, undefined) ? getHtmlBlockText('', chunk) : ''),
            markdown: chunk,
            order: index,
            depth: 0,
        };
    });
}

function splitMarkdownBlocks(content: string): string[] {
    const lines = content.replace(/\r\n?/g, '\n').split('\n');
    const chunks: string[] = [];
    let index = 0;

    while (index < lines.length) {
        if (isBlankLine(lines[index])) {
            index += 1;
            continue;
        }

        const collected = collectMarkdownBlock(lines, index);
        chunks.push(collected.chunk);
        index = collected.nextIndex;
    }

    return chunks;
}

function collectMarkdownBlock(lines: string[], start: number): { chunk: string; nextIndex: number } {
    const line = lines[start];

    if (start === 0 && line.trim() === '---') {
        return collectUntilLine(lines, start, (candidate, index) => index > start && candidate.trim() === '---');
    }

    const fence = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fence) {
        const marker = fence[2];
        return collectUntilLine(lines, start, (candidate, index) => index > start && candidate.trimStart().startsWith(marker));
    }

    if (line.trim() === '$$') {
        return collectUntilLine(lines, start, (candidate, index) => index > start && candidate.trim() === '$$');
    }

    if (isTableStart(lines, start)) {
        return collectWhile(lines, start, (candidate) => candidate.includes('|') && !isBlankLine(candidate));
    }

    if (isHtmlBlockStart(line)) {
        const closingTag = getHtmlClosingTag(line);
        if (closingTag && !line.toLowerCase().includes(closingTag)) {
            return collectUntilLine(lines, start, (candidate, index) => index > start && candidate.toLowerCase().includes(closingTag));
        }
        return collectSingle(lines, start);
    }

    if (isBlockquoteLine(line)) {
        return collectWhile(lines, start, (candidate, index) => {
            if (isBlockquoteLine(candidate)) return true;
            return isBlankLine(candidate) && index + 1 < lines.length && isBlockquoteLine(lines[index + 1]);
        });
    }

    if (isListLine(line)) {
        return collectListBlock(lines, start);
    }

    if (isHeadingLine(line) || isHorizontalRule(line)) {
        return collectSingle(lines, start);
    }

    return collectParagraph(lines, start);
}

function collectUntilLine(
    lines: string[],
    start: number,
    isEnd: (line: string, index: number) => boolean,
): { chunk: string; nextIndex: number } {
    let index = start;
    while (index < lines.length) {
        if (isEnd(lines[index], index)) {
            return { chunk: trimMarkdownChunk(lines.slice(start, index + 1)), nextIndex: index + 1 };
        }
        index += 1;
    }
    return { chunk: trimMarkdownChunk(lines.slice(start)), nextIndex: lines.length };
}

function collectWhile(
    lines: string[],
    start: number,
    keep: (line: string, index: number) => boolean,
): { chunk: string; nextIndex: number } {
    let index = start;
    while (index < lines.length && keep(lines[index], index)) {
        index += 1;
    }
    return { chunk: trimMarkdownChunk(lines.slice(start, index)), nextIndex: index };
}

function collectSingle(lines: string[], start: number): { chunk: string; nextIndex: number } {
    return { chunk: lines[start].trim(), nextIndex: start + 1 };
}

function collectParagraph(lines: string[], start: number): { chunk: string; nextIndex: number } {
    let index = start;
    while (index < lines.length && !isBlankLine(lines[index]) && !isSpecialMarkdownStart(lines[index], lines, index)) {
        index += 1;
    }
    if (index === start) index += 1;
    return { chunk: trimMarkdownChunk(lines.slice(start, index)), nextIndex: index };
}

function collectListBlock(lines: string[], start: number): { chunk: string; nextIndex: number } {
    const baseIndent = getListIndent(lines[start]);
    let index = start + 1;
    while (index < lines.length) {
        const line = lines[index];
        if (isBlankLine(line)) {
            const nextContentIndex = findNextNonBlankLine(lines, index + 1);
            if (nextContentIndex < 0) {
                break;
            }
            const nextLine = lines[nextContentIndex];
            const nextListIndent = getListIndent(nextLine);
            if (nextListIndent >= 0 && nextListIndent <= baseIndent) break;
            if (!isIndentedContinuation(nextLine) && nextListIndent < 0) break;
            index += 1;
            continue;
        }

        const listIndent = getListIndent(line);
        if (listIndent >= 0) {
            if (listIndent <= baseIndent) break;
            index += 1;
            continue;
        }

        if (isIndentedContinuation(line)) {
            index += 1;
            continue;
        }

        break;
    }
    return { chunk: trimMarkdownChunk(lines.slice(start, index)), nextIndex: index };
}

function trimMarkdownChunk(lines: string[]): string {
    let start = 0;
    let end = lines.length;
    while (start < end && isBlankLine(lines[start])) start += 1;
    while (end > start && isBlankLine(lines[end - 1])) end -= 1;
    return lines.slice(start, end).join('\n');
}

function inferMarkdownType(value: string): string {
    if (/^#{1,6}\s/.test(value)) return 'h';
    if (isListLine(value.split('\n')[0] ?? '')) return 'i';
    if (/^```/.test(value)) return 'c';
    if (/^\$\$/m.test(value)) return 'm';
    if (isTableStart(value.split('\n'), 0)) return 't';
    if (isBlockquoteLine(value.split('\n')[0] ?? '')) return 'b';
    if (isHtmlBlockStart(value.split('\n')[0] ?? '')) return 'html';
    return 'p';
}

function isSpecialMarkdownStart(line: string, lines: string[], index: number): boolean {
    return /^(\s*)(`{3,}|~{3,})/.test(line)
        || line.trim() === '$$'
        || isTableStart(lines, index)
        || isHtmlBlockStart(line)
        || isBlockquoteLine(line)
        || isListLine(line)
        || isHeadingLine(line)
        || isHorizontalRule(line);
}

function isBlankLine(line: string | undefined): boolean {
    return line === undefined || line.trim() === '';
}

function isHeadingLine(line: string): boolean {
    return /^#{1,6}\s/.test(line);
}

function isHorizontalRule(line: string): boolean {
    return /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isListLine(line: string): boolean {
    return /^(\s*)([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.test(line);
}

function getListIndent(line: string | undefined): number {
    const match = line?.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/);
    if (!match) return -1;
    return match[1].replace(/\t/g, '    ').length;
}

function isIndentedContinuation(line: string): boolean {
    return /^( {2,}|\t)/.test(line);
}

function isBlockquoteLine(line: string): boolean {
    return /^\s{0,3}>\s?/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
    const current = lines[index] ?? '';
    const next = lines[index + 1] ?? '';
    return current.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
}

function isHtmlBlockStart(line: string): boolean {
    return /^\s{0,3}<(div|iframe|video|audio|ruby|table|details|section|article|aside|script|style)\b/i.test(line);
}

function getHtmlClosingTag(line: string): string | undefined {
    const match = line.match(/^\s{0,3}<([a-z][\w:-]*)\b/i);
    return match ? `</${match[1].toLowerCase()}>` : undefined;
}

function findNextNonBlankLine(lines: string[], start: number): number {
    for (let index = start; index < lines.length; index += 1) {
        if (!isBlankLine(lines[index])) return index;
    }
    return -1;
}

function stripMarkup(value: string): string {
    return value
        .replace(/\{:[^}]+\}/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/^[#>\-*\d.\s]+/gm, '')
        .trim();
}

function decodeHtml(value: string): string {
    return value
        .replace(/&#10;/g, '\n')
        .replace(/&#x0*a;/gi, '\n')
        .replace(/&#13;/g, '\r')
        .replace(/&#x0*d;/gi, '\r')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
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

function isSiYuanId(value: string): boolean {
    return /^[0-9]{14}-[a-z0-9]{7}$/i.test(value);
}

function statusRank(status: BlockDiffStatus): number {
    if (status === 'unchanged') return 0;
    if (status === 'modified') return 1;
    if (status === 'removed') return 2;
    return 3;
}

function asFileArray(value: unknown): RepoSnapshotFileChange[] {
    return Array.isArray(value) ? value.filter((item): item is RepoSnapshotFileChange => Boolean(item && typeof item === 'object')) : [];
}

function asDocumentFileArray(value: unknown): RepoSnapshotFileChange[] {
    return asFileArray(value).filter(isSiyuanDocumentSnapshotFile);
}

function isSiyuanDocumentSnapshotFile(file: RepoSnapshotFileChange): boolean {
    const path = typeof file.path === 'string' ? file.path : '';
    return /\.sy$/i.test(path);
}

function findMatchingFile(
    file: RepoSnapshotFileChange | undefined,
    candidates: RepoSnapshotFileChange[],
    usedIndexes: Set<number>,
): { file: RepoSnapshotFileChange; index: number } | undefined {
    if (!file) return undefined;
    const key = getFileIdentity(file);
    const path = typeof file.path === 'string' ? file.path : '';
    const title = getFileTitle(file);
    const index = candidates.findIndex((candidate, candidateIndex) => {
        if (usedIndexes.has(candidateIndex)) return false;
        return getFileIdentity(candidate) === key
            || (path && candidate.path === path)
            || (title && getFileTitle(candidate) === title);
    });
    return index >= 0 ? { file: candidates[index], index } : undefined;
}

function createChangedFile(
    kind: DiffBucket,
    oldFile: RepoSnapshotFileChange | undefined,
    newFile: RepoSnapshotFileChange | undefined,
    index: number,
): ChangedSnapshotFile {
    const documentId = getDocumentIdFromSnapshotFile(newFile) || getDocumentIdFromSnapshotFile(oldFile);
    const title = getFileTitle(newFile) || getFileTitle(oldFile) || documentId || `changed-${index + 1}`;
    return {
        key: `${kind}:${documentId || title}:${getSnapshotFileId(oldFile)}:${getSnapshotFileId(newFile)}:${index}`,
        kind,
        title,
        oldFile,
        newFile,
        documentId,
    };
}

function getFileIdentity(file: RepoSnapshotFileChange | undefined): string {
    return getDocumentIdFromSnapshotFile(file) || getFileTitle(file) || getSnapshotFileId(file) || '';
}
