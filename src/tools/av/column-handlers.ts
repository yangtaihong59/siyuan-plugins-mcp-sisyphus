/* av column actions: add_column, remove_column, set_column_options. */
import { generateSiYuanNodeId } from '../../shared/siyuan-id';
import * as avApi from '../../api/av';
import type { TransactionOperation } from '../../api/transaction';
import { canonicalizeState } from '../../shared/canonical-state';
import { AvAddColumnSchema, AvRemoveColumnSchema, AvSetColumnOptionsSchema } from './schemas';
import type { ToolHandlerContext } from '../internal/define-tool';
import { createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { asRecord, createAvFieldValidationResult, getAvKeyById, getStringField } from './definition';
import { avWriteSuccess, dispatchAvTransaction } from './transaction';
import { ensurePermissionForAvId } from './carrier';

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

export async function handleAddColumn({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvAddColumnSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'add_column' });
    if (denied) return denied;

    const keyID = parsed.keyID ?? generateSiYuanNodeId();
    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, [{
        action: 'addAttrViewCol',
        name: parsed.keyName,
        avID: parsed.avID,
        type: parsed.keyType,
        id: keyID,
        data: parsed.keyIcon ?? '',
        previousID: parsed.previousKeyID ?? '',
    }], [
        {
            action: 'removeAttrViewCol',
            id: keyID,
            avID: parsed.avID,
        },
    ]);
    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'add_column',
        avID: parsed.avID,
        keyID,
        keyName: parsed.keyName,
        keyType: parsed.keyType,
    });
}

export async function handleRemoveColumn({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvRemoveColumnSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', { blockID: parsed.blockID, action: 'remove_column' });
    if (denied) return denied;
    const keyID = parsed.keyID ?? parsed.columnID!;

    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, [{
        action: 'removeAttrViewCol',
        id: keyID,
        avID: parsed.avID,
        removeDest: parsed.removeRelationDest ?? false,
    }]);
    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'remove_column',
        avID: parsed.avID,
        keyID,
        removeRelationDest: parsed.removeRelationDest ?? false,
    });
}

export async function handleSetColumnOptions({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
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
    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, operations);

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

    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
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
    });
}
