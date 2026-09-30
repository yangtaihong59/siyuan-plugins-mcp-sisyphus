import type { TagAction } from '../../core/config';
import { TAG_ACTION_HINTS, TAG_GUIDANCE } from '../../core/help';
import {
    TagActionSchema,
    TagListSchema,
    TagRemoveSchema,
    TagRenameSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant } from '../internal/shared';
import { TAG_ACTION_HANDLERS } from './handlers';

// Re-exported so the kernel bundle and tests can import handlers without the
// schema-variant path (z.toJSONSchema hangs the goja sandbox).
export { TAG_ACTION_HANDLERS } from './handlers';

export const TAG_TOOL_NAME = 'tag';

export const TAG_VARIANTS: ActionVariant<TagAction>[] = [
    createZodActionVariant('list', TagListSchema, 'List tags in the workspace.'),
    createZodActionVariant('rename', TagRenameSchema, 'Rename a tag.'),
    createZodActionVariant('remove', TagRemoveSchema, 'Remove a tag.'),
];

const tagTool = defineTool<TagAction>({
    name: 'tag',
    description: '🏷️ Grouped tag operations.',
    variants: TAG_VARIANTS,
    actionSchema: TagActionSchema,
    aggregateOptions: {
        guidance: TAG_GUIDANCE,
        actionHints: TAG_ACTION_HINTS,
    },
    handlers: TAG_ACTION_HANDLERS,
});

export const listTagTools = tagTool.listTools;
export const callTagTool = tagTool.callTool;
