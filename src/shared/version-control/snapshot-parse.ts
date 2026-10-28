/**
 * Parse a snapshot file (SiYuan JSON tree, Protyle HTML or Markdown) into
 * comparable blocks. Pure; used by block-diff.
 */
import { escapeRegExp } from '../text';
import type { SnapshotBlock } from './snapshot-types';

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

export function isCodeBlock(type: string | undefined, subtype: string | undefined): boolean {
    return type === 'c' || type === 'code' || subtype === 'code';
}

export function isMathBlock(type: string | undefined, subtype: string | undefined): boolean {
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
