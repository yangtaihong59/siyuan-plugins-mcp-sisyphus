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
    type TimelineAction,
    type MascotAction,
    type FeedbackAction,
    type FsAction,
    type ToolCategory,
} from './config';
import { CHANGELOG_RESOURCE_URI } from './changelog';

export const FS_GUIDANCE: string[] = [
    'Use fs first for ordinary document file operations: list, tree, read, write, move, reorder, delete, and grep-like search.',
    'fs paths are human-readable workspace paths. Prefer /Notebook/Folder/Doc so resolution is unambiguous; a notebook-omitted path such as /Folder/Doc works only when it uniquely matches across readable notebooks. fs outputs canonical paths with the notebook name and hides notebook IDs, block IDs, and storage paths.',
    'fs is a pure Markdown convenience layer. If a document contains SiYuan-native structures such as database blocks, super blocks, embeds, media blocks, query embeds, widgets, HTML, or precise block-tree layout, inspect and modify those structures with advanced tools such as block, av, file, document, or search instead.',
    'fs.read returns an AI-editable Markdown view built from block kramdown, not /api/export/exportMdContent. It preserves SiYuan double-links as ((id \'title\')), preserves tags as #tag#, strips SiYuan zero-width tag markers, and hides block/list-item IAL metadata such as {: id="..." updated="..."} from normal list editing.',
    'fs.read tries full text by default, stopping at 256 KiB UTF-8 content or 2000 complete blocks. Reads are incremental; totalBlocks is null until EOF and outlineScope is window. Use blockStart/blockLimit/tokenBudget to continue long documents; code, math, tables, lists, quotes, and other container blocks are never split. A window may slightly exceed tokenBudget, and leading headings stay with the first body block. The response includes a window-scoped heading outline and nextWindow when more blocks remain.',
    'Copy old snippets for fs.replace from fs.read output. fs.replace uses the same AI-editable view for matching, so list items like "- item" can be replaced without including hidden IAL metadata. For inline styled text, use the plain text inside the style markers as old text: replace "hello" inside **hello** or `hello`, not "**hello**" or "`hello`"; DOM writeback preserves the existing inline style.',
    'Use document, block, search, or av for advanced SiYuan-specific operations such as block-level layout, metadata, database rows, SQL, backlinks, or assets.',
    'fs(action="write") creates missing documents. Do not include a leading # Title in markdown; the document title is rendered automatically. Existing documents are protected unless overwrite=true.',
    'For double-links in fs.write or fs.replace replacement text, use ((block-id \'anchor text\')) with a real block ID and human-readable anchor text. Naked ((id)) is resolved before writing; if anchor lookup fails, MCP falls back to ((id \'id\')) with a warning.',
    'For tags in fs.write or fs.replace replacement text, use #tag# or hierarchical tag syntax such as #parent/child#; verify global tag state with tag(action="list", query="tag").',
    'fs(action="replace") performs exact string replacement only inside non-complex Markdown blocks. If a document also contains complex SiYuan-native blocks, those blocks are skipped; replacements that only exist inside skipped blocks, or cross block boundaries, are rejected without writing.',
    'If fs.read reports attributeViews or avToolHint, the document contains real database blocks. Use av(action="get"|"query"|"set_cells"|"add_rows"|"remove_rows"|"add_column"|"remove_column") for AV rows, columns, and cells instead of editing the database placeholder as Markdown.',
    'fs(action="reorder") applies a complete manual order to every visible direct child under path and switches the notebook to custom sorting. Read fs.ls first and include each returned child path exactly once.',
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
    'Use document(action="query") for paginated document metadata, indexed body-block/character counts, empty-document candidates, and same-title candidates across readable open notebooks. It works with unreadable notebooks present and does not require permission changes. Counts describe the SQL index, not native word counts or complete filesystem coverage.',
    'For ordinary document file operations, prefer fs(action="ls"|"tree"|"read"|"write"|"search") because it accepts human-readable paths and hides storage paths and IDs.',
    'document(action="create") creates both non-empty and empty documents. Prefer path for child documents; path is a notebook-local human-readable hpath such as /Folder/Parent/New Child, not /Notebook/Folder/... and not a .sy storage path.',
    'Do not put # Title at the start of document(action="create") markdown. SiYuan renders the document title as H1 automatically, and MCP strips a matching leading H1 to avoid duplicate titles.',
    'document(action="create", parentPath=..., title=...) is also supported. parentPath accepts either a notebook-local human-readable parent hpath such as /Folder/Parent, or a storage path ending in .sy returned by document(action="lookup").',
    'fs(action="write", path="/Notebook/Folder/Doc") uses a workspace path and should include the notebook name for unambiguous resolution; omission works only for a unique existing document or parent. document(action="create", notebook=..., path="/Folder/Doc") uses a notebook-local hpath and must omit the notebook name. Do not mix these two path formats.',
    'For document(action="lookup"), path means a storage path such as /20240318112233-abc123.sy; use hpath/hPath for human-readable paths, which are notebook-local and MUST NOT include the notebook name (e.g., /Folder/Weekly Note, not /NotebookName/Folder/Weekly Note).',
    'Other document actions that use notebook + path expect storage paths returned by document(action="lookup").',
    'If document(action="create") reports a duplicate-name error, verify the intended child with document(action="lookup", notebook=..., hpath="/Folder/Parent/New Child", include=["id","path","hpath"]) or document(action="get_child_docs", id=<parent-doc-id>). New create results may take a short indexing delay before lookup/search sees them.',
    'document(action="ensure_link_targets") is the bounded import-link provisioner: scope it with notebook + parentId, reuse only explicit child document IDs, and use create only for explicit new titles. It never guesses an existing target from a title; same-title children are unresolved and require an ID decision.',
    'A safe path-based workflow is lookup -> rename/remove/move.',
    'document(action="reorder") applies a complete manual order to every visible direct child under parentID and switches the notebook to custom sorting. Read the current child documents first and include each child ID exactly once.',
    'document(action="get_child_blocks") and document(action="get_child_docs") return direct children for a document ID.',
    'document(action="set_attr") updates document metadata such as icon and cover; use attrs.cover=null or an empty string to clear the cover.',
    'document(action="search_docs") remains title-based, but MCP now post-filters results by notebook permission and optional storage path scope.',
    'For recently created documents, document(action="lookup", hpath=...) may briefly lag behind create because it depends on SiYuan indexing; retry if needed.',
    'document(action="lookup", id=...) may hit the same short indexing delay right after create; MCP retries briefly and then returns a timing-specific hint if indexing still has not settled.',
];

export const BLOCK_GUIDANCE: string[] = [
    'block(action="prepend") or block(action="append") with a document ID targets the document start or end.',
    'block(action="update") is best for single-block replacement. One table, fenced code block, or list may contain many lines and still be one block. Use append/prepend/insert for multiple sibling blocks; verify the resulting structure after replacement.',
    'block(action="replace") only searches the kramdown of the single block identified by id. It does not traverse child blocks, sibling blocks, headings with their following content, or the whole document.',
    'Before block(action="replace"), call block(action="get_kramdown", id=...) and copy an exact old snippet from that result. It writes back through the original DOM text nodes; naked ((id)) references, footnotes, and siyuan://blocks links are allowed with backlink-semantics hints.',
    'block(action="prepend") or block(action="append") with a block ID targets that block\'s child list.',
    'To create real SiYuan tags inside markdown content, use the syntax #tag# with both leading and trailing # characters, then verify with tag(action="list", query="tag").',
    'To turn a block into a flashcard, prefer flashcard(action="create_card"). It writes "custom-riff-decks" and registers the riff card together.',
    'block(action="set_fold_state") requires a foldable block ID, not a document ID.',
    'block(action="recent_updated") is read-only; MCP filters unreadable notebooks first and then applies count.',
    'block(action="recent_updated") now presents the document-grouped summary as the primary user-facing view while keeping the raw block stream for advanced consumers.',
];

