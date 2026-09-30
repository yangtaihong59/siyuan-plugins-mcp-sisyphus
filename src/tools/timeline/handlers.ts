import type { TimelineAction } from '../../core/config';
import {
    TimelineCompareNodeSchema,
    TimelineCreateNodeSchema,
    TimelineDeleteNodeSchema,
    TimelineListNodesSchema,
    TimelineRollbackBlockSchema,
    TimelineRollbackDocumentSchema,
} from '../../core/types';
import {
    compareTimelineNode,
    createTimelineNode,
    deleteTimelineNode,
    listTimelineNodes,
    rollbackTimelineBlock,
    rollbackTimelineDocument,
} from '../../shared/timeline-service';
import { isGlobalTimelineTag } from '../../ui/version-control/timeline';
import { ensurePermissionForDocumentId } from '../internal/context';
import type { ToolActionHandler } from '../internal/define-tool';
import { createJsonResult } from '../internal/shared';
import { applyUiRefresh } from '../internal/ui-refresh';

/*
 * Timeline handlers in a separate module keep the kernel goja bundle free of
 * the z.toJSONSchema variant construction in index.ts.
 */
export const TIMELINE_ACTION_HANDLERS: Record<TimelineAction, ToolActionHandler> = {
        list_nodes: async ({ client, permMgr, rawArgs }) => {
            const parsed = TimelineListNodesSchema.parse(rawArgs);
            if (parsed.scope !== 'global') {
                const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.documentId!, 'read');
                if (denied) return denied;
            }
            return createJsonResult(await listTimelineNodes(client, parsed));
        },
        create_node: async ({ client, permMgr, rawArgs }) => {
            const parsed = TimelineCreateNodeSchema.parse(rawArgs);
            if (parsed.scope === 'document') {
                const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.documentId!, 'write');
                if (denied) return denied;
                return applyUiRefresh(
                    client,
                    createJsonResult(await createTimelineNode(client, parsed)),
                    [{ type: 'reloadProtyle', id: context.documentId }],
                );
            }
            return createJsonResult(await createTimelineNode(client, parsed));
        },
        compare_node: async ({ client, permMgr, rawArgs }) => {
            const parsed = TimelineCompareNodeSchema.parse(rawArgs);
            const { denied } = await ensurePermissionForDocumentId(client, permMgr, parsed.documentId, 'read');
            if (denied) return denied;
            return createJsonResult(await compareTimelineNode(client, parsed));
        },
        delete_node: async ({ client, permMgr, rawArgs }) => {
            const parsed = TimelineDeleteNodeSchema.parse(rawArgs);
            if (!isGlobalTimelineTag(parsed.tag)) {
                if (!parsed.documentId) throw new Error('documentId is required for document-scoped timeline tags.');
                const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.documentId, 'delete');
                if (denied) return denied;
                return applyUiRefresh(
                    client,
                    createJsonResult(await deleteTimelineNode(client, parsed)),
                    [{ type: 'reloadProtyle', id: context.documentId }],
                );
            }
            return createJsonResult(await deleteTimelineNode(client, parsed));
        },
        rollback_document: async ({ client, permMgr, rawArgs }) => {
            const parsed = TimelineRollbackDocumentSchema.parse(rawArgs);
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.documentId, 'delete');
            if (denied) return denied;
            return applyUiRefresh(
                client,
                createJsonResult(await rollbackTimelineDocument(client, parsed)),
                [{ type: 'reloadProtyle', id: context.documentId }],
            );
        },
        rollback_block: async ({ client, permMgr, rawArgs }) => {
            const parsed = TimelineRollbackBlockSchema.parse(rawArgs);
            const { denied, context } = await ensurePermissionForDocumentId(client, permMgr, parsed.documentId, 'delete');
            if (denied) return denied;
            return applyUiRefresh(
                client,
                createJsonResult(await rollbackTimelineBlock(client, parsed)),
                [{ type: 'reloadProtyle', id: context.documentId }],
            );
        },
};
