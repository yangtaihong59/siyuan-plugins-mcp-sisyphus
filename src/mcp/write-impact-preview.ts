/*
 * Write impact preview: a read-only description of what a strict write will
 * change, attached to every successful validateOnly preflight so a caller can
 * review it against the intent before committing.
 *
 * Contract:
 * - Never writes and never changes the preflight hash, lease or commitArgs.
 *   It only reads data the state probe already holds plus a few extra reads.
 * - Never fails a preflight: any error becomes `{ error }`.
 * - Independent of the preflight envelope, so a later phase can rebuild the
 *   same object after a commit and return it as a receipt.
 */
import * as avApi from '../api/av';
import * as blockApi from '../api/block';
import * as notebookApi from '../api/notebook';
import * as searchApi from '../api/search';
import type { SiYuanClient } from '../api/client';
import type { PermissionManager } from '../core/permissions';
import type { ToolCategory } from '../core/config';
import { resolveSearchMethod } from '../core/normalize';
import { stripSafetyFields } from '../core/write-safety-fields';
import { collectPathSelectors, collectTargetSelectors, isRecord, sqlString, type StateProbe } from '../core/write-safety-records';
import { toEditableMarkdownBlock } from '../tools/internal/kramdown-safe';
import { findReplacePattern, readFindReplaceKramdowns, stripKramdownIals } from '../tools/search/find-replace-count';
import { preservableAttrs, updateRestoresAttrs } from '../tools/internal/helpers/preserved-attrs';
import { queryTagCarrierRows } from '../tools/tag/handlers';
import type { prepareDocumentConversion } from '../tools/document/conversion';
import { normalizeDocumentCoverSource } from '../tools/document/handlers';

export type WritePreviewDetail = 'summary' | 'full';

export const WRITE_PREVIEW_DETAILS: readonly WritePreviewDetail[] = ['summary', 'full'];

export const WRITE_PREVIEW_RISKS = [
    'deletes',
    'empties_source',
    'cross_notebook',
    'irreversible',
    'large_batch',
    'workspace_wide',
    'overwrites_content',
] as const;
export type WritePreviewRisk = typeof WRITE_PREVIEW_RISKS[number];

/** Summary detail limits: one list shows at most this many entries. */
export const PREVIEW_LIST_LIMIT = 5;
/** Summary detail limits: excerpts are cut to this many characters. */
export const PREVIEW_TEXT_LIMIT = 200;
/** More affected items than this raises `large_batch`. */
export const PREVIEW_LARGE_BATCH = 20;
/** Hard cap on find_replace examples even for preview="full" (one per match). */
export const FIND_REPLACE_FULL_EXAMPLE_CAP = 200;

export interface WritePreviewNotebook {
    id: string;
    name?: string;
    /** This client's permission on the notebook (none / r / rw / rwd). */
    permission?: string;
}

export interface WritePreviewTarget {
    id: string;
    kind: 'document' | 'block' | 'av' | 'notebook' | 'tag' | 'path';
    title?: string;
    excerpt?: string;
    hPath?: string;
    /** Block targets: ordinal among the parent's children and the nearest preceding heading. */
    position?: string;
    /** find_replace: matches inside this scope id. */
    matchCount?: number;
    notebook?: WritePreviewNotebook;
}

export interface WritePreviewChange {
    kind: string;
    /** One human-readable line; the remaining fields are its structured detail. */
    summary: string;
    [key: string]: unknown;
}

export interface WriteImpactPreview {
    detail: WritePreviewDetail;
    targets: WritePreviewTarget[];
    /** Present when summary detail listed fewer targets than exist. */
    targetCount?: number;
    changes: WritePreviewChange[];
    risk: WritePreviewRisk[];
}

export type WriteImpactPreviewResult = WriteImpactPreview | { error: string };

type DocumentConversion = Awaited<ReturnType<typeof prepareDocumentConversion>>;

export interface WriteImpactPreviewInput {
    client: SiYuanClient;
    permMgr: PermissionManager;
    category: ToolCategory;
    action: string;
    /** Raw call arguments; safety fields are stripped here. */
    args: Record<string, unknown>;
    /** The preflight state probe, when the action has a precondition. */
    before?: StateProbe;
    conversion?: DocumentConversion;
    detail?: WritePreviewDetail;
}

/** Read the optional `preview` argument; anything but "full" is the summary. */
export function readPreviewDetail(args: Record<string, unknown>): WritePreviewDetail {
    return args.preview === 'full' ? 'full' : 'summary';
}

/*
 * No wall-clock timeout of its own: every read goes through the client's
 * request timeout (and the kernel task's read budget), and the kernel sandbox
 * may lack real timers. A failed or exhausted read degrades to `{ error }`.
 */
