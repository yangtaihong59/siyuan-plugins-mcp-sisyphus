import type { TransactionOperation } from '../../api/transaction';
import { AvUpdateViewSchema } from '../../core/types';

export function viewFields(view: any): Array<Record<string, any>> {
    const fields = view.type === 'table' ? view.table?.columns : view.type === 'gallery' ? view.gallery?.fields : view.type === 'kanban' ? view.kanban?.fields : undefined;
    if (!Array.isArray(fields) || fields.some(field => !field || typeof field.id !== 'string')) throw new Error(`Unsupported or malformed view layout: ${String(view.type)}`);
    return fields;
}

export function normalizeAvFilters(value: unknown): unknown[] {
    const source = Array.isArray(value) ? value : [];
    const node = (input: any): any => {
        if (!input || typeof input !== 'object') return input;
        const output = { ...input, column: input.column ?? '', operator: input.operator ?? '', value: input.value ?? null };
        if (input.filters?.length) output.filters = input.filters.map(node);
        else delete output.filters;
        return output;
    };
    return source.length === 1 && (source[0]?.combination || Array.isArray(source[0]?.filters))
        ? [node(source[0])] : [node({ combination: 'and', filters: source })];
}

export function normalizeAvGroup(value: any): any {
    if (!value?.field) return undefined;
    return { field: value.field, method: value.method ?? 0, order: value.order ?? 0, hideEmpty: value.hideEmpty === true,
        ...(value.range ? { range: { numStart: value.range.numStart, numEnd: value.range.numEnd, numStep: value.range.numStep } } : {}) };
}

export function expectedAvGroup(group: any, before: any, definition: any): any {
    const expected = normalizeAvGroup(group);
    if (expected && before?.field !== expected.field) {
        const type = definition.keyValues?.find((entry: any) => entry.key?.id === expected.field)?.key?.type;
        if (type === 'select' || type === 'mSelect') expected.order = 3;
        if (type === 'checkbox') expected.order = 2;
    }
    return expected;
}

/** Validate the whole request before producing any operations (also used by preflight). */
export function prepareViewUpdate(definition: any, raw: Record<string, unknown>) {
    const args = AvUpdateViewSchema.parse(raw);
    const views = definition.views?.filter((view: any) => view.id === args.viewID);
    if (views?.length !== 1) throw new Error('Requested view must resolve exactly once');
    const view = views[0];
    const fields = viewFields(view);
    const keys = new Set((definition.keyValues ?? []).map((entry: any) => entry.key?.id));
    const checkKey = (id: string) => { if (!keys.has(id)) throw new Error(`Unknown AV column: ${id}`); };
    const visit = (filter: any) => { if (filter.combination || filter.filters) (filter.filters ?? []).forEach(visit); else checkKey(filter.column); };
    args.filters?.forEach(visit);
    args.sorts?.forEach(sort => checkKey(sort.column));
    if (args.group?.field) checkKey(args.group.field);
    for (const item of args.columnVisibility ?? []) if (!fields.some(field => field.id === item.columnID)) throw new Error(`Column ${item.columnID} is not in the current view`);
    if (args.columnOrder && (fields.length !== args.columnOrder.length || fields.some(field => !args.columnOrder.includes(field.id)))) throw new Error('columnOrder must contain every current view field, including hidden fields');
    const base = { avID: args.avID, blockID: args.blockID };
    const operations: TransactionOperation[] = [];
    if (args.filters !== undefined) operations.push({ ...base, action: 'setAttrViewFilters', data: args.filters });
    if (args.sorts !== undefined) operations.push({ ...base, action: 'setAttrViewSorts', data: args.sorts });
    if (args.group !== undefined) operations.push({ ...base, action: 'setAttrViewGroup', data: args.group });
    for (const item of args.columnVisibility ?? []) operations.push({ ...base, action: 'setAttrViewColHidden', id: item.columnID, data: item.hidden });
    args.columnOrder?.forEach((id, index) => operations.push({ ...base, action: 'sortAttrViewCol', id, previousID: index ? args.columnOrder[index - 1] : '' }));
    return { args, view, operations };
}
