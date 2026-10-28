/* AV definition shapes and pure readers: keys, cell values, relation ids. */
import type { AvAction } from '../../core/config';
import { type ToolResult } from '../internal/shared';
import { asRecord } from '../../shared/record';
export { asRecord };

export const AV_TOOL_NAME = 'av';

export type StrongCellValueInput = {
    valueType: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multi_select' | 'relation' | 'url' | 'email' | 'phone' | 'mAsset';
    text?: string;
    number?: number;
    numberFormat?: string;
    date?: string | number;
    endDate?: string | number;
    includeTime?: boolean;
    checked?: boolean;
    option?: string;
    options?: string[];
    relationBlockIDs?: string[];
    url?: string;
    email?: string;
    phone?: string;
    assets?: Array<{ type: 'image' | 'file'; content: string; name?: string }>;
};

export interface AvQueryColumn {
    columnID: string;
    name?: string;
    type?: string;
}

export interface AvQueryCell {
    value: unknown;
    formatted?: string;
}

export interface AvQueryRow {
    rowID?: string;
    groupID?: string;
    cells: Record<string, AvQueryCell>;
}

export interface AvViewItems {
    items: unknown[];
    total: number;
    groupIDs: Array<string | undefined>;
    groups: Array<{ groupID: string; name?: string; rowCount?: number }>;
}

export const AV_MATERIALIZATION_POLL_ATTEMPTS = 6;

export const AV_MATERIALIZATION_POLL_DELAY_MS = 300;

export const ATTRIBUTE_VIEW_DIR = '/data/storage/av';

export const ATTRIBUTE_VIEW_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

export type AvKeyDefinition = Record<string, unknown>;

type AvKeyEntryDefinition = { key: AvKeyDefinition; values?: unknown };

export type AvKeyValueDefinition = { key: AvKeyDefinition; values: Array<Record<string, unknown>> };

export type AttributeViewDefinition = Record<string, unknown> & { keyValues?: unknown[]; newItemTemplates?: unknown[] };

export type RelationMetadata = Record<string, unknown> & { avID?: string; backKeyID?: string; isTwoWay?: boolean };

/**
 * Persistence-sensitive actions use only raw getAttributeView. Rendering can
 * materialize or normalize an AV, so using it for template/relation/rollup
 * readback would turn an observation into an undocumented side effect.
 */
