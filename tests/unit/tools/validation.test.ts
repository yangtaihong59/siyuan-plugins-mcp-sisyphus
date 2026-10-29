import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    formatIssuePath,
    formatZodIssues,
    getValidationMessage,
    getValueAtPath,
    includeDebugDetails,
    isApiError,
    resolveHint,
} from '@/tools/internal/validation';
import { requestError } from '../../helpers/request-error';

describe('tools/validation', () => {
    it('formats nested issue paths and reads matching raw values', () => {
        const value = { cells: [{ rowID: 'row-1' }] };

        expect(formatIssuePath(['cells', 0, 'rowID'])).toBe('cells[0].rowID');
        expect(getValueAtPath(value, ['cells', 0, 'rowID'])).toBe('row-1');
        expect(getValueAtPath(value, ['cells', 1, 'rowID'])).toBeUndefined();
        expect(getValueAtPath(value, ['cells', 'bad'])).toBeUndefined();
    });

    it('formats Zod issues into user-facing field errors', () => {
        const schema = z.object({
            title: z.string(),
            cells: z.array(z.object({ rowID: z.string() })),
        }).strict();
        const result = schema.safeParse({ cells: [{ rowID: 123 }], extra: true });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(formatZodIssues(result.error, { cells: [{ rowID: 123 }], extra: true })).toEqual([
                { path: 'title', message: 'title is required.' },
                { path: 'cells[0].rowID', message: 'cells[0].rowID has an invalid type. Expected string.' },
                { path: '', message: 'Unexpected field(s): extra.' },
            ]);
        }
    });

    it('builds validation messages, hints, API-error checks, and debug toggle', () => {
        expect(getValidationMessage('document', 'rename')).toBe('Invalid arguments for document(action="rename").');
        expect(getValidationMessage('document')).toBe('Invalid arguments for tool "document".');
        expect(getValidationMessage()).toBe('Invalid arguments.');
        expect(resolveHint({ hint: 'explicit hint' })).toBe('explicit hint');
        expect(isApiError(requestError('HTTP error: 500'))).toBe(true);
        expect(isApiError(new Error('plain'))).toBe(false);

        const previous = process.env.SIYUAN_MCP_DEBUG_ERRORS;
        process.env.SIYUAN_MCP_DEBUG_ERRORS = '1';
        expect(includeDebugDetails()).toBe(true);
        process.env.SIYUAN_MCP_DEBUG_ERRORS = previous;
    });
});
