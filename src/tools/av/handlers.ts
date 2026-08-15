import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import * as blockApi from '../../api/block';
import * as documentApi from '../../api/document';
import * as searchApi from '../../api/search';
import * as systemApi from '../../api/system';
import * as transactionApi from '../../api/transaction';
import type { TransactionOperation } from '../../api/transaction';
import type { AvAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import { canonicalizeState, hashCanonicalState } from '../../shared/canonical-state';
import {
    AvAddColumnSchema,
    AvAddViewSchema,
    AvAddRowsSchema,
    AvConfigureRollupSchema,
    AvConfigureTwoWayRelationSchema,
    AvCreateFromTemplateSchema,
    AvDuplicateSchema,
    AvDuplicateRowsSchema,
    AvGetAttributeViewFilterSortSchema,
    AvGetAttributeViewKeysSchema,
    AvGetPrimaryKeyValuesSchema,
    AvGetSchema,
    AvRenderSchema,
    AvRemoveColumnSchema,
    AvRemoveRowsSchema,
    AvSearchSchema,
    AvSetColumnOptionsSchema,
    AvSetCellsSchema,
    AvSetColumnOrderSchema,
    AvSetColumnVisibilitySchema,
    AvSetFiltersSchema,
    AvSetGroupSchema,
    AvSetSortsSchema,
    AvSetNewItemTemplatesSchema,
    AvSetRelationSchema,
} from '../../core/types';
import { createResultResolutionCache, ensurePermissionForDocumentId, ensurePermissionForNotebook, escapeSqlString, resolveDocumentContextById, resolveResultItemContext } from '../internal/context';
import { computePageCount } from '../internal/pagination';
import type { ToolActionHandler, ToolHandlerContext } from '../internal/define-tool';
import { isMissingBlockError, translateError } from '../internal/errorTranslation';
import { createJsonResult, createPaginatedResult, createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { applyUiRefresh, type UiRefreshOperation } from '../internal/ui-refresh';
import { sleep } from '../../shared/async';

const AV_TOOL_NAME = 'av';

function generateSiYuanNodeId(now = new Date()): string {
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    const timestamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('');
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let index = 0; index < 7; index += 1) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${timestamp}-${suffix}`;
}

type AvContextResolution = {
    avData: unknown;
    blockID?: string;
};

type AvRowBinding = {
    rowID?: string;
    sourceBlockID?: string;
    isDetached?: boolean;
    valueIDs: string[];
};

type AvRowLookup = {
    rows: AvRowBinding[];
    rowIDs: Set<string>;
    sourceBlockToRowIDs: Map<string, string[]>;
    valueIdToRowIDs: Map<string, string[]>;
};

type DuplicateRowsRelationDestination = {
    avID: string;
    backKeyID: string;
    destinationRowIDs: string[];
    carrierBlockID: string;
    preimage: unknown;
};

type AddRowsResolution = {
    rows: Array<{ blockID?: string; primaryKeyText?: string; rowID?: string; rowIDs?: string[]; status?: 'resolved' | 'missing' | 'ambiguous' }>;
    unresolvedBlockIDs: string[];
    unresolvedRowIDs?: string[];
};

type StrongCellValueInput = {
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

interface AvTableView {
    columns: Array<{ id: string; name?: string; type?: string }>;
    rows: Array<{ id?: string; cells: Record<string, unknown> }>;
    rowCount: number;
}

const ADD_ROWS_POLL_ATTEMPTS = 6;
const ADD_ROWS_POLL_DELAY_MS = 500;
const AV_MATERIALIZATION_POLL_ATTEMPTS = 6;
const AV_MATERIALIZATION_POLL_DELAY_MS = 300;
const ATTRIBUTE_VIEW_DIR = '/data/storage/av';
const ATTRIBUTE_VIEW_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

type AvKeyDefinition = Record<string, unknown>;
type AvKeyEntryDefinition = { key: AvKeyDefinition; values?: unknown };
type AvKeyValueDefinition = { key: AvKeyDefinition; values: Array<Record<string, unknown>> };
type AttributeViewDefinition = Record<string, unknown> & { keyValues?: unknown[]; newItemTemplates?: unknown[] };
type RelationMetadata = Record<string, unknown> & { avID?: string; backKeyID?: string; isTwoWay?: boolean };

/**
 * Persistence-sensitive actions use only raw getAttributeView. Rendering can
 * materialize or normalize an AV, so using it for template/relation/rollup
 * readback would turn an observation into an undocumented side effect.
 */
function asAttributeViewDefinition(value: unknown, avID: string): AttributeViewDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Attribute view "${avID}" returned no raw definition.`);
    }
    const definition = value as AttributeViewDefinition;
    if (definition.id !== avID || !Array.isArray(definition.keyValues)) {
        throw new Error(`Attribute view "${avID}" returned an incomplete or mismatched raw definition.`);
    }
    return definition;
}

function getAvKeyEntry(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyEntryDefinition {
    const matches = (definition.keyValues ?? []).filter((entry): entry is AvKeyEntryDefinition => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const value = entry as { key?: unknown; values?: unknown };
        return Boolean(value.key && typeof value.key === 'object' && !Array.isArray(value.key)
            && (value.key as Record<string, unknown>).id === keyID);
    });
    if (matches.length !== 1) throw new Error(`${context}: keyID "${keyID}" did not resolve exactly once.`);
    return matches[0];
}

function getAvKeyValue(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyValueDefinition {
    const entry = getAvKeyEntry(definition, keyID, context);
    // SiYuan encodes a newly added key with no cells as { key: ... }, because
    // KeyValues.Values has omitempty. Key metadata remains valid for template
    // validation, but row/cell readers must still reject the absent value list.
    if (!Array.isArray(entry.values)) throw new Error(`${context}: keyID "${keyID}" has no value list.`);
    return { key: entry.key, values: entry.values as Array<Record<string, unknown>> };
}

function getAvKey(definition: AttributeViewDefinition, keyID: string, context: string): AvKeyDefinition {
    return getAvKeyEntry(definition, keyID, context).key;
}

function normalizeIdSet(ids: string[]): string[] {
    return [...new Set(ids)].sort();
}

function sameIdSet(left: string[], right: string[]): boolean {
    const normalizedLeft = normalizeIdSet(left);
    const normalizedRight = normalizeIdSet(right);
    return normalizedLeft.length === normalizedRight.length
        && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function extractRelationCellItemIDs(
    definition: AttributeViewDefinition,
    keyID: string,
    itemID: string,
    context: string,
): string[] {
    const entry = getAvKeyEntry(definition, keyID, context);
    if (entry.key.type !== 'relation') throw new Error(`${context}: keyID "${keyID}" is not a relation key.`);
    if (entry.values === undefined) {
        // KeyValues.Values is `omitempty` in SiYuan v3.8. A configured
        // relation with no cells is therefore serialized as only `{ key }`.
        // The native setAttributeViewBlockAttr endpoint creates the first cell
        // for an existing AV item; accepting this exact shape is necessary for
        // first writes, but never treats null/malformed lists or unknown rows
        // as empty relation state.
        if (!extractAvRowLookup(definition).rowIDs.has(itemID)) {
            throw new Error(`${context}: relation keyID "${keyID}" has no value list for unknown AV itemID "${itemID}".`);
        }
        return [];
    }
    if (!Array.isArray(entry.values)) throw new Error(`${context}: keyID "${keyID}" has no value list.`);
    const matches = (entry.values as Array<Record<string, unknown>>).filter((value) => value.blockID === itemID);
    if (matches.length > 1) throw new Error(`${context}: relation cell ${keyID}/${itemID} resolves more than once.`);
    if (matches.length === 0) return [];
    const relation = matches[0].relation;
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) {
        throw new Error(`${context}: relation cell ${keyID}/${itemID} has no relation payload.`);
    }
    const blockIDs = (relation as Record<string, unknown>).blockIDs;
    if (blockIDs === null || blockIDs === undefined) return [];
    if (!Array.isArray(blockIDs) || blockIDs.some((id) => typeof id !== 'string')) {
        throw new Error(`${context}: relation cell ${keyID}/${itemID} has an invalid blockIDs payload.`);
    }
    return blockIDs as string[];
}

function getTemplate(definition: AttributeViewDefinition, templateID: string, context: string): Record<string, unknown> {
    const templates = definition.newItemTemplates;
    if (!Array.isArray(templates)) throw new Error(`${context}: attribute view has no native new-item templates.`);
    const matches = templates.filter((template): template is Record<string, unknown> => Boolean(
        template && typeof template === 'object' && !Array.isArray(template)
            && (template as Record<string, unknown>).id === templateID,
    ));
    if (matches.length !== 1) throw new Error(`${context}: templateID "${templateID}" did not resolve exactly once.`);
    return matches[0];
}

function validateTemplateFieldValues(definition: AttributeViewDefinition, template: Record<string, unknown>, context: string): void {
    const fieldValues = template.fieldValues;
    if (fieldValues === undefined) return;
    if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) {
        throw new Error(`${context}: template fieldValues must be an object when present.`);
    }
    for (const [keyID, rawFieldValue] of Object.entries(fieldValues as Record<string, unknown>)) {
        const key = getAvKey(definition, keyID, context);
        if (!rawFieldValue || typeof rawFieldValue !== 'object' || Array.isArray(rawFieldValue)) {
            throw new Error(`${context}: template field ${keyID} has an invalid field value.`);
        }
        const fieldValue = rawFieldValue as Record<string, unknown>;
        const mode = fieldValue.mode === undefined ? 'static' : fieldValue.mode;
        if (mode === 'currentTime') {
            if (key.type !== 'date') throw new Error(`${context}: currentTime is only valid for date key "${keyID}".`);
            continue;
        }
        if (mode !== 'static' || !fieldValue.value || typeof fieldValue.value !== 'object' || Array.isArray(fieldValue.value)) {
            throw new Error(`${context}: template field ${keyID} has an invalid static value.`);
        }
        const typedValue = fieldValue.value as Record<string, unknown>;
        if (typedValue.type !== key.type) throw new Error(`${context}: template field ${keyID} has a mismatched value type.`);
        if (key.type === 'select' || key.type === 'mSelect') {
            const validNames = new Set((Array.isArray(key.options) ? key.options : []).flatMap((option) => (
                option && typeof option === 'object' && typeof (option as Record<string, unknown>).name === 'string'
                    ? [(option as Record<string, unknown>).name as string] : []
            )));
            const selections = Array.isArray(typedValue.mSelect) ? typedValue.mSelect : [];
            if (selections.length === 0 || (key.type === 'select' && selections.length !== 1)
                || selections.some((selection) => !selection || typeof selection !== 'object'
                    || typeof (selection as Record<string, unknown>).content !== 'string'
                    || !validNames.has((selection as Record<string, unknown>).content as string))) {
                // SiYuan can prune an absent option only in its creation clone,
                // returning success without a field warning. Refuse before the
                // write; silently adding options would broaden this action.
                throw new Error(`${context}: template ${keyID} contains an option absent from this AV key.`);
            }
        }
        if (key.type === 'relation') {
            const relation = typedValue.relation;
            if (!relation || typeof relation !== 'object' || Array.isArray(relation)
                || !Array.isArray((relation as Record<string, unknown>).blockIDs)) {
                throw new Error(`${context}: template relation field ${keyID} has no blockIDs array.`);
            }
        }
    }
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeTemplateValueForKernel(rawValue: Record<string, unknown>, key: AvKeyDefinition): Record<string, unknown> {
    const value = cloneJsonRecord(rawValue);
    for (const field of ['id', 'keyID', 'blockID', 'block', 'template', 'created', 'updated', 'rollup', 'isDetached', 'createdAt', 'updatedAt', 'isRenderAutoFill']) delete value[field];
    value.type = key.type;
    if (key.type === 'number' && value.number && typeof value.number === 'object' && !Array.isArray(value.number)) {
        const number = value.number as Record<string, unknown>;
        if (typeof key.numberFormat === 'string') number.format = key.numberFormat;
        delete number.formattedContent;
    }
    if (key.type === 'date' && value.date && typeof value.date === 'object' && !Array.isArray(value.date)) delete (value.date as Record<string, unknown>).formattedContent;
    if (key.type === 'relation' && value.relation && typeof value.relation === 'object' && !Array.isArray(value.relation)) delete (value.relation as Record<string, unknown>).contents;
    return value;
}

function normalizeTemplateForKernel(rawTemplate: Record<string, unknown>, definition: AttributeViewDefinition, context: string): Record<string, unknown> {
    const template = cloneJsonRecord(rawTemplate);
    template.name = typeof template.name === 'string' ? template.name.trim() : template.name;
    template.icon = typeof template.icon === 'string' ? template.icon.trim() : template.icon;
    template.contentTemplatePath = typeof template.contentTemplatePath === 'string' ? template.contentTemplatePath.trim() : template.contentTemplatePath;
    if (template.targetType !== 'document' || template.icon === '') delete template.icon;
    if (template.contentTemplatePath === '') delete template.contentTemplatePath;
    if (template.saveLocation && typeof template.saveLocation === 'object' && !Array.isArray(template.saveLocation)) {
        const location = template.saveLocation as Record<string, unknown>;
        if (typeof location.boxID === 'string') location.boxID = location.boxID.trim();
        if (typeof location.pathTemplate === 'string') location.pathTemplate = location.pathTemplate.trim();
        if (location.boxID === '') delete location.boxID;
    }
    if (template.fieldValues && typeof template.fieldValues === 'object' && !Array.isArray(template.fieldValues)) {
        const fieldValues = template.fieldValues as Record<string, unknown>;
        for (const [keyID, rawFieldValue] of Object.entries(fieldValues)) {
            if (!rawFieldValue || typeof rawFieldValue !== 'object' || Array.isArray(rawFieldValue)) continue;
            const fieldValue = rawFieldValue as Record<string, unknown>;
            const key = getAvKey(definition, keyID, context);
            if (fieldValue.mode === 'currentTime') delete fieldValue.value;
            else if (fieldValue.value && typeof fieldValue.value === 'object' && !Array.isArray(fieldValue.value)) fieldValue.value = normalizeTemplateValueForKernel(fieldValue.value as Record<string, unknown>, key);
        }
        // The kernel's empty map omits the field during serialization. This is
        // the only template-shape normalization accepted by strict readback.
        if (Object.keys(fieldValues).length === 0) delete template.fieldValues;
    }
    return template;
}

function templateConfigProjection(
    definition: AttributeViewDefinition,
    templates: unknown,
    defaultTemplateID: unknown,
    context: string,
): { templates: Record<string, unknown>[]; defaultTemplateID: string } {
    if (templates === undefined || templates === null) return { templates: [], defaultTemplateID: typeof defaultTemplateID === 'string' ? defaultTemplateID : '' };
    if (!Array.isArray(templates)) throw new Error(`${context}: newItemTemplates must be an array.`);
    return {
        templates: templates.map((template, index) => {
            if (!template || typeof template !== 'object' || Array.isArray(template)) throw new Error(`${context}: template at index ${index} is invalid.`);
            const copied = cloneJsonRecord(template as Record<string, unknown>);
            if (Array.isArray(copied.fieldValues) && copied.fieldValues.length === 0) delete copied.fieldValues;
            return normalizeTemplateForKernel(copied, definition, context);
        }),
        defaultTemplateID: typeof defaultTemplateID === 'string' ? defaultTemplateID : '',
    };
}

function validateCompleteTemplateConfiguration(definition: AttributeViewDefinition, templates: Record<string, unknown>[], defaultTemplateID: string, context: string): void {
    const ids = new Set<string>();
    for (const template of templates) {
        if (typeof template.id !== 'string' || !ATTRIBUTE_VIEW_ID_PATTERN.test(template.id)) throw new Error(`${context}: template has an invalid ID.`);
        if (ids.has(template.id)) throw new Error(`${context}: duplicate template ID "${template.id}".`);
        ids.add(template.id);
        if (typeof template.name !== 'string' || template.name.trim().length === 0 || (template.targetType !== 'detached' && template.targetType !== 'document')) throw new Error(`${context}: template "${template.id}" has invalid required fields.`);
        validateTemplateFieldValues(definition, template, context);
    }
    if (defaultTemplateID && !ids.has(defaultTemplateID)) throw new Error(`${context}: defaultTemplateID "${defaultTemplateID}" is absent from the complete template array.`);
}

function createAvValidationErrorResult(action: AvAction, payload: Record<string, unknown>): ToolResult {
    return { content: [{ type: 'text', text: JSON.stringify({ error: { type: 'validation_error', tool: AV_TOOL_NAME, action, ...payload } }, null, 2) }], isError: true };
}

async function requireWritableRelationDestinations(
    client: SiYuanClient,
    permMgr: PermissionManager,
    definition: AttributeViewDefinition,
    keyID: string,
    relatedItemIDs: string[],
    context: string,
): Promise<{ destinationAvID: string; backKeyID?: string; destination: AttributeViewDefinition }> {
    const key = getAvKey(definition, keyID, context);
    if (key.type !== 'relation' || !key.relation || typeof key.relation !== 'object' || Array.isArray(key.relation)) {
        throw new Error(`${context}: keyID "${keyID}" is not a configured relation key.`);
    }
    const relation = key.relation as Record<string, unknown>;
    const destinationAvID = relation.avID;
    if (typeof destinationAvID !== 'string' || !ATTRIBUTE_VIEW_ID_PATTERN.test(destinationAvID)) {
        throw new Error(`${context}: relation key "${keyID}" has no valid destination AV ID.`);
    }
    const destination = asAttributeViewDefinition((await avApi.getAttributeView(client, destinationAvID)).av, destinationAvID);
    const backKeyID = typeof relation.backKeyID === 'string' && relation.backKeyID ? relation.backKeyID : undefined;
    if (relation.isTwoWay === true) {
        if (!backKeyID) throw new Error(`${context}: two-way relation key "${keyID}" has no backKeyID.`);
        const backKey = getAvKey(destination, backKeyID, context);
        if (backKey.type !== 'relation' || !backKey.relation || typeof backKey.relation !== 'object'
            || (backKey.relation as Record<string, unknown>).avID !== definition.id) {
            throw new Error(`${context}: destination reverse relation metadata does not match the source AV.`);
        }
    }
    // A relation can mutate reverse cells. The destination's first bound row
    // is not proof of a carrier, so permission is established only through a
    // verified NodeAttributeView before this cross-AV write is dispatched.
    const destinationCarrier = await resolveVerifiedAvCarrier(client, destinationAvID, destination);
    if (!destinationCarrier) throw new Error(`${context}: destination AV "${destinationAvID}" has no verified database carrier.`);
    const { denied } = await ensurePermissionForDocumentId(client, permMgr, destinationCarrier, 'write');
    if (denied) throw new Error(`${context}: destination AV write permission was denied.`);
    const destinationLookup = extractAvRowLookup(destination);
    for (const itemID of relatedItemIDs) {
        if (!destinationLookup.rowIDs.has(itemID)) throw new Error(`${context}: relatedItemID "${itemID}" is not a canonical destination AV item ID.`);
    }
    return { destinationAvID, backKeyID, destination };
}

function extractFirstRowBlockId(avData: unknown): string | undefined {
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

function extractAttributeViewKeysFromData(avData: unknown): unknown[] {
    if (!avData || typeof avData !== 'object') return [];
    const keyValues = (avData as { keyValues?: unknown }).keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues
        .map((entry) => (entry && typeof entry === 'object' ? (entry as { key?: unknown }).key : undefined))
        .filter((key): key is Record<string, unknown> => Boolean(key && typeof key === 'object'));
}

function getStringField(value: unknown, fieldNames: string[]): string | undefined {
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

function getNestedStringField(value: unknown, path: string[]): string | undefined {
    let current = value;
    for (const segment of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === 'string' && current.length > 0 ? current : undefined;
}

function extractRowIdFromValue(value: unknown): string | undefined {
    return getStringField(value, ['blockID', 'itemId', 'itemID', 'rowID'])
        ?? getNestedStringField(value, ['block', 'blockID']);
}

function extractSourceBlockIdFromBlockValue(value: unknown): string | undefined {
    return getNestedStringField(value, ['block', 'id'])
        ?? getStringField(value, ['srcID', 'srcId']);
}

function extractValueIdFromValue(value: unknown): string | undefined {
    return getStringField(value, ['id']);
}

function extractAvRowLookup(avData: unknown): AvRowLookup {
    const rowsById = new Map<string, AvRowBinding>();
    const rowsInOrder: AvRowBinding[] = [];
    if (!avData || typeof avData !== 'object') {
        return { rows: [], rowIDs: new Set<string>(), sourceBlockToRowIDs: new Map<string, string[]>(), valueIdToRowIDs: new Map<string, string[]>() };
    }

    const keyValues = (avData as { keyValues?: unknown }).keyValues;
    if (!Array.isArray(keyValues)) {
        return { rows: [], rowIDs: new Set<string>(), sourceBlockToRowIDs: new Map<string, string[]>(), valueIdToRowIDs: new Map<string, string[]>() };
    }

    for (const entry of keyValues) {
        if (!entry || typeof entry !== 'object') continue;
        const typedEntry = entry as { key?: { type?: string }; values?: unknown };
        const values = typedEntry.values;
        if (!Array.isArray(values)) continue;

        values.forEach((value) => {
            const rowID = extractRowIdFromValue(value);
            if (!rowID) return;

            let row = rowsById.get(rowID);
            if (!row) {
                row = { rowID, valueIDs: [] };
                rowsById.set(rowID, row);
                rowsInOrder.push(row);
            }

            const valueID = extractValueIdFromValue(value);
            const sourceBlockID = typedEntry.key?.type === 'block' ? extractSourceBlockIdFromBlockValue(value) : undefined;
            const isDetached = typedEntry.key?.type === 'block' && (value as { isDetached?: unknown }).isDetached === true;
            if (sourceBlockID) row.sourceBlockID = sourceBlockID;
            if (isDetached) row.isDetached = true;
            if (valueID && !row.valueIDs.includes(valueID)) row.valueIDs.push(valueID);
        });
    }

    const rows = rowsInOrder.filter((row) => row.rowID || row.sourceBlockID || row.valueIDs.length > 0);
    const rowIDs = new Set<string>();
    const sourceBlockToRowIDs = new Map<string, string[]>();
    const valueIdToRowIDs = new Map<string, string[]>();

    for (const row of rows) {
        if (row.rowID) rowIDs.add(row.rowID);
        if (row.sourceBlockID && row.rowID) {
            const matches = sourceBlockToRowIDs.get(row.sourceBlockID) ?? [];
            if (!matches.includes(row.rowID)) {
                matches.push(row.rowID);
                sourceBlockToRowIDs.set(row.sourceBlockID, matches);
            }
        }
        if (!row.rowID) continue;
        for (const valueID of row.valueIDs) {
            const matches = valueIdToRowIDs.get(valueID) ?? [];
            if (!matches.includes(row.rowID)) {
                matches.push(row.rowID);
                valueIdToRowIDs.set(valueID, matches);
            }
        }
    }

    return { rows, rowIDs, sourceBlockToRowIDs, valueIdToRowIDs };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function extractKeyValueEntries(avData: unknown): Array<{ key: Record<string, unknown>; values: Array<Record<string, unknown>> }> {
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

function getRowValue(entries: Array<{ key: Record<string, unknown>; values: Array<Record<string, unknown>> }>, keyID: string, rowID: string): Record<string, unknown> | undefined {
    return entries.find((entry) => getStringField(entry.key, ['id']) === keyID)?.values
        .find((value) => getStringField(value, ['blockID']) === rowID);
}

function relationBlockIDs(value: Record<string, unknown> | undefined): string[] {
    const relation = asRecord(value?.relation);
    return Array.isArray(relation?.blockIDs)
        ? relation.blockIDs.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
}

function collectDuplicateRowsRelationDestinations(
    avData: unknown,
    sourceRowIDs: string[],
): Array<Omit<DuplicateRowsRelationDestination, 'carrierBlockID' | 'preimage'>> {
    const destinations = new Map<string, Omit<DuplicateRowsRelationDestination, 'carrierBlockID' | 'preimage'>>();
    for (const entry of extractKeyValueEntries(avData)) {
        if (getStringField(entry.key, ['type']) !== 'relation') continue;
        const relation = asRecord(entry.key.relation);
        const avID = getStringField(relation, ['avID']);
        const backKeyID = getStringField(relation, ['backKeyID']);
        if (relation?.isTwoWay !== true || !avID || !backKeyID) continue;
        const destination = destinations.get(`${avID}:${backKeyID}`) ?? {
            avID,
            backKeyID,
            destinationRowIDs: [],
        };
        for (const sourceRowID of sourceRowIDs) {
            for (const destinationRowID of relationBlockIDs(entry.values.find((value) => getStringField(value, ['blockID']) === sourceRowID))) {
                if (!destination.destinationRowIDs.includes(destinationRowID)) {
                    destination.destinationRowIDs.push(destinationRowID);
                }
            }
        }
        // A two-way key without a selected source-to-destination link does
        // not mutate its reverse AV. Do not turn metadata alone into an
        // unnecessary cross-notebook permission dependency.
        if (destination.destinationRowIDs.length > 0) {
            destinations.set(`${avID}:${backKeyID}`, destination);
        }
    }
    return [...destinations.values()];
}

function createDuplicateRowsValidationResult(
    avID: string,
    sourceRowID: string,
    message: string,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: AV_TOOL_NAME,
                    action: 'duplicate_rows',
                    avID,
                    sourceRowID,
                    message,
                },
            }, null, 2),
        }],
        isError: true,
    };
}

