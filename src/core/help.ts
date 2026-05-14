import {
    ACTIONS_BY_CATEGORY,
    type AvAction,
    type BlockAction,
    type DocumentAction,
    type FlashcardAction,
    type FileAction,
    type NotebookAction,
    type SearchAction,
    type SystemAction,
    type TagAction,
    type MascotAction,
    type FsAction,
    type ToolCategory,
} from './config';

export const FS_GUIDANCE: string[] = [
    'Use fs first for ordinary document file operations: list, tree, read, write, move, delete, and grep-like search.',
    'fs paths are human-readable workspace paths such as /Notebook/Folder/Doc; fs outputs the same human-readable path shape and hides notebook IDs, block IDs, and storage paths.',
    'Use document, block, search, or av only for advanced SiYuan-specific operations such as block-level layout, metadata, database rows, SQL, backlinks, or assets.',
    'fs(action="write") creates missing documents. If the document already exists, pass overwrite=true to replace its body while preserving the document node and title.',
    'fs(action="replace") performs exact string replacement inside one document using old/new text snippets, including multi-line snippets, without requiring line numbers.',
    'fs(action="rm") and fs(action="mv") require explicit user confirmation before execution.',
];

export const NOTEBOOK_GUIDANCE: string[] = [
    'Use notebook IDs for set_open_state, rename, get_conf, and set_conf.',
    'notebook(action="get_permissions") supports notebook="all" (or omission) for all notebooks, and a specific notebook ID for one notebook.',
    'notebook(action="remove") requires explicit user confirmation before execution.',
    'notebook(action="get_child_docs") returns direct child documents at the notebook root and retries short closed-or-initializing windows before failing.',
    'Right after notebook(action="set_open_state", opened=false), get_child_docs may still return a retryable closed-or-initializing error; open the notebook first or retry shortly.',
];

export const DOCUMENT_GUIDANCE: string[] = [
    'For ordinary document file operations, prefer fs(action="ls"|"tree"|"read"|"write"|"search") because it accepts human-readable paths and hides storage paths and IDs.',
    'document(action="create") creates both non-empty and empty documents. Prefer path for child documents; parentPath + title is supported but MCP must resolve the real document ID after SiYuan creates it.',
    'For document(action="lookup"), path means a storage path such as /20240318112233-abc123.sy; use hpath/hPath for human-readable paths such as /Inbox/Weekly Note.',
    'Other document actions that use notebook + path expect storage paths returned by document(action="lookup").',
    'A safe path-based workflow is lookup -> rename/remove/move.',
    'document(action="get_child_blocks") and document(action="get_child_docs") return direct children for a document ID.',
    'document(action="set_attr") updates document metadata such as icon and cover; use attrs.cover=null or an empty string to clear the cover.',
    'document(action="search_docs") remains title-based, but MCP now post-filters results by notebook permission and optional storage path scope.',
    'For recently created documents, document(action="lookup", hpath=...) may briefly lag behind create because it depends on SiYuan indexing; retry if needed.',
    'document(action="lookup", id=...) may hit the same short indexing delay right after create; MCP retries briefly and then returns a timing-specific hint if indexing still has not settled.',
];

export const BLOCK_GUIDANCE: string[] = [
    'block(action="prepend") or block(action="append") with a document ID targets the document start or end.',
    'block(action="update") is best for single-block replacement. Multi-line markdown may be truncated to the first line by SiYuan; use append/prepend/insert when you need multiple blocks, tables, or longer multi-line content.',
    'block(action="replace") performs exact old/new string replacement inside one block kramdown, without traversing child blocks.',
    'block(action="prepend") or block(action="append") with a block ID targets that block\'s child list.',
    'To create real SiYuan tags inside markdown content, use the syntax #tag# with both leading and trailing # characters.',
    'To turn a block into a flashcard, prefer flashcard(action="create_card"). It writes "custom-riff-decks" and registers the riff card together.',
    'block(action="set_fold_state") requires a foldable block ID, not a document ID.',
    'block(action="recent_updated") is read-only; MCP filters unreadable notebooks first and then applies count.',
    'block(action="recent_updated") now presents the document-grouped summary as the primary user-facing view while keeping the raw block stream for advanced consumers.',
];