export const AV_GUIDANCE: string[] = [
    'Find databases with search, inspect structure with get, query paginated records with query, then add_rows or set_cells. A database is not a Markdown table.',
    'get defaults to structure: identity, columns and view summaries, never all row IDs. scope=columns reads keys; scope=view reads exact view configuration; scope=raw preserves the complete native AV.',
    'query returns canonical rowID and columnID. Never substitute sourceBlockID or cell value IDs. fields projects requested stable columnIDs while always keeping rowID. mode=primary_keys returns lightweight paginated primary keys; keyword applies to either mode.',
    'Explicit viewID selects only the read target; it never switches the database carrier. Returned viewID and selectionSource identify the actual selection; selectionFallback reports kernel-default fallback.',
    'create requires parentID, and optionally a new avID. First preflight to obtain requestId. IDs and progress are persisted before creation. Partial or unknown outcomes require inspection, never automatic recreation.',
    'update_view requires avID, the carrier blockID (databaseContext.carrierBlockIDs from get; auto-filled when there is exactly one) and its currently selected viewID. Omitted settings stay unchanged. filters/sorts/group/columnOrder replace complete settings; columnVisibility patches only named columns.',
    'filters:[] and sorts:[] clear settings; group:{field:""} clears grouping. columnOrder includes every current view field, including hidden fields. Duplicate IDs, null and unknown settings are rejected.',
    'Filter leaves use column/operator/value and omit combination/filters. Group nodes use only combination and filters; never mix group and leaf fields in one node.',
    'update_view sends one transaction after complete validation, then verifies every requested setting and protected configuration. This is not a guarantee of kernel atomicity. Unchanged requests return no_change without a transaction.',
    'Relation values use set_relation, not set_cells; two-way relations may write another database. create_from_template can create a document and stays separate from add_rows.',
    'Follow enabled nextSteps using real returned IDs. Completed pages never suggest another page. Writes always require user intent and the applicable strict preflight.',
];

export const FILE_GUIDANCE: string[] = [
    'file(action="upload_asset") reads a local file path and uploads that file into SiYuan assets. Because it reads the local filesystem, it requires explicit user confirmation before execution.',
    'For upload_asset: if the file is larger than the configured large-upload threshold (10 MB by default), MCP must stop and ask the user for explicit confirmation before retrying with confirmLargeFile=true.',
    'file(action="export_resources") exports the given paths as a ZIP archive, normalizes common asset path formats, and can optionally save the ZIP to a local filesystem path.',
    'file(action="export_resources", outputPath=...) writes to the local filesystem and requires explicit user confirmation before execution.',
    'Use file(action="list_templates") before rendering when you need to discover valid workspace template paths under data/templates.',
    'file(action="read_template") reads Markdown template source through SiYuan’s authenticated /templates/ route; it does not expose arbitrary workspace files.',
    'file(action="create_template"|"update_template") writes Markdown templates through SiYuan’s /api/file/putFile workspace API; it does not write data/templates through the local filesystem.',
    'file(action="delete_template") removes an existing Markdown template resolved from SiYuan’s template picker and requires explicit user confirmation before execution.',
    'file(action="save_doc_as_template") saves an existing document as a root-level template after read-permission checks; use create_template when you need a nested template path.',
    'file(action="render", engine="template") requires a template path inside the SiYuan workspace; arbitrary local paths like /tmp/... are rejected by the kernel.',
    'file(action="render", engine="template") uses SiYuan workspace template syntax .action{.title}, .action{.id}, .action{.name}, and .action{.alias}; it does not replace {{...}} placeholders.',
    'file(action="render", engine="sprig") uses inline Go/Sprig template syntax such as {{ now | date "2006-01-02" }}, but it has no document context.',
    'file(action="extract_doc") exports a document and all its assets into a self-contained uncompressed folder, so AI tools can read the files directly. Prefer this over export_resources when the goal is to inspect attachment content such as images, spreadsheets, or other binary files.',
    'file(action="audit_image_refs") compares caller-supplied expected image references with SiYuan\'s read-only direct image asset list. It uses multiset basename matching: every occurrence is preserved and matched once, including duplicate refs and different paths with the same basename. It ignores SiYuan timestamp/id filename suffixes, never reads local .sy files, and never repairs content.',
    'When Markdown contains an assets/... image and the task depends on its visual content, a vision-capable client should call file(action="read_image") for that one relevant image. Provide its path plus exactly one authorized document id or human-readable documentPath. Do not inline every document image automatically.',
    'file(action="get_image_ocr_text") reads OCR text already stored by SiYuan; it does not run OCR or cause SiYuan to generate OCR. Prefer read_image for direct visual understanding, and use stored OCR as a fallback for clients without vision support.',
];

export const TAG_GUIDANCE: string[] = [
    'Tag actions operate across the whole workspace rather than a single notebook.',
    'There is no direct create action for tags; tags are created by writing #tag# into block markdown content.',
    'tag(action="remove") requires explicit user confirmation before execution.',
    'Recently written tags may appear with a short indexing delay in tag list/search results; retry briefly before treating that as a failure.',
];

export const TIMELINE_GUIDANCE: string[] = [
    'timeline manages named document and global snapshot nodes, compares one document against a node, and can restore historical content.',
    'compare_node creates an untagged current-state workspace snapshot before calculating the document diff; use its opaque changeKey for rollback_block.',
    'delete_node removes only the protective tag and retains the underlying snapshot. delete_node, rollback_document, and rollback_block require explicit user confirmation.',
    'Document reads and comparisons respect notebook read permission; document node creation requires write permission; all document node deletion and rollback actions require rwd.',
];

export const SYSTEM_GUIDANCE: string[] = [
    'Most system actions in this tool are read-only; perform_sync is the mutating exception and requires explicit user confirmation before execution.',
    'system(action="workspace_info") exposes the workspace path and is high-risk; it is disabled by default.',
    'system(action="perform_sync") triggers SiYuan sync immediately; it does not modify sync provider settings.',
    'system(action="conf") returns masked configuration, not raw secrets.',
    'Use system(action="changelog", fromVersion="<previousVersion>") after plugin upgrades to see whether old personalized settings, rules, memory, or connection snippets need review.',
    'Use system(action="conf", mode="summary") first, then mode="get" + keyPath such as conf.appearance.mode or conf.langs[0].',
];

export const FLASHCARD_GUIDANCE: string[] = [
    'flashcard actions cover review-first flashcard workflows and deck discovery.',
    'list_cards always reads from the kernel due-card endpoints and MCP post-filters cards by state for filter="new" or filter="old"; pass reviewedCards to match SiYuan\'s in-review filtering.',
    'get_cards returns all cards in a deck (not just due ones), with pagination. Use it to browse or audit deck contents.',
    'Prefer flashcard(action="create_card", deckID, blockIDs) when the goal is to turn existing blocks into real flashcards.',
    'create_card validates non-built-in deck IDs against get_decks, then calls SiYuan\'s riff add-card operation, which writes "custom-riff-decks" and registers the riff card transactionally.',
    'Create or locate the intended content block IDs first, then pass those IDs to create_card. Document block IDs are rejected; use content blocks such as headings or paragraphs.',
    'create_card(mode="attach") is retained for compatibility; SiYuan still writes the deck binding during the riff add-card operation. remove_card removes existing content block IDs such as paragraphs or headings from a deck; document blocks are rejected for creation.',
    'review_card requires a concrete deckID and cardID. Use list_cards or get_cards to resolve them; an empty deckID is not valid for review.',
    'Flashcard removal only removes riff card bindings from a deck. It does not delete the underlying note blocks; deleting note blocks is a separate block/document delete workflow.',
    'flashcard(action="remove_card") requires explicit user confirmation before execution.',
];

export const EXTENSION_GUIDANCE: string[] = [
    'extension bridges tools from the official SiYuan /mcp endpoint and requires SiYuan 3.7.0 or newer.',
    'Plugin tools are exposed by default. Native SiYuan tools are exposed only when extension.includeNativeTools is enabled; external source="mcp" tools remain excluded.',
    'Use extension(action="list", refresh=true) to refresh discovery. While includeNativeTools is disabled, the response contains counts only; enable it to inspect tool names, sources, schemas, read-only declarations, and blocked state.',
    'Use extension(action="validate_package") only with explicit metadata and relative package-file text. It never accepts a host path, scans a directory, installs/enables/trusts a package, or proves runtime loading.',
    'Use extension(action="diagnose_plugin_mcp") after a separately authorized lifecycle operation to refresh and read back Source="plugin" registry entries. It does not trigger reload/disable or invoke a plugin tool; registry absence does not prove cleanup completed.',
    'Call a discovered tool with extension(action="<official tool name>", arguments={...}). Downstream parameters must stay inside arguments, including a downstream action field.',
    'Tools without readOnlyHint=true may mutate data or trigger side effects and require explicit user confirmation before calling.',
    'Forwarded official MCP tool calls are never retried. A transport error after dispatch means execution status is unknown and must be checked before retrying.',
    'Native tools can overlap with Sisyphus actions and substantially increase schema size, so includeNativeTools is disabled by default.',
];

export const MASCOT_GUIDANCE: string[] = [
    'mascot actions operate on the cat’s spendable balance.',
    'Every successful MCP tool call earns 1 coin for the cat, so the fastest way to earn balance is simply to keep using SiYuan MCP tools.',
    'Use mascot(action="shop") to list available items and their stable item IDs.',
    'Use mascot(action="buy", item_id=...) to purchase an item and spend from the balance.',
];

