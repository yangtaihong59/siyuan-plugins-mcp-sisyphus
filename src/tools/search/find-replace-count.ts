import * as blockApi from '../../api/block';
import type { SiYuanClient } from '../../api/client';

/*
 * Shared by search.find_replace (before/after counts) and the write-impact
 * preview (match count before the commit). Kept free of schema imports.
 */

/** Kramdown inline attribute lists, including quoted values that contain `}`. */
const KRAMDOWN_IAL = /\{:(?:\s(?:[^}"]|"(?:[^"\\]|\\.)*")*)?\}/g;

export function stripKramdownIals(kramdown: string): string {
    return kramdown.replace(KRAMDOWN_IAL, '');
}

/**
 * The kernel's findReplace returns nothing about what it changed. Count the
 * search text in the caller's scope (IALs stripped) before and after, so a
 * caller sees whether anything was replaced. Only literal (0) and regex (3)
 * searches can be counted, and only when the replacement cannot re-match.
 */
export function findReplacePattern(k: string, method: number | undefined): RegExp | undefined {
    if (k === '') return undefined;
    try {
        if (method === 3) return new RegExp(k, 'g');
        if (method === undefined || method === 0) return new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    } catch {
        // An invalid regex is the kernel's to report.
    }
    return undefined;
}

/** Raw kramdown of each distinct id, in input order; unreadable ids map to ''. */
export async function readFindReplaceKramdowns(client: SiYuanClient, ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of [...new Set(ids)]) {
        const result = await blockApi.getBlockKramdown(client, id).catch(() => undefined);
        out.set(id, typeof result?.kramdown === 'string' ? result.kramdown : '');
    }
    return out;
}

export async function countFindReplaceMatches(
    client: SiYuanClient,
    ids: string[],
    k: string,
    method: number | undefined,
): Promise<number | undefined> {
    const pattern = findReplacePattern(k, method);
    if (!pattern) return undefined;
    let total = 0;
    for (const kramdown of (await readFindReplaceKramdowns(client, ids)).values()) {
        total += stripKramdownIals(kramdown).match(pattern)?.length ?? 0;
    }
    return total;
}
