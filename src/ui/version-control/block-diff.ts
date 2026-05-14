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

const SIMPLE_BLOCK_TYPES = new Set(['p', 'h', 'i', 'c', 'b', 's', 't']);
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
    if (rawDom && block.id && /data-node-id=["'][^"']+["']/i.test(rawDom)) {
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

function collectJsonBlocks(value: unknown, blocks: SnapshotBlock[], depth: number): void {
    if (Array.isArray(value)) {
        for (const item of value) collectJsonBlocks(item, blocks, depth);
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
    const text = firstString(record, ['markdown', 'kramdown', 'content', 'text', 'name', 'title', 'fcontent']);

    if (id || type || text) {
        blocks.push({
            ...(id ? { id } : {}),
            ...(parentID ? { parentID } : {}),
            ...(rootID ? { rootID } : {}),
            ...(type ? { type } : {}),
            ...(subtype ? { subtype } : {}),
            text: stripMarkup(text || id || ''),
            markdown: text || '',
            raw: value,
            order: blocks.length,
            depth,
        });
    }

    for (const key of CHILD_KEYS) {
        const child = record[key];
        if (child && (Array.isArray(child) || typeof child === 'object')) {
            collectJsonBlocks(child, blocks, depth + 1);
        }
    }
}

function parseHtmlBlocks(content: string): SnapshotBlock[] {
    const blocks: SnapshotBlock[] = [];
    const blockPattern = /<([a-z][\w:-]*)\b([^>]*\bdata-node-id=["'][^"']+["'][^>]*)>([\s\S]*?)(?:<\/\1>)/gi;
    let match: RegExpExecArray | null;

    while ((match = blockPattern.exec(content)) !== null) {
        const attrs = match[2] ?? '';
        const inner = match[3] ?? '';
        const id = getAttr(attrs, 'data-node-id');
        if (!id) continue;
        const text = decodeHtml(stripMarkup(inner));
        const type = normalizeDomBlockType(getAttr(attrs, 'data-type'));
        const subtype = getAttr(attrs, 'data-subtype');
        const parentID = getAttr(attrs, 'data-parent-id');
        const rootID = getAttr(attrs, 'data-root-id') || getAttr(attrs, 'data-doc-id') || (type === 'd' ? id : undefined);
        blocks.push({
            id,
            ...(parentID ? { parentID } : {}),
            ...(rootID ? { rootID } : {}),
            ...(type ? { type } : {}),
            ...(subtype ? { subtype } : {}),
            text,
            markdown: text || decodeHtml(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim()),
            raw: match[0],
            order: blocks.length,
            depth: 0,
        });
    }

    if (blocks.length > 0) return blocks;

    const text = decodeHtml(stripMarkup(content));
    return text ? [{
        type: 'p',
        text,
        markdown: text,
        order: 0,
        depth: 0,
    }] : [];
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
    if (lower.includes('table')) return 't';
    if (lower.includes('blockquote')) return 'b';
    if (lower.includes('superblock')) return 's';
    if (lower.includes('document')) return 'd';
    if (lower.includes('av')) return 'av';
    return undefined;
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

function parseTextBlocks(content: string): SnapshotBlock[] {
    const chunks = content
        .split(/\n{2,}/)
        .flatMap((chunk) => {
            const trimmed = chunk.trim();
            if (!trimmed) return [];
            if (trimmed.length > 600) {
                return trimmed.split(/\n/).filter(Boolean);
            }
            return [trimmed];
        });

    return chunks.map((chunk, index) => {
        const idMatch = chunk.match(/\b([0-9]{14}-[a-z0-9]{7})\b/i);
        return {
            ...(idMatch?.[1] ? { id: idMatch[1] } : {}),
            type: inferMarkdownType(chunk),
            text: stripMarkup(chunk),
            markdown: chunk,
            order: index,
            depth: 0,
        };
    });
}

function inferMarkdownType(value: string): string {
    if (/^#{1,6}\s/.test(value)) return 'h';
    if (/^(\s*[-*+]|\s*\d+\.)\s+/.test(value)) return 'i';
    if (/^```/.test(value)) return 'c';
    return 'p';
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