export async function buildWriteImpactPreview(input: WriteImpactPreviewInput): Promise<WriteImpactPreviewResult> {
    try {
        return await buildPreview(input);
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

const ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;

interface BlockRow {
    id: string;
    type?: string;
    subtype?: string;
    content?: string;
    hpath?: string;
    box?: string;
    root_id?: string;
    parent_id?: string;
    path?: string;
}

interface BuilderResult {
    changes: WritePreviewChange[];
    /** Explicit targets; otherwise targetIds (or the argument selectors) are resolved. */
    targets?: WritePreviewTarget[];
    /** Total behind a pre-capped `targets` list. */
    targetTotal?: number;
    targetIds?: string[];
    risk?: WritePreviewRisk[];
    /** Number of affected items, for large_batch. */
    itemCount?: number;
}

type Builder = (ctx: PreviewContext) => Promise<BuilderResult | undefined>;

class PreviewContext {
    readonly args: Record<string, unknown>;
    readonly state: Record<string, unknown>;
    readonly detail: WritePreviewDetail;
    readonly listLimit: number;
    readonly textLimit: number;
    private notebookList?: Promise<Array<{ id: string; name: string; closed: boolean }>>;
    private readonly rowCache = new Map<string, BlockRow | null>();
    private readonly siblingCache = new Map<string, Promise<Array<{ id: string; type?: string; content?: string }>>>();

    constructor(readonly input: WriteImpactPreviewInput) {
        this.args = stripSafetyFields(input.args);
        delete this.args.preview;
        this.state = input.before?.state ?? {};
        this.detail = input.detail ?? readPreviewDetail(input.args);
        this.listLimit = this.detail === 'full' ? Number.POSITIVE_INFINITY : PREVIEW_LIST_LIMIT;
        this.textLimit = this.detail === 'full' ? Number.POSITIVE_INFINITY : PREVIEW_TEXT_LIMIT;
    }

    get client(): SiYuanClient { return this.input.client; }

    /** Summary detail collapses whitespace and truncates; full detail keeps the text. */
    text(value: string, limit = this.textLimit): string {
        if (this.detail === 'full') return value;
        const flat = value.replace(/\s+/g, ' ').trim();
        return flat.length <= limit ? flat : `${flat.slice(0, Math.max(0, limit - 1))}…`;
    }

    /** Short inline label for summaries, always truncated. */
    label(value: string | undefined, fallback: string): string {
        const flat = (value ?? '').replace(/\s+/g, ' ').trim();
        if (!flat) return fallback;
        return flat.length <= 60 ? `«${flat}»` : `«${flat.slice(0, 59)}…»`;
    }

    cap<T>(items: T[]): { shown: T[]; omitted: number } {
        if (items.length <= this.listLimit) return { shown: items, omitted: 0 };
        return { shown: items.slice(0, this.listLimit), omitted: items.length - this.listLimit };
    }

    string(key: string): string | undefined {
        const value = this.args[key];
        return typeof value === 'string' && value ? value : undefined;
    }

    strings(key: string): string[] {
        const value = this.args[key];
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
    }

    liveBlock(id: string): Record<string, unknown> | undefined {
        const live = this.state.liveBlocks;
        if (!isRecord(live)) return undefined;
        const block = live[id];
        return isRecord(block) && block.missing !== true ? block : undefined;
    }

    /** Current block kramdown, from the probe when it holds it. */
    async kramdown(id: string): Promise<string> {
        const live = this.liveBlock(id);
        if (isRecord(live?.kramdown) && typeof live.kramdown.kramdown === 'string') return live.kramdown.kramdown;
        const read = await blockApi.getBlockKramdown(this.client, id).catch(() => undefined);
        return typeof read?.kramdown === 'string' ? read.kramdown : '';
    }

    /** Editable Markdown with IALs stripped. */
    async markdown(id: string): Promise<string> {
        return editableMarkdown(await this.kramdown(id));
    }

    async children(id: string): Promise<Array<{ id: string; type?: string; subtype?: string }>> {
        const live = this.liveBlock(id);
        const raw = Array.isArray(live?.children)
            ? live.children
            : await blockApi.getChildBlocks(this.client, id).catch(() => []);
        return (Array.isArray(raw) ? raw : []).flatMap((child) => isRecord(child) && typeof child.id === 'string'
            ? [{ id: child.id, type: typeof child.type === 'string' ? child.type : undefined, subtype: typeof child.subtype === 'string' ? child.subtype : typeof child.subType === 'string' ? child.subType : undefined }]
            : []);
    }

    async notebooks(): Promise<Array<{ id: string; name: string; closed: boolean }>> {
        this.notebookList ??= notebookApi.listNotebooks(this.client)
            .then((listed) => (listed?.notebooks ?? []).map((item) => ({
                id: String(item.id ?? ''),
                name: String(item.name ?? ''),
                closed: item.closed === true,
            })))
            .catch(() => []);
        return this.notebookList;
    }

    async notebook(id: string | undefined): Promise<WritePreviewNotebook | undefined> {
        if (!id) return undefined;
        const found = (await this.notebooks()).find((item) => item.id === id);
        return { id, ...(found?.name ? { name: found.name } : {}), ...this.permission(id) };
    }

    /**
     * Display only, never a gate: read the stored entry (unset = "r", as
     * PermissionManager.get) so a preview cannot look like a permission check.
     */
    private permission(id: string): { permission?: string } {
        const permMgr = this.input.permMgr;
        try {
            const explicit = typeof permMgr.getAll === 'function' ? permMgr.getAll()[id] : undefined;
            const permission = explicit ?? (typeof permMgr.getAll === 'function' ? 'r' : permMgr.get(id));
            return permission ? { permission } : {};
        } catch {
            return {};
        }
    }

    async notebookLabel(id: string | undefined): Promise<string> {
        if (!id) return 'unknown notebook';
        const found = (await this.notebooks()).find((item) => item.id === id);
        return found?.name ? `${found.name}` : id;
    }

    /** Block rows from the SQL index; the index can lag, so a missing row is not proof of absence. */
    async rows(ids: string[]): Promise<Map<string, BlockRow>> {
        const wanted = [...new Set(ids.filter((id) => ID_PATTERN.test(id)))];
        const missing = wanted.filter((id) => !this.rowCache.has(id));
        for (let index = 0; index < missing.length; index += 50) {
            const chunk = missing.slice(index, index + 50);
            const rows = await searchApi.querySQL(this.client,
                `SELECT id, type, subtype, content, hpath, box, root_id, parent_id, path FROM blocks WHERE id IN (${chunk.map(sqlString).join(',')}) LIMIT ${chunk.length}`,
            ).catch(() => []);
            for (const id of chunk) this.rowCache.set(id, null);
            for (const row of Array.isArray(rows) ? rows : []) {
                if (isRecord(row) && typeof row.id === 'string') this.rowCache.set(row.id, row as unknown as BlockRow);
            }
        }
        const out = new Map<string, BlockRow>();
        for (const id of wanted) {
            const row = this.rowCache.get(id);
            if (row) out.set(id, row);
        }
        return out;
    }

    async row(id: string | undefined): Promise<BlockRow | undefined> {
        if (!id) return undefined;
        return (await this.rows([id])).get(id);
    }

    /** "Notebook:/hpath" for a document or block. */
    async place(row: BlockRow | undefined): Promise<string> {
        if (!row) return 'an unindexed location';
        return `${await this.notebookLabel(row.box)}:${row.hpath || '/'}`;
    }

    async target(id: string): Promise<WritePreviewTarget> {
        const notebook = (await this.notebooks()).find((item) => item.id === id);
        if (notebook) return { id, kind: 'notebook', title: notebook.name, notebook: await this.notebook(id) };
        const row = await this.row(id);
        if (row) {
            const isDocument = row.type === 'd';
            const position = isDocument ? undefined : await this.position(row);
            return {
                id,
                kind: isDocument ? 'document' : 'block',
                ...(isDocument ? { title: row.content || undefined } : { excerpt: this.text(row.content ?? '', 80) }),
                ...(row.hpath ? { hPath: row.hpath } : {}),
                ...(position ? { position } : {}),
                ...(row.box ? { notebook: await this.notebook(row.box) } : {}),
            };
        }
        const info = this.liveBlock(id)?.info;
        if (isRecord(info)) {
            return {
                id,
                kind: info.rootID === id ? 'document' : 'block',
                ...(typeof info.rootTitle === 'string' && info.rootID === id ? { title: info.rootTitle } : {}),
                ...(typeof info.box === 'string' ? { notebook: await this.notebook(info.box) } : {}),
            };
        }
        return { id, kind: 'block' };
    }

    /** Ordered children of a parent, one read per parent per preview. */
    siblings(parentID: string): Promise<Array<{ id: string; type?: string; content?: string }>> {
        let cached = this.siblingCache.get(parentID);
        if (!cached) {
            cached = blockApi.getChildBlocks(this.client, parentID)
                .then((raw) => (Array.isArray(raw) ? raw : []).flatMap((child) => isRecord(child) && typeof child.id === 'string'
                    ? [{ id: child.id, type: typeof child.type === 'string' ? child.type : undefined, content: typeof child.content === 'string' ? child.content : undefined }]
                    : []))
                .catch(() => []);
            this.siblingCache.set(parentID, cached);
        }
        return cached;
    }

    /** "#3 of 4 in «Doc», under heading «H»" so a wrong-but-similar block is easier to spot. */
    async position(row: BlockRow): Promise<string | undefined> {
        if (!row.parent_id) return undefined;
        // The index stores a heading as the parent of its section, while the
        // document's child list is flat; try the document first.
        let topLevel = true;
        let siblings = row.root_id ? await this.siblings(row.root_id) : [];
        let index = siblings.findIndex((sibling) => sibling.id === row.id);
        if (index < 0) {
            topLevel = false;
            siblings = await this.siblings(row.parent_id);
            index = siblings.findIndex((sibling) => sibling.id === row.id);
        }
        if (index < 0) return undefined;
        const docTitle = (row.hpath ?? '').split('/').filter(Boolean).at(-1);
        const where = topLevel
            ? `top-level blocks in ${this.label(docTitle, 'the document')}`
            : 'children of its parent block';
        const heading = siblings.slice(0, index).reverse().find((sibling) => sibling.type === 'h');
        return `#${index + 1} of ${siblings.length} ${where}${heading ? `, under heading ${this.label(heading.content, heading.id)}` : ''}`;
    }

    async describeBlock(id: string | undefined): Promise<string> {
        if (!id) return 'unknown block';
        const row = await this.row(id);
        if (!row) return id;
        if (row.type === 'd') return `document ${this.label(row.content, id)}`;
        return this.label(row.content, id);
    }

    async avDefinition(avID: string): Promise<Record<string, unknown> | undefined> {
        const fromProbe = this.state.av;
        if (isRecord(fromProbe) && isRecord(fromProbe.av)) return fromProbe.av;
        const read = await avApi.getAttributeView(this.client, avID).catch(() => undefined);
        return isRecord(read) && isRecord(read.av) ? read.av : undefined;
    }
}

async function buildPreview(input: WriteImpactPreviewInput): Promise<WriteImpactPreview> {
    const ctx = new PreviewContext(input);
    const key = `${input.category}.${input.action}`;
    const specific = SPECIFIC_BUILDERS[key];
    const built = (specific ? await specific(ctx) : undefined) ?? await genericChange(ctx);

    const risk = new Set<WritePreviewRisk>(built.risk ?? []);
    for (const flag of baseRisks(ctx, input.category, input.action)) risk.add(flag);
    const itemCount = built.itemCount ?? argumentItemCount(ctx.args);
    if (itemCount > PREVIEW_LARGE_BATCH) risk.add('large_batch');

    let targets: WritePreviewTarget[];
    let targetTotal: number;
    if (built.targets) {
        targets = ctx.cap(built.targets).shown;
        targetTotal = Math.max(built.targets.length, built.targetTotal ?? 0);
    } else {
        const ids = [...new Set((built.targetIds ?? defaultTargetIds(ctx)).filter(Boolean))];
        const paths = built.targetIds ? [] : collectPathSelectors(ctx.args).filter((path) => !ID_PATTERN.test(path));
        const shownIds = ctx.cap(ids).shown;
        targets = await Promise.all(shownIds.map((id) => ctx.target(id)));
        const room = Math.max(0, ctx.listLimit - targets.length);
        targets.push(...paths.slice(0, room).map((path): WritePreviewTarget => ({ id: path, kind: 'path' })));
        targetTotal = ids.length + paths.length;
    }
    return {
        detail: ctx.detail,
        targets,
        ...(targetTotal > targets.length ? { targetCount: targetTotal } : {}),
        changes: built.changes,
        risk: WRITE_PREVIEW_RISKS.filter((flag) => risk.has(flag)),
    };
}

function defaultTargetIds(ctx: PreviewContext): string[] {
    const ids = collectTargetSelectors(ctx.args).filter((value) => ID_PATTERN.test(value));
    return [...new Set(ids)];
}

const ITEM_ARRAY_KEYS = ['ids', 'items', 'docs', 'rows', 'cells', 'rowIDs', 'srcIDs', 'blockIDs', 'fromIDs', 'fromPaths', 'paths', 'orderedIDs', 'orderedPaths', 'primaryKeyTexts'];

function argumentItemCount(args: Record<string, unknown>): number {
    return Math.max(1, ...ITEM_ARRAY_KEYS.map((key) => Array.isArray(args[key]) ? (args[key] as unknown[]).length : 0));
}

/**
 * `irreversible` marks writes that no Sisyphus action can undo and whose
 * previous state is not fully carried by this preview. Documents and blocks
 * are not marked: SiYuan keeps file history for them, and the preview shows
 * the replaced text.
 */
const IRREVERSIBLE_ACTIONS = new Set([
    'av.remove_rows',
    'av.remove_column',
    'av.set_column_options',
    'file.delete_asset',
    'file.remove_unused_assets',
    'file.delete_template',
    'notebook.remove',
    'tag.remove',
]);

const OVERWRITE_ACTIONS = new Set([
    'block.update',
    'block.replace',
    'fs.replace',
    'file.update_template',
    'av.set_column_options',
    'av.update_view',
    'av.set_new_item_templates',
]);

function baseRisks(ctx: PreviewContext, category: ToolCategory, action: string): WritePreviewRisk[] {
    const key = `${category}.${action}`;
    const risks: WritePreviewRisk[] = [];
    if (/^(delete|remove|rm)(_|$)/.test(action)) risks.push('deletes');
    if (IRREVERSIBLE_ACTIONS.has(key)) risks.push('irreversible');
    if (OVERWRITE_ACTIONS.has(key)) risks.push('overwrites_content');
    if ((key === 'fs.write' || key === 'file.create_template') && ctx.args.overwrite === true) risks.push('overwrites_content');
    if (category === 'tag' || category === 'system' || key === 'file.remove_unused_assets') risks.push('workspace_wide');
    if (key === 'search.find_replace' && (ctx.strings('ids').length === 0 || ctx.strings('paths').length > 0)) risks.push('workspace_wide');
    return risks;
}

/* ------------------------------------------------------------------ */
/*  Generic fallback                                                  */
/* ------------------------------------------------------------------ */

/** Additive actions read "will create … in X" rather than "will modify X". */
const CREATE_LIKE_ACTION = /^(create|append|prepend|insert|add|duplicate|upload|copy)(_|$)/;

async function genericChange(ctx: PreviewContext): Promise<BuilderResult> {
    const { category, action } = ctx.input;
    const verb = CREATE_LIKE_ACTION.test(action) ? 'will create content in' : 'will modify';
    if (category === 'av' && ctx.string('avID')) {
        // Name the database instead of resolving its ID as if it were a block.
        const { targets } = await avBase(ctx);
        const name = targets[0]?.title;
        return {
            changes: [{ kind: 'generic', summary: `av.${action} ${verb} database ${ctx.label(name, ctx.string('avID')!)}.`, args: keyArgs(ctx) }],
            targets,
        };
    }
    const ids = defaultTargetIds(ctx);
    const names = await Promise.all(ctx.cap(ids).shown.map((id) => ctx.describeBlock(id)));
    const paths = collectPathSelectors(ctx.args).filter((path) => !ID_PATTERN.test(path));
    const described = [...names, ...paths.map((path) => ctx.label(path, path))];
    const more = ids.length > names.length ? ` and ${ids.length - names.length} more` : '';
    const summary = described.length > 0
        ? `${category}.${action} ${verb} ${described.join(', ')}${more}.`
        : `${category}.${action} will apply the arguments below.`;
    return { changes: [{ kind: 'generic', summary, args: keyArgs(ctx) }] };
}

/** The caller's business arguments, excerpted for review. */
function keyArgs(ctx: PreviewContext): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ctx.args)) {
        if (key === 'action' || value === undefined) continue;
        out[key] = excerptValue(ctx, value);
    }
    return out;
}

function excerptValue(ctx: PreviewContext, value: unknown): unknown {
    if (typeof value === 'string') return ctx.text(value);
    if (Array.isArray(value)) {
        const { shown, omitted } = ctx.cap(value);
        const items = shown.map((item) => excerptValue(ctx, item));
        return omitted > 0 ? [...items, `… ${omitted} more`] : items;
    }
    if (isRecord(value)) {
        if (ctx.detail === 'full') return value;
        const json = JSON.stringify(value);
        return json.length <= PREVIEW_TEXT_LIMIT ? value : ctx.text(json);
    }
    return value;
}

/* ------------------------------------------------------------------ */
/*  Content overwrites                                                */
/* ------------------------------------------------------------------ */

function editableMarkdown(kramdown: string): string {
    if (!kramdown) return '';
    let text: string;
    try {
        text = toEditableMarkdownBlock({ kramdown });
    } catch {
        text = kramdown;
    }
    return stripKramdownIals(text).trim();
}