export const FEEDBACK_GUIDANCE: string[] = [
    'feedback submits plain-text product feedback to the developer through the configured WPS form channel.',
    'After user authorization, submit without validateOnly, requestId or hash credentials, even in strict mode. External feedback has no strict state preflight or replay guarantee; do not automatically retry an uncertain submission.',
    'Use feedback(action="submit") when the user asks you to pass along feedback, or when an AI client needs to report MCP tool friction after explaining what will be sent.',
    'Prefer GitHub Issue-style feedback for bugs, confusing names/parameters/help/errors, or rough workflows encountered during an AI session.',
    'Put the full issue-style body in description with these headings when useful: ## Summary, ## What happened, ## Expected behavior, ## Steps or context, ## Impact, ## Suggested fix.',
    'Use impact for a one- or two-sentence impact summary, and suggestion for the most direct improvement idea without repeating the full description.',
    'Do not include secrets, private note content, API tokens, or sensitive document paths in feedback.',
];

export const FS_ACTION_HINTS: Partial<Record<FsAction, string>> = {
    ls: 'Use a human-readable path. "/" lists readable notebook roots; /Notebook or /Notebook/Folder lists direct child documents.',
    tree: 'Use a human-readable path. maxDepth defaults to 3 and keeps output compact.',
    read: 'Use a human-readable document path. Tries full AI-editable Markdown by default, bounded to 256 KiB UTF-8 and 2000 complete blocks; totalBlocks is null until EOF. Continue with nextWindow or blockStart/blockLimit/tokenBudget; page/pageSize character pagination was removed. The response includes a window-scoped heading outline, and includeBlockIds=true adds a sidecar blockRefs mapping without polluting content. When complex SiYuan blocks are detected, use block.dom, file.export_md, av, or other advanced tools for inspection and editing.',
    write: 'Creates a missing document. Do not include a leading # Title in markdown; the document title is automatic. Existing pure Markdown documents are protected unless overwrite=true; overwrite refuses documents containing complex SiYuan-native blocks. Use ((id \'title\')) for double-links and #tag# for tags; use advanced tools for database rows, cells, super blocks, embeds, widgets, HTML, and media.',
    replace: 'Edits matched non-complex Markdown blocks by exact old/new matching against the same AI-editable view returned by fs.read. Canonical input is edit={old,new}; shorthand old + new is also accepted. If the document contains complex SiYuan-native blocks, fs.replace skips those blocks and returns skippedComplexBlocks; matches only inside skipped blocks or across block boundaries are rejected without writing. For inline formatting, old should be plain text without Markdown style delimiters such as **, *, `, or ~~; existing DOM inline styles are preserved. Naked ((id)) refs are normalized, and footnotes/siyuan://blocks links are allowed but do not create backlinks. replace_all=true replaces every exact match across editable blocks. Use ((id \'title\')) for new double-links and #tag# for tags.',
    rm: 'Deletes a document by human-readable path. This action requires explicit user confirmation.',
    mv: 'Moves or renames a document using human-readable paths. It is a delete-level operation: every notebook involved (source and destination, also for a rename within one notebook) needs rwd. This action requires explicit user confirmation.',
    reorder: 'Applies a complete manual order to all visible direct child documents under path. orderedPaths must contain every current child path exactly once; the notebook is switched to custom sorting.',
    search: 'Searches Markdown lines under a human-readable document or folder path. Use regex=true for regular expressions. YAML front matter is not searched; line is 1-based within the body (title heading excluded) and a title hit is reported once with line 0.',
};

export const NOTEBOOK_ACTION_HINTS: Partial<Record<NotebookAction, string>> = {
    remove: 'This action requires explicit user confirmation.',
    set_icon: 'Use a notebook ID + icon. Prefer a Unicode hex code string such as "1f4d4" for 📔; raw emoji characters may not render correctly.',
    get_permissions: 'Omit notebook or pass notebook="all" to return all notebook permissions. Pass a specific notebook ID to return one notebook only.',
    get_child_docs: 'Use a notebook ID. Returns direct child documents at the notebook root, retries short initialization windows, and distinguishes notebook-not-found / closed-or-initializing failures.',
};

export const DOCUMENT_ACTION_HINTS: Partial<Record<DocumentAction, string>> = {
    query: 'Omit notebooks for all readable open notebooks, or pass notebook IDs. Explicit unreadable, unknown, or closed notebooks are rejected. fields selects metadata/stat columns; default all. title is a literal substring and hpathPrefix matches an exact notebook-local human path or descendants. Use maxBlocks=0 for no indexed body blocks, duplicatesOnly=true for same-title candidates. minBlocks/maxBlocks/minChars/maxChars are inclusive. page starts at 1; pageSize defaults to 50 (max 100). blockCount counts non-document indexed rows including containers; contentChars sums SQLite length(content), not bytes/native word count. sameTitleCount is scoped before metric filters. Read scope/excludedClosedNotebooks and index limitations; follow nextSteps for further pages. SQL fragments are not accepted.',
    create: 'Use a notebook ID from notebook.list, never its name. Use notebook + path for the most direct child-document flow. path is a notebook-local hpath like /Folder/Parent/New Child, not /Notebook/... and not .sy. parentPath + title is also supported. markdown is optional and must not start with # Title; a matching leading H1 is stripped to avoid duplicate titles.',
    lookup: 'Look up one reference at a time. Use id, notebook + path (storage path), or notebook + hpath/hPath. The path field means storage path like /20240318112233-abc123.sy; use hpath for human-readable paths. include accepts only id, ids, path, hpath and docInfo; there is no title field: the title is the last hPath segment, or docInfo.name.',
    ensure_link_targets: 'Scope every request with an explicit notebook ID and parent document ID. resolve/reuse require existing child document IDs and never fall back to titles. create accepts explicit new titles only; if a same-title child already exists, it is returned as unresolved rather than guessed or reused. dryRun performs zero writes only for create. resolve/reuse are read-only; create uses strict validateOnly preflight, then one commit with the server-issued requestId plus expectedStructureHash. Responses contain exact ID/path/HPath readback and resolved/created/reused/unresolved accounting.',
    rename: 'Single mode uses either id + title or notebook + path + title. Batch mode uses items:[{id,title}] (maximum 50 items and 256 KiB serialized input) with one preflight and one ordered receipt; parent-child batches and target collisions are rejected. Only proven not_started items may be submitted as a new preflight after a partial failure.',
    remove: 'Use either id, or notebook + path (the storage path from lookup). This action requires explicit user confirmation. If bulk ids/paths hit SiYuan\'s short indexing window, retry by deleting one document at a time with notebook + path.',
    move: 'Use either fromIDs + toID or fromPaths + toNotebook + toPath. For path-based moves, toPath must be the storage path of an existing destination document. Permissions: it is a delete-level operation, so every notebook involved (source and destination) needs rwd; check with notebook(action="list"). This action requires explicit user confirmation.',
    reorder: 'Use parentID + orderedIDs. parentID may be a notebook ID or parent document ID, and orderedIDs must contain every visible direct child document ID exactly once. The notebook is switched to custom sorting.',
    get_child_blocks: 'Use a document ID. Returns direct child blocks only.',
    get_child_docs: 'Use a document ID. Returns direct child documents only.',
    set_attr: 'Use id + attrs. attrs.icon sets the document icon; attrs.cover sets an http(s) URL or /assets/... cover, and null/empty clears it.',
    list_tree: 'Use notebook + path, where path is a storage path such as / or /20240318112233-abc123.sy.',
    search_docs: 'Use notebook + query, and optionally path as a storage-path scope. Search is title-based in SiYuan; MCP then filters by notebook permission and optional storage path.',
    get_doc: 'Use a document ID. mode="markdown" tries full clean Markdown by default, bounded to 256 KiB UTF-8 and 2000 complete blocks, with a window-scoped outline and nextWindow; totalBlocks is null until EOF; use blockStart/blockLimit/tokenBudget and optionally includeBlockIds. page/pageSize character pagination was removed. mode="html" uses the current focus view.',
    get_outline: 'Use a document ID to return SiYuan’s native heading tree without reading the document body. preview defaults to false. The response includes heading block IDs, nesting, and headingCount.',
    heading_to_doc: 'Moves the heading AND everything under it (up to the next heading of the same or higher level) into a new document whose ID is the heading ID; the source document keeps the rest, which is nothing when the heading is its first H1. The new document lands at the target notebook root by default; to make it a child of the source document, pass targetPath = the source document storage path (path from document lookup, e.g. /2024...-abc.sy). The result returns the new document id, title, path, hPath and sourceID.',
    create_daily_note: 'Use a notebook ID and optionally pass app for downstream SiYuan event routing. When the user asks for a diary, journal entry, daily log, or today’s note in a notebook, prefer this action over manually creating a path and then appending content.',
};

