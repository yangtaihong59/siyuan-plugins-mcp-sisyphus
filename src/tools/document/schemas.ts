import { z } from "zod";
import { DOCUMENT_ACTIONS } from "../../core/config";

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

export const DocumentActionSchema = z.enum(DOCUMENT_ACTIONS);

export const DOCUMENT_CREATE_MAX_BATCH = 20;

/** Path identity for duplicate detection inside one batch: trimmed, single slashes, no trailing slash. */
export function normalizeBatchCreatePath(path: string): string {
    return path.trim().replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
}

const DocumentCreateItemSchema = z.object({
    path: z.string().refine((value) => /^\/.*[^/\s]/.test(normalizeBatchCreatePath(value)), "Must start with / and name a document, e.g. /Folder/Doc").describe("Notebook-local path, like path"),
    markdown: z.string().optional(),
}).strict();

export const DocumentCreateSchema = z.object({
    action: z.literal("create"),
    notebook: z.string().describe("Notebook ID"),
    path: z.string().optional().describe("Human-readable target path, relative to the notebook root. Must start with / and MUST NOT include the notebook name (e.g., /Folder/Doc, not /NotebookName/Folder/Doc). Parent paths must already exist."),
    parentPath: z.string().optional().describe("Parent path for title-based creation, relative to the notebook root. Accepts a human-readable path (must start with /, MUST NOT include the notebook name) or a storage path ending in .sy returned by document(action=\"lookup\")."),
    title: z.string().optional().describe("Required together with parentPath when create omits path; notebook + title alone is invalid"),
    markdown: z.string().optional().describe("Markdown content, defaults to empty. Do not include a leading # Title; a matching H1 is stripped automatically."),
    sorts: z.array(z.string()).optional().describe("Compatibility option retained for older callers; title-based creation now uses the reliable path flow"),
    icon: z.string().optional().describe("Optional document icon. Prefer a Unicode hex code string such as '1f4d4' for 📔 instead of a raw emoji character."),
    docs: z.array(DocumentCreateItemSchema).min(1).max(DOCUMENT_CREATE_MAX_BATCH).optional().describe("Batch: up to 20 {path,markdown?}, created in order; excludes path/parentPath/title/markdown/icon"),
}).superRefine((value, ctx) => {
    if (value.docs) {
        if ([value.path, value.parentPath, value.title, value.markdown, value.icon].some((field) => field !== undefined)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "docs is mutually exclusive with path, parentPath, title, markdown and icon.",
                path: ["docs"],
            });
            return;
        }
        const seen = new Map<string, number>();
        value.docs.forEach((item, index) => {
            const key = normalizeBatchCreatePath(item.path);
            const first = seen.get(key);
            if (first !== undefined) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `docs[${index}].path repeats docs[${first}].path (${item.path}); each path may appear once. Nothing was created.`,
                    path: ["docs", index, "path"],
                });
            } else {
                seen.set(key, index);
            }
        });
        return;
    }
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
    hpath: z.string().optional().describe("Human-readable notebook-local path to look up when notebook is provided. MUST NOT include the notebook name (e.g., /Folder/Doc, not /Notebook/Folder/Doc)"),
    hPath: z.string().optional().describe("Alias for hpath (notebook-local, MUST NOT include the notebook name)"),
    include: z.array(DocumentResolveIncludeSchema).optional().describe('Fields to include, only: "id", "ids", "path", "hpath", "docInfo" (no "title"; use docInfo.name)'),
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

export const DOCUMENT_QUERY_FIELDS = ["id", "notebook", "title", "path", "hpath", "created", "updated", "blockCount", "contentChars", "sameTitleCount"] as const;

export const DocumentQuerySchema = z.object({
    action: z.literal("query"),
    notebooks: z.array(z.string().min(1).max(256)).min(1).max(100).optional().describe("IDs; default readable open notebooks. Explicit unreadable/closed IDs are rejected."),
    fields: z.array(z.enum(DOCUMENT_QUERY_FIELDS)).min(1).max(10).optional().describe("Columns; default all. Statistics describe the SQL index; see query help for definitions."),
    title: z.string().min(1).max(512).refine(value => !value.includes('\0'), "NUL is not allowed").optional().describe("Literal case-sensitive title substring."),
    hpathPrefix: z.string().min(1).max(4096).refine(value => value.startsWith('/') && !value.includes('\0'), "Use an absolute notebook-local hpath without NUL").optional().describe("Exact notebook-local hpath or descendants, e.g. /Projects."),
    minBlocks: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    maxBlocks: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    minChars: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    maxChars: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    duplicatesOnly: z.boolean().optional().describe("Only repeated titles in scope; not proof of duplicate content."),
    sortBy: z.enum(["id", "title", "created", "updated", "blockCount", "contentChars", "sameTitleCount"]).optional().describe("Default updated; ID breaks ties."),
    sortOrder: z.enum(["asc", "desc"]).optional().describe("Default desc."),
    page: z.number().int().min(1).max(1000000).optional().describe("1-based; default 1. Pages are not a snapshot."),
    pageSize: z.number().int().min(1).max(100).optional().describe("Default 50, max 100."),
}).strict().superRefine((value, ctx) => {
    for (const [min, max] of [["minBlocks", "maxBlocks"], ["minChars", "maxChars"]] as const) {
        if (value[min] !== undefined && value[max] !== undefined && value[min] > value[max]) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [max], message: `${max} must be greater than or equal to ${min}.` });
        }
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