function domToText(dom: string): string {
    return dom
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function omittedChange(omitted: number, noun: string): WritePreviewChange[] {
    return omitted > 0 ? [{ kind: 'omitted', summary: `… and ${omitted} more ${noun} (use preview="full" to list all).` }] : [];
}

async function previewBlockUpdate(ctx: PreviewContext): Promise<BuilderResult> {
    const items = Array.isArray(ctx.args.items)
        ? ctx.args.items.filter(isRecord)
        : [{ id: ctx.args.id, dataType: ctx.args.dataType, data: ctx.args.data }];
    const { shown, omitted } = ctx.cap(items);
    const changes: WritePreviewChange[] = [];
    for (const item of shown) {
        const id = typeof item.id === 'string' ? item.id : '';
        const data = typeof item.data === 'string' ? item.data : '';
        const before = await ctx.markdown(id);
        const after = item.dataType === 'dom' ? domToText(data) : data.trim();
        const attrs = Object.keys(preservableAttrs(ctx.liveBlock(id)?.attrs as Record<string, string> | undefined)).sort();
        const restores = updateRestoresAttrs(item.dataType, data);
        const attrNote = attrs.length === 0
            ? ''
            : restores
                ? ` User attributes ${attrs.join(', ')} are kept (restored after the update).`
                : ` User attributes ${attrs.join(', ')} exist; ${item.dataType === 'dom' ? 'DOM input' : 'Markdown with its own {: } IAL'} is written as given, so they are not restored.`;
        changes.push({
            kind: 'content_update',
            summary: `Replaces the content of block ${ctx.label(before, id)} (${before.length} → ${after.length} chars).${after ? '' : ' The block becomes empty.'}${attrNote}`,
            id,
            before: ctx.text(before),
            after: ctx.text(after),
            ...(attrs.length > 0 ? { userAttributes: attrs, attributesRestored: restores } : {}),
        });
    }
    changes.push(...omittedChange(omitted, 'blocks'));
    return { changes, targetIds: items.flatMap((item) => typeof item.id === 'string' ? [item.id] : []), itemCount: items.length };
}

interface EditOutcome {
    index: number;
    occurrences: number;
    replaced: number;
    examples: Array<{ before: string; after: string }>;
}

/** Apply exact edits like the handlers do, but never throw: an unmatched edit is reported. */
function applyEditsForPreview(
    ctx: PreviewContext,
    content: string,
    edits: Array<Record<string, unknown>>,
): { after: string; outcomes: EditOutcome[] } {
    let current = content;
    const outcomes: EditOutcome[] = [];
    edits.forEach((edit, index) => {
        const oldText = typeof edit.old === 'string' ? edit.old : '';
        const newText = typeof edit.new === 'string' ? edit.new : '';
        const positions: number[] = [];
        if (oldText) {
            for (let at = current.indexOf(oldText); at >= 0; at = current.indexOf(oldText, at + oldText.length)) positions.push(at);
        }
        const replaceAll = edit.replace_all === true;
        const used = replaceAll ? positions : positions.slice(0, 1);
        const examples = ctx.cap(used).shown.map((at) => contextPair(ctx, current, at, oldText.length, newText));
        if (used.length > 0) {
            current = replaceAll
                ? current.split(oldText).join(newText)
                : `${current.slice(0, used[0])}${newText}${current.slice(used[0] + oldText.length)}`;
        }
        outcomes.push({ index: index + 1, occurrences: positions.length, replaced: used.length, examples });
    });
    return { after: current, outcomes };
}

const CONTEXT_CHARS = 60;

function contextPair(ctx: PreviewContext, text: string, at: number, length: number, replacement: string): { before: string; after: string } {
    const start = Math.max(0, at - CONTEXT_CHARS);
    const end = Math.min(text.length, at + length + CONTEXT_CHARS);
    const prefix = `${start > 0 ? '…' : ''}${text.slice(start, at)}`;
    const suffix = `${text.slice(at + length, end)}${end < text.length ? '…' : ''}`;
    return {
        before: ctx.text(`${prefix}${text.slice(at, at + length)}${suffix}`, PREVIEW_TEXT_LIMIT),
        after: ctx.text(`${prefix}${replacement}${suffix}`, PREVIEW_TEXT_LIMIT),
    };
}

function editsOf(ctx: PreviewContext): Array<Record<string, unknown>> {
    const edit = ctx.args.edit;
    return (Array.isArray(edit) ? edit : [edit]).filter(isRecord);
}

function editSummary(outcomes: EditOutcome[]): string {
    const unmatched = outcomes.filter((outcome) => outcome.occurrences === 0).map((outcome) => `#${outcome.index}`);
    const replaced = outcomes.reduce((total, outcome) => total + outcome.replaced, 0);
    return `${outcomes.length} edit(s), ${replaced} replacement(s).${unmatched.length > 0 ? ` Edit ${unmatched.join(', ')} does not match the current text, so the commit will be rejected.` : ''}`;
}

async function previewBlockReplace(ctx: PreviewContext): Promise<BuilderResult> {
    const id = ctx.string('id') ?? '';
    const before = await ctx.markdown(id);
    const { after, outcomes } = applyEditsForPreview(ctx, before, editsOf(ctx));
    const attrs = Object.keys(preservableAttrs(ctx.liveBlock(id)?.attrs as Record<string, string> | undefined)).sort();
    return {
        changes: [{
            kind: 'content_replace',
            summary: `Edits block ${ctx.label(before, id)}: ${editSummary(outcomes)}${attrs.length > 0 ? ` User attributes ${attrs.join(', ')} are kept.` : ''}`,
            id,
            ...(attrs.length > 0 ? { userAttributes: attrs, attributesRestored: true } : {}),
            before: ctx.text(before),
            after: ctx.text(after),
            edits: outcomes,
        }],
        targetIds: [id],
    };
}

function fsPathState(ctx: PreviewContext, path: string | undefined): Record<string, unknown> | undefined {
    const paths = ctx.state.fsPaths;
    if (!path || !isRecord(paths)) return undefined;
    const entry = paths[path];
    return isRecord(entry) ? entry : undefined;
}

async function fsTarget(ctx: PreviewContext, path: string): Promise<WritePreviewTarget> {
    const entry = fsPathState(ctx, path);
    if (entry && typeof entry.rootID === 'string' && entry.missing !== true) {
        const target = await ctx.target(entry.rootID);
        return { ...target, hPath: target.hPath ?? (typeof entry.hpath === 'string' ? entry.hpath : undefined) };
    }
    return {
        id: path,
        kind: 'path',
        ...(entry && typeof entry.notebookID === 'string' ? { notebook: await ctx.notebook(entry.notebookID) } : {}),
    };
}

async function previewFsWrite(ctx: PreviewContext): Promise<BuilderResult | undefined> {
    const path = ctx.string('path');
    const entry = fsPathState(ctx, path);
    if (ctx.args.overwrite !== true || !path || !entry || entry.missing === true) return undefined;
    const before = typeof entry.markdown === 'string' ? entry.markdown : '';
    const after = typeof ctx.args.markdown === 'string' ? ctx.args.markdown.trim() : '';
    const blockCount = Array.isArray(entry.blocks) ? entry.blocks.length : undefined;
    return {
        changes: [{
            kind: 'content_overwrite',
            summary: `Replaces the whole body of ${path}${blockCount !== undefined ? ` (${blockCount} blocks now)` : ''} (${before.length} → ${after.length} chars); the document node, title and document attributes stay. Existing content blocks are deleted and recreated, so their block IDs, references to them and block attributes do not carry over.${after ? '' : ' The document becomes empty.'}`,
            path,
            before: ctx.text(before),
            after: ctx.text(after),
        }],
        targets: [await fsTarget(ctx, path)],
        risk: after ? [] : ['empties_source'],
    };
}

async function previewFsReplace(ctx: PreviewContext): Promise<BuilderResult | undefined> {
    const path = ctx.string('path');
    const entry = fsPathState(ctx, path);
    if (!path || !entry || entry.missing === true) return undefined;
    const before = typeof entry.markdown === 'string' ? entry.markdown : '';
    const { after, outcomes } = applyEditsForPreview(ctx, before, editsOf(ctx));
    return {
        changes: [{
            kind: 'content_replace',
            summary: `Edits ${path}: ${editSummary(outcomes)} User attributes (custom-*, name, alias, memo, bookmark) of edited blocks are kept.`,
            path,
            edits: outcomes,
            ...(ctx.detail === 'full' ? { before, after } : {}),
        }],
        targets: [await fsTarget(ctx, path)],
    };
}

/* ------------------------------------------------------------------ */
/*  Deletions                                                         */
/* ------------------------------------------------------------------ */

async function countChildDocuments(ctx: PreviewContext, row: BlockRow | undefined): Promise<number | undefined> {
    if (!row?.box || !row.path) return undefined;
    const prefix = `${row.path.replace(/\.sy$/i, '')}/`;
    const rows = await searchApi.querySQL(ctx.client,
        `SELECT COUNT(*) AS n FROM blocks WHERE type = 'd' AND box = ${sqlString(row.box)} AND path LIKE ${sqlString(`${prefix.replace(/[%_]/g, '')}%`)}`,
    ).catch(() => undefined);
    const first = Array.isArray(rows) ? rows[0] : undefined;
    return isRecord(first) && first.n !== undefined ? Number(first.n) : undefined;
}

async function countDocumentBlocks(ctx: PreviewContext, ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const rows = await searchApi.querySQL(ctx.client,
        `SELECT root_id, COUNT(*) AS n FROM blocks WHERE root_id IN (${ids.map(sqlString).join(',')}) GROUP BY root_id LIMIT ${ids.length}`,
    ).catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) {
        if (isRecord(row) && typeof row.root_id === 'string') out.set(row.root_id, Number(row.n));
    }
    return out;
}

async function previewBlockDelete(ctx: PreviewContext): Promise<BuilderResult> {
    const id = ctx.string('id') ?? '';
    const [row, children, markdown] = await Promise.all([ctx.row(id), ctx.children(id), ctx.markdown(id)]);
    const kind = row?.type === 'd' ? 'document root' : row?.type ? `${row.type} block` : 'block';
    return {
        changes: [{
            kind: 'delete',
            summary: `Deletes ${kind} ${ctx.label(markdown || row?.content, id)} in ${await ctx.place(row)}${children.length > 0 ? ` together with its ${children.length} child block(s)` : ''}.`,
            id,
            childBlockCount: children.length,
            before: ctx.text(markdown),
            recovery: row?.type === 'd' ? DOCUMENT_REMOVE_RECOVERY : BLOCK_DELETE_RECOVERY,
        }],
        targetIds: [id],
    };
}

/*
 * Verified on SiYuan 3.8.8: removing a document copies its .sy file and those
 * of its child documents into the file history at once (op "delete"), and
 * rolling that entry back restores the document with its ID and path. A
 * block delete writes no history entry; only the periodic snapshot of changed
 * documents (editor.generateHistoryInterval) may hold an older version.
 */
const DOCUMENT_REMOVE_RECOVERY = 'SiYuan copies the removed document(s), child documents included, into its file history (File history → deleted; kept per its history retention setting) and can restore them from there. This tool cannot undo it.';
const BLOCK_DELETE_RECOVERY = 'Not undoable through this tool, and SiYuan saves no copy at delete time; an older version of the document may be in SiYuan file history (periodic snapshots of changed documents). Keep the before text if you may need it.';

/** The index counts the document root itself; readers count only what is in it. */
function contentBlocks(indexed: number): string {
    const n = Math.max(0, indexed - 1);
    return `${n} content block${n === 1 ? '' : 's'}`;
}

/** Say "no child documents" too: a reader cannot tell 0 from "not counted" otherwise. */
function childDocumentsClause(count: number | undefined): string {
    if (count === undefined) return '';
    return count > 0 ? ` and its ${count} child document(s), which are removed with it` : '; it has no child documents';
}

async function deleteDocumentsChange(ctx: PreviewContext, docs: BlockRow[], requested: string[]): Promise<BuilderResult> {
    const blockCounts = await countDocumentBlocks(ctx, docs.map((doc) => doc.id));
    const { shown, omitted } = ctx.cap(docs);
    const changes: WritePreviewChange[] = [];
    let total = 0;
    for (const doc of shown) {
        const childDocuments = await countChildDocuments(ctx, doc);
        const blocks = blockCounts.get(doc.id);
        total += 1 + (childDocuments ?? 0);
        changes.push({
            kind: 'delete',
            summary: `Removes document ${ctx.label(doc.content, doc.id)} at ${await ctx.place(doc)}${blocks !== undefined ? ` (${contentBlocks(blocks)})` : ''}${childDocumentsClause(childDocuments)}.`,
            id: doc.id,
            title: doc.content,
            ...(blocks !== undefined ? { blockCount: blocks } : {}),
            ...(childDocuments !== undefined ? { childDocumentCount: childDocuments } : {}),
        });
    }
    const unresolved = requested.length - docs.length;
    if (unresolved > 0) changes.push({ kind: 'note', summary: `${unresolved} requested document(s) are not in the search index yet; their content is not counted here.` });
    changes.push(...omittedChange(omitted, 'documents'));
    if (changes.length > 0) changes[changes.length - 1] = { ...changes[changes.length - 1], recovery: DOCUMENT_REMOVE_RECOVERY };
    return { changes, targetIds: docs.map((doc) => doc.id), itemCount: Math.max(total, requested.length) };
}

async function previewDocumentRemove(ctx: PreviewContext): Promise<BuilderResult> {
    const ids = ctx.strings('ids').length > 0 ? ctx.strings('ids') : ctx.string('id') ? [ctx.string('id')!] : [];
    if (ids.length > 0) {
        const rows = await ctx.rows(ids);
        return deleteDocumentsChange(ctx, ids.flatMap((id) => rows.get(id) ? [rows.get(id)!] : []), ids);
    }
    const paths = ctx.strings('paths').length > 0 ? ctx.strings('paths') : ctx.string('path') ? [ctx.string('path')!] : [];
    const notebook = ctx.string('notebook');
    const rows = paths.length === 0 ? [] : await searchApi.querySQL(ctx.client,
        `SELECT id, type, subtype, content, hpath, box, root_id, parent_id, path FROM blocks WHERE type = 'd'${notebook ? ` AND box = ${sqlString(notebook)}` : ''} AND path IN (${paths.map(sqlString).join(',')}) LIMIT ${paths.length * 4}`,
    ).catch(() => []);
    const docs = (Array.isArray(rows) ? rows : []).filter((row): row is BlockRow => isRecord(row) && typeof row.id === 'string') as BlockRow[];
    return deleteDocumentsChange(ctx, docs, paths);
}

