import type { SiYuanClient } from '../../api/client';
import type { AvAction, CategoryToolConfig } from '../../core/config';
import { AV_ACTION_HINTS, AV_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    AvActionSchema,
    AvAddColumnSchema,
    AvAddViewSchema,
    AvAddRowsSchema,
    AvDuplicateSchema,
    AvGetAttributeViewFilterSortSchema,
    AvGetAttributeViewKeysSchema,
    AvGetPrimaryKeyValuesSchema,
    AvGetSchema,
    AvRemoveColumnSchema,
    AvRemoveRowsSchema,
    AvRenderSchema,
    AvSearchSchema,
    AvSetColumnOptionsSchema,
    AvSetCellsSchema,
    AvDuplicateRowsSchema,
    AvSetColumnOrderSchema,
    AvSetColumnVisibilitySchema,
    AvSetFiltersSchema,
    AvSetGroupSchema,
    AvSetSortsSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { AV_ACTION_HANDLERS } from './handlers';

export const AV_TOOL_NAME = 'av';

export const AV_VARIANTS: ActionVariant<AvAction>[] = [
    createZodActionVariant('get', AvGetSchema, 'Get the full attribute view payload by AV ID; blockID is an optional exact database-block context.'),
    createZodActionVariant('render', AvRenderSchema, 'Render an attribute view by id (AV ID, not avID) with optional paging/filtering; with createIfNotExist=true, materialize a SiYuan-style AV block under blockID.'),
    createZodActionVariant('get_attribute_view_keys', AvGetAttributeViewKeysSchema, 'Get the column (key) definitions of an attribute view.'),
    createZodActionVariant('get_attribute_view_filter_sort', AvGetAttributeViewFilterSortSchema, 'Get filter and sort settings for an attribute view.'),
    createZodActionVariant('search', AvSearchSchema, 'Search attribute views by name or primary-key values.'),
    createZodActionVariant('add_rows', AvAddRowsSchema, 'Add bound block rows or detached plain-text primary-key rows to a database.'),
    createZodActionVariant('remove_rows', AvRemoveRowsSchema, 'Remove rows from a database.'),
    createZodActionVariant('add_column', AvAddColumnSchema, 'Add a column to a database.'),
    createZodActionVariant('remove_column', AvRemoveColumnSchema, 'Remove a column from a database.'),
    createZodActionVariant('set_cells', AvSetCellsSchema, 'Set one or more cell values in a database. Provide cells/items, or pass rowID + columnID + valueType for a single-cell write.'),
    createZodActionVariant('set_column_options', AvSetColumnOptionsSchema, 'Replace one select or multi-select column\'s complete option list. Read the current options first: omitted entries are not preserved.'),
    createZodActionVariant('duplicate_rows', AvDuplicateRowsSchema, 'Copy canonical AV row items in source order. Copies create detached rows and can update reverse two-way relations.'),
    createZodActionVariant('duplicate', AvDuplicateSchema, 'Duplicate an attribute view using SiYuan copy-as-mirror semantics; previousID overrides the insertion target.'),
    createZodActionVariant('get_primary_key_values', AvGetPrimaryKeyValuesSchema, 'Get primary key values for an attribute view.'),
    createZodActionVariant('add_view', AvAddViewSchema, 'Add one reviewed table, gallery, or kanban view through a verified carrier.'),
    createZodActionVariant('set_filters', AvSetFiltersSchema, 'Replace the complete filter array on the exact view selected by a verified carrier.'),
    createZodActionVariant('set_sorts', AvSetSortsSchema, 'Replace the complete sort array on the exact view selected by a verified carrier.'),
    createZodActionVariant('set_group', AvSetGroupSchema, 'Set or clear grouping on the exact view selected by a verified carrier.'),
    createZodActionVariant('set_column_visibility', AvSetColumnVisibilitySchema, 'Set one column\'s hidden state in the exact view selected by a verified carrier.'),
    createZodActionVariant('set_column_order', AvSetColumnOrderSchema, 'Replace the complete column order in the exact view selected by a verified carrier.'),
];

const avTool = defineTool<AvAction>({
    name: 'av',
    description: '\ud83d\uddc3\ufe0f Grouped attribute-view (database) operations.',
    variants: AV_VARIANTS,
    actionSchema: AvActionSchema,
    aggregateOptions: {
        guidance: AV_GUIDANCE,
        actionHints: AV_ACTION_HINTS,
    },
    handlers: AV_ACTION_HANDLERS,
});

export function listAvTools(config: CategoryToolConfig<AvAction>) {
    return avTool.listTools(config);
}

export async function callAvTool(
    client: SiYuanClient,
    args: Record<string, unknown> | undefined,
    config: CategoryToolConfig<AvAction>,
    permMgr: PermissionManager,
): Promise<ToolResult> {
    return avTool.callTool(client, args, config, permMgr);
}