export const AV_GUIDANCE: string[] = [
    'AV actions operate on real SiYuan attribute views (database blocks), not Markdown tables.',
    'To initialize a new AV definition, call av(action="render", blockID, createIfNotExist=true). MCP can generate the AV ID automatically and materialize a SiYuan-style NodeAttributeView block in the target document through a transaction.',
    'Most follow-up AV reads and writes only need avID. MCP resolves the owning database block from row bindings, mirror database blocks, or the blocks-table AV block record; pass blockID when you need an exact database-block view context or fallback.',
    'Use strong typed fields such as valueType=text/number/date/checkbox/select when calling av(action="set_cells").',
    'For cell writes, rowID must be the database row item ID stored in each AV value\'s blockID field. The value id field is only the cell value ID, and block.id is the original bound source block ID.',
    'AV permission checks resolve from registered database blocks. For createIfNotExist=true, provide blockID as the creation target; after materialization, MCP can usually rediscover that owning database block automatically.',
    'av(action="search") first queries kernel search results, then MCP post-filters unreadable or unresolvable AVs and reports the filtering metadata.',
    'av(action="search") is best for database names and primary-key matches. Do not assume it will find arbitrary non-primary-key cell text immediately after writes.',
];

export const FILE_GUIDANCE: string[] = [
    'file(action="upload_asset") reads a local file path and uploads that file into SiYuan assets. Because it reads the local filesystem, it requires explicit user confirmation before execution.',
    'If the file is larger than the configured large-upload threshold (10 MB by default), MCP must stop and ask the user for explicit confirmation before retrying with confirmLargeFile=true.',
    'file(action="export_resources") exports the given paths as a ZIP archive, normalizes common asset path formats, and can optionally save the ZIP to a local filesystem path.',
    'file(action="export_resources", outputPath=...) writes to the local filesystem and requires explicit user confirmation before execution.',
    'file(action="render", engine="template") requires a template path inside the SiYuan workspace; arbitrary local paths like /tmp/... are rejected by the kernel.',
    'file(action="render", engine="template") uses SiYuan workspace template syntax .action{.title}, .action{.id}, .action{.name}, and .action{.alias}; it does not replace {{...}} placeholders.',
    'file(action="render", engine="sprig") uses inline Go/Sprig template syntax such as {{ now | date "2006-01-02" }}, but it has no document context.',
    'file(action="extract_doc") exports a document and all its assets into a self-contained uncompressed folder, so AI tools can read the files directly. Prefer this over export_resources when the goal is to inspect attachment content such as images, spreadsheets, or other binary files.',
];

export const TAG_GUIDANCE: string[] = [
    'Tag actions operate across the whole workspace rather than a single notebook.',
    'There is no direct create action for tags; tags are created by writing #tag# into block markdown content.',
    'tag(action="remove") requires explicit user confirmation before execution.',
    'Recently written tags may appear with a short indexing delay in tag list/search results; retry briefly before treating that as a failure.',
];

export const SYSTEM_GUIDANCE: string[] = [
    'All system actions in this tool are read-only.',
    'system(action="workspace_info") exposes the workspace path and is high-risk; it is disabled by default.',
    'system(action="conf") returns masked configuration, not raw secrets.',
    'Use system(action="conf", mode="summary") first, then mode="get" + keyPath such as conf.appearance.mode or conf.langs[0].',
];