async function previewFsRm(ctx: PreviewContext): Promise<BuilderResult | undefined> {
    const path = ctx.string('path');
    const entry = fsPathState(ctx, path);
    if (!path || !entry || typeof entry.rootID !== 'string') return undefined;
    const row = await ctx.row(entry.rootID);
    const childDocuments = await countChildDocuments(ctx, row);
    const blocks = Array.isArray(entry.blocks) ? entry.blocks.length : undefined;
    return {
        changes: [{
            kind: 'delete',
            summary: `Removes document ${path}${blocks !== undefined ? ` (${contentBlocks(blocks + 1)})` : ''}${childDocumentsClause(childDocuments)}.`,
            id: entry.rootID,
            ...(blocks !== undefined ? { blockCount: blocks } : {}),
            ...(childDocuments !== undefined ? { childDocumentCount: childDocuments } : {}),
            recovery: DOCUMENT_REMOVE_RECOVERY,
        }],
        targets: [await fsTarget(ctx, path)],
        itemCount: 1 + (childDocuments ?? 0),
    };
}

/* ------------------------------------------------------------------ */
/*  Moves                                                             */
/* ------------------------------------------------------------------ */

function siblingBefore(ctx: PreviewContext, parentID: string | undefined, id: string): string | undefined {
    const order = ctx.state.siblingOrder;
    if (!parentID || !isRecord(order) || !Array.isArray(order[parentID])) return undefined;
    const siblings = order[parentID] as unknown[];
    const index = siblings.indexOf(id);
    return index > 0 && typeof siblings[index - 1] === 'string' ? siblings[index - 1] as string : undefined;
}

async function blockLocation(ctx: PreviewContext, parentID: string | undefined, previousID: string | undefined): Promise<{ text: string; box?: string }> {
    const anchor = previousID ? await ctx.row(previousID) : undefined;
    const parent = parentID ? await ctx.row(parentID) : anchor?.parent_id ? await ctx.row(anchor.parent_id) : undefined;
    const doc = anchor ?? parent;
    const where = await ctx.place(doc);
    if (previousID) return { text: `${where}, after ${await ctx.describeBlock(previousID)}`, box: doc?.box };
    if (parentID) return { text: `${where}, first inside ${await ctx.describeBlock(parentID)}`, box: doc?.box };
    return { text: where, box: doc?.box };
}

async function previewBlockMove(ctx: PreviewContext): Promise<BuilderResult> {
    const moved = ctx.strings('ids').length > 0 ? ctx.strings('ids') : ctx.string('id') ? [ctx.string('id')!] : [];
    const rows = await ctx.rows([...moved, ...[ctx.string('parentID'), ctx.string('previousID')].filter((id): id is string => !!id)]);
    const to = await blockLocation(ctx, ctx.string('parentID'), ctx.string('previousID'));
    const { shown, omitted } = ctx.cap(moved);
    const changes: WritePreviewChange[] = [];
    let crossNotebook = false;
    for (const id of shown) {
        const row = rows.get(id);
        const from = await blockLocation(ctx, row?.parent_id, siblingBefore(ctx, row?.parent_id, id));
        if (row?.box && to.box && row.box !== to.box) crossNotebook = true;
        changes.push({
            kind: 'move',
            summary: `Moves ${await ctx.describeBlock(id)} from ${from.text} to ${to.text}.`,
            id,
            from: from.text,
            to: to.text,
        });
    }
    changes.push(...omittedChange(omitted, 'blocks'));
    return { changes, targetIds: moved, itemCount: moved.length, risk: crossNotebook ? ['cross_notebook'] : [] };
}

async function previewDocumentMove(ctx: PreviewContext): Promise<BuilderResult> {
    let sources: BlockRow[] = [];
    const fromIDs = ctx.strings('fromIDs');
    const fromPaths = ctx.strings('fromPaths');
    if (fromIDs.length > 0) {
        const rows = await ctx.rows(fromIDs);
        sources = fromIDs.flatMap((id) => rows.get(id) ? [rows.get(id)!] : []);
    } else if (fromPaths.length > 0) {
        const rows = await searchApi.querySQL(ctx.client,
            `SELECT id, type, subtype, content, hpath, box, root_id, parent_id, path FROM blocks WHERE type = 'd' AND path IN (${fromPaths.map(sqlString).join(',')}) LIMIT ${fromPaths.length * 4}`,
        ).catch(() => []);
        sources = (Array.isArray(rows) ? rows : []).filter((row) => isRecord(row) && typeof row.id === 'string') as unknown as BlockRow[];
    }

    let destinationBox: string | undefined;
    let destinationHPath = '/';
    const toID = ctx.string('toID');
    if (toID) {
        const notebook = (await ctx.notebooks()).find((item) => item.id === toID);
        if (notebook) destinationBox = toID;
        else {
            const row = await ctx.row(toID);
            destinationBox = row?.box;
            destinationHPath = row?.hpath ?? `/(document ${toID})`;
        }
    } else {
        destinationBox = ctx.string('toNotebook');
        const toPath = ctx.string('toPath') ?? '/';
        if (toPath !== '/' && destinationBox) {
            const rows = await searchApi.querySQL(ctx.client,
                `SELECT hpath FROM blocks WHERE type = 'd' AND box = ${sqlString(destinationBox)} AND path = ${sqlString(toPath)} LIMIT 1`,
            ).catch(() => []);
            const first = Array.isArray(rows) ? rows[0] : undefined;
            destinationHPath = isRecord(first) && typeof first.hpath === 'string' ? first.hpath : toPath;
        }
    }
    const destinationNotebook = await ctx.notebookLabel(destinationBox);
    const under = destinationHPath === '/' ? `${destinationNotebook}:/ (notebook root)` : `${destinationNotebook}:${destinationHPath}`;
    const { shown, omitted } = ctx.cap(sources);
    const changes: WritePreviewChange[] = [];
    let crossNotebook = false;
    let total = 0;
    for (const doc of shown) {
        if (doc.box && destinationBox && doc.box !== destinationBox) crossNotebook = true;
        const childDocuments = await countChildDocuments(ctx, doc);
        total += 1 + (childDocuments ?? 0);
        const toText = `${destinationNotebook}:${destinationHPath === '/' ? '' : destinationHPath}/${doc.content ?? doc.id}`;
        changes.push({
            kind: 'move',
            summary: `Moves document ${ctx.label(doc.content, doc.id)} from ${await ctx.place(doc)} to ${toText}${childDocuments ? ` with its ${childDocuments} child document(s)` : ''}.`,
            id: doc.id,
            from: await ctx.place(doc),
            to: toText,
        });
    }
    if (sources.length === 0) changes.push({ kind: 'move', summary: `Moves ${fromIDs.length || fromPaths.length} document(s) under ${under}.`, to: under });
    changes.push(...omittedChange(omitted, 'documents'));
    return {
        changes,
        targetIds: [...sources.map((doc) => doc.id), ...(toID ? [toID] : destinationBox ? [destinationBox] : [])],
        itemCount: Math.max(total, sources.length),
        risk: crossNotebook ? ['cross_notebook'] : [],
    };
}

async function previewFsMv(ctx: PreviewContext): Promise<BuilderResult> {
    const from = ctx.string('from') ?? '';
    const to = ctx.string('to') ?? '';
    const entry = fsPathState(ctx, from);
    const row = entry && typeof entry.rootID === 'string' ? await ctx.row(entry.rootID) : undefined;
    const childDocuments = await countChildDocuments(ctx, row);
    const notebookOf = (path: string) => path.replace(/^\/+/, '').split('/')[0] ?? '';
    const toEntry = fsPathState(ctx, to);
    const crossNotebook = (entry?.notebookID && toEntry?.notebookID)
        ? entry.notebookID !== toEntry.notebookID
        : notebookOf(from) !== notebookOf(to);
    return {
        changes: [{
            kind: 'move',
            summary: `Moves ${from} to ${to}${childDocuments ? ` with its ${childDocuments} child document(s)` : ''}.`,
            from,
            to,
            ...(childDocuments !== undefined ? { childDocumentCount: childDocuments } : {}),
        }],
        targets: [await fsTarget(ctx, from)],
        itemCount: 1 + (childDocuments ?? 0),
        risk: crossNotebook ? ['cross_notebook'] : [],
    };
}

/* ------------------------------------------------------------------ */
/*  Reorder                                                           */
/* ------------------------------------------------------------------ */

async function previewReorder(ctx: PreviewContext): Promise<BuilderResult | undefined> {
    const reorder = ctx.state.reorder;
    if (!isRecord(reorder) || !Array.isArray(reorder.children)) return undefined;
    const children = reorder.children.filter(isRecord);
    const titleOf = new Map(children.map((child) => [String(child.id), titleFromHPath(child)]));
    const beforeIDs = children.map((child) => String(child.id));
    const afterIDs = Array.isArray(reorder.requestedIDs) ? reorder.requestedIDs.map(String) : [];
    const moves = afterIDs.flatMap((id, index) => {
        const from = beforeIDs.indexOf(id);
        return from === index ? [] : [{ title: titleOf.get(id) ?? id, from: from + 1, to: index + 1 }];
    });
    const list = (ids: string[]) => {
        const { shown, omitted } = ctx.cap(ids);
        return [...shown.map((id) => titleOf.get(id) ?? id), ...(omitted > 0 ? [`… ${omitted} more`] : [])];
    };
    const shownMoves = ctx.cap(moves);
    const parentID = typeof reorder.parentID === 'string' ? reorder.parentID : '';
    const notebook = typeof reorder.notebook === 'string' ? reorder.notebook : undefined;
    return {
        changes: [{
            kind: 'reorder',
            summary: moves.length === 0
                ? `The ${beforeIDs.length} child documents are already in the requested order.`
                : `Reorders ${beforeIDs.length} child documents; ${moves.length} change position. The notebook switches to custom sort.`,
            before: list(beforeIDs),
            after: list(afterIDs),
            moves: shownMoves.shown,
            ...(shownMoves.omitted > 0 ? { movesOmitted: shownMoves.omitted } : {}),
        }],
        targetIds: [parentID, ...(notebook && notebook !== parentID ? [notebook] : [])].filter(Boolean),
        itemCount: moves.length,
    };
}

function titleFromHPath(child: Record<string, unknown>): string {
    const hPath = typeof child.hPath === 'string' ? child.hPath : '';
    const last = hPath.split('/').filter(Boolean).at(-1);
    return last || (typeof child.name === 'string' ? child.name : String(child.id));
}

/* ------------------------------------------------------------------ */
/*  Heading <-> document conversion                                   */
/* ------------------------------------------------------------------ */

function headingText(markdown: string): string {
    return markdown.split(/\r?\n/, 1)[0].replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim();
}

async function previewHeadingToDoc(ctx: PreviewContext): Promise<BuilderResult | undefined> {
    const conversion = ctx.input.conversion;
    if (!conversion) return undefined;
    const headingID = conversion.source.id;
    const sourceID = conversion.source.documentId;
    const [headingMarkdown, section, rootChildren, sourceRow] = await Promise.all([
        ctx.markdown(headingID),
        blockApi.getChildBlocks(ctx.client, headingID).catch(() => []),
        ctx.children(sourceID),
        ctx.row(sourceID),
    ]);
    const title = headingText(headingMarkdown) || headingID;
    const movedIDs = new Set([headingID, ...(Array.isArray(section) ? section : []).flatMap((child) => isRecord(child) && typeof child.id === 'string' ? [child.id] : [])]);
    const remaining = rootChildren.filter((child) => !movedIDs.has(child.id)).length;
    const becomesEmpty = rootChildren.length > 0 && remaining === 0;

    const notebookID = conversion.target.notebook;
    const notebookName = await ctx.notebookLabel(notebookID);
    let parentHPath = '';
    let placement: string;
    if (conversion.previousPath) {
        const sibling = await ctx.row(conversion.target.documentId);
        parentHPath = (sibling?.hpath ?? '').split('/').slice(0, -1).join('/');
        placement = `after sibling document ${ctx.label(sibling?.content, conversion.target.documentId)}`;
    } else if (conversion.targetPath !== '/') {
        const parent = await ctx.row(conversion.target.documentId);
        parentHPath = parent?.hpath ?? `/(document ${conversion.target.documentId})`;
        placement = `as a child of ${ctx.label(parent?.content, conversion.target.documentId)}`;
    } else {
        placement = 'at the notebook root';
    }
    const newHPath = `${parentHPath}/${title}`;
    const sourceTitle = sourceRow?.content || sourceID;
    const crossNotebook = conversion.source.notebook !== notebookID;
    const examples = ctx.cap([...movedIDs].slice(1));
    return {
        changes: [{
            kind: 'heading_to_doc',
            summary: `Moves heading ${ctx.label(title, headingID)} and the ${movedIDs.size - 1} block(s) under it (${movedIDs.size} blocks) out of ${ctx.label(sourceTitle, sourceID)} into a new document ${ctx.label(title, headingID)} at ${notebookName}:${newHPath} (${placement}). The source keeps ${remaining} of ${rootChildren.length} top-level block(s).${becomesEmpty ? ' The source document becomes EMPTY.' : ''}`,
            movedBlockCount: movedIDs.size,
            newDocument: { title, notebook: { id: notebookID, name: notebookName }, hPath: newHPath, placement },
            source: {
                id: sourceID,
                title: sourceTitle,
                ...(sourceRow?.hpath ? { hPath: sourceRow.hpath } : {}),
                topLevelBlocksBefore: rootChildren.length,
                topLevelBlocksAfter: remaining,
                becomesEmpty,
            },
            movedBlocks: await Promise.all(examples.shown.map((id) => ctx.describeBlock(id))),
            ...(examples.omitted > 0 ? { movedBlocksOmitted: examples.omitted } : {}),
        }],
        targetIds: [sourceID, headingID, ...(conversion.target.documentId ? [conversion.target.documentId] : [])],
        itemCount: movedIDs.size,
        risk: [...(becomesEmpty ? ['empties_source' as const] : []), ...(crossNotebook ? ['cross_notebook' as const] : [])],
    };
}

