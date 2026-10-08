import type { ReadInfo } from '../internal/read-guidance';

export function databaseContext(avID: string, sources: { blockID?: string; viewID?: string; columns?: string; rows?: string }) {
    return {
        avID, ...sources,
        idUsage: {
            avID: 'Database ID.',
            blockID: 'Database carrier, not a row source block. Omitted when no exact carrier was supplied.',
            viewID: 'Selected view inside this database.',
            rowID: 'AV row ID from resolvedRows; never substitute sourceBlockID or a cell value ID.',
            columnID: 'Column key.id; set_cells uses columnID, column operations use keyID.',
        },
    };
}

/** Preserve group-specific offsets. Finished groups advance to an empty page instead of repeating rows. */
export function viewReadState(view: Record<string, any> | undefined, args: Record<string, any>, pageSize: number) {
    const page = args.page ?? 1;
    const groups: Record<string, any>[] | undefined = Array.isArray(view?.groups) && view.groups.length ? view.groups : undefined;
    const sources = groups ?? (view ? [view] : []);
    let unknown = sources.length === 0;
    let partial = page > 1;
    let hasNext = false;
    const groupPaging: Record<string, unknown> = { ...args.groupPaging };
    for (const source of sources) {
        const override = groups ? args.groupPaging?.[source.id] : undefined;
        const currentPage = override?.page ?? page;
        const requestedSize = override?.pageSize ?? args.pageSize;
        const size = requestedSize > 0 ? requestedSize : source.pageSize > 0 ? source.pageSize : pageSize;
        const total = source.rowCount ?? source.cardCount;
        const known = typeof total === 'number' && Number.isFinite(total) && total >= 0;
        if (!known || (groups && typeof source.id !== 'string')) unknown = true;
        const more = known && currentPage * size < total;
        hasNext ||= more;
        partial ||= currentPage > 1 || more;
        if (groups && typeof source.id === 'string') {
            groupPaging[source.id] = { ...override, page: currentPage + 1, pageSize: size };
        }
    }
    const readInfo: ReadInfo = {
        scope: 'view_query', representation: 'view',
        coverage: unknown ? 'unknown' : partial ? 'partial' : 'complete',
        limitations: ['view_filters_and_hidden_columns', ...(partial ? ['pagination'] : []), ...(unknown ? ['unknown_total'] : [])],
    };
    return { readInfo, hasNextPage: hasNext, next: hasNext && !unknown
        ? { ...args, action: 'render', createIfNotExist: false, page: page + 1, ...(groups ? { groupPaging } : { pageSize }) }
        : undefined };
}
