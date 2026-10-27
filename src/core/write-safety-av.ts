/*
 * Attribute-view checks for the write-safety coordinator: view configuration
 * readback, verified carrier permission, and high-risk cross-AV inspection.
 */

import { firstJsonDifferencePath } from '../shared/canonical-state';
import { normalizeAvFilters, normalizeAvGroup, expectedAvGroup, viewFields as rawViewFields } from '../tools/av/view-config';
import type { SiYuanClient } from '../api/client';
import type { PermissionManager } from './permissions';
import { canonicalizeWriteState } from './write-safety-hash';
import { escapeSqlString } from '../shared/sql';
import { canonicalizeAvCarrierDom, isExactAvCarrierDom } from '../shared/av-carrier-dom';
import { safetyError } from './write-safety-ledger';
import { type StateProbe, isRecord, sortedUniqueIds } from './write-safety-records';

export function verifyAvViewConfigurationReadback(
    action: string,
    args: Record<string, unknown>,
    before?: StateProbe,
    after?: StateProbe,
): void {
    const beforeState = before?.state;
    const afterState = after?.state;
    if (!beforeState || !afterState) {
        throw safetyError('readback_mismatch', 'The strict AV write has no complete pre/post raw-definition probe.');
    }
    const avID = typeof args.avID === 'string' ? args.avID : '';
    const blockID = typeof args.blockID === 'string' ? args.blockID : '';
    const viewID = typeof args.viewID === 'string' ? args.viewID : '';
    if (!avID || !blockID || !viewID) {
        throw safetyError('readback_mismatch', 'The strict AV write lost its explicit target identity during readback.');
    }
    const beforeDefinition = extractRawAvDefinition(beforeState.av);
    const afterDefinition = extractRawAvDefinition(afterState.av);
    const beforeCarrier = requireAvCarrier(beforeState.avCarrier, blockID);
    const afterCarrier = requireAvCarrier(afterState.avCarrier, blockID);
    assertExactAvCarrierReadback(afterCarrier, avID, viewID);

    if (action === 'add_view') {
        assertNativeAddViewCarrierTransition(beforeCarrier, afterCarrier, beforeDefinition, viewID);
    } else if (carrierVisibleViews(beforeCarrier) !== carrierVisibleViews(afterCarrier)) {
        // A carrier-visible list is user configuration, not navigation state.
        // The current kernel does not alter it for these other writes; fail
        // closed if a future implementation starts changing it behind their
        // narrow actions.
        throw safetyError('readback_mismatch', 'The AV carrier visible-view configuration changed outside the requested action.');
    }
    if (carrierBox(beforeCarrier) !== carrierBox(afterCarrier)) {
        throw safetyError('readback_mismatch', 'The AV carrier notebook owner changed during the write.');
    }

    if (action === 'add_view') {
        if (findRawAvView(beforeDefinition, viewID)) {
            throw safetyError('readback_mismatch', `View ${viewID} existed before the requested addition.`);
        }
        const created = findRawAvView(afterDefinition, viewID);
        if (!created || created.type !== args.layout || created.name !== args.name) {
            throw safetyError('readback_mismatch', 'Raw AV readback did not prove the requested new view ID, layout, and name.');
        }
    } else {
        const afterView = requireRawAvView(afterDefinition, viewID);
        verifyAvTargetConfiguration(action, args, afterView, beforeDefinition);
    }

    const protectedBefore = projectProtectedAvDefinition(beforeDefinition, action, args, false);
    const protectedAfter = projectProtectedAvDefinition(afterDefinition, action, args, true);
    if (canonicalizeWriteState(protectedBefore) !== canonicalizeWriteState(protectedAfter)) {
        throw safetyError('readback_mismatch', `Complete verification failed: protected AV configuration differs at ${firstJsonDifferencePath(protectedBefore, protectedAfter) ?? '$'}. This does not establish which operation caused the change.`);
    }
}