export const FLASHCARD_GUIDANCE: string[] = [
    'flashcard actions cover review-first flashcard workflows and deck discovery.',
    'list_cards always reads from the kernel due-card endpoints and MCP post-filters cards by state for filter="new" or filter="old"; pass reviewedCards to match SiYuan\'s in-review filtering.',
    'get_cards returns all cards in a deck (not just due ones), with pagination. Use it to browse or audit deck contents.',
    'Prefer flashcard(action="create_card", deckID, blockIDs) when the goal is to turn existing blocks into real flashcards.',
    'create_card validates non-built-in deck IDs against get_decks, then calls SiYuan\'s riff add-card operation, which writes "custom-riff-decks" and registers the riff card transactionally.',
    'create_card(mode="attach") is retained for compatibility; SiYuan still writes the deck binding during the riff add-card operation. remove_card removes existing content block IDs such as paragraphs or headings from a deck; document blocks are rejected for creation.',
    'flashcard(action="remove_card") requires explicit user confirmation before execution.',
];

export const MASCOT_GUIDANCE: string[] = [
    'mascot actions operate on the cat’s spendable balance.',
    'Every successful MCP tool call earns 1 coin for the cat, so the fastest way to earn balance is simply to keep using SiYuan MCP tools.',
    'Use mascot(action="shop") to list available items and their stable item IDs.',
    'Use mascot(action="buy", item_id=...) to purchase an item and spend from the balance.',
];

export const FS_ACTION_HINTS: Partial<Record<FsAction, string>> = {
    ls: 'Use a human-readable path. "/" lists readable notebook roots; /Notebook or /Notebook/Folder lists direct child documents.',
    tree: 'Use a human-readable path. maxDepth defaults to 3 and keeps output compact.',
    read: 'Use a human-readable document path. Returns Markdown content only, with pagination for long documents.',
    write: 'Creates a missing document. Existing documents are protected unless overwrite=true; overwrite replaces the body while preserving the document node and title.',
    replace: 'Edits one existing document by exact old/new string matching. edit accepts one object or an array for sequential replacements. replace_all=true replaces every exact match of that old snippet.',
    rm: 'Deletes a document by human-readable path. This action requires explicit user confirmation.',
    mv: 'Moves or renames a document using human-readable paths. This action requires explicit user confirmation.',
    search: 'Searches Markdown lines under a human-readable document or folder path. Use regex=true for regular expressions.',
};

export const NOTEBOOK_ACTION_HINTS: Partial<Record<NotebookAction, string>> = {
    remove: 'This action requires explicit user confirmation.',
    set_icon: 'Use a notebook ID + icon. Prefer a Unicode hex code string such as "1f4d4" for 📔; raw emoji characters may not render correctly.',
    get_permissions: 'Omit notebook or pass notebook="all" to return all notebook permissions. Pass a specific notebook ID to return one notebook only.',
    get_child_docs: 'Use a notebook ID. Returns direct child documents at the notebook root, retries short initialization windows, and distinguishes notebook-not-found / closed-or-initializing failures.',
};

export const DOCUMENT_ACTION_HINTS: Partial<Record<DocumentAction, string>> = {
    create: 'Use notebook plus path for the most reliable child-document creation flow. parentPath + title is supported, but SiYuan may return a non-ID raw value, so MCP resolves the real document ID by hpath after creation. markdown is optional and defaults to empty.',
    lookup: 'Look up one reference at a time. Use id, notebook + storage path, or notebook + hpath/hPath. The path field means storage path like /20240318112233-abc123.sy; use hpath for human-readable paths.',
    rename: 'Use either id + title or notebook + path + title.',
    remove: 'Use either id or notebook + storage path. This action requires explicit user confirmation. If bulk ids/paths hit SiYuan\'s short indexing window, retry by deleting one document at a time with notebook + storage path.',
    move: 'Use either fromIDs + toID or fromPaths + toNotebook + toPath. For path-based moves, toPath must be the storage path of an existing destination document. This action requires explicit user confirmation.',
    get_child_blocks: 'Use a document ID. Returns direct child blocks only.',
    get_child_docs: 'Use a document ID. Returns direct child documents only.',
    set_attr: 'Use id + attrs. attrs.icon sets the document icon; attrs.cover sets an http(s) URL or /assets/... cover, and null/empty clears it.',
    list_tree: 'Use notebook + path, where path is a storage path such as / or /20240318112233-abc123.sy.',
    search_docs: 'Use notebook + query, and optionally path as a storage-path scope. Search is title-based in SiYuan; MCP then filters by notebook permission and optional storage path.',
    get_doc: 'Use a document ID. mode="markdown" returns clean Markdown content and supports page/pageSize for long documents; mode="html" uses the current focus view. For structured reading, prefer get_child_blocks.',
    create_daily_note: 'Use a notebook ID and optionally pass app for downstream SiYuan event routing. When the user asks for a diary, journal entry, daily log, or today’s note in a notebook, prefer this action over manually creating a path and then appending content.',
};

