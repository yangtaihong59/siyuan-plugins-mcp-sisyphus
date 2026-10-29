import type { ToolCategory } from './config';
import { stripSafetyFields } from './write-safety-fields';
import { asRecord } from '../shared/record';

export const WRITE_PREFLIGHT_VERSION = 2;
/** Executable commitArgs larger than this are rejected, never truncated. */
export const WRITE_PREFLIGHT_MAX_COMMIT_ARGS_BYTES = 512 * 1024;

/**
 * One wording shared by action help and resource help. The preflight is a
 * field-resolution step, not an authorization grant: the commit still
 * revalidates permission, action switches, state, and the idempotency ledger.
 */
export const WRITE_WORKFLOW_STEPS = [
    'Confirm the user-authorized target and operation scope.',
    'Call the same action with validateOnly=true to obtain preflight.commitArgs.',
    'Read the returned preview (targets, changes, risk) and confirm it matches the intended change; if not, do not commit. preview="full" returns complete before/after text.',
    'Copy preflight.commitArgs unchanged as the next call arguments; do not edit requestId, hashes, or business fields.',
    'Read the target back or inspect the returned receipt before reporting success.',
] as const;

export interface WritePreflightCounts {
    operationCount: number;
    rowCount?: number;
    cellCount?: number;
    /** Distinct objects whose state the commit re-checks (strict preflight only). */
    targetCount?: number;
}

export interface WritePreflightEnvelope {
    version: number;
    requestId: string;
    expiresAt: number;
    counts: WritePreflightCounts;
    commitArgs: Record<string, unknown>;
}

function stringArrayLength(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
}

function readCellRows(args: Record<string, unknown>): string[] {
    const cells = Array.isArray(args.cells)
        ? args.cells
        : Array.isArray(args.items)
            ? args.items
            : typeof args.rowID === 'string'
                ? [{ rowID: args.rowID }]
                : [];
    return cells.flatMap((cell) => {
        const rowID = asRecord(cell)?.rowID;
        return typeof rowID === 'string' && rowID ? [rowID] : [];
    });
}

/**
 * Counts are action-specific. Metrics that cannot be computed are omitted
 * instead of being reported as zero.
 */
export function computeWritePreflightCounts(
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    targetCount?: number,
): WritePreflightCounts {
    const counts: WritePreflightCounts = { operationCount: 1 };

    if (category === 'av' && action === 'add_rows') {
        const rows = Array.isArray(args.rows) ? args.rows : undefined;
        if (rows) {
            counts.operationCount = rows.length;
            counts.rowCount = rows.length;
            counts.cellCount = rows.reduce((total, row) => {
                const cells = asRecord(row)?.cells;
                return total + (Array.isArray(cells) ? cells.length : 0);
            }, 0);
        } else {
            const rowCount = stringArrayLength(args.blockIDs) + stringArrayLength(args.primaryKeyTexts);
            counts.operationCount = rowCount;
            counts.rowCount = rowCount;
        }
    } else if (category === 'av' && action === 'set_cells') {
        const rows = readCellRows(args);
        counts.rowCount = new Set(rows).size;
        counts.cellCount = rows.length;
    } else if (category === 'av' && action === 'remove_rows') {
        const rowCount = stringArrayLength(args.rowIDs) || stringArrayLength(args.srcIDs);
        counts.operationCount = rowCount;
        counts.rowCount = rowCount;
    } else if (category === 'document' && action === 'rename' && Array.isArray(args.items)) {
        counts.operationCount = args.items.length;
    }

    if (typeof targetCount === 'number' && Number.isFinite(targetCount)) {
        counts.targetCount = targetCount;
    }
    return counts;
}

export function assertPreflightCommitArgsSize(args: Record<string, unknown>): void {
    const bytes = new TextEncoder().encode(JSON.stringify(stripSafetyFields(args))).length;
    if (bytes > WRITE_PREFLIGHT_MAX_COMMIT_ARGS_BYTES) {
        throw Object.assign(
            new Error(`The normalized preflight arguments are ${bytes} bytes, exceeding the ${WRITE_PREFLIGHT_MAX_COMMIT_ARGS_BYTES}-byte executable response limit. Split the batch; nothing was executed.`),
            { name: 'WritePreflightError', code: 'preflight_batch_too_large' },
        );
    }
}

export function buildWritePreflight(options: {
    category: ToolCategory;
    action: string;
    args: Record<string, unknown>;
    requestId: string;
    expiresAt: number;
    targetCount?: number;
    credentialField?: string;
    credential?: string;
}): { preflight: WritePreflightEnvelope } {
    const commitArgs: Record<string, unknown> = {
        ...stripSafetyFields(options.args),
        validateOnly: false,
        requestId: options.requestId,
    };
    if (options.credentialField && options.credential) {
        commitArgs[options.credentialField] = options.credential;
    }
    return {
        preflight: {
            version: WRITE_PREFLIGHT_VERSION,
            requestId: options.requestId,
            expiresAt: options.expiresAt,
            counts: computeWritePreflightCounts(
                options.category,
                options.action,
                options.args,
                options.targetCount,
            ),
            commitArgs,
        },
    };
}