function createAvRowIdErrorResult(
    action: 'set_cells' | 'duplicate_rows',
    payload: Record<string, unknown>,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: AV_TOOL_NAME,
                    action,
                    ...payload,
                },
            }, null, 2),
        }],
        isError: true,
    };
}

function createAddRowsSyncTimeoutResult(
    avID: string,
    blockIDs: string[],
    resolution: AddRowsResolution,
    primaryKeyTexts: string[] = [],
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'api_error',
                    tool: AV_TOOL_NAME,
                    action: 'add_rows',
                    reason: 'row_id_sync_timeout',
                    message: `Added rows to attribute view "${avID}", but MCP could not observe writable row item IDs before the sync timeout expired.`,
                    avID,
                    ...(blockIDs.length > 0 ? { blockIDs } : {}),
                    ...(primaryKeyTexts.length > 0 ? { primaryKeyTexts } : {}),
                    rows: resolution.rows,
                    ...(resolution.unresolvedBlockIDs.length > 0 ? { unresolvedBlockIDs: resolution.unresolvedBlockIDs } : {}),
                    ...(resolution.unresolvedRowIDs && resolution.unresolvedRowIDs.length > 0 ? { unresolvedRowIDs: resolution.unresolvedRowIDs } : {}),
                    hint: 'Retry av(action="add_rows") or wait briefly and re-read the database. Only call set_cells after add_rows returns rows[].rowID.',
                },
            }, null, 2),
        }],
        isError: true,
    };
}

function resolveAddedRows(rowLookup: AvRowLookup, blockIDs: string[]): AddRowsResolution {
    const rows = blockIDs.map((blockID) => {
        const matchedRowIDs = rowLookup.sourceBlockToRowIDs.get(blockID) ?? [];
        if (matchedRowIDs.length === 1) {
            return { blockID, rowID: matchedRowIDs[0] };
        }
        if (matchedRowIDs.length > 1) {
            return { blockID, rowIDs: matchedRowIDs, status: 'ambiguous' as const };
        }
        return { blockID, status: 'missing' as const };
    });
    const unresolvedBlockIDs = rows
        .filter((row) => !('rowID' in row))
        .map((row) => row.blockID);
    return { rows, unresolvedBlockIDs };
}

function resolveDetachedRows(
    rowLookup: AvRowLookup,
    rows: Array<{ primaryKeyText: string; rowID: string }>,
): AddRowsResolution {
    const resolvedRows = rows.map((row) => (
        rowLookup.rowIDs.has(row.rowID)
            ? row
            : { ...row, status: 'missing' as const }
    ));
    const unresolvedRowIDs = resolvedRows
        .filter((row) => 'status' in row && row.status === 'missing')
        .map((row) => row.rowID);
    return { rows: resolvedRows, unresolvedBlockIDs: [], unresolvedRowIDs };
}

async function waitForAddedRows(
    client: SiYuanClient,
    avID: string,
    blockIDs: string[],
    detachedRows: Array<{ primaryKeyText: string; rowID: string }> = [],
): Promise<AddRowsResolution> {
    let lastResolution: AddRowsResolution = {
        rows: [
            ...blockIDs.map((blockID) => ({ blockID })),
            ...detachedRows,
        ],
        unresolvedBlockIDs: [...blockIDs],
        unresolvedRowIDs: detachedRows.map((row) => row.rowID),
    };

    for (let attempt = 0; attempt < ADD_ROWS_POLL_ATTEMPTS; attempt += 1) {
        const refreshed = await avApi.getAttributeView(client, avID);
        const rowLookup = extractAvRowLookup(refreshed.av);
        const boundResolution = resolveAddedRows(rowLookup, blockIDs);
        const detachedResolution = resolveDetachedRows(rowLookup, detachedRows);
        lastResolution = {
            rows: [...boundResolution.rows, ...detachedResolution.rows],
            unresolvedBlockIDs: boundResolution.unresolvedBlockIDs,
            unresolvedRowIDs: detachedResolution.unresolvedRowIDs,
        };
        if (lastResolution.unresolvedBlockIDs.length === 0 && (!lastResolution.unresolvedRowIDs || lastResolution.unresolvedRowIDs.length === 0)) {
            return lastResolution;
        }
        if (attempt < ADD_ROWS_POLL_ATTEMPTS - 1) {
            await sleep(ADD_ROWS_POLL_DELAY_MS);
        }
    }

    return lastResolution;
}

function validateRowIdForAv(
    avID: string,
    action: 'set_cells' | 'duplicate_rows',
    rowLookup: AvRowLookup,
    requestedRowID: string,
    itemIndex?: number,
): { ok: true; rowID: string } | { ok: false; result: ToolResult } {
    if (rowLookup.rowIDs.has(requestedRowID)) {
        return { ok: true, rowID: requestedRowID };
    }

    const matchedValueRowIDs = rowLookup.valueIdToRowIDs.get(requestedRowID);
    if (matchedValueRowIDs && matchedValueRowIDs.length === 1) {
        return {
            ok: false,
            result: createAvRowIdErrorResult(action, {
                reason: 'row_id_alias_detected',
                message: `rowID "${requestedRowID}" is a cell value ID in attribute view "${avID}", not the database row item ID.`,
                avID,
                rowID: requestedRowID,
                detectedValueID: requestedRowID,
                suggestedRowID: matchedValueRowIDs[0],
                ...(itemIndex === undefined ? {} : { itemIndex }),
                hint: 'Use the AV row item ID stored in each value.blockID, or the rowID returned by av(action="add_rows"). Do not reuse value.id from set_cells responses as rowID.',
            }),
        };
    }

    if (matchedValueRowIDs && matchedValueRowIDs.length > 1) {
        return {
            ok: false,
            result: createAvRowIdErrorResult(action, {
                reason: 'row_id_alias_ambiguous',
                message: `rowID "${requestedRowID}" matches multiple cell value records in attribute view "${avID}". Pass a concrete row item ID instead.`,
                avID,
                rowID: requestedRowID,
                detectedValueID: requestedRowID,
                candidateRowIDs: matchedValueRowIDs,
                ...(itemIndex === undefined ? {} : { itemIndex }),
                hint: 'Use the row item ID stored in value.blockID, not value.id.',
            }),
        };
    }

    const matchingRowIDs = rowLookup.sourceBlockToRowIDs.get(requestedRowID);
    if (matchingRowIDs && matchingRowIDs.length === 1) {
        return {
            ok: false,
            result: createAvRowIdErrorResult(action, {
                reason: 'row_id_required',
                message: `rowID "${requestedRowID}" is a source block ID in attribute view "${avID}". Use the row item ID instead.`,
                avID,
                rowID: requestedRowID,
                detectedSourceBlockID: requestedRowID,
                suggestedRowID: matchingRowIDs[0],
                ...(itemIndex === undefined ? {} : { itemIndex }),
                hint: 'Use the row item ID stored in value.blockID, or the rowID returned by av(action="add_rows"). The source block ID lives in block.id and is not writable as rowID.',
            }),
        };
    }

    if (matchingRowIDs && matchingRowIDs.length > 1) {
        return {
            ok: false,
            result: createAvRowIdErrorResult(action, {
                reason: 'row_id_ambiguous',
                message: `rowID "${requestedRowID}" matches multiple rows in attribute view "${avID}". Pass a concrete row item ID instead of the source block ID.`,
                avID,
                rowID: requestedRowID,
                detectedSourceBlockID: requestedRowID,
                candidateRowIDs: matchingRowIDs,
                ...(itemIndex === undefined ? {} : { itemIndex }),
                hint: 'Use the exact row item ID returned by av(action="add_rows"), or inspect the AV payload to choose the intended row binding.',
            }),
        };
    }

    return {
        ok: false,
        result: createAvRowIdErrorResult(action, {
            reason: 'row_id_not_canonical',
            message: `rowID "${requestedRowID}" is not a valid database row item ID in attribute view "${avID}". Pass the canonical row item ID stored in value.blockID.`,
            avID,
            rowID: requestedRowID,
            ...(itemIndex === undefined ? {} : { itemIndex }),
            hint: 'Use the rowID returned by av(action="add_rows"), or inspect the block column in av(action="get"): value.blockID is the writable row item ID, while value.id is only the cell value ID.',
        }),
    };
}

async function resolveAvContext(
    _client: SiYuanClient,
    avData: unknown,
): Promise<AvContextResolution> {
    // Attribute-view payloads carry id=avID, which is not a document/block ID.
    // Avoid feeding the AV object to the generic result resolver; otherwise it
    // falls back to /api/block/getDocInfo(avID), causing noisy SiYuan
    // "load tree by root id [...] failed" logs. Owning database blocks are
    // resolved from row bindings, mirror refs, or blocks-table SQL candidates.
    const blockID = extractFirstRowBlockId(avData);
    return { avData, blockID };
}

function extractMirrorDatabaseBlockIds(mirrors: { refDefs?: Array<{ refID?: string; defIDs?: string[] }> }): string[] {
    const blockIDs: string[] = [];
    for (const entry of mirrors.refDefs ?? []) {
        const refID = typeof entry?.refID === 'string' && entry.refID.length > 0 ? entry.refID : undefined;
        if (refID && !blockIDs.includes(refID)) {
            blockIDs.push(refID);
        }
    }
    return blockIDs;
}

async function getAvMirrorDatabaseBlockIds(client: SiYuanClient, avID: string): Promise<string[]> {
    try {
        return extractMirrorDatabaseBlockIds(await avApi.getMirrorDatabaseBlocks(client, avID));
    } catch (error) {
        if (isMissingBlockError(error)) {
            return [];
        }
        throw error;
    }
}

async function findAvDatabaseBlockIdsBySql(client: SiYuanClient, avID: string): Promise<string[]> {
    const escapedAvID = escapeSqlString(avID);
    const rows = await searchApi.querySQL(
        client,
        `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${escapedAvID}%' OR ial LIKE '%${escapedAvID}%' OR content LIKE '%${escapedAvID}%') ORDER BY updated DESC LIMIT 20`,
    );
    const blockIDs: string[] = [];
    for (const row of rows) {
        const id = row && typeof row === 'object' ? (row as Record<string, unknown>).id : undefined;
        if (typeof id === 'string' && id.length > 0 && !blockIDs.includes(id)) {
            blockIDs.push(id);
        }
    }
    return blockIDs;
}

async function collectAvDatabaseBlockCandidates(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
): Promise<string[]> {
    const candidateBlockIDs: string[] = [];
    const resolved = await resolveAvContext(client, avData);
    if (resolved.blockID) {
        candidateBlockIDs.push(resolved.blockID);
    }

    const mirrors = await getAvMirrorDatabaseBlockIds(client, avID);
    for (const blockID of mirrors) {
        if (!candidateBlockIDs.includes(blockID)) {
            candidateBlockIDs.push(blockID);
        }
    }

    const sqlMatches = await findAvDatabaseBlockIdsBySql(client, avID);
    for (const blockID of sqlMatches) {
        if (!candidateBlockIDs.includes(blockID)) {
            candidateBlockIDs.push(blockID);
        }
    }

    return candidateBlockIDs;
}