export const BLOCK_ACTION_HINTS: Partial<Record<BlockAction, string>> = {
    insert: 'nextID inserts BEFORE that block; previousID inserts AFTER that block. Provide at least one of nextID, previousID, or parentID. Returns a slim success object with the created block ID. Use #tag# syntax in markdown when you want SiYuan to register a real tag.',
    prepend: 'parentID can be either a document ID or block ID; behavior differs. Returns a slim success object with the created block ID. Use #tag# syntax in markdown when you want SiYuan to register a real tag.',
    append: 'parentID can be either a document ID or block ID; behavior differs. Returns a slim success object with the created block ID. Prefer append when you need to add multi-line markdown, tables, or multiple new blocks. Use #tag# syntax in markdown when you want SiYuan to register a real tag.',
    update: 'Use dataType + data + id to replace block content. Returns a slim success object instead of raw DOM operations. block(action="update") is best for single-block replacement; multi-line markdown may be truncated to the first line by SiYuan, so use append/prepend/insert when you need multiple blocks or tables. If the content should create tags, write them as #tag#.',
    replace: 'Use id + edit to replace exact text inside one block kramdown. edit accepts one object or an array for sequential replacements. replace_all=true replaces every exact match of that old snippet.',
    set_attrs: 'Use attrs to write block attributes such as custom metadata. For flashcards, this only writes metadata such as {"custom-riff-decks":"<deck-id>"}; prefer flashcard(action="create_card") when you want a block to become a real review card.',
    delete: 'This action requires explicit user confirmation.',
    move: 'Provide id plus previousID, parentID, or both to describe the destination. On success, MCP returns a structured success object instead of SiYuan\'s raw null. This action requires explicit user confirmation.',
    set_fold_state: 'Use a foldable block ID + folded (true to fold, false to unfold).',
    get_children: 'Accepts both document IDs and block IDs. Returns direct child blocks. Use page/pageSize to paginate when there are many children.',
    info: 'Returns root document positioning metadata for a block.',
    breadcrumb: 'Optional excludeTypes removes matching block types from the breadcrumb.',
    dom: 'Returns rendered DOM, useful for preview-style consumers.',
    recent_updated: 'Returns recent updates across the workspace, then MCP filters unreadable notebooks and applies count when provided. documents is the primary user-facing summary; items remains the raw block stream.',
    word_count: 'Provide one or more block IDs to receive aggregate stat data.',
    add_to_daily_note: 'Use notebook + dataType + data + position ("append" or "prepend") to add content to today’s daily note.',
};