export function extractRawAvDefinition(value: unknown): Record<string, unknown> {
    if (!isRecord(value) || !isRecord(value.av)) {
        throw safetyError('readback_mismatch', 'The raw getAttributeView response has no AV definition.');
    }
    return value.av;
}

export function findRawAvView(definition: Record<string, unknown>, viewID: string): Record<string, unknown> | undefined {
    const views = definition.views;
    if (!Array.isArray(views)) return undefined;
    const matches = views.filter((value): value is Record<string, unknown> => isRecord(value) && value.id === viewID);
    if (matches.length > 1) {
        throw safetyError('readback_mismatch', `View ${viewID} resolved more than once in the raw AV definition.`);
    }
    return matches[0];
}

function requireRawAvView(definition: Record<string, unknown>, viewID: string): Record<string, unknown> {
    const view = findRawAvView(definition, viewID);
    if (!view) throw safetyError('readback_mismatch', `View ${viewID} is absent from raw AV readback.`);
    return view;
}

function requireAvCarrier(value: unknown, blockID: string): Record<string, unknown> {
    if (!isRecord(value) || value.blockID !== blockID) {
        throw safetyError('readback_mismatch', 'The exact AV carrier was not present in strict readback.');
    }
    return value;
}

function carrierVisibleViews(carrier: Record<string, unknown>): unknown {
    return isRecord(carrier.attrs) ? carrier.attrs['custom-sy-av-visible-views'] : undefined;
}

function assertNativeAddViewCarrierTransition(
    beforeCarrier: Record<string, unknown>,
    afterCarrier: Record<string, unknown>,
    beforeDefinition: Record<string, unknown>,
    viewID: string,
): void {
    // SiYuan v3.8.0 `addAttrViewView` derives the old carrier list with
    // `GetVisibleViewIDs`, appends the requested ID, then writes both
    // `custom-sy-av-view` and `custom-sy-av-visible-views`. This is an
    // intentional, carrier-scoped side effect of creating a view, not a
    // license to accept a changed list. Reproducing that normalization here
    // catches a wrong/missing new ID, reordered legacy entries, and extra IDs.
    const expected = [...normalizeCarrierVisibleViewIDs(
        carrierVisibleViews(beforeCarrier),
        beforeDefinition,
    ), viewID].join(',');
    if (carrierVisibleViews(afterCarrier) !== expected) {
        throw safetyError('readback_mismatch', 'The new AV view was not the exact native addition to this carrier visible-view list.');
    }
}

function normalizeCarrierVisibleViewIDs(value: unknown, definition: Record<string, unknown>): string[] {
    const views = definition.views;
    if (!Array.isArray(views)) {
        throw safetyError('readback_mismatch', 'Raw AV readback has no view order for carrier visible-view normalization.');
    }
    const orderedViewIDs: string[] = [];
    for (const view of views) {
        if (!isRecord(view) || typeof view.id !== 'string' || !view.id) continue;
        if (orderedViewIDs.includes(view.id)) {
            throw safetyError('readback_mismatch', `Raw AV readback contains duplicate view ID ${view.id}.`);
        }
        orderedViewIDs.push(view.id);
    }
    if (orderedViewIDs.length === 0) {
        throw safetyError('readback_mismatch', 'Raw AV readback has no persisted views for carrier visible-view normalization.');
    }
    // An absent/empty attr means all existing views. A non-empty attr is a
    // set, which the kernel reorders by raw AV view order and falls back to the
    // first view when no configured ID still exists.
    if (value === undefined || value === '') return orderedViewIDs;
    if (typeof value !== 'string') {
        throw safetyError('readback_mismatch', 'The AV carrier visible-view configuration is not a string.');
    }
    const configured = new Set(value.split(',').map((id) => id.trim()).filter(Boolean));
    const normalized = orderedViewIDs.filter((id) => configured.has(id));
    return normalized.length > 0 ? normalized : [orderedViewIDs[0]];
}

function carrierBox(carrier: Record<string, unknown>): string {
    return typeof carrier.box === 'string' ? carrier.box : '';
}

