import type { TimelineAction } from '../../core/config';
import { TIMELINE_ACTION_HINTS, TIMELINE_GUIDANCE } from '../../core/help';
import {
    TimelineActionSchema,
    TimelineCompareNodeSchema,
    TimelineCreateNodeSchema,
    TimelineDeleteNodeSchema,
    TimelineListNodesSchema,
    TimelineRollbackBlockSchema,
    TimelineRollbackDocumentSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant } from '../internal/shared';
import { TIMELINE_ACTION_HANDLERS } from './handlers';

// Re-exported for the kernel bundle — it imports handlers directly and must
// not load the zod variant construction (z.toJSONSchema hangs goja).
export { TIMELINE_ACTION_HANDLERS } from './handlers';

export const TIMELINE_TOOL_NAME = 'timeline';

export const TIMELINE_VARIANTS: ActionVariant<TimelineAction>[] = [
    createZodActionVariant('list_nodes', TimelineListNodesSchema, 'List global or document timeline nodes.'),
    createZodActionVariant('create_node', TimelineCreateNodeSchema, 'Create a named global or document timeline node.'),
    createZodActionVariant('compare_node', TimelineCompareNodeSchema, 'Compare one document with a timeline node.'),
    createZodActionVariant('delete_node', TimelineDeleteNodeSchema, 'Delete a timeline node tag while retaining its snapshot.'),
    createZodActionVariant('rollback_document', TimelineRollbackDocumentSchema, 'Restore one document file from a timeline node.'),
    createZodActionVariant('rollback_block', TimelineRollbackBlockSchema, 'Restore one changed block from a timeline node.'),
];

const timelineTool = defineTool<TimelineAction>({
    name: TIMELINE_TOOL_NAME,
    description: '🕓 Document and global snapshot nodes: list, create, compare a document against a node, and (when enabled) delete nodes or roll back.',
    variants: TIMELINE_VARIANTS,
    actionSchema: TimelineActionSchema,
    aggregateOptions: {
        guidance: TIMELINE_GUIDANCE,
        actionHints: TIMELINE_ACTION_HINTS,
    },
    handlers: TIMELINE_ACTION_HANDLERS,
});

export const listTimelineTools = timelineTool.listTools;
export const callTimelineTool = timelineTool.callTool;