async function previewDocToHeading(ctx: PreviewContext): Promise<BuilderResult | undefined> {
    const conversion = ctx.input.conversion;
    if (!conversion) return undefined;
    const sourceID = conversion.source.documentId;
    const targetDocID = conversion.target.documentId;
    const [sourceChildren, targetChildren, sourceRow, targetRow, headingMarkdown] = await Promise.all([
        ctx.children(sourceID),
        ctx.children(targetDocID),
        ctx.row(sourceID),
        ctx.row(targetDocID),
        ctx.markdown(conversion.target.id),
    ]);
    const heading = headingText(headingMarkdown) || conversion.target.id;
    const position = ctx.args.after === true ? 'after' : 'before';
    return {
        changes: [{
            kind: 'doc_to_heading',
            summary: `Merges document ${ctx.label(sourceRow?.content, sourceID)} (${sourceChildren.length} top-level blocks) into ${ctx.label(targetRow?.content, targetDocID)} at ${await ctx.place(targetRow)}, ${position} heading ${ctx.label(heading, conversion.target.id)}; its title becomes a heading. The source document is removed as a separate document. The target grows from ${targetChildren.length} to about ${targetChildren.length + sourceChildren.length + 1} top-level blocks.`,
            source: { id: sourceID, title: sourceRow?.content, ...(sourceRow?.hpath ? { hPath: sourceRow.hpath } : {}), topLevelBlocks: sourceChildren.length },
            target: { id: targetDocID, title: targetRow?.content, ...(targetRow?.hpath ? { hPath: targetRow.hpath } : {}), topLevelBlocksBefore: targetChildren.length, headingID: conversion.target.id, position },
        }],
        targetIds: [sourceID, targetDocID],
        itemCount: sourceChildren.length,
        risk: ['deletes', ...(conversion.source.notebook !== conversion.target.notebook ? ['cross_notebook' as const] : [])],
    };
}

/* ------------------------------------------------------------------ */
/*  Find / replace                                                    */
/* ------------------------------------------------------------------ */

const IAL_WITH_BOUNDARY = /\{:(?:\s(?:[^}"]|"(?:[^"\\]|\\.)*")*)?\}/g;

/** Split kramdown into per-block text using block IALs (`{: id="..."}`) as boundaries. Best effort. */
function segmentKramdown(kramdown: string, fallbackID: string): Array<{ blockID: string; text: string }> {
    const segments: Array<{ blockID: string; text: string }> = [];
    let last = 0;
    for (const match of kramdown.matchAll(IAL_WITH_BOUNDARY)) {
        const id = /\bid="([^"]+)"/.exec(match[0])?.[1];
        if (!id) continue;
        segments.push({ blockID: id, text: stripKramdownIals(kramdown.slice(last, match.index)) });
        last = (match.index ?? 0) + match[0].length;
    }
    const tail = stripKramdownIals(kramdown.slice(last));
    if (tail.trim()) segments.push({ blockID: fallbackID, text: tail });
    return segments;
}

async function previewFindReplace(ctx: PreviewContext): Promise<BuilderResult> {
    const ids = ctx.strings('ids');
    const k = typeof ctx.args.k === 'string' ? ctx.args.k : '';
    const r = typeof ctx.args.r === 'string' ? ctx.args.r : '';
    const method = resolveSearchMethod(ctx.string('methodName'), typeof ctx.args.method === 'number' ? ctx.args.method : undefined);
    const pattern = findReplacePattern(k, method);
    const paths = ctx.strings('paths');
    const scope = paths.length > 0 ? `${ids.length} id(s) and ${paths.length} path(s)` : `${ids.length} scope id(s)`;
    if (!pattern || ids.length === 0) {
        return {
            changes: [{
                kind: 'find_replace',
                summary: `Replaces ${ctx.label(k, '""')} with ${ctx.label(r, '""')} in ${scope}. Matches cannot be counted in advance for this search method or scope.`,
                k,
                r,
            }],
            targetIds: ids,
            risk: ['irreversible', 'overwrites_content'],
        };
    }
    const kramdowns = await readFindReplaceKramdowns(ctx.client, ids);
    let matchCount = 0;
    const affected = new Set<string>();
    const examples: Array<{ blockID: string; before: string; after: string }> = [];
    const replacementFor = (matched: string) => method === 3
        ? matched.replace(new RegExp(pattern.source), r)
        : r;
    const matchesByScope = new Map<string, number>();
    for (const [id, kramdown] of kramdowns) {
        const scopeMatches = stripKramdownIals(kramdown).match(pattern)?.length ?? 0;
        matchCount += scopeMatches;
        if (scopeMatches > 0) matchesByScope.set(id, (matchesByScope.get(id) ?? 0) + scopeMatches);
        for (const segment of segmentKramdown(kramdown, id)) {
            const local = new RegExp(pattern.source, 'g');
            for (const match of segment.text.matchAll(local)) {
                affected.add(segment.blockID);
                if (examples.length < Math.min(ctx.listLimit, FIND_REPLACE_FULL_EXAMPLE_CAP)) {
                    examples.push({ blockID: segment.blockID, ...contextPair(ctx, segment.text, match.index ?? 0, match[0].length, replacementFor(match[0])) });
                }
                if (match[0].length === 0) break;
            }
        }
    }
    const uniqueIds = [...new Set(ids)];
    const changedScopes = uniqueIds.filter((id) => matchesByScope.has(id));
    const unchanged = uniqueIds.filter((id) => !matchesByScope.has(id));
    const replaceTypes = isRecord(ctx.args.replaceTypes) ? ctx.args.replaceTypes : { text: true };
    const onlyText = Object.entries(replaceTypes).every(([key, value]) => key === 'text' || value !== true);
    // Say when the examples are a sample, and how to see every affected block.
    const shownBlocks = new Set(examples.map((example) => example.blockID)).size;
    const capped = matchCount > examples.length;
    const sampleNote = !capped ? '' : ctx.detail === 'full'
        ? ` Showing ${examples.length} of ${matchCount} match(es) (${shownBlocks} of ${affected.size} block(s)); a full preview lists at most ${FIND_REPLACE_FULL_EXAMPLE_CAP}.`
        : ` Showing ${examples.length} of ${matchCount} match(es) (${shownBlocks} of ${affected.size} block(s)); preview="full" lists all.`;
    return {
        changes: [{
            kind: 'find_replace',
            summary: matchCount === 0
                ? `No match of ${ctx.label(k, '""')} in ${scope}; the commit would change nothing.`
                : `Replaces ${matchCount} match(es) of ${ctx.label(k, '""')} with ${ctx.label(r, '""')} in ${affected.size} block(s) within ${scope}.${onlyText ? ' Only plain text is replaced (replaceTypes={text:true}); matches inside tags, links or code stay.' : ''}${sampleNote}`,
            k,
            r,
            matchCount,
            affectedBlockCount: affected.size,
            examples,
            ...(capped ? { examplesOmitted: matchCount - examples.length } : {}),
            // Targets list only the scope ids that change; the rest were scanned.
            unchangedScopeCount: unchanged.length,
            ...(unchanged.length > 0 ? { unchangedScopeIds: ctx.cap(unchanged).shown } : {}),
        }],
        targets: await Promise.all(ctx.cap(changedScopes).shown.map(async (id) => ({ ...await ctx.target(id), matchCount: matchesByScope.get(id) }))),
        targetTotal: changedScopes.length,
        itemCount: affected.size,
        // A bulk replacement cannot be inverted once the replacement text
        // mixes with text that already existed.
        risk: matchCount > 0 ? ['irreversible', 'overwrites_content'] : [],
    };
}

/* ------------------------------------------------------------------ */
/*  Tags                                                              */
/* ------------------------------------------------------------------ */

