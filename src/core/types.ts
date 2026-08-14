import { z } from "zod";

import { AV_ACTIONS, BLOCK_ACTIONS, DOCUMENT_ACTIONS, FEEDBACK_ACTIONS, FILE_ACTIONS, FLASHCARD_ACTIONS, FS_ACTIONS, MASCOT_ACTIONS, NOTEBOOK_ACTIONS, SEARCH_ACTIONS, SYSTEM_ACTIONS, TAG_ACTIONS, TIMELINE_ACTIONS } from "./config";
import type { NotebookConf } from "../types/shared";

const NotebookConfSchema: z.ZodType<Partial<NotebookConf>> = z.object({
    name: z.string().optional(),
    closed: z.boolean().optional(),
    sortMode: z.number().int().optional(),
    refCreateSavePath: z.string().optional(),
    createDocNameTemplate: z.string().optional(),
    dailyNoteSavePath: z.string().optional(),
    dailyNoteTemplatePath: z.string().optional(),
});

const DocumentReferenceSchema = z.object({
    id: z.string().optional(),
    notebook: z.string().optional(),
    path: z.string().optional(),
});

const DocumentPathReferenceSchema = DocumentReferenceSchema.superRefine((value, ctx) => {
    const hasId = typeof value.id === "string";
    const hasPathRef = typeof value.notebook === "string" || typeof value.path === "string";

    if (hasId === hasPathRef) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide either id or notebook + path.",
        });
        return;
    }

    if (hasPathRef && (!value.notebook || !value.path)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Both notebook and path are required when id is not provided.",
        });
    }
});

const DocumentMoveReferenceSchema = z.object({
    fromPaths: z.array(z.string()).optional(),
    toNotebook: z.string().optional(),
    toPath: z.string().optional(),
    fromIDs: z.array(z.string()).optional(),
    toID: z.string().optional(),
}).superRefine((value, ctx) => {
    const hasPathMode = Array.isArray(value.fromPaths) || typeof value.toNotebook === "string" || typeof value.toPath === "string";
    const hasIdMode = Array.isArray(value.fromIDs) || typeof value.toID === "string";

    if (hasPathMode === hasIdMode) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide either fromPaths + toNotebook + toPath or fromIDs + toID.",
        });
        return;
    }

    if (hasPathMode && (!value.fromPaths || !value.toNotebook || !value.toPath)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "fromPaths, toNotebook, and toPath are required for path-based moves.",
        });
    }

    if (hasIdMode && (!value.fromIDs || !value.toID)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "fromIDs and toID are required for ID-based moves.",
        });
    }
});

export const FsActionSchema = z.enum(FS_ACTIONS);
export const NotebookActionSchema = z.enum(NOTEBOOK_ACTIONS);
export const DocumentActionSchema = z.enum(DOCUMENT_ACTIONS);
export const BlockActionSchema = z.enum(BLOCK_ACTIONS);
export const AvActionSchema = z.enum(AV_ACTIONS);
export const FileActionSchema = z.enum(FILE_ACTIONS);
export const FlashcardActionSchema = z.enum(FLASHCARD_ACTIONS);
export const MascotActionSchema = z.enum(MASCOT_ACTIONS);
export const FeedbackActionSchema = z.enum(FEEDBACK_ACTIONS);
export const TimelineActionSchema = z.enum(TIMELINE_ACTIONS);

export const FsLsSchema = z.object({
    action: z.literal("ls"),
    path: z.string().describe("Human-readable workspace path, such as /Notebook/Folder or / for notebook roots"),
});

export const FsTreeSchema = z.object({
    action: z.literal("tree"),
    path: z.string().describe("Human-readable workspace path, such as /Notebook/Folder or / for all readable notebooks"),
    maxDepth: z.number().int().min(0).max(20).optional().describe("Max tree depth to return (default 3)"),
});

export const FsReadSchema = z.object({
    action: z.literal("read"),
    path: z.string().describe("Human-readable document path"),
    blockStart: z.number().int().min(0).optional().describe("Zero-based display-block index to start reading from (default 0)"),
    blockLimit: z.number().int().min(1).max(200).optional().describe("Maximum complete display blocks to return (default 50)"),
    tokenBudget: z.number().int().min(1).max(32000).optional().describe("Approximate token budget for the window (default 2000). A single oversized block is still returned whole."),
    includeBlockIds: z.boolean().optional().describe("Include a sidecar blockRefs mapping without adding block IDs to Markdown content (default false)"),
}).passthrough().superRefine((value, ctx) => {
    for (const key of ["page", "pageSize"] as const) {
        if (value[key] !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [key],
                message: `${key} character pagination was removed; use blockStart, blockLimit, and tokenBudget.`,
            });
        }
    }
});

export const FsWriteSchema = z.object({
    action: z.literal("write"),
    path: z.string().describe("Human-readable document path"),
    markdown: z.string().describe("Markdown content to create or write. Do not include a leading # Title; a matching create-time H1 is stripped automatically."),
    overwrite: z.boolean().optional().describe("When true, replace an existing document body while keeping the document node and title. This is a full body replacement."),
});

export const FsReplaceEditSchema = z.object({
    old: z.string().min(1).describe("Original text to match exactly. Supports multi-line strings."),
    new: z.string().describe("Replacement text. Supports multi-line strings."),
    replace_all: z.boolean().optional().describe("When true, replace every exact match. Defaults to false."),
});

export const FsReplaceSchema = z.object({
    action: z.literal("replace"),
    path: z.string().describe("Human-readable document path to modify"),
    edit: z.union([
        FsReplaceEditSchema,
        z.array(FsReplaceEditSchema).min(1),
    ]).describe("One replacement edit or an array of edits to apply sequentially inside editable non-complex Markdown blocks without rebuilding the document"),
});

export const FsRmSchema = z.object({
    action: z.literal("rm"),
    path: z.string().describe("Human-readable document path to delete"),
});

export const FsMvSchema = z.object({
    action: z.literal("mv"),
    from: z.string().describe("Human-readable source document path"),
    to: z.string().describe("Human-readable destination document path"),
});

export const FsReorderSchema = z.object({
    action: z.literal("reorder"),
    path: z.string().describe("Human-readable notebook or parent document path"),
    orderedPaths: z.array(z.string()).min(1).describe("Complete ordered list of all visible direct child document paths"),
});

export const FsSearchSchema = z.object({
    action: z.literal("search"),
    path: z.string().describe("Human-readable document or folder path to search within"),
    query: z.string().describe("Text or regular expression to search for"),
    regex: z.boolean().optional().describe("Treat query as a JavaScript regular expression"),
    caseSensitive: z.boolean().optional().describe("Use case-sensitive matching"),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).max(200).optional().describe("Matches per page, default 50"),
});

export const NotebookListSchema = z.object({
    action: z.literal("list"),
});