export function asAttributeViewDefinition(value: unknown, avID: string): AttributeViewDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Attribute view "${avID}" returned no raw definition.`);
    }
    const definition = value as AttributeViewDefinition;
    if (definition.id !== avID || !Array.isArray(definition.keyValues)) {
        throw new Error(`Attribute view "${avID}" returned an incomplete or mismatched raw definition.`);
    }
    return definition;
}

export function getAvKeyEntry(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyEntryDefinition {
    const matches = (definition.keyValues ?? []).filter((entry): entry is AvKeyEntryDefinition => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const value = entry as { key?: unknown; values?: unknown };
        return Boolean(value.key && typeof value.key === 'object' && !Array.isArray(value.key)
            && (value.key as Record<string, unknown>).id === keyID);
    });
    if (matches.length !== 1) throw new Error(`${context}: keyID "${keyID}" did not resolve exactly once.`);
    return matches[0];
}

export function getAvKeyValue(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyValueDefinition {
    const entry = getAvKeyEntry(definition, keyID, context);
    // SiYuan encodes a newly added key with no cells as { key: ... }, because
    // KeyValues.Values has omitempty. Key metadata remains valid for template
    // validation, but row/cell readers must still reject the absent value list.
    if (!Array.isArray(entry.values)) throw new Error(`${context}: keyID "${keyID}" has no value list.`);
    return { key: entry.key, values: entry.values as Array<Record<string, unknown>> };
}

export function getAvKey(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyDefinition {
    return getAvKeyEntry(definition, keyID, context).key;
}

export function normalizeIdSet(ids: string[]): string[] {
    return [...new Set(ids)].sort();
}

export function sameIdSet(left: string[], right: string[]): boolean {
    const normalizedLeft = normalizeIdSet(left);
    const normalizedRight = normalizeIdSet(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function createAvValidationErrorResult(action: AvAction, payload: Record<string, unknown>): ToolResult {
    return { content: [{ type: 'text', text: JSON.stringify({ error: { type: 'validation_error', tool: AV_TOOL_NAME, action, ...payload } }, null, 2) }], isError: true };
}

export function extractFirstRowBlockId(avData: unknown): string | undefined {
    if (!avData || typeof avData !== 'object') return undefined;
    const keyValues = (avData as { keyValues?: unknown }).keyValues;
    if (!Array.isArray(keyValues)) return undefined;

    for (const entry of keyValues) {
        if (!entry || typeof entry !== 'object') continue;
        const typedEntry = entry as {
            key?: { type?: string };
            values?: Array<{ block?: { id?: string } }>;
        };
        if (typedEntry.key?.type !== 'block' || !Array.isArray(typedEntry.values)) continue;
        const blockValue = typedEntry.values.find((value) => typeof value?.block?.id === 'string' && value.block.id.length > 0);
        if (blockValue?.block?.id) return blockValue.block.id;
    }
    return undefined;
}

export function extractAttributeViewKeysFromData(avData: unknown): unknown[] {
    if (!avData || typeof avData !== 'object') return [];
    const keyValues = (avData as { keyValues?: unknown }).keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues
        .map((entry) => (entry && typeof entry === 'object' ? (entry as { key?: unknown }).key : undefined))
        .filter((key): key is Record<string, unknown> => Boolean(key && typeof key === 'object'));
}

export function getStringField(value: unknown, fieldNames: string[]): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const fieldName of fieldNames) {
        const fieldValue = record[fieldName];
        if (typeof fieldValue === 'string' && fieldValue.length > 0) {
            return fieldValue;
        }
    }
    return undefined;
}

export function getNestedStringField(value: unknown, path: string[]): string | undefined {
    let current = value;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === 'string' && current.length > 0 ? current : undefined;
}

export function extractKeyValueEntries(avData: unknown): Array<{ key: Record<string, unknown>; values: Array<Record<string, unknown>> }> {
    const keyValues = asRecord(avData)?.keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues.flatMap((entry) => {
        const record = asRecord(entry);
        const key = asRecord(record?.key);
        const values = Array.isArray(record?.values)
            ? record.values.flatMap((value) => asRecord(value) ? [value] : [])
            : [];
        return key ? [{ key, values }] : [];
    });
}

export function relationBlockIDs(value: Record<string, unknown> | undefined): string[] {
    const relation = asRecord(value?.relation);
    return Array.isArray(relation?.blockIDs)
        ? relation.blockIDs.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
}

function parseDateMillis(value: string | number, fieldName: string): number {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`${fieldName} must be a finite epoch millisecond value.`);
        return value;
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        throw new Error(`${fieldName} must be a valid ISO date string or epoch milliseconds.`);
    }
    return parsed;
}

export function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

export function buildStrongCellValue(
    columnID: string,
    rowID: string,
    input: StrongCellValueInput,
): Record<string, unknown> {
    const base: Record<string, unknown> = {
        keyID: columnID,
        blockID: rowID,
    };

    switch (input.valueType) {
        case 'text':
            return { ...base, type: 'text', text: { content: input.text } };
        case 'number':
            return {
                ...base,
                type: 'number',
                number: {
                    content: input.number,
                    isNotEmpty: true,
                    format: input.numberFormat ?? '',
                    formattedContent: '',
                },
            };
        case 'date': {
            const content = parseDateMillis(input.date!, 'date');
            const content2 = input.endDate === undefined ? 0 : parseDateMillis(input.endDate, 'endDate');
            return {
                ...base,
                type: 'date',
                date: {
                    content,
                    isNotEmpty: true,
                    hasEndDate: input.endDate !== undefined,
                    isNotTime: input.includeTime === false,
                    content2,
                    isNotEmpty2: input.endDate !== undefined,
                    formattedContent: '',
                },
            };
        }
        case 'checkbox':
            return { ...base, type: 'checkbox', checkbox: { checked: Boolean(input.checked) } };
        case 'select':
            return { ...base, type: 'select', mSelect: [{ content: input.option, color: '' }] };
        case 'multi_select':
            return { ...base, type: 'mSelect', mSelect: (input.options ?? []).map((option) => ({ content: option, color: '' })) };
        case 'relation':
            return { ...base, type: 'relation', relation: { blockIDs: input.relationBlockIDs ?? [], contents: [] } };
        case 'url':
            return { ...base, type: 'url', url: { content: input.url } };
        case 'email':
            return { ...base, type: 'email', email: { content: input.email } };
        case 'phone':
            return { ...base, type: 'phone', phone: { content: input.phone } };
        case 'mAsset': {
            const assets = (input.assets ?? []).map((asset) => ({
                type: asset.type,
                name: asset.name ?? '',
                content: asset.content,
            }));
            const markdown = input.text
                ?? assets.map((asset) => asset.type === 'image'
                    ? `![](${asset.content})`
                    : `[${asset.name || asset.content}](${asset.content})`).join('\n');
            return {
                ...base,
                type: 'mAsset',
                text: { content: markdown },
                mAsset: assets,
            };
        }
        default:
            throw new Error(`Unsupported AV valueType: ${(input as { valueType: string }).valueType}`);
    }
}

export function getAvKeyById(avData: unknown, keyID: string): Record<string, unknown> | undefined {
    return extractAttributeViewKeysFromData(avData)
        .find((key): key is Record<string, unknown> => getStringField(key, ['id']) === keyID);
}

export function createAvFieldValidationResult(
    action: 'set_column_options' | 'rename',
    avID: string,
    keyID: string,
    message: string,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: AV_TOOL_NAME,
                    action,
                    avID,
                    keyID,
                    message,
                },
            }, null, 2),
        }],
        isError: true,
    };
}
