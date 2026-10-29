/* AV write transactions: `updated` stamping, dispatch and UI refresh. */
import type { SiYuanClient } from '@/api/client';
import * as transactionApi from '../../api/transaction';
import type { TransactionOperation } from '../../api/transaction';
import { resolveDocumentContextById } from '../internal/context';
import { createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { applyUiRefresh, type UiRefreshOperation } from '../internal/ui-refresh';
import { resolveAvOwningBlockId } from './carrier';

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

export function buildDuplicateAvBlockDom(blockID: string, avID: string): string {
    return `<div class="av" data-node-id="${blockID}" data-av-id="${avID}" data-type="NodeAttributeView" data-av-type="table"></div>`;
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

export async function resolveAvTransactionBlockId(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID?: string,
): Promise<string | undefined> {
    return explicitBlockID ?? await resolveAvOwningBlockId(client, avID, avData);
}

export function withUpdatedOperation(
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

/**
 * Dispatch AV operations as one native transaction that also stamps the
 * carrier block's `updated`. `undoOperations` run before the stamp restore.
 */
export async function dispatchAvTransaction(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID: string | undefined,
    operations: TransactionOperation[],
    undoOperations: TransactionOperation[] = [],
): Promise<void> {
    const transactionBlockID = await resolveAvTransactionBlockId(client, avID, avData, explicitBlockID);
    const updatedOps = withUpdatedOperation(operations, transactionBlockID);
    await transactionApi.performTransactions(client, [{
        doOperations: updatedOps.doOperations,
        undoOperations: [...undoOperations, ...updatedOps.undoOperations],
    }]);
}

/** Success result plus a best-effort UI refresh of the database blocks showing this AV. */
export async function avWriteSuccess(
    client: SiYuanClient,
    avID: string,
    avData: unknown,
    explicitBlockID: string | undefined,
    payload: Record<string, unknown>,
): Promise<ToolResult> {
    const refreshOperations = await resolveAvWriteRefreshOperations(client, avID, avData, explicitBlockID);
    return applyUiRefresh(client, createWriteSuccessResult(payload), refreshOperations);
}