export const NotebookCreateSchema = z.object({
    action: z.literal("create"),
    name: z.string().describe("Notebook name"),
    icon: z.string().optional().describe("Optional notebook icon. Prefer a Unicode hex code string such as '1f4d4' for 📔 instead of a raw emoji character."),
});

export const NotebookSetOpenStateSchema = z.object({
    action: z.literal("set_open_state"),
    notebook: z.string().describe("Notebook ID"),
    opened: z.boolean().describe("true to open, false to close"),
});

export const NotebookRemoveSchema = z.object({
    action: z.literal("remove"),
    notebook: z.string().describe("Notebook ID"),
});

export const NotebookRenameSchema = z.object({
    action: z.literal("rename"),
    notebook: z.string().describe("Notebook ID"),
    name: z.string().describe("New notebook name"),
});

export const NotebookGetConfSchema = z.object({
    action: z.literal("get_conf"),
    notebook: z.string().describe("Notebook ID"),
});

export const NotebookSetConfSchema = z.object({
    action: z.literal("set_conf"),
    notebook: z.string().describe("Notebook ID"),
    conf: NotebookConfSchema.describe("Notebook configuration"),
});

export const NotebookSetIconSchema = z.object({
    action: z.literal("set_icon"),
    notebook: z.string().describe("Notebook ID"),
    icon: z.string().describe("Icon value. Prefer a Unicode hex code string such as '1f4d4' for 📔; raw emoji characters may not render correctly. Custom icon paths are also supported."),
});

export const NotebookGetPermissionsSchema = z.object({
    action: z.literal("get_permissions"),
    notebook: z.string().optional().describe('Notebook ID, or "all" to return every notebook permission entry. Omit to return all notebooks.'),
});

export const NotebookSetPermissionSchema = z.object({
    action: z.literal("set_permission"),
    notebook: z.string().describe("Notebook ID"),
    permission: z.enum(["none", "r", "rw", "rwd"]).describe('Permission level: "none" blocks all access, "r" allows read only, "rw" allows read and write without delete, "rwd" allows read, write, and delete'),
});

export const NotebookGetChildDocsSchema = z.object({
    action: z.literal("get_child_docs"),
    notebook: z.string().describe("Notebook ID"),
    page: z.number().int().positive().optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().positive().optional().describe("Rows per page, default 50"),
});

export const DocumentCreateSchema = z.object({
    action: z.literal("create"),
    notebook: z.string().describe("Notebook ID"),
    path: z.string().optional().describe("Human-readable target path, must start with / (e.g., /foo/bar). Parent paths must already exist."),
    parentPath: z.string().optional().describe("Parent human-readable path or storage path ending in .sy for title-based creation, must start with /"),
    title: z.string().optional().describe("Document title when creating under parentPath"),
    markdown: z.string().optional().describe("Markdown content, defaults to empty. Do not include a leading # Title; a matching H1 is stripped automatically."),
    sorts: z.array(z.string()).optional().describe("Compatibility option retained for older callers; title-based creation now uses the reliable path flow"),
    icon: z.string().optional().describe("Optional document icon. Prefer a Unicode hex code string such as '1f4d4' for 📔 instead of a raw emoji character."),
}).superRefine((value, ctx) => {
    const hasPath = typeof value.path === "string";
    const hasTitleMode = typeof value.parentPath === "string" || typeof value.title === "string";

    if (hasPath && hasTitleMode) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide either path, or parentPath + title, not both.",
            path: ["path"],
        });
        return;
    }

    if (!hasPath && (!value.parentPath || !value.title)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide path, or provide both parentPath and title.",
            path: ["path"],
        });
    }
});

const DocumentResolveIncludeSchema = z.enum(["id", "ids", "path", "hpath", "docInfo"]);

export const DocumentLookupSchema = z.object({
    action: z.literal("lookup"),
    id: z.string().optional().describe("Document ID to look up"),
    notebook: z.string().optional().describe("Notebook ID, required with path or hpath"),
    path: z.string().optional().describe("Storage path to look up when notebook is provided, e.g. /20240318112233-abc123.sy. Human-readable paths should use hpath instead."),
    hpath: z.string().optional().describe("Human-readable path to look up when notebook is provided"),
    hPath: z.string().optional().describe("Alias for hpath"),
    include: z.array(DocumentResolveIncludeSchema).optional().describe('Fields to include: "id", "ids", "path", "hpath", "docInfo"'),
}).superRefine((value, ctx) => {
    const hpath = value.hpath ?? value.hPath;
    const sourceCount = [value.id, value.path, hpath].filter((field) => typeof field === "string").length;
    if (sourceCount !== 1) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide exactly one source: id, notebook + path, or notebook + hpath.",
            path: ["id"],
        });
    }
    if (!value.id && !value.notebook) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "notebook is required when resolving path or hpath.",
            path: ["notebook"],
        });
    }
});

const DocumentLinkTargetSchema = z.object({
    key: z.string().trim().min(1).max(256).describe('Stable caller key used in the returned link map. It is not resolved as a document title.'),
    id: z.string().trim().min(1).optional().describe('Explicit existing document ID. Required for mode="resolve" and mode="reuse".'),
    title: z.string().trim().min(1).max(256).optional().describe('Explicit title for a new direct child document. Allowed only for mode="create" and never used to adopt an existing document.'),
}).superRefine((value, ctx) => {
    if (value.id && value.title) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Each link target must provide either id or title, not both.',
        });
    }
    if (value.title && /[\\/]/.test(value.title)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['title'],
            message: 'Link-target titles must be one direct child name and cannot contain / or \\.',
        });
    }
});

/**
 * This contract intentionally has no title lookup branch. A caller first
 * resolves a concrete parent ID, then either supplies exact existing target
 * IDs or explicitly asks to create named children. Matching a duplicate title
 * only fails closed; it never turns into an implicit reuse decision.
 */
export const DocumentEnsureLinkTargetsSchema = z.object({
    action: z.literal('ensure_link_targets'),
    notebook: z.string().trim().min(1).describe('Explicit notebook ID that must own the parent document and every returned target.'),
    parentId: z.string().trim().min(1).describe('Explicit parent document ID. Only direct child documents of this resolved parent are in scope.'),
    mode: z.enum(['resolve', 'reuse', 'create']).describe('resolve/reuse accept exact existing IDs without title fallback; create accepts explicit new titles and refuses to adopt same-title children.'),
    targets: z.array(DocumentLinkTargetSchema).min(1).max(100).describe('Explicit link targets. keys must be unique; IDs are identities, while titles are only new-document names.'),
    markdown: z.string().optional().describe('Optional Markdown body for every target created by mode="create". Existing targets are never edited.'),
    dryRun: z.boolean().optional().describe('Plan and inspect the explicit scope without creating documents. For strict creation preflight, use validateOnly=true instead.'),
}).superRefine((value, ctx) => {
    const keys = new Set<string>();
    const titles = new Set<string>();
    for (const [index, target] of value.targets.entries()) {
        if (keys.has(target.key)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targets', index, 'key'], message: 'Link-target keys must be unique.' });
        }
        keys.add(target.key);
        if (value.mode === 'create' && !target.title) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targets', index, 'title'], message: 'mode="create" requires an explicit title for every target.' });
        }
        if (value.mode === 'create' && target.title) {
            if (titles.has(target.title)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targets', index, 'title'], message: 'mode="create" target titles must be unique within one request.' });
            }
            titles.add(target.title);
        }
        if (value.mode !== 'create' && !target.id) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targets', index, 'id'], message: `mode="${value.mode}" requires an explicit existing document ID for every target.` });
        }
    }
    if (value.mode !== 'create' && value.markdown !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['markdown'], message: 'markdown is only valid for mode="create"; resolve/reuse never edit targets.' });
    }
    if (value.dryRun === true && value.mode !== 'create') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dryRun'], message: 'dryRun is only valid for mode="create"; resolve and reuse are already read-only.' });
    }
});

