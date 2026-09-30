import type { SiYuanClient } from '../../api/client';
import type { CategoryToolConfig, FeedbackAction } from '../../core/config';
import { FEEDBACK_ACTION_HINTS, FEEDBACK_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    FeedbackActionSchema,
    FeedbackSubmitSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { FEEDBACK_ACTION_HANDLERS } from './handlers';

// Re-exported for the kernel bundle (schema-variant path hangs goja).
export { FEEDBACK_ACTION_HANDLERS } from './handlers';

export const FEEDBACK_TOOL_NAME = 'feedback';

export const FEEDBACK_VARIANTS: ActionVariant<FeedbackAction>[] = [
    createZodActionVariant('submit', FeedbackSubmitSchema, 'Submit plain-text GitHub Issue-style feedback to the developer.'),
];

const feedbackTool = defineTool<FeedbackAction>({
    name: FEEDBACK_TOOL_NAME,
    description: '💬 Submit plain-text GitHub Issue-style feedback, suggestions, or experience reports to the plugin developer.',
    variants: FEEDBACK_VARIANTS,
    actionSchema: FeedbackActionSchema,
    aggregateOptions: {
        guidance: FEEDBACK_GUIDANCE,
        actionHints: FEEDBACK_ACTION_HINTS,
    },
    handlers: FEEDBACK_ACTION_HANDLERS,
});

export function listFeedbackTools(config: CategoryToolConfig<FeedbackAction>) {
    return feedbackTool.listTools(config);
}

export async function callFeedbackTool(
    client: SiYuanClient,
    args: Record<string, unknown> | undefined,
    config: CategoryToolConfig<FeedbackAction>,
    permMgr: PermissionManager,
): Promise<ToolResult> {
    return feedbackTool.callTool(client, args, config, permMgr);
}