async function isExplicitAvDatabaseBlock(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    blockID: string,
): Promise<boolean> {
    // A bound row's content block is useful for ordinary AV permission
    // discovery, but it is not a carrier. Relation/template cross-AV writes
    // require the NodeAttributeView evidence below or a registered mirror/SQL
    // carrier; otherwise a source document could authorize another AV.
    const registeredDatabaseBlockIDs = [
        ...await getAvMirrorDatabaseBlockIds(client, avID),
        ...await findAvDatabaseBlockIdsBySql(client, avID),
    ];
    if (registeredDatabaseBlockIDs.includes(blockID)) return true;

    try {
        const response = await blockApi.getBlockDOM(client, blockID);
        const dom = typeof response?.dom === 'string' ? response.dom : '';
        return dom.includes('data-type="NodeAttributeView"') && dom.includes(`data-av-id="${avID}"`);
    } catch (error) {
        if (isMissingBlockError(error)) {
            return false;
        }
        throw error;
    }
}

function createAvBlockContextErrorResult(
    action: AvAction,
    avID: string,
    blockID: string,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'validation_error',
                    tool: AV_TOOL_NAME,
                    action,
                    message: `blockID "${blockID}" is not a database block for attribute view "${avID}".`,
                    fields: [{
                        path: 'blockID',
                        message: `blockID "${blockID}" does not belong to attribute view "${avID}".`,
                    }],
                    hint: 'Pass the materialized database block for this AV, or omit blockID and let MCP resolve a registered mirror block automatically.',
                },
            }, null, 2),
        }],
        isError: true,
    };
}

type AvDefinition = {
    id?: unknown;
    views?: unknown;
};

type AvViewDefinition = {
    id?: unknown;
    type?: unknown;
    name?: unknown;
    filters?: unknown;
    sorts?: unknown;
    group?: unknown;
    table?: { columns?: unknown };
    gallery?: { fields?: unknown };
    kanban?: { fields?: unknown };
};

function resolveExactCarrierView(
    avID: string,
    definition: unknown,
    attrs: Record<string, string>,
    blockID: string,
    expectedViewID: string,
): AvViewDefinition {
    const actualViewID = attrs['custom-sy-av-view'];
    if (actualViewID !== expectedViewID) {
        throw new Error(`Carrier "${blockID}" no longer selects requested view "${expectedViewID}" for attribute view "${avID}". Refusing kernel fallback.`);
    }
    const views = (definition as AvDefinition | undefined)?.views;
    if (!Array.isArray(views)) throw new Error(`Attribute view "${avID}" has no readable views array.`);
    const matches = views.filter((view): view is AvViewDefinition => (
        Boolean(view) && typeof view === 'object' && (view as AvViewDefinition).id === expectedViewID
    ));
    if (matches.length !== 1) throw new Error(`Requested view "${expectedViewID}" must resolve exactly once in attribute view "${avID}".`);
    return matches[0];
}

async function verifyExactAvCarrier(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    blockID: string,
    viewID: string,
): Promise<AvViewDefinition> {
    const matchesAv = await isExplicitAvDatabaseBlock(client, avID, avData, blockID);
    if (!matchesAv) throw new Error(`blockID "${blockID}" is not a database block for attribute view "${avID}".`);

    const [attrs, dom] = await Promise.all([
        blockApi.getBlockAttrs(client, blockID),
        blockApi.getBlockDOM(client, blockID),
    ]);
    if (attrs['custom-sy-av-view'] !== viewID) {
        throw new Error(`Carrier "${blockID}" does not select view "${viewID}". Refusing kernel fallback.`);
    }
    if (!dom.dom.includes('data-type="NodeAttributeView"') || !dom.dom.includes(`data-av-id="${avID}"`)) {
        throw new Error(`Carrier "${blockID}" DOM does not prove NodeAttributeView ownership of "${avID}".`);
    }
    return resolveExactCarrierView(avID, avData, attrs, blockID, viewID);
}

function assertKnownViewField(
    avID: string,
    view: AvViewDefinition,
    keyID: string,
): void {
    const layout = view.type;
    const fields = layout === 'table'
        ? view.table?.columns
        : layout === 'gallery'
            ? view.gallery?.fields
            : layout === 'kanban'
                ? view.kanban?.fields
                : undefined;
    if (!Array.isArray(fields) || !fields.some((field) => field && typeof field === 'object' && (field as { id?: unknown }).id === keyID)) {
        throw new Error(`Column "${keyID}" is not present in requested ${String(layout)} view "${String(view.id)}" of attribute view "${avID}".`);
    }
}

function viewFieldIDs(view: AvViewDefinition): string[] {
    const layout = view.type;
    const fields = layout === 'table'
        ? view.table?.columns
        : layout === 'gallery'
            ? view.gallery?.fields
            : layout === 'kanban'
                ? view.kanban?.fields
                : undefined;
    if (!Array.isArray(fields)) throw new Error(`Requested view "${String(view.id)}" has no readable ${String(layout)} field list.`);
    const ids = fields.map((field) => field && typeof field === 'object' ? (field as { id?: unknown }).id : undefined);
    if (!ids.every((id): id is string => typeof id === 'string' && id.length > 0)) {
        throw new Error(`Requested view "${String(view.id)}" contains a malformed field ID.`);
    }
    return ids;
}

function assertKnownAvKey(avID: string, avData: unknown, keyID: string, label: string): void {
    const keys = extractAttributeViewKeysFromData(avData);
    if (!keys.some((key) => key && typeof key === 'object' && (key as { id?: unknown }).id === keyID)) {
        throw new Error(`${label} "${keyID}" is not a key in attribute view "${avID}".`);
    }
}

function assertKnownFilterColumns(avID: string, avData: unknown, filters: unknown[]): void {
    const visit = (filter: unknown): void => {
        if (!filter || typeof filter !== 'object') return;
        const node = filter as Record<string, unknown>;
        const children = Array.isArray(node.filters) ? node.filters : undefined;
        if (typeof node.combination === 'string' || children !== undefined) {
            for (const child of children ?? []) visit(child);
            return;
        }
        if (typeof node.column === 'string' && node.column) {
            assertKnownAvKey(avID, avData, node.column, 'Filter column');
        }
    };
    for (const filter of filters) visit(filter);
}

function assertKanbanHasExistingSelectKey(avID: string, avData: unknown): void {
    const keys = extractAttributeViewKeysFromData(avData);
    if (!keys.some((key) => key && typeof key === 'object' && (key as { type?: unknown }).type === 'select')) {
        // Kernel `addAttrViewView` synthesizes a Select key when a Kanban view
        // has no grouping key, and adds it to every existing view. This action
        // owns view structure only, so require the caller to add that schema
        // field through the explicit column action first instead of smuggling a
        // cross-view schema write into an apparently additive view operation.
        throw new Error(`Kanban view creation for attribute view "${avID}" requires an existing select column; add it through av.add_column before creating the view.`);
    }
}


async function ensurePermissionForAvId(
    client: SiYuanClient,
    permMgr: PermissionManager,
    avID: string,
    required: 'read' | 'write',
    options?: {
        blockID?: string;
        action?: AvAction;
    },
): Promise<{ denied: ToolResult | null; avData: unknown }> {
    const response = await avApi.getAttributeView(client, avID);
    const avData = response.av;

    if (options?.blockID) {
        const { denied } = await ensurePermissionForDocumentId(client, permMgr, options.blockID, required);
        if (denied) return { denied, avData };
        const matchesAv = await isExplicitAvDatabaseBlock(client, avID, avData, options.blockID);
        if (!matchesAv) {
            return {
                denied: createAvBlockContextErrorResult(options.action ?? 'get', avID, options.blockID),
                avData,
            };
        }
        return { denied: null, avData };
    }
    const candidateBlockIDs = await collectAvDatabaseBlockCandidates(client, avID, avData);

    for (const candidateBlockID of candidateBlockIDs) {
        try {
            const { denied } = await ensurePermissionForDocumentId(client, permMgr, candidateBlockID, required);
            return { denied, avData };
        } catch (error) {
            if (isMissingBlockError(error)) continue;
            throw error;
        }
    }

    if (candidateBlockIDs.length === 0) {
        throw new Error(`Unable to resolve notebook permission scope for attribute view "${avID}". The database may have no rows yet; AV writes require a resolvable owning block context.`);
    }
    throw new Error(`Unable to resolve notebook permission scope for attribute view "${avID}" because all known owning block references are stale or missing.`);
}

function isUnresolvedAvPermissionScopeError(error: unknown): boolean {
    return error instanceof Error &&
        error.message.includes('The database may have no rows yet; AV writes require a resolvable owning block context.');
}

function isMissingAttributeViewError(error: unknown): boolean {
    return error instanceof Error && translateError(error)?.code === 'av_not_found';
}

async function ensurePermissionForRender(
    client: SiYuanClient,
    permMgr: PermissionManager,
    parsed: {
        id?: string;
        blockID?: string;
        createIfNotExist?: boolean;
    },
    effectiveAvID: string,
    idWasGenerated: boolean,
): Promise<{
    denied: ToolResult | null;
    shouldMaterialize: boolean;
    targetDocumentId?: string;
}> {
    if (parsed.createIfNotExist === true) {
        if (!parsed.blockID) {
            throw new Error(`Unable to create or render attribute view "${effectiveAvID}" because createIfNotExist=true requires blockID to resolve notebook permission scope.`);
        }

        if (idWasGenerated) {
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.blockID, 'write');
            return { denied, shouldMaterialize: true, targetDocumentId: context.documentId };
        }

        try {
            const { denied } = await ensurePermissionForAvId(client, permMgr, effectiveAvID, 'read');
            return { denied, shouldMaterialize: false };
        } catch (error) {
            const canFallBackToBlockContext = isUnresolvedAvPermissionScopeError(error) || isMissingAttributeViewError(error);
            if (!canFallBackToBlockContext) {
                throw error;
            }
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.blockID, 'write');
            return { denied, shouldMaterialize: true, targetDocumentId: context.documentId };
        }
    }

    if (!parsed.id) {
        throw new Error('av(action="render") requires id unless createIfNotExist=true is provided.');
    }

    try {
        const { denied } = await ensurePermissionForAvId(client, permMgr, effectiveAvID, 'read');
        return { denied, shouldMaterialize: false };
    } catch (error) {
        throw error;
    }
}

async function resolveAvOwningBlockId(
    client: SiYuanClient,
    avID: string,
    avData?: unknown,
): Promise<string | undefined> {
    const effectiveAvData = avData ?? (await avApi.getAttributeView(client, avID)).av;
    const candidateBlockIDs = await collectAvDatabaseBlockCandidates(client, avID, effectiveAvData);

    return candidateBlockIDs[0];
}

async function resolveVerifiedAvCarrierBlockId(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
): Promise<string | undefined> {
    // A row's source block is a useful permission fallback for normal AV
    // writes, but it is not proof that it is the database carrier. A copied
    // two-way relation can mutate a different AV, so accepting that fallback
    // here could authorize a cross-notebook write against the wrong document.
    // Require the rendered carrier marker before dispatch and fail closed when
    // SiYuan cannot expose one.
    const candidates = await collectAvDatabaseBlockCandidates(client, avID, avData);
    for (const candidate of candidates) {
        try {
            const response = await blockApi.getBlockDOM(client, candidate);
            const dom = typeof response?.dom === 'string' ? response.dom : '';
            if (dom.includes('data-type="NodeAttributeView"') && dom.includes(`data-av-id="${avID}"`)) {
                return candidate;
            }
        } catch (error) {
            if (isMissingBlockError(error)) continue;
            throw error;
        }
    }
    return undefined;
}

async function resolveVerifiedAvCarrier(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID?: string,
): Promise<string | undefined> {
    if (explicitBlockID) return (await isExplicitAvDatabaseBlock(client, avID, avData, explicitBlockID)) ? explicitBlockID : undefined;
    const candidates = [
        ...await getAvMirrorDatabaseBlockIds(client, avID),
        ...await findAvDatabaseBlockIdsBySql(client, avID),
    ];
    for (const candidate of candidates) {
        if (await isExplicitAvDatabaseBlock(client, avID, avData, candidate)) return candidate;
    }
    return undefined;
}

async function resolveDuplicateRowsRelationDestinations(
    client: SiYuanClient,
    permMgr: PermissionManager,
    sourceAvID: string,
    avData: unknown,
    sourceRowIDs: string[],
): Promise<{ denied: ToolResult | null; destinations: DuplicateRowsRelationDestination[] }> {
    const discovered = collectDuplicateRowsRelationDestinations(avData, sourceRowIDs);
    const destinations: DuplicateRowsRelationDestination[] = [];
    for (const destination of discovered) {
        // A copied two-way relation writes the reverse key in this AV. Resolve
        // a real database carrier before dispatch so a source-only permission
        // check cannot authorize a cross-notebook mutation by accident.
        const response = await avApi.getAttributeView(client, destination.avID);
        const carrierBlockID = await resolveVerifiedAvCarrierBlockId(client, destination.avID, response.av);
        if (!carrierBlockID) {
            return {
                denied: createDuplicateRowsValidationResult(sourceAvID, destination.avID,
                    `Could not resolve a database carrier for two-way relation destination AV "${destination.avID}".`),
                destinations: [],
            };
        }
        const permission = await ensurePermissionForDocumentId(client, permMgr, carrierBlockID, 'write');
        if (permission.denied) return { denied: permission.denied, destinations: [] };
        destinations.push({ ...destination, carrierBlockID, preimage: response.av });
    }
    return { denied: null, destinations };
}

function verifyDuplicateRowsRelationDestinations(
    destinations: DuplicateRowsRelationDestination[],
    copiedRowIDs: string[],
    readbacks: Map<string, unknown>,
): string | undefined {
    for (const destination of destinations) {
        const beforeEntries = extractKeyValueEntries(destination.preimage);
        const after = readbacks.get(destination.avID);
        const afterEntries = extractKeyValueEntries(after);
        for (const destinationRowID of destination.destinationRowIDs) {
            const beforeValue = getRowValue(beforeEntries, destination.backKeyID, destinationRowID);
            const afterValue = getRowValue(afterEntries, destination.backKeyID, destinationRowID);
            const beforeIDs = relationBlockIDs(beforeValue);
            const afterIDs = relationBlockIDs(afterValue);
            const missing = copiedRowIDs.filter((rowID) => !afterIDs.includes(rowID));
            const unexpected = afterIDs.filter((rowID) => !beforeIDs.includes(rowID) && !copiedRowIDs.includes(rowID));
            if (missing.length > 0 || unexpected.length > 0) {
                return `Two-way relation readback drifted in destination AV "${destination.avID}" row "${destinationRowID}".`;
            }
        }
    }
    return undefined;
}

async function resolveAvWriteRefreshOperations(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID?: string,
): Promise<UiRefreshOperation[]> {
    const candidateBlockIDs: string[] = [];
    if (explicitBlockID) {
        candidateBlockIDs.push(explicitBlockID);
    }

    try {
        const owningBlockID = await resolveAvOwningBlockId(client, avID, avData);
        if (owningBlockID && !candidateBlockIDs.includes(owningBlockID)) {
            candidateBlockIDs.push(owningBlockID);
        }
    } catch {
        // Keep refresh best-effort even if owning-block discovery fails.
    }

    for (const candidateBlockID of candidateBlockIDs) {
        try {
            const context = await resolveDocumentContextById(client, candidateBlockID);
            if (context.documentId) {
                return [{ type: 'reloadProtyle', id: context.documentId }];
            }
        } catch {
            // Best-effort only: fall back to AV-scoped refresh if the owning document
            // cannot be resolved after a successful write.
        }
    }

    return [{ type: 'reloadAttributeView', id: avID }];
}

async function filterAvSearchResultsByPermission(
    client: SiYuanClient,
    permMgr: PermissionManager,
    results: unknown[],
): Promise<{
    results: unknown[];
    unresolvedResults: unknown[];
    filteredOutCount: number;
    rawResultCount: number;
    unresolvedCount: number;
    permissionFilteredOutCount: number;
    partial?: boolean;
    reason?: string;
}> {
    const cache = createResultResolutionCache();
    await permMgr.reload();

    const filtered: unknown[] = [];
    const unresolvedResults: unknown[] = [];
    let filteredOutCount = 0;
    let unresolvedCount = 0;
    let permissionFilteredOutCount = 0;

    for (const result of results) {
        const context = await resolveResultItemContext(client, result, cache);
        if (!context?.notebook) {
            filteredOutCount += 1;
            unresolvedCount += 1;
            unresolvedResults.push(result);
            continue;
        }
        if (!permMgr.canRead(context.notebook)) {
            filteredOutCount += 1;
            permissionFilteredOutCount += 1;
            continue;
        }
        filtered.push(result);
    }

    return {
        results: filtered,
        unresolvedResults,
        rawResultCount: results.length,
        filteredOutCount,
        unresolvedCount,
        permissionFilteredOutCount,
        ...(filteredOutCount > 0 ? { partial: true, reason: permissionFilteredOutCount > 0 ? 'permission_filtered' : 'context_unresolved' } : {}),
    };
}

async function listAllAttributeViewIDs(client: SiYuanClient): Promise<string[]> {
    const entries = await client.requestRead<Array<{ isDir?: boolean; name?: string }>>('/api/file/readDir', { path: ATTRIBUTE_VIEW_DIR });
    return (Array.isArray(entries) ? entries : [])
        .filter((entry) => !entry?.isDir && typeof entry?.name === 'string' && entry.name.endsWith('.json'))
        .map((entry) => entry.name!.slice(0, -5))
        .filter((name) => ATTRIBUTE_VIEW_ID_PATTERN.test(name));
}

function extractPrimaryKeyMatchedValues(rows: unknown): Array<Record<string, unknown>> {
    if (!rows || typeof rows !== 'object') return [];
    const values = (rows as { values?: unknown }).values;
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'));
}

