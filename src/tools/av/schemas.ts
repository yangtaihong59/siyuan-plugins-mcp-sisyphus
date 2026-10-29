import { z } from "zod";
import { AV_ACTIONS } from "../../core/config";

export const AvActionSchema = z.enum(AV_ACTIONS);

const AvValueTypeSchema = z.enum(["text", "number", "date", "checkbox", "select", "multi_select", "relation", "url", "email", "phone", "mAsset"]);

const AvAssetItemSchema = z.object({
    type: z.enum(["image", "file"]).describe("Asset entry type"),
    content: z.string().describe("Asset path stored by SiYuan, e.g. assets/foo.png"),
    name: z.string().optional().describe("Optional display name"),
});

const AvSetCellValueFieldsBaseSchema = z.object({
    valueType: AvValueTypeSchema.describe("Cell value type"),
    text: z.string().optional().describe("Text value for valueType=text"),
    number: z.number().optional().describe("Number value for valueType=number"),
    numberFormat: z.string().optional().describe("Optional number format such as commas, percent, USD, or CNY"),
    date: z.union([z.string(), z.number()]).optional().describe("Date/time value as ISO text or epoch milliseconds for valueType=date"),
    endDate: z.union([z.string(), z.number()]).optional().describe("Optional end date as ISO text or epoch milliseconds for ranged dates"),
    includeTime: z.boolean().optional().describe("When false, store the date without a time component"),
    checked: z.boolean().optional().describe("Checkbox state for valueType=checkbox"),
    option: z.string().optional().describe("Selected option label for valueType=select"),
    options: z.array(z.string()).optional().describe("Selected option labels for valueType=multi_select"),
    relationBlockIDs: z.array(z.string()).optional().describe("Related block IDs for valueType=relation"),
    url: z.string().optional().describe("URL value for valueType=url"),
    email: z.string().optional().describe("Email value for valueType=email"),
    phone: z.string().optional().describe("Phone value for valueType=phone"),
    assets: z.array(AvAssetItemSchema).optional().describe("Asset entries for valueType=mAsset"),
});

