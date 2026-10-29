import { normalizeActionAlias } from './action-aliases';
import type { ToolCategory } from './config';

export type JsonSchemaLike = Record<string, unknown>;

export interface ArgumentAliasContext {
    category: ToolCategory;
    action?: string;
}

interface FlagAliasRule {
    canonical: string;
    aliases: string[];
    schema?: JsonSchemaLike;
}

const STRING_SCHEMA: JsonSchemaLike = { type: 'string' };
const BOOLEAN_SCHEMA: JsonSchemaLike = { type: 'boolean' };
const INTEGER_SCHEMA: JsonSchemaLike = { type: 'integer' };

function normalizedActionFromArgs(category: ToolCategory, args: Record<string, unknown>): string | undefined {
    return typeof args.action === 'string' ? normalizeActionAlias(category, args.action) : undefined;
}

function hasOwn(args: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(args, key);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function hasAny(args: Record<string, unknown>, keys: string[]): boolean {
    return keys.some((key) => hasOwn(args, key));
}

function normalizeHelpTopic(category: ToolCategory, args: Record<string, unknown>): void {
    if (args.action !== 'help' || typeof args.topic !== 'string') return;
    const topic = args.topic.trim();
    if (!topic || topic === 'overview') {
        args.topic = topic;
        return;
    }
    args.topic = normalizeActionAlias(category, topic);
}

function normalizeFsReplaceArgs(args: Record<string, unknown>): void {
    if (hasOwn(args, 'edit') && hasAny(args, ['old', 'new', 'replace_all', 'replaceAll'])) {
        throw new Error('fs.replace accepts either edit or old/new shorthand, not both.');
    }
    if (!hasOwn(args, 'edit') && (hasOwn(args, 'old') || hasOwn(args, 'new'))) {
        if (!nonEmptyString(args.old)) {
            throw new Error('fs.replace shorthand requires a non-empty old value.');
        }
        if (!hasOwn(args, 'new')) {
            throw new Error('fs.replace shorthand requires new.');
        }
        args.edit = {
            old: args.old,
            new: String(args.new ?? ''),
            ...((typeof args.replace_all === 'boolean' || typeof args.replaceAll === 'boolean')
                ? { replace_all: Boolean(args.replace_all ?? args.replaceAll) }
                : {}),
        };
    }
    delete args.old;
    delete args.new;
    delete args.replace_all;
    delete args.replaceAll;
}


function normalizeBlockWordCountArgs(args: Record<string, unknown>): void {
    if (!hasOwn(args, 'ids') && nonEmptyString(args.id)) {
        args.ids = [args.id];
    }
    delete args.id;
}

function normalizeFlashcardBlockIdsArgs(args: Record<string, unknown>): void {
    if (!hasOwn(args, 'blockIDs') && nonEmptyString(args.blockID)) {
        args.blockIDs = [args.blockID];
    }
    delete args.blockID;
}

function normalizeFileUploadAssetArgs(args: Record<string, unknown>): void {
    const looksLikeRemovedBase64Shape = hasOwn(args, 'file') && hasOwn(args, 'fileName') && !hasOwn(args, 'localFilePath');
    if (!looksLikeRemovedBase64Shape && !hasOwn(args, 'localFilePath') && nonEmptyString(args.file)) {
        args.localFilePath = args.file;
        delete args.file;
    }
    if (!hasOwn(args, 'assetsDirPath')) {
        args.assetsDirPath = '/assets/';
    }
}

const FLASHCARD_RATINGS: Record<string, number> = { again: 1, hard: 2, good: 3, easy: 4 };

// SiYuan's review buttons are named; the kernel takes their FSRS numbers.
function normalizeFlashcardRating(args: Record<string, unknown>): void {
    if (typeof args.rating !== 'string') return;
    const named = FLASHCARD_RATINGS[args.rating.trim().toLowerCase()];
    if (named !== undefined) args.rating = named;
}

// Columns report their type as "mSelect"; cells call the same type "multi_select".
function normalizeAvCellValueTypes(args: Record<string, unknown>): void {
    const fix = (cell: unknown): unknown => cell && typeof cell === 'object' && (cell as Record<string, unknown>).valueType === 'mSelect'
        ? { ...(cell as Record<string, unknown>), valueType: 'multi_select' }
        : cell;
    if (args.valueType === 'mSelect') args.valueType = 'multi_select';
    if (Array.isArray(args.cells)) args.cells = args.cells.map(fix);
    if (Array.isArray(args.rows)) {
        args.rows = args.rows.map((row) => row && typeof row === 'object' && Array.isArray((row as Record<string, unknown>).cells)
            ? { ...(row as Record<string, unknown>), cells: ((row as Record<string, unknown>).cells as unknown[]).map(fix) }
            : row);
    }
}

function normalizeSearchRefsArgs(args: Record<string, unknown>): void {
    if (!hasOwn(args, 'k')) {
        if (typeof args.keyword === 'string') args.k = args.keyword;
        else if (typeof args.query === 'string') args.k = args.query;
    }
    delete args.keyword;
    delete args.query;
}

export function normalizeToolArguments(category: ToolCategory, rawArgs: Record<string, unknown>): Record<string, unknown> {
    const args = { ...rawArgs };
    const action = normalizedActionFromArgs(category, args);
    if (action) args.action = action;

    normalizeHelpTopic(category, args);

    if (category === 'fs' && action === 'replace') normalizeFsReplaceArgs(args);
    if (category === 'block' && action === 'word_count') normalizeBlockWordCountArgs(args);
    if (category === 'flashcard' && (action === 'create_card' || action === 'remove_card')) normalizeFlashcardBlockIdsArgs(args);
    if (category === 'flashcard' && action === 'review_card') normalizeFlashcardRating(args);
    if (category === 'file' && action === 'upload_asset') normalizeFileUploadAssetArgs(args);
    if (category === 'search' && action === 'search_refs') normalizeSearchRefsArgs(args);
    if (category === 'av' && (action === 'set_cells' || action === 'add_rows')) normalizeAvCellValueTypes(args);
    if (category === 'document' && action === 'query' && !hasOwn(args, 'notebooks') && nonEmptyString(args.notebook)) {
        args.notebooks = [args.notebook];
        delete args.notebook;
    }
    if (category === 'av' && action === 'search' && !hasOwn(args, 'keyword') && typeof args.query === 'string') {
        args.keyword = args.query;
        delete args.query;
    }

    return args;
}

export function getFlagAliasRules(context?: Partial<ArgumentAliasContext>): FlagAliasRule[] {
    if (!context?.category || !context.action) return [];
    const action = normalizeActionAlias(context.category, context.action);

    if ((context.category === 'fs' && action === 'read')
        || (context.category === 'document' && action === 'get_doc')) {
        return [
            { canonical: 'page', aliases: ['page'], schema: INTEGER_SCHEMA },
            { canonical: 'pageSize', aliases: ['page-size', 'page_size', 'pageSize'], schema: INTEGER_SCHEMA },
        ];
    }

    if (context.category === 'fs' && action === 'replace') {
        return [
            { canonical: 'old', aliases: ['old'], schema: STRING_SCHEMA },
            { canonical: 'new', aliases: ['new'], schema: STRING_SCHEMA },
            { canonical: 'replace_all', aliases: ['replace-all', 'replace_all', 'replaceAll'], schema: BOOLEAN_SCHEMA },
        ];
    }


    // document combines actions that use both parentID and parentId in one
    // aggregated CLI schema. Their kebab/snake aliases collide, so pin this
    // action to its exact MCP contract.
    if (context.category === 'document' && action === 'ensure_link_targets') {
        return [
            { canonical: 'parentId', aliases: ['parentID', 'parent-id', 'parent_id'], schema: STRING_SCHEMA },
        ];
    }

    if (context.category === 'block' && action === 'word_count') {
        return [
            { canonical: 'ids', aliases: ['id'], schema: { type: 'array', items: STRING_SCHEMA } },
        ];
    }

    if (context.category === 'flashcard' && (action === 'create_card' || action === 'remove_card')) {
        return [
            { canonical: 'blockIDs', aliases: ['blockID', 'block-id', 'block_id'], schema: { type: 'array', items: STRING_SCHEMA } },
        ];
    }

    if (context.category === 'file' && action === 'upload_asset') {
        return [
            { canonical: 'localFilePath', aliases: ['file'], schema: STRING_SCHEMA },
        ];
    }

    if (context.category === 'document' && action === 'query') {
        return [
            { canonical: 'notebooks', aliases: ['notebook'], schema: { type: 'array', items: STRING_SCHEMA } },
        ];
    }

    if (context.category === 'av' && action === 'search') {
        return [
            { canonical: 'keyword', aliases: ['query'], schema: STRING_SCHEMA },
        ];
    }

    if (context.category === 'search' && action === 'search_refs') {
        return [
            { canonical: 'k', aliases: ['keyword', 'query'], schema: STRING_SCHEMA },
        ];
    }

    return [];
}