export const DocumentRenameSchema = z.object({
    action: z.literal("rename"),
    title: z.string().describe("New document title"),
}).and(DocumentPathReferenceSchema);

export const DocumentRemoveSchema = z.object({
    action: z.literal("remove"),
    ids: z.array(z.string()).min(1).optional().describe("One or more document IDs to remove"),
    paths: z.array(z.string()).min(1).optional().describe("One or more storage paths to remove in batch"),
}).and(DocumentReferenceSchema).superRefine((value, ctx) => {
    const modes = [
        typeof value.id === "string",
        typeof value.notebook === "string" || typeof value.path === "string",
        Array.isArray(value.ids),
        Array.isArray(value.paths),
    ].filter(Boolean).length;
    if (modes !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one removal mode: id, notebook + path, ids, or paths." });
        return;
    }
    if ((value.notebook || value.path) && (!value.notebook || !value.path)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Both notebook and path are required for path-based remove." });
    }
});

export const DocumentMoveSchema = z.object({
    action: z.literal("move"),
}).and(DocumentMoveReferenceSchema);

export const DocumentReorderSchema = z.object({
    action: z.literal("reorder"),
    parentID: z.string().describe("Notebook ID or parent document ID"),
    orderedIDs: z.array(z.string()).min(1).describe("Complete ordered list of all visible direct child document IDs"),
});

export const DocumentGetChildBlocksSchema = z.object({
    action: z.literal("get_child_blocks"),
    id: z.string().describe("Document ID"),
});

export const DocumentGetChildDocsSchema = z.object({
    action: z.literal("get_child_docs"),
    id: z.string().describe("Document ID"),
});

export const DocumentSetAttrSchema = z.object({
    action: z.literal("set_attr"),
    id: z.string().describe("Document ID"),
    attrs: z.object({
        icon: z.string().optional().describe("Icon value. Prefer a Unicode hex code string such as '1f4d4'."),
        cover: z.union([z.string(), z.null()]).optional().describe("Cover source. Use null or empty string to clear the cover."),
    }).describe("Document metadata attributes to set"),
}).superRefine((value, ctx) => {
    if (value.attrs.icon === undefined && value.attrs.cover === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide at least one of attrs.icon or attrs.cover.", path: ["attrs"] });
    }
});

export const DocumentListTreeSchema = z.object({
    action: z.literal("list_tree"),
    notebook: z.string().describe("Notebook ID"),
    path: z.string().describe("Storage path or / for the notebook root"),
    maxDepth: z.number().optional().describe("Max tree depth to return (default 3). Deeper nodes are collapsed to childCount."),
});

export const DocumentSearchDocsSchema = z.object({
    action: z.literal("search_docs"),
    notebook: z.string().describe("Notebook ID"),
    query: z.string().describe("Keyword to search in document titles"),
    path: z.string().optional().describe("Optional storage path to narrow the search scope after permission filtering"),
});

export const DocumentGetDocSchema = z.object({
    action: z.literal("get_doc"),
    id: z.string().describe("Document ID"),
    mode: z.enum(["markdown", "html"]).optional().describe('Return mode: "markdown" (default) or "html"'),
    size: z.number().optional().describe("Optional maximum content size hint"),
    blockStart: z.number().int().min(0).optional().describe("Zero-based display-block index to start reading from in markdown mode (default 0)"),
    blockLimit: z.number().int().min(1).max(200).optional().describe("Maximum complete display blocks to return in markdown mode (default 50)"),
    tokenBudget: z.number().int().min(1).max(32000).optional().describe("Approximate token budget for the markdown window (default 2000). A single oversized block is still returned whole."),
    includeBlockIds: z.boolean().optional().describe("Include a sidecar blockRefs mapping in markdown mode without adding block IDs to content (default false)"),
}).passthrough().superRefine((value, ctx) => {
    for (const key of ["page", "pageSize"] as const) {
        if (value[key] !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [key],
                message: `${key} character pagination was removed; use blockStart, blockLimit, and tokenBudget.`,
            });
        }
    }
    if (value.mode !== "html") return;
    for (const key of ["blockStart", "blockLimit", "tokenBudget", "includeBlockIds"] as const) {
        if (value[key] !== undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [key],
                message: `${key} is only supported when mode="markdown".`,
            });
        }
    }
});

export const DocumentGetOutlineSchema = z.object({
    action: z.literal("get_outline"),
    id: z.string().describe("Document ID"),
    preview: z.boolean().optional().describe("Use SiYuan preview-mode outline semantics (default false)"),
});

export const DocumentCreateDailyNoteSchema = z.object({
    action: z.literal("create_daily_note"),
    notebook: z.string().describe("Notebook ID"),
    app: z.string().optional().describe("Optional app identifier passed through to SiYuan"),
});

export const DocumentDuplicateSchema = z.object({
    action: z.literal("duplicate"),
    id: z.string().describe("Source document ID"),
});

export const DocumentHeadingToDocSchema = z.object({
    action: z.literal("heading_to_doc"),
    headingID: z.string().describe("Heading block ID to convert into a document"),
    targetNotebook: z.string().describe("Target notebook ID"),
    targetPath: z.string().optional().describe("Optional target storage path"),
    previousPath: z.string().optional().describe("Optional previous sibling storage path"),
});

export const DocumentDocToHeadingSchema = z.object({
    action: z.literal("doc_to_heading"),
    srcID: z.string().describe("Source document ID"),
    targetID: z.string().describe("Target document or heading block ID"),
    after: z.boolean().optional().describe("When true, insert after the target heading instead of before it"),
});

export const MascotGetBalanceSchema = z.object({
    action: z.literal("get_balance"),
});

export const MascotShopSchema = z.object({
    action: z.literal("shop"),
});

export const MascotBuySchema = z.object({
    action: z.literal("buy"),
    item_id: z.string().describe("Stable shop item ID returned by mascot(action=\"shop\")"),
});