async function searchAttributeViewPrimaryKeys(
    client: SiYuanClient,
    keyword: string,
    excludes?: string[],
): Promise<unknown[]> {
    if (!keyword.trim()) return [];
    if (typeof client.request !== 'function') return [];
    const excludeSet = new Set(excludes ?? []);
    const avIDs = await listAllAttributeViewIDs(client);
    const results: unknown[] = [];

    for (const avID of avIDs) {
        if (excludeSet.has(avID)) continue;
        try {
            const response = await avApi.getAttributeViewPrimaryKeyValues(client, {
                id: avID,
                keyword,
                page: 1,
                pageSize: 3,
            });
            const matchedRows = extractPrimaryKeyMatchedValues(response.rows);
            if (matchedRows.length === 0) continue;
            const blockIDs = Array.isArray(response.blockIDs) ? response.blockIDs.filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
            if (blockIDs.length === 0) continue;
            results.push({
                avID,
                avName: response.name,
                blockID: blockIDs[0],
                blockIDs,
                rows: response.rows,
                matchedRowCount: matchedRows.length,
                matchSource: 'primary_key',
            });
        } catch {
            // Ignore unreadable or incompatible AVs during fallback search.
        }
    }

    return results;
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

function buildDuplicateAvBlockDom(blockID: string, avID: string): string {
    return `<div class="av" data-node-id="${blockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="table"></div>`;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

function normalizeAvValue(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    // 内核 Value 对象的内容在类型子对象里：text/number/date 等标量类解包出
    // content/checked，多值/引用类（mSelect/relation/block 等）原样返回
    for (const key of ['text', 'number', 'date', 'url', 'email', 'phone', 'template', 'created', 'updated', 'checkbox']) {
        const sub = record[key];
        if (sub !== undefined && sub !== null) {
            if (typeof sub === 'object' && !Array.isArray(sub)) {
                const subRecord = sub as Record<string, unknown>;
                if ('content' in subRecord) return subRecord.content;
                if ('checked' in subRecord) return subRecord.checked;
            }
            return sub;
        }
    }
    for (const key of ['mSelect', 'select', 'block', 'relation', 'rollup', 'mAsset']) {
        if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return value;
}

function extractAvTableColumns(responseObj: Record<string, unknown>): AvTableView['columns'] {
    const candidates = [responseObj.columns, responseObj.keys, responseObj.keyValues, responseObj.attributeViewKeys];
    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        const columns = candidate.flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
            const record = item as Record<string, unknown>;
            const keyRecord = record.key && typeof record.key === 'object' && !Array.isArray(record.key)
                ? record.key as Record<string, unknown>
                : record;
            const id = pickString(keyRecord, ['id', 'keyID', 'columnID']);
            if (!id) return [];
            const name = pickString(keyRecord, ['name', 'title']);
            const type = pickString(keyRecord, ['type']);
            return [{ id, ...(name ? { name } : {}), ...(type ? { type } : {}) }];
        });
        if (columns.length > 0) return columns;
    }
    return [];
}

function extractAvTableRows(rows: unknown[]): AvTableView['rows'] {
    return rows.flatMap((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
        const record = row as Record<string, unknown>;
        const values = Array.isArray(record.values)
            ? record.values
            : Array.isArray(record.cells)
                ? record.cells
                : [];
        const cells: Record<string, unknown> = {};
        for (const value of values) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const cell = value as Record<string, unknown>;
            // 内核渲染 cell：{ id: 值ID, value: { keyID: 列ID, ... }, valueType }，
            // 顶层 id 是值 ID 而非列 ID，列 keyID 必须从 value.keyID 取
            const inner = cell.value && typeof cell.value === 'object' && !Array.isArray(cell.value)
                ? cell.value as Record<string, unknown>
                : undefined;
            const keyObj = cell.key && typeof cell.key === 'object' && !Array.isArray(cell.key)
                ? cell.key as Record<string, unknown>
                : {};
            const columnID = (inner ? pickString(inner, ['keyID']) : undefined)
                ?? pickString(keyObj, ['id', 'keyID'])
                ?? pickString(cell, ['keyID', 'columnID'])
                ?? pickString(cell, ['id']);
            if (!columnID) continue;
            cells[columnID] = normalizeAvValue(inner ?? cell);
        }
        if (Object.keys(cells).length === 0) return [];
        const id = pickString(record, ['id', 'rowID', 'blockID']);
        return [{ ...(id ? { id } : {}), cells }];
    });
}

function extractViewItems(view: Record<string, unknown> | undefined): { items: unknown[]; total: number } {
    if (!view) return { items: [], total: 0 };
    const rows = Array.isArray(view.rows) ? view.rows
        : Array.isArray(view.cards) ? view.cards
            : [];
    const total = typeof view.rowCount === 'number' ? view.rowCount as number
        : typeof view.cardCount === 'number' ? view.cardCount as number
            : rows.length;
    if (rows.length > 0 || !Array.isArray(view.groups)) return { items: rows, total };
    // 分组视图：内核把行移入 view.groups[].rows/cards 并清空顶层行（SetItems(nil)），
    // 这里聚合各分组当前页的行；总数取顶层 rowCount/cardCount（分页前全量）
    const items: unknown[] = [];
    for (const group of view.groups) {
        if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
        const groupView = group as Record<string, unknown>;
        const groupRows = Array.isArray(groupView.rows) ? groupView.rows
            : Array.isArray(groupView.cards) ? groupView.cards
                : [];
        items.push(...groupRows);
    }
    return { items, total };
}

function computeRenderPageCount(view: Record<string, unknown> | undefined, total: number, effectivePageSize: number): number {
    const base = computePageCount(total, effectivePageSize);
    if (!Array.isArray(view?.groups)) return base;
    // 分组视图的每组独立分页，hasNextPage 以组内最大页数为准
    let count = base;
    for (const group of view.groups) {
        if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
        const groupView = group as Record<string, unknown>;
        const groupTotal = typeof groupView.rowCount === 'number' ? groupView.rowCount as number
            : typeof groupView.cardCount === 'number' ? groupView.cardCount as number
                : 0;
        if (groupTotal > 0) count = Math.max(count, computePageCount(groupTotal, effectivePageSize));
    }
    return count;
}

function buildAvTableView(responseObj: Record<string, unknown>, rows: unknown[], total: number): AvTableView | undefined {
    const columns = extractAvTableColumns(responseObj);
    const tableRows = extractAvTableRows(rows);
    if (columns.length === 0 && tableRows.length === 0) return undefined;
    return { columns, rows: tableRows, rowCount: total };
}

function formatSiYuanUpdatedStamp(date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
}

async function resolveAvTransactionBlockId(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID?: string,
): Promise<string | undefined> {
    return explicitBlockID ?? await resolveAvOwningBlockId(client, avID, avData);
}

function withUpdatedOperation(
    operations: TransactionOperation[],
    blockID?: string,
    previousUpdated?: unknown,
): {
    doOperations: TransactionOperation[];
    undoOperations: TransactionOperation[];
} {
    if (!blockID) {
        return { doOperations: operations, undoOperations: [] };
    }

    const updated = formatSiYuanUpdatedStamp();
    return {
        doOperations: [
            ...operations,
            {
                action: 'doUpdateUpdated',
                id: blockID,
                data: updated,
            },
        ],
        undoOperations: [{
            action: 'doUpdateUpdated',
            id: blockID,
            data: typeof previousUpdated === 'string' ? previousUpdated : '',
        }],
    };
}

function buildStrongCellValue(
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

function normalizeSelectOptions(options: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return options.map((option) => ({
        ...option,
        name: typeof option.name === 'string' ? option.name.trim() : option.name,
        ...(typeof option.color === 'string' ? { color: option.color } : {}),
        ...(typeof option.desc === 'string' ? { desc: option.desc } : {}),
    }));
}

type ComparableSelectOption = { name: string; color: string; desc: string };

function comparableSelectOptions(value: unknown, allowOmittedEmpty = false): ComparableSelectOption[] | undefined {
    // Key.Options uses `omitempty` in SiYuan's raw AV model. A successful
    // complete clear therefore reads back with no `options` member at all,
    // rather than `options: []`. Only the explicit empty requested postimage
    // may use that equivalence; null or malformed values remain a failed proof.
    if (value === undefined && allowOmittedEmpty) return [];
    if (!Array.isArray(value)) return undefined;
    const normalized: ComparableSelectOption[] = [];
    for (const option of value) {
        const record = asRecord(option);
        const name = typeof record?.name === 'string' ? record.name.trim() : undefined;
        if (!name) return undefined;
        normalized.push({
            name,
            color: typeof record.color === 'string' ? record.color : '',
            desc: typeof record.desc === 'string' ? record.desc : '',
        });
    }
    return normalized;
}

function sameComparableOptions(left: ComparableSelectOption[], right: ComparableSelectOption[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function sameComparableOptionSet(left: ComparableSelectOption[], right: ComparableSelectOption[]): boolean {
    if (left.length !== right.length) return false;
    const encode = (option: ComparableSelectOption) => JSON.stringify(option);
    const leftEntries = [...left].map(encode).sort();
    const rightEntries = [...right].map(encode).sort();
    return leftEntries.every((entry, index) => entry === rightEntries[index]);
}

function projectRemovedSelectOptionsFromFilterNode(
    value: unknown,
    targetKeyID: string,
    removedOptionNames: Set<string>,
): Record<string, unknown> | undefined {
    const filter = asRecord(value);
    if (!filter) return undefined;
    const children = Array.isArray(filter.filters) ? filter.filters : undefined;
    const isGroup = typeof filter.combination === 'string' || children !== undefined;
    if (isGroup) {
        const projectedChildren = (children ?? [])
            .flatMap((child) => {
                const projected = projectRemovedSelectOptionsFromFilterNode(child, targetKeyID, removedOptionNames);
                return projected ? [projected] : [];
            });
        if (projectedChildren.length === 0) return undefined;
        return { ...filter, filters: projectedChildren };
    }
    if (filter.column !== targetKeyID || filter.operator === 'Is empty' || filter.operator === 'Is not empty') {
        return filter;
    }
    const filterValue = asRecord(filter.value);
    if (!filterValue || !['select', 'mSelect'].includes(getStringField(filterValue, ['type']) ?? '')) return filter;
    const selections = Array.isArray(filterValue.mSelect) ? filterValue.mSelect : undefined;
    if (!selections) return filter;
    const projectedSelections = selections.filter((selection) => {
        const record = asRecord(selection);
        return !record || !removedOptionNames.has(getStringField(record, ['content']) ?? '');
    });
    if (projectedSelections.length === 0) return undefined;
    return projectedSelections.length === selections.length
        ? filter
        : { ...filter, value: { ...filterValue, mSelect: projectedSelections } };
}

function projectViewFiltersAfterSelectOptionRemoval(
    filters: unknown,
    targetKeyID: string,
    removedOptionNames: Set<string>,
): unknown {
    if (!Array.isArray(filters)) return filters;
    const projected = filters.flatMap((filter) => {
        const node = projectRemovedSelectOptionsFromFilterNode(filter, targetKeyID, removedOptionNames);
        return node ? [node] : [];
    });
    // `removeAttributeViewColumnOption` persists this exact empty AND root for
    // every view after an option removal. Keep it narrow to option removals:
    // treating arbitrary missing filters as equivalent would hide real drift.
    return projected.length > 0 ? projected : [{ combination: 'and' }];
}

function filterReferencesRemovedSelectOption(
    filters: unknown,
    targetKeyID: string,
    removedOptionNames: Set<string>,
): boolean {
    if (!Array.isArray(filters)) return false;
    for (const filter of filters) {
        const record = asRecord(filter);
        if (!record) continue;
        if (filterReferencesRemovedSelectOption(record.filters, targetKeyID, removedOptionNames)) return true;
        if (record.column !== targetKeyID || record.operator === 'Is empty' || record.operator === 'Is not empty') continue;
        const filterValue = asRecord(record.value);
        if (!filterValue || !['select', 'mSelect'].includes(getStringField(filterValue, ['type']) ?? '')) continue;
        if (Array.isArray(filterValue.mSelect) && filterValue.mSelect.some((selection) => {
            const item = asRecord(selection);
            return item ? removedOptionNames.has(getStringField(item, ['content']) ?? '') : false;
        })) return true;
    }
    return false;
}

function projectTemplateSelectValuesAfterOptionRemoval(
    templates: unknown,
    targetKeyID: string,
    removedOptionNames: Set<string>,
): unknown {
    if (!Array.isArray(templates)) return templates;
    return templates.map((template) => {
        const record = asRecord(template);
        const fieldValues = asRecord(record?.fieldValues);
        const fieldValue = asRecord(fieldValues?.[targetKeyID]);
        const value = asRecord(fieldValue?.value);
        const selections = Array.isArray(value?.mSelect) ? value.mSelect : undefined;
        if (!record || !fieldValues || !fieldValue || !value || getStringField(fieldValue, ['mode']) !== 'static'
            || !['select', 'mSelect'].includes(getStringField(value, ['type']) ?? '') || !selections) return template;
        const projectedSelections = selections.filter((selection) => {
            const item = asRecord(selection);
            return !item || !removedOptionNames.has(getStringField(item, ['content']) ?? '');
        });
        if (projectedSelections.length === selections.length) return template;
        const projectedFieldValues = { ...fieldValues };
        if (projectedSelections.length === 0) delete projectedFieldValues[targetKeyID];
        else projectedFieldValues[targetKeyID] = { ...fieldValue, value: { ...value, mSelect: projectedSelections } };
        return Object.keys(projectedFieldValues).length > 0
            ? { ...record, fieldValues: projectedFieldValues }
            : Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'fieldValues'));
    });
}

function projectSameAvFieldFiltersAfterOptionRemoval(
    keyValues: unknown[],
    avID: string | undefined,
    targetKeyID: string,
    removedOptionNames: Set<string>,
): void {
    const keyByID = new Map<string, Record<string, unknown>>();
    for (const entry of keyValues) {
        const key = asRecord(asRecord(entry)?.key);
        const keyID = getStringField(key, ['id']);
        if (key && keyID) keyByID.set(keyID, key);
    }
    for (const entry of keyValues) {
        const record = asRecord(entry);
        const key = asRecord(record?.key);
        if (!key || !avID) continue;
        const relation = asRecord(key.relation);
        if (key.type === 'relation' && relation?.avID === avID
            && filterReferencesRemovedSelectOption(relation.candidateFilters, targetKeyID, removedOptionNames)) {
            const projected = projectRemovedSelectOptionsFromFilterNode(
                { combination: 'and', filters: relation.candidateFilters }, targetKeyID, removedOptionNames,
            );
            key.relation = projected && Array.isArray(projected.filters)
                ? { ...relation, candidateFilters: projected.filters }
                : Object.fromEntries(Object.entries(relation).filter(([name]) => name !== 'candidateFilters'));
            continue;
        }
        const rollup = asRecord(key.rollup);
        const relationKeyID = getStringField(rollup, ['relationKeyID']);
        const relationKey = relationKeyID ? keyByID.get(relationKeyID) : undefined;
        const sourceRelation = asRecord(relationKey?.relation);
        if (key.type === 'rollup' && rollup && sourceRelation?.avID === avID
            && filterReferencesRemovedSelectOption(rollup.filters, targetKeyID, removedOptionNames)) {
            const projected = projectRemovedSelectOptionsFromFilterNode(
                { combination: 'and', filters: rollup.filters }, targetKeyID, removedOptionNames,
            );
            key.rollup = projected && Array.isArray(projected.filters)
                ? { ...rollup, filters: projected.filters }
                : Object.fromEntries(Object.entries(rollup).filter(([name]) => name !== 'filters'));
        }
    }
}

/**
 * Pure collateral projection for set_column_options. It deliberately retains
 * all primary-row bindings and view item IDs: the native option transaction
 * cannot create rows, so masking them would turn a concurrent/pending row
 * write into a false success.
 */
export function projectAvStateWithoutColumnOptions(avData: unknown, targetKeyID: string, removedOptionNames: string[]): unknown {
    if (!avData || typeof avData !== 'object') return avData;
    const protectedState = JSON.parse(JSON.stringify(avData)) as Record<string, unknown>;
    // Updating options can upgrade the on-disk AV format revision. It is a
    // kernel normalization, not collateral schema drift; treating it as a
    // foreign change would falsely report an otherwise exact write unknown.
    delete protectedState.spec;
    const keyValues = Array.isArray(protectedState.keyValues) ? protectedState.keyValues : [];
    for (const entry of keyValues) {
        const record = asRecord(entry);
        const key = asRecord(record?.key);
        if (getStringField(key, ['id']) !== targetKeyID) continue;
        // Option-group membership and select cell presentation are derived from
        // the one changed definition. Mask only that key's options and values
        // so this comparison still catches drift in every unrelated key,
        // filter, sort, template, relation, and view configuration.
        if (key) key.options = '__sisyphus_target_options__';
        if (record) record.values = '__sisyphus_target_column_values__';
    }
    const removed = new Set(removedOptionNames);
    if (removed.size > 0) {
        // v3.8.0 removes an omitted option from templates and filter values in
        // the same native transaction. Project exactly those documented
        // dependents before comparing, but leave every unrelated key, filter,
        // template field, relation and rollup visible as collateral evidence.
        protectedState.newItemTemplates = projectTemplateSelectValuesAfterOptionRemoval(
            protectedState.newItemTemplates, targetKeyID, removed,
        );
        projectSameAvFieldFiltersAfterOptionRemoval(keyValues, getStringField(protectedState, ['id']), targetKeyID, removed);
    }
    const views = Array.isArray(protectedState.views) ? protectedState.views : [];
    for (const view of views) {
        const record = asRecord(view);
        if (!record) continue;
        // v3.8 SaveAttributeView rewrites every View.Icon because its JSON
        // field has no omitempty tag. A legacy raw preimage may omit the
        // default icon, while the option transaction's save emits icon: "".
        // Normalize only that absent-to-empty serialization; any non-empty
        // icon still remains collateral view drift and rejects the write.
        if (!Object.prototype.hasOwnProperty.call(record, 'icon')) record.icon = '';
        // regenAttrViewGroups only owns groups derived from the changed select
        // key. Retaining groups for other fields keeps the collateral check
        // able to catch an unrelated view mutation in the same response.
        if (getStringField(asRecord(record.group), ['field']) === targetKeyID) delete record.groups;
        if (removed.size > 0) record.filters = projectViewFiltersAfterSelectOptionRemoval(record.filters, targetKeyID, removed);
    }
    return protectedState;
}

/**
 * Test-only diagnostic companion for the narrow projection above. Keeping the
 * first divergent raw path makes live evidence actionable without broadening
 * the write contract to whatever happened to differ in one response.
 */
export function firstJsonDifferencePath(left: unknown, right: unknown, path = '$'): string | undefined {
    if (Object.is(left, right)) return undefined;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return path;
        const sharedLength = Math.min(left.length, right.length);
        for (let index = 0; index < sharedLength; index += 1) {
            const nested = firstJsonDifferencePath(left[index], right[index], `${path}[${index}]`);
            if (nested) return nested;
        }
        return left.length === right.length ? undefined : `${path}.length`;
    }
    const leftRecord = asRecord(left);
    const rightRecord = asRecord(right);
    if (!leftRecord || !rightRecord) return path;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
        const nested = firstJsonDifferencePath(leftRecord[key], rightRecord[key], `${path}.${key}`);
        if (nested) return nested;
    }
    return undefined;
}

