/*
 * Canonical AV cell projection for query results: every cell is
 * { type, value, formatted } whatever the column type or how it was written.
 *
 *   type       column type (text, block, number, date, select, mSelect, ...)
 *   value      normalized scalar or array:
 *                block/text/url/email/phone/template → string
 *                number → number | null (unset)
 *                date/created/updated → epoch ms | { start, end } | null
 *                checkbox → boolean
 *                select/mSelect → string[] (option names)
 *                relation → string[] (related row IDs)
 *                mAsset → string[] (asset paths/URLs)
 *                rollup → array of the rolled-up values
 *   formatted  readable text: the kernel formattedContent when present,
 *              otherwise derived from value ('' when empty). Dates without
 *              kernel formatting stay '' (MCP does not guess a timezone).
 *
 * Kernel row metadata (created/updated timestamps inside the primary key
 * object) is not part of the cell.
 */

export type AvCellValue = string | number | boolean | null | string[] | unknown[] | { start: number; end: number };

export interface AvCanonicalCell {
    type: string;
    value: AvCellValue;
    formatted: string;
}

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;
}

/** Sub-object keys the kernel uses for each value type, in detection order. */
const TYPE_KEYS = ['block', 'text', 'number', 'date', 'created', 'updated', 'url', 'email', 'phone', 'template', 'checkbox', 'mSelect', 'relation', 'rollup', 'mAsset'] as const;

function inferType(source: Rec): string {
    if (typeof source.type === 'string' && source.type) return source.type;
    for (const key of TYPE_KEYS) if (source[key] !== undefined && source[key] !== null) return key;
    return 'unknown';
}

function contentString(sub: unknown): string {
    const record = rec(sub);
    if (!record) return typeof sub === 'string' ? sub : '';
    const content = record.content;
    return typeof content === 'string' ? content : content === undefined || content === null ? '' : String(content);
}

function optionNames(list: unknown): string[] {
    return Array.isArray(list)
        ? list.flatMap((item) => {
            const name = rec(item)?.content;
            return typeof name === 'string' && name ? [name] : [];
        })
        : [];
}

function dateValue(sub: unknown): AvCellValue {
    const date = rec(sub);
    if (!date || date.isNotEmpty === false) return null;
    const start = typeof date.content === 'number' ? date.content : null;
    if (start === null) return null;
    if (date.hasEndDate === true && typeof date.content2 === 'number' && date.isNotEmpty2 !== false) {
        return { start, end: date.content2 };
    }
    return start;
}

function valueFor(type: string, source: Rec): AvCellValue {
    switch (type) {
        case 'block':
            // block.content is what SiYuan displays for the primary key; a
            // stray text sub-object (older set_cells writes) never wins.
            return source.block !== undefined ? contentString(source.block) : contentString(source.text);
        case 'text': case 'url': case 'email': case 'phone': case 'template':
            return contentString(source[type]);
        case 'number': {
            const number = rec(source.number);
            if (!number || number.isNotEmpty === false) return null;
            return typeof number.content === 'number' ? number.content : null;
        }
        case 'date': case 'created': case 'updated':
            return dateValue(source[type]);
        case 'checkbox':
            return rec(source.checkbox)?.checked === true;
        case 'select': case 'mSelect':
            return optionNames(source.mSelect);
        case 'relation': {
            const ids = rec(source.relation)?.blockIDs;
            return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
        }
        case 'mAsset':
            return Array.isArray(source.mAsset)
                ? source.mAsset.flatMap((asset) => {
                    const content = rec(asset)?.content;
                    return typeof content === 'string' && content ? [content] : [];
                })
                : [];
        case 'rollup': {
            const contents = rec(source.rollup)?.contents;
            return Array.isArray(contents)
                ? contents.map((item) => {
                    const inner = rec(item);
                    return inner ? valueFor(inferType(inner), inner) : item;
                })
                : [];
        }
        default:
            return null;
    }
}

function kernelFormatted(record: Rec | undefined): string | undefined {
    if (!record) return undefined;
    if (typeof record.formattedContent === 'string' && record.formattedContent) return record.formattedContent;
    for (const key of ['date', 'created', 'updated', 'number', 'text', 'url', 'email', 'phone', 'checkbox']) {
        const formatted = rec(record[key])?.formattedContent;
        if (typeof formatted === 'string' && formatted) return formatted;
    }
    return undefined;
}

function relationLabels(source: Rec): string[] {
    const contents = rec(source.relation)?.contents;
    return Array.isArray(contents)
        ? contents.flatMap((item) => {
            const inner = rec(item);
            const text = inner ? valueFor(inferType(inner), inner) : item;
            return typeof text === 'string' && text ? [text] : [];
        })
        : [];
}

function deriveFormatted(type: string, value: AvCellValue, source: Rec): string {
    if (value === null || value === undefined) return '';
    if (type === 'date' || type === 'created' || type === 'updated') return '';
    if (type === 'relation') {
        const labels = relationLabels(source);
        return (labels.length > 0 ? labels : value as string[]).join(', ');
    }
    if (type === 'mAsset' && Array.isArray(source.mAsset)) {
        return source.mAsset.flatMap((asset) => {
            const item = rec(asset);
            const label = typeof item?.name === 'string' && item.name ? item.name : item?.content;
            return typeof label === 'string' && label ? [label] : [];
        }).join(', ');
    }
    if (Array.isArray(value)) {
        return value.map((item) => (item === null || typeof item === 'object' ? '' : String(item))).filter(Boolean).join(', ');
    }
    if (typeof value === 'object') return '';
    return String(value);
}

/**
 * Normalize one rendered kernel cell ({ id, value: {...}, valueType }) or a
 * bare kernel Value object. `columnType` (from the view's columns) wins over
 * what the cell itself reports.
 */
export function toCanonicalAvCell(cell: unknown, columnType?: string): AvCanonicalCell {
    const wrapper = rec(cell);
    if (!wrapper) {
        const scalar = cell === undefined ? null : cell as AvCellValue;
        return { type: columnType ?? 'unknown', value: scalar, formatted: scalar === null ? '' : String(scalar) };
    }
    const inner = rec(wrapper.value);
    const source = inner ?? wrapper;
    const type = columnType
        ?? (typeof wrapper.valueType === 'string' && wrapper.valueType ? wrapper.valueType : undefined)
        ?? inferType(source);
    const value = valueFor(type, source);
    const formatted = kernelFormatted(inner) ?? kernelFormatted(wrapper) ?? deriveFormatted(type, value, source);
    return { type, value, formatted };
}