export const AV_ACTION_HINTS: Partial<Record<AvAction, string>> = {
    get: 'Use an attribute view ID. Returns the full AV payload after permission checks. blockID is optional and only needed for an exact database-block context or fallback permission resolution.',
    render: 'Use id (the AV ID; this action does not accept avID) plus optional blockID/viewID/page/pageSize/query to render database rows with the active view context. With createIfNotExist=true, blockID becomes the creation target; if id is omitted, MCP generates one and materializes the database block automatically via a SiYuan-style transaction.',
    get_attribute_view_keys: 'Use id to return database keys/columns for a block-bound attribute view.',
    get_attribute_view_filter_sort: 'Use id + blockID to return the filters and sorts applied to that database block view.',
    search: 'Searches AV/database definitions by keyword and post-filters unreadable results. Unresolvable matches remain discoverable in unresolvedResults, alongside raw result counts and filtering reasons. Match scope primarily covers AV names plus primary-key fallback results, not arbitrary cell text.',
    add_rows: 'Use avID + blockIDs to add existing blocks as bound rows, or avID + primaryKeyTexts to add detached rows whose primary key is plain text. Optional blockID/viewID/groupID/previousID refine the insertion target and preserve the intended database-block view/group defaults. MCP polls briefly after insertion and only reports success when each new row resolves to a writable rowID. To add initial non-primary-key cell values, follow add_rows with av(action="set_cells", avID, cells=[{rowID, columnID, valueType, ...}, ...]); reuse the rowID returned by add_rows.',
    remove_rows: 'Use avID + srcIDs to remove rows from the AV. Optional blockID pins a specific registered database block when you need explicit block-view context.',
    add_column: 'Use avID + keyName + keyType, and optionally keyID or blockID. MCP generates keyID automatically when omitted. Supported keyType values match the 16 SiYuan addable column types, including keyType="mSelect", keyType="mAsset", and keyType="lineNumber". Optional blockID must be a registered database block for this AV if you need to pin a specific block view.',
    remove_column: 'Use avID + keyID, and optionally blockID to target a specific registered database block. removeRelationDest only matters for relation columns.',
    set_cells: 'Use avID + cells[]. Each item requires rowID + columnID + valueType and its matching typed field. For a single-cell write, pass rowID + columnID + valueType directly. rowID must be the AV row item ID stored in value.blockID, not value.id or the bound source block ID. Optional blockID must be a registered database block for this AV if you need to pin a specific block view. valueType="mAsset" accepts assets[].',
    duplicate: 'Matches SiYuan copy-as-mirror behavior: call the kernel duplicate API, spin the AV block DOM, then commit an insert transaction. previousID overrides the insertion target; otherwise MCP uses blockID or the resolved owning database block.',
    get_primary_key_values: 'Returns the AV name plus primary-key rows, with optional keyword/page/pageSize filtering.',
};

export const FILE_ACTION_HINTS: Partial<Record<FileAction, string>> = {
    upload_asset: 'Use assetsDirPath + localFilePath to read a local file and upload it into SiYuan assets. This action reads the local filesystem and requires explicit user confirmation. Files larger than the configured large-upload threshold (10 MB by default) must be stopped, confirmed by the user, and retried with confirmLargeFile=true.',
    render: 'Use engine="template" with id + path for a workspace template; that engine uses .action{...} delimiters and exposes limited document fields such as id/title/name/alias. Use engine="sprig" with inline template for {{...}} syntax; Sprig has functions but no document context.',
    export_resources: 'Provide one or more existing resource paths. Asset paths like assets/foo.txt are normalized to /data/assets/foo.txt before export. Set outputPath to also copy the exported ZIP to a local filesystem path. Using outputPath is high-risk and requires explicit user confirmation. To extract attachments for direct reading without a ZIP archive, prefer extract_doc which produces an uncompressed folder.',
    get_doc_assets: 'Use a document ID to list assets directly referenced by the current document tree after read-permission checks. This does not expand query embed blocks; when the user needs to inspect the full document content and assets, guide them to file(action="extract_doc") instead. Use assetType="image" to return only direct image assets.',
    get_image_ocr_text: 'Use an asset path to read stored OCR text. If path is omitted, SiYuan returns an empty text payload.',
    extract_doc: 'Use a document ID + optional outputDir. Exports the document markdown and all referenced assets into an uncompressed folder, preserving original filenames. Clears the entire output root directory first to prevent accumulation from previous exports. The returned extractedDir is an absolute path ready for direct file access.',
};

