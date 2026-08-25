export const APPROX_TOKEN_MODE = 'approx_context_v1' as const;

export interface ApproxTokenMetrics {
    chars: number;
    approxTokens: number;
}

export function approximateTokensFromChars(chars: number): number {
    return Math.ceil(Math.max(0, chars) / 4);
}

export function measureApproxText(text: string | undefined | null): ApproxTokenMetrics {
    const normalized = typeof text === 'string' ? text : '';
    return {
        chars: normalized.length,
        approxTokens: approximateTokensFromChars(normalized.length),
    };
}

export function measureApproxContent(content: Array<{ type: string; text?: string }> | undefined): ApproxTokenMetrics {
    const text = (content ?? []).map((item) => item.type === 'text' ? item.text ?? '' : '').join('');
    return measureApproxText(text);
}
