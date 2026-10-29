import type { ExactReplaceEdit, ExactReplaceSummary } from './replace';
import { countOccurrences, escapeRegExp } from '../../shared/text';

interface ParsedKramdownBlock {
    content: string;
    ial: string;
}

interface ReplaceDomResult {
    kramdown: string;
    markdown: string;
    dom: string;
    summary: ExactReplaceSummary[];
}

export interface EditableMarkdownBlockInput {
    kramdown: string;
    type?: string;
    subtype?: string;
}

interface ReplaceDocumentBlockResult {
    id: string;
    kramdown: string;
    markdown: string;
    dom: string;
    type?: string;
    touchesIndexedInline: boolean;
}

const IAL_PATTERN = /\n?\{:\s*(?=[^}]*\bid\s*=)([^}]*)\}\s*$/s;
const INLINE_BLOCK_REF_SPAN_PATTERN = /<span\b(?=[^>]*\bdata-type=(?:"[^"]*\bblock-ref\b[^"]*"|'[^']*\bblock-ref\b[^']*'))([^>]*)>([\s\S]*?)<\/span>/gi;
const INLINE_TAG_SPAN_PATTERN = /<span\b(?=[^>]*\bdata-type=(?:"[^"]*\btag\b[^"]*"|'[^']*\btag\b[^']*'))([^>]*)>([\s\S]*?)<\/span>/gi;
const SINGLE_BLOCK_REF_SPAN_PATTERN = /^<span\b(?=[^>]*\bdata-type=(?:"[^"]*\bblock-ref\b[^"]*"|'[^']*\bblock-ref\b[^']*'))([^>]*)>([\s\S]*?)<\/span>$/i;
const SINGLE_TAG_SPAN_PATTERN = /^<span\b(?=[^>]*\bdata-type=(?:"[^"]*\btag\b[^"]*"|'[^']*\btag\b[^']*'))([^>]*)>([\s\S]*?)<\/span>$/i;
const DATA_ID_ATTR_PATTERN = /\sdata-id=(?:"([^"]+)"|'([^']+)')/i;
const BLOCK_REF_WITH_ANCHOR_PATTERN = /\(\(([0-9]{14}-[a-z0-9]{7})\s+(['"])(.*?)\2\)\)/g;
const BLOCK_REF_WITH_ANCHOR_DETECT_PATTERN = /\(\(([0-9]{14}-[a-z0-9]{7})\s+(['"])(.*?)\2\)\)/;
const SINGLE_BLOCK_REF_WITH_ANCHOR_PATTERN = /^\(\(([0-9]{14}-[a-z0-9]{7})\s+(['"])(.*?)\2\)$/;
const NAKED_BLOCK_REF_PATTERN = /\(\(([0-9]{14}-[a-z0-9]{7})\)\)/;
const SIYUAN_BLOCK_LINK_PATTERN = /\[[^\]]+\]\(siyuan:\/\/blocks\/[0-9]{14}-[a-z0-9]{7}\)/i;
const FOOTNOTE_PATTERN = /\[\^\d+\]|^\[\^\d+\]:/m;
const TAG_PATTERN = /#([^#\s][^#\n]*?)#/g;
const TAG_DETECT_PATTERN = /#([^#\s][^#\n]*?)#/;
const PROTECTED_INLINE_PATTERN = /\sdata-type=(?:"[^"]*\b(?:tag|block-ref)\b[^"]*"|'[^']*\b(?:tag|block-ref)\b[^']*')/i;
const VOID_TAG_PATTERN = /^<\s*(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i;
const ZERO_WIDTH_CHAR_PATTERN = /[\u200B\u200C\u200D\u2060\uFEFF]/;
const ZERO_WIDTH_CHARS_PATTERN = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
const SINGLE_LIST_ITEM_LINE_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)(.*)$/;
const FENCE_LINE_PATTERN = /^(\s*(?:>\s*)*)(`{3,}|~{3,}|\$\$).*$/;
const STANDALONE_IAL_LINE_PATTERN = /^\s*\{:\s*(?=[^}]*\bid\s*=)[^}]*\}\s*$/;
const INLINE_LIST_ITEM_IAL_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)\{:\s*(?=[^}]*\bid\s*=)[^}]*\}\s*/;
const QUOTED_STANDALONE_IAL_LINE_PATTERN = /^(\s*(?:>\s*)+)\{:\s*(?=[^}]*\bid\s*=)[^}]*\}\s*$/;
const EMPTY_LIST_ITEM_IAL_LINE_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)\{:\s*(?=[^}]*\bid\s*=)[^}]*\}\s*$/;
const QUOTED_INLINE_LIST_ITEM_IAL_PATTERN = /^(\s*(?:>\s*)+(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)\{:\s*(?=[^}]*\bid\s*=)[^}]*\}\s*/;
const QUOTED_EMPTY_LIST_ITEM_IAL_PATTERN = /^(\s*(?:>\s*)+(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)\{:\s*(?=[^}]*\bid\s*=)[^}]*\}\s*$/;
const QUOTE_BLANK_LINE_PATTERN = /^\s*(?:>\s*)+$/;

export const SIYUAN_BLOCK_LINK_HINT = 'siyuan://blocks Markdown links are allowed, but SiYuan treats them as mentions, not backlinks. Use ((id \'完整标题\')) when you need a real backlink.';
export const FOOTNOTE_REFERENCE_HINT = 'Footnote-style references like [^1] are allowed, but they create footnotes or note markers, not SiYuan backlinks. Use ((id \'完整标题\')) when you need a real backlink.';
export const UNRESOLVED_BLOCK_REF_HINT = 'Naked block references like ((id)) are allowed and normalized before writing. If the target anchor cannot be resolved, MCP uses the block ID as fallback anchor text; pass ((id \'完整标题\')) when exact readable text matters.';

export function hasSiyuanBlockLinks(value: string): boolean {
    return SIYUAN_BLOCK_LINK_PATTERN.test(value);
}

export function hasFootnoteReferences(value: string): boolean {
    return FOOTNOTE_PATTERN.test(value);
}

export function createSiyuanBlockLinkHint(): Record<string, unknown> {
    return {
        warning: 'siyuan://blocks Markdown links create mentions, not backlinks.',
        hint: SIYUAN_BLOCK_LINK_HINT,
    };
}

export function createFootnoteReferenceHint(): Record<string, unknown> {
    return {
        warning: 'Footnote-style references create footnotes or note markers, not backlinks.',
        hint: FOOTNOTE_REFERENCE_HINT,
    };
}

export function hasBlockRefIdFallbackAnchors(value: string): boolean {
    return /\(\(([0-9]{14}-[a-z0-9]{7})\s+(['"])\1\2\)\)/.test(value);
}

export function createUnresolvedBlockRefHint(): Record<string, unknown> {
    return {
        warning: 'Some naked block references used the block ID as fallback anchor text.',
        hint: UNRESOLVED_BLOCK_REF_HINT,
    };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function decodeHtml(value: string): string {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity: string) => {
        const normalized = entity.toLowerCase();
        if (normalized === 'amp') return '&';
        if (normalized === 'lt') return '<';
        if (normalized === 'gt') return '>';
        if (normalized === 'quot') return '"';
        if (normalized === 'apos') return "'";
        if (normalized === 'nbsp') return '\u00a0';
        if (normalized.startsWith('#x')) {
            const decoded = Number.parseInt(normalized.slice(2), 16);
            return Number.isFinite(decoded) ? String.fromCodePoint(decoded) : raw;
        }
        if (normalized.startsWith('#')) {
            const decoded = Number.parseInt(normalized.slice(1), 10);
            return Number.isFinite(decoded) ? String.fromCodePoint(decoded) : raw;
        }
        return raw;
    });
}

function parseKramdownBlock(kramdown: string): ParsedKramdownBlock {
    const match = kramdown.match(IAL_PATTERN);
    if (!match) {
        return {
            content: normalizeBlockRefQuoteStyle(kramdown.trimEnd()),
            ial: '',
        };
    }

    return {
        content: normalizeBlockRefQuoteStyle(kramdown.slice(0, match.index).trimEnd()),
        ial: match[0].trim(),
    };
}

export function escapeBlockRefAnchor(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function normalizeBlockRefQuoteStyle(kramdown: string): string {
    return kramdown.replace(BLOCK_REF_WITH_ANCHOR_PATTERN, (_raw, id: string, _quote: string, anchor: string) => {
        return `((${id} '${escapeBlockRefAnchor(anchor)}'))`;
    });
}

function normalizeMarkdownBlockRefsFromHtml(kramdown: string): string {
    return kramdown.replace(INLINE_BLOCK_REF_SPAN_PATTERN, (raw, attrs: string, inner: string) => {
        const id = attrs.match(DATA_ID_ATTR_PATTERN)?.[1] ?? attrs.match(DATA_ID_ATTR_PATTERN)?.[2];
        if (!id) return raw;
        const anchor = decodeHtml(inner.replace(/<[^>]+>/g, ''))
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'");
        return anchor ? `((${id} '${anchor}'))` : raw;
    });
}

function normalizeMarkdownTagsFromHtml(kramdown: string): string {
    return kramdown.replace(INLINE_TAG_SPAN_PATTERN, (raw, _attrs: string, inner: string) => {
        const label = decodeHtml(inner.replace(/<[^>]+>/g, ''))
            .replace(ZERO_WIDTH_CHARS_PATTERN, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!label) return raw;
        return label.startsWith('#') && label.endsWith('#') ? label : `#${label}#`;
    });
}

function updateFenceState(line: string, state: { marker: string; length: number } | null): { marker: string; length: number } | null {
    const match = line.match(FENCE_LINE_PATTERN);
    if (!match) return state;
    const fence = match[2];
    if (!fence) return state;
    const marker = fence[0];
    const length = fence.length;
    if (!state) return { marker, length };
    return marker === state.marker && length >= state.length ? null : state;
}

function stripListItemIalMarkers(markdown: string, blockType?: string): string {
    if (blockType !== 'l') return markdown.trimEnd();

    const lines: string[] = [];
    let fenceState: { marker: string; length: number } | null = null;

    for (const rawLine of markdown.split(/\r?\n/)) {
        const wasInFence = fenceState !== null;
        fenceState = updateFenceState(rawLine, fenceState);
        const isFenceBoundary = wasInFence !== (fenceState !== null);

        if (wasInFence || isFenceBoundary) {
            lines.push(rawLine);
            continue;
        }

        const line = rawLine.replace(INLINE_LIST_ITEM_IAL_PATTERN, '$1');
        if (STANDALONE_IAL_LINE_PATTERN.test(line)) continue;
        lines.push(line);
    }

    return lines.join('\n').trimEnd();
}

function stripContainerIalLines(markdown: string, blockType?: string): string {
    if (blockType !== 'b' && blockType !== 'callout' && blockType !== 's') return markdown.trimEnd();

    const lines: string[] = [];
    let fenceState: { marker: string; length: number } | null = null;
    let droppedQuotedIal = false;

    for (const rawLine of markdown.split(/\r?\n/)) {
        const wasInFence = fenceState !== null;
        fenceState = updateFenceState(rawLine, fenceState);
        const isFenceBoundary = wasInFence !== (fenceState !== null);

        if (wasInFence || isFenceBoundary) {
            lines.push(rawLine);
            continue;
        }

        if (STANDALONE_IAL_LINE_PATTERN.test(rawLine)) {
            droppedQuotedIal = false;
            continue;
        }
        if (QUOTED_STANDALONE_IAL_LINE_PATTERN.test(rawLine)) {
            droppedQuotedIal = true;
            continue;
        }
        if (droppedQuotedIal && QUOTE_BLANK_LINE_PATTERN.test(rawLine)) {
            continue;
        }
        if (EMPTY_LIST_ITEM_IAL_LINE_PATTERN.test(rawLine) || QUOTED_EMPTY_LIST_ITEM_IAL_PATTERN.test(rawLine)) {
            droppedQuotedIal = false;
            continue;
        }
        droppedQuotedIal = false;
        lines.push(rawLine
            .replace(INLINE_LIST_ITEM_IAL_PATTERN, '$1')
            .replace(QUOTED_INLINE_LIST_ITEM_IAL_PATTERN, '$1'));
    }

    return lines.join('\n').trimEnd();
}

function stripZeroWidthOutsideFences(markdown: string): string {
    const lines: string[] = [];
    let fenceState: { marker: string; length: number } | null = null;

    for (const rawLine of markdown.split(/\r?\n/)) {
        const wasInFence = fenceState !== null;
        fenceState = updateFenceState(rawLine, fenceState);
        const isFenceBoundary = wasInFence !== (fenceState !== null);

        lines.push(wasInFence || isFenceBoundary
            ? rawLine
            : rawLine.replace(ZERO_WIDTH_CHARS_PATTERN, ''));
    }

    return lines.join('\n').trimEnd();
}

export function toEditableMarkdownBlock(block: EditableMarkdownBlockInput): string {
    const parsed = parseKramdownBlock(block.kramdown);
    const normalizedInline = normalizeMarkdownTagsFromHtml(
        normalizeMarkdownBlockRefsFromHtml(parsed.content),
    );
    return stripZeroWidthOutsideFences(stripContainerIalLines(stripListItemIalMarkers(normalizedInline, block.type), block.type));
}

export function joinEditableMarkdownBlocks(blocks: EditableMarkdownBlockInput[]): string {
    return blocks
        .map((block) => toEditableMarkdownBlock(block))
        .filter((content) => content.length > 0)
        .join('\n\n');
}

export function extractKramdownContentForEditing(kramdown: string, blockType?: string): string {
    return toEditableMarkdownBlock({ kramdown, type: blockType });
}

function buildKramdownBlock(content: string, parsed: ParsedKramdownBlock): string {
    const normalizedContent = content.trimEnd();
    return parsed.ial ? `${normalizedContent}\n${parsed.ial}` : normalizedContent;
}

function applyReplaceToContent(
    content: string,
    edit: ExactReplaceEdit,
): { content: string; replaced: number; replaceAll: boolean } {
    const occurrences = countOccurrences(content, edit.old);
    if (occurrences === 0) {
        return { content, replaced: 0, replaceAll: Boolean(edit.replace_all) };
    }

    if (edit.replace_all) {
        return {
            content: content.split(edit.old).join(edit.new),
            replaced: occurrences,
            replaceAll: true,
        };
    }

    const index = content.indexOf(edit.old);
    return {
        content: `${content.slice(0, index)}${edit.new}${content.slice(index + edit.old.length)}`,
        replaced: 1,
        replaceAll: false,
    };
}

function normalizeListLineEdit(edit: ExactReplaceEdit): ExactReplaceEdit | null {
    if (/[\r\n]/.test(edit.old) || /[\r\n]/.test(edit.new)) return null;
    const oldMatch = edit.old.match(SINGLE_LIST_ITEM_LINE_PATTERN);
    if (!oldMatch) return null;
    const newMatch = edit.new.match(SINGLE_LIST_ITEM_LINE_PATTERN);
    if (newMatch && newMatch[1] !== oldMatch[1]) return null;
    return {
        ...edit,
        old: oldMatch[2] ?? '',
        new: newMatch ? (newMatch[2] ?? '') : edit.new,
    };
}

function applyReplaceToBlockContent(
    content: string,
    edit: ExactReplaceEdit,
    blockType: string | undefined,
): { edit: ExactReplaceEdit; content: string; replaced: number; replaceAll: boolean } {
    if (blockType === 'l') {
        const listLineEdit = normalizeListLineEdit(edit);
        if (listLineEdit) {
            const listLine = applyReplaceToContent(content, listLineEdit);
            if (listLine.replaced > 0) {
                return { edit: listLineEdit, ...listLine };
            }
        }
    }

    const direct = applyReplaceToContent(content, edit);
    return { edit, ...direct };
}

function renderPlainInline(value: string): string {
    return escapeHtml(value).replace(/\n/g, '<br>');
}

function replaceDomBlockRefToken(
    dom: string,
    edit: ExactReplaceEdit,
    maxReplacements: number,
): { dom: string; replaced: number } | null {
    const match = edit.old.match(SINGLE_BLOCK_REF_WITH_ANCHOR_PATTERN);
    if (!match) return null;

    const oldId = match[1];
    const oldAnchor = match[3];
    let replaced = 0;
    const nextDom = dom.replace(INLINE_BLOCK_REF_SPAN_PATTERN, (raw, attrs: string, inner: string) => {
        if (replaced >= maxReplacements) return raw;
        const id = attrs.match(DATA_ID_ATTR_PATTERN)?.[1] ?? attrs.match(DATA_ID_ATTR_PATTERN)?.[2];
        const anchor = decodeHtml(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        if (id !== oldId || anchor !== oldAnchor) return raw;
        replaced += 1;
        return renderInlineKramdown(edit.new);
    });

    return { dom: nextDom, replaced };
}

interface LogicalDomChar {
    value: string;
    start: number;
    end: number;
}

function pushLogicalToken(chars: LogicalDomChar[], value: string, start: number, end: number): void {
    for (const char of value) {
        if (ZERO_WIDTH_CHAR_PATTERN.test(char)) continue;
        chars.push({ value: char, start, end });
    }
}

function pushDecodedTextChars(chars: LogicalDomChar[], rawSegment: string, rawStart: number): void {
    let cursor = 0;
    while (cursor < rawSegment.length) {
        if (rawSegment[cursor] === '&') {
            const semi = rawSegment.indexOf(';', cursor + 1);
            if (semi !== -1) {
                const rawEntity = rawSegment.slice(cursor, semi + 1);
                const decoded = decodeHtml(rawEntity);
                if (decoded !== rawEntity) {
                    pushLogicalToken(chars, decoded, rawStart + cursor, rawStart + semi + 1);
                    cursor = semi + 1;
                    continue;
                }
            }
        }
        pushLogicalToken(chars, rawSegment[cursor], rawStart + cursor, rawStart + cursor + 1);
        cursor += 1;
    }
}

function searchPatternFrom(value: string, pattern: RegExp, from: number): number {
    const source = value.slice(from);
    const match = source.match(pattern);
    return match?.index === undefined ? -1 : from + match.index;
}

function findClosingSpanEnd(dom: string, openStart: number): number {
    const firstOpenEnd = dom.indexOf('>', openStart);
    if (firstOpenEnd === -1) return -1;
    let depth = 1;
    let cursor = firstOpenEnd + 1;
    while (cursor < dom.length) {
        const nextOpen = searchPatternFrom(dom, /<\s*span\b[^>]*>/i, cursor);
        const nextClose = searchPatternFrom(dom, /<\s*\/\s*span\s*>/i, cursor);
        if (nextClose === -1) return -1;
        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth += 1;
            const openEnd = dom.indexOf('>', nextOpen);
            if (openEnd === -1) return -1;
            cursor = openEnd + 1;
            continue;
        }
        depth -= 1;
        const closeEnd = dom.indexOf('>', nextClose);
        if (closeEnd === -1) return -1;
        if (depth === 0) return closeEnd + 1;
        cursor = closeEnd + 1;
    }
    return -1;
}

function logicalTokenFromProtectedSpan(rawSpan: string): string | null {
    const blockRefMatch = rawSpan.match(SINGLE_BLOCK_REF_SPAN_PATTERN);
    if (blockRefMatch) {
        const attrs = blockRefMatch[1] ?? '';
        const inner = blockRefMatch[2] ?? '';
        const id = attrs.match(DATA_ID_ATTR_PATTERN)?.[1] ?? attrs.match(DATA_ID_ATTR_PATTERN)?.[2];
        const anchor = decodeHtml(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        return id && anchor ? `((${id} '${anchor}'))` : null;
    }

    const tagMatch = rawSpan.match(SINGLE_TAG_SPAN_PATTERN);
    if (tagMatch) {
        const label = decodeHtml((tagMatch[2] ?? '').replace(/<[^>]+>/g, '')).trim();
        return label.startsWith('#') && label.endsWith('#') ? label : `#${label}#`;
    }

    return null;
}

function buildLogicalDomChars(dom: string): LogicalDomChar[] {
    const chars: LogicalDomChar[] = [];
    let cursor = 0;
    while (cursor < dom.length) {
        const tagStart = dom.indexOf('<', cursor);
        const textEnd = tagStart === -1 ? dom.length : tagStart;
        if (textEnd > cursor) {
            pushDecodedTextChars(chars, dom.slice(cursor, textEnd), cursor);
        }

        if (tagStart === -1) break;
        const tagEnd = dom.indexOf('>', tagStart);
        if (tagEnd === -1) break;
        const tag = dom.slice(tagStart, tagEnd + 1);

        if (PROTECTED_INLINE_PATTERN.test(tag) && /^<\s*span\b/i.test(tag)) {
            const spanEnd = findClosingSpanEnd(dom, tagStart);
            if (spanEnd !== -1) {
                const rawSpan = dom.slice(tagStart, spanEnd);
                const logical = logicalTokenFromProtectedSpan(rawSpan);
                if (logical) {
                    pushLogicalToken(chars, logical, tagStart, spanEnd);
                    cursor = spanEnd;
                    continue;
                }
            }
        }

        if (/^<\s*br\b/i.test(tag)) {
            pushLogicalToken(chars, '\n', tagStart, tagEnd + 1);
        }
        if (/^<\s*span\b/i.test(tag)) {
            const spanEnd = findClosingSpanEnd(dom, tagStart);
            if (spanEnd !== -1) {
                const rawSpan = dom.slice(tagStart, spanEnd);
                const innerStart = rawSpan.indexOf('>') + 1;
                const innerEnd = rawSpan.lastIndexOf('</span>');
                if (innerStart > 0 && innerEnd >= innerStart) {
                    const inner = rawSpan.slice(innerStart, innerEnd);
                    const innerChars: LogicalDomChar[] = [];
                    pushDecodedTextChars(innerChars, inner.replace(/<[^>]+>/g, ''), tagStart + innerStart);
                    for (const char of innerChars) {
                        chars.push({ value: char.value, start: tagStart, end: spanEnd });
                    }
                    cursor = spanEnd;
                    continue;
                }
            }
        }
        cursor = tagEnd + 1;
    }
    return chars;
}

function replaceDomLogicalContent(
    dom: string,
    edit: ExactReplaceEdit,
    maxReplacements: number,
): { dom: string; replaced: number } {
    let nextDom = dom;
    let replaced = 0;
    while (replaced < maxReplacements) {
        const chars = buildLogicalDomChars(nextDom);
        const logical = chars.map((char) => char.value).join('');
        const index = logical.indexOf(edit.old);
        if (index === -1) break;
        const lastIndex = index + edit.old.length - 1;
        const start = chars[index]?.start;
        const end = chars[lastIndex]?.end;
        if (start === undefined || end === undefined) break;
        nextDom = `${nextDom.slice(0, start)}${renderInlineKramdown(edit.new)}${nextDom.slice(end)}`;
        replaced += 1;
    }
    return { dom: nextDom, replaced };
}

function summarizeDomMapping(dom: string, edit: ExactReplaceEdit): string {
    const chars = buildLogicalDomChars(dom);
    const logical = chars.map((char) => char.value).join('');
    const preview = logical.length > 240 ? `${logical.slice(0, 240)}...` : logical;
    const oldPreview = edit.old.length > 160 ? `${edit.old.slice(0, 160)}...` : edit.old;
    return ` DOM logical text preview: ${JSON.stringify(preview)}. Old preview: ${JSON.stringify(oldPreview)}.`;
}

function replaceTextSegment(
    rawSegment: string,
    edit: ExactReplaceEdit,
    remaining: number,
    protectedInline: boolean,
): { segment: string; replaced: number } {
    if (remaining <= 0) {
        return { segment: rawSegment, replaced: 0 };
    }

    if (protectedInline && /^#[^#\s][^#\n]*#$/.test(edit.old)) {
        return { segment: rawSegment, replaced: 0 };
    }

    const decoded = decodeHtml(rawSegment);
    const occurrences = countOccurrences(decoded, edit.old);
    if (occurrences === 0) {
        return { segment: rawSegment, replaced: 0 };
    }

    const limit = Math.min(occurrences, remaining);
    let output = '';
    let replaced = 0;
    let index = 0;
    while (replaced < limit) {
        const nextIndex = decoded.indexOf(edit.old, index);
        if (nextIndex === -1) break;
        output += escapeHtml(decoded.slice(index, nextIndex));
        output += protectedInline ? renderPlainInline(edit.new) : renderInlineKramdown(edit.new);
        index = nextIndex + edit.old.length;
        replaced += 1;
    }
    output += escapeHtml(decoded.slice(index));
    return { segment: output, replaced };
}

function updateDomStack(tag: string, stack: boolean[]): void {
    if (/^<\s*\/\s*[^>]+>/.test(tag)) {
        stack.pop();
        return;
    }
    if (/^<\s*[!?]/.test(tag) || /\/\s*>$/.test(tag) || VOID_TAG_PATTERN.test(tag)) {
        return;
    }
    stack.push(PROTECTED_INLINE_PATTERN.test(tag));
}

function replaceDomTextContent(
    dom: string,
    edit: ExactReplaceEdit,
    maxReplacements: number,
    actionName: string,
    editIndex: number,
): { dom: string; replaced: number } {
    const blockRefResult = replaceDomBlockRefToken(dom, edit, maxReplacements);
    if (blockRefResult) return blockRefResult;

    let output = '';
    let cursor = 0;
    let replaced = 0;
    const stack: boolean[] = [];

    while (cursor < dom.length) {
        const tagStart = dom.indexOf('<', cursor);
        const textEnd = tagStart === -1 ? dom.length : tagStart;
        if (textEnd > cursor) {
            const rawSegment = dom.slice(cursor, textEnd);
            const result = replaceTextSegment(
                rawSegment,
                edit,
                maxReplacements === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : maxReplacements - replaced,
                stack.some(Boolean),
            );
            output += result.segment;
            replaced += result.replaced;
        }

        if (tagStart === -1) break;
        const tagEnd = dom.indexOf('>', tagStart);
        if (tagEnd === -1) {
            throw new Error(`${actionName} cannot safely update DOM for edit #${editIndex + 1}: malformed block DOM.`);
        }
        const tag = dom.slice(tagStart, tagEnd + 1);
        output += tag;
        updateDomStack(tag, stack);
        cursor = tagEnd + 1;

        if (replaced >= maxReplacements) {
            output += dom.slice(cursor);
            return { dom: output, replaced };
        }
    }

    if (replaced > 0) return { dom: output, replaced };
    return replaceDomLogicalContent(dom, edit, maxReplacements);
}

function assertDomReplacementMatchesKramdown(
    actionName: string,
    editIndex: number,
    kramdownReplaced: number,
    domReplaced: number,
    dom: string,
    edit: ExactReplaceEdit,
): void {
    if (domReplaced === kramdownReplaced) return;
    throw new Error(`${actionName} cannot safely map edit #${editIndex + 1} from kramdown to DOM. The match may cross unsupported inline formatting; narrow the old text or use block.update/fs.write for a full block rewrite. Expected ${kramdownReplaced} DOM replacement(s), got ${domReplaced}.${summarizeDomMapping(dom, edit)}`);
}

function assertEditDoesNotTouchIal(edit: ExactReplaceEdit, actionName: string, editIndex: number): void {
    if (/\{:\s*[^}]*\bid=/.test(edit.old) || /\{:\s*[^}]*\bid=/.test(edit.new)) {
        throw new Error(`${actionName} edit #${editIndex + 1} appears to modify block IAL metadata. Use block(action="set_attrs") for attributes and keep content replacements inside the block body.`);
    }
}

export function replaceSingleKramdownBlockContentInDom(
    kramdown: string,
    dom: string,
    edits: ExactReplaceEdit[],
    actionName: string,
): ReplaceDomResult {
    const parsed = parseKramdownBlock(kramdown);
    let nextContent = parsed.content;
    let nextDom = dom;
    const summary: ExactReplaceSummary[] = [];

    edits.forEach((edit, index) => {
        assertEditDoesNotTouchIal(edit, actionName, index);
        const result = applyReplaceToContent(nextContent, edit);
        if (result.replaced === 0) {
            const scopeHint = actionName === 'block.replace'
                ? ' block.replace only searches the content body of the single block identified by id; it does not include child blocks, sibling blocks, the whole document, or block IAL metadata.'
                : '';
            throw new Error(`${actionName} edit #${index + 1} did not match any text.${scopeHint}`);
        }
        const domResult = replaceDomTextContent(
            nextDom,
            edit,
            result.replaceAll ? Number.POSITIVE_INFINITY : 1,
            actionName,
            index,
        );
        assertDomReplacementMatchesKramdown(actionName, index, result.replaced, domResult.replaced, nextDom, edit);
        nextContent = result.content;
        nextDom = domResult.dom;
        summary.push({
            index: index + 1,
            replaced: result.replaced,
            replace_all: result.replaceAll,
        });
    });

    const nextKramdown = buildKramdownBlock(nextContent, parsed);
    assertSafeKramdownForDomUpdate(nextKramdown);
    return {
        kramdown: nextKramdown,
        markdown: nextContent,
        dom: nextDom,
        summary,
    };
}

export function replaceEditTouchesIndexedInline(edit: ExactReplaceEdit): boolean {
    return BLOCK_REF_WITH_ANCHOR_DETECT_PATTERN.test(edit.old)
        || BLOCK_REF_WITH_ANCHOR_DETECT_PATTERN.test(edit.new)
        || TAG_DETECT_PATTERN.test(edit.old)
        || TAG_DETECT_PATTERN.test(edit.new);
}

export function applyDocumentKramdownDomReplacements(
    blocks: Array<{ id: string; kramdown: string; dom: string; type?: string }>,
    edits: ExactReplaceEdit[],
    actionName: string,
): {
    blocks: ReplaceDocumentBlockResult[];
    summary: ExactReplaceSummary[];
} {
    const parsedBlocks = blocks.map((block) => ({
        id: block.id,
        parsed: parseKramdownBlock(block.kramdown),
        editableContent: toEditableMarkdownBlock(block),
        dom: block.dom,
        type: block.type,
    }));
    const changedBlocks = new Map<string, ReplaceDocumentBlockResult>();
    const summary: ExactReplaceSummary[] = [];

    edits.forEach((edit, index) => {
        assertEditDoesNotTouchIal(edit, actionName, index);
        let replaced = 0;

        for (const block of parsedBlocks) {
            if (!edit.replace_all && replaced > 0) break;
            const beforeContent = block.editableContent;
            const result = applyReplaceToBlockContent(block.editableContent, edit, block.type);
            if (result.replaced === 0) continue;
            const domResult = replaceDomTextContent(
                block.dom,
                result.edit,
                result.replaceAll ? Number.POSITIVE_INFINITY : 1,
                actionName,
                index,
            );
            assertDomReplacementMatchesKramdown(actionName, index, result.replaced, domResult.replaced, block.dom, result.edit);
            block.editableContent = result.content;
            block.dom = domResult.dom;
            replaced += result.replaced;
            if (result.content !== beforeContent) {
                const kramdown = buildKramdownBlock(block.editableContent, block.parsed);
                assertSafeKramdownForDomUpdate(kramdown);
                const previous = changedBlocks.get(block.id);
                changedBlocks.set(block.id, {
                    id: block.id,
                    kramdown,
                    markdown: block.editableContent,
                    dom: block.dom,
                    type: block.type,
                    touchesIndexedInline: Boolean(previous?.touchesIndexedInline)
                        || replaceEditTouchesIndexedInline(edit)
                        || replaceEditTouchesIndexedInline(result.edit),
                });
            }
        }

        if (replaced === 0) {
            throw new Error(`${actionName} edit #${index + 1} did not match any text in editable document blocks. Cross-block replacements are not allowed because they would require rebuilding blocks.`);
        }

        summary.push({
            index: index + 1,
            replaced,
            replace_all: Boolean(edit.replace_all),
        });
    });

    return {
        blocks: [...changedBlocks.values()],
        summary,
    };
}

export function assertSafeKramdownForDomUpdate(kramdown: string): void {
    if (NAKED_BLOCK_REF_PATTERN.test(kramdown)) {
        throw new Error('Refusing to write naked block references like ((id)). Use ((id \'完整标题\')) so the anchor text is explicit.');
    }
}

export function assertSafeBlockReferenceMarkdown(
    markdown: string,
    actionName: string,
    options: { allowNakedBlockRefs?: boolean } = {},
): void {
    if (!options.allowNakedBlockRefs && NAKED_BLOCK_REF_PATTERN.test(markdown)) {
        throw new Error(`${actionName} refuses naked block references like ((id)). Use ((id '完整标题')) so the anchor text is explicit.`);
    }
}

function renderTagsInPlainText(value: string): string {
    let output = '';
    let lastIndex = 0;
    for (const match of value.matchAll(TAG_PATTERN)) {
        output += escapeHtml(value.slice(lastIndex, match.index));
        const rawTag = match[0];
        const label = match[1];
        output += `<span data-type="tag">${escapeHtml(label)}</span>`;
        lastIndex = (match.index ?? 0) + rawTag.length;
    }
    output += escapeHtml(value.slice(lastIndex));
    return output;
}

function renderInlineKramdown(value: string): string {
    let output = '';
    let lastIndex = 0;
    for (const match of value.matchAll(BLOCK_REF_WITH_ANCHOR_PATTERN)) {
        output += renderTagsInPlainText(value.slice(lastIndex, match.index));
        const id = match[1];
        const anchor = match[3];
        output += `<span data-type="block-ref" data-subtype="s" data-id="${escapeHtml(id)}">${escapeHtml(anchor)}</span>`;
        lastIndex = (match.index ?? 0) + match[0].length;
    }
    output += renderTagsInPlainText(value.slice(lastIndex));
    return output.replace(/\n/g, '<br>');
}

export function normalizeDomInlineRefsAndTags(dom: string, actionName: string): string {
    assertSafeBlockReferenceMarkdown(dom, actionName);
    let output = '';
    let cursor = 0;
    const stack: boolean[] = [];

    while (cursor < dom.length) {
        const tagStart = dom.indexOf('<', cursor);
        const textEnd = tagStart === -1 ? dom.length : tagStart;
        if (textEnd > cursor) {
            const rawSegment = dom.slice(cursor, textEnd);
            output += stack.some(Boolean)
                ? rawSegment
                : renderInlineKramdown(decodeHtml(rawSegment));
        }

        if (tagStart === -1) break;
        const tagEnd = dom.indexOf('>', tagStart);
        if (tagEnd === -1) {
            throw new Error(`${actionName} cannot safely normalize DOM: malformed block DOM.`);
        }
        const tag = dom.slice(tagStart, tagEnd + 1);
        output += tag;
        updateDomStack(tag, stack);
        cursor = tagEnd + 1;
    }

    return output;
}

export function stripRedundantTitleHeading(markdown: string, title: string | undefined): string {
    const normalizedTitle = title?.trim();
    const withoutBom = markdown.replace(/^\uFEFF/, '');
    const leadingWhitespace = withoutBom.match(/^\s*/)?.[0] ?? '';
    const rest = withoutBom.slice(leadingWhitespace.length);

    if (!normalizedTitle) return markdown;

    const headingPattern = new RegExp(`^#\\s+${escapeRegExp(normalizedTitle)}(?:\\s*\\r?\\n|\\s*$)`);
    if (!headingPattern.test(rest)) return markdown;

    return `${leadingWhitespace}${rest.replace(headingPattern, '').replace(/^\r?\n+/, '')}`;
}

/** Reference-semantics hints for markdown a tool wrote or returned (block links, footnotes, unresolved refs). */
export function withReferenceSemanticsHints<T extends Record<string, unknown>>(payload: T, data: string): T & Record<string, unknown> {
    return {
        ...payload,
        ...(hasSiyuanBlockLinks(data) ? createSiyuanBlockLinkHint() : {}),
        ...(hasFootnoteReferences(data) ? createFootnoteReferenceHint() : {}),
        ...(hasBlockRefIdFallbackAnchors(data) ? createUnresolvedBlockRefHint() : {}),
    };
}

export function hasReferenceSemanticsHints(data: string): boolean {
    return hasSiyuanBlockLinks(data) || hasFootnoteReferences(data) || hasBlockRefIdFallbackAnchors(data);
}

export function createReferenceSemanticsHints(data: string): Record<string, unknown> {
    return withReferenceSemanticsHints({}, data);
}