export const FeedbackSubmitSchema = z.object({
    action: z.literal("submit"),
    description: z.string().trim().min(1).max(4000).describe("Required feedback text. Prefer a GitHub Issue-style body for bugs, confusing behavior, or rough workflows, with headings such as ## Summary, ## What happened, ## Expected behavior, ## Steps or context, ## Impact, and ## Suggested fix."),
    impact: z.string().trim().max(1000).optional().describe("Optional one- or two-sentence impact summary, such as affected workflow, error risk, confusion, or inconvenience."),
    suggestion: z.string().trim().max(1000).optional().describe("Optional direct improvement suggestion; keep it focused and avoid repeating the full description."),
    agent: z.string().trim().max(200).optional().describe("Optional Agent product and model name, such as Claude Desktop / Claude Sonnet 4.5. Defaults to 无."),
    source: z.string().trim().max(100).optional().describe("Internal source label. Defaults to the current runtime transport."),
});

const FlashcardScopeSchema = z.enum(["all", "deck", "notebook", "tree"]);
const FlashcardFilterSchema = z.enum(["due", "new", "old"]);

export const FlashcardListCardsSchema = z.object({
    action: z.literal("list_cards"),
    scope: FlashcardScopeSchema.describe('Query scope: "all", "deck", "notebook", or "tree"'),
    filter: FlashcardFilterSchema.describe('Filter returned cards: "due", "new", or "old"'),
    deckID: z.string().optional().describe('Deck ID, required when scope=deck. For scope="all", omit deckID; an empty string is treated as omitted.'),
    notebook: z.string().optional().describe("Notebook ID, required when scope=notebook"),
    rootID: z.string().optional().describe("Root document/block ID, required when scope=tree"),
    reviewedCards: z.array(z.object({
        cardID: z.string().describe("Reviewed card ID"),
    }).passthrough()).optional().describe("Optional already-reviewed cards; SiYuan reads reviewedCards[].cardID"),
}).superRefine((value, ctx) => {
    const hasDeck = typeof value.deckID === "string" && value.deckID.length > 0;
    const hasNotebook = typeof value.notebook === "string";
    const hasRoot = typeof value.rootID === "string";

    if (value.scope === "all" && (hasDeck || hasNotebook || hasRoot)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scope="all" does not accept deckID, notebook, or rootID.' });
    }
    if (value.scope === "deck" && !hasDeck) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deckID"], message: 'deckID is required when scope="deck".' });
    }
    if (value.scope === "notebook" && !hasNotebook) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["notebook"], message: 'notebook is required when scope="notebook".' });
    }
    if (value.scope === "tree" && !hasRoot) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rootID"], message: 'rootID is required when scope="tree".' });
    }
});

export const FlashcardGetDecksSchema = z.object({
    action: z.literal("get_decks"),
});

export const FlashcardReviewCardSchema = z.object({
    action: z.literal("review_card"),
    deckID: z.string().describe("Deck ID"),
    cardID: z.string().describe("Card ID"),
    rating: z.number().optional().describe("Review rating passed through to the kernel"),
    skip: z.boolean().optional().describe("When true, skip the current card instead of submitting a rating"),
    reviewedCards: z.array(z.object({
        cardID: z.string().describe("Reviewed card ID"),
    }).passthrough()).optional().describe("Optional already-reviewed cards; SiYuan reads reviewedCards[].cardID"),
}).superRefine((value, ctx) => {
    if (value.skip !== true && value.rating === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rating is required unless skip=true.", path: ["rating"] });
    }
});

export const FlashcardCreateCardSchema = z.object({
    action: z.literal("create_card"),
    deckID: z.string().describe("Deck ID"),
    blockIDs: z.array(z.string()).min(1).describe("Existing block IDs to turn into flashcards"),
    mode: z.enum(["full", "attach"]).optional().describe('Compatibility option. SiYuan addRiffCards writes deck attrs and registers cards in both modes.'),
});

export const FlashcardRemoveCardSchema = z.object({
    action: z.literal("remove_card"),
    deckID: z.string().describe("Deck ID"),
    blockIDs: z.array(z.string()).min(1).describe("Existing block IDs to remove from flashcards"),
});

export const FlashcardGetCardsSchema = z.object({
    action: z.literal("get_cards"),
    deckID: z.string().describe("Deck ID (use empty string to query across all decks)"),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).max(512).optional().describe("Cards per page, default 32"),
});

export const BlockInsertSchema = z.object({
    action: z.literal("insert"),
    dataType: z.enum(["markdown", "dom"]).optional().describe("Data format"),
    data: z.string().optional().describe("Block content"),
    nextID: z.string().optional().describe("Next block ID"),
    previousID: z.string().optional().describe("Previous block ID"),
    parentID: z.string().optional().describe("Parent block or document ID"),
    blocks: z.array(z.object({
        dataType: z.enum(["markdown", "dom"]).describe("Data format"),
        data: z.string().describe("Block content"),
        nextID: z.string().optional().describe("Next block ID"),
        previousID: z.string().optional().describe("Previous block ID"),
        parentID: z.string().optional().describe("Parent block or document ID"),
    })).min(1).optional().describe("Blocks to insert. Item-level anchors override top-level parentID/previousID/nextID."),
}).superRefine((value, ctx) => {
    const batch = Array.isArray(value.blocks);
    if (batch) {
        if (value.dataType || value.data) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide either blocks or single insert data, not both.", path: ["blocks"] });
        }
        value.blocks!.forEach((block, index) => {
            if (block.nextID || block.previousID || block.parentID || value.nextID || value.previousID || value.parentID) return;
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["blocks", index, "previousID"], message: "Provide nextID, previousID, or parentID for each block, or set a top-level parentID/previousID/nextID." });
        });
        return;
    }
    if (!value.dataType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dataType is required for single insert.", path: ["dataType"] });
    if (value.data === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "data is required for single insert.", path: ["data"] });
});

export const BlockPrependSchema = z.object({
    action: z.literal("prepend"),
    dataType: z.enum(["markdown", "dom"]).describe("Data format"),
    data: z.string().describe("Block content"),
    parentID: z.string().describe("Parent block or document ID"),
});

export const BlockAppendSchema = z.object({
    action: z.literal("append"),
    dataType: z.enum(["markdown", "dom"]).describe("Data format"),
    data: z.string().describe("Block content"),
    parentID: z.string().describe("Parent block or document ID"),
});

export const BlockUpdateSchema = z.object({
    action: z.literal("update"),
    dataType: z.enum(["markdown", "dom"]).optional().describe("Data format"),
    data: z.string().optional().describe("New block content"),
    id: z.string().optional().describe("Block ID"),
    items: z.array(z.object({
        id: z.string().describe("Block ID"),
        dataType: z.enum(["markdown", "dom"]).describe("Data format"),
        data: z.string().describe("Replacement block content"),
    })).min(1).optional().describe("Blocks to update"),
}).superRefine((value, ctx) => {
    if (Array.isArray(value.items)) {
        if (value.id || value.dataType || value.data !== undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide either items or single update fields, not both.", path: ["items"] });
        }
        return;
    }
    if (!value.id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "id is required for single update.", path: ["id"] });
    if (!value.dataType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dataType is required for single update.", path: ["dataType"] });
    if (value.data === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "data is required for single update.", path: ["data"] });
});

