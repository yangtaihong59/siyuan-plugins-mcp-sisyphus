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

function normalizeAvRenderArgs(args: Record<string, unknown>): void {
    if (!hasOwn(args, 'id') && nonEmptyString(args.avID)) {
        args.id = args.avID;
    }
    delete args.avID;
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
    if (category === 'av' && action === 'render') normalizeAvRenderArgs(args);
    if (category === 'block' && action === 'word_count') normalizeBlockWordCountArgs(args);
    if (category === 'flashcard' && (action === 'create_card' || action === 'remove_card')) normalizeFlashcardBlockIdsArgs(args);
    if (category === 'file' && action === 'upload_asset') normalizeFileUploadAssetArgs(args);
    if (category === 'search' && action === 'search_refs') normalizeSearchRefsArgs(args);

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

    if (context.category === 'av' && action === 'render') {
        return [
            { canonical: 'id', aliases: ['avID', 'av-id', 'av_id'], schema: STRING_SCHEMA },
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

    return [];
}
