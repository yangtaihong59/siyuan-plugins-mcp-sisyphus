import { SiYuanRequestError } from '@/api/errors';

/**
 * Build the typed error a real SiYuanClient throws for a given display
 * message, so tests exercise type-based classification, not message text.
 */
export function requestError(message: string): SiYuanRequestError {
    const api = message.match(/^SiYuan API error:\s*(-?\d+)/);
    if (api) return new SiYuanRequestError('api', message, { apiCode: Number(api[1]) });
    const http = message.match(/^HTTP error:\s*(\d{3})/);
    if (http) {
        const status = Number(http[1]);
        return new SiYuanRequestError('http', message, { status, retryable: status === 429 || status >= 500 });
    }
    if (message.startsWith('Request timeout')) return new SiYuanRequestError('timeout', message, { retryable: true });
    throw new Error(`requestError: unrecognised SiYuan error message "${message}"`);
}