function normalizeCopiedRowValue(value: Record<string, unknown>): unknown {
    const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    delete clone.id;
    delete clone.blockID;
    delete clone.isDetached;
    delete clone.isRenderAutoFill;
    delete clone.createdAt;
    delete clone.updatedAt;
    const block = asRecord(clone.block);
    if (block) {
        delete block.id;
        delete block.updated;
        delete block.created;
    }
    const relation = asRecord(clone.relation);
    if (relation) delete relation.contents;
    return clone;
}

function topLevelViewItemIDs(avData: unknown): Set<string> {
    const itemIDs = new Set<string>();
    const views = asRecord(avData)?.views;
    if (!Array.isArray(views)) return itemIDs;
    for (const view of views) {
        const record = asRecord(view);
        // Raw getAttributeView serializes this persisted top-level membership
        // as itemIds (lowercase d). Keep the historical itemIDs spelling as a
        // compatibility fallback for older kernel payloads/test fixtures; using
        // only the latter rejects a valid canonical row before dispatch.
        const rows = Array.isArray(record?.itemIds)
            ? record.itemIds
            : Array.isArray(record?.itemIDs)
                ? record.itemIDs
                : [];
        for (const rowID of rows) {
            if (typeof rowID === 'string' && rowID) itemIDs.add(rowID);
        }
    }
    return itemIDs;
}

function collectItemIDSnapshots(value: unknown, snapshots: string[][] = []): string[][] {
    if (Array.isArray(value)) {
        for (const item of value) collectItemIDSnapshots(item, snapshots);
        return snapshots;
    }
    const record = asRecord(value);
    if (!record) return snapshots;
    const itemIDs = Array.isArray(record.itemIds)
        ? record.itemIds
        : Array.isArray(record.itemIDs)
            ? record.itemIDs
            : undefined;
    if (itemIDs && itemIDs.every((id) => typeof id === 'string')) {
        snapshots.push(itemIDs as string[]);
    }
    for (const [key, nested] of Object.entries(record)) {
        if (key !== 'itemIds' && key !== 'itemIDs') collectItemIDSnapshots(nested, snapshots);
    }
    return snapshots;
}

function verifyDuplicateRowsSourceReadback(
    before: unknown,
    after: unknown,
    sourceRowIDs: string[],
    copiedRowIDs: string[],
    previousID?: string,
): string | undefined {
    const beforeEntries = extractKeyValueEntries(before);
    const afterEntries = extractKeyValueEntries(after);
    const afterLookup = extractAvRowLookup(after);

    for (let index = 0; index < copiedRowIDs.length; index += 1) {
        const copiedRowID = copiedRowIDs[index];
        const sourceRowID = sourceRowIDs[index];
        const copied = afterLookup.rows.find((row) => row.rowID === copiedRowID);
        if (!copied || copied.isDetached !== true || copied.sourceBlockID) {
            return `Copied row "${copiedRowID}" was not observed as a detached AV row.`;
        }
        for (const entry of beforeEntries) {
            const keyID = getStringField(entry.key, ['id']);
            const keyType = getStringField(entry.key, ['type']);
            if (['rollup', 'created', 'updated'].includes(keyType ?? '')) continue;
            const afterEntry = keyID
                ? afterEntries.find((candidate) => getStringField(candidate.key, ['id']) === keyID)
                : afterEntries.find((candidate) => getStringField(candidate.key, ['type']) === keyType);
            const sourceValue = entry.values.find((value) => getStringField(value, ['blockID']) === sourceRowID);
            if (!sourceValue) continue;
            const copiedValue = afterEntry?.values.find((value) => getStringField(value, ['blockID']) === copiedRowID);
            if (!copiedValue) {
                return `Copied row "${copiedRowID}" did not preserve source row "${sourceRowID}" value for key "${keyID ?? keyType ?? 'unknown'}".`;
            }
            if (keyType === 'block') {
                const sourceContent = getStringField(asRecord(sourceValue.block), ['content']) ?? '';
                const copiedContent = getStringField(asRecord(copiedValue.block), ['content']) ?? '';
                if (sourceContent !== copiedContent) {
                    return `Copied row "${copiedRowID}" primary key text does not match source row "${sourceRowID}".`;
                }
                continue;
            }
            if (JSON.stringify(normalizeCopiedRowValue(sourceValue)) !== JSON.stringify(normalizeCopiedRowValue(copiedValue))) {
                return `Copied row "${copiedRowID}" did not preserve source row "${sourceRowID}" value for key "${keyID ?? keyType ?? 'unknown'}".`;
            }
        }
    }

    const afterItemLists = collectItemIDSnapshots(after);
    const hasExpectedPlacement = afterItemLists.some((itemIDs) => {
        if (!copiedRowIDs.every((rowID) => itemIDs.includes(rowID))) return false;
        if (previousID) {
            const start = itemIDs.indexOf(previousID) + 1;
            return start > 0 && copiedRowIDs.every((rowID, index) => itemIDs[start + index] === rowID);
        }
        return copiedRowIDs.every((rowID, index) => itemIDs[itemIDs.length - copiedRowIDs.length + index] === rowID);
    });
    if (!hasExpectedPlacement) {
        return previousID
            ? `Copied rows were not observed immediately after previousID "${previousID}" in AV item ordering.`
            : 'Copied rows were not observed at the append position in AV item ordering.';
    }
    return undefined;
}

function getAvKeyById(avData: unknown, keyID: string): Record<string, unknown> | undefined {
    return extractAttributeViewKeysFromData(avData)
        .find((key): key is Record<string, unknown> => getStringField(key, ['id']) === keyID);
}

function createAvFieldValidationResult(
    action: 'set_column_options',
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

async function handleGet({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.id, 'read', { blockID: parsed.blockID, action: 'get' });
    if (denied) return denied;
    const rowLookup = extractAvRowLookup(avData);
    return createJsonResult({
        id: parsed.id,
        av: avData,
        ...(rowLookup.rows.length > 0 ? {
            resolvedRows: rowLookup.rows.map((row) => ({
                rowID: row.rowID,
                ...(row.sourceBlockID ? { sourceBlockID: row.sourceBlockID } : {}),
                ...(row.valueIDs.length > 0 ? { valueIDs: row.valueIDs } : {}),
            })),
        } : {}),
    });
}

async function handleSearch({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSearchSchema.parse(rawArgs);
    const response = await avApi.searchAttributeView(client, parsed.keyword, parsed.excludes);
    const kernelResults = Array.isArray(response.results) ? response.results : [];
    const primaryKeyResults = await searchAttributeViewPrimaryKeys(client, parsed.keyword, parsed.excludes);
    const dedupedResults: unknown[] = [...kernelResults];
    const seenAvIDs = new Set(
        dedupedResults
            .map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).avID : undefined)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
    );
    for (const result of primaryKeyResults) {
        const avID = (result as Record<string, unknown>).avID;
        if (typeof avID === 'string' && seenAvIDs.has(avID)) continue;
        if (typeof avID === 'string') seenAvIDs.add(avID);
        dedupedResults.push(result);
    }
    const filtered = await filterAvSearchResultsByPermission(client, permMgr, dedupedResults);
    const normalizedResults = filtered.results.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
        const record = item as Record<string, unknown>;
        const avID = typeof record.avID === 'string' && record.avID.length > 0
            ? record.avID
            : typeof record.id === 'string' && record.id.length > 0
                ? record.id
                : undefined;
        if (!avID) return record;
        return {
            ...record,
            id: avID,
            avID,
            renderArgs: { action: 'render', id: avID },
        };
    });
    return createJsonResult({
        keyword: parsed.keyword,
        searchScope: {
            kernel: 'attribute_view_name_or_kernel_candidates',
            fallback: 'primary_key_values',
        },
        ...filtered,
        results: normalizedResults,
        ...(filtered.filteredOutCount > 0 ? {
            emptyReason: normalizedResults.length === 0
                ? (filtered.unresolvedCount > 0 && filtered.permissionFilteredOutCount === 0 ? 'no_verified_results_unresolved_candidates_available'
                    : filtered.permissionFilteredOutCount > 0 && filtered.unresolvedCount === 0 ? 'all_results_permission_filtered'
                        : 'all_results_filtered')
                : undefined,
            unresolvedHint: filtered.unresolvedResults.length > 0
                ? 'unresolvedResults contains kernel search candidates that matched, but MCP could not verify notebook context yet.'
                : undefined,
        } : {}),
        ...(parsed.keyword.trim().length > 0 && filtered.results.length === 0 ? {
            warning: 'No verified AV matches were found. AV search primarily covers database names and primary-key values; non-primary-key cell text may not be searchable immediately after writes.',
        } : {}),
    });
}

async function handleRender({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvRenderSchema.parse(rawArgs);
    const creationTime = new Date();
    const idWasGenerated = !parsed.id;
    const effectiveAvID = parsed.id ?? generateSiYuanNodeId(creationTime);
    const permission = await ensurePermissionForRender(client, permMgr, parsed, effectiveAvID, idWasGenerated);
    if (permission.denied) return permission.denied;

    const response = await avApi.renderAttributeView(client, {
        id: effectiveAvID,
        blockID: parsed.blockID,
        viewID: parsed.viewID,
        page: parsed.page,
        pageSize: parsed.pageSize,
        query: parsed.query,
        groupPaging: parsed.groupPaging,
        createIfNotExist: parsed.createIfNotExist,
    });

    let materializedBlockID: string | undefined;
    let materializedBlockRegistered: boolean | undefined;
    if (permission.shouldMaterialize) {
        materializedBlockID = generateSiYuanNodeId(creationTime);
        let data = buildDuplicateAvBlockDom(materializedBlockID, effectiveAvID);
        try {
            const spun = await avApi.spinBlockDOM(client, data);
            if (typeof spun.dom === 'string' && spun.dom.length > 0) {
                data = spun.dom;
            }
        } catch {
            // Keep materialization compatible with kernels that do not expose
            // /api/lute/spinBlockDOM; transaction insert can still parse the
            // minimal AV block DOM.
        }
        await transactionApi.performTransactions(client, [{
            doOperations: [{
                action: 'insert',
                id: materializedBlockID,
                data,
                parentID: parsed.blockID!,
            }],
            undoOperations: [{
                action: 'delete',
                id: materializedBlockID,
            }],
        }]);
        materializedBlockRegistered = false;
        for (let attempt = 0; attempt < AV_MATERIALIZATION_POLL_ATTEMPTS; attempt += 1) {
            const mirrorBlockIDs = await getAvMirrorDatabaseBlockIds(client, effectiveAvID);
            if (mirrorBlockIDs.includes(materializedBlockID)) {
                materializedBlockRegistered = true;
                break;
            }
            if (attempt === AV_MATERIALIZATION_POLL_ATTEMPTS - 1) {
                break;
            }
            await sleep(AV_MATERIALIZATION_POLL_DELAY_MS);
        }
    }

    const responseObj = (response && typeof response === 'object' && !Array.isArray(response))
        ? response as Record<string, unknown>
        : {};
    // SiYuan kernel nests the rendered view under `view`：
    // 表格 { pageSize, columns, rows, rowCount }（分组时行移入 view.groups[].rows），
    // 画廊/看板 { pageSize, cards, cardCount }
    const view = (responseObj.view && typeof responseObj.view === 'object' && !Array.isArray(responseObj.view))
        ? responseObj.view as Record<string, unknown>
        : undefined;
    const { items: rawRows, total } = extractViewItems(view);
    const page = parsed.page ?? 1;
    // 内核分页：请求 pageSize<1（含 -1）时使用视图默认页大小（view.pageSize）
    const effectivePageSize = (typeof parsed.pageSize === 'number' && parsed.pageSize > 0)
        ? parsed.pageSize
        : (typeof view?.pageSize === 'number' && view.pageSize > 0)
            ? view.pageSize
            : (rawRows.length || 1);
    const kernelPageCount = computeRenderPageCount(view, total, effectivePageSize);
    // 表格布局才构建归一化 table；data 用归一化行（避免原始行/table/view 三份重复）
    const isTableLayout = Array.isArray(view?.columns);
    const table = isTableLayout ? buildAvTableView(view as Record<string, unknown>, rawRows, total) : undefined;
    const data = table?.rows ?? rawRows;
    const result = createPaginatedResult(data, {
        total,
        page,
        pageSize: effectivePageSize,
        pageCount: kernelPageCount,
        hasNextPage: page < kernelPageCount,
    }, {
        ...responseObj,
        avID: effectiveAvID,
        id: effectiveAvID,
        ...(table ? { table } : {}),
        ...(parsed.createIfNotExist === true ? { generatedAvID: idWasGenerated } : {}),
        ...(permission.shouldMaterialize ? {
            materialized: true,
            blockID: materializedBlockID,
            parentID: parsed.blockID,
            databaseBlockRegistrationVerified: materializedBlockRegistered === true,
            ...(materializedBlockRegistered === false ? {
                warning: `Created attribute view "${effectiveAvID}" and materialized database block "${materializedBlockID}", but MCP could not verify mirror registration before the timeout. If the next AV write cannot resolve by avID yet, retry shortly or pass this blockID as explicit database-block context.`,
            } : {}),
        } : {}),
    });
    return permission.shouldMaterialize
        ? applyUiRefresh(client, result, [
            { type: 'reloadAttributeView', id: effectiveAvID },
            ...(permission.targetDocumentId ? [{ type: 'reloadProtyle' as const, id: permission.targetDocumentId }] : []),
        ])
        : result;
}

async function handleGetAttributeViewKeys({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetAttributeViewKeysSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;

    const raw = await avApi.getAttributeViewKeys(client, parsed.id);
    const keysArray =
        raw && typeof raw === 'object' && !Array.isArray(raw) &&
        Array.isArray((raw as Record<string, unknown>).keys)
            ? (raw as Record<string, unknown>).keys
            : Array.isArray(raw) && raw.length > 0
                ? raw
                : extractAttributeViewKeysFromData(avData);
    return createJsonResult({
        avID: parsed.id,
        keys: keysArray,
    });
}

async function handleGetAttributeViewFilterSort({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetAttributeViewFilterSortSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForAvId(client, permMgr, parsed.id, 'read');
    if (denied) return denied;

    const response = await avApi.getAttributeViewFilterSort(client, {
        id: parsed.id,
        blockID: parsed.blockID ?? '',
    });

    return createJsonResult({
        avID: parsed.id,
        ...(parsed.blockID ? { blockID: parsed.blockID } : {}),
        ...response,
    });
}

async function handleAddRows({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvAddRowsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'add_rows' });
    if (denied) return denied;

    const blockIDs = parsed.blockIDs ?? [];
    const primaryKeyTexts = parsed.primaryKeyTexts ?? [];
    if (blockIDs.length === 0 && primaryKeyTexts.length === 0) {
        return createWriteSuccessResult({
            action: 'add_rows',
            avID: parsed.avID,
            blockIDs: [],
            primaryKeyTexts: [],
            rows: [],
            added: 0,
            skipped: true,
            message: 'No blockIDs or primaryKeyTexts were provided, so no rows were added.',
        });
    }

    const detachedRows = primaryKeyTexts.map((primaryKeyText) => ({
        primaryKeyText,
        rowID: generateSiYuanNodeId(),
        srcID: generateSiYuanNodeId(),
    }));

    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const srcs = [
        ...blockIDs.map((id) => ({ itemID: generateSiYuanNodeId(), id, isDetached: false })),
        ...detachedRows.map((row) => ({
            itemID: row.rowID,
            id: row.srcID,
            isDetached: true,
            content: row.primaryKeyText,
        })),
    ];
    const updatedOps = withUpdatedOperation([{
        action: 'insertAttrViewBlock',
        avID: parsed.avID,
        blockID: transactionBlockID,
        viewID: parsed.viewID,
        groupID: parsed.groupID,
        previousID: parsed.previousID,
        ignoreDefaultFill: parsed.ignoreDefaultFill,
        srcs,
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: [
            {
                action: 'removeAttrViewBlock',
                srcIDs: [
                    ...blockIDs,
                    ...detachedRows.map((row) => row.rowID),
                ],
                avID: parsed.avID,
            },
            ...updatedOps.undoOperations,
        ],
    }]);

    const resolution = await waitForAddedRows(
        client,
        parsed.avID,
        blockIDs,
        detachedRows.map((row) => ({ primaryKeyText: row.primaryKeyText, rowID: row.rowID })),
    );
    if (resolution.unresolvedBlockIDs.length > 0 || (resolution.unresolvedRowIDs && resolution.unresolvedRowIDs.length > 0)) {
        return createAddRowsSyncTimeoutResult(parsed.avID, blockIDs, resolution, primaryKeyTexts);
    }

    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'add_rows',
        avID: parsed.avID,
        ...(blockIDs.length > 0 ? { blockIDs } : {}),
        ...(primaryKeyTexts.length > 0 ? { primaryKeyTexts } : {}),
        rows: resolution.rows,
        added: blockIDs.length + primaryKeyTexts.length,
    }), refreshOperations);
}

async function handleRemoveRows({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvRemoveRowsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'remove_rows' });
    if (denied) return denied;

    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'removeAttrViewBlock',
        srcIDs: parsed.srcIDs,
        avID: parsed.avID,
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: updatedOps.undoOperations,
    }]);
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'remove_rows',
        avID: parsed.avID,
        srcIDs: parsed.srcIDs,
        removed: parsed.srcIDs.length,
    }), refreshOperations);
}

