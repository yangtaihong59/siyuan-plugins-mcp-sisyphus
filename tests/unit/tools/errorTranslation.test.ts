import { describe, it, expect } from 'vitest';
import { translateError, isMissingBlockError } from '@/tools/internal/errorTranslation';
import { createErrorResult } from '@/tools/internal/shared';

describe('translateError', () => {
    it('maps missing-block kernel messages to block_not_found', () => {
        const translated = translateError(new Error('SiYuan API error: -1 - 未找到 ID 为 [xxx] 的内容块'));
        expect(translated?.code).toBe('block_not_found');
        expect(translated?.hint).toMatch(/block\(action="info"/);
    });

    it('maps notebook initialization errors to notebook_closed', () => {
        const translated = translateError(new Error('notebook is currently closed'));
        expect(translated?.code).toBe('notebook_closed');
    });

    it('maps transport errors to kernel_unreachable', () => {
        const translated = translateError(new Error('HTTP error: fetch failed'));
        expect(translated?.code).toBe('kernel_unreachable');
    });

    it.each([[401, 'authentication_failed'], [403, 'permission_denied'], [429, 'rate_limited'], [404, 'kernel_http_error'], [500, 'kernel_http_error']])('classifies HTTP %s without claiming the kernel is stopped', (status, code) => {
        const error = new Error(`HTTP error: ${status} status`);
        expect(translateError(error)?.code).toBe(code);
        const response = JSON.parse(createErrorResult(error).content[0].text);
        expect(response.error.message).toContain(String(status));
        expect(response.error.hint).not.toContain('start SiYuan');
    });

    it('returns null for unrecognised errors', () => {
        expect(translateError(new Error('some random failure'))).toBeNull();
    });

    it('does not mistake invalid JSON or an arbitrary ID mention for a missing block', () => {
        expect(translateError(new Error('SiYuan API error: -1 - invalid character T'))).toBeNull();
        expect(translateError(new Error('SiYuan API error: -1 - invalid block ID'))).toBeNull();
        const error = new Error('SiYuan API error: -1 - read asset references [/data/test.sy] failed: invalid character T');
        expect(translateError(error)?.code).toBe('asset_reference_scan_failed');
        expect(isMissingBlockError(error)).toBe(false);
    });
});

describe('isMissingBlockError compatibility', () => {
    it('keeps returning true for kernel -1 messages', () => {
        expect(isMissingBlockError(new Error('SiYuan API error: -1 - 未找到 ID 为 [abc] 的内容块'))).toBe(true);
        expect(isMissingBlockError(new Error('some other error'))).toBe(false);
        expect(isMissingBlockError(null)).toBe(false);
    });
});

describe('createErrorResult wires translator', () => {
    it('adds a code field when the kernel message matches a known pattern', () => {
        const result = createErrorResult(new Error('SiYuan API error: -1 - 未找到 ID 为 [abc] 的内容块'), {
            tool: 'block',
            action: 'info',
        });
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.code).toBe('block_not_found');
        expect(parsed.error.hint).toContain('block(action="info"');
    });

    it('leaves unrelated errors untouched', () => {
        const result = createErrorResult(new Error('weirdest thing'));
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.code).toBeUndefined();
    });
});
