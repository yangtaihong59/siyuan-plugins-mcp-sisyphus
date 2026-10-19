import type { SiYuanClient } from '../../api/client';
import type { AvAction, CategoryToolConfig } from '../../core/config';
import { AV_ACTION_HINTS, AV_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    AvActionSchema,
    AvAddColumnSchema,
    AvAddViewSchema,
    AvAddRowsSchema,
    AvConfigureRollupSchema,
    AvConfigureTwoWayRelationSchema,
    AvCreateFromTemplateSchema,
    AvDuplicateSchema,
    AvGetSchema,
    AvCreateSchema,
    AvQuerySchema,
    AvUpdateViewSchema,
    AvRemoveColumnSchema,
    AvRemoveRowsSchema,
    AvSearchSchema,
    AvSetColumnOptionsSchema,
    AvSetCellsSchema,
    AvDuplicateRowsSchema,
    AvSetNewItemTemplatesSchema,
    AvSetRelationSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { AV_ACTION_HANDLERS } from './handlers';

export const AV_TOOL_NAME = 'av';

export const AV_VARIANTS: ActionVariant<AvAction>[] = [
    createZodActionVariant('get', AvGetSchema, 'Read database structure (no rows), columns, exact view configuration, or full raw AV.'),
    createZodActionVariant('query', AvQuerySchema, 'Query paginated database rows or lightweight primary keys; never creates a database.'),
    createZodActionVariant('create', AvCreateSchema, 'Create a new database and carrier under parentID; replay preserves IDs and creation progress.'),
    createZodActionVariant('update_view', AvUpdateViewSchema, 'Update one carrier-selected view in a single transaction; omitted configurations remain unchanged.'),
    createZodActionVariant('search', AvSearchSchema, 'Search attribute views by name or primary-key values.'),
    createZodActionVariant('add_rows', AvAddRowsSchema, 'Add bound block rows or detached plain-text primary-key rows to a database.'),
    createZodActionVariant('remove_rows', AvRemoveRowsSchema, 'Remove rows from a database.'),
    createZodActionVariant('add_column', AvAddColumnSchema, 'Add a column to a database.'),
    createZodActionVariant('remove_column', AvRemoveColumnSchema, 'Remove a column from a database.'),
    createZodActionVariant('set_cells', AvSetCellsSchema, 'Set one or more cell values in a database. Provide cells/items, or pass rowID + columnID + valueType for a single-cell write.'),
    createZodActionVariant('set_column_options', AvSetColumnOptionsSchema, 'Replace one select or multi-select column\'s complete option list. Read the current options first: omitted entries are not preserved.'),
    createZodActionVariant('duplicate_rows', AvDuplicateRowsSchema, 'Copy canonical AV row items in source order. Copies create detached rows and can update reverse two-way relations.'),
    createZodActionVariant('duplicate', AvDuplicateSchema, 'Duplicate an attribute view using SiYuan copy-as-mirror semantics; previousID overrides the insertion target.'),
    createZodActionVariant('add_view', AvAddViewSchema, 'Add one reviewed table, gallery, or kanban view through a verified carrier.'),
    createZodActionVariant('set_new_item_templates', AvSetNewItemTemplatesSchema, 'Replace the complete ordered native new-item-template configuration after checking each field against the current AV schema.'),
    createZodActionVariant('create_from_template', AvCreateFromTemplateSchema, 'Create one AV item from a native new-item template. The returned itemID is the AV row identity; blockID is the distinct bound document/block identity.'),
    createZodActionVariant('configure_two_way_relation', AvConfigureTwoWayRelationSchema, 'Configure an existing source relation key and its stable two-way reverse relation key.'),
    createZodActionVariant('configure_rollup', AvConfigureRollupSchema, 'Configure an existing rollup key from an existing relation key and destination key using native RollupCalc data.'),
    createZodActionVariant('set_relation', AvSetRelationSchema, 'Set or clear one relation cell by AV item IDs, then verify the two-way reverse cell when configured.'),
];

const avTool = defineTool<AvAction>({
    name: 'av',
    description: '🗃️ Real databases: rows, columns, cells, views, filters, sorts, relations. Find databases with search, inspect schema with get, query rows with query, then add_rows or set_cells. Reuse columnID and query rowID; sourceBlockID and cell value IDs are different. Never edit database cells through fs/block. Read action help for nested writes.',
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