export const BLOCK_ACTION_HINTS: Partial<Record<BlockAction, string>> = {
    insert: 'nextID inserts BEFORE that block; previousID inserts AFTER that block. Provide at least one of nextID, previousID, or parentID. Returns a slim success object with the created block ID. Use #tag# syntax in markdown when you want SiYuan to register a real tag.',
    prepend: 'parentID can be either a document ID or block ID; behavior differs. Returns a slim success object with the created block ID. Use #tag# syntax in markdown when you want SiYuan to register a real tag.',
    append: 'parentID can be either a document ID or block ID; behavior differs. Returns a slim success object with the created block ID. Prefer append when you need to add multi-line markdown, tables, or multiple new blocks. Use #tag# syntax in markdown when you want SiYuan to register a real tag.',
    update: 'Use dataType + data + id to replace block content. Returns a slim success object instead of raw DOM operations. block(action="update") is best for single-block replacement; one table or fenced code block can contain multiple lines. Use append/prepend/insert for multiple sibling blocks and verify the resulting structure. If the content should create tags, write them as #tag#.',
    replace: 'Use id + edit to replace exact text inside one block kramdown content only. First read block(action="get_kramdown", id=...) and copy old from the block body. The writeback patches original DOM text nodes, preserving inline structure while rejecting IAL metadata edits. Naked ((id)) refs are normalized; footnotes and siyuan://blocks links are allowed but do not create backlinks.',
    set_attrs: 'Use attrs to write block attributes such as custom metadata. For flashcards, this only writes metadata such as {"custom-riff-decks":"<deck-id>"}; prefer flashcard(action="create_card") when you want a block to become a real review card.',
    delete: 'This action requires explicit user confirmation.',
    move: 'Provide id or ids plus previousID, parentID, or both to describe the destination. When ids is provided, pass IDs in the desired final order; MCP calls SiYuan from last to first internally and returns apiCallOrder for debugging. This action requires explicit user confirmation.',
    set_fold_state: 'Use a foldable block ID + folded (true to fold, false to unfold).',
    batch_kramdown: 'Provide 1–20 block or document IDs. MCP resolves read permission per input item, fetches readable kramdown in one kernel request, preserves input order and duplicates, and returns per-item errors instead of failing the whole batch.',
    get_children: 'Accepts both document IDs and block IDs. Returns direct child blocks. Use page/pageSize to paginate when there are many children.',
    info: 'Returns root document positioning metadata for a block.',
    breadcrumb: 'Optional excludeTypes removes matching block types from the breadcrumb.',
    dom: 'Returns rendered DOM, useful for preview-style consumers.',
    recent_updated: 'Returns recent updates across the workspace, then MCP filters unreadable notebooks and applies count when provided. documents is the primary user-facing summary; items remains the raw block stream.',
    word_count: 'Provide one or more block IDs to receive aggregate stat data. blockCount is the number of IDs passed (a document ID counts as 1); the text counts cover all content under them. For the block total of a document use document query (blockCount). runeCount counts characters; wordCount counts words, where a run of CJK text may count differently from characters.',
    add_to_daily_note: 'Use notebook + dataType + data + position ("append" or "prepend") to add content to today’s daily note.',
};

export const AV_ACTION_HINTS: Partial<Record<AvAction, string>> = {
    search: 'Searches AV/database definitions by keyword and post-filters unreadable results. Unresolvable matches remain discoverable in unresolvedResults, alongside raw result counts and filtering reasons. Match scope primarily covers AV names plus primary-key fallback results, not arbitrary cell text.',
    add_rows: 'Rows without cells: use avID + blockIDs for bound rows, or avID + primaryKeyTexts for detached rows. Composite mode: use avID + rows:[{clientKey, primaryKeyText, cells:[{columnID, valueType, ...}]}], mutually exclusive with blockIDs/primaryKeyTexts. Composite rows are preflighted as one batch, receive stable rowIDs before any write, then write initial cells in a second native phase. MCP checkpoints reserved → rows_created → cells_written → verified. A failure after rows exist returns exact rowIDs and a stage; never re-run add_rows for those rows. Cells use the same typed fields as set_cells (e.g. {columnID,valueType:"number",number:9}); see av(action="help", topic="set_cells") for the full valueType table.',
    remove_rows: 'Use avID + rowIDs (canonical AV row item IDs) to remove rows after the server validates every identity against the current AV. srcIDs remains the explicitly native interface and is not an interchangeable alias; mixing rowIDs and srcIDs is rejected before any write. Optional blockID pins a specific registered database block when you need explicit block-view context.',
    add_column: 'Use avID + keyName + keyType, and optionally keyID or blockID. MCP generates keyID automatically when omitted. Supported keyType values match the 16 SiYuan addable column types, including keyType="mSelect", keyType="mAsset", and keyType="lineNumber". Optional blockID must be a registered database block for this AV if you need to pin a specific block view.',
    remove_column: 'Use avID + keyID, and optionally blockID to target a specific registered database block. removeRelationDest only matters for relation columns.',
    rename: 'Use avID + name to rename the database, and/or keyID + keyName to rename one column, including the primary key column that av(action="create") names by default. Types and values are unchanged. Get key IDs from av(action="get"). Strict write: preflight with validateOnly=true, then commit with the returned requestId and expectedStateHash.',
    set_cells: 'Use avID + cells[]. Each item requires rowID + columnID + valueType and its matching typed field. For a single-cell write, pass rowID + columnID + valueType directly. rowID must be the AV row item ID stored in value.blockID, not value.id or the bound source block ID. Optional blockID must be a registered database block for this AV if you need to pin a specific block view. valueType="mAsset" accepts assets[]. Relation values are intentionally rejected here; use set_relation so MCP can authorize the destination AV and read back the reverse cell. Cell fields by valueType: text→text:"…"; number→number:9; date→date:"2026-01-31" or epoch ms; checkbox→checked:true; select→option:"在读"; multi_select (column type mSelect)→options:["a","b"]; url/email/phone→url/email/phone:"…"; relation→relationBlockIDs:[…]; mAsset→assets:[{type,content}]. Example: {rowID,columnID,valueType:"select",option:"在读"}.',
    set_column_options: 'Dangerous: use avID + keyID + the complete options array for a select or mSelect key. This is a replacement, not a patch: omitted names are removed. First call the same action with validateOnly=true; after confirmation submit the returned expectedStateHash and the returned requestId. If new names are observed in SiYuan append order, MCP reports intermediate_option_order and requires a new preflight before any explicit reorder.',
    duplicate_rows: 'Dangerous: use avID + ordered sourceRowIDs for bound, persistent top-level row items only; each becomes a detached text record. First call validateOnly=true, then confirm and submit expectedManifestHash + requestId. MCP checks every resolved two-way-relation destination AV carrier for rw/rwd before dispatch and verifies source placement plus reverse links after a normal response. Never retry automatically after outcome_unknown.',
    duplicate: 'Matches SiYuan copy-as-mirror behavior: call the kernel duplicate API, spin the AV block DOM, then commit an insert transaction. previousID overrides the insertion target; otherwise MCP uses blockID or the resolved owning database block.',
    add_view: 'Provide avID, the carrier blockID (databaseContext.carrierBlockIDs from get; auto-filled when the AV has exactly one), a new stable viewID, layout (table, gallery or kanban) and name. First run validateOnly=true. layout=kanban needs an existing single-select column (mSelect does not count); preflight rejects it otherwise.',
    set_new_item_templates: 'Dangerous complete replacement of ordered native new-item templates. Pass every template and defaultTemplateID, not a patch. MCP captures a canonical complete-template preimage, validates each key and select/mSelect option against the raw AV, performs one native transaction, and verifies order, default, and all remaining template fields through getAttributeView. Missing options are rejected rather than added or silently pruned.',
    create_from_template: 'Dangerous native creation using an existing template. itemID in the result is the AV row identity; blockID is the separate bound block/document identity. MCP preflights all default fields and relation targets, then reads every requested default back. Document templates require an explicit saveLocation so the target notebook can be authorized; inherited global document location is intentionally not guessed.',
    configure_two_way_relation: 'Dangerous schema operation for an existing relation key. Pass source and destination AV identities plus a stable reverse-key ID. MCP verifies both writable database carriers, uses the native updateAttrViewColRelation transaction, and reads both directions back. It refuses to retarget an existing relation that would mutate an unpreflighted third AV.',
    configure_rollup: 'Dangerous schema operation for an existing rollup key. Pass its existing relation key, destination key, and the native RollupCalc object exactly as SiYuan defines it. MCP does not invent calculation aliases. SiYuan may remove filters that reference the reconfigured rollup key.',
    set_relation: 'Dangerous complete replacement of one relation cell. blockID is the verified source database carrier; itemID and relatedItemIDs are AV row item IDs, never bound document block IDs. An empty relatedItemIDs array clears the relation. MCP authorizes destination writes and verifies source plus two-way reverse cells without retrying an unknown response.',
    get: 'Use avID with scope=structure (default), columns, view, or raw. structure never contains row IDs or values. Optional blockID proves database context; viewID selects reading only. Use query for records.',
    query: 'Use avID, optional keyword/page/pageSize/fields, and mode=rows (default) or primary_keys. fields is a list of stable columnIDs: requested cells and columns are returned and rowID is always kept. Row mode supports viewID/blockID/groupPaging. Primary-key mode rejects viewID/groupPaging/fields and defaults to 16 rows. Follow nextSteps only when present.',
    create: 'Use parentID (an existing document or block) and optionally a new avID; preflight first. A new database starts unnamed with a primary key column (type block) and one select column; use rename to set the database and column names. The result lists that select column in defaultColumns with a ready removeDefaultColumn step (remove_column preflight); keep it if you want a kanban view. Same requestId replays saved IDs, stages and original result before checking existence. Unknown or partial creation must not be retried with another ID.',
    update_view: 'Use avID, the carrier blockID (auto-filled when the AV has exactly one) and the current viewID, plus at least one of filters, sorts:[{column,order}] with order ASC or DESC (any case), group, columnVisibility:[{columnID,hidden}], columnOrder:[columnID]. Arrays replace except visibility, which changes listed columns only. Empty visibility alone is rejected. Filter nodes must not mix group fields (combination/filters) with leaf fields (column/operator/value); groups contain only combination and filters. Preflight validates all configurations before one transaction; readback protects every unrequested property.',

};