const AvSetCellValueFieldsSchema = AvSetCellValueFieldsBaseSchema.superRefine((value, ctx) => {
    const fieldByType: Record<z.infer<typeof AvValueTypeSchema>, keyof typeof value> = {
        text: "text",
        number: "number",
        date: "date",
        checkbox: "checked",
        select: "option",
        multi_select: "options",
        relation: "relationBlockIDs",
        url: "url",
        email: "email",
        phone: "phone",
        mAsset: "assets",
    };

    const expectedField = fieldByType[value.valueType];
    if (value[expectedField] === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${String(expectedField)} is required when valueType="${value.valueType}".`,
            path: [expectedField],
        });
    }
});

const AvCellUpdateItemSchema = z.object({
    rowID: z.string().describe("Row item ID"),
    columnID: z.string().describe("Column key ID"),
}).and(AvSetCellValueFieldsSchema);

const AvSelectOptionSchema = z.object({
    name: z.string().min(1).describe("Option label; empty option names are rejected before the transaction."),
    color: z.string().optional().describe("Optional SiYuan option color token"),
    desc: z.string().optional().describe("Optional option description"),
}).strict();

export const AvGetSchema = z.object({
    action: z.literal('get'),
    avID: z.string().min(1),
    blockID: z.string().min(1).optional(),
    viewID: z.string().min(1).optional(),
    scope: z.enum(['structure', 'columns', 'view', 'raw']).optional().describe('Default structure: database identity, columns and view summaries, without rows. raw returns the complete native AV.'),
}).strict();

export const AvCreateSchema = z.object({
    action: z.literal('create'),
    parentID: z.string().min(1).describe('Parent block/document for the new database carrier'),
    avID: z.string().regex(/^\d{14}-[a-z0-9]{7}$/).optional().describe('Optional new AV ID; an existing AV is rejected for a new request'),
    name: z.string().trim().min(1).optional(),
}).strict();

export const AvQuerySchema = z.object({
    action: z.literal('query'),
    avID: z.string().min(1),
    mode: z.enum(['rows', 'primary_keys']).optional(),
    blockID: z.string().min(1).optional(),
    viewID: z.string().min(1).optional(),
    keyword: z.string().optional(),
    fields: z.array(z.string().min(1)).min(1).max(200).optional().describe('Optional stable columnIDs to project. Row identity (rowID) is always kept; unrequested cells and columns are omitted.'),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().refine(n => n === -1 || n > 0, 'Use -1 or a positive page size').optional(),
    groupPaging: z.record(z.string(), z.object({ page: z.number().int().min(1), pageSize: z.number().int().positive().optional() }).strict()).optional(),
}).strict().superRefine((args, ctx) => {
    if (args.mode === 'primary_keys') {
        for (const key of ['viewID', 'groupPaging', 'fields'] as const) if (args[key] !== undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'primary_keys does not accept view-specific parameters' });
        if (args.pageSize === -1) ctx.addIssue({ code: 'custom', path: ['pageSize'], message: 'primary_keys requires a positive page size' });
    }
});

export const AvSearchSchema = z.object({
    action: z.literal("search"),
    keyword: z.string().describe("Keyword to search in attribute view names"),
    excludes: z.array(z.string()).optional().describe("Optional AV IDs to exclude"),
});

const AvAddRowsCellSchema = z.object({
    columnID: z.string().min(1).describe("Existing writable column key ID"),
}).and(AvSetCellValueFieldsSchema);

const AvAddRowsItemSchema = z.object({
    clientKey: z.string().min(1).max(128).describe("Batch-local unique key used only to map the returned rowID"),
    primaryKeyText: z.string().min(1).describe("Detached row primary-key text"),
    cells: z.array(AvAddRowsCellSchema).optional().describe("Initial non-primary-key cell values written after the rows are created"),
});

export const AvAddRowsSchema = z.object({
    action: z.literal("add_rows"),
    avID: z.string().describe("Attribute view ID"),
    blockIDs: z.array(z.string()).optional().describe("Existing block IDs to add as bound rows"),
    primaryKeyTexts: z.array(z.string()).optional().describe("Plain-text primary key values to add as detached rows"),
    rows: z.array(AvAddRowsItemSchema).min(1).max(200).optional().describe("Composite detached rows with initial cells. Mutually exclusive with blockIDs and primaryKeyTexts. Each row receives a server-generated stable rowID before any cell write."),
    blockID: z.string().optional().describe("Optional database block ID used to pin a specific database-block view context"),
    viewID: z.string().optional().describe("Optional target view ID"),
    groupID: z.string().optional().describe("Optional target group ID; composite rows require viewID"),
    previousID: z.string().optional().describe("Optional previous row item ID"),
    ignoreDefaultFill: z.boolean().optional().describe("When true, skip view/group default value filling"),
}).superRefine((value, ctx) => {
    const hasRows = Array.isArray(value.rows);
    const hasLegacy = (value.blockIDs?.length ?? 0) > 0 || (value.primaryKeyTexts?.length ?? 0) > 0;
    if (hasRows && hasLegacy) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'rows cannot be combined with blockIDs or primaryKeyTexts. Provide exactly one input mode.',
            path: ['rows'],
        });
        return;
    }
    if (hasRows) {
        const clientKeys = value.rows!.map((row) => row.clientKey);
        if (new Set(clientKeys).size !== clientKeys.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'rows[].clientKey must be unique within the batch.',
                path: ['rows'],
            });
        }
        if (value.groupID && !value.viewID) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Composite rows with groupID require an explicit viewID.',
                path: ['groupID'],
            });
        }
    }
});

export const AvRemoveRowsSchema = z.object({
    action: z.literal("remove_rows"),
    avID: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Registered database block ID for explicit database-block context"),
    rowIDs: z.array(z.string()).min(1).optional().describe("Canonical AV row item IDs to remove. The server validates them against the current AV definition before dispatching the native removal. Do not mix with srcIDs."),
    srcIDs: z.array(z.string()).min(1).optional().describe("Native interface removal IDs. This is not an interchangeable alias for rowIDs; use rowIDs unless caller has already resolved native removal identities."),
}).superRefine((value, ctx) => {
    if (Boolean(value.rowIDs) === Boolean(value.srcIDs)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide exactly one removal mode: rowIDs or srcIDs.',
            path: ['rowIDs'],
        });
        return;
    }
    const ids = value.rowIDs ?? value.srcIDs ?? [];
    if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Removal IDs must not contain duplicates.',
            path: [value.rowIDs ? 'rowIDs' : 'srcIDs'],
        });
    }
});

export const AvAddColumnSchema = z.object({
    action: z.literal("add_column"),
    avID: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Registered database block ID for explicit database-block context"),
    keyID: z.string().optional().describe("Optional new column key ID; MCP generates one when omitted"),
    keyName: z.string().describe("New column name"),
    keyType: z.enum(["text", "number", "date", "select", "mSelect", "url", "email", "phone", "mAsset", "template", "created", "updated", "checkbox", "relation", "rollup", "lineNumber"]).describe("Column type"),
    keyIcon: z.string().optional().describe("Optional column icon"),
    previousKeyID: z.string().optional().describe("Insert after this existing column key ID"),
});

export const AvRenameSchema = z.object({
    action: z.literal("rename"),
    avID: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Registered database block ID for explicit database-block context"),
    name: z.string().trim().min(1).optional().describe("New database name"),
    keyID: z.string().optional().describe("Column to rename (any column, including the primary key)"),
    keyName: z.string().trim().min(1).optional().describe("New column name"),
}).superRefine((value, ctx) => {
    if (value.name === undefined && value.keyID === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide name, keyID + keyName, or both." });
    }
    if ((value.keyID === undefined) !== (value.keyName === undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [value.keyID === undefined ? "keyID" : "keyName"], message: "keyID and keyName go together." });
    }
});

export const AvRemoveColumnSchema = z.object({
    action: z.literal("remove_column"),
    avID: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Registered database block ID for explicit database-block context"),
    keyID: z.string().optional().describe("Column key ID"),
    columnID: z.string().optional().describe("Alias of keyID"),
    removeRelationDest: z.boolean().optional().describe("Also remove reverse relation metadata when deleting a relation column"),
}).superRefine((value, ctx) => {
    if (!value.keyID && !value.columnID) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide keyID or columnID.",
            path: ['keyID'],
        });
    }
});

export const AvSetCellsSchema = z.object({
    action: z.literal("set_cells"),
    avID: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Registered database block ID for explicit database-block context"),
    cells: z.array(AvCellUpdateItemSchema).min(1).optional().describe("Cell updates"),
    items: z.array(AvCellUpdateItemSchema).min(1).optional().describe("Alias for cells"),
    rowID: z.string().optional().describe("Single-cell row item ID"),
    columnID: z.string().optional().describe("Single-cell column key ID"),
}).and(AvSetCellValueFieldsBaseSchema.partial()).superRefine((value, ctx) => {
    const cells = value.cells ?? value.items;
    const hasCells = Array.isArray(cells);
    const hasSingle = typeof value.rowID === "string" || typeof value.columnID === "string" || typeof value.valueType === "string";

    if (hasCells && hasSingle) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide either cells/items or single-cell fields, not both.",
            path: ["cells"],
        });
        return;
    }

    if (!hasCells) {
        if (!value.rowID) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rowID is required for single-cell set_cells calls.", path: ["rowID"] });
        }
        if (!value.columnID) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "columnID is required for single-cell set_cells calls.", path: ["columnID"] });
        }
        if (!value.valueType) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "valueType is required for single-cell set_cells calls.", path: ["valueType"] });
            return;
        }

        const checked = AvSetCellValueFieldsSchema.safeParse(value);
        if (!checked.success) {
            for (const issue of checked.error.issues) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: issue.message,
                    path: issue.path,
                });
            }
        }
    }
});

export const AvSetColumnOptionsSchema = z.object({
    action: z.literal("set_column_options"),
    avID: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Registered database block ID for exact context, permission resolution, and UI refresh"),
    keyID: z.string().describe("Select or multi-select column key ID"),
    options: z.array(AvSelectOptionSchema).describe("Complete desired option list, which may be empty. This is not a patch: omit no existing option unless its removal is intentional."),
}).superRefine((value, ctx) => {
    const names = value.options.map((option) => option.name.trim());
    if (names.some((name) => !name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Option names must not be blank after trimming.", path: ["options"] });
    }
    if (new Set(names).size !== names.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Option names must be unique within the complete desired list.", path: ["options"] });
    }
});

export const AvDuplicateRowsSchema = z.object({
    action: z.literal("duplicate_rows"),
    avID: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Registered database block ID for exact context, permission resolution, and UI refresh"),
    sourceRowIDs: z.array(z.string()).min(1).describe("Canonical AV row item IDs to copy, in source order. Do not pass cell value IDs or bound source block IDs."),
    previousID: z.string().optional().describe("Optional row item ID after which the copied rows are inserted; omit to let SiYuan append them"),
}).superRefine((value, ctx) => {
    if (new Set(value.sourceRowIDs).size !== value.sourceRowIDs.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sourceRowIDs must not contain duplicates.", path: ["sourceRowIDs"] });
    }
});

export const AvDuplicateSchema = z.object({
    action: z.literal("duplicate"),
    avID: z.string().describe("Source attribute view ID"),
    blockID: z.string().optional().describe("Optional source database block ID used as exact context and default insertion target"),
    previousID: z.string().optional().describe("Optional block ID to insert the duplicated mirror database block after"),
});

const AvViewIDSchema = z.string().min(1).describe('Attribute-view view ID');

const AvCarrierBlockIDSchema = z.string().min(1).optional().describe('Carrier block ID (av get carrierBlockIDs); auto-filled when the AV has exactly one');

const AvLayoutSchema = z.enum(['table', 'gallery', 'kanban']).describe('View layout type');

const AvFilterValueSchema = z.object({
    type: z.enum(['block', 'text', 'number', 'date', 'select', 'mSelect', 'url', 'email', 'phone', 'mAsset', 'template', 'created', 'updated', 'checkbox', 'relation', 'rollup']),
    text: z.object({ content: z.string() }).optional(),
    number: z.object({ content: z.number(), isNotEmpty: z.boolean().optional(), format: z.string().optional(), formattedContent: z.string().optional() }).optional(),
    date: z.object({ content: z.number(), content2: z.number().optional(), isNotEmpty: z.boolean().optional(), isNotTime: z.boolean().optional(), hasEndDate: z.boolean().optional() }).optional(),
    mSelect: z.array(z.object({ content: z.string(), color: z.string().optional() })).optional(),
    checkbox: z.object({ checked: z.boolean() }).optional(),
    url: z.object({ content: z.string() }).optional(),
    email: z.object({ content: z.string() }).optional(),
    phone: z.object({ content: z.string() }).optional(),
    relation: z.object({ contents: z.array(z.unknown()).optional() }).optional(),
}).strict().describe('Typed SiYuan AV filter value. This is a Value-shaped predicate operand, not arbitrary AV JSON.');

type AvFilterInput = {
    column?: string;
    quantifier?: 'Any' | 'All' | 'None';
    operator?: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'Contains' | 'Does not contains' | 'Is empty' | 'Is not empty' | 'Starts with' | 'Ends with' | 'Is between' | 'Is true' | 'Is false';
    value?: unknown;
    relativeDate?: { count: number; unit: 0 | 1 | 2 | 3; direction: -1 | 0 | 1 };
    relativeDate2?: { count: number; unit: 0 | 1 | 2 | 3; direction: -1 | 0 | 1 };
    combination?: 'and' | 'or';
    filters?: AvFilterInput[];
};

const AvRelativeDateSchema = z.object({
    count: z.number().int(),
    unit: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
}).strict();

// Upstream tool-schema inliners (e.g. GLM/ZAI) reject recursive $refs, so the
// filter tree must be depth-bounded instead of z.lazy-recursive to keep
// z.toJSONSchema output fully inlineable (no $defs / $ref).
// 5 node levels mirror the kernel's own guard: MaxFilterNestingDepth = 3
// (kernel/av/av_fix.go) counts group levels, groups allowed at depths 0-3
// and depth-4 nodes must be leaf-only, so the deepest node level here is
// leaf-only (no combination/filters).
export const AV_FILTER_MAX_DEPTH = 5;

const buildAvFilterSchema = (depth: number) => z.object({
    column: z.string().min(1).optional().describe('Existing AV key ID for a leaf filter'),
    quantifier: z.enum(['Any', 'All', 'None']).optional(),
    operator: z.enum(['=', '!=', '>', '>=', '<', '<=', 'Contains', 'Does not contains', 'Is empty', 'Is not empty', 'Starts with', 'Ends with', 'Is between', 'Is true', 'Is false']).optional(),
    value: AvFilterValueSchema.nullable().optional(),
    relativeDate: AvRelativeDateSchema.optional(),
    relativeDate2: AvRelativeDateSchema.optional(),
    ...(depth < AV_FILTER_MAX_DEPTH ? {
        combination: z.enum(['and', 'or']).optional(),
        filters: z.array(buildAvFilterSchema(depth + 1)).optional().describe(`Nested group filters; group nesting is capped at ${AV_FILTER_MAX_DEPTH - 1} levels.`),
    } : {}),
}).strict().superRefine((filter, ctx) => {
    const group = filter.combination !== undefined || Boolean(filter.filters?.length);
    if (group) {
        for (const field of ['column', 'operator', 'value', 'quantifier', 'relativeDate', 'relativeDate2'] as const) {
            if (filter[field] !== undefined) ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'A filter group uses combination and filters only. Put leaf fields in a child filter.',
                path: [field],
            });
        }
    }
    if (!group && (!filter.column || !filter.operator)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A leaf filter requires column and operator.', path: ['column'] });
    }
});

const AvFilterSchema = buildAvFilterSchema(1);

export const AvAddViewSchema = z.object({
    action: z.literal('add_view'),
    avID: z.string().min(1).describe('Attribute view ID'),
    blockID: AvCarrierBlockIDSchema,
    viewID: AvViewIDSchema.describe('New view ID. Supply a stable ID before strict preflight; MCP never invents one after preflight.'),
    layout: AvLayoutSchema,
    name: z.string().trim().min(1).max(255).describe('Name for the new view. Creation and naming are sent in one native transaction and read back together.'),
});

export const AvUpdateViewSchema = z.object({
    action: z.literal('update_view'),
    avID: z.string().min(1),
    blockID: AvCarrierBlockIDSchema,
    viewID: AvViewIDSchema,
    filters: z.array(AvFilterSchema).optional().describe('Complete replacement; [] clears filters'),
    sorts: z.array(z.object({ column: z.string().min(1), order: z.enum(['ASC', 'DESC']) }).strict()).optional().describe('Complete replacement; [] clears sorts. order: ASC|DESC (case-insensitive)'),
    group: z.object({
        field: z.string(),
        method: z.number().int().min(0).max(6).optional(),
        range: z.object({ numStart: z.number(), numEnd: z.number(), numStep: z.number().positive() }).strict().optional(),
        order: z.number().int().min(0).max(3).optional(),
        hideEmpty: z.boolean().optional(),
    }).strict().superRefine((group, ctx) => {
        if (!group.field) return;
        for (const key of ['method', 'order', 'hideEmpty'] as const) if (group[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'Required for nonempty grouping' });
        if (group.method === 1 && !group.range) ctx.addIssue({ code: 'custom', path: ['range'], message: 'Required for numeric-range grouping' });
    }).optional().describe('Complete grouping configuration; {field:""} clears grouping'),
    columnVisibility: z.array(z.object({ columnID: z.string().min(1), hidden: z.boolean() }).strict()).optional().describe('Modify only listed columns; duplicate IDs are rejected'),
    columnOrder: z.array(z.string().min(1)).min(1).optional().describe('Complete current view field order, including hidden fields'),
}).strict().superRefine((args, ctx) => {
    if (args.filters === undefined && args.sorts === undefined && args.group === undefined && args.columnOrder === undefined && !args.columnVisibility?.length) ctx.addIssue({ code: 'custom', message: 'Provide at least one view configuration change' });
    for (const [key, ids] of [['columnOrder', args.columnOrder], ['columnVisibility', args.columnVisibility?.map(item => item.columnID)]] as const) {
        if (ids && new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: [key], message: 'Duplicate column IDs are not allowed' });
    }
});

const SiYuanNodeIdSchema = z.string().regex(/^\d{14}-[a-z0-9]{7}$/, "Must be a SiYuan node ID.");

/** The native template model is intentionally passed through as one complete array. */
export const AvNewItemTemplateSchema = z.object({
    id: SiYuanNodeIdSchema.describe("Stable new-item template ID"),
    name: z.string().min(1).describe("Template name; SiYuan trims surrounding whitespace"),
    icon: z.string().optional().describe("Document template icon"),
    targetType: z.enum(['detached', 'document']).describe("Whether creation makes a detached row or a document-bound row"),
    primaryKeyTemplate: z.string().optional().describe("Native Go-template primary-key source"),
    fieldValues: z.record(z.string(), z.object({
        mode: z.enum(['static', 'currentTime']).describe("Native new-item field-value mode"),
        value: z.record(z.string(), z.unknown()).optional().describe("Native AV value payload; omitted for currentTime"),
    })).optional().describe("Defaults keyed by AV key ID"),
    saveLocation: z.object({
        boxID: z.string().optional(),
        pathTemplate: z.string(),
    }).optional().describe("Document target location; omitted means inherit SiYuan's document-create configuration"),
    contentTemplatePath: z.string().optional().describe("Native content-template path for document targets"),
});

export const AvSetNewItemTemplatesSchema = z.object({
    action: z.literal('set_new_item_templates'),
    avID: SiYuanNodeIdSchema.describe("Attribute view ID"),
    blockID: SiYuanNodeIdSchema.describe("Materialized database block used for permission and transaction context"),
    templates: z.array(AvNewItemTemplateSchema).describe("Complete ordered replacement template array"),
    defaultTemplateID: SiYuanNodeIdSchema.or(z.literal('')).describe("Default template ID, or empty to clear it; required because this replaces the complete configuration"),
});

export const AvCreateFromTemplateSchema = z.object({
    action: z.literal('create_from_template'),
    avID: SiYuanNodeIdSchema.describe("Attribute view ID"),
    blockID: SiYuanNodeIdSchema.describe("Materialized database block; never an AV row item ID"),
    templateID: SiYuanNodeIdSchema.describe("Existing native new-item template ID"),
    viewID: SiYuanNodeIdSchema.optional().describe("Optional exact view placement context"),
    previousID: SiYuanNodeIdSchema.optional().describe("Optional preceding AV row item ID"),
    groupID: SiYuanNodeIdSchema.optional().describe("Optional target group ID"),
});

export const AvConfigureTwoWayRelationSchema = z.object({
    action: z.literal('configure_two_way_relation'),
    avID: SiYuanNodeIdSchema.describe("Source attribute view ID"),
    blockID: SiYuanNodeIdSchema.describe("Source materialized database block"),
    keyID: SiYuanNodeIdSchema.describe("Existing source relation key ID"),
    destinationAvID: SiYuanNodeIdSchema.describe("Destination attribute view ID"),
    destinationBlockID: SiYuanNodeIdSchema.optional().describe("Optional explicit destination database block for permission verification"),
    backRelationKeyID: SiYuanNodeIdSchema.describe("Stable destination reverse relation key ID; created when absent"),
    sourceName: z.string().min(1).describe("Source relation field name"),
    destinationName: z.string().min(1).describe("Destination reverse relation field name"),
});

export const AvConfigureRollupSchema = z.object({
    action: z.literal('configure_rollup'),
    avID: SiYuanNodeIdSchema.describe("Attribute view that owns the rollup field"),
    blockID: SiYuanNodeIdSchema.describe("Materialized database block used for permission and transaction context"),
    keyID: SiYuanNodeIdSchema.describe("Existing rollup key ID"),
    relationKeyID: SiYuanNodeIdSchema.describe("Existing relation key in the same AV"),
    destinationKeyID: SiYuanNodeIdSchema.describe("Existing key in the relation destination AV"),
    calc: z.record(z.string(), z.unknown()).describe("Native RollupCalc payload, preserved without invented calculation aliases"),
});

export const AvSetRelationSchema = z.object({
    action: z.literal('set_relation'),
    avID: SiYuanNodeIdSchema.describe("Attribute view ID"),
    blockID: SiYuanNodeIdSchema.describe("Verified source database block; relation writes never infer this from a row's bound block"),
    itemID: SiYuanNodeIdSchema.describe("AV row item ID; never the bound document block ID"),
    keyID: SiYuanNodeIdSchema.describe("Relation key ID"),
    relatedItemIDs: z.array(SiYuanNodeIdSchema).describe("Target AV row item IDs; an empty array clears the relation"),
}).superRefine((value, ctx) => {
    if (new Set(value.relatedItemIDs).size !== value.relatedItemIDs.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "relatedItemIDs must not contain duplicates.",
            path: ['relatedItemIDs'],
        });
    }
});
