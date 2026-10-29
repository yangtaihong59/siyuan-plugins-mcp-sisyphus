/**
 * Fail-closed self-test for restricted SQL.
 *
 * SiYuan's /api/query/sql re-parses a statement with Go SQL parsers and, when
 * one of them succeeds, executes the parser's re-serialised text instead of the
 * original. Because those lexers disagree with SQLite about quoting, text that
 * SQLite reads as one quoted identifier can come back as live SQL, e.g.
 *
 *   SELECT 1 AS "a` , (SELECT ...) , `b"
 *
 * is a single alias for SQLite but runs `(SELECT ...)` as its own column after
 * re-serialisation. restricted-sql.ts defeats this with a guard prefix that
 * makes the kernel parsers fail so the analysed text runs verbatim.
 *
 * Before restricted mode is trusted on a kernel, this module sends that exact
 * pattern through the real rewriter with a harmless hidden subquery (no table,
 * only `upper()` of a constant). If the hidden subquery's output ever appears,
 * the guard does not hold on this kernel and restricted SQL is refused.
 */

import type { SiYuanClient } from '../../api/client';
import * as searchApi from '../../api/search';
import { rewriteRestrictedSql } from './restricted-sql';

const MARKER_SOURCE = 'sisyphus_canary';
/** Only produced if the hidden `upper(...)` subquery actually executes. */
export const CANARY_MARKER = MARKER_SOURCE.toUpperCase();

/** Re-run the self-test after this long (a kernel can be upgraded under a long-lived server). */
export const CANARY_TTL_MS = 30 * 60 * 1000;

const HIDDEN = `"a\` , (SELECT upper('${MARKER_SOURCE}')) , \`b"`;

/**
 * Probes cover both guard placements of the rewriter: a plain SELECT (guard
 * prepended as a new WITH) and a statement with its own WITH (guard merged).
 * Each must return exactly one row with one column whose value is 1.
 */
export const CANARY_PROBES: readonly string[] = [
    `SELECT 1 AS ${HIDDEN}`,
    `WITH sisyphus_probe AS (SELECT 1 AS v) SELECT v AS ${HIDDEN} FROM sisyphus_probe`,
];

export interface CanaryOutcome {
    ok: boolean;
    /** Set when ok is false. */
    reason?: 'guard_bypassed' | 'unexpected_result';
    detail?: string;
}

interface CacheEntry {
    outcome: CanaryOutcome;
    checkedAt: number;
}

const CACHE = new WeakMap<SiYuanClient, CacheEntry>();
const PENDING = new WeakMap<SiYuanClient, Promise<CanaryOutcome>>();

export class RestrictedSqlCanaryError extends Error {
    constructor(message: string, readonly reason: string) {
        super(message);
        this.name = 'RestrictedSqlCanaryError';
    }
}

function evaluateProbeRows(rows: unknown[]): CanaryOutcome {
    if (JSON.stringify(rows).includes(CANARY_MARKER)) {
        return { ok: false, reason: 'guard_bypassed', detail: 'the kernel executed a subquery hidden inside a quoted identifier' };
    }
    const row = rows.length === 1 && rows[0] && typeof rows[0] === 'object' ? rows[0] as Record<string, unknown> : undefined;
    const values = row ? Object.values(row) : [];
    if (!row || values.length !== 1 || Number(values[0]) !== 1) {
        return { ok: false, reason: 'unexpected_result', detail: `probe returned ${JSON.stringify(rows).slice(0, 200)}` };
    }
    return { ok: true };
}

async function runCanary(client: SiYuanClient): Promise<CanaryOutcome> {
    for (const probe of CANARY_PROBES) {
        // Built through the real rewriter so the probe carries exactly the guard
        // that user queries get. No table is referenced, so nothing is read.
        const { sql } = rewriteRestrictedSql(probe, { readableNotebookIds: [] });
        const outcome = evaluateProbeRows(await searchApi.querySQL(client, sql));
        if (!outcome.ok) return outcome;
    }
    return { ok: true };
}

/**
 * Resolve whether restricted SQL is safe on this client's kernel. Definitive
 * outcomes are cached per client for CANARY_TTL_MS; transport/kernel errors
 * are not cached (the caller fails closed for that call only).
 */
export async function checkRestrictedSqlCanary(client: SiYuanClient, now = Date.now()): Promise<CanaryOutcome> {
    const cached = CACHE.get(client);
    if (cached && now - cached.checkedAt < CANARY_TTL_MS) return cached.outcome;

    let pending = PENDING.get(client);
    if (!pending) {
        pending = runCanary(client)
            .then((outcome) => {
                CACHE.set(client, { outcome, checkedAt: now });
                return outcome;
            })
            .finally(() => PENDING.delete(client));
        PENDING.set(client, pending);
    }
    return pending;
}

/** Throws RestrictedSqlCanaryError unless the kernel provably runs guarded SQL verbatim. */
export async function assertRestrictedSqlCanary(client: SiYuanClient): Promise<void> {
    let outcome: CanaryOutcome;
    try {
        outcome = await checkRestrictedSqlCanary(client);
    } catch (error) {
        throw new RestrictedSqlCanaryError(
            `Restricted SQL self-test could not run (${error instanceof Error ? error.message : String(error)}); refusing raw SQL while some notebooks are unreadable.`,
            'canary_error',
        );
    }
    if (!outcome.ok) {
        throw new RestrictedSqlCanaryError(
            `Restricted SQL self-test failed on this SiYuan kernel (${outcome.reason}: ${outcome.detail}); notebook scoping cannot be guaranteed, so raw SQL is refused while some notebooks are unreadable.`,
            outcome.reason ?? 'unexpected_result',
        );
    }
}

export function resetRestrictedSqlCanaryForTests(client?: SiYuanClient): void {
    if (client) {
        CACHE.delete(client);
        PENDING.delete(client);
    }
}