function bareTag(label: string): string {
    return label.replace(/^#|#$/g, '');
}

async function previewTag(ctx: PreviewContext): Promise<BuilderResult> {
    const rename = ctx.input.action === 'rename';
    const label = bareTag(ctx.string(rename ? 'oldLabel' : 'label') ?? '');
    const rows = await queryTagCarrierRows(ctx.client, label);
    const blockIDs = [...new Set(rows.map((row) => row.block_id).filter((id): id is string => typeof id === 'string'))];
    const boxes = [...new Set(rows.map((row) => row.box).filter((box): box is string => typeof box === 'string' && box.length > 0))];
    // Closed notebooks the caller may not read are listed apart: "closed" is not why they are out of reach.
    const closedAll = (await ctx.notebooks()).filter((notebook) => notebook.closed);
    const unreadable = new Set((await Promise.all(closedAll.map(async (notebook) => (await ctx.notebook(notebook.id))?.permission === 'none' ? notebook.id : ''))).filter(Boolean));
    const closed = closedAll.filter((notebook) => !unreadable.has(notebook.id)).map((notebook) => notebook.name);
    const closedUnreadable = closedAll.filter((notebook) => unreadable.has(notebook.id)).map((notebook) => notebook.name);
    const closedNote = `${closed.length > 0 ? ` SiYuan skips closed notebooks (${closed.join(', ')}).` : ''}${closedUnreadable.length > 0 ? ` Closed notebook(s) without read access (${closedUnreadable.join(', ')}) are skipped too.` : ''}`;
    const exampleIDs = ctx.cap(blockIDs);
    const exampleRows = await ctx.rows(exampleIDs.shown);
    const examples = await Promise.all(exampleIDs.shown.map(async (id) => {
        const row = exampleRows.get(id);
        return { id, excerpt: ctx.text(row?.content ?? '', 80), at: await ctx.place(row) };
    }));
    let summary: string;
    const risk: WritePreviewRisk[] = [];
    if (rename) {
        const newLabel = bareTag(ctx.string('newLabel') ?? '');
        const existing = newLabel ? new Set((await queryTagCarrierRows(ctx.client, newLabel)).map((row) => row.block_id)).size : 0;
        if (existing > 0) risk.push('irreversible');
        summary = `Renames #${label}# (and its sub-tags) to #${newLabel}# on ${blockIDs.length} block(s) in ${boxes.length} notebook(s).${existing > 0 ? ` #${newLabel}# already exists on ${existing} block(s); the two tags merge and cannot be separated again.` : ''}${closedNote}`;
    } else {
        summary = `Removes the tag #${label}# (and its sub-tags) from ${blockIDs.length} block(s) in ${boxes.length} notebook(s); the block text stays.${closedNote}`;
    }
    if (blockIDs.length === 0) summary = `No indexed block in an open notebook carries #${label}#; the commit would change nothing.${closedNote}`;
    const notebookTargets = await Promise.all(ctx.cap(boxes).shown.map((box) => ctx.target(box)));
    return {
        changes: [{
            kind: rename ? 'tag_rename' : 'tag_remove',
            summary,
            blockCount: blockIDs.length,
            notebookCount: boxes.length,
            ...(closed.length > 0 ? { closedNotebooksSkipped: closed } : {}),
            ...(closedUnreadable.length > 0 ? { closedUnreadableNotebooksSkipped: closedUnreadable } : {}),
            examples,
        }],
        targets: [{ id: label, kind: 'tag', title: `#${label}#` }, ...notebookTargets],
        itemCount: blockIDs.length,
        risk,
    };
}

/* ------------------------------------------------------------------ */
/*  Databases (attribute views)                                       */
/* ------------------------------------------------------------------ */

interface AvColumn { key: Record<string, unknown>; values: Array<Record<string, unknown>> }

function avColumns(definition: Record<string, unknown> | undefined): AvColumn[] {
    const keyValues = definition?.keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues.flatMap((entry) => isRecord(entry) && isRecord(entry.key)
        ? [{ key: entry.key, values: Array.isArray(entry.values) ? entry.values.filter(isRecord) : [] }]
        : []);
}

function avRowTitle(columns: AvColumn[], rowID: string): string | undefined {
    const primary = columns.find((column) => column.key.type === 'block');
    const value = primary?.values.find((entry) => entry.blockID === rowID);
    const content = isRecord(value?.block) ? value.block.content : undefined;
    return typeof content === 'string' && content ? content : undefined;
}

function cellText(value: Record<string, unknown> | undefined, keyType: unknown): string {
    if (!value) return '';
    const type = typeof value.type === 'string' && value.type ? value.type : String(keyType ?? '');
    const field = value[type];
    switch (type) {
        case 'block': case 'text': case 'url': case 'email': case 'phone': case 'template':
            return isRecord(field) && typeof field.content === 'string' ? field.content : '';
        case 'number':
            return isRecord(field) && field.isNotEmpty !== false && field.content !== undefined ? String(field.content) : '';
        case 'select': case 'mSelect':
            return Array.isArray(value.mSelect) ? value.mSelect.flatMap((option) => isRecord(option) && typeof option.content === 'string' ? [option.content] : []).join(', ') : '';
        case 'checkbox':
            return isRecord(field) && field.checked === true ? 'checked' : 'unchecked';
        case 'date': case 'created': case 'updated': {
            if (!isRecord(field) || field.isNotEmpty === false || typeof field.content !== 'number' || field.content === 0) return '';
            const start = new Date(field.content).toISOString();
            return field.hasEndDate === true && typeof field.content2 === 'number' ? `${start} → ${new Date(field.content2).toISOString()}` : start;
        }
        case 'relation':
            return isRecord(field) && Array.isArray(field.blockIDs) && field.blockIDs.length > 0 ? `${field.blockIDs.length} related` : '';
        case 'mAsset':
            return Array.isArray(value.mAsset) ? value.mAsset.flatMap((asset) => isRecord(asset) ? [String(asset.name || asset.content || '')] : []).join(', ') : '';
        default:
            return field === undefined ? '' : JSON.stringify(field);
    }
}

function cellInputText(cell: Record<string, unknown>): string {
    switch (cell.valueType) {
        case 'text': case 'url': case 'email': case 'phone':
            return String(cell[cell.valueType] ?? '');
        case 'number': return cell.number === undefined ? '' : String(cell.number);
        case 'select': return String(cell.option ?? '');
        case 'multi_select': return Array.isArray(cell.options) ? cell.options.join(', ') : '';
        case 'checkbox': return cell.checked === true ? 'checked' : 'unchecked';
        case 'date': return `${String(cell.date ?? '')}${cell.endDate !== undefined ? ` → ${String(cell.endDate)}` : ''}`;
        case 'relation': return Array.isArray(cell.relationBlockIDs) ? `${cell.relationBlockIDs.length} related` : '';
        case 'mAsset': return Array.isArray(cell.assets) ? cell.assets.flatMap((asset) => isRecord(asset) ? [String(asset.name || asset.content || '')] : []).join(', ') : '';
        default: return '';
    }
}

async function avBase(ctx: PreviewContext): Promise<{ avID: string; definition?: Record<string, unknown>; columns: AvColumn[]; targets: WritePreviewTarget[] }> {
    const avID = ctx.string('avID') ?? '';
    const definition = await ctx.avDefinition(avID);
    const name = typeof definition?.name === 'string' && definition.name ? definition.name : undefined;
    const targets: WritePreviewTarget[] = [{ id: avID, kind: 'av', ...(name ? { title: name } : definition ? { title: '(unnamed database)' } : {}) }];
    const blockID = ctx.string('blockID');
    if (blockID) targets.push(await ctx.target(blockID));
    return { avID, definition, columns: avColumns(definition), targets };
}

async function previewAvRemoveRows(ctx: PreviewContext): Promise<BuilderResult> {
    const { columns, targets } = await avBase(ctx);
    const rowIDs = ctx.strings('rowIDs');
    const srcIDs = ctx.strings('srcIDs');
    const requested = rowIDs.length > 0 ? rowIDs : srcIDs;
    const primary = columns.find((column) => column.key.type === 'block');
    const resolveRow = (id: string) => rowIDs.length > 0
        ? id
        : String(primary?.values.find((value) => isRecord(value.block) && value.block.id === id)?.blockID ?? id);
    const { shown, omitted } = ctx.cap(requested);
    const rows = shown.map((id) => {
        const rowID = resolveRow(id);
        return { id: rowID, title: ctx.text(avRowTitle(columns, rowID) ?? '(untitled)', 80) };
    });
    const removedRows = new Set(requested.map(resolveRow));
    const lostCells = columns.filter((column) => column.key.type !== 'block').reduce((total, column) => total + column.values.filter((value) => {
        if (!removedRows.has(String(value.blockID ?? ''))) return false;
        const text = cellText(value, column.key.type);
        return !!text && text !== 'unchecked';
    }).length, 0);
    return {
        changes: [{
            kind: 'av_remove_rows',
            summary: `Removes ${requested.length} row(s) and their ${lostCells} non-empty cell value(s) (beyond the primary key): ${rows.map((row) => ctx.label(row.title, row.id)).join(', ')}${omitted > 0 ? ` and ${omitted} more` : ''}.`,
            lostCellCount: lostCells,
            rows,
            ...(omitted > 0 ? { rowsOmitted: omitted } : {}),
        }],
        targets,
        itemCount: requested.length,
    };
}

async function previewAvRemoveColumn(ctx: PreviewContext): Promise<BuilderResult> {
    const { columns, targets } = await avBase(ctx);
    const keyID = ctx.string('keyID') ?? ctx.string('columnID') ?? '';
    const column = columns.find((entry) => entry.key.id === keyID);
    const name = typeof column?.key.name === 'string' ? column.key.name : keyID;
    const nonEmpty = (column?.values ?? []).flatMap((value) => {
        const text = cellText(value, column?.key.type);
        return text && text !== 'unchecked' ? [{ rowID: String(value.blockID ?? ''), text }] : [];
    });
    const { shown, omitted } = ctx.cap(nonEmpty);
    const relationNote = column?.key.type === 'relation'
        ? ctx.args.removeRelationDest === true ? ' The reverse relation column in the linked database is removed too.' : ' The reverse relation column in the linked database is kept.'
        : '';
    return {
        changes: [{
            kind: 'av_remove_column',
            summary: `Removes column ${ctx.label(name, keyID)} (${String(column?.key.type ?? 'unknown type')}) and its ${nonEmpty.length} non-empty value(s).${relationNote}`,
            column: { id: keyID, name, type: column?.key.type },
            nonEmptyValueCount: nonEmpty.length,
            values: shown.map((value) => ({ row: ctx.text(avRowTitle(columns, value.rowID) ?? value.rowID, 80), value: ctx.text(value.text) })),
            ...(omitted > 0 ? { valuesOmitted: omitted } : {}),
        }],
        targets,
        itemCount: nonEmpty.length,
    };
}

async function previewAvSetCells(ctx: PreviewContext): Promise<BuilderResult> {
    const { columns, targets } = await avBase(ctx);
    const cells = (Array.isArray(ctx.args.cells) ? ctx.args.cells : Array.isArray(ctx.args.items) ? ctx.args.items : [ctx.args]).filter(isRecord);
    let overwrites = 0;
    const described = cells.map((cell) => {
        const rowID = String(cell.rowID ?? '');
        const columnID = String(cell.columnID ?? '');
        const column = columns.find((entry) => entry.key.id === columnID);
        const current = cellText(column?.values.find((value) => value.blockID === rowID), column?.key.type);
        if (current && current !== 'unchecked') overwrites++;
        return {
            row: ctx.text(avRowTitle(columns, rowID) ?? rowID, 80),
            rowID,
            column: typeof column?.key.name === 'string' ? column.key.name : columnID,
            columnID,
            current: ctx.text(current),
            next: ctx.text(cellInputText(cell)),
        };
    });
    const { shown, omitted } = ctx.cap(described);
    return {
        changes: [{
            kind: 'av_set_cells',
            summary: `Sets ${cells.length} cell(s) in ${new Set(described.map((cell) => cell.rowID)).size} row(s); ${overwrites} currently hold a value that will be replaced.`,
            cells: shown,
            ...(omitted > 0 ? { cellsOmitted: omitted } : {}),
        }],
        targets,
        itemCount: cells.length,
        risk: overwrites > 0 ? ['overwrites_content'] : [],
    };
}

function avColumnName(column: AvColumn | undefined, fallback: string): string {
    return typeof column?.key.name === 'string' && column.key.name ? column.key.name : fallback;
}

function avRowIDs(columns: AvColumn[]): string[] {
    const primary = columns.find((column) => column.key.type === 'block');
    return (primary?.values ?? []).flatMap((value) => typeof value.blockID === 'string' ? [value.blockID] : []);
}

async function previewAvRename(ctx: PreviewContext): Promise<BuilderResult> {
    const { definition, columns, targets } = await avBase(ctx);
    const changes: WritePreviewChange[] = [];
    const newName = ctx.string('name');
    if (newName !== undefined) {
        const oldName = typeof definition?.name === 'string' ? definition.name : '';
        changes.push({
            kind: 'av_rename',
            summary: oldName === newName
                ? `The database is already named ${ctx.label(newName, '""')}; the name does not change.`
                : `Renames the database ${ctx.label(oldName, '(unnamed)')} → ${ctx.label(newName, '""')}.`,
            before: oldName || '(unnamed)',
            after: newName,
        });
    }
    const keyID = ctx.string('keyID');
    if (keyID) {
        const column = columns.find((entry) => entry.key.id === keyID);
        const oldName = avColumnName(column, keyID);
        const newKeyName = ctx.string('keyName') ?? '';
        changes.push({
            kind: 'av_rename_column',
            summary: `Renames column ${ctx.label(oldName, keyID)} (${String(column?.key.type ?? 'unknown type')}${column?.key.type === 'block' ? ', primary key' : ''}) → ${ctx.label(newKeyName, '""')}.`,
            columns: [{ id: keyID, before: oldName, after: newKeyName }],
        });
    }
    return { changes, targets };
}

async function previewAvAddColumn(ctx: PreviewContext): Promise<BuilderResult> {
    const { columns, targets } = await avBase(ctx);
    const name = ctx.string('keyName') ?? '';
    const type = ctx.string('keyType') ?? 'unknown type';
    const previousKeyID = ctx.string('previousKeyID');
    const previous = previousKeyID ? columns.find((entry) => entry.key.id === previousKeyID) : undefined;
    const rowCount = avRowIDs(columns).length;
    return {
        changes: [{
            kind: 'av_add_column',
            summary: `Adds column ${ctx.label(name, '""')} (${type})${previousKeyID ? ` after column ${ctx.label(avColumnName(previous, previousKeyID), previousKeyID)}` : ''}; the database has ${columns.length} column(s) and ${rowCount} row(s)${rowCount > 0 ? ', which start with an empty value in it' : ''}.`,
            column: { name, type, ...(ctx.string('keyID') ? { id: ctx.string('keyID') } : {}) },
            existingColumns: ctx.cap(columns.map((column) => `${avColumnName(column, String(column.key.id ?? ''))} (${String(column.key.type ?? '?')})`)).shown,
        }],
        targets,
    };
}

async function previewAvAddRows(ctx: PreviewContext): Promise<BuilderResult> {
    const { columns, targets } = await avBase(ctx);
    const columnName = (id: string) => avColumnName(columns.find((entry) => entry.key.id === id), id);
    const composite = Array.isArray(ctx.args.rows) ? ctx.args.rows.filter(isRecord) : [];
    const texts = ctx.strings('primaryKeyTexts');
    const blockIDs = ctx.strings('blockIDs');
    let rows: Array<{ row: string; cells?: string }>;
    let mode: string;
    let cellCount = 0;
    if (composite.length > 0) {
        mode = 'detached';
        rows = composite.map((row) => {
            const cells = (Array.isArray(row.cells) ? row.cells : []).filter(isRecord);
            cellCount += cells.length;
            return {
                row: ctx.text(String(row.primaryKeyText ?? ''), 80),
                ...(cells.length > 0 ? { cells: ctx.text(cells.map((cell) => `${columnName(String(cell.columnID ?? ''))} = ${cellInputText(cell)}`).join('; ')) } : {}),
            };
        });
    } else if (texts.length > 0) {
        mode = 'detached';
        rows = texts.map((text) => ({ row: ctx.text(text, 80) }));
    } else {
        mode = 'bound to existing blocks';
        const shownIDs = ctx.cap(blockIDs).shown;
        const described = await Promise.all(shownIDs.map((id) => ctx.describeBlock(id)));
        rows = [...described.map((row) => ({ row })), ...blockIDs.slice(shownIDs.length).map((id) => ({ row: id }))];
    }
    const { shown, omitted } = ctx.cap(rows);
    const existing = avRowIDs(columns).length;
    return {
        changes: [{
            kind: 'av_add_rows',
            summary: rows.length === 0
                ? 'No rows are given; the commit would be rejected.'
                : `Adds ${rows.length} ${mode} row(s)${cellCount > 0 ? ` with ${cellCount} cell value(s)` : ''}; the database grows from ${existing} to ${existing + rows.length} row(s).`,
            rowCount: rows.length,
            rows: shown,
        }, ...omittedChange(omitted, 'rows')],
        targets,
        itemCount: rows.length,
    };
}

/* ------------------------------------------------------------------ */
/*  Block creation and attributes                                     */
/* ------------------------------------------------------------------ */

/**
 * Best-effort split of Markdown into the top-level blocks SiYuan will create:
 * blank lines separate blocks, headings and fences stand alone, list items and
 * their indented continuation stay one list. An estimate, labelled as such.
 */
export function estimateMarkdownBlocks(markdown: string): string[] {
    const blocks: string[][] = [];
    let current: string[] | undefined;
    let currentIsList = false;
    let blank = false;
    let fence: string | undefined;
    const flush = () => {
        if (current && current.some((line) => line.trim())) blocks.push(current);
        current = undefined;
        currentIsList = false;
        blank = false;
    };
    for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
        const trimmed = line.trim();
        if (fence) {
            current!.push(line);
            if (trimmed.startsWith(fence) && trimmed.slice(fence.length).replace(new RegExp(`\\${fence[0]}`, 'g'), '').trim() === '') {
                fence = undefined;
                flush();
            }
            continue;
        }
        if (/^\{:[^}]*\}$/.test(trimmed)) continue;
        if (!trimmed) {
            if (currentIsList) blank = true;
            else flush();
            continue;
        }
        const fenceOpen = /^(`{3,}|~{3,}|\$\$)/.exec(trimmed)?.[1];
        const isListItem = /^([-*+]|\d+[.)])\s/.test(trimmed);
        const isIndented = /^(\s{2,}|\t)/.test(line);
        if (fenceOpen) {
            flush();
            current = [line];
            if (!(fenceOpen === '$$' && trimmed.length > 2 && trimmed.endsWith('$$'))) fence = fenceOpen;
            else flush();
            continue;
        }
        if (/^#{1,6}\s/.test(trimmed) || /^([-*_])(\s*\1){2,}$/.test(trimmed)) {
            flush();
            blocks.push([line]);
            continue;
        }
        if (current && currentIsList && (isListItem || isIndented)) {
            current.push(line);
            blank = false;
            continue;
        }
        if (current && (blank || isListItem)) flush();
        if (!current) {
            current = [];
            currentIsList = isListItem;
        }
        current.push(line);
    }
    flush();
    return blocks.map((lines) => lines.map((line) => line.trim()).filter(Boolean).join(' '));
}

/**
 * Lines that Markdown folds into one paragraph: consecutive plain lines with
 * no blank line between them become soft line breaks, not separate blocks.
 */
export function softLineBreakNote(markdown: string): string | undefined {
    if (!markdown.includes('\n')) return undefined;
    let fence: string | undefined;
    let group = 0;
    let lines = 0;
    let paragraphs = 0;
    const close = () => {
        if (group > 1) { lines += group; paragraphs += 1; }
        group = 0;
    };
    for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
        const trimmed = line.trim();
        const fenceMark = /^(`{3,}|~{3,}|\$\$)/.exec(trimmed)?.[1];
        if (fence) {
            if (fenceMark && trimmed.startsWith(fence)) fence = undefined;
            continue;
        }
        if (fenceMark) { close(); if (!(fenceMark === '$$' && trimmed.length > 2 && trimmed.endsWith('$$'))) fence = fenceMark; continue; }
        if (!trimmed) { close(); continue; }
        // Headings, rules and IALs stand alone; lists, tables, quotes and
        // indented lines absorb the plain lines that follow them.
        if (/^#{1,6}\s|^\{:|^([-*_])(\s*\1){2,}$/.test(trimmed)) { close(); continue; }
        if (/^([-*+]|\d+[.)])\s|^[|>]/.test(trimmed) || /^(\s{2,}|\t)/.test(line)) { close(); group = -Infinity; continue; }
        group = group < 0 ? group : group + 1;
    }
    close();
    if (paragraphs === 0) return undefined;
    return `${lines} lines → ${paragraphs} paragraph${paragraphs === 1 ? '' : 's'}: a single newline is a soft line break inside one paragraph. Separate paragraphs with a blank line.`;
}

