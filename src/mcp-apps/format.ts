/** Pure formatting, escaping and result helpers for the MCP Apps page. */

export type JsonObject = Record<string, any>;

export function previewResult(payload: JsonObject) {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
    };
}

export function chineseCount(value: number) {
    if (!Number.isInteger(value) || value < 0 || value >= 100) return String(value);
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (value < 10) return digits[value];
    if (value === 10) return '十';
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${tens === 1 ? '' : digits[tens]}十${ones === 0 ? '' : digits[ones]}`;
}

export function restoreBlockIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5M5 12h9.5A5.5 5.5 0 0 1 20 17.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

export function restoreDocumentIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.8 3.5h3.95L19 7.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-8.5A2.25 2.25 0 0 1 6 18.25V9.9M14.5 3.75V8h4.25M4.8 9.4V8.5a5 5 0 0 1 5-5h.65M2 6.55 4.8 9.4l2.85-2.85" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

export function resultPayload(result: any): JsonObject | undefined {
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

export function isToolError(result: unknown) {
    return isObject(result) && result.isError === true;
}

export function toolErrorMessage(result: unknown) {
    const payload = resultPayload(result);
    const error = isObject(payload?.error) ? payload.error : undefined;
    return String(error?.message ?? payload?.message ?? payload?.value ?? '工具调用失败。');
}

export function toolErrorCode(result: unknown) {
    const payload = resultPayload(result);
    const error = isObject(payload?.error) ? payload.error : undefined;
    return String(error?.code ?? '');
}

export function ratingLabel(rating: number) {
    return ({ 1: '重来', 2: '困难', 3: '良好', 4: '简单' } as Record<number, string>)[rating] ?? String(rating);
}

export function ratingEnglish(rating: number) {
    return ({ 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' } as Record<number, string>)[rating] ?? String(rating);
}

export function ratingCount(rating: number, label: string, count: number) {
    return `<div class="rating-count rating-${rating}"><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`;
}

export function emptyState(icon: string, title: string, detail: string) {
    return `<div class="empty-state"><span>${icon}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

export function cardFace(card: JsonObject | undefined, keys: string[]) {
    if (!card) return '';
    for (const key of keys) {
        if (typeof card[key] === 'string' && card[key].trim()) return stripHtml(card[key]).trim();
    }
    return '';
}

export function blockText(block: unknown) {
    if (!isObject(block)) return '';
    return String(block.markdown ?? block.content ?? block.text ?? '');
}

export function stripHtml(value: string) {
    const template = document.createElement('template');
    template.innerHTML = value;
    return template.content.textContent ?? value;
}

export function applyTheme(theme: unknown) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

export function formatTime(value: unknown) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '未知时间';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(number));
}

export function shortId(value: string) {
    if (!value) return '—';
    return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function isFlashcardAction(action: string) {
    return ['flashcard_review_session', 'review_card'].includes(action);
}

export function isTimelineAction(action: string) {
    return ['list_nodes', 'create_node', 'compare_node', 'delete_node', 'rollback_document', 'rollback_block'].includes(action);
}

export function isMascotAction(action: string) {
    return ['get_balance', 'shop', 'buy'].includes(action);
}

export function isAppMutation(action: string) {
    return [
        'review_card',
        'create_node',
        'delete_node',
        'rollback_document',
        'rollback_block',
        'buy',
    ].includes(action);
}

export function isObject(value: unknown): value is JsonObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function numberOrUndefined(value: unknown) {
    return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

export function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function escapeAttr(value: string) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}