export const FILE_ACTION_HINTS: Partial<Record<FileAction, string>> = {
    upload_asset: 'Pass exactly one of localFilePath (alias file) or uploadSource; assetsDirPath is optional and defaults to /assets/. MCP servers require an absolute localFilePath (relative paths are rejected because the server cannot know your working directory); the CLI resolves relative paths against your shell. CLI/Node automatically stage local bytes when the kernel coordinator is enabled (10 MiB maximum); direct kernel clients POST {fileName,dataBase64} to the authenticated /plugin/private/siyuan-plugins-mcp-sisyphus/transfer/upload endpoint and use the returned uploadSource within 10 minutes. The file alias is accepted for localFilePath, and omitted assetsDirPath uses /assets/. This action reads the local filesystem and requires explicit user confirmation. Files larger than the configured large-upload threshold (10 MB by default) must be stopped, confirmed by the user, and retried with confirmLargeFile=true.',
    export_md: 'Exports one document as Markdown; includeChildren=true appends every descendant document in tree order (max 100), listed in documents. Only the root keeps YAML front matter; each descendant follows a --- rule and starts with a <!-- siyuan-document id=... --> marker and its # title heading. Database blocks are exported as tables of their current view, so view filters and hidden columns apply. For larger trees or per-file output use export_markdown_snapshot with roots.',
    list_templates: 'Searches SiYuan data/templates via the kernel template picker endpoint. Empty query lists all visible Markdown templates. Results include readArgs and renderArgsTemplate for reuse.',
    read_template: 'Use a path from list_templates, /data/templates/..., /templates/..., or a path relative to data/templates. Reads only Markdown template source and supports offset/limit pagination.',
    create_template: 'Use path + markdown to create a Markdown template under data/templates. overwrite=false by default returns template_exists when the path already exists; pass overwrite=true to replace it.',
    update_template: 'Use path + markdown to replace an existing Markdown template. The template must resolve through list_templates first; otherwise MCP returns template_not_found.',
    delete_template: 'Deletes an existing Markdown template after resolving it through SiYuan’s template picker. This action is dangerous and disabled by default.',
    save_doc_as_template: 'Use id + name to save a document as a root-level template through SiYuan’s docSaveAsTemplate API. Slashes are rejected; pass overwrite=true to replace an existing root template. Side effects: SiYuan stores the template name on the source document (custom-sy-template-export-name), and the template keeps block IALs such as fold state and custom attributes. To create a document from a template, render it with file render (relative template paths work), then append the returned DOM via block append with dataType=dom; or read_template and pass the Markdown, minus its {: id=...} lines, to document create.',
    render: 'Use engine="template" with id + path for a workspace template; that engine uses .action{...} delimiters and exposes limited document fields such as id/title/name/alias. Set preview=true for SiYuan preview DOM. Use engine="sprig" with inline template for {{...}} syntax; Sprig has functions but no document context.',
    export_resources: 'Provide one or more existing resource paths. Asset paths like assets/foo.txt are normalized to /data/assets/foo.txt before export. Set outputPath to also copy the exported ZIP to a local filesystem path. With the kernel coordinator enabled, CLI/Node request delivery=download and save the ZIP locally without overwriting existing files; direct kernel clients can use the returned downloadPath through the authenticated getFile API. Using outputPath is high-risk and requires explicit user confirmation. To extract attachments for direct reading without a ZIP archive, prefer extract_doc which produces an uncompressed folder.',
    export_markdown_snapshot: 'Provide notebookID plus exactly one of roots or documentIDs. A document root (/<id>.sy storage path) exports that document and all its descendants; "/" exports the whole notebook. Returns one deterministic, paginated page of Markdown with metadata/content hashes, path conflicts, errors, and an opaque cursor. It never writes the host filesystem and does not create a background job.',
    get_doc_assets: 'Use a document ID to list assets directly referenced by the current document tree after read-permission checks. This does not expand query embed blocks; when the user needs to inspect the full document content and assets, guide them to file(action="extract_doc") instead. Use assetType="image" to return only direct image assets.',
    audit_image_refs: 'Use id + expectedRefs from source or preprocessed Markdown. The action reads only SiYuan\'s direct image asset references over HTTP and returns expectedRefs, actualRefs, missingRefs, extraRefs, counts, and ok. Matching is a multiset by basename: each occurrence is preserved and consumed once, so duplicates and same-basename paths are not silently merged. It ignores SiYuan timestamp/id suffixes; it does not read local files or repair imports.',
    read_image: 'Use path plus exactly one of id or documentPath. MCP first authorizes that document tree and verifies that the image is directly referenced there, then returns metadata followed by one standard MCP image content block. Only PNG, JPEG, WebP, and GIF up to 20 MiB are accepted. It never writes a host file or runs OCR.',
    get_image_ocr_text: 'Use an asset path to read OCR text already stored by SiYuan. This action does not run OCR. Empty stored text returns available=false and points vision-capable clients to read_image.',
    extract_doc: 'Use a document ID + optional outputDir. Exports the document markdown and all referenced assets into an uncompressed folder, preserving original filenames. If outputDir is omitted, the default output root is ~/siyuan-extracted/; pass outputDir explicitly for a predictable path such as /private/tmp. With the kernel coordinator enabled, CLI/Node download the manifest into a fresh document directory, preserve existing siblings and reject an existing destination. Direct kernel clients can request delivery=download and save the returned Markdown and asset paths themselves. Without kernel delegation, the existing Node extraction behavior clears the entire output root first and skips unreadable assets. The returned extractedDir is an absolute path ready for direct file access.',
};

export const SEARCH_GUIDANCE: string[] = [
    'For permission-scoped document inventories, body statistics, and same-title candidates, use document(action="query"). SQL mode in fulltext has the same all-notebooks-readable requirement as query_sql.',
    'All search actions are read-only except find_replace, which modifies content and requires explicit user confirmation.',
    'search(action="query_sql") only accepts SELECT statements and preserves user-selected columns. If any notebook is unreadable it runs in restricted mode: only blocks, spans, attributes, assets, refs and file_annotation_refs (placed after FROM/JOIN) are allowed, and each is rewritten to rows from readable notebooks; the response scope field says which mode ran.',
    'When listing rows with query_sql, add LIMIT yourself (aggregates need none). MCP may still truncate large result sets and will tell you when to refine the query.',
    'The blocks table columns include: id, parent_id, root_id, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated.',
    'In SQL results, blocks.type uses SiYuan short codes such as d=document, h=heading, p=paragraph, l=list, i=list-item, b=blockquote, c=code, m=math, t=table, html=html, video=video, audio=audio, widget=widget.',
    'Use search(action="fulltext") for exact keyword or syntax searches, search(action="semantic") for meaning-based discovery, and search(action="query_sql") for structured queries.',
    'search(action="fulltext") types field auto-expands shortcodes: {"h": true, "p": true} is equivalent to {"heading": true, "paragraph": true}. Shortcodes: d/h/p/l/i/b/c/m/t/s/html/embed/av. Prefer semantic aliases such as methodName/sortBy over numeric method/orderBy.',
    'search(action="fulltext") supports parentId to scope results within a document subtree, and hasTags to filter by tag presence.',
    'Right after creating or editing content, full-text and tag search can lag behind writes because SiYuan indexing is eventually consistent; brief retries are expected in live tests.',
];

