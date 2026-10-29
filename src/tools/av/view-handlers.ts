/* av view configuration: add_view, update_view. */
import { prepareViewUpdate, viewFields, normalizeAvFilters, normalizeAvGroup } from './view-config';
import * as avApi from '../../api/av';
import * as blockApi from '../../api/block';
import * as transactionApi from '../../api/transaction';
import { createAvValidationErrorResult } from './definition';
import { canonicalizeState } from '../../shared/canonical-state';
import { AvAddViewSchema, AvUpdateViewSchema } from './schemas';
import type { ToolHandlerContext } from '../internal/define-tool';
import { createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { type AvDefinition, type AvViewDefinition, kanbanSelectKeyProblem, ensurePermissionForAvId, listVerifiedAvCarrierBlockIds, verifyExactAvCarrier } from './carrier';

async function missingCarrierResult(client: ToolHandlerContext['client'], permMgr: ToolHandlerContext['permMgr'], action: 'add_view' | 'update_view', avID: string): Promise<ToolResult> {
    const avData = (await avApi.getAttributeView(client, avID)).av;
    const carrierBlockIDs = await listVerifiedAvCarrierBlockIds(client, avID, avData, permMgr);
    return createAvValidationErrorResult(action, {
        message: carrierBlockIDs.length
            ? `Attribute view "${avID}" has ${carrierBlockIDs.length} carrier blocks; pass blockID to choose one. Nothing was written.`
            : `Attribute view "${avID}" has no readable carrier block; pass blockID explicitly. Nothing was written.`,
        fields: [{ path: 'blockID', message: 'Required when the AV does not have exactly one carrier block' }],
        carrierBlockIDs,
        hint: 'av get returns databaseContext.carrierBlockIDs.',
    });
}

export async function handleAddView({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsedArgs = AvAddViewSchema.parse(rawArgs);
    if (!parsedArgs.blockID) return missingCarrierResult(client, permMgr, 'add_view', parsedArgs.avID);
    const parsed = { ...parsedArgs, blockID: parsedArgs.blockID };
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
    const kanbanProblem = parsed.layout === 'kanban' ? kanbanSelectKeyProblem(parsed.avID, avData) : null;
    if (kanbanProblem) {
        return createAvValidationErrorResult('add_view', {
            message: kanbanProblem,
            fields: [{ path: 'layout', message: 'kanban needs an existing select column' }],
        });
    }

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

export async function handleUpdateView({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvUpdateViewSchema.parse(rawArgs);
    const { avID, blockID } = parsed;
    if (!blockID) return missingCarrierResult(client, permMgr, 'update_view', avID);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, avID, 'write', { blockID, action: 'update_view' });
    if (denied) return denied;
    const { args, view, operations } = prepareViewUpdate(avData, rawArgs);
    await verifyExactAvCarrier(client, avID, avData, blockID, args.viewID);
    const same = (a: unknown, b: unknown) => canonicalizeState(a) === canonicalizeState(b);
    const fields = viewFields(view);
    const noChange = (args.filters === undefined || same(normalizeAvFilters(args.filters), normalizeAvFilters(view.filters)))
        && (args.sorts === undefined || same(args.sorts, view.sorts ?? []))
        && (args.group === undefined || same(normalizeAvGroup(args.group), normalizeAvGroup(view.group)))
        && (args.columnOrder === undefined || same(args.columnOrder, fields.map(field => field.id)))
        && (args.columnVisibility ?? []).every(item => Boolean(fields.find(field => field.id === item.columnID)?.hidden) === item.hidden);
    if (noChange) return createWriteSuccessResult({ ...args, changed: false, skipped: true, reason: 'already_applied' });
    await transactionApi.performTransactions(client, [{ doOperations: operations, undoOperations: [] }]);
    return createWriteSuccessResult({ ...args });
}