export const BlockReplaceSchema = z.object({
    action: z.literal("replace"),
    id: z.string().describe("Block ID"),
    edit: z.union([
        FsReplaceEditSchema,
        z.array(FsReplaceEditSchema).min(1),
    ]).describe("One replacement edit or an array of edits to apply sequentially within the same block kramdown"),
});

export const BlockDeleteSchema = z.object({
    action: z.literal("delete"),
    id: z.string().describe("Block ID"),
});

export const BlockMoveSchema = z.object({
    action: z.literal("move"),
    id: z.string().optional().describe("Single block ID"),
    ids: z.array(z.string()).min(1).optional().describe("Multiple block IDs to move as a group. Pass IDs in the desired final order; the tool calls SiYuan's low-level move API from last to first internally to preserve that order."),
    previousID: z.string().optional().describe("Previous block ID"),
    parentID: z.string().optional().describe("New parent block ID"),
}).superRefine((value, ctx) => {
    if ((value.id && value.ids) || (!value.id && !value.ids)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide exactly one of id or ids.",
            path: ["id"],
        });
    }
    if (!value.previousID && !value.parentID) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide previousID, parentID, or both to describe the destination.",
            path: ["previousID"],
        });
    }
});

export const BlockSetFoldStateSchema = z.object({
    action: z.literal("set_fold_state"),
    id: z.string().describe("Foldable block ID"),
    folded: z.boolean().describe("true to fold, false to unfold"),
});

export const BlockGetKramdownSchema = z.object({
    action: z.literal("get_kramdown"),
    id: z.string().describe("Block ID or document ID"),
});

export const BlockBatchKramdownSchema = z.object({
    action: z.literal("batch_kramdown"),
    ids: z.array(z.string().min(1)).min(1).max(20).describe("Block or document IDs. Results preserve this input order, including duplicate IDs."),
    mode: z.enum(["md", "textmark"]).optional().describe('Kramdown export mode: "md" (default) or "textmark"'),
});

export const BlockGetChildrenSchema = z.object({
    action: z.literal("get_children"),
    id: z.string().describe("Block ID or document ID"),
    page: z.number().int().min(1).optional().describe('Page number (1-based), default 1'),
    pageSize: z.number().int().min(1).max(200).optional().describe('Items per page, default 50'),
});

export const BlockTransferReferencesSchema = z.object({
    action: z.literal("transfer_references"),
    fromID: z.string().describe("Source block ID"),
    toID: z.string().describe("Target block ID"),
    refIDs: z.array(z.string()).optional().describe("Reference block IDs"),
});

export const BlockSetAttrsSchema = z.object({
    action: z.literal("set_attrs"),
    id: z.string().describe("Block ID"),
    attrs: z.record(z.string(), z.string()).describe("Block attributes"),
});

export const BlockGetAttrsSchema = z.object({
    action: z.literal("get_attrs"),
    id: z.string().describe("Block ID"),
});

export const BlockInfoSchema = z.object({
    action: z.literal("info"),
    id: z.string().describe("Block ID"),
});

export const BlockBreadcrumbSchema = z.object({
    action: z.literal("breadcrumb"),
    id: z.string().describe("Block ID"),
    excludeTypes: z.array(z.string()).optional().describe("Optional block types to exclude from the breadcrumb"),
});

export const BlockDomSchema = z.object({
    action: z.literal("dom"),
    id: z.string().describe("Block ID"),
});

export const BlockRecentUpdatedSchema = z.object({
    action: z.literal("recent_updated"),
    count: z.number().optional().describe("Maximum number of recent readable blocks to return after permission filtering"),
});

export const BlockWordCountSchema = z.object({
    action: z.literal("word_count"),
    ids: z.array(z.string()).describe("One or more block IDs"),
});

export const BlockAddToDailyNoteSchema = z.object({
    action: z.literal("add_to_daily_note"),
    notebook: z.string().describe("Notebook ID"),
    dataType: z.enum(["markdown", "dom"]).describe("Data format"),
    data: z.string().describe("Block content"),
    position: z.enum(["append", "prepend"]).describe("Where to add content in today's daily note"),
});

export const BlockDocsInfoSchema = z.object({
    action: z.literal("docs_info"),
    id: z.string().optional().describe("Single document/block ID"),
    ids: z.array(z.string()).min(1).optional().describe("Document IDs"),
    refCount: z.boolean().optional().describe("When true, include reference counts"),
    av: z.boolean().optional().describe("When true, include AV metadata"),
}).superRefine((value, ctx) => {
    if ((value.id && value.ids) || (!value.id && !value.ids)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of id or ids.", path: ["ids"] });
    }
});

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

export const AvGetSchema = z.object({
    action: z.literal("get"),
    id: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Optional database block ID for exact context or fallback permission resolution"),
});

export const AvRenderSchema = z.object({
    action: z.literal("render"),
    id: z.string().optional().describe("Attribute view ID for render/get-style operations; use id here, not avID. Omit only with createIfNotExist=true to let MCP generate one"),
    blockID: z.string().optional().describe("Optional database block ID; required when creating a new AV"),
    viewID: z.string().optional().describe("Optional target view ID"),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().optional().describe("Rows per page; use -1 or omit for kernel default"),
    query: z.string().optional().describe("Optional row query filter"),
    groupPaging: z.record(z.string(), z.unknown()).optional().describe("Optional group paging map passed through to SiYuan"),
    createIfNotExist: z.boolean().optional().describe("Create the default view only when explicitly true; provide blockID when creating a new AV"),
});

export const AvGetAttributeViewKeysSchema = z.object({
    action: z.literal("get_attribute_view_keys"),
    id: z.string().describe("Attribute view ID"),
});

export const AvGetAttributeViewFilterSortSchema = z.object({
    action: z.literal("get_attribute_view_filter_sort"),
    id: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Database block ID (optional)"),
});

export const AvSearchSchema = z.object({
    action: z.literal("search"),
    keyword: z.string().describe("Keyword to search in attribute view names"),
    excludes: z.array(z.string()).optional().describe("Optional AV IDs to exclude"),
});

export const AvAddRowsSchema = z.object({
    action: z.literal("add_rows"),
    avID: z.string().describe("Attribute view ID"),
    blockIDs: z.array(z.string()).optional().describe("Existing block IDs to add as bound rows"),
    primaryKeyTexts: z.array(z.string()).optional().describe("Plain-text primary key values to add as detached rows"),
    blockID: z.string().optional().describe("Optional database block ID used to pin a specific database-block view context"),
    viewID: z.string().optional().describe("Optional target view ID"),
    groupID: z.string().optional().describe("Optional target group ID"),
    previousID: z.string().optional().describe("Optional previous row item ID"),
    ignoreDefaultFill: z.boolean().optional().describe("When true, skip view/group default value filling"),
});