const DocumentRenameItemSchema = z.object({
    id: z.string().min(1).describe("Document ID to rename"),
    title: z.string().min(1).describe("New document title"),
});

export const DocumentRenameSchema = DocumentReferenceSchema.extend({
    action: z.literal("rename"),
    title: z.string().optional().describe("New document title for single-document mode"),
    items: z.array(DocumentRenameItemSchema).min(1).max(50).optional().describe("Bounded batch of {id,title}. Mutually exclusive with id/notebook/path/title. Maximum 50 items and 256 KiB serialized input."),
}).superRefine((value, ctx) => {
    if (value.items) {
        if (value.id || value.notebook || value.path || value.title) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'items is mutually exclusive with id, notebook, path, and title.',
                path: ['items'],
            });
            return;
        }
        const ids = value.items.map((item) => item.id);
        if (new Set(ids).size !== ids.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'items[].id must be unique within the batch.',
                path: ['items'],
            });
        }
        const bytes = new TextEncoder().encode(JSON.stringify(value.items)).length;
        if (bytes > 256 * 1024) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'items exceeds the 256 KiB serialized input limit.',
                path: ['items'],
            });
        }
        return;
    }
    if (typeof value.title !== 'string' || !value.title.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide title for single-document rename, or items for batch rename.',
            path: ['title'],
        });
        return;
    }
    const hasId = typeof value.id === 'string';
    const hasPathRef = typeof value.notebook === 'string' || typeof value.path === 'string';
    if (hasId === hasPathRef) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide either id or notebook + path.',
        });
        return;
    }
    if (hasPathRef && (!value.notebook || !value.path)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Both notebook and path are required when id is not provided.',
        });
    }
});

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
    }).catchall(z.string()).describe("icon, cover and custom-* keys (\"\" removes a custom-* key)"),
}).superRefine((value, ctx) => {
    const keys = Object.keys(value.attrs);
    const other = keys.filter((key) => key !== "icon" && key !== "cover" && !/^custom-[A-Za-z0-9_-]+$/.test(key));
    if (other.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `document set_attr sets icon, cover and custom-* attributes only; ${other.join(", ")} is not one of them. For name, alias, memo or bookmark use block(action="set_attrs", id="<document id>") (a document is a block).`, path: ["attrs"] });
        return;
    }
    if (keys.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "attrs is empty: pass icon, cover or custom-* keys, e.g. attrs={\"custom-type\":\"meeting\"}.", path: ["attrs"] });
    }
});

export const DocumentListTreeSchema = z.object({
    action: z.literal("list_tree"),
    notebook: z.string().describe("Notebook ID"),
    path: z.string().describe("Storage path (e.g., /20240318112233-abc123.sy) or / for the notebook root"),
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
    blockLimit: z.number().int().min(1).max(200).optional().describe("Optional maximum complete display blocks in markdown mode. Omit to try full text, subject to the 256 KiB hard content limit."),
    tokenBudget: z.number().int().min(1).max(32000).optional().describe("Optional soft token budget for markdown. Complete blocks may exceed it, but never the 256 KiB hard content limit."),
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
    targetPath: z.string().optional().describe("Existing parent document storage path ending in .sy; defaults to / (target notebook root). Not a human-readable path."),
    previousPath: z.string().optional().describe("Existing sibling document storage path ending in .sy in targetNotebook; selects sibling placement. Do not combine with a non-root targetPath."),
});

export const DocumentDocToHeadingSchema = z.object({
    action: z.literal("doc_to_heading"),
    srcID: z.string().describe("Source document root ID, without child documents"),
    targetID: z.string().describe("Existing heading block ID in another document, from document.get_outline. Document root IDs are rejected."),
    after: z.boolean().optional().describe("When true, insert after the target heading instead of before it"),
});
