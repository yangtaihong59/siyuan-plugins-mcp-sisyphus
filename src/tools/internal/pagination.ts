import type { PaginationResult, TruncationMeta } from './types';

export function applyTruncation<T>(
    items: T[],
    limit: number,
    hint: string,
): { items: T[]; meta?: TruncationMeta } {
    if (items.length <= limit) return { items };
    return {
        items: items.slice(0, limit),
        meta: {
            truncated: true,
            showing: limit,
            total: items.length,
            hint,
        },
    };
}

export function computePageCount(total: number, pageSize: number): number {
    return Math.max(1, Math.ceil(total / pageSize));
}

export function paginate<T>(items: T[], page: number, pageSize: number): PaginationResult<T> {
    const total = items.length;
    const pageCount = computePageCount(total, pageSize);
    const normalizedPage = Math.min(page, pageCount);
    const start = (normalizedPage - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);
    return {
        items: paged,
        total,
        page: normalizedPage,
        pageSize,
        pageCount,
        showing: paged.length,
        truncated: pageCount > 1,
        hasNextPage: normalizedPage < pageCount,
    };
}