export const SEARCH_GUIDANCE: string[] = [
    'All search actions are read-only except find_replace, which modifies content and requires explicit user confirmation.',
    'search(action="query_sql") only accepts SELECT statements; mutation queries will be rejected, and returned rows are filtered by notebook permission.',
    'When calling query_sql, always add LIMIT yourself. MCP may still truncate large result sets and will tell you when to refine the query.',
    'The blocks table columns include: id, parent_id, root_id, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated.',
    'In SQL results, blocks.type uses SiYuan short codes such as d=document, h=heading, p=paragraph, l=list, i=list-item, b=blockquote, c=code, m=math, t=table, html=html, video=video, audio=audio, widget=widget.',
    'Use search(action="fulltext") for natural language searches; use search(action="query_sql") for structured queries.',
    'search(action="fulltext") types field auto-expands shortcodes: {"h": true, "p": true} is equivalent to {"heading": true, "paragraph": true}. Shortcodes: d/h/p/l/i/b/c/m/t/s/html/embed/av. Prefer semantic aliases such as methodName/sortBy over numeric method/orderBy.',
    'search(action="fulltext") supports parentId to scope results within a document subtree, and hasTags to filter by tag presence.',
    'Right after creating or editing content, full-text and tag search can lag behind writes because SiYuan indexing is eventually consistent; brief retries are expected in live tests.',
];

export const SEARCH_ACTION_HINTS: Partial<Record<SearchAction, string>> = {
    fulltext: 'Pass a query string. Supports keyword, query syntax, SQL, and regex modes via methodName (preferred) or method. fulltext now returns plainContent/excerpt by default. types accepts shortcodes directly: {"h": true, "c": true} auto-expands to {"heading": true, "codeBlock": true}. Use sortBy="relevance" or "date" instead of numeric orderBy. Use parentId to scope within a document, hasTags to filter tagged blocks.',
    query_sql: 'Execute a SELECT statement. Common tables: blocks, spans, assets. Prefer sql over stmt when prompting an AI. Always use LIMIT to control result size. MCP returns data plus truncation and permission-filtering metadata when applicable.',
    get_backlinks: 'Returns documents/blocks that contain references and/or text mentions for the given block ID. Use mode="links" | "mentions" | "both". Partial permission-filtered results include machine-readable metadata.',
    search_refs: 'Returns block-level reference contexts for the target id. Use this when you need the surrounding block content, not just the document-level backlink list. beforeLen controls how much leading context is included in each hit.',
    find_replace: 'This is the mutating exception inside the search tool. It performs content replacement after write-permission checks and still requires explicit user confirmation.',
    search_assets: 'Searches asset filenames. Prefer query over k when prompting an AI. If you need OCR or indexed inner-text matches, use fulltext_asset_content instead.',
    fulltext_asset_content: 'Searches indexed asset/OCR text. Prefer methodName and sortBy over numeric method/orderBy. Provide assetId for an exact asset-content lookup.',
};

export const TAG_ACTION_HINTS: Partial<Record<TagAction, string>> = {
    list: 'Optional keyword/query searches tags; sort, ignoreMaxListHint, and app are passed through to SiYuan for plain listing.',
    rename: 'Renames a workspace tag label everywhere it appears.',
    remove: 'Deletes a workspace tag label. This action requires explicit user confirmation.',
};

export const SYSTEM_ACTION_HINTS: Partial<Record<SystemAction, string>> = {
    workspace_info: 'Returns workspace path metadata and current SiYuan version. High-risk: leaks the absolute workspace path; disabled by default and requires explicit user confirmation.',
    network: 'Returns masked proxy information only.',
    conf: 'Defaults to a navigable summary. Use mode="get" with keyPath to read one config field or subtree at a time, e.g. conf.appearance.mode or conf.langs[0].',
    notify: 'Show an info or error notification in the SiYuan UI. Optional timeout is in milliseconds.',
    get_version: 'Returns the current SiYuan version as {version}.',
    get_current_time: 'Returns the current system time as {currentTime} epoch milliseconds and {iso} ISO 8601 text.',
};