function assertExactAvCarrierReadback(carrier: Record<string, unknown>, avID: string, viewID: string): void {
    const attrs = isRecord(carrier.attrs) ? carrier.attrs : undefined;
    const dom = typeof carrier.dom === 'string' ? carrier.dom : '';
    if (carrier.viewID !== viewID || attrs?.['custom-sy-av-view'] !== viewID
        || !dom.includes('data-type="NodeAttributeView"') || !dom.includes(`data-av-id="${avID}"`)) {
        throw safetyError('readback_mismatch', 'The carrier did not retain the exact AV/view binding requested by this write.');
    }
}

function verifyAvTargetConfiguration(
    action: string, args: Record<string, any>, afterView: Record<string, any>, definition: Record<string, unknown>,
): void {
    const beforeView = requireRawAvView(definition, args.viewID);
    const failures: string[] = [];
    if (args.filters !== undefined && !sameAvValue(normalizeAvFilters(args.filters), normalizeAvFilters(afterView.filters))) failures.push('filters');
    if (args.sorts !== undefined && !sameAvValue(args.sorts, afterView.sorts ?? [])) failures.push('sorts');
    if (args.group !== undefined && !sameAvValue(expectedAvGroup(args.group, beforeView.group, definition), normalizeAvGroup(afterView.group))) failures.push('group');
    const fields = rawViewFields(afterView);
    for (const item of args.columnVisibility ?? []) {
        const field = fields.find(field => field.id === item.columnID);
        if (!field || Boolean(field.hidden) !== item.hidden) failures.push(`columnVisibility.${item.columnID}`);
    }
    if (args.columnOrder !== undefined && !sameAvValue(args.columnOrder, fields.map(field => field.id))) failures.push('columnOrder');
    if (failures.length) throw safetyError('readback_mismatch', `Complete verification failed for: ${failures.join(', ')}. Inspect concurrent changes before any retry.`);
}

