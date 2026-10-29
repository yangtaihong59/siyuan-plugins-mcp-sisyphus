import type { SiYuanClient } from '../api/client';
import { isAmbiguousWriteFailure } from '../api/errors';

/*
 * Counts the write requests a strict commit's handler sends, so a failed
 * commit can be classified honestly: when SiYuan explicitly rejected the
 * request (an API error code or a 4xx status) and no other write was sent
 * or may have landed, nothing was applied. Anything else stays unknown.
 */

const WRITE_MEMBERS = new Set<keyof SiYuanClient>(['requestWrite', 'requestFormDataWrite', 'writeFile', 'uploadAssetBytes']);

export interface WriteDispatchStats {
    /** Writes SiYuan acknowledged. */
    completed: number;
    /** Writes SiYuan explicitly rejected (proven not applied). */
    rejected: number;
    /** Writes whose outcome cannot be known (transport loss, timeout, 5xx, unexpected errors). */
    ambiguous: number;
}

export function trackWriteDispatch(client: SiYuanClient): { client: SiYuanClient; stats: WriteDispatchStats } {
    const stats: WriteDispatchStats = { completed: 0, rejected: 0, ambiguous: 0 };
    const tracked = new Proxy(client, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            if (!WRITE_MEMBERS.has(prop as keyof SiYuanClient)) return value.bind(target);
            return async (...args: unknown[]) => {
                try {
                    const result = await value.apply(target, args);
                    stats.completed += 1;
                    return result;
                } catch (error) {
                    if (isAmbiguousWriteFailure(error)) stats.ambiguous += 1;
                    else stats.rejected += 1;
                    throw error;
                }
            };
        },
    });
    return { client: tracked, stats };
}

/** SiYuan answered the only write(s) with an explicit rejection: the commit applied nothing. */
export function provesNothingApplied(stats: WriteDispatchStats): boolean {
    return stats.rejected > 0 && stats.completed === 0 && stats.ambiguous === 0;
}
