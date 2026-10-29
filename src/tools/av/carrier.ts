/* AV carrier and permission resolution: locate the exact database block for an avID and check notebook access. */
import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import * as blockApi from '../../api/block';
import * as searchApi from '../../api/search';
import type { AvAction } from '../../core/config';
import type { PermissionManager } from '../../core/permissions';
import { ensurePermissionForDocumentId } from '../internal/context';
import { escapeSqlString } from '../../shared/sql';
import { safetyError } from '../../core/write-safety-error';
import { isExactAvCarrierDom } from '../../shared/av-carrier-dom';
import { isMissingBlockError } from '../internal/errorTranslation';
import { type ToolResult } from '../internal/shared';
import { ATTRIBUTE_VIEW_ID_PATTERN, AV_TOOL_NAME, type AttributeViewDefinition, asAttributeViewDefinition, extractAttributeViewKeysFromData, extractFirstRowBlockId, getAvKey } from './definition';
import { type DuplicateRowsRelationDestination, collectDuplicateRowsRelationDestinations, createDuplicateRowsValidationResult, extractAvRowLookup } from './rows';

type AvContextResolution = {
    avData: unknown;
    blockID?: string;
};

export async function requireWritableRelationDestinations(
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
    // discovery, but it is not a carrier. Mirror registrations are not proof
    // either: SiYuan can register a parent document there. Like the strict
    // coordinator, accept only the block's own NodeAttributeView opening tag;
    // otherwise a source document could authorize another AV.
    try {
        const response = await blockApi.getBlockDOM(client, blockID);
        const dom = typeof response?.dom === 'string' ? response.dom : '';
        return isExactAvCarrierDom(dom, blockID, avID);
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

export type AvDefinition = {
    id?: unknown;
    views?: unknown;
};

export type AvViewDefinition = {
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

export async function verifyExactAvCarrier(
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

/** Kanban groups by a single-select key; null when one exists, otherwise the refusal message. */
export function kanbanSelectKeyProblem(avID: string, avData: unknown): string | null {
    const keys = extractAttributeViewKeysFromData(avData);
    if (keys.some((key) => key && typeof key === 'object' && (key as { type?: unknown }).type === 'select')) return null;
    // Kernel `addAttrViewView` synthesizes a Select key when a Kanban view
    // has no grouping key, and adds it to every existing view. This action
    // owns view structure only, so require the caller to add that schema
    // field through the explicit column action first instead of smuggling a
    // cross-view schema write into an apparently additive view operation.
    return `Kanban view creation for attribute view "${avID}" requires an existing single-select (keyType="select") column; mSelect does not qualify. Add one through av.add_column before creating the view. Nothing was written.`;
}

export function assertKanbanHasExistingSelectKey(avID: string, avData: unknown): void {
    const problem = kanbanSelectKeyProblem(avID, avData);
    if (problem) throw safetyError('validation_error', problem);
}

export async function ensurePermissionForAvId(
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

export async function resolveAvOwningBlockId(
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
            if (isExactAvCarrierDom(dom, candidate, avID)) {
                return candidate;
            }
        } catch (error) {
            if (isMissingBlockError(error)) continue;
            throw error;
        }
    }
    return undefined;
}

/**
 * Every verified NodeAttributeView carrier of an AV (mirror registrations and
 * blocks-table hits, DOM-checked). With permMgr, carriers in notebooks the
 * caller cannot read are omitted.
 */
export async function listVerifiedAvCarrierBlockIds(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    permMgr?: PermissionManager,
): Promise<string[]> {
    const candidates = [...new Set([
        ...await getAvMirrorDatabaseBlockIds(client, avID),
        ...await findAvDatabaseBlockIdsBySql(client, avID),
    ])];
    const carriers: string[] = [];
    for (const candidate of candidates) {
        if (!await isExplicitAvDatabaseBlock(client, avID, avData, candidate)) continue;
        if (permMgr) {
            const readable = await ensurePermissionForDocumentId(client, permMgr, candidate, 'read')
                .then(({ denied }) => !denied, () => false);
            if (!readable) continue;
        }
        carriers.push(candidate);
    }
    return carriers.sort();
}

/**
 * add_view/update_view name an exact carrier. When the caller omits blockID
 * and the AV has exactly one verified carrier, fill it in before preflight so
 * the commit arguments still carry an explicit blockID. Zero or several
 * carriers leave the arguments unchanged and the normal validation applies.
 */
export async function fillImplicitAvViewCarrier(
    client: SiYuanClient,
    args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    if (args.action !== 'add_view' && args.action !== 'update_view') return args;
    if (typeof args.blockID === 'string' && args.blockID) return args;
    if (typeof args.avID !== 'string' || !ATTRIBUTE_VIEW_ID_PATTERN.test(args.avID)) return args;
    try {
        const avData = (await avApi.getAttributeView(client, args.avID)).av;
        const carriers = await listVerifiedAvCarrierBlockIds(client, args.avID, avData);
        return carriers.length === 1 ? { ...args, blockID: carriers[0] } : args;
    } catch {
        return args;
    }
}

export async function resolveVerifiedAvCarrier(
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

export async function resolveDuplicateRowsRelationDestinations(
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

/** Read selection never writes carrier attrs, including when viewID overrides its selection. */
export async function readViewSelection(client: SiYuanClient, avID: string, definition: any, blockID?: string, viewID?: string) {
    const views: any[] = Array.isArray(definition?.views) ? definition.views.filter((view: any) => typeof view?.id === 'string' && view.id) : [];
    if (viewID) {
        const matches = views.filter(view => view.id === viewID);
        if (matches.length !== 1) throw new Error(`Unknown or ambiguous viewID: ${viewID}`);
        return { view: matches[0], viewID, selectionSource: 'explicit', selectionFallback: false };
    }
    if (blockID) {
        const attrs = await blockApi.getBlockAttrs(client, blockID);
        const selected = views.find(view => view.id === attrs['custom-sy-av-view']);
        if (selected) return { view: selected, viewID: selected.id, selectionSource: 'carrier', selectionFallback: false };
    }
    if (!views.length) throw new Error(`Database ${avID} has no readable view`);
    return { view: views[0], viewID: views[0].id, selectionSource: 'kernel_default', selectionFallback: Boolean(blockID) };
}