function projectProtectedAvDefinition(
    definition: Record<string, unknown>,
    action: string,
    args: Record<string, unknown>,
    after: boolean,
): Record<string, unknown> {
    const viewID = typeof args.viewID === 'string' ? args.viewID : '';
    const projected = cloneJsonRecord(definition);
    // AV-level current view is native navigation state. It changes when a
    // view is added and is never proof that a carrier-targeted configuration
    // write selected the intended view.
    delete projected.viewID;
    normalizeDerivedGroups(projected);
    if (!Array.isArray(projected.views)) return projected;
    if (action === 'add_view' && after) {
        projected.views = projected.views.filter((value) => !isRecord(value) || value.id !== viewID);
        return projected;
    }
    const target = projected.views.find((value): value is Record<string, unknown> => isRecord(value) && value.id === viewID);
    if (!target) return projected;
    if (args.filters !== undefined) delete target.filters;
    if (args.sorts !== undefined) delete target.sorts;
    if (args.group !== undefined) {
        delete target.group;
        delete target.groups;
        delete target.groupCreated;
        delete target.groupItemIds;
        delete target.groupCalc;
        delete target.groupKey;
    }
    for (const item of (args.columnVisibility ?? []) as Array<{ columnID: string }>) {
        const field = rawViewFields(target).find(value => value.id === item.columnID);
        if (!field) throw safetyError('readback_mismatch', `View ${viewID} has no field ${item.columnID}.`);
        delete field.hidden;
    }
    if (args.columnOrder !== undefined) {
        // The transaction repositions every requested field. Sort the local
        // projection by stable field ID so the comparison still protects each
        // field's full configuration while excluding only presentation order.
        const fields = rawViewFields(target);
        fields.sort((left, right) => {
            const leftID = isRecord(left) && typeof left.id === 'string' ? left.id : '';
            const rightID = isRecord(right) && typeof right.id === 'string' ? right.id : '';
            return leftID.localeCompare(rightID);
        });
    }
    return projected;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeDerivedGroups(definition: Record<string, unknown>): void {
    if (!Array.isArray(definition.views)) return;
    for (const rawView of definition.views) {
        if (!isRecord(rawView)) continue;
        delete rawView.groupCreated;
        if (!Array.isArray(rawView.groups)) continue;
        const groups = rawView.groups
            .filter(isRecord)
            .map((group) => {
                const semantic: Record<string, unknown> = {};
                for (const key of ['id', 'groupItemIds', 'groupVal', 'groupFolded', 'groupHidden', 'groupSort']) {
                    if (key in group) semantic[key] = group[key];
                }
                return semantic;
            });
        groups.sort((left, right) => canonicalizeWriteState(left).localeCompare(canonicalizeWriteState(right)));
        rawView.groups = groups;
    }
}

function sameAvValue(left: unknown, right: unknown): boolean {
    return canonicalizeWriteState(left) === canonicalizeWriteState(right);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function stringField(value: unknown, keys: string[]): string | undefined {
    const record = asRecord(value);
    for (const key of keys) {
        const candidate = record?.[key];
        if (typeof candidate === 'string' && candidate) return candidate;
    }
    return undefined;
}

function avEnvelope(value: unknown): unknown {
    const record = asRecord(value);
    return record && Object.prototype.hasOwnProperty.call(record, 'av') ? record.av : value;
}

function avKeyValueEntries(avData: unknown): Array<{ key: Record<string, unknown>; values: Array<Record<string, unknown>> }> {
    const keyValues = asRecord(avData)?.keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues.flatMap((entry) => {
        const record = asRecord(entry);
        const key = asRecord(record?.key);
        const values = Array.isArray(record?.values)
            ? record.values.flatMap((item) => asRecord(item) ? [item] : [])
            : [];
        return key ? [{ key, values }] : [];
    });
}

function avRelationBlockIDs(value: Record<string, unknown> | undefined): string[] {
    const relation = asRecord(value?.relation);
    return Array.isArray(relation?.blockIDs)
        ? relation.blockIDs.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
}

function inspectDuplicateRowsRelationDestinations(
    avData: unknown,
    sourceRowIDs: string[],
): Array<{ avID: string; backKeyID: string; destinationRowIDs: string[] }> {
    const destinations = new Map<string, { avID: string; backKeyID: string; destinationRowIDs: string[] }>();
    for (const entry of avKeyValueEntries(avData)) {
        if (stringField(entry.key, ['type']) !== 'relation') continue;
        const relation = asRecord(entry.key.relation);
        const avID = stringField(relation, ['avID']);
        const backKeyID = stringField(relation, ['backKeyID']);
        if (relation?.isTwoWay !== true || !avID || !backKeyID) continue;
        const destination = destinations.get(`${avID}:${backKeyID}`) ?? {
            avID,
            backKeyID,
            destinationRowIDs: [],
        };
        for (const sourceRowID of sourceRowIDs) {
            const sourceValue = entry.values.find((value) => stringField(value, ['blockID']) === sourceRowID);
            for (const destinationRowID of avRelationBlockIDs(sourceValue)) {
                if (!destination.destinationRowIDs.includes(destinationRowID)) destination.destinationRowIDs.push(destinationRowID);
            }
        }
        // Only linked rows can receive a reverse-relation mutation. A bare
        // two-way key must not expand the strict preflight's permission scope.
        if (destination.destinationRowIDs.length > 0) {
            destinations.set(`${avID}:${backKeyID}`, destination);
        }
    }
    return [...destinations.values()];
}

async function resolveVerifiedAvCarrier(
    client: SiYuanClient,
    avID: string,
    explicitBlockID?: string,
): Promise<string | undefined> {
    const candidates: string[] = explicitBlockID ? [explicitBlockID] : [];
    if (!explicitBlockID) {
        try {
            const mirrors = await client.requestRead<{ refDefs?: Array<{ refID?: string }> }>('/api/av/getMirrorDatabaseBlocks', { avID });
            for (const ref of mirrors?.refDefs ?? []) {
                if (typeof ref.refID === 'string' && ref.refID && !candidates.includes(ref.refID)) candidates.push(ref.refID);
            }
        } catch {
            // SQL lookup below is the compatibility path for databases without
            // registered mirrors; a missing mirror response alone is not a reason
            // to grant a cross-AV write.
        }
        const escapedAvID = escapeSqlString(avID);
        const rows = await client.requestRead<unknown[]>('/api/query/sql', {
            stmt: `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${escapedAvID}%' OR ial LIKE '%${escapedAvID}%' OR content LIKE '%${escapedAvID}%') ORDER BY updated DESC LIMIT 20`,
        });
        for (const row of Array.isArray(rows) ? rows : []) {
            const id = stringField(row, ['id']);
            if (id && !candidates.includes(id)) candidates.push(id);
        }
    }
    // Native mirror and SQL ordering can change without any AV mutation.
    // A stable choice keeps the permission target and lease scope identical.
    for (const candidate of candidates.sort()) {
        try {
            const response = await client.requestRead<{ dom?: string }>('/api/block/getBlockDOM', { id: candidate });
            const dom = typeof response?.dom === 'string' ? response.dom : '';
            if (isExactAvCarrierDom(dom, candidate, avID)) return candidate;
        } catch {
            // A stale candidate is not evidence of AV ownership; continue to
            // the next exact carrier candidate and fail closed if none remain.
        }
    }
    return undefined;
}

async function resolveCarrierNotebook(client: SiYuanClient, carrierBlockID: string): Promise<string | undefined> {
    const info = await client.requestRead<unknown>('/api/block/getBlockInfo', { id: carrierBlockID });
    return stringField(info, ['box', 'notebook', 'notebookID']);
}

export async function requireCarrierWritePermission(
    client: SiYuanClient,
    permMgr: PermissionManager,
    avID: string,
    explicitBlockID?: string,
): Promise<{ carrierBlockID: string; notebook: string; carrier: Record<string, unknown> }> {
    const carrierBlockID = await resolveVerifiedAvCarrier(client, avID, explicitBlockID);
    if (!carrierBlockID) {
        throw safetyError('permission_denied', `Could not resolve a verified database carrier for attribute view "${avID}". No write was attempted.`);
    }
    const notebook = await resolveCarrierNotebook(client, carrierBlockID);
    if (!notebook) {
        throw safetyError('permission_denied', `Could not resolve the notebook for database carrier "${carrierBlockID}". No write was attempted.`);
    }
    await permMgr.reload();
    if (!permMgr.canWrite(notebook)) {
        throw safetyError('permission_denied', `Notebook ${notebook} does not allow writes to attribute view "${avID}".`);
    }
    const [domResponse, info] = await Promise.all([
        client.requestRead<{ dom?: string }>('/api/block/getBlockDOM', { id: carrierBlockID }),
        client.requestRead<unknown>('/api/block/getBlockInfo', { id: carrierBlockID }),
    ]);
    const rawDom = typeof domResponse?.dom === 'string' ? domResponse.dom : '';
    const dom = canonicalizeAvCarrierDom(rawDom);
    const currentNotebook = stringField(info, ['box', 'notebook', 'notebookID']);
    if (!isExactAvCarrierDom(rawDom, carrierBlockID, avID) || currentNotebook !== notebook) {
        throw safetyError('precondition_required', `The verified database carrier for attribute view "${avID}" changed while establishing the strict lease. No write was attempted.`);
    }
    return {
        carrierBlockID,
        notebook,
        carrier: { blockID: carrierBlockID, notebook, dom, info },
    };
}

export async function inspectHighRiskAvMutation(
    client: SiYuanClient,
    permMgr: PermissionManager,
    action: string,
    args: Record<string, unknown>,
    sourceReadback: unknown,
): Promise<{ state: Record<string, unknown>; targetIds: string[] }> {
    const source = avEnvelope(sourceReadback);
    const avID = typeof args.avID === 'string' ? args.avID : '';
    const explicitSourceBlockID = typeof args.blockID === 'string' && args.blockID ? args.blockID : undefined;
    const sourceCarrier = await requireCarrierWritePermission(client, permMgr, avID, explicitSourceBlockID);
    if (action === 'set_column_options') {
        const keyID = typeof args.keyID === 'string' ? args.keyID : '';
        const key = avKeyValueEntries(source).map((entry) => entry.key).find((candidate) => stringField(candidate, ['id']) === keyID);
        if (!key || !['select', 'mSelect'].includes(stringField(key, ['type']) ?? '')) {
            throw safetyError('precondition_required', `keyID ${keyID || '<missing>'} is not a select or multi-select key in attribute view ${avID}. No write was attempted.`);
        }
        return { state: { source, sourceCarrier }, targetIds: [sourceCarrier.carrierBlockID] };
    }

    if (action === 'set_relation') {
        const sourceItemID = requiredAvActionId(args, 'itemID', action);
        const keyID = requiredAvActionId(args, 'keyID', action);
        const relatedItemIDs = stringArrayArgument(args, 'relatedItemIDs');
        const relation = requireAvRelationKey(source, keyID, action);
        const destination = await inspectAvMutationDestination(client, permMgr, relation.avID);
        for (const itemID of [sourceItemID, ...relatedItemIDs]) {
            const definition = itemID === sourceItemID ? source : destination.av;
            if (!hasAvRowItem(definition, itemID)) {
                throw safetyError('precondition_required', `${action}: itemID ${itemID} is not a canonical AV row in its resolved attribute view. No write was attempted.`);
            }
        }
        return {
            state: {
                source,
                sourceCarrier,
                relation: {
                    keyID,
                    itemID: sourceItemID,
                    relatedItemIDs,
                    ...relation,
                    destination,
                },
            },
            targetIds: sortedUniqueIds([
                avID,
                sourceCarrier.carrierBlockID,
                sourceCarrier.notebook,
                relation.avID,
                destination.carrierBlockID,
                destination.notebook,
            ]),
        };
    }

    if (action === 'configure_two_way_relation') {
        const keyID = requiredAvActionId(args, 'keyID', action);
        const destinationAvID = requiredAvActionId(args, 'destinationAvID', action);
        const sourceKey = avKeyValueEntries(source).map((entry) => entry.key).find((candidate) => stringField(candidate, ['id']) === keyID);
        if (!sourceKey || stringField(sourceKey, ['type']) !== 'relation') {
            throw safetyError('precondition_required', `${action}: keyID ${keyID} is not an existing relation key. No write was attempted.`);
        }
        const configuredDestinationAvID = stringField(asRecord(sourceKey.relation), ['avID']);
        if (configuredDestinationAvID && configuredDestinationAvID !== destinationAvID) {
            throw safetyError('precondition_required', `${action}: source relation targets ${configuredDestinationAvID}, not requested destination ${destinationAvID}. No write was attempted.`);
        }
        const explicitDestinationBlockID = optionalAvActionId(args, 'destinationBlockID');
        const destination = await inspectAvMutationDestination(client, permMgr, destinationAvID, explicitDestinationBlockID);
        return {
            state: {
                source,
                sourceCarrier,
                twoWayRelation: {
                    keyID,
                    destinationAvID,
                    ...(configuredDestinationAvID ? { configuredDestinationAvID } : {}),
                    backRelationKeyID: requiredAvActionId(args, 'backRelationKeyID', action),
                    destination,
                },
            },
            targetIds: sortedUniqueIds([
                avID,
                sourceCarrier.carrierBlockID,
                sourceCarrier.notebook,
                destinationAvID,
                destination.carrierBlockID,
                destination.notebook,
            ]),
        };
    }

    if (action === 'configure_rollup') {
        const relationKeyID = requiredAvActionId(args, 'relationKeyID', action);
        const destinationKeyID = requiredAvActionId(args, 'destinationKeyID', action);
        const relation = requireAvRelationKey(source, relationKeyID, action);
        const destination = await inspectAvMutationDestination(client, permMgr, relation.avID);
        if (!hasAvKey(destination.av, destinationKeyID)) {
            throw safetyError('precondition_required', `${action}: destination key ${destinationKeyID} is absent from attribute view ${relation.avID}. No write was attempted.`);
        }
        return {
            state: {
                source,
                sourceCarrier,
                rollup: {
                    keyID: requiredAvActionId(args, 'keyID', action),
                    relationKeyID,
                    destinationKeyID,
                    relation,
                    destination,
                },
            },
            targetIds: sortedUniqueIds([
                avID,
                sourceCarrier.carrierBlockID,
                sourceCarrier.notebook,
                relation.avID,
                destination.carrierBlockID,
                destination.notebook,
            ]),
        };
    }

    if (action === 'create_from_template') {
        const templateID = requiredAvActionId(args, 'templateID', action);
        const template = requireAvTemplate(source, templateID, action);
        const relationDestinations = await inspectTemplateRelationDestinations(client, permMgr, source, template, action);
        const documentDestination = await inspectTemplateDocumentDestination(client, permMgr, template, sourceCarrier, action);
        return {
            state: {
                source,
                sourceCarrier,
                template: {
                    templateID,
                    definition: template,
                    relationDestinations,
                    documentDestination,
                },
            },
            targetIds: sortedUniqueIds([
                avID,
                sourceCarrier.carrierBlockID,
                sourceCarrier.notebook,
                ...relationDestinations.flatMap((destination) => [destination.avID, destination.carrierBlockID, destination.notebook]),
                ...(documentDestination ? [documentDestination.notebook] : []),
            ]),
        };
    }

    const sourceRowIDs = Array.isArray(args.sourceRowIDs)
        ? args.sourceRowIDs.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [];
    const destinations = [];
    const targetIds: string[] = [avID, sourceCarrier.carrierBlockID, sourceCarrier.notebook];
    for (const destination of inspectDuplicateRowsRelationDestinations(source, sourceRowIDs)) {
        const response = await client.requestRead('/api/av/getAttributeView', { id: destination.avID });
        const av = avEnvelope(response);
        const carrier = await requireCarrierWritePermission(client, permMgr, destination.avID);
        targetIds.push(
            destination.avID,
            carrier.carrierBlockID,
            carrier.notebook,
        );
        destinations.push({ ...destination, ...carrier, av });
    }
    return { state: { source, sourceCarrier, destinations }, targetIds: sortedUniqueIds(targetIds) };
}

export function isCrossObjectAvMutation(action: string): boolean {
    return [
        'duplicate_rows',
        'set_relation',
        'configure_two_way_relation',
        'configure_rollup',
        'create_from_template',
    ].includes(action);
}

function requiredAvActionId(args: Record<string, unknown>, key: string, action: string): string {
    const value = optionalAvActionId(args, key);
    if (!value) throw safetyError('precondition_required', `${action} requires ${key} to resolve its complete strict mutation scope.`);
    return value;
}

function optionalAvActionId(args: Record<string, unknown>, key: string): string | undefined {
    const value = args[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayArgument(args: Record<string, unknown>, key: string): string[] {
    return Array.isArray(args[key])
        ? args[key].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())
        : [];
}

function requireAvRelationKey(
    definition: unknown,
    keyID: string,
    action: string,
): { avID: string; backKeyID?: string; isTwoWay: boolean } {
    const key = avKeyValueEntries(definition).map((entry) => entry.key).find((candidate) => stringField(candidate, ['id']) === keyID);
    const relation = asRecord(key?.relation);
    const avID = stringField(relation, ['avID']);
    if (!key || stringField(key, ['type']) !== 'relation' || !avID) {
        throw safetyError('precondition_required', `${action}: keyID ${keyID} is not a configured relation with a destination AV. No write was attempted.`);
    }
    return {
        avID,
        backKeyID: stringField(relation, ['backKeyID']),
        isTwoWay: relation?.isTwoWay === true,
    };
}

function hasAvKey(definition: unknown, keyID: string): boolean {
    return avKeyValueEntries(definition).some((entry) => stringField(entry.key, ['id']) === keyID);
}

function hasAvRowItem(definition: unknown, itemID: string): boolean {
    return avKeyValueEntries(definition).some((entry) => entry.values.some((value) => stringField(value, ['blockID']) === itemID));
}

function requireAvTemplate(definition: unknown, templateID: string, action: string): Record<string, unknown> {
    const templates = asRecord(definition)?.newItemTemplates;
    const matches = Array.isArray(templates)
        ? templates.filter((template): template is Record<string, unknown> => isRecord(template) && template.id === templateID)
        : [];
    if (matches.length !== 1) {
        throw safetyError('precondition_required', `${action}: templateID ${templateID} did not resolve exactly once in the source AV. No write was attempted.`);
    }
    return matches[0];
}

async function inspectAvMutationDestination(
    client: SiYuanClient,
    permMgr: PermissionManager,
    avID: string,
    explicitBlockID?: string,
): Promise<{ av: unknown; carrierBlockID: string; notebook: string }> {
    const response = await client.requestRead('/api/av/getAttributeView', { id: avID });
    const carrier = await requireCarrierWritePermission(client, permMgr, avID, explicitBlockID);
    // A destination AV can be mutated by a relation/template action even though
    // the API request names only the source. Keeping its raw definition,
    // verified carrier, and notebook in this one coordinator probe makes the
    // lease reject destination drift before the handler can dispatch.
    return { av: avEnvelope(response), ...carrier };
}

async function inspectTemplateRelationDestinations(
    client: SiYuanClient,
    permMgr: PermissionManager,
    source: unknown,
    template: Record<string, unknown>,
    action: string,
): Promise<Array<{ keyID: string; relatedItemIDs: string[]; avID: string; backKeyID?: string; isTwoWay: boolean; av: unknown; carrierBlockID: string; notebook: string }>> {
    const fieldValues = asRecord(template.fieldValues);
    const destinations: Array<{ keyID: string; relatedItemIDs: string[]; avID: string; backKeyID?: string; isTwoWay: boolean; av: unknown; carrierBlockID: string; notebook: string }> = [];
    for (const keyID of Object.keys(fieldValues ?? {}).sort()) {
        const fieldValue = asRecord(fieldValues?.[keyID]);
        const value = asRecord(fieldValue?.value);
        if (value?.type !== 'relation') continue;
        const relatedItemIDs = avRelationBlockIDs(value);
        const relation = requireAvRelationKey(source, keyID, action);
        const destination = await inspectAvMutationDestination(client, permMgr, relation.avID);
        for (const itemID of relatedItemIDs) {
            if (!hasAvRowItem(destination.av, itemID)) {
                throw safetyError('precondition_required', `${action}: template relation itemID ${itemID} is absent from destination AV ${relation.avID}. No write was attempted.`);
            }
        }
        destinations.push({ keyID, relatedItemIDs, ...relation, ...destination });
    }
    return destinations;
}

async function inspectTemplateDocumentDestination(
    client: SiYuanClient,
    permMgr: PermissionManager,
    template: Record<string, unknown>,
    sourceCarrier: { carrierBlockID: string; notebook: string },
    action: string,
): Promise<{ notebook: string; config: unknown } | undefined> {
    if (template.targetType !== 'document') return undefined;
    const saveLocation = asRecord(template.saveLocation);
    if (!saveLocation) {
        throw safetyError('precondition_required', `${action}: document templates require an explicit saveLocation so the destination notebook can enter the strict lease.`);
    }
    const notebook = stringField(saveLocation, ['boxID']) ?? sourceCarrier.notebook;
    await permMgr.reload();
    if (!permMgr.canWrite(notebook)) {
        throw safetyError('permission_denied', `Notebook ${notebook} does not allow this document-template write.`);
    }
    return {
        notebook,
        config: await client.requestRead('/api/notebook/getNotebookConf', { notebook }),
    };
}