export const AvRemoveRowsSchema = z.object({
    action: z.literal("remove_rows"),
    avID: z.string().describe("Attribute view ID"),
    blockID: z.string().optional().describe("Registered database block ID for explicit database-block context"),
    srcIDs: z.array(z.string()).min(1).describe("Bound row block/item IDs to remove"),
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

export const AvDuplicateSchema = z.object({
    action: z.literal("duplicate"),
    avID: z.string().describe("Source attribute view ID"),
    blockID: z.string().optional().describe("Optional source database block ID used as exact context and default insertion target"),
    previousID: z.string().optional().describe("Optional block ID to insert the duplicated mirror database block after"),
});

export const AvGetPrimaryKeyValuesSchema = z.object({
    action: z.literal("get_primary_key_values"),
    avID: z.string().describe("Attribute view ID"),
    keyword: z.string().optional().describe("Optional keyword filter for primary key values"),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).optional().describe("Rows per page, default all"),
});

export const FileUploadAssetSchema = z.object({
    action: z.literal("upload_asset"),
    assetsDirPath: z.string().describe("Asset directory path (e.g., /assets/)"),
    localFilePath: z.string().describe("Local file path to read and upload into the assets directory"),
    confirmLargeFile: z.boolean().optional().describe("Set to true only after the user explicitly confirms uploading a file larger than the configured safety threshold."),
});

export const FileListTemplatesSchema = z.object({
    action: z.literal("list_templates"),
    query: z.string().optional().describe("Optional keyword used by SiYuan's template picker. Omit or pass an empty string to list all templates."),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).max(128).optional().describe("Templates per page, default 20"),
});

export const FileReadTemplateSchema = z.object({
    action: z.literal("read_template"),
    path: z.string().describe("Template path returned by list_templates, /data/templates/... path, /templates/... static path, or path relative to data/templates"),
    offset: z.number().int().min(0).optional().describe("Character offset for partial template source reading, default 0"),
    limit: z.number().int().min(1).max(20000).optional().describe("Maximum characters to return, default 8000"),
});

export const FileCreateTemplateSchema = z.object({
    action: z.literal("create_template"),
    path: z.string().describe("Template path to create under data/templates. Accepts relative paths such as reports/monthly.md."),
    markdown: z.string().describe("Full Markdown template source to write."),
    overwrite: z.boolean().optional().describe("When true, replace an existing template at the same path. Defaults to false."),
});

export const FileUpdateTemplateSchema = z.object({
    action: z.literal("update_template"),
    path: z.string().describe("Existing template path returned by list_templates, /data/templates/... path, /templates/... static path, or path relative to data/templates."),
    markdown: z.string().describe("Full Markdown template source to replace the existing template with."),
});

export const FileDeleteTemplateSchema = z.object({
    action: z.literal("delete_template"),
    path: z.string().describe("Existing template path returned by list_templates, /data/templates/... path, /templates/... static path, or path relative to data/templates."),
});

export const FileSaveDocAsTemplateSchema = z.object({
    action: z.literal("save_doc_as_template"),
    id: z.string().describe("Document ID to save as a root-level template."),
    name: z.string().describe("Root template name. Slashes are not supported; .md suffix is optional."),
    overwrite: z.boolean().optional().describe("When true, replace an existing template with the same root name. Defaults to false."),
});

export const FileRenderSchema = z.object({
    action: z.literal("render"),
    engine: z.enum(["template", "sprig"]).describe("Template engine to use"),
    id: z.string().optional().describe("Document ID for template context"),
    path: z.string().optional().describe("Template file path inside the SiYuan workspace"),
    template: z.string().optional().describe("Sprig template content"),
    preview: z.boolean().optional().describe("When engine=\"template\", ask SiYuan to render preview DOM instead of insertion DOM."),
}).superRefine((value, ctx) => {
    if (value.engine === "template") {
        if (!value.id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "id is required when engine=\"template\".", path: ["id"] });
        if (!value.path) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "path is required when engine=\"template\".", path: ["path"] });
    }
    if (value.engine === "sprig" && !value.template) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "template is required when engine=\"sprig\".", path: ["template"] });
    }
});

export const FileExportMdSchema = z.object({
    action: z.literal("export_md"),
    id: z.string().describe("Document ID to export"),
});

export const FileExportMarkdownSnapshotSchema = z.object({
    action: z.literal("export_markdown_snapshot"),
    notebookID: z.string().min(1).describe("Notebook ID that owns every exported document"),
    roots: z.array(z.string().min(1)).min(1).max(64).optional().describe("Notebook-local storage paths to enumerate (use / for notebook roots)"),
    documentIDs: z.array(z.string().min(1)).min(1).max(500).optional().describe("Explicit document IDs to export"),
    limit: z.number().int().min(1).max(200).optional().describe("Documents returned in this page (default 20)"),
    cursor: z.string().optional().describe("Opaque continuation cursor returned by the previous page"),
}).superRefine((value, ctx) => {
    if (Boolean(value.roots) === Boolean(value.documentIDs)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of roots or documentIDs." });
    }
});

export const FileExportResourcesSchema = z.object({
    action: z.literal("export_resources"),
    paths: z.array(z.string()).describe("Paths to export"),
    name: z.string().optional().describe("Export file name"),
    outputPath: z.string().optional().describe("Optional local absolute or relative filesystem path to save the exported ZIP"),
});

export const FileListUnusedAssetsSchema = z.object({
    action: z.literal("list_unused_assets"),
});

export const FileGetDocAssetsSchema = z.object({
    action: z.literal("get_doc_assets"),
    id: z.string().describe("Document ID"),
    assetType: z.enum(['all', 'image']).optional().describe("Filter asset type: 'all' (default) returns all assets, 'image' returns only image assets."),
});

export const FileAuditImageRefsSchema = z.object({
    action: z.literal("audit_image_refs"),
    id: z.string().describe("Document ID whose direct image references should be inspected."),
    expectedRefs: z.array(z.string().min(1)).max(4096).describe("Expected image references from source Markdown; no local file is read."),
});

export const FileGetImageOCRTextSchema = z.object({
    action: z.literal("get_image_ocr_text"),
    path: z.string().optional().describe("Asset path; omit to receive an empty OCR text payload"),
});

export const FileRemoveUnusedAssetsSchema = z.object({
    action: z.literal("remove_unused_assets"),
});

export const FileRenameAssetSchema = z.object({
    action: z.literal("rename_asset"),
    oldPath: z.string().describe("Existing asset path"),
    newName: z.string().describe("New asset file name"),
});

