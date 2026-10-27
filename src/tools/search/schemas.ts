import { z } from "zod";
import { SEARCH_ACTIONS } from "../../core/config";

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
    paths: z.array(z.string()).optional().describe("Restrict search to specific notebook IDs or storage paths"),
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
    paths: z.array(z.string()).optional().describe("Restrict search to notebook IDs or storage paths"),
    types: z.record(z.string(), z.boolean()).optional().describe("Block type filter. Accepts full names or shortcodes."),
    typeShortcodes: z.array(z.string()).optional().describe("Alternative block type filter using shortcodes such as h, p, c, or av. Merged with types."),
    subTypes: z.record(z.string(), z.boolean()).optional().describe("Optional SiYuan block subtype filter"),
    page: z.number().int().min(1).optional().describe("Page number (1-based), default 1"),
    pageSize: z.number().int().min(1).max(128).optional().describe("Results per page, default 32, max 128"),
});

export const SearchQuerySqlSchema = z.object({
    action: z.literal("query_sql"),
    stmt: z.string().optional().describe("Read-only SELECT or WITH query. Requires every notebook to be readable; otherwise rejected before execution. Preserves every selected column."),
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
    paths: z.array(z.string()).optional().describe("Optional notebook ID or storage path scope list"),
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
