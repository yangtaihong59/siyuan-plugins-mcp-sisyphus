/* av create/duplicate and the action -> handler map; domain handlers live in the sibling *-handlers.ts files. */
import { AV_CREATION_CONTEXT, type AvCreationContext } from './creation-context';
import * as avApi from '../../api/av';
import * as blockApi from '../../api/block';
import * as transactionApi from '../../api/transaction';
import type { AvAction } from '../../core/config';
import { AvDuplicateSchema, AvCreateSchema } from './schemas';
import { ensurePermissionForDocumentId } from '../internal/context';
import type { ToolActionHandler, ToolHandlerContext } from '../internal/define-tool';
import { createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { applyUiRefresh } from '../internal/ui-refresh';
import { sleep } from '../../shared/async';
import { handleAddColumn, handleRemoveColumn, handleSetColumnOptions } from './column-handlers';
import { AV_MATERIALIZATION_POLL_ATTEMPTS, AV_MATERIALIZATION_POLL_DELAY_MS, AV_TOOL_NAME } from './definition';
import { buildDuplicateAvBlockDom } from './transaction';
import { ensurePermissionForAvId, resolveAvOwningBlockId } from './carrier';
import { handleGet, handleQuery, handleSearch } from './read-handlers';
import { handleConfigureRollup, handleConfigureTwoWayRelation, handleSetRelation } from './relation-handlers';
import { handleAddRows, handleDuplicateRows, handleRemoveRows, handleSetCells } from './row-handlers';
import { handleCreateFromTemplate, handleSetNewItemTemplates } from './template-handlers';
import { handleAddView, handleUpdateView } from './view-handlers';

async function handleCreate({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvCreateSchema.parse(rawArgs);
    const context: AvCreationContext = (rawArgs as any)[AV_CREATION_CONTEXT];
    if (!context) throw new Error('create requires a coordinator-issued creation context; run strict preflight first');
    const { avID, blockID } = context.progress;
    const { denied, context: parent } = await ensurePermissionForDocumentId(client, permMgr, parsed.parentID, 'write');
    if (denied) return denied;
    // SiYuan needs an existing block here, so the parent document is passed and
    // also lands in the AV's mirror registry. That entry is never carrier proof:
    // isExplicitAvDatabaseBlock checks the block's own opening tag.
    await avApi.renderAttributeView(client, { id: avID, blockID: parsed.parentID, createIfNotExist: true });
    const created: any = await avApi.getAttributeView(client, avID);
    if (created.av?.id !== avID) throw new Error('Created AV identity could not be verified');
    await context.checkpoint('av_created', 'insert_carrier');
    const spun = await avApi.spinBlockDOM(client, buildDuplicateAvBlockDom(blockID, avID));
    if (typeof spun.dom !== 'string' || !spun.dom) throw new Error('Cannot build database carrier DOM');
    await transactionApi.performTransactions(client, [{ doOperations: [{ action: 'insert', id: blockID, data: spun.dom, parentID: parsed.parentID }], undoOperations: [] }]);
    let carrier: { dom?: string };
    for (let attempt = 0; attempt < AV_MATERIALIZATION_POLL_ATTEMPTS; attempt++) {
        try { carrier = await blockApi.getBlockDOM(client, blockID); } catch { carrier = {}; }
        if (carrier.dom?.includes('data-type="NodeAttributeView"') && carrier.dom.includes(`data-av-id="${avID}"`)) break;
        if (attempt + 1 < AV_MATERIALIZATION_POLL_ATTEMPTS) await sleep(AV_MATERIALIZATION_POLL_DELAY_MS);
    }
    if (!carrier?.dom?.includes(`data-av-id="${avID}"`)) throw new Error('Database carrier persistence could not be confirmed');
    await context.checkpoint('carrier_inserted', 'verify');
    const readback: any = await avApi.getAttributeView(client, avID);
    if (readback.av?.id !== avID) throw new Error('Database persistence could not be confirmed');
    await context.checkpoint('verified', 'complete');
    return applyUiRefresh(client, createWriteSuccessResult({ action: 'create', ...context.progress, materialized: true }), [
        { type: 'reloadAttributeView', id: avID }, { type: 'reloadProtyle', id: parent.documentId },
    ]);
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

export const AV_ACTION_HANDLERS: Record<AvAction, ToolActionHandler> = {
    get: handleGet,
    create: handleCreate,
    query: handleQuery,
    update_view: handleUpdateView,
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
    add_view: handleAddView,
};