export const FileDeleteAssetSchema = z.object({
    action: z.literal("delete_asset"),
    path: z.string().describe("Asset path to delete"),
});

export const FileExtractDocSchema = z.object({
    action: z.literal("extract_doc"),
    id: z.string().describe("Document ID to extract"),
    outputDir: z.string().optional().describe("Output root directory. Defaults to ~/siyuan-extracted/ (resolved to absolute path)."),
});

export const SearchActionSchema = z.enum(SEARCH_ACTIONS);

const SearchMethodNameSchema = z.enum(["keyword", "query", "query_syntax", "sql", "regex"]);
const SearchSortNameSchema = z.enum(["relevance", "date", "updated_desc", "updated_asc", "created_desc", "created_asc", "type"]);
const SearchAssetSortNameSchema = z.enum(["relevance", "relevance_desc", "relevance_asc", "updated_asc", "updated_desc"]);

export const SearchFulltextSchema = z.object({
    action: z.literal("fulltext"),
    query: z.string().describe("Search query string"),
    method: z.number().optional().describe("Search method: 0=keyword (default), 1=query syntax, 2=SQL, 3=regex"),
    methodName: SearchMethodNameSchema.optional().describe('Semantic alias for method: "keyword" | "query_syntax" | "sql" | "regex". The short alias "query" also maps to query syntax and overrides method when both are provided.'),
    types: z.record(z.string(), z.boolean()).optional().describe("Block type filter. Accepts full names (e.g. {\"heading\": true}) or shortcodes (e.g. {\"h\": true, \"p\": true}). Codes: d=document, h=heading, p=paragraph, l=list, i=listItem, b=blockquote, c=codeBlock, m=mathBlock, t=table, s=superBlock, html=htmlBlock, embed=embedBlock, av=databaseBlock."),
    typeShortcodes: z.array(z.string()).optional().describe("Alternative shorthand type filter as array: [\"h\",\"p\"]. Merged with types if both provided."),
    paths: z.array(z.string()).optional().describe("Restrict search to specific notebook paths"),
    groupBy: z.number().optional().describe("0=no grouping (default), 1=group by document"),
    orderBy: z.number().optional().describe("Legacy numeric sort order: 0=type, 1=created ASC, 2=created DESC, 3=updated ASC, 4=updated DESC, 5=content ASC, 6=content DESC, 7=relevance (default)"),
    sortBy: SearchSortNameSchema.optional().describe('Semantic sort alias: "relevance", "date", "updated_desc", "updated_asc", "created_desc", "created_asc", or "type". Overrides orderBy if both provided.'),
    page: z.number().optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().optional().describe("Results per page, default 32, max 128"),
    parentId: z.string().optional().describe("Post-filter results to blocks whose root_id or parent_id matches this ID, scoping search within a document subtree."),
    hasTags: z.boolean().optional().describe("When true, only return blocks that have tags. When false, only return blocks without tags."),
    stripHtml: z.boolean().optional().describe("Legacy toggle. plainContent is now returned by default; set this when you want to emphasize plain-text-safe downstream parsing while keeping highlighted HTML content."),
});

export const SearchSemanticSchema = z.object({
    action: z.literal("semantic"),
    query: z.string().min(1).describe("Natural-language semantic search query"),
    paths: z.array(z.string()).optional().describe("Restrict search to notebook IDs or notebook/storage paths"),
    types: z.record(z.string(), z.boolean()).optional().describe("Block type filter. Accepts full names or shortcodes."),
    typeShortcodes: z.array(z.string()).optional().describe("Alternative block type filter using shortcodes such as h, p, c, or av. Merged with types."),
    subTypes: z.record(z.string(), z.boolean()).optional().describe("Optional SiYuan block subtype filter"),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).max(128).optional().describe("Results per page, default 32, max 128"),
});

export const SearchQuerySqlSchema = z.object({
    action: z.literal("query_sql"),
    stmt: z.string().optional().describe("SQL SELECT statement to execute against the blocks/spans/assets tables; returned rows are permission-filtered"),
    sql: z.string().optional().describe("Semantic alias for stmt. Overrides stmt when both are provided."),
}).superRefine((value, ctx) => {
    if (!value.stmt && !value.sql) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide stmt or sql.",
            path: ['stmt'],
        });
    }
});

export const SearchGetBacklinksSchema = z.object({
    action: z.literal("get_backlinks"),
    id: z.string().describe("Block or document ID to find backlinks for"),
    keyword: z.string().optional().describe("Filter backlinks by keyword"),
    refTreeID: z.string().optional().describe("Optional document tree ID to narrow backlink scope"),
    scopeRootId: z.string().optional().describe("Semantic alias for refTreeID. Overrides refTreeID when both are provided."),
    mode: z.enum(["links", "mentions", "both"]).optional().describe('Result mode: "links", "mentions", or "both" (default).'),
});

export const SearchRefsSchema = z.object({
    action: z.literal("search_refs"),
    id: z.string().describe("Referenced block or document ID"),
    rootID: z.string().optional().describe("Optional current root document ID"),
    k: z.string().optional().describe("Keyword filter"),
    beforeLen: z.number().int().min(0).optional().describe("Context length before the reference, default 512"),
    isSquareBrackets: z.boolean().optional().describe("Search in square-bracket reference mode"),
    isDatabase: z.boolean().optional().describe("Whether the reference target is a database"),
    reqId: z.string().optional().describe("Optional passthrough request ID"),
});

export const SearchFindReplaceSchema = z.object({
    action: z.literal("find_replace"),
    k: z.string().describe("Find keyword"),
    r: z.string().describe("Replacement text; use empty string to delete matches"),
    ids: z.array(z.string()).min(1).describe("Document or block IDs to mutate"),
    paths: z.array(z.string()).optional().describe("Optional path scope list"),
    types: z.record(z.string(), z.boolean()).optional().describe("Optional block type filter"),
    method: z.number().optional().describe("Search method: 0=keyword, 1=query syntax, 2=SQL, 3=regex"),
    methodName: SearchMethodNameSchema.optional().describe('Semantic alias for method: "keyword" | "query_syntax" | "sql" | "regex". The short alias "query" also maps to query syntax and overrides method when both are provided.'),
    orderBy: z.number().optional().describe("Legacy numeric sort order"),
    sortBy: SearchSortNameSchema.optional().describe('Semantic sort alias that overrides orderBy when both are provided.'),
    groupBy: z.number().optional().describe("Grouping mode"),
    replaceTypes: z.record(z.string(), z.boolean()).optional().describe("Replace target kinds such as text, code, docTitle, blockRef"),
});

export const SearchAssetsSchema = z.object({
    action: z.literal("search_assets"),
    k: z.string().optional().describe("Legacy asset filename keyword field"),
    query: z.string().optional().describe("Semantic alias for k. Overrides k when both are provided."),
    exts: z.array(z.string()).optional().describe("Optional extension filters"),
}).superRefine((value, ctx) => {
    if (!value.k && !value.query) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide k or query.",
            path: ['k'],
        });
    }
});