/**
 * A list is one top-level block whose items are child blocks, so a reader
 * that lists every block (get_doc, get_children) shows more blocks than this
 * count. Say how many items the lists hold.
 */
function listNote(markdown: string): string {
    let fence: string | undefined;
    let items = 0;
    for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
        const mark = /^(`{3,}|~{3,})/.exec(line.trim())?.[1];
        if (fence) { if (mark && line.trim().startsWith(fence)) fence = undefined; continue; }
        if (mark) { fence = mark; continue; }
        if (/^\s*([-*+]|\d+[.)])\s/.test(line) && !/^([-*_])(\s*\1){2,}$/.test(line.trim())) items += 1;
    }
    return items > 0 ? `; a list counts as one block (its ${items} item(s) are child blocks)` : '';
}

function newBlocksChange(ctx: PreviewContext, dataType: unknown, data: string, where: string): WritePreviewChange {
    if (dataType === 'dom') {
        return { kind: 'create_blocks', summary: `Inserts DOM content (${data.length} chars) ${where}.`, after: ctx.text(domToText(data)) };
    }
    const blocks = estimateMarkdownBlocks(data);
    const { shown, omitted } = ctx.cap(blocks);
    return {
        kind: 'create_blocks',
        summary: blocks.length === 0
            ? `Inserts empty Markdown ${where}; SiYuan may create one empty paragraph.`
            : `Creates about ${blocks.length} top-level block(s) ${where}${listNote(data)} (an estimate from the Markdown; SiYuan's parser decides the final split).`,
        blockCount: blocks.length,
        blocks: [...shown.map((block) => ctx.text(block, 80)), ...(omitted > 0 ? [`… ${omitted} more`] : [])],
        ...(softLineBreakNote(data) ? { note: softLineBreakNote(data) } : {}),
    };
}

async function previewBlockInsert(ctx: PreviewContext): Promise<BuilderResult> {
    const { action } = ctx.input;
    const items = action === 'insert' && Array.isArray(ctx.args.blocks)
        ? ctx.args.blocks.filter(isRecord)
        : [ctx.args];
    const changes: WritePreviewChange[] = [];
    const targetIds = new Set<string>();
    for (const item of ctx.cap(items).shown) {
        const parentID = typeof item.parentID === 'string' && item.parentID ? item.parentID : undefined;
        const previousID = typeof item.previousID === 'string' && item.previousID ? item.previousID : undefined;
        const nextID = typeof item.nextID === 'string' && item.nextID ? item.nextID : undefined;
        let where: string;
        if (action === 'append' || action === 'prepend') {
            where = `at the ${action === 'append' ? 'end' : 'start'} of ${await ctx.describeBlock(parentID)} in ${await ctx.place(await ctx.row(parentID))}`;
        } else if (previousID) {
            where = `after ${await ctx.describeBlock(previousID)} in ${await ctx.place(await ctx.row(previousID))}`;
        } else if (nextID) {
            where = `before ${await ctx.describeBlock(nextID)} in ${await ctx.place(await ctx.row(nextID))}`;
        } else {
            where = `first inside ${await ctx.describeBlock(parentID)} in ${await ctx.place(await ctx.row(parentID))}`;
        }
        for (const id of [parentID, previousID, nextID]) if (id) targetIds.add(id);
        changes.push(newBlocksChange(ctx, item.dataType, typeof item.data === 'string' ? item.data : '', where));
    }
    changes.push(...omittedChange(items.length - Math.min(items.length, ctx.listLimit), 'insertions'));
    return { changes, targetIds: [...targetIds], itemCount: items.length };
}

async function previewBlockSetAttrs(ctx: PreviewContext): Promise<BuilderResult> {
    return attrsDiff(ctx, ctx.string('id') ?? '', isRecord(ctx.args.attrs) ? ctx.args.attrs : {});
}

/** document.set_attr writes icon / title-img (cover) / custom-* on the document root block: the same diff as block.set_attrs. */
async function previewDocumentSetAttr(ctx: PreviewContext): Promise<BuilderResult> {
    const attrs = isRecord(ctx.args.attrs) ? ctx.args.attrs : {};
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) {
        if (key !== 'cover') { next[key] = value; continue; }
        let titleImg = '';
        if (typeof value === 'string' && value.trim()) {
            try { titleImg = normalizeDocumentCoverSource(value).titleImg; } catch { titleImg = value; }
        }
        next['title-img'] = titleImg;
    }
    return attrsDiff(ctx, ctx.string('id') ?? '', next);
}

async function attrsDiff(ctx: PreviewContext, id: string, next: Record<string, unknown>): Promise<BuilderResult> {
    const live = ctx.liveBlock(id)?.attrs;
    const read = isRecord(live) ? live : await blockApi.getBlockAttrs(ctx.client, id).catch(() => undefined);
    const current: Record<string, unknown> = isRecord(read) ? read : {};
    let replaced = 0;
    let removed = 0;
    let added = 0;
    const attrs = Object.keys(next).sort().map((key) => {
        const before = typeof current[key] === 'string' ? current[key] as string : '';
        const after = String(next[key] ?? '');
        let status: string;
        if (!after) { status = before ? 'removed' : 'unchanged (absent)'; if (before) removed++; }
        else if (!before) { status = 'added'; added++; }
        else if (before === after) status = 'unchanged';
        else { status = 'replaced'; replaced++; }
        return { key, current: before ? ctx.text(before, 80) : '(none)', next: after ? ctx.text(after, 80) : '(removed)', status };
    });
    const { shown, omitted } = ctx.cap(attrs);
    return {
        changes: [{
            kind: 'set_attrs',
            summary: `Sets ${attrs.length} attribute(s) on ${await ctx.describeBlock(id)}: ${added} added, ${replaced} replaced, ${removed} removed. Other attributes stay.`,
            attrs: shown,
            ...(omitted > 0 ? { attrsOmitted: omitted } : {}),
        }],
        targetIds: [id],
        risk: replaced + removed > 0 ? ['overwrites_content'] : [],
    };
}

/* ------------------------------------------------------------------ */
/*  Document creation and timeline nodes                              */
/* ------------------------------------------------------------------ */

/** Documents already at these notebook-local hpaths (index-based; may lag right after a create). */
async function existingDocumentPaths(ctx: PreviewContext, notebook: string | undefined, hPaths: string[]): Promise<Set<string> | undefined> {
    if (!notebook || hPaths.length === 0) return undefined;
    const rows = await searchApi.querySQL(ctx.client,
        `SELECT hpath FROM blocks WHERE type = 'd' AND box = ${sqlString(notebook)} AND hpath IN (${[...new Set(hPaths)].map(sqlString).join(', ')})`,
    ).catch(() => undefined);
    if (!Array.isArray(rows)) return undefined;
    return new Set(rows.flatMap((row) => isRecord(row) && typeof row.hpath === 'string' ? [row.hpath] : []));
}

function parentHPath(hPath: string): string | undefined {
    const parent = hPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/');
    return parent || undefined;
}