export const SEARCH_ACTION_HINTS: Partial<Record<SearchAction, string>> = {
    fulltext: 'Pass a query string. Supports keyword, query syntax, SQL, and regex modes via methodName (preferred) or method. fulltext now returns plainContent/excerpt by default. types accepts shortcodes directly: {"h": true, "c": true} auto-expands to {"heading": true, "codeBlock": true}. Use sortBy="relevance" or "date" instead of numeric orderBy. Use parentId to scope within a document, hasTags to filter tagged blocks.',
    semantic: 'Searches SiYuan’s native embedding index by meaning. Requires SiYuan 3.7.0+ and an enabled, indexed embedding model. Supports paths, types/typeShortcodes, subTypes, page, and pageSize; encrypted notebooks are not included in the native embedding index.',
    query_sql: 'Execute a SELECT statement. Common tables: blocks, spans, assets. Prefer sql over stmt when prompting an AI. Use LIMIT on row listings to control result size (aggregates need none). User-selected columns are preserved. With any unreadable notebook, query_sql runs in restricted mode (tables blocks/spans/attributes/assets/refs/file_annotation_refs only, scoped to readable notebooks; no sqlite_*/pragma_* or CTEs named like tables) and fulltext SQL mode is rejected. Use document(action="query") for permission-scoped document lists and statistics.',
    get_backlinks: 'Returns documents that contain references and/or text mentions for the given block ID (backlinks/backmentions, grouped by document), plus refBlocks: the exact blocks that reference it, with their content (same rows as search_refs). Use mode="links" | "mentions" | "both". Partial permission-filtered results include machine-readable metadata.',
    search_refs: 'Returns the blocks whose content references the target id (block refs to that block or document), each with its own content and ref_text. Empty when nothing references id. Use rootID to limit to one referencing document and k to filter by keyword; get_backlinks groups by document and can include unlinked mentions.',
    find_replace: 'This is the mutating exception inside the search tool. It performs content replacement after write-permission checks and still requires explicit user confirmation. Only the listed blocks are rewritten, but SiYuan block refs elsewhere whose anchor text is dynamic follow the referenced block, so they show its new text after the change.',
    search_assets: 'Searches asset filenames. Prefer query over k when prompting an AI. If you need OCR or indexed inner-text matches, use fulltext_asset_content instead.',
    fulltext_asset_content: 'Searches indexed asset/OCR text. Prefer methodName and sortBy over numeric method/orderBy. Provide assetId for an exact asset-content lookup.',
};

export const TAG_ACTION_HINTS: Partial<Record<TagAction, string>> = {
    list: 'Optional keyword/query searches tags; sort, ignoreMaxListHint, and app are passed through to SiYuan for plain listing.',
    rename: 'Renames a workspace tag label everywhere it appears.',
    remove: 'Deletes a workspace tag label. This action requires explicit user confirmation.',
};

export const TIMELINE_ACTION_HINTS: Partial<Record<TimelineAction, string>> = {
    list_nodes: 'Use scope="global" without documentId, or scope="document"|"all" with documentId. Results are newest first and paginated.',
    create_node: 'Use scope="document" with documentId for a document node, or scope="global" for a node visible to every document. The returned tag is the stable identifier for later actions.',
    compare_node: 'Compares the tagged historical node with a newly created current-state snapshot for one document. Changed blocks are paginated; includeUnchanged defaults to false.',
    delete_node: 'Removes the node tag but retains the underlying snapshot. Document tags require their matching documentId. This action is dangerous and disabled by default.',
    rollback_document: 'Restores only the selected document file from the historical node, not the whole repository. Requires rwd and explicit confirmation; disabled by default.',
    rollback_block: 'Pass a changeKey from compare_node. The diff is recalculated and stale or non-restorable changes are rejected. Requires rwd and explicit confirmation; disabled by default.',
};

export const SYSTEM_ACTION_HINTS: Partial<Record<SystemAction, string>> = {
    workspace_info: 'Returns workspace path metadata and current SiYuan version. High-risk: leaks the absolute workspace path; disabled by default and requires explicit user confirmation.',
    network: 'Returns masked proxy information only.',
    conf: 'Defaults to a navigable summary. Use mode="get" with keyPath to read one config field or subtree at a time, e.g. conf.appearance.mode or conf.langs[0].',
    notify: 'Show an info or error notification in the SiYuan UI. Optional timeout is in milliseconds.',
    changelog: 'Reads the bundled plugin CHANGELOG with structured personalizationReview hints. Pass fromVersion after upgrades, version for one exact entry, or includeRaw=true for Markdown.',
    perform_sync: 'Triggers SiYuan sync immediately through /api/sync/performSync. This action can change local and remote sync state and requires explicit user confirmation.',
    get_version: 'Returns the current SiYuan version as {version}.',
    get_current_time: 'Returns the current system time as {currentTime} epoch milliseconds and {iso} ISO 8601 text.',
};

export const FLASHCARD_ACTION_HINTS: Partial<Record<FlashcardAction, string>> = {
    list_cards: 'Use scope="all" | "deck" | "notebook" | "tree" plus optional filter="due" (default) | "new" | "old". For scope="all", omit deckID; an empty string is treated as omitted. For scope="deck", pass a non-empty deckID. For scope="notebook", pass notebook. For scope="tree", pass rootID. reviewedCards is optional and follows SiYuan\'s review flow.',
    get_decks: 'Returns available flashcard decks so the caller can discover deckID values.',
    get_cards: 'Use deckID + optional page/pageSize to list all cards in a deck (regardless of due state). Use empty string deckID to query across all decks. Returns cards, total count, and pageCount.',
    review_card: 'Use a concrete deckID + cardID + rating, or pass skip=true to skip for the current session without rating/rescheduling. Continue with reviewSession.nextListArgs; omitting reviewedCards starts a new session and clears skips. Copy cardID from list_cards or get_cards, never blockID. Preflight with validateOnly=true, then submit preflight.commitArgs unchanged. The card must exist in that deck and its notebook must be writable; invalid IDs are rejected before review. Strict readback checks the actual scheduling state. reviewedCards is optional; each entry must include cardID because SiYuan only reads reviewedCards[].cardID.',
    create_card: 'Use deckID + content blockIDs to turn existing blocks into flashcards; single blockID is accepted as a convenience alias. Non-built-in deck IDs must already exist. Document block IDs are rejected. This calls SiYuan\'s addRiffCards flow, writes custom-riff-decks, verifies the binding, and creates deck records together.',
    remove_card: 'Use deckID + blockIDs to remove flashcard bindings from a deck. This does not delete the underlying note blocks. This action requires explicit user confirmation.',
};

export const MASCOT_ACTION_HINTS: Partial<Record<MascotAction, string>> = {
    get_balance: 'Returns the cat’s current balance and lifetime earned count. Each successful MCP tool call adds 1 coin and increments the lifetime count.',
    shop: 'Returns the current mascot shop inventory including stable item IDs, labels, cost, type, and emoji.',
    buy: 'Buys one shop item by item_id and deducts its configured cost from balance.',
};

export const FEEDBACK_ACTION_HINTS: Partial<Record<FeedbackAction, string>> = {
    submit: 'Sends plain-text feedback after user authorization, without validateOnly, requestId or hash credentials even in strict mode. External submissions have no strict replay guarantee; do not automatically retry an uncertain submission. Put a GitHub Issue-style report in description when reporting bugs, confusing behavior, or rough workflows. Recommended headings: ## Summary, ## What happened, ## Expected behavior, ## Steps or context, ## Impact, ## Suggested fix. impact should be a short impact summary; suggestion should be the direct fix idea. Avoid private note content and secrets.',
};

export const EXTENSION_ACTION_HINTS: Partial<Record<string, string>> = {
    list: 'Set refresh=true to re-read the official SiYuan MCP tool registry. The result separates plugin/native sources and reports the currently exposed schema size. Discovery failures preserve the last successful cache.',
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
    timeline: TIMELINE_GUIDANCE,
    system: SYSTEM_GUIDANCE,
    flashcard: FLASHCARD_GUIDANCE,
    extension: EXTENSION_GUIDANCE,
    mascot: MASCOT_GUIDANCE,
    feedback: FEEDBACK_GUIDANCE,
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
    timeline: TIMELINE_ACTION_HINTS,
    system: SYSTEM_ACTION_HINTS,
    flashcard: FLASHCARD_ACTION_HINTS,
    extension: EXTENSION_ACTION_HINTS,
    mascot: MASCOT_ACTION_HINTS,
    feedback: FEEDBACK_ACTION_HINTS,
};

export interface HelpExample {
    title: string;
    description?: string;
    mcp: Record<string, unknown>;
}