export const SearchFulltextAssetContentSchema = z.object({
    action: z.literal("fulltext_asset_content"),
    query: z.string().optional().describe("Search query string"),
    assetId: z.string().optional().describe("Asset content ID for an exact content lookup"),
    queryMethod: z.number().optional().describe("Query method for assetId lookup: 0=keyword, 1=query syntax, 2=SQL, 3=regex"),
    types: z.record(z.string(), z.boolean()).optional().describe("Asset type filter"),
    method: z.number().optional().describe("Search method: 0=keyword, 1=query syntax, 2=SQL, 3=regex"),
    methodName: SearchMethodNameSchema.optional().describe('Semantic alias for method: "keyword" | "query_syntax" | "sql" | "regex". The short alias "query" also maps to query syntax and overrides method when both are provided.'),
    orderBy: z.number().optional().describe("Legacy numeric sort order: 0=relevance DESC, 1=relevance ASC, 2=updated ASC, 3=updated DESC"),
    sortBy: SearchAssetSortNameSchema.optional().describe('Semantic sort alias: "relevance_desc", "relevance_asc", "updated_asc", or "updated_desc". The shorthand "relevance" maps to relevance_desc. Overrides orderBy if both are provided.'),
    page: z.number().int().min(1).optional().describe("Page number (1-based)"),
    pageSize: z.number().int().min(1).max(128).optional().describe("Results per page"),
}).superRefine((value, ctx) => {
    if (!value.query && !value.assetId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide query or assetId.", path: ["query"] });
    }
});

export const SearchListInvalidRefsSchema = z.object({
    action: z.literal("list_invalid_refs"),
    page: z.number().int().min(1).optional().describe("Page number (1-based)"),
    pageSize: z.number().int().min(1).max(128).optional().describe("Results per page"),
});

export const TagActionSchema = z.enum(TAG_ACTIONS);

export const TagListSchema = z.object({
    action: z.literal("list"),
    keyword: z.string().optional().describe("Optional keyword used to search/filter tags"),
    query: z.string().optional().describe("Alias for keyword"),
    sort: z.number().optional().describe("Optional tag sort mode"),
    ignoreMaxListHint: z.boolean().optional().describe("Ignore the maximum list hint from SiYuan"),
    app: z.string().optional().describe("Optional app identifier passed through to SiYuan"),
});

export const TagRenameSchema = z.object({
    action: z.literal("rename"),
    oldLabel: z.string().describe("Existing tag label"),
    newLabel: z.string().describe("New tag label"),
});

export const TagRemoveSchema = z.object({
    action: z.literal("remove"),
    label: z.string().describe("Tag label to remove"),
});

export const TimelineListNodesSchema = z.object({
    action: z.literal("list_nodes"),
    scope: z.enum(["global", "document", "all"]).describe("Node scope to list"),
    documentId: z.string().optional().describe("Required for document or all scope"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
    pageSize: z.number().int().min(1).max(100).optional().describe("Nodes per page (default 50)"),
}).superRefine((value, ctx) => {
    if (value.scope !== "global" && !value.documentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documentId"], message: "documentId is required for document or all scope." });
    }
});

export const TimelineCreateNodeSchema = z.object({
    action: z.literal("create_node"),
    name: z.string().trim().min(1).describe("Human-readable timeline node name"),
    scope: z.enum(["global", "document"]).describe("Create a workspace-global or document-scoped node"),
    documentId: z.string().optional().describe("Required for document scope"),
}).superRefine((value, ctx) => {
    if (value.scope === "document" && !value.documentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["documentId"], message: "documentId is required for document scope." });
    }
});

export const TimelineCompareNodeSchema = z.object({
    action: z.literal("compare_node"),
    documentId: z.string().describe("Document ID to compare"),
    tag: z.string().min(1).describe("Timeline tag returned by create_node or list_nodes"),
    page: z.number().int().min(1).optional().describe("Changed-block page number (default 1)"),
    pageSize: z.number().int().min(1).max(100).optional().describe("Blocks per page (default 20)"),
    includeUnchanged: z.boolean().optional().describe("Include unchanged blocks in the paginated result (default false)"),
});

export const TimelineDeleteNodeSchema = z.object({
    action: z.literal("delete_node"),
    tag: z.string().min(1).describe("Timeline tag to remove"),
    documentId: z.string().optional().describe("Required for document-scoped tags; omit for global tags"),
});

export const TimelineRollbackDocumentSchema = z.object({
    action: z.literal("rollback_document"),
    documentId: z.string().describe("Document ID to restore"),
    tag: z.string().min(1).describe("Timeline tag identifying the historical node"),
});

export const TimelineRollbackBlockSchema = z.object({
    action: z.literal("rollback_block"),
    documentId: z.string().describe("Document ID containing the block change"),
    tag: z.string().min(1).describe("Timeline tag identifying the historical node"),
    changeKey: z.string().min(1).describe("Opaque changeKey returned by the latest compare_node call"),
});

export const SystemActionSchema = z.enum(SYSTEM_ACTIONS);

export const SystemWorkspaceInfoSchema = z.object({
    action: z.literal("workspace_info"),
});

export const SystemNetworkSchema = z.object({
    action: z.literal("network"),
});

export const SystemConfSchema = z.object({
    action: z.literal("conf"),
    mode: z.enum(["summary", "get"]).optional().describe('Read mode: "summary" returns a navigable overview, "get" reads a specific key path'),
    keyPath: z.string().optional().describe('Dot/bracket path to a specific config field, e.g. "conf.appearance.mode" or "conf.langs[0]"'),
    maxDepth: z.number().int().min(0).max(5).optional().describe('Maximum object traversal depth for summary/get responses'),
    maxItems: z.number().int().min(1).max(100).optional().describe('Maximum keys/items to include per level'),
});

export const SystemNotifySchema = z.object({
    action: z.literal("notify"),
    msg: z.string().describe("Message content"),
    level: z.enum(["info", "error"]).describe("Notification level"),
    timeout: z.number().optional().describe("Display timeout in milliseconds"),
});

export const SystemChangelogSchema = z.object({
    action: z.literal("changelog"),
    version: z.string().optional().describe("Exact plugin version to read, e.g. 0.4.11 or v0.4.11"),
    fromVersion: z.string().optional().describe("Previous plugin version; returns entries newer than this version"),
    limit: z.number().int().min(1).max(50).optional().describe("Maximum number of entries to return when version is omitted"),
    includeRaw: z.boolean().optional().describe("Include raw Markdown for each returned changelog entry"),
});

export const SystemPerformSyncSchema = z.object({
    action: z.literal("perform_sync"),
});

export const SystemGetVersionSchema = z.object({
    action: z.literal("get_version"),
});

export const SystemGetCurrentTimeSchema = z.object({
    action: z.literal("get_current_time"),
});
