import { describe, expect, it } from 'vitest';

import { apiCodeError, httpStatusError, isAmbiguousWriteFailure, isMissingFileError, SiYuanRequestError } from '@/api/errors';
import { KernelResponseError } from '@/kernel/client';

describe('typed SiYuan request errors', () => {
    it('treats only explicit SiYuan rejections as a write that did not commit', () => {
        expect(isAmbiguousWriteFailure(apiCodeError(-1, 'bad'))).toBe(false);
        expect(isAmbiguousWriteFailure(httpStatusError(400, 'HTTP error: 400'))).toBe(false);
        expect(isAmbiguousWriteFailure(httpStatusError(502, 'HTTP error: 502'))).toBe(true);
        expect(isAmbiguousWriteFailure(new SiYuanRequestError('timeout', 'Request timeout'))).toBe(true);
        expect(isAmbiguousWriteFailure(new Error('socket hang up'))).toBe(true);
    });

    it('gives kernel errors the same contract as the HTTP client', () => {
        const error = new KernelResponseError('http', 'HTTP error: 404 reading /x', 404, false);
        expect(error).toBeInstanceOf(SiYuanRequestError);
        expect(isMissingFileError(error)).toBe(true);
        expect(isAmbiguousWriteFailure(error)).toBe(false);
    });
});