export const TOOL_ACTION_EXAMPLES: Record<ToolCategory, Partial<Record<string, HelpExample[]>>> = {
    document: {
        remove: [
            { title: 'Remove one document by ID (preflight first)', mcp: { action: 'remove', id: '20240318112233-doc0001', validateOnly: true } },
            { title: 'Remove one document by notebook + storage path', description: 'path is the storage path from document lookup (ends in .sy).', mcp: { action: 'remove', notebook: '20210808180117-czj9bvb', path: '/20240318112233-doc0001.sy', validateOnly: true } },
        ],
        lookup: [
            { title: 'Look up a document by ID', mcp: { action: 'lookup', id: '20240318112233-doc0001' } },
            { title: 'Look up a document by notebook + human path', mcp: { action: 'lookup', notebook: '20210808180117-czj9bvb', hpath: '/Folder/Doc' } },
        ],
        move: [
            {
                title: 'Move documents under another document by ID',
                description: 'fromIDs move under toID (a document ID, or a notebook ID for its root). Moves are delete-level: every notebook involved needs rwd.',
                mcp: { action: 'move', fromIDs: ['20240318112233-doc0002'], toID: '20240318112233-doc0001', validateOnly: true },
            },
        ],
        heading_to_doc: [
            {
                title: 'Split a heading into a child document of its source',
                description: 'The heading and everything under it move into the new document (its ID is the heading ID). targetPath is the source document storage path from document lookup; omit it to land at the notebook root. Rename the new document afterwards if needed.',
                mcp: { action: 'heading_to_doc', headingID: '20240318112233-head001', targetNotebook: '20240318112233-nb00001', targetPath: '/20240318112233-doc0001.sy', validateOnly: true },
            },
        ],
        query: [
            { title: 'List readable documents with indexed statistics', mcp: { action: 'query', page: 1, pageSize: 50 } },
            { title: 'Find documents with no indexed body blocks', mcp: { action: 'query', maxBlocks: 0, fields: ['id', 'notebook', 'title', 'hpath', 'blockCount'] } },
            { title: 'Find same-title candidates across readable notebooks', mcp: { action: 'query', duplicatesOnly: true, sortBy: 'title', sortOrder: 'asc', fields: ['id', 'notebook', 'title', 'hpath', 'sameTitleCount'] } },
            { title: 'List only metadata under a human path', mcp: { action: 'query', hpathPrefix: '/Projects', fields: ['id', 'notebook', 'title', 'hpath', 'updated'] } },
        ],
        ensure_link_targets: [
            {
                title: 'Resolve explicit existing child IDs',
                description: 'Replace the notebook, parent, and child IDs with IDs returned by the tools. Resolve/reuse target objects contain a caller key and an existing document id; omit title.',
                mcp: {
                    action: 'ensure_link_targets',
                    notebook: '20210808180117-czj9bvb',
                    parentId: '20240318112233-abc1234',
                    mode: 'resolve',
                    targets: [{ key: 'source-index', id: '20240318112233-def4567' }],
                },
            },
            {
                title: 'Reuse an exact existing child ID',
                mcp: {
                    action: 'ensure_link_targets',
                    notebook: '20210808180117-czj9bvb',
                    parentId: '20240318112233-abc1234',
                    mode: 'reuse',
                    targets: [{ key: 'source-index', id: '20240318112233-def4567' }],
                },
            },
            {
                title: 'Preflight creation with an explicit new title',
                description: 'Create target objects contain a caller key and a new title; omit id. Preflight performs no write; commit once with the same business arguments, validateOnly=false, and the returned requestId and expectedStructureHash.',
                mcp: {
                    action: 'ensure_link_targets',
                    notebook: '20210808180117-czj9bvb',
                    parentId: '20240318112233-abc1234',
                    mode: 'create',
                    targets: [{ key: 'source-index', title: 'New Target' }],
                    validateOnly: true,
                },
            },
        ],
        create: [
            {
                title: 'Create a child document by notebook-local hpath (recommended)',
                description: 'The path is inside the notebook. Do not include the notebook name, and do not pass a .sy storage path here.',
                mcp: {
                    action: 'create',
                    notebook: '20210808180117-czj9bvb',
                    path: '/Folder/Parent/New Child',
                    markdown: '正文从这里开始，不要再写 # New Child。',
                },
            },
            {
                title: 'Create with a human-readable parent hpath plus title',
                description: 'Use this when the parent hpath is already known and you want the title separated from the parent path.',
                mcp: {
                    action: 'create',
                    notebook: '20210808180117-czj9bvb',
                    parentPath: '/Folder/Parent',
                    title: 'New Child',
                    markdown: '正文从这里开始，不要再写 # New Child。',
                },
            },
            {
                title: 'Create with a storage parent path returned by lookup',
                description: 'Only parentPath accepts this .sy storage path form; path does not.',
                mcp: {
                    action: 'create',
                    notebook: '20210808180117-czj9bvb',
                    parentPath: '/20240318112233-abc123.sy',
                    title: 'New Child',
                },
            },
        ],
    },
    fs: {
        replace: [
            {
                title: 'Replace exact text with canonical edit object',
                mcp: {
                    action: 'replace',
                    path: '/Notebook/Folder/Doc',
                    edit: {
                        old: 'ORIGINAL_TEXT',
                        new: 'NEW_TEXT',
                    },
                },
            },
            {
                title: 'Replace exact text with shorthand old/new',
                description: 'Equivalent CLI form: siyuan-sisyphus fs replace --path "/Notebook/Folder/Doc" --old ORIGINAL_TEXT --new NEW_TEXT',
                mcp: {
                    action: 'replace',
                    path: '/Notebook/Folder/Doc',
                    old: 'ORIGINAL_TEXT',
                    new: 'NEW_TEXT',
                    replace_all: false,
                },
            },
        ],
    },
    notebook: {},
    block: {
        insert: [
            { title: 'Insert a block after another block', mcp: { action: 'insert', dataType: 'markdown', data: 'New paragraph', previousID: '20240318112233-abc123', validateOnly: true } },
            { title: 'Insert a block as the first child of a document', mcp: { action: 'insert', dataType: 'markdown', data: 'New paragraph', parentID: '20240318112233-doc0001', validateOnly: true } },
        ],
        docs_info: [
            { title: 'Document info for one ID', mcp: { action: 'docs_info', id: '20240318112233-doc0001' } },
        ],
        move: [
            {
                title: 'Move a block after another block',
                description: 'previousID places the block right after that sibling (any parent). To make it the first child of a block or document, pass parentID instead.',
                mcp: { action: 'move', id: '20240318112233-abc123', previousID: '20240318112233-def456', validateOnly: true },
            },
            {
                title: 'Move a block to the top of a document',
                mcp: { action: 'move', id: '20240318112233-abc123', parentID: '20240318112233-doc0001', validateOnly: true },
            },
        ],
        update: [
            {
                title: 'Replace one block (preflight first)',
                description: 'Writes are two steps: run with validateOnly=true, then commit with the returned requestId and expectedStateHash.',
                mcp: { action: 'update', id: '20240318112233-abc123', dataType: 'markdown', data: 'New paragraph text', validateOnly: true },
            },
            {
                title: 'Replace several blocks in one call',
                mcp: { action: 'update', items: [{ id: '20240318112233-abc123', dataType: 'markdown', data: 'First' }, { id: '20240318112233-def456', dataType: 'markdown', data: 'Second' }], validateOnly: true },
            },
        ],
        replace: [
            {
                title: 'Replace exact text inside one block (preflight first)',
                description: 'edit is {old, new} or a list of them; add replace_all=true to replace every occurrence. Copy old from block get_kramdown.',
                mcp: { action: 'replace', id: '20240318112233-abc123', edit: { old: 'old text', new: 'new text' }, validateOnly: true },
            },
            {
                title: 'Several edits in one block',
                mcp: { action: 'replace', id: '20240318112233-abc123', edit: [{ old: 'draft', new: 'final' }, { old: 'TODO', new: 'DONE', replace_all: true }], validateOnly: true },
            },
        ],
        word_count: [
            {
                title: 'Get word count for one block',
                description: 'id is accepted as a convenience alias for ids=[id].',
                mcp: {
                    action: 'word_count',
                    id: '20240318112233-abc123',
                },
            },
            {
                title: 'Get word count for multiple blocks',
                mcp: {
                    action: 'word_count',
                    ids: ['20240318112233-abc123', '20240318112233-def456'],
                },
            },
        ],
    },
    av: {
        add_rows: [
            {
                title: 'Add rows and fill their cells in one batch (preflight first)',
                description: 'Get column IDs from av(action="get"). Each row needs a unique clientKey; primaryKeyText fills the primary key column.',
                mcp: {
                    action: 'add_rows',
                    avID: '20240318112233-avdb001',
                    rows: [
                        { clientKey: 'a', primaryKeyText: 'Write spec', cells: [{ columnID: '20240318112233-status1', valueType: 'select', option: 'Doing' }, { columnID: '20240318112233-hours01', valueType: 'number', number: 3 }] },
                        { clientKey: 'b', primaryKeyText: 'Review', cells: [{ columnID: '20240318112233-status1', valueType: 'select', option: 'Todo' }] },
                    ],
                    validateOnly: true,
                },
            },
        ],
        set_cells: [
            {
                title: 'Set a select and a number cell',
                mcp: {
                    action: 'set_cells',
                    avID: '20240318112233-avdb001',
                    cells: [
                        { rowID: '20240318112233-row0001', columnID: '20240318112233-status1', valueType: 'select', option: 'Done' },
                        { rowID: '20240318112233-row0001', columnID: '20240318112233-hours01', valueType: 'number', number: 5 },
                    ],
                    validateOnly: true,
                },
            },
        ],
        rename: [
            {
                title: 'Name the database and rename its primary key column',
                mcp: { action: 'rename', avID: '20240318112233-avdb001', name: 'Tasks', keyID: '20240318112233-pkey001', keyName: 'Task', validateOnly: true },
            },
        ],
        update_view: [
            {
                title: 'Preflight a select leaf filter',
                description: 'Replace the IDs with the exact database, carrier, selected view, and existing select-column IDs returned by get/query. Use an actual option name. A leaf has no combination or filters fields. Commit once with unchanged business arguments, validateOnly=false, and the returned requestId and expectedStateHash.',
                mcp: {
                    action: 'update_view',
                    avID: '20240318112233-avdb001',
                    blockID: '20240318112233-block01',
                    viewID: '20240318112233-view001',
                    filters: [{
                        column: '20240318112233-status1', operator: '=',
                        value: { type: 'select', mSelect: [{ content: '待办' }] },
                    }],
                    validateOnly: true,
                },
            },
            {
                title: 'Preflight nested filter groups',
                description: 'Each group contains only combination and filters. Its children are groups or leaf conditions; column/operator/value belong only on leaves.',
                mcp: {
                    action: 'update_view',
                    avID: '20240318112233-avdb001',
                    blockID: '20240318112233-block01',
                    viewID: '20240318112233-view001',
                    filters: [{
                        combination: 'and',
                        filters: [{
                            combination: 'or',
                            filters: [
                                { column: '20240318112233-status1', operator: '=', value: { type: 'select', mSelect: [{ content: '待办' }] } },
                                { column: '20240318112233-status1', operator: '=', value: { type: 'select', mSelect: [{ content: '进行中' }] } },
                            ],
                        }],
                    }],
                    validateOnly: true,
                },
            },
            {
                title: 'Sort descending by one column',
                description: 'order is ASC or DESC (lowercase is accepted). blockID comes from get databaseContext.carrierBlockIDs and may be omitted when the database has exactly one carrier.',
                mcp: {
                    action: 'update_view',
                    avID: '20240318112233-avdb001',
                    blockID: '20240318112233-block01',
                    viewID: '20240318112233-view001',
                    sorts: [{ column: '20240318112233-score01', order: 'DESC' }],
                    validateOnly: true,
                },
            },
        ],
        query: [
            {
                title: 'Query an AV returned by search',
                description: 'Use get to inspect a database returned by search, then query its records.',
                mcp: {
                    action: 'query',
                    avID: '20240318112233-abc123',
                    page: 1,
                    pageSize: 20,
                },
            },
            {
                title: 'Query an existing AV',
                mcp: {
                    action: 'query',
                    avID: '20240318112233-abc123',
                },
            },
        ],
    },
    file: {
        export_markdown_snapshot: [
            {
                title: 'Export a document and every descendant as Markdown',
                description: 'roots takes notebook-local storage paths (from document lookup); each documents[] item carries content (the Markdown) plus hashes. Follow the cursor for further pages.',
                mcp: { action: 'export_markdown_snapshot', notebookID: '20240318112233-nb00001', roots: ['/20240318112233-doc0001.sy'] },
            },
            {
                title: 'Export specific documents only',
                mcp: { action: 'export_markdown_snapshot', notebookID: '20240318112233-nb00001', documentIDs: ['20240318112233-doc0001'] },
            },
        ],
        upload_asset: [
            {
                title: 'Upload a local file with canonical fields',
                mcp: {
                    action: 'upload_asset',
                    assetsDirPath: '/assets/',
                    localFilePath: '/private/tmp/demo.txt',
                },
            },
            {
                title: 'Upload a local file with file shorthand',
                description: 'When assetsDirPath is omitted, upload_asset uses /assets/.',
                mcp: {
                    action: 'upload_asset',
                    file: '/private/tmp/demo.txt',
                },
            },
        ],
        create_template: [
            {
                title: 'Create a nested Markdown template',
                mcp: {
                    action: 'create_template',
                    path: 'reports/monthly.md',
                    markdown: '# .action{.title}\n\n## Summary\n',
                },
            },
        ],
        update_template: [
            {
                title: 'Replace an existing template source',
                mcp: {
                    action: 'update_template',
                    path: 'reports/monthly.md',
                    markdown: '# .action{.title}\n\n## Updated Summary\n',
                },
            },
        ],
        save_doc_as_template: [
            {
                title: 'Save a document as a root template',
                mcp: {
                    action: 'save_doc_as_template',
                    id: '20240318112233-abc123',
                    name: 'meeting-note',
                },
            },
        ],
        extract_doc: [
            {
                title: 'Extract a document to an explicit local output root',
                description: 'If outputDir is omitted, extract_doc defaults to ~/siyuan-extracted/.',
                mcp: {
                    action: 'extract_doc',
                    id: '20240318112233-abc123',
                    outputDir: '/private/tmp/siyuan-extracted',
                },
            },
        ],
    },
    search: {
        search_assets: [
            { title: 'Find assets by file name keyword', mcp: { action: 'search_assets', query: 'report' } },
        ],
        fulltext_asset_content: [
            { title: 'Search text inside assets (PDF, Office, OCR)', mcp: { action: 'fulltext_asset_content', query: 'invoice' } },
        ],
        query_sql: [
            {
                title: 'List matching blocks (pass the statement as sql)',
                description: 'Add LIMIT to row listings; an aggregate such as COUNT(*) returns one row and needs none. With an unreadable notebook the result scope says which notebooks were covered.',
                mcp: { action: 'query_sql', sql: "SELECT id, content, hpath FROM blocks WHERE type = 'p' AND content LIKE '%keyword%' LIMIT 10" },
            },
        ],
    },
    tag: {},
    timeline: {},
    system: {
        changelog: [
            {
                title: 'Review changes after a known previous plugin version',
                description: 'Use this after an upgrade to decide whether user rules, /AGENTS.md memory, connection snippets, permissions, appearance, timeline settings, or tool config need attention.',
                mcp: {
                    action: 'changelog',
                    fromVersion: '0.4.8',
                },
            },
            {
                title: 'Read one exact release entry with raw Markdown',
                mcp: {
                    action: 'changelog',
                    version: '0.4.11',
                    includeRaw: true,
                },
            },
        ],
    },
    flashcard: {
        create_card: [
            {
                title: 'Create one flashcard from a content block',
                description: 'blockID is accepted as a convenience alias for blockIDs=[blockID].',
                mcp: {
                    action: 'create_card',
                    deckID: '20230218211946-2kw8jgx',
                    blockID: '20240318112233-abc123',
                },
            },
            {
                title: 'Create flashcards from multiple content blocks',
                mcp: {
                    action: 'create_card',
                    deckID: '20230218211946-2kw8jgx',
                    blockIDs: ['20240318112233-abc123', '20240318112233-def456'],
                },
            },
        ],
    },
    extension: {
        list: [{
            title: 'Refresh official MCP tool discovery',
            mcp: { action: 'list', refresh: true },
        }],
        validate_package: [{
            title: 'Validate explicit plugin package content',
            mcp: {
                action: 'validate_package',
                package: {
                    type: 'plugin',
                    manifest: {
                        name: 'example-plugin',
                        version: '1.0.0',
                        displayName: { default: 'Example Plugin' },
                        description: { default: 'Example package' },
                    },
                    files: { 'index.js': 'module.exports = class Example {}; ' },
                },
            },
        }],
        diagnose_plugin_mcp: [{
            title: 'Read back plugin MCP registration',
            mcp: {
                action: 'diagnose_plugin_mcp',
                pluginName: 'example-plugin',
                expectedToolNames: ['echo'],
                expectedState: 'present',
            },
        }],
    },
    mascot: {},
    feedback: {},
};

export { ACTIONS_BY_CATEGORY } from './config';

export const TOOL_OVERVIEW_RESOURCE_URI = 'siyuan://help/tool-overview';
export const DOCUMENT_PATH_RESOURCE_URI = 'siyuan://help/document-path-semantics';
export const EXAMPLES_RESOURCE_URI = 'siyuan://help/examples';
export const AI_LAYOUT_GUIDE_RESOURCE_URI = 'siyuan://help/ai-layout-guide';
export const USER_RULES_RESOURCE_URI = 'siyuan://help/user-rules';
export const ACTION_RESOURCE_TEMPLATE_URI = 'siyuan://help/action/{tool}/{action}';
export { CHANGELOG_RESOURCE_URI };

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
