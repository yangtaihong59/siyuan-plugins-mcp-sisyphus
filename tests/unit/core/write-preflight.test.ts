import { describe, expect, it } from 'vitest';

import {
    assertPreflightCommitArgsSize,
    buildWritePreflight,
    computeWritePreflightCounts,
    WRITE_PREFLIGHT_MAX_COMMIT_ARGS_BYTES,
    WRITE_PREFLIGHT_VERSION,
} from '@/core/write-preflight';

describe('write preflight v2', () => {
    it('counts distinct rows and explicit cells without value deduplication', () => {
        expect(computeWritePreflightCounts('av', 'set_cells', {
            cells: [
                { rowID: 'row-a', columnID: 'col-1', text: 'same' },
                { rowID: 'row-a', columnID: 'col-2', text: 'same' },
                { rowID: 'row-b', columnID: 'col-1', text: 'same' },
            ],
        }, 1)).toEqual({ operationCount: 1, rowCount: 2, cellCount: 3, guardTargetCount: 1 });
    });

    it('omits metrics that are not meaningful for the action', () => {
        expect(computeWritePreflightCounts('block', 'append', { parentID: 'doc-1' }, 1))
            .toEqual({ operationCount: 1, guardTargetCount: 1 });
    });

    it('builds commitArgs that strip validateOnly and hash fields but keep business arguments', () => {
        const result = buildWritePreflight({
            category: 'av',
            action: 'set_cells',
            args: {
                action: 'set_cells',
                avID: 'av-1',
                cells: [{ rowID: 'row-a', columnID: 'col-1', valueType: 'text', text: 'x' }],
                validateOnly: true,
                expectedManifestHash: 'stale',
                requestId: 'old',
            },
            requestId: 'abcd',
            expiresAt: 123,
            guardTargetCount: 1,
            credentialField: 'expectedManifestHash',
            credential: 'ef01',
        });
        expect(result.preflight).toEqual({
            version: WRITE_PREFLIGHT_VERSION,
            requestId: 'abcd',
            expiresAt: 123,
            ttlMs: 600000,
            counts: { operationCount: 1, rowCount: 1, cellCount: 1, guardTargetCount: 1 },
            commitArgs: {
                action: 'set_cells',
                avID: 'av-1',
                cells: [{ rowID: 'row-a', columnID: 'col-1', valueType: 'text', text: 'x' }],
                validateOnly: false,
                requestId: 'abcd',
                expectedManifestHash: 'ef01',
            },
        });
    });

    it('rejects a preflight whose executable arguments exceed the response limit', () => {
        expect(() => assertPreflightCommitArgsSize({
            text: 'x'.repeat(WRITE_PREFLIGHT_MAX_COMMIT_ARGS_BYTES + 1),
        })).toThrow(/exceeding/);
    });
});