export const FLASHCARD_ACTION_HINTS: Partial<Record<FlashcardAction, string>> = {
    list_cards: 'Use scope="all" | "deck" | "notebook" | "tree" plus filter="due" | "new" | "old". For scope="all", omit deckID; an empty string is treated as omitted. For scope="deck", pass a non-empty deckID. For scope="notebook", pass notebook. For scope="tree", pass rootID. reviewedCards is optional and follows SiYuan\'s review flow.',
    get_decks: 'Returns available flashcard decks so the caller can discover deckID values.',
    get_cards: 'Use deckID + optional page/pageSize to list all cards in a deck (regardless of due state). Use empty string deckID to query across all decks. Returns cards, total count, and pageCount.',
    review_card: 'Use deckID + cardID + rating, or pass skip=true to skip. reviewedCards is optional; each entry must include cardID because SiYuan only reads reviewedCards[].cardID.',
    create_card: 'Use deckID + blockIDs to turn existing blocks into flashcards. Non-built-in deck IDs must already exist. This calls SiYuan\'s addRiffCards flow, which writes custom-riff-decks and creates deck records together.',
    remove_card: 'Use deckID + blockIDs to remove existing blocks from a deck. This action requires explicit user confirmation.',
};

export const MASCOT_ACTION_HINTS: Partial<Record<MascotAction, string>> = {
    get_balance: 'Returns the cat’s current balance and lifetime earned count. Each successful MCP tool call adds 1 coin and increments the lifetime count.',
    shop: 'Returns the current mascot shop inventory including stable item IDs, labels, cost, type, and emoji.',
    buy: 'Buys one shop item by item_id and deducts its configured cost from balance.',
};

export const TOOL_GUIDANCE_BY_CATEGORY: Record<ToolCategory, string[]> = {
    fs: FS_GUIDANCE,
    notebook: NOTEBOOK_GUIDANCE,
    document: DOCUMENT_GUIDANCE,
    block: BLOCK_GUIDANCE,
    av: AV_GUIDANCE,
    file: FILE_GUIDANCE,
    search: SEARCH_GUIDANCE,
    tag: TAG_GUIDANCE,
    system: SYSTEM_GUIDANCE,
    flashcard: FLASHCARD_GUIDANCE,
    mascot: MASCOT_GUIDANCE,
};

export const TOOL_ACTION_HINTS: Record<ToolCategory, Partial<Record<string, string>>> = {
    fs: FS_ACTION_HINTS,
    notebook: NOTEBOOK_ACTION_HINTS,
    document: DOCUMENT_ACTION_HINTS,
    block: BLOCK_ACTION_HINTS,
    av: AV_ACTION_HINTS,
    file: FILE_ACTION_HINTS,
    search: SEARCH_ACTION_HINTS,
    tag: TAG_ACTION_HINTS,
    system: SYSTEM_ACTION_HINTS,
    flashcard: FLASHCARD_ACTION_HINTS,
    mascot: MASCOT_ACTION_HINTS,
};

export { ACTIONS_BY_CATEGORY } from './config';

export const TOOL_OVERVIEW_RESOURCE_URI = 'siyuan://help/tool-overview';
export const DOCUMENT_PATH_RESOURCE_URI = 'siyuan://help/document-path-semantics';
export const EXAMPLES_RESOURCE_URI = 'siyuan://help/examples';
export const AI_LAYOUT_GUIDE_RESOURCE_URI = 'siyuan://help/ai-layout-guide';
export const USER_RULES_RESOURCE_URI = 'siyuan://help/user-rules';
export const ACTION_RESOURCE_TEMPLATE_URI = 'siyuan://help/action/{tool}/{action}';

export function getActionHint(tool?: string, action?: string): string | undefined {
    if (!tool || !action) return undefined;
    if (!(tool in TOOL_ACTION_HINTS)) return undefined;
    return TOOL_ACTION_HINTS[tool as ToolCategory]?.[action];
}

export function isKnownToolCategory(tool: string): tool is ToolCategory {
    return tool in ACTIONS_BY_CATEGORY;
}

export function isKnownAction(tool: ToolCategory, action: string): boolean {
    return (ACTIONS_BY_CATEGORY[tool] as readonly string[]).includes(action);
}