/**
 * Notes for one planned document: SiYuan (3.8.8, verified) creates a second
 * same-title document at an existing path, and creates missing parents as
 * empty documents. Neither is an error, so the preview says it up front.
 */
function createPathNotes(hPath: string, existing: Set<string> | undefined, plannedBefore: Set<string>): string[] {
    const notes: string[] = [];
    if (!existing) return notes;
    if (existing.has(hPath)) notes.push(`a document already exists at ${hPath}; SiYuan creates a second one with the same title`);
    const parent = parentHPath(hPath);
    if (parent && !existing.has(parent) && !plannedBefore.has(parent)) notes.push(`parent ${parent} was not found; SiYuan creates it as an empty document`);
    return notes;
}

async function previewDocumentCreate(ctx: PreviewContext): Promise<BuilderResult> {
    const notebook = ctx.string('notebook');
    const notebookName = await ctx.notebookLabel(notebook);
    const notebookTargets = notebook ? [await ctx.target(notebook)] : [];
    const docs = Array.isArray(ctx.args.docs) ? ctx.args.docs.filter(isRecord) : undefined;
    if (docs) {
        const paths = docs.map((item) => typeof item.path === 'string' ? item.path.trim() : '');
        const existing = await existingDocumentPaths(ctx, notebook, [...paths, ...paths.flatMap((path) => parentHPath(path) ?? [])]);
        const planned = new Set<string>();
        const changes: WritePreviewChange[] = [];
        let flagged = 0;
        for (const [index, path] of paths.entries()) {
            const notes = createPathNotes(path, existing, planned);
            planned.add(path);
            if (notes.length > 0) flagged += 1;
            const markdown = typeof docs[index].markdown === 'string' ? docs[index].markdown as string : '';
            const blocks = markdown.trim() ? estimateMarkdownBlocks(markdown).length : 0;
            changes.push({
                kind: 'create_document',
                summary: `[${index}] Creates document ${ctx.label(path.split('/').filter(Boolean).at(-1), path)} at ${notebookName}:${path} (${blocks > 0 ? `body ≈ ${blocks} top-level block(s)` : 'empty body'}).${notes.length > 0 ? ` Note: ${notes.join('; ')}.` : ''}`,
                hPath: path,
            });
        }
        changes.unshift({
            kind: 'create_documents',
            summary: `Creates ${paths.length} document(s) in ${notebookName}, one by one in this order; the first failure stops the batch and the receipt lists created, failed and not_applied items.${flagged > 0 ? ` ${flagged} item(s) have a note below.` : ''}`,
        });
        return {
            changes,
            targets: [...notebookTargets, ...paths.map((path): WritePreviewTarget => ({ id: path, kind: 'path', ...(notebook ? { notebook: notebookTargets[0]?.notebook } : {}) }))],
            itemCount: paths.length,
        };
    }
    const path = ctx.string('path');
    let hPath: string;
    if (path) {
        hPath = path;
    } else {
        let parent = ctx.string('parentPath') ?? '/';
        if (/\.sy$/i.test(parent) && notebook) {
            const rows = await searchApi.querySQL(ctx.client,
                `SELECT hpath FROM blocks WHERE type = 'd' AND box = ${sqlString(notebook)} AND path = ${sqlString(parent)} LIMIT 1`,
            ).catch(() => []);
            const first = Array.isArray(rows) ? rows[0] : undefined;
            parent = isRecord(first) && typeof first.hpath === 'string' ? first.hpath : parent;
        }
        hPath = `${parent.replace(/\/+$/, '')}/${ctx.string('title') ?? ''}`;
    }
    const markdown = typeof ctx.args.markdown === 'string' ? ctx.args.markdown : '';
    const content = markdown.trim() ? newBlocksChange(ctx, 'markdown', markdown, 'as its body') : undefined;
    const notes = createPathNotes(hPath, await existingDocumentPaths(ctx, notebook, [hPath, parentHPath(hPath) ?? hPath]), new Set());
    return {
        changes: [{
            kind: 'create_document',
            summary: `Creates document ${ctx.label(hPath.split('/').filter(Boolean).at(-1), hPath)} at ${notebookName}:${hPath}.${content ? '' : ' Its body starts empty (SiYuan adds one empty paragraph).'}${notes.length > 0 ? ` Note: ${notes.join('; ')}.` : ''}`,
            hPath,
        }, ...(content ? [content] : [])],
        targets: [
            ...notebookTargets,
            { id: hPath, kind: 'path', ...(notebook ? { notebook: await ctx.notebook(notebook) } : {}) },
        ],
    };
}

async function previewTimelineCreateNode(ctx: PreviewContext): Promise<BuilderResult> {
    const name = ctx.string('name') ?? '';
    const documentId = ctx.string('documentId');
    if (ctx.args.scope !== 'document' || !documentId) {
        return { changes: [{ kind: 'timeline_node', summary: `Creates a workspace-global timeline snapshot ${ctx.label(name, '""')}.`, name }], targets: [] };
    }
    const row = await ctx.row(documentId);
    return {
        changes: [{
            kind: 'timeline_node',
            summary: `Creates timeline snapshot ${ctx.label(name, '""')} of document ${ctx.label(row?.content, documentId)} at ${await ctx.place(row)}. Nothing in the document changes.`,
            name,
        }],
        targetIds: [documentId],
    };
}

async function previewAvCreate(ctx: PreviewContext): Promise<BuilderResult> {
    const parentID = ctx.string('parentID') ?? '';
    const row = await ctx.row(parentID);
    const where = row?.type === 'd'
        ? `document ${ctx.label(row.content, parentID)}`
        : `block ${await ctx.describeBlock(parentID)}${row ? ` in ${await ctx.place(row)}` : ''}`;
    // Mirrors handleCreate: appended after the parent's current last child.
    const last = parentID ? (await ctx.siblings(parentID)).at(-1) : undefined;
    const lastLabel = last ? (last.content ? ctx.label(last.content, last.id) : await ctx.describeBlock(last.id)) : undefined;
    const position = last ? `at the end, appended after ${lastLabel} (${last.id})` : 'as its first block';
    return {
        changes: [{
            kind: 'create_database',
            summary: `Inserts a new database block (table view, 0 rows) into ${where}, ${position}. ${ctx.string('name') ? `It is named ${ctx.label(ctx.string('name'), '""')} and starts` : 'It starts unnamed (pass name to name it at creation, or use av rename later)'} with a primary key column, and SiYuan adds a default single-select column; rename columns with av rename. The commit result names that column with a ready removeDefaultColumn step (remove_column preflight) if you do not want it.`,
            ...(ctx.string('avID') ? { avID: ctx.string('avID') } : {}),
            defaultColumns: ['primary key (block)', 'single select'],
            position: last ? { appendedAfter: last.id } : { first: true },
        }],
        targetIds: parentID ? [parentID] : [],
    };
}

async function previewDocumentDuplicate(ctx: PreviewContext): Promise<BuilderResult> {
    const id = ctx.string('id') ?? '';
    const row = await ctx.row(id);
    const blocks = (await countDocumentBlocks(ctx, id ? [id] : [])).get(id);
    const parentHPath = row?.hpath ? row.hpath.split('/').slice(0, -1).join('/') || '/' : undefined;
    const notebook = row?.box ? await ctx.notebookLabel(row.box) : undefined;
    return {
        changes: [{
            kind: 'duplicate_document',
            summary: `Duplicates document ${ctx.label(row?.content, id)}${blocks !== undefined ? ` (${contentBlocks(blocks)})` : ''} as a new sibling${notebook && parentHPath ? ` in ${notebook}:${parentHPath}` : ''}, titled «${row?.content ?? '…'} (Duplicated <date time>)» by SiYuan with new block IDs. The source stays unchanged.`,
            id,
            ...(row?.content ? { newTitle: `${row.content} (Duplicated <date time>)` } : {}),
            ...(parentHPath ? { destination: parentHPath } : {}),
        }],
        targetIds: id ? [id] : [],
    };
}

async function previewDocumentRename(ctx: PreviewContext): Promise<BuilderResult | undefined> {
    const items = Array.isArray(ctx.args.items)
        ? ctx.args.items.filter(isRecord).map((item) => ({ id: typeof item.id === 'string' ? item.id : '', title: typeof item.title === 'string' ? item.title : '' }))
        : ctx.string('id') ? [{ id: ctx.string('id')!, title: ctx.string('title') ?? '' }] : [];
    if (items.length === 0) return undefined;
    const rows = await ctx.rows(items.map((item) => item.id));
    const { shown, omitted } = ctx.cap(items);
    const changes: WritePreviewChange[] = [];
    for (const item of shown) {
        const row = rows.get(item.id);
        changes.push({
            kind: 'rename_document',
            summary: `Renames document ${ctx.label(row?.content, item.id)}${row ? ` at ${await ctx.place(row)}` : ''} to «${item.title}». Its ID, path and content stay.`,
            id: item.id,
            ...(row?.content ? { from: row.content } : {}),
            to: item.title,
        });
    }
    changes.push(...omittedChange(omitted, 'documents'));
    return { changes, targetIds: items.map((item) => item.id), itemCount: items.length };
}

async function previewBlockSetFoldState(ctx: PreviewContext): Promise<BuilderResult> {
    const id = ctx.string('id') ?? '';
    const children = await ctx.children(id);
    const folded = ctx.args.folded === true;
    return {
        changes: [{
            kind: 'fold_state',
            summary: `${folded ? 'Folds' : 'Unfolds'} ${await ctx.describeBlock(id)}${children.length > 0 ? ` (${children.length} child block(s) ${folded ? 'hidden' : 'shown'})` : ''}. Content does not change.`,
            id,
        }],
        targetIds: [id],
    };
}

async function previewNotebookRename(ctx: PreviewContext): Promise<BuilderResult | undefined> {
    const id = ctx.string('notebook');
    if (!id) return undefined;
    return {
        changes: [{ kind: 'rename_notebook', summary: `Renames notebook «${await ctx.notebookLabel(id)}» to «${ctx.string('name') ?? ''}». Its ID, documents and permission stay.`, from: await ctx.notebookLabel(id), to: ctx.string('name') ?? '' }],
        targets: [await ctx.target(id)],
    };
}

async function previewNotebookCreate(ctx: PreviewContext): Promise<BuilderResult> {
    const name = ctx.string('name') ?? '';
    const existing = (await ctx.notebooks()).filter((notebook) => notebook.name === name).length;
    return {
        changes: [{ kind: 'create_notebook', summary: `Creates an empty notebook «${name}».${existing > 0 ? ` ${existing} notebook(s) already have this name; SiYuan allows duplicates.` : ''}`, name }],
        targets: [],
    };
}

const SPECIFIC_BUILDERS: Record<string, Builder> = {
    'block.update': previewBlockUpdate,
    'block.replace': previewBlockReplace,
    'block.delete': previewBlockDelete,
    'block.move': previewBlockMove,
    'fs.write': previewFsWrite,
    'fs.replace': previewFsReplace,
    'fs.rm': previewFsRm,
    'fs.mv': previewFsMv,
    'fs.reorder': previewReorder,
    'document.remove': previewDocumentRemove,
    'document.move': previewDocumentMove,
    'document.reorder': previewReorder,
    'document.heading_to_doc': previewHeadingToDoc,
    'document.doc_to_heading': previewDocToHeading,
    'search.find_replace': previewFindReplace,
    'tag.rename': previewTag,
    'tag.remove': previewTag,
    'av.remove_rows': previewAvRemoveRows,
    'av.remove_column': previewAvRemoveColumn,
    'av.set_cells': previewAvSetCells,
    'av.rename': previewAvRename,
    'av.add_column': previewAvAddColumn,
    'av.add_rows': previewAvAddRows,
    'block.append': previewBlockInsert,
    'block.prepend': previewBlockInsert,
    'block.insert': previewBlockInsert,
    'block.set_attrs': previewBlockSetAttrs,
    'document.set_attr': previewDocumentSetAttr,
    'document.create': previewDocumentCreate,
    'timeline.create_node': previewTimelineCreateNode,
    'av.create': previewAvCreate,
    'document.duplicate': previewDocumentDuplicate,
    'document.rename': previewDocumentRename,
    'block.set_fold_state': previewBlockSetFoldState,
    'notebook.rename': previewNotebookRename,
    'notebook.create': previewNotebookCreate,
};

/** Actions with a specific change summary; every other strict write gets the generic one. */
export const WRITE_PREVIEW_SPECIFIC_ACTIONS: readonly string[] = Object.keys(SPECIFIC_BUILDERS);
