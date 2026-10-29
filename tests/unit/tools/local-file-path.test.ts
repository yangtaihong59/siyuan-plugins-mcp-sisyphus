import { describe, expect, it } from 'vitest';
import { createRelativeLocalPathResult, isAbsoluteLocalPath } from '@/tools/internal/shared';

describe('isAbsoluteLocalPath', () => {
    it('accepts POSIX, Windows drive and UNC paths', () => {
        for (const value of ['/tmp/a.png', 'C:\\Users\\me\\a.png', 'd:/a.png', '\\\\host\\share\\a.png']) {
            expect(isAbsoluteLocalPath(value)).toBe(true);
        }
    });

    it('rejects paths relative to an unknown working directory', () => {
        for (const value of ['a.png', './a.png', '../a.png', '.sisyphus/acceptance/a.png', 'C:a.png', '~/a.png']) {
            expect(isAbsoluteLocalPath(value)).toBe(false);
        }
    });

    it('explains the rejection without claiming a write was attempted', () => {
        const result = createRelativeLocalPathResult('file', 'upload_asset', './a.png');
        const payload = JSON.parse(result.content[0].text);
        expect(result.isError).toBe(true);
        expect(payload.error).toMatchObject({ type: 'validation_error', field: 'localFilePath' });
        expect(payload.error.hint).toContain('No write was attempted');
    });
});