async function handleAddColumn({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvAddColumnSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'add_column' });
    if (denied) return denied;

    const keyID = parsed.keyID ?? generateSiYuanNodeId();
    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'addAttrViewCol',
        name: parsed.keyName,
        avID: parsed.avID,
        type: parsed.keyType,
        id: keyID,
        data: parsed.keyIcon ?? '',
        previousID: parsed.previousKeyID ?? '',
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: [
            {
                action: 'removeAttrViewCol',
                id: keyID,
                avID: parsed.avID,
            },
            ...updatedOps.undoOperations,
        ],
    }]);
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'add_column',
        avID: parsed.avID,
        keyID,
        keyName: parsed.keyName,
        keyType: parsed.keyType,
    }), refreshOperations);
}

async function handleRemoveColumn({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvRemoveColumnSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'remove_column' });
    if (denied) return denied;
    const keyID = parsed.keyID ?? parsed.columnID!;

    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'removeAttrViewCol',
        id: keyID,
        avID: parsed.avID,
        removeDest: parsed.removeRelationDest ?? false,
    }], transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: updatedOps.undoOperations,
    }]);
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'remove_column',
        avID: parsed.avID,
        keyID,
        removeRelationDest: parsed.removeRelationDest ?? false,
    }), refreshOperations);
}

async function handleSetCells({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetCellsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'set_cells' });
    if (denied) return denied;
    const rowLookup = extractAvRowLookup(avData);
    const isSingleCellCall = !parsed.cells && !parsed.items;
    const items = parsed.cells ?? parsed.items ?? [{
        rowID: parsed.rowID!,
        columnID: parsed.columnID!,
        valueType: parsed.valueType!,
        text: parsed.text,
        number: parsed.number,
        numberFormat: parsed.numberFormat,
        date: parsed.date,
        endDate: parsed.endDate,
        includeTime: parsed.includeTime,
        checked: parsed.checked,
        option: parsed.option,
        options: parsed.options,
        relationBlockIDs: parsed.relationBlockIDs,
        url: parsed.url,
        email: parsed.email,
        phone: parsed.phone,
        assets: parsed.assets,
    }];

    if (items.some((item) => item.valueType === 'relation')) {
        // updateAttrViewCell alone authorizes only the source AV, while a
        // relation may mutate a reverse cell in another AV. Keep relation
        // writes on the dedicated action so it can preflight both carriers and
        // read back the complete relation graph instead of a scalar cell.
        return createAvValidationErrorResult('set_cells', {
            reason: 'relation_requires_set_relation',
            message: 'Relation cells must use av(action="set_relation").',
            hint: 'Pass source itemID, relation keyID, complete relatedItemIDs, and the verified source database block to set_relation. An empty relatedItemIDs array clears the relation.',
        });
    }

    const values: TransactionOperation[] = [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const validatedRowID = validateRowIdForAv(parsed.avID, 'set_cells', rowLookup, item.rowID, isSingleCellCall ? undefined : index);
        if (validatedRowID.ok === false) return validatedRowID.result;
        if (isSingleCellCall) {
            const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
            const updatedOps = withUpdatedOperation([{
                action: 'updateAttrViewCell',
                avID: parsed.avID,
                keyID: item.columnID,
                rowID: validatedRowID.rowID,
                data: buildStrongCellValue(item.columnID, validatedRowID.rowID, item),
            }], transactionBlockID);
            await transactionApi.performTransactions(client, [{
                doOperations: updatedOps.doOperations,
                undoOperations: updatedOps.undoOperations,
            }]);
            const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
            return applyUiRefresh(client, createWriteSuccessResult({
                action: 'set_cells',
                avID: parsed.avID,
                rowID: item.rowID,
                columnID: item.columnID,
                valueType: item.valueType,
            }), refreshOperations);
        }
        values.push({
            action: 'updateAttrViewCell',
            avID: parsed.avID,
            keyID: item.columnID,
            rowID: validatedRowID.rowID,
            data: buildStrongCellValue(item.columnID, validatedRowID.rowID, item),
        });
    }
    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation(values, transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: updatedOps.undoOperations,
    }]);

    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'set_cells',
        avID: parsed.avID,
        updated: items.length,
    }), refreshOperations);
}

async function handleSetColumnOptions({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetColumnOptionsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'set_column_options' });
    if (denied) return denied;

    const key = getAvKeyById(avData, parsed.keyID);
    if (!key) {
        return createAvFieldValidationResult('set_column_options', parsed.avID, parsed.keyID,
            `keyID "${parsed.keyID}" does not exist in attribute view "${parsed.avID}".`);
    }
    const keyType = getStringField(key, ['type']);
    if (keyType !== 'select' && keyType !== 'mSelect') {
        return createAvFieldValidationResult('set_column_options', parsed.avID, parsed.keyID,
            `keyID "${parsed.keyID}" has type "${keyType ?? 'unknown'}". set_column_options only supports select and mSelect columns.`);
    }

    const options = normalizeSelectOptions(parsed.options as Array<Record<string, unknown>>);
    const beforeOptions = comparableSelectOptions(key.options) ?? [];
    const desiredNames = new Set(options.map((option) => String(option.name)));
    const optionsToRemove = beforeOptions
        .map((option) => option.name)
        .filter((name) => !desiredNames.has(name));
    if (sameComparableOptions(beforeOptions, comparableSelectOptions(options) ?? [])) {
        return createWriteSuccessResult({
            action: 'set_column_options',
            avID: parsed.avID,
            keyID: parsed.keyID,
            optionCount: options.length,
            changed: false,
            semantics: 'complete_option_list_replacement',
            status: 'already_applied',
            observedOptions: beforeOptions,
        });
    }
    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const operations: TransactionOperation[] = [
        ...(options.length > 0 ? [{
            action: 'updateAttrViewColOptions',
            avID: parsed.avID,
            id: parsed.keyID,
            data: options,
        }] : []),
        ...optionsToRemove.map((name) => ({
            action: 'removeAttrViewColOption',
            avID: parsed.avID,
            id: parsed.keyID,
            data: name,
        })),
    ];
    const updatedOps = withUpdatedOperation(operations, transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: updatedOps.undoOperations,
    }]);

    // The kernel may acknowledge an options write before its derived select
    // groups have caught up. Read exactly once here to prove the requested
    // definition changed without allowing unrelated AV configuration to drift.
    // A known "new names appended" intermediate is reported, never repaired by
    // a hidden second write; the caller must make a fresh strict preflight.
    const readback = await avApi.getAttributeView(client, parsed.avID);
    const readbackKey = getAvKeyById(readback.av, parsed.keyID);
    const expectedOptions = comparableSelectOptions(options);
    const actualOptions = comparableSelectOptions(readbackKey?.options, expectedOptions?.length === 0);
    if (!expectedOptions || !actualOptions) {
        throw new Error(`Select option readback for key "${parsed.keyID}" was incomplete.`);
    }
    // Raw AV JSON preserves Go's struct-field order. The native option save
    // may materialize target key.options between existing fields, whereas the
    // preimage projection adds its sentinel at the end. Those two objects have
    // the same protected state; comparing JSON.stringify would turn property
    // insertion order alone into outcome_unknown. Canonicalization sorts only
    // object keys, so arrays and every non-target field remain exact collateral
    // evidence and still reject a real unrelated mutation.
    if (canonicalizeState(projectAvStateWithoutColumnOptions(avData, parsed.keyID, optionsToRemove))
        !== canonicalizeState(projectAvStateWithoutColumnOptions(readback.av, parsed.keyID, optionsToRemove))) {
        throw new Error(`Unrelated AV state changed while replacing options for key "${parsed.keyID}".`);
    }
    const exactOrder = sameComparableOptions(expectedOptions, actualOptions);
    const appendOnlyIntermediate = !exactOrder && sameComparableOptionSet(expectedOptions, actualOptions);
    if (!exactOrder && !appendOnlyIntermediate) {
        throw new Error(`Select option readback for key "${parsed.keyID}" does not match the complete requested option list.`);
    }

    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'set_column_options',
        avID: parsed.avID,
        keyID: parsed.keyID,
        optionCount: options.length,
        semantics: 'complete_option_list_replacement',
        ...(appendOnlyIntermediate ? {
            status: 'intermediate_option_order',
            observedOptions: actualOptions,
            message: 'SiYuan accepted the full option set but retained its append order for new names. No second write was sent; run a new strict preflight before an explicit reorder request.',
        } : { status: 'applied', observedOptions: actualOptions }),
    }), refreshOperations);
}

async function handleDuplicateRows({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvDuplicateRowsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'duplicate_rows' });
    if (denied) return denied;

    const rowLookup = extractAvRowLookup(avData);
    const persistentTopLevelRows = topLevelViewItemIDs(avData);
    for (let index = 0; index < parsed.sourceRowIDs.length; index += 1) {
        const sourceRowID = parsed.sourceRowIDs[index];
        const checked = validateRowIdForAv(parsed.avID, 'duplicate_rows', rowLookup, sourceRowID, index);
        if (checked.ok === false) return checked.result;
        const row = rowLookup.rows.find((candidate) => candidate.rowID === sourceRowID);
        if (!row || !row.sourceBlockID || row.isDetached === true) {
            return createDuplicateRowsValidationResult(parsed.avID, sourceRowID,
                `sourceRowID "${sourceRowID}" must be a bound AV row. SiYuan duplicateAttrViewRow creates a detached text record and is not exposed for detached source rows.`);
        }
        if (!persistentTopLevelRows.has(sourceRowID)) {
            return createDuplicateRowsValidationResult(parsed.avID, sourceRowID,
                `sourceRowID "${sourceRowID}" is not present in a persistent top-level AV view and cannot be copied safely.`);
        }
    }
    if (parsed.previousID) {
        const checked = validateRowIdForAv(parsed.avID, 'duplicate_rows', rowLookup, parsed.previousID);
        if (checked.ok === false) return checked.result;
    }

    const relationDestinations = await resolveDuplicateRowsRelationDestinations(
        client,
        permMgr,
        parsed.avID,
        avData,
        parsed.sourceRowIDs,
    );
    if (relationDestinations.denied) return relationDestinations.denied;

    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    let previousID = parsed.previousID ?? '';
    const createdRowIDs: string[] = [];
    const operations: TransactionOperation[] = [];
    for (const sourceRowID of parsed.sourceRowIDs) {
        const rowID = generateSiYuanNodeId();
        createdRowIDs.push(rowID);
        operations.push({
            action: 'duplicateAttrViewRow',
            avID: parsed.avID,
            id: rowID,
            srcIDs: [sourceRowID],
            previousID,
        });
        previousID = rowID;
    }
    const updatedOps = withUpdatedOperation(operations, transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: [
            {
                action: 'removeAttrViewBlock',
                avID: parsed.avID,
                srcIDs: createdRowIDs,
            },
            ...updatedOps.undoOperations,
        ],
    }]);

    // A transport error intentionally reaches the single strict coordinator:
    // it records outcome_unknown and never resends duplicateAttrViewRow. Only
    // a normal transaction response reaches this bounded, exact source and
    // reverse-relation readback.
    const sourceReadback = await avApi.getAttributeView(client, parsed.avID);
    const sourceError = verifyDuplicateRowsSourceReadback(
        avData,
        sourceReadback.av,
        parsed.sourceRowIDs,
        createdRowIDs,
        parsed.previousID,
    );
    if (sourceError) throw new Error(sourceError);
    const destinationReadbacks = new Map<string, unknown>();
    for (const destination of relationDestinations.destinations) {
        destinationReadbacks.set(destination.avID, (await avApi.getAttributeView(client, destination.avID)).av);
    }
    const relationError = verifyDuplicateRowsRelationDestinations(
        relationDestinations.destinations,
        createdRowIDs,
        destinationReadbacks,
    );
    if (relationError) throw new Error(relationError);

    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'duplicate_rows',
        avID: parsed.avID,
        sourceRowIDs: parsed.sourceRowIDs,
        rowIDs: createdRowIDs,
        copied: createdRowIDs.length,
        relationDestinationAVIDs: relationDestinations.destinations.map((destination) => destination.avID),
        semantics: 'detached_row_copies_with_verified_source_and_two_way_relation_readback',
    }), refreshOperations);
}

// Template, relation, and rollup writes remain separate from the scalar and
// view handlers above. Their native endpoints can alter a second AV or create
// a bound document, so every path below keeps complete raw readback and never
// converts an unknown transport response into a replayed write.
async function handleSetNewItemTemplates({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetNewItemTemplatesSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_new_item_templates',
    });
    if (denied) return denied;

    const definition = asAttributeViewDefinition(avData, parsed.avID);
    const expectedTemplates = parsed.templates.map((template) => normalizeTemplateForKernel(template, definition, 'set_new_item_templates'));
    try {
        validateCompleteTemplateConfiguration(definition, expectedTemplates, parsed.defaultTemplateID, 'set_new_item_templates');
    } catch (error) {
        return createAvValidationErrorResult('set_new_item_templates', {
            reason: 'template_configuration_invalid',
            message: error instanceof Error ? error.message : String(error),
            hint: 'Every template field must match a currently existing AV key and select/mSelect options must already exist. SiYuan currently prunes unknown options during creation without a warning, so Sisyphus refuses this unsafe configuration instead of adding options automatically.',
        });
    }
    const expected = { templates: expectedTemplates, defaultTemplateID: parsed.defaultTemplateID };
    const observed = templateConfigProjection(
        definition,
        definition.newItemTemplates,
        definition.defaultTemplateID,
        'set_new_item_templates preflight',
    );
    const expectedConfigHash = await templateConfigHash(expected);
    const observedConfigHash = await templateConfigHash(observed);
    if (observedConfigHash === expectedConfigHash) {
        return createWriteSuccessResult({
            action: 'set_new_item_templates',
            avID: parsed.avID,
            templateCount: expected.templates.length,
            defaultTemplateID: expected.defaultTemplateID,
            changed: false,
            status: 'already_applied',
            templatePreimageHash: await rawTemplateConfigHash(definition),
            templatePostimageHash: await rawTemplateConfigHash(definition),
        });
    }
    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'setAttrViewNewItemTemplates',
        avID: parsed.avID,
        blockID: parsed.blockID,
        data: expected,
    }], transactionBlockID);

    const verifyExactPostimage = async (): Promise<{ definition: AttributeViewDefinition; config: { templates: Record<string, unknown>[]; defaultTemplateID: string } }> => {
        const after = await readTemplateConfig(client, parsed.avID, 'set_new_item_templates readback');
        if (await templateConfigHash(after.config) !== await templateConfigHash(expected)) {
            throw new Error(`set_new_item_templates: complete template order, defaults, or defaultTemplateID readback did not match the requested postimage for AV "${parsed.avID}".`);
        }
        return after;
    };

    try {
        await transactionApi.performTransactions(client, [{
            doOperations: updatedOps.doOperations,
            // A complete replacement may cross a concurrent template edit. The
            // strict preflight protects its preimage; do not fabricate a lossy
            // undo operation that could erase another template field.
            undoOperations: updatedOps.undoOperations,
        }]);
    } catch (error) {
        // A matching readback cannot prove this request wrote it: another
        // actor may have installed the postimage before dispatch. No native
        // request marker survives here, so strict mode must record unknown.
        throw error;
    }
    const after = await verifyExactPostimage();
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'set_new_item_templates',
        avID: parsed.avID,
        templateCount: expected.templates.length,
        defaultTemplateID: expected.defaultTemplateID,
        templatePreimageHash: await rawTemplateConfigHash(definition),
        templatePostimageHash: await rawTemplateConfigHash(after.definition),
    }), refreshOperations);
}

async function templateConfigHash(config: { templates: Record<string, unknown>[]; defaultTemplateID: string }): Promise<string> {
    return hashCanonicalState({ templates: config.templates, defaultTemplateID: config.defaultTemplateID });
}

async function rawTemplateConfigHash(definition: AttributeViewDefinition): Promise<string> {
    // Report complete native state, not a handler-specific projection. The
    // projection is used only for the documented empty-map serialization.
    return hashCanonicalState({ templates: definition.newItemTemplates, defaultTemplateID: definition.defaultTemplateID });
}

async function readTemplateConfig(
    client: SiYuanClient,
    avID: string,
    context: string,
): Promise<{ definition: AttributeViewDefinition; config: { templates: Record<string, unknown>[]; defaultTemplateID: string } }> {
    const definition = asAttributeViewDefinition((await avApi.getAttributeView(client, avID)).av, avID);
    return { definition, config: templateConfigProjection(definition, definition.newItemTemplates, definition.defaultTemplateID, context) };
}

function relationCellValue(itemIDs: string[]): Record<string, unknown> {
    return {
        type: 'relation',
        relation: {
            // Kernel calls this blockIDs, but the values are AV item IDs. A
            // bound document block ID would make a cross-AV relation unsafe.
            blockIDs: itemIDs,
            contents: null,
        },
    };
}

async function readRelationPostimage(
    client: SiYuanClient,
    sourceAvID: string,
    sourceKeyID: string,
    sourceItemID: string,
    expectedItemIDs: string[],
    destinationAvID: string,
    backKeyID: string | undefined,
    priorItemIDs: string[],
    context: string,
): Promise<{ source: AttributeViewDefinition; destination: AttributeViewDefinition }> {
    const source = asAttributeViewDefinition((await avApi.getAttributeView(client, sourceAvID)).av, sourceAvID);
    const sourceActual = extractRelationCellItemIDs(source, sourceKeyID, sourceItemID, context);
    if (!sameIdSet(sourceActual, expectedItemIDs)) {
        throw new Error(`${context}: source relation readback did not match the complete requested itemID set.`);
    }
    const destination = asAttributeViewDefinition((await avApi.getAttributeView(client, destinationAvID)).av, destinationAvID);
    if (!backKeyID) return { source, destination };
    for (const destinationItemID of normalizeIdSet([...priorItemIDs, ...expectedItemIDs])) {
        const reverseItemIDs = extractRelationCellItemIDs(destination, backKeyID, destinationItemID, context);
        const shouldContainSource = expectedItemIDs.includes(destinationItemID);
        if (reverseItemIDs.includes(sourceItemID) !== shouldContainSource) {
            throw new Error(`${context}: two-way reverse relation readback did not ${shouldContainSource ? 'add' : 'clear'} source itemID for destination item "${destinationItemID}".`);
        }
    }
    return { source, destination };
}

async function handleSetRelation({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetRelationSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_relation',
    });
    if (denied) return denied;
    const source = asAttributeViewDefinition(avData, parsed.avID);
    const sourceLookup = extractAvRowLookup(source);
    if (!sourceLookup.rowIDs.has(parsed.itemID)) {
        return createAvValidationErrorResult('set_relation', {
            reason: 'source_item_not_found',
            message: `itemID "${parsed.itemID}" is not an AV row item ID in source AV "${parsed.avID}".`,
            hint: 'Use the row item ID stored in value.blockID, not the bound document block.id and not a cell value id.',
        });
    }

    let target: { destinationAvID: string; backKeyID?: string; destination: AttributeViewDefinition };
    let priorItemIDs: string[];
    try {
        priorItemIDs = extractRelationCellItemIDs(source, parsed.keyID, parsed.itemID, 'set_relation preflight');
        target = await requireWritableRelationDestinations(client, permMgr, source, parsed.keyID, parsed.relatedItemIDs, 'set_relation preflight');
    } catch (error) {
        return createAvValidationErrorResult('set_relation', {
            reason: 'relation_preflight_failed',
            message: error instanceof Error ? error.message : String(error),
        });
    }

    const verifyExactPostimage = () => readRelationPostimage(
        client, parsed.avID, parsed.keyID, parsed.itemID, parsed.relatedItemIDs,
        target.destinationAvID, target.backKeyID, priorItemIDs, 'set_relation readback',
    );
    try {
        const observed = await verifyExactPostimage();
        return createWriteSuccessResult({
            action: 'set_relation', avID: parsed.avID, keyID: parsed.keyID, itemID: parsed.itemID,
            destinationAvID: target.destinationAvID, relatedItemIDs: parsed.relatedItemIDs,
            cleared: parsed.relatedItemIDs.length === 0,
            changed: false,
            status: 'already_applied',
            sourcePreimageHash: await hashCanonicalState(observed.source),
            sourcePostimageHash: await hashCanonicalState(observed.source),
            destinationPreimageHash: await hashCanonicalState(observed.destination),
            destinationPostimageHash: await hashCanonicalState(observed.destination),
            ...(target.backKeyID ? { backRelationKeyID: target.backKeyID, reverseReadback: 'verified' } : {}),
        });
    } catch {
        // The expected relation postimage is not established yet. Continue to
        // one native write; a response failure below deliberately reaches the
        // coordinator as outcome_unknown because raw state has no request ID.
    }
    await avApi.setAttributeViewBlockAttr(client, {
        avID: parsed.avID,
        keyID: parsed.keyID,
        itemID: parsed.itemID,
        value: relationCellValue(parsed.relatedItemIDs),
    });
    const after = await verifyExactPostimage();
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'set_relation', avID: parsed.avID, keyID: parsed.keyID, itemID: parsed.itemID,
        destinationAvID: target.destinationAvID, relatedItemIDs: parsed.relatedItemIDs,
        cleared: parsed.relatedItemIDs.length === 0,
        sourcePreimageHash: await hashCanonicalState(source),
        sourcePostimageHash: await hashCanonicalState(after.source),
        destinationPreimageHash: await hashCanonicalState(target.destination),
        destinationPostimageHash: await hashCanonicalState(after.destination),
        ...(target.backKeyID ? { backRelationKeyID: target.backKeyID, reverseReadback: 'verified' } : {}),
    }), refreshOperations);
}

async function handleConfigureTwoWayRelation({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvConfigureTwoWayRelationSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'configure_two_way_relation',
    });
    if (denied) return denied;
    const source = asAttributeViewDefinition(avData, parsed.avID);
    let destination: AttributeViewDefinition;
    let sourceRelation: RelationMetadata | undefined;
    try {
        const sourceKey = getAvKey(source, parsed.keyID, 'configure_two_way_relation preflight');
        if (sourceKey.type !== 'relation') throw new Error(`configure_two_way_relation preflight: keyID "${parsed.keyID}" is not a relation key.`);
        sourceRelation = maybeRelationMetadata(sourceKey);
        if (sourceRelation?.avID && sourceRelation.avID !== parsed.destinationAvID) {
            throw new Error(`configure_two_way_relation preflight: existing source relation targets "${sourceRelation.avID}"; retargeting would mutate an unpreflighted third AV.`);
        }
        destination = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.destinationAvID)).av, parsed.destinationAvID);
        const destinationCarrier = await resolveVerifiedAvCarrier(client, parsed.destinationAvID, destination, parsed.destinationBlockID);
        if (!destinationCarrier) throw new Error(`configure_two_way_relation preflight: destination AV "${parsed.destinationAvID}" has no verified database carrier.`);
        const permission = await ensurePermissionForDocumentId(client, permMgr, destinationCarrier, 'write');
        if (permission.denied) return permission.denied;
    } catch (error) {
        return createAvValidationErrorResult('configure_two_way_relation', {
            reason: 'two_way_relation_preflight_failed',
            message: error instanceof Error ? error.message : String(error),
        });
    }

    const expected = {
        sourceAvID: parsed.avID, sourceKeyID: parsed.keyID, destinationAvID: parsed.destinationAvID,
        backRelationKeyID: parsed.backRelationKeyID, sourceName: parsed.sourceName, destinationName: parsed.destinationName,
    };
    const alreadyApplied = (() => {
        try {
            verifyTwoWayRelationMetadata(source, destination!, expected, 'configure_two_way_relation preflight');
            return true;
        } catch {
            return false;
        }
    })();
    if (alreadyApplied) {
        return createWriteSuccessResult({
            action: 'configure_two_way_relation',
            ...expected,
            changed: false,
            status: 'already_applied',
            sourcePreimageHash: await hashCanonicalState(source),
            sourcePostimageHash: await hashCanonicalState(source),
            destinationPreimageHash: await hashCanonicalState(destination!),
            destinationPostimageHash: await hashCanonicalState(destination!),
            ...(sourceRelation?.avID ? { priorDestinationAvID: sourceRelation.avID } : {}),
        });
    }
    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'updateAttrViewColRelation', avID: parsed.avID, keyID: parsed.keyID, id: parsed.destinationAvID,
        backRelationKeyID: parsed.backRelationKeyID, isTwoWay: true,
        name: parsed.destinationName, format: parsed.sourceName,
    }], transactionBlockID);
    const verifyExactPostimage = async (): Promise<{ source: AttributeViewDefinition; destination: AttributeViewDefinition }> => {
        const actualSource = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.avID)).av, parsed.avID);
        const actualDestination = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.destinationAvID)).av, parsed.destinationAvID);
        verifyTwoWayRelationMetadata(actualSource, actualDestination, expected, 'configure_two_way_relation readback');
        return { source: actualSource, destination: actualDestination };
    };
    try {
        await transactionApi.performTransactions(client, [{ doOperations: updatedOps.doOperations, undoOperations: updatedOps.undoOperations }]);
    } catch (error) {
        // Exact source/destination state is not a request-specific marker.
        // Preserve a lost response so the strict coordinator fails closed.
        throw error;
    }
    const after = await verifyExactPostimage();
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'configure_two_way_relation', ...expected,
        sourcePreimageHash: await hashCanonicalState(source), sourcePostimageHash: await hashCanonicalState(after.source),
        destinationPreimageHash: await hashCanonicalState(destination), destinationPostimageHash: await hashCanonicalState(after.destination),
        ...(sourceRelation?.avID ? { priorDestinationAvID: sourceRelation.avID } : {}),
    }), refreshOperations);
}

function getRelationMetadata(key: AvKeyDefinition, context: string): Record<string, unknown> {
    if (key.type !== 'relation' || !key.relation || typeof key.relation !== 'object' || Array.isArray(key.relation)) {
        throw new Error(`${context}: key is not a relation with native metadata.`);
    }
    return key.relation as Record<string, unknown>;
}

function maybeRelationMetadata(key: AvKeyDefinition): Record<string, unknown> | undefined {
    return key.type === 'relation' && key.relation && typeof key.relation === 'object' && !Array.isArray(key.relation)
        ? key.relation as Record<string, unknown>
        : undefined;
}

function verifyTwoWayRelationMetadata(
    source: AttributeViewDefinition,
    destination: AttributeViewDefinition,
    expected: { sourceAvID: string; sourceKeyID: string; destinationAvID: string; backRelationKeyID: string; sourceName: string; destinationName: string },
    context: string,
): void {
    const sourceKey = getAvKey(source, expected.sourceKeyID, context);
    const sourceRelation = getRelationMetadata(sourceKey, context);
    if (sourceKey.name !== expected.sourceName || sourceRelation.avID !== expected.destinationAvID || sourceRelation.backKeyID !== expected.backRelationKeyID || sourceRelation.isTwoWay !== true) {
        throw new Error(`${context}: source relation metadata does not match the requested two-way postimage.`);
    }
    const backKey = getAvKey(destination, expected.backRelationKeyID, context);
    const backRelation = getRelationMetadata(backKey, context);
    if (backKey.name !== expected.destinationName || backRelation.avID !== expected.sourceAvID || backRelation.backKeyID !== expected.sourceKeyID || backRelation.isTwoWay !== true) {
        throw new Error(`${context}: destination reverse relation metadata does not match the requested two-way postimage.`);
    }
}

async function handleConfigureRollup({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvConfigureRollupSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'configure_rollup',
    });
    if (denied) return denied;
    const source = asAttributeViewDefinition(avData, parsed.avID);
    let relationDestinationAvID: string;
    try {
        const rollupKey = getAvKey(source, parsed.keyID, 'configure_rollup preflight');
        if (rollupKey.type !== 'rollup') throw new Error(`configure_rollup preflight: keyID "${parsed.keyID}" is not a rollup key.`);
        const relationKey = getAvKey(source, parsed.relationKeyID, 'configure_rollup preflight');
        const relation = getRelationMetadata(relationKey, 'configure_rollup preflight');
        if (typeof relation.avID !== 'string' || !ATTRIBUTE_VIEW_ID_PATTERN.test(relation.avID)) throw new Error('configure_rollup preflight: relation key has no valid destination AV ID.');
        relationDestinationAvID = relation.avID;
        const destination = asAttributeViewDefinition((await avApi.getAttributeView(client, relationDestinationAvID)).av, relationDestinationAvID);
        getAvKey(destination, parsed.destinationKeyID, 'configure_rollup preflight');
        const carrier = await resolveVerifiedAvCarrier(client, relationDestinationAvID, destination);
        if (!carrier) throw new Error(`configure_rollup preflight: destination AV "${relationDestinationAvID}" has no verified database carrier.`);
        const permission = await ensurePermissionForDocumentId(client, permMgr, carrier, 'read');
        if (permission.denied) return permission.denied;
    } catch (error) {
        return createAvValidationErrorResult('configure_rollup', {
            reason: 'rollup_preflight_failed', message: error instanceof Error ? error.message : String(error),
        });
    }

    const alreadyApplied = await (async () => {
        try {
            await verifyRollupMetadata(source, parsed.keyID, parsed.relationKeyID, parsed.destinationKeyID, parsed.calc, 'configure_rollup preflight');
            return true;
        } catch {
            return false;
        }
    })();
    if (alreadyApplied) {
        return createWriteSuccessResult({
            action: 'configure_rollup',
            avID: parsed.avID,
            keyID: parsed.keyID,
            relationKeyID: parsed.relationKeyID,
            destinationAvID: relationDestinationAvID!,
            destinationKeyID: parsed.destinationKeyID,
            calc: parsed.calc,
            changed: false,
            status: 'already_applied',
            sourcePreimageHash: await hashCanonicalState(source),
            sourcePostimageHash: await hashCanonicalState(source),
            nativeFilterSideEffect: 'filters referencing this rollup key may be removed by SiYuan',
        });
    }

    const transactionBlockID = await resolveAvTransactionBlockId(client, parsed.avID, avData, parsed.blockID);
    const updatedOps = withUpdatedOperation([{
        action: 'updateAttrViewColRollup', id: parsed.keyID, avID: parsed.avID,
        parentID: parsed.relationKeyID, keyID: parsed.destinationKeyID, data: { calc: parsed.calc },
    }], transactionBlockID);
    const verifyExactPostimage = async (): Promise<AttributeViewDefinition> => {
        const actual = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.avID)).av, parsed.avID);
        await verifyRollupMetadata(actual, parsed.keyID, parsed.relationKeyID, parsed.destinationKeyID, parsed.calc, 'configure_rollup readback');
        return actual;
    };
    try {
        await transactionApi.performTransactions(client, [{ doOperations: updatedOps.doOperations, undoOperations: updatedOps.undoOperations }]);
    } catch (error) {
        // The native rollup definition has no request identity. It may equal
        // the postimage before this call, so a transport error stays unknown.
        throw error;
    }
    const after = await verifyExactPostimage();
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'configure_rollup', avID: parsed.avID, keyID: parsed.keyID, relationKeyID: parsed.relationKeyID,
        destinationAvID: relationDestinationAvID!, destinationKeyID: parsed.destinationKeyID, calc: parsed.calc,
        sourcePreimageHash: await hashCanonicalState(source), sourcePostimageHash: await hashCanonicalState(after),
        nativeFilterSideEffect: 'filters referencing this rollup key may be removed by SiYuan',
    }), refreshOperations);
}

async function verifyRollupMetadata(
    definition: AttributeViewDefinition,
    keyID: string,
    relationKeyID: string,
    destinationKeyID: string,
    calc: Record<string, unknown>,
    context: string,
): Promise<void> {
    const key = getAvKey(definition, keyID, context);
    if (key.type !== 'rollup' || !key.rollup || typeof key.rollup !== 'object' || Array.isArray(key.rollup)) {
        throw new Error(`${context}: rollup key is missing native rollup metadata.`);
    }
    const rollup = key.rollup as Record<string, unknown>;
    if (rollup.relationKeyID !== relationKeyID || rollup.keyID !== destinationKeyID
        || await hashCanonicalState(rollupCalcConfiguration(rollup.calc)) !== await hashCanonicalState(rollupCalcConfiguration(calc))) {
        throw new Error(`${context}: native rollup metadata did not match relationKeyID, destinationKeyID, and calc postimage.`);
    }
}

function rollupCalcConfiguration(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const calc = cloneJsonRecord(value as Record<string, unknown>);
    // The official UI submits only the operator, while SiYuan v3.8's Go
    // RollupCalc struct deterministically serializes its missing result as
    // `result: null`. Normalize only that wire default. A non-null result or
    // any other calc field remains part of strict comparison so an unexpected
    // native shape cannot be certified as the requested configuration.
    if (calc.result === null) delete calc.result;
    return calc;
}

async function handleCreateFromTemplate({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvCreateFromTemplateSchema.parse(rawArgs);
    const sourcePermission = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'create_from_template',
    });
    if (sourcePermission.denied) return sourcePermission.denied;
    const source = asAttributeViewDefinition(sourcePermission.avData, parsed.avID);
    let template: Record<string, unknown>;
    const relationTargets = new Map<string, { destinationAvID: string; backKeyID?: string; destination: AttributeViewDefinition; relatedItemIDs: string[] }>();
    try {
        template = getTemplate(source, parsed.templateID, 'create_from_template preflight');
        validateTemplateFieldValues(source, template, 'create_from_template preflight');
        const fieldValues = template.fieldValues;
        if (fieldValues && typeof fieldValues === 'object' && !Array.isArray(fieldValues)) {
            for (const [keyID, rawFieldValue] of Object.entries(fieldValues as Record<string, unknown>)) {
                const fieldValue = rawFieldValue && typeof rawFieldValue === 'object' && !Array.isArray(rawFieldValue) ? rawFieldValue as Record<string, unknown> : undefined;
                const value = fieldValue?.value;
                if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).type !== 'relation') continue;
                const relation = (value as Record<string, unknown>).relation;
                const relatedItemIDs = relation && typeof relation === 'object' && !Array.isArray(relation) && Array.isArray((relation as Record<string, unknown>).blockIDs)
                    ? (relation as Record<string, unknown>).blockIDs as string[] : [];
                const target = await requireWritableRelationDestinations(client, permMgr, source, keyID, relatedItemIDs, 'create_from_template preflight');
                relationTargets.set(keyID, { ...target, relatedItemIDs });
            }
        }
        if (template.targetType === 'document') {
            const saveLocation = template.saveLocation;
            if (!saveLocation || typeof saveLocation !== 'object' || Array.isArray(saveLocation)) throw new Error('Document template inherits SiYuan global document-create location, so its target notebook cannot be preflighted. Give this native template an explicit saveLocation before calling create_from_template.');
            const sourceContext = await ensurePermissionForDocumentId(client, permMgr, parsed.blockID, 'write');
            if (sourceContext.denied) return sourceContext.denied;
            const requestedBoxID = (saveLocation as Record<string, unknown>).boxID;
            const targetNotebookID = typeof requestedBoxID === 'string' && requestedBoxID.trim() ? requestedBoxID.trim() : sourceContext.context.notebook;
            const destinationDenied = await ensurePermissionForNotebook(permMgr, targetNotebookID, 'write');
            if (destinationDenied) return destinationDenied;
        }
    } catch (error) {
        return createAvValidationErrorResult('create_from_template', {
            reason: 'template_create_preflight_failed', message: error instanceof Error ? error.message : String(error),
            hint: 'The wrapper creates only fully preflighted native templates. It does not add missing options, infer a global document location, or treat an AV itemID as a document blockID.',
        });
    }

    // currentTime is materialized by the SiYuan kernel. Use the same remote
    // clock for readback so a standalone/remote MCP process cannot reject a
    // successful create merely because its local clock runs ahead. Static-only
    // templates do not need the extra system request.
    const templateFields = template.fieldValues && typeof template.fieldValues === 'object' && !Array.isArray(template.fieldValues)
        ? Object.values(template.fieldValues as Record<string, unknown>)
        : [];
    const hasCurrentTimeField = templateFields.some((field) => Boolean(
        field && typeof field === 'object' && !Array.isArray(field) && (field as Record<string, unknown>).mode === 'currentTime',
    ));
    const createdAfterMs = hasCurrentTimeField ? await systemApi.getCurrentTime(client) : Number.NEGATIVE_INFINITY;
    const response = await avApi.createAttributeViewItem(client, {
        avID: parsed.avID, blockID: parsed.blockID, viewID: parsed.viewID, templateID: parsed.templateID,
        previousID: parsed.previousID, groupID: parsed.groupID,
    });
    if (!response.itemID || !response.blockID || typeof response.isDetached !== 'boolean') throw new Error(`create_from_template: native endpoint returned incomplete itemID/blockID identity for AV "${parsed.avID}".`);

    const after = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.avID)).av, parsed.avID);
    const createdLookup = extractAvRowLookup(after);
    if (!createdLookup.rowIDs.has(response.itemID)) throw new Error(`create_from_template readback: returned itemID "${response.itemID}" is not a raw AV row item.`);
    const boundBlockID = getBoundBlockIDForItem(after, response.itemID, 'create_from_template readback');
    if (boundBlockID !== response.blockID) throw new Error('create_from_template readback: native returned blockID differs from the row bound block identity.');
    await verifyCreatedTemplateFieldValues(after, template, response.itemID, createdAfterMs, 'create_from_template readback');
    for (const [keyID, target] of relationTargets) {
        await readRelationPostimage(client, parsed.avID, keyID, response.itemID, target.relatedItemIDs, target.destinationAvID, target.backKeyID, [], 'create_from_template relation readback');
    }
    if (response.isDetached) {
        if (response.blockID !== response.itemID) throw new Error('create_from_template readback: detached template returned a distinct document blockID.');
    } else {
        if (response.blockID === response.itemID || !await blockApi.checkBlockExist(client, response.blockID)) throw new Error('create_from_template readback: document template did not materialize its returned bound document block.');
        const hPath = await documentApi.getHPathByID(client, response.blockID);
        if (!hPath || (response.content && !hPath.endsWith(`/${response.content}`))) throw new Error('create_from_template readback: returned document content did not match its persisted document path.');
    }
    const refreshOperations = await resolveAvWriteRefreshOperations(client, parsed.avID, sourcePermission.avData, parsed.blockID);
    return applyUiRefresh(client, createWriteSuccessResult({
        action: 'create_from_template', avID: parsed.avID, templateID: parsed.templateID, itemID: response.itemID,
        blockID: response.blockID, isDetached: response.isDetached, content: response.content, fieldReadback: 'verified',
        ...(relationTargets.size > 0 ? { relationReadback: 'verified' } : {}),
        ...(response.warnings && response.warnings.length > 0 ? { warnings: response.warnings } : {}),
    }), refreshOperations);
}

function getCellValueForItem(definition: AttributeViewDefinition, keyID: string, itemID: string, context: string): Record<string, unknown> {
    const matches = getAvKeyValue(definition, keyID, context).values.filter((value) => value.blockID === itemID);
    if (matches.length !== 1) throw new Error(`${context}: key "${keyID}" did not return exactly one value for AV itemID "${itemID}".`);
    return matches[0];
}

function getBoundBlockIDForItem(definition: AttributeViewDefinition, itemID: string, context: string): string {
    const blockKeyValue = (definition.keyValues ?? []).find((entry): entry is AvKeyValueDefinition => Boolean(
        entry && typeof entry === 'object' && !Array.isArray(entry)
            && (entry as { key?: unknown; values?: unknown }).key && typeof (entry as { key?: unknown }).key === 'object'
            && ((entry as { key?: Record<string, unknown> }).key?.type === 'block')
            && Array.isArray((entry as { values?: unknown }).values),
    ));
    if (!blockKeyValue) throw new Error(`${context}: AV has no block primary-key definition.`);
    const cell = blockKeyValue.values.find((value) => value.blockID === itemID);
    const boundID = cell?.block && typeof cell.block === 'object' && !Array.isArray(cell.block)
        ? (cell.block as Record<string, unknown>).id : undefined;
    if (typeof boundID !== 'string' || !boundID) throw new Error(`${context}: AV itemID "${itemID}" has no bound block identity.`);
    return boundID;
}

async function verifyCreatedTemplateFieldValues(
    definition: AttributeViewDefinition,
    template: Record<string, unknown>,
    itemID: string,
    createdAfterMs: number,
    context: string,
): Promise<void> {
    const fieldValues = template.fieldValues;
    if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) return;
    for (const [keyID, rawFieldValue] of Object.entries(fieldValues as Record<string, unknown>)) {
        if (!rawFieldValue || typeof rawFieldValue !== 'object' || Array.isArray(rawFieldValue)) continue;
        const fieldValue = rawFieldValue as Record<string, unknown>;
        const key = getAvKey(definition, keyID, context);
        if (key.type === 'relation' && fieldValue.value && typeof fieldValue.value === 'object' && !Array.isArray(fieldValue.value)) {
            const relation = (fieldValue.value as Record<string, unknown>).relation;
            const ids = relation && typeof relation === 'object' && !Array.isArray(relation) ? (relation as Record<string, unknown>).blockIDs : undefined;
            if (Array.isArray(ids) && ids.length === 0) continue;
        }
        const actual = getCellValueForItem(definition, keyID, itemID, context);
        if (fieldValue.mode === 'currentTime') {
            const date = actual.date;
            const content = date && typeof date === 'object' && !Array.isArray(date) ? (date as Record<string, unknown>).content : undefined;
            if (actual.type !== 'date' || typeof content !== 'number' || content < createdAfterMs) throw new Error(`${context}: currentTime field "${keyID}" did not materialize as a new date value.`);
            continue;
        }
        if (!fieldValue.value || typeof fieldValue.value !== 'object' || Array.isArray(fieldValue.value)) throw new Error(`${context}: static field "${keyID}" has no value for readback comparison.`);
        if (await hashCanonicalState(normalizeTemplateValueForKernel(actual, key)) !== await hashCanonicalState(normalizeTemplateValueForKernel(fieldValue.value as Record<string, unknown>, key))) {
            throw new Error(`${context}: static template field "${keyID}" did not match its native readback.`);
        }
    }
}

async function handleDuplicate({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvDuplicateSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'duplicate' });
    if (denied) return denied;

    const response = await avApi.duplicateAttributeViewBlock(client, parsed.avID);
    if (!response.avID || !response.blockID) {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'internal_error',
                        tool: AV_TOOL_NAME,
                        action: 'duplicate',
                        reason: 'duplicate_identifiers_missing',
                        message: `Duplicate AV returned incomplete identifiers for source "${parsed.avID}".`,
                        sourceAvID: parsed.avID,
                        duplicatedAvID: response.avID,
                        duplicatedBlockID: response.blockID,
                    },
                }, null, 2),
            }],
            isError: true,
        };
    }

    const insertedAfter = parsed.previousID ?? parsed.blockID ?? await resolveAvOwningBlockId(client, parsed.avID, avData);
    if (!insertedAfter) {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'internal_error',
                        tool: AV_TOOL_NAME,
                        action: 'duplicate',
                        reason: 'duplicate_insert_target_unresolved',
                        message: `Duplicated AV identifiers were prepared for source "${parsed.avID}", but MCP could not resolve a database block insertion target.`,
                        sourceAvID: parsed.avID,
                        duplicatedAvID: response.avID,
                        duplicatedBlockID: response.blockID,
                        hint: 'SiYuan kernel duplicateAttributeViewBlock only prepares the duplicated AV definition. Provide previousID or ensure the source AV has a resolvable owning database block in the document tree.',
                    },
                }, null, 2),
            }],
            isError: true,
        };
    }

    const destination = await ensurePermissionForDocumentId(client, permMgr, insertedAfter, 'write');
    if (destination.denied) return destination.denied;

    let data = buildDuplicateAvBlockDom(response.blockID, response.avID);
    try {
        const spun = await avApi.spinBlockDOM(client, data);
        if (typeof spun.dom === 'string' && spun.dom.length > 0) {
            data = spun.dom;
        }
    } catch {
        // Keep parity with SiYuan's frontend when available; fall back to the
        // minimal AV block DOM for older kernels that lack /api/lute/spinBlockDOM.
    }

    try {
        await transactionApi.performTransactions(client, [{
            doOperations: [{
                action: 'insert',
                id: response.blockID,
                data,
                previousID: insertedAfter,
            }],
            undoOperations: [{
                action: 'delete',
                id: response.blockID,
            }],
        }]);
    } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    error: {
                        type: 'internal_error',
                        tool: AV_TOOL_NAME,
                        action: 'duplicate',
                        reason: 'duplicate_insert_failed',
                        message: normalized.message,
                        sourceAvID: parsed.avID,
                        duplicatedAvID: response.avID,
                        duplicatedBlockID: response.blockID,
                        insertedAfter,
                        hint: 'The duplicate AV definition was prepared, but MCP failed while inserting the duplicated database block into the document tree.',
                    },
                }, null, 2),
            }],
            isError: true,
        };
    }

    return createWriteSuccessResult({
        action: 'duplicate',
        sourceAvID: parsed.avID,
        prepared: true,
        materialized: true,
        insertedAfter,
        semantics: parsed.previousID ? 'siyuan_duplicate_mirror_with_override' : 'siyuan_duplicate_mirror',
    }, response);
}

async function handleAddView({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvAddViewSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'add_view',
    });
    if (denied) return denied;

    const carrierAttrs = await blockApi.getBlockAttrs(client, parsed.blockID);
    const selectedViewID = carrierAttrs['custom-sy-av-view'];
    if (!selectedViewID) {
        throw new Error(`Carrier "${parsed.blockID}" has no selected view for attribute view "${parsed.avID}". Refusing kernel fallback.`);
    }
    const existing = await verifyExactAvCarrier(
        client,
        parsed.avID,
        avData,
        parsed.blockID,
        // Creating a view targets the supplied carrier's existing selection;
        // do not accept an absent carrier binding and let the kernel choose a
        // different top-level view.
        selectedViewID,
    );
    if (!existing.id) throw new Error(`Carrier "${parsed.blockID}" has no selected view for attribute view "${parsed.avID}".`);
    const views = (avData as AvDefinition).views;
    if (!Array.isArray(views)) throw new Error(`Attribute view "${parsed.avID}" has no readable views array.`);
    if (views.some((view) => view && typeof view === 'object' && (view as AvViewDefinition).id === parsed.viewID)) {
        throw new Error(`View "${parsed.viewID}" already exists in attribute view "${parsed.avID}".`);
    }
    if (parsed.layout === 'kanban') assertKanbanHasExistingSelectKey(parsed.avID, avData);

    // The kernel changes the AV-wide current view and this carrier selection
    // while adding a view. These two core operations share a single HTTP
    // transaction, then strict raw-AV/carrier readback proves ID, type, name,
    // and the carrier selection. If a future kernel partially applies it, the
    // coordinator reports an unknown/readback mismatch and never retries.
    await transactionApi.performTransactions(client, [{
        doOperations: [
            {
                action: 'addAttrViewView',
                avID: parsed.avID,
                id: parsed.viewID,
                blockID: parsed.blockID,
                layout: parsed.layout,
            },
            {
                action: 'setAttrViewViewName',
                avID: parsed.avID,
                id: parsed.viewID,
                data: parsed.name,
            },
        ],
        undoOperations: [],
    }]);

    return createWriteSuccessResult({
        action: 'add_view',
        avID: parsed.avID,
        blockID: parsed.blockID,
        viewID: parsed.viewID,
        layout: parsed.layout,
        name: parsed.name,
    });
}

async function handleSetFilters({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetFiltersSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_filters',
    });
    if (denied) return denied;
    await verifyExactAvCarrier(client, parsed.avID, avData, parsed.blockID, parsed.viewID);
    assertKnownFilterColumns(parsed.avID, avData, parsed.filters);
    await avApi.setAttributeViewFilters(client, {
        avID: parsed.avID,
        blockID: parsed.blockID,
        data: parsed.filters,
    });
    return createWriteSuccessResult({
        action: 'set_filters',
        avID: parsed.avID,
        blockID: parsed.blockID,
        viewID: parsed.viewID,
        filters: parsed.filters,
        completeReplacement: true,
    });
}

async function handleSetSorts({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetSortsSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_sorts',
    });
    if (denied) return denied;
    await verifyExactAvCarrier(client, parsed.avID, avData, parsed.blockID, parsed.viewID);
    for (const sort of parsed.sorts) assertKnownAvKey(parsed.avID, avData, sort.column, 'Sort column');
    await avApi.setAttributeViewSorts(client, {
        avID: parsed.avID,
        blockID: parsed.blockID,
        data: parsed.sorts,
    });
    return createWriteSuccessResult({
        action: 'set_sorts',
        avID: parsed.avID,
        blockID: parsed.blockID,
        viewID: parsed.viewID,
        sorts: parsed.sorts,
        completeReplacement: true,
    });
}

async function handleSetGroup({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetGroupSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_group',
    });
    if (denied) return denied;
    await verifyExactAvCarrier(client, parsed.avID, avData, parsed.blockID, parsed.viewID);
    if (parsed.group.field) assertKnownAvKey(parsed.avID, avData, parsed.group.field, 'Grouping column');
    await avApi.setAttributeViewGroup(client, {
        avID: parsed.avID,
        blockID: parsed.blockID,
        group: parsed.group,
    });
    return createWriteSuccessResult({
        action: 'set_group',
        avID: parsed.avID,
        blockID: parsed.blockID,
        viewID: parsed.viewID,
        group: parsed.group,
    });
}

async function handleSetColumnVisibility({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetColumnVisibilitySchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_column_visibility',
    });
    if (denied) return denied;
    const view = await verifyExactAvCarrier(client, parsed.avID, avData, parsed.blockID, parsed.viewID);
    assertKnownViewField(parsed.avID, view, parsed.keyID);
    await transactionApi.performTransactions(client, [{
        doOperations: [{
            action: 'setAttrViewColHidden',
            avID: parsed.avID,
            blockID: parsed.blockID,
            id: parsed.keyID,
            data: parsed.hidden,
        }],
        undoOperations: [],
    }]);
    return createWriteSuccessResult({
        action: 'set_column_visibility',
        avID: parsed.avID,
        blockID: parsed.blockID,
        viewID: parsed.viewID,
        keyID: parsed.keyID,
        hidden: parsed.hidden,
    });
}

async function handleSetColumnOrder({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetColumnOrderSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_column_order',
    });
    if (denied) return denied;
    const view = await verifyExactAvCarrier(client, parsed.avID, avData, parsed.blockID, parsed.viewID);
    const existingKeyIDs = viewFieldIDs(view);
    if (existingKeyIDs.length !== parsed.keyIDs.length || existingKeyIDs.some((keyID) => !parsed.keyIDs.includes(keyID))) {
        throw new Error(`keyIDs must be the complete current field set for view "${parsed.viewID}" in attribute view "${parsed.avID}".`);
    }

    // sortAttrViewCol inserts each key immediately after previousID. Sending
    // the complete sequence in one transaction makes presentation order a
    // single strict-write outcome; accepting a partial list would silently
    // preserve unspecified fields in a caller-dependent position.
    await transactionApi.performTransactions(client, [{
        doOperations: parsed.keyIDs.map((keyID, index) => ({
            action: 'sortAttrViewCol',
            avID: parsed.avID,
            blockID: parsed.blockID,
            id: keyID,
            previousID: index === 0 ? '' : parsed.keyIDs[index - 1],
        })),
        undoOperations: [],
    }]);
    return createWriteSuccessResult({
        action: 'set_column_order',
        avID: parsed.avID,
        blockID: parsed.blockID,
        viewID: parsed.viewID,
        keyIDs: parsed.keyIDs,
        completeReplacement: true,
    });
}

async function handleGetPrimaryKeyValues({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvGetPrimaryKeyValuesSchema.parse(rawArgs);
    const { denied } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'read');
    if (denied) return denied;

    const response = await avApi.getAttributeViewPrimaryKeyValues(client, {
        id: parsed.avID,
        keyword: parsed.keyword,
        page: parsed.page,
        pageSize: parsed.pageSize,
    });

    const blockIDs = response.blockIDs ?? [];
    if (blockIDs.length > 0) {
        const cache = createResultResolutionCache();
        await permMgr.reload();
        const filteredBlockIDs: string[] = [];
        const filteredRows: unknown[] = [];
        let filteredOutCount = 0;
        for (let index = 0; index < blockIDs.length; index += 1) {
            const blockID = blockIDs[index];
            const context = await resolveResultItemContext(client, { id: blockID }, cache)
                ?? await resolveDocumentContextById(client, blockID).catch(() => null);
            const notebook = context && 'notebook' in context ? context.notebook : undefined;
            if (!notebook || !permMgr.canRead(notebook)) {
                filteredOutCount += 1;
                continue;
            }
            filteredBlockIDs.push(blockID);
            filteredRows.push(response.rows[index]);
        }

        return createJsonResult({
            avID: parsed.avID,
            name: response.name,
            blockIDs: filteredBlockIDs,
            rows: filteredRows,
            ...(filteredOutCount > 0 ? { filteredOutCount, partial: true, reason: 'permission_filtered' } : {}),
        });
    }

    return createJsonResult({
        avID: parsed.avID,
        ...response,
    });
}

export const AV_ACTION_HANDLERS: Record<AvAction, ToolActionHandler> = {
    get: handleGet,
    render: handleRender,
    get_attribute_view_keys: handleGetAttributeViewKeys,
    get_attribute_view_filter_sort: handleGetAttributeViewFilterSort,
    search: handleSearch,
    add_rows: handleAddRows,
    remove_rows: handleRemoveRows,
    add_column: handleAddColumn,
    remove_column: handleRemoveColumn,
    set_cells: handleSetCells,
    set_column_options: handleSetColumnOptions,
    duplicate_rows: handleDuplicateRows,
    set_new_item_templates: handleSetNewItemTemplates,
    create_from_template: handleCreateFromTemplate,
    configure_two_way_relation: handleConfigureTwoWayRelation,
    configure_rollup: handleConfigureRollup,
    set_relation: handleSetRelation,
    duplicate: handleDuplicate,
    get_primary_key_values: handleGetPrimaryKeyValues,
    add_view: handleAddView,
    set_filters: handleSetFilters,
    set_sorts: handleSetSorts,
    set_group: handleSetGroup,
    set_column_visibility: handleSetColumnVisibility,
    set_column_order: handleSetColumnOrder,
};
