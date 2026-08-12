const call = (tool, action, args = {}) => ({ tool, action, args });

export const scenarios = [
    {
        id: 'sisyphus',
        cliName: 'siyuan-sisyphus',
        mcpName: 'siyuan-mcp-sisyphus',
        cliDescription: 'CLI-only top-level skill for operating SiYuan Note through siyuan-sisyphus. Use to choose a scenario workflow, discover live command help, handle paths and IDs, paginate results, and apply safety rules.',
        mcpDescription: 'Top-level skill for operating SiYuan Note through the Sisyphus MCP server. Use to choose an aggregated tool, discover action resources, route complex tasks to a scenario skill, and apply permissions and safety rules.',
        title: 'SiYuan Sisyphus',
        displayName: 'SiYuan Sisyphus',
        shortDescription: 'Route safe SiYuan note workflows',
        defaultPrompt: 'Use $NAME to choose and follow the safest SiYuan workflow for this task.',
        body: `Use the narrowest scenario skill that matches the task. For unfamiliar fields, inspect {{help * *}} before calling an action; live action help is the parameter-level source of truth.

## Scenario routing

| Scenario | Skill |
| --- | --- |
| Browse notebooks, documents, paths, IDs, and blocks | {{skill browse-read}} |
| Create documents or edit blocks | {{skill create-edit}} |
| Fulltext, SQL, backlinks, references, and replacement | {{skill search-query}} |
| Attribute views, columns, rows, and cells | {{skill database}} |
| Assets, extraction, and exports | {{skill file-export}} |
| Tags, decks, cards, and review | {{skill tag-flashcard}} |
| Timeline nodes, snapshot comparison, and rollback | {{skill timeline}} |
| Permissions, system information, and dangerous operations | {{skill system-safety}} |
| Rich Markdown, math, diagrams, and SiYuan markup | {{skill markup-guide}} |

## Tool choice

Prefer \`fs\` for ordinary human-readable workspace paths. Use \`document\` or \`block\` for IDs, storage paths, metadata, or block-granular changes. Use \`av\` for real databases rather than Markdown tables. Use \`timeline\` for named snapshots, document diffs, and rollback. Low-complexity \`feedback\` and \`mascot\` actions need no separate scenario skill.

The CLI, a raw MCP payload, and an Agent-generated call are invocation forms, not proof that Sisyphus strict-write handling ran. For a protected mutation, follow the selected runtime's current help and returned safety fields. The documented preflight, single-attempt transport, idempotency, and readback guarantees apply only when the call is routed through the active Sisyphus write coordinator with strict mode enabled. Do not infer kernel-level compare-and-swap or parity with native SiYuan and third-party calls.

## Operation risk before routing

Classify the requested operation before choosing a surface: **R** is read or discovery; **W1** is an additive or local write; **W2** changes structure, references, assets, or attribute-view data; **W3** affects notebooks, imports, sync, history, or workspace-wide state. Use the narrowest surface and confirmation appropriate to the tier. Treat an undocumented or uncertain operation as the higher-risk tier until current action help and returned policy fields establish otherwise. This is routing discipline, not a replacement for the current action schema or safety policy.

{{call version}}
{{call notebooks}}
{{call tree}}
{{call read}}

## Shared invariants

- Read \`/AGENTS.md\` through \`fs\` before workspace-aware tasks when it exists.
- A workspace path such as \`/Notebook/Folder/Doc\`, an hpath such as \`/Folder/Doc\`, and a storage path such as \`/20260712123000-abc123.sy\` are different values.
- Resolve the exact target before mutating: map a human path or search candidate to the returned stable ID and retain its notebook, hpath, and storage path. Never derive an opaque ID or storage path from a title, and never treat a candidate list as the final target.
- Read before writing; after a mutation, read the affected object again.
- Keep reads bounded and prove completeness: use \`nextWindow\` or explicit \`blockStart\`/\`blockLimit\`/\`tokenBudget\` for documents, and page parameters for lists and searches. Continue while another page/window is advertised, then reread the exact affected ID/path and compare the intended field or status.
- If a write response is lost, or the result is \`outcome_unknown\` or \`readback_mismatch\`, stop and inspect the exact target. Do not resend with a new \`requestId\` merely because the acknowledgement was missing.
- Missing results may be caused by notebook permissions or indexing delay.
- Obtain explicit approval before deletes, moves, bulk replacement, permission changes, local upload/export, or sensitive workspace disclosure.
`,
        calls: {
            version: call('system', 'get_version'),
            notebooks: call('notebook', 'list'),
            tree: call('fs', 'tree', { path: '/Notebook', maxDepth: 3 }),
            read: call('fs', 'read', { path: '/Notebook/Folder/Doc', blockStart: 0, blockLimit: 50, tokenBudget: 2000 }),
        },
    },
    {
        id: 'browse-read',
        cliName: 'siyuan-sisyphus-browse-read',
        mcpName: 'siyuan-mcp-browse-read',
        cliDescription: 'CLI-only playbook for browsing and reading SiYuan notes with siyuan-sisyphus. Use for notebooks, document trees, human-readable paths, IDs, storage paths, block content, and read-only discovery.',
        mcpDescription: 'MCP playbook for browsing and reading SiYuan notes. Use for notebooks, document trees, human-readable paths, IDs, storage paths, block content, and read-only discovery.',
        title: 'Browse and Read SiYuan',
        displayName: 'SiYuan Browse & Read',
        shortDescription: 'Browse and read SiYuan notes safely',
        defaultPrompt: 'Use $NAME to locate and read the requested SiYuan content.',
        body: `Start with \`fs\` and human-readable paths. Drop to document or block actions only when IDs, storage paths, metadata, or block structure are required.

## Discovery workflow

{{call notebooks}}
{{call root}}
{{call tree}}
{{call read}}

Use search-assisted discovery when the path is unknown:

{{call search}}
{{call fulltext}}

## Low-level reads

{{call lookup}}
{{call document}}
{{call block}}

## Path semantics

| Value | Example | Typical use |
| --- | --- | --- |
| Workspace path | \`/Notebook/Folder/Doc\` | \`fs\` actions |
| Notebook-local hpath | \`/Folder/Doc\` | document create or lookup with notebook |
| Storage path | \`/20260712123000-abc123.sy\` | low-level rename, remove, or move |

Never derive a storage path from a title. Resolve the document first and reuse the returned path. For \`fs.read\` and Markdown \`document.get_doc\`, treat \`hasNextWindow=true\` as incomplete data and continue with the returned \`nextWindow\`. For list and search results, continue with explicit \`page\` and \`pageSize\` values.

Discovery identifies candidates; it does not authorize a write. Before changing one result, reread it by stable ID or resolved path and record the exact target. If a read is incomplete, continue the bounded window or page sequence instead of deciding from a truncated response.
`,
        calls: {
            notebooks: call('notebook', 'list'),
            root: call('fs', 'ls', { path: '/' }),
            tree: call('fs', 'tree', { path: '/Notebook/Folder', maxDepth: 4 }),
            read: call('fs', 'read', { path: '/Notebook/Folder/Doc', blockStart: 0, blockLimit: 50, tokenBudget: 2000 }),
            search: call('fs', 'search', { path: '/Notebook', query: 'keyword', page: 1, pageSize: 20 }),
            fulltext: call('search', 'fulltext', { query: 'keyword', page: 1, pageSize: 20 }),
            lookup: call('document', 'lookup', { id: '<doc-id>', include: ['path', 'hpath', 'notebook'] }),
            document: call('document', 'get_doc', { id: '<doc-id>', mode: 'markdown' }),
            block: call('block', 'get_kramdown', { id: '<block-id>' }),
        },
    },
    {
        id: 'create-edit',
        cliName: 'siyuan-sisyphus-create-edit',
        mcpName: 'siyuan-mcp-create-edit',
        cliDescription: 'CLI-only playbook for creating and editing SiYuan documents and blocks with siyuan-sisyphus. Use for path-based document creation, block append/insert/update, metadata, daily notes, and verified edits.',
        mcpDescription: 'MCP playbook for creating and editing SiYuan documents and blocks. Use for path-based document creation, block append/insert/update, metadata, daily notes, and verified edits.',
        title: 'Create and Edit SiYuan Content',
        displayName: 'SiYuan Create & Edit',
        shortDescription: 'Create and edit SiYuan note content',
        defaultPrompt: 'Use $NAME to make this SiYuan content change safely and verify it.',
        body: `Read the target first, choose the highest-level action that preserves intent, perform one bounded change, then read it again.

## Protected writes and readback

For a mutation covered by strict safe writes, call the same action and business arguments with \`validateOnly=true\`, use the returned precondition field, and submit one fresh UUIDv7 \`requestId\`. Never invent or recycle a hash credential. After the write, reread the exact stable ID or resolved path with enough bounded fields to prove the intended change and continue until the response is complete.

If the connection fails after execution may have started, or the result says \`outcome_unknown\` or \`readback_mismatch\`, do not retry with a new request ID. Inspect the target and resolve the outcome first. A CLI command, raw MCP payload, or Agent-generated call is not by itself evidence that this coordinator path or its guarantees applied; use the current safety response and runtime help.

## Create documents

Use a workspace path for convenient path-based creation:

{{call write}}

Use a notebook ID plus notebook-local hpath when low-level control is needed:

{{call create}}

Do not include the notebook name in the low-level hpath.

## Edit blocks

{{call append}}
{{call insert}}
{{call update}}

Use block \`update\` only when replacing the whole block is intended. Prefer a scoped replacement for a small textual change:

{{call replace}}

## Metadata and daily notes

{{call attrs}}
{{call daily}}

Before rename, move, delete, or broad replacement, resolve the exact target, show the affected scope, and obtain approval. After every mutation, read by stable ID when possible. Use {{help block append}} when any parameter is uncertain.
`,
        calls: {
            write: call('fs', 'write', { path: '/Notebook/Project/Notes', markdown: '# Notes\n\nInitial content.' }),
            create: call('document', 'create', { notebook: '<notebook-id>', path: '/Project/Notes', markdown: '# Notes' }),
            append: call('block', 'append', { parentID: '<doc-id>', dataType: 'markdown', data: '## New section\n\nParagraph.' }),
            insert: call('block', 'insert', { previousID: '<block-id>', dataType: 'markdown', data: 'Inserted paragraph.' }),
            update: call('block', 'update', { id: '<block-id>', dataType: 'markdown', data: 'Replacement block content.' }),
            replace: call('block', 'replace', { id: '<block-id>', edit: { old: 'draft', new: 'final' } }),
            attrs: call('block', 'set_attrs', { id: '<block-id>', attrs: { 'custom-source': 'agent' } }),
            daily: call('document', 'create_daily_note', { notebook: '<notebook-id>' }),
        },
    },
    {
        id: 'search-query',
        cliName: 'siyuan-sisyphus-search-query',
        mcpName: 'siyuan-mcp-search-query',
        cliDescription: 'CLI-only playbook for finding and querying SiYuan content with siyuan-sisyphus. Use for fulltext, read-only SQL, backlinks, references, assets, dynamic query blocks, and safe find-replace.',
        mcpDescription: 'MCP playbook for finding and querying SiYuan content. Use for fulltext, read-only SQL, backlinks, references, assets, dynamic query blocks, and safe find-replace.',
        title: 'Search and Query SiYuan',
        displayName: 'SiYuan Search & Query',
        shortDescription: 'Search and query SiYuan knowledge',
        defaultPrompt: 'Use $NAME to find and query the requested SiYuan knowledge.',
        body: `Search to identify candidates, read the target by ID or path, and only then edit. Use explicit pagination for repeatable results.

{{call fulltext}}
{{call scoped}}
{{call sql}}
{{call backlinks}}
{{call refs}}
{{call assets}}

SQL must be read-only and must include \`LIMIT\`. Useful tables include \`blocks\`, \`blocks_fts\`, \`attributes\`, \`refs\`, \`spans\`, and \`assets\`.

## Find and replace

This action mutates content. First search, read each target, show the exact old/new text and IDs, and obtain explicit approval.

{{call findReplace}}

Read the changed blocks again. Recent writes can take time to enter the search index; verify a fresh mutation by ID or path rather than assuming an empty search means failure. Use {{help search query_sql}} for live SQL action constraints.
`,
        calls: {
            fulltext: call('search', 'fulltext', { query: 'keyword', page: 1, pageSize: 20 }),
            scoped: call('search', 'fulltext', { query: 'keyword', parentId: '<doc-id>', typeShortcodes: ['h', 'p'] }),
            sql: call('search', 'query_sql', { stmt: "SELECT id, hpath, content FROM blocks WHERE type = 'p' ORDER BY updated DESC LIMIT 10" }),
            backlinks: call('search', 'get_backlinks', { id: '<block-or-doc-id>', mode: 'both' }),
            refs: call('search', 'search_refs', { id: '<block-id>', beforeLen: 512 }),
            assets: call('search', 'search_assets', { query: 'diagram', exts: ['png', 'jpg', 'webp'] }),
            findReplace: call('search', 'find_replace', { k: 'old text', r: 'new text', ids: ['<doc-id>'] }),
        },
    },
    {
        id: 'database',
        cliName: 'siyuan-sisyphus-database',
        mcpName: 'siyuan-mcp-database',
        cliDescription: 'CLI-only playbook for SiYuan attribute views with siyuan-sisyphus. Use to inspect database metadata, render views, add columns or rows, update cells, and keep AV, view, row, column, and block IDs distinct.',
        mcpDescription: 'MCP playbook for SiYuan attribute views. Use to inspect database metadata, render views, add columns or rows, update cells, and keep AV, view, row, column, and block IDs distinct.',
        title: 'Operate SiYuan Databases',
        displayName: 'SiYuan Database',
        shortDescription: 'Operate SiYuan attribute view databases',
        defaultPrompt: 'Use $NAME to inspect or update this SiYuan attribute view safely.',
        body: `Never guess attribute-view identifiers. Inspect the AV and its views before changing rows or cells.

{{call get}}
{{call render}}
{{call search}}

Keep these identifiers distinct: AV ID identifies the database; view ID identifies a table/board view; row ID identifies a key value; column ID identifies a key; block ID identifies note content.

## Mutations

{{call column}}
{{call rows}}
{{call cells}}

Before writing cells, render the current view and map column names to column IDs. Preserve the declared value type; do not put a date-shaped string into a number/date/select column without using the action’s expected value shape. Re-render after mutation. Read {{help av set_cells}} for the current cell schema.

Treat a successful mutation response as provisional until the same view and affected rows/cells are read back. Keep the render and readback paginated, continue while more data is advertised, and compare the intended cell values by stable row and column IDs. A raw MCP or CLI success message does not establish that strict-write coordination or complete readback occurred.
`,
        calls: {
            get: call('av', 'get', { id: '<av-id>' }),
            render: call('av', 'render', { id: '<av-id>', page: 1, pageSize: 50 }),
            search: call('av', 'search', { keyword: 'project' }),
            column: call('av', 'add_column', { avID: '<av-id>', keyName: 'Status', keyType: 'select' }),
            rows: call('av', 'add_rows', { avID: '<av-id>', viewID: '<view-id>', blockIDs: ['<block-id>'] }),
            cells: call('av', 'set_cells', { avID: '<av-id>', cells: [{ rowID: '<row-id>', columnID: '<column-id>', valueType: 'text', text: 'Done' }] }),
        },
    },
    {
        id: 'file-export',
        cliName: 'siyuan-sisyphus-file-export',
        mcpName: 'siyuan-mcp-file-export',
        cliDescription: 'CLI-only playbook for SiYuan assets and exports with siyuan-sisyphus. Use for uploads, Markdown export, document extraction, resource ZIP export, OCR text, templates, and safe asset maintenance.',
        mcpDescription: 'MCP playbook for SiYuan assets and exports. Use for uploads, Markdown export, document extraction, resource ZIP export, OCR text, templates, and safe asset maintenance.',
        title: 'Handle SiYuan Files and Exports',
        displayName: 'SiYuan Files & Export',
        shortDescription: 'Move assets and export SiYuan content',
        defaultPrompt: 'Use $NAME to handle these SiYuan assets or exports safely.',
        body: `File actions are the explicit exception to the normal remote-only data path: uploads and local exports may touch the machine running the server. Confirm local paths and scope first.

{{call upload}}
{{call exportMd}}
{{call extract}}
{{call exportResources}}
{{call assets}}
{{call ocr}}

Large uploads must stop and require explicit confirmation before retrying with the large-file confirmation field. A document extraction output directory may be cleared; use a task-specific empty directory. Before renaming, deleting, or removing unused assets, list the exact targets and obtain approval. Verify returned paths after the operation. Read {{help file upload_asset}} for current size and path constraints.
`,
        calls: {
            upload: call('file', 'upload_asset', { assetsDirPath: '/assets/', localFilePath: '/absolute/path/to/image.png' }),
            exportMd: call('file', 'export_md', { id: '<doc-id>' }),
            extract: call('file', 'extract_doc', { id: '<doc-id>', outputDir: '/tmp/siyuan-extract' }),
            exportResources: call('file', 'export_resources', { paths: ['assets/file.png', 'assets/file.pdf'] }),
            assets: call('file', 'get_doc_assets', { id: '<doc-id>', assetType: 'image' }),
            ocr: call('file', 'get_image_ocr_text', { path: 'assets/image.png' }),
        },
    },
    {
        id: 'tag-flashcard',
        cliName: 'siyuan-sisyphus-tag-flashcard',
        mcpName: 'siyuan-mcp-tag-flashcard',
        cliDescription: 'CLI-only playbook for SiYuan tags and flashcards with siyuan-sisyphus. Use for inline tags, tag discovery and rename, deck discovery, card creation, due/new review, and safe removal.',
        mcpDescription: 'MCP playbook for SiYuan tags and flashcards. Use for inline tags, tag discovery and rename, deck discovery, card creation, due/new review, and safe removal.',
        title: 'Manage SiYuan Tags and Flashcards',
        displayName: 'SiYuan Tags & Flashcards',
        shortDescription: 'Manage SiYuan tags and flashcards',
        defaultPrompt: 'Use $NAME to manage these SiYuan tags or flashcards.',
        body: `Create tags by writing \`#tag#\` into Markdown. Create flashcards with the flashcard action so both riff registration and block metadata remain consistent.

{{call tagWrite}}
{{call tags}}
{{call rename}}

## Flashcard workflow

Create or identify a heading block, discover the target deck, then register the block as a card:

{{call prompt}}
{{call decks}}
{{call create}}
{{call due}}
{{call review}}

Ratings are 1 through 4, with larger values representing easier recall. Do not imitate flashcard creation with block attributes alone. Before removing a tag or card, show the exact label, deck, and block IDs and obtain approval. Newly written tags and headings may need a short indexing delay before discovery actions show them.
`,
        calls: {
            tagWrite: call('block', 'append', { parentID: '<doc-id>', dataType: 'markdown', data: '#project# #project/phase1#' }),
            tags: call('tag', 'list', { keyword: 'project' }),
            rename: call('tag', 'rename', { oldLabel: 'old-tag', newLabel: 'new-tag' }),
            prompt: call('block', 'append', { parentID: '<doc-id>', dataType: 'markdown', data: '## What is spaced repetition?\n\nReview just before forgetting.' }),
            decks: call('flashcard', 'get_decks'),
            create: call('flashcard', 'create_card', { deckID: '<deck-id>', blockIDs: ['<heading-block-id>'] }),
            due: call('flashcard', 'list_cards', { scope: 'deck', deckID: '<deck-id>', filter: 'due' }),
            review: call('flashcard', 'review_card', { deckID: '<deck-id>', cardID: '<card-id>', rating: 3 }),
        },
    },
    {
        id: 'timeline',
        cliName: 'siyuan-sisyphus-timeline',
        mcpName: 'siyuan-mcp-timeline',
        cliDescription: 'CLI-only playbook for SiYuan document timelines with siyuan-sisyphus. Use to list or create named snapshot nodes, compare document versions, remove node tags, and safely roll back a document or one changed block.',
        mcpDescription: 'MCP playbook for SiYuan document timelines. Use to list or create named snapshot nodes, compare document versions, remove node tags, and safely roll back a document or one changed block.',
        title: 'Manage SiYuan Document Timelines',
        displayName: 'SiYuan Timeline',
        shortDescription: 'Compare and restore SiYuan document versions',
        defaultPrompt: 'Use $NAME to inspect or update this SiYuan document timeline safely.',
        body: `Resolve and read the document first. Use document-scoped nodes for one document and global nodes only when the same named snapshot should be discoverable across documents.

## Create and compare nodes

List existing nodes before creating a new one:

{{call list}}
{{call create}}

Keep the returned \`tag\` as the stable identifier. After content changes, compare the same document with that tag:

{{call compare}}

\`compare_node\` creates an untagged current-state workspace snapshot before calculating the document diff. Paginate changed blocks with \`page\` and \`pageSize\`; request unchanged blocks only when they are required for context.

## Delete or roll back

\`delete_node\` removes the protective tag but retains the underlying snapshot. \`rollback_document\` restores only the selected document file, not the whole workspace. \`rollback_block\` accepts only a fresh opaque \`changeKey\` from \`compare_node\`; it recalculates the diff and rejects stale or unsafe changes.

Before any delete or rollback, show the exact document, node name/tag, and consequence, then obtain explicit approval. These actions require \`rwd\` permission and may be disabled by default. Never bypass an unavailable dangerous action; inspect {{help timeline rollback_document}} and ask the user to enable it when appropriate.

After approval, use the narrowest operation that satisfies the request:

{{call rollbackBlock}}
{{call rollbackDocument}}
{{call delete}}

After rollback, read the document again. After node creation or deletion, list nodes again. For a reversible rollback test, create a named protection node for the current state, roll back to the target, verify it, then restore from the protection node and verify again; obtain approval for both rollback operations.
`,
        calls: {
            list: call('timeline', 'list_nodes', { scope: 'document', documentId: '<doc-id>', page: 1, pageSize: 50 }),
            create: call('timeline', 'create_node', { name: 'Before revision', scope: 'document', documentId: '<doc-id>' }),
            compare: call('timeline', 'compare_node', { documentId: '<doc-id>', tag: '<timeline-tag>', page: 1, pageSize: 20, includeUnchanged: false }),
            rollbackBlock: call('timeline', 'rollback_block', { documentId: '<doc-id>', tag: '<timeline-tag>', changeKey: '<fresh-change-key>' }),
            rollbackDocument: call('timeline', 'rollback_document', { documentId: '<doc-id>', tag: '<timeline-tag>' }),
            delete: call('timeline', 'delete_node', { tag: '<timeline-tag>', documentId: '<doc-id>' }),
        },
    },
    {
        id: 'system-safety',
        cliName: 'siyuan-sisyphus-system-cli',
        mcpName: 'siyuan-mcp-system-safety',
        cliDescription: 'CLI-only guide for SiYuan Sisyphus setup, profiles, permissions, system actions, help discovery, JSON output, dangerous operations, and troubleshooting.',
        mcpDescription: 'MCP guide for SiYuan system information, notebook permissions, action help, dangerous-operation confirmation, sensitive disclosures, and troubleshooting.',
        title: 'SiYuan System and Safety',
        displayName: 'SiYuan System & Safety',
        shortDescription: 'Use SiYuan system tools with safeguards',
        defaultPrompt: 'Use $NAME to perform this SiYuan system task safely.',
        body: `Start with a connectivity check and inspect live help before unfamiliar actions.

{{call version}}
{{call time}}
{{call permissions}}

Notebook permissions are \`rwd\`, \`rw\`, \`r\`, and \`none\`. Missing content can mean permission filtering rather than absence. Record the current value before proposing a permission change.

## Confirmation boundary

Obtain explicit approval before notebook/document/block deletion or move, bulk replacement, asset upload or deletion, local-path export, tag/card removal, permission changes, and workspace path disclosure. State the exact target and consequence. A prior request to inspect or diagnose is not approval to mutate.

{{call conf}}
{{call network}}
{{call notify}}

If an action or field is rejected, inspect {{help * *}} instead of guessing. Search results can lag recent writes; direct ID/path reads do not depend on indexing.

## Runtime and write guarantees

CLI execution is an explicit command, but that consent does not prove strict safe writes. Raw MCP payloads and Agent-generated calls likewise do not establish which coordinator or confirmation path handled them. Check the active runtime help and returned fields such as \`writeSafetyGuaranteed\` before relying on preflight, idempotency, or readback guarantees. If execution may have started and the response is lost, do not blindly resend; reread the exact target. Direct kernel, native, third-party, notification, sync, feedback, and local export effects remain outside Sisyphus strict-write guarantees.

{{runtime system}}
`,
        calls: {
            version: call('system', 'get_version'),
            time: call('system', 'get_current_time'),
            permissions: call('notebook', 'get_permissions'),
            conf: call('system', 'conf', { mode: 'summary' }),
            network: call('system', 'network'),
            notify: call('system', 'notify', { msg: 'Task complete', level: 'info', timeout: 5000 }),
        },
        runtime: {
            cli: `## CLI setup

Use \`siyuan-sisyphus init\` and \`siyuan-sisyphus config list|get|set|use\` to manage profiles. Configuration precedence is command flags, environment variables, active profile, then defaults. Use \`--json\` for scripts. The CLI treats execution as confirmation, so the agent must still ask the user before risky commands.`,
            mcp: `## MCP safety

Respect server permission errors and dangerous-action confirmation responses. Never bypass them with another action. The MCP server must not write skill files or configuration into the client machine.`,
        },
    },
    {
        id: 'markup-guide',
        cliName: 'siyuan-markup-guide',
        mcpName: 'siyuan-mcp-markup-guide',
        cliDescription: 'CLI-only SiYuan markup guide for rich Markdown written through siyuan-sisyphus. Use for headings, lists, tasks, tables, code, math, diagrams, tags, callouts, super blocks, embeds, and block references.',
        mcpDescription: 'MCP SiYuan markup guide for rich Markdown written through block and document actions. Use for headings, lists, tasks, tables, code, math, diagrams, tags, callouts, super blocks, embeds, and block references.',
        title: 'SiYuan Markup Guide',
        displayName: 'SiYuan Markup Guide',
        shortDescription: 'Write rich native SiYuan markup',
        defaultPrompt: 'Use $NAME to format this content with native SiYuan markup.',
        body: `Pass rich content as Markdown to block or document write actions. Keep each write bounded and read the result after insertion.

{{call append}}

## Common markup

\`\`\`markdown
# Heading

**bold**, *italic*, ~~deleted~~, ==highlight==, \`inline code\`, #tag#

- Item
  - Nested item
- [ ] Task

| Name | Status |
| --- | --- |
| Draft | Done |

> **Note**
>
> Keep evidence with the decision.
\`\`\`

Use an attribute view for real database behavior rather than a Markdown table.

## Math and diagrams

\`\`\`markdown
Inline: $e^{i\\pi}+1=0$

$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$
\`\`\`

\`\`\`\`markdown
\`\`\`mermaid
flowchart TD
  A[Start] --> B[Done]
\`\`\`
\`\`\`\`

## SiYuan-specific forms

- Block reference: \`((<block-id> "Optional label"))\`
- Embed query: \`{{SELECT id, content FROM blocks WHERE content LIKE '%TODO%' LIMIT 20}}\`
- Horizontal super block: wrap sibling blocks in \`{{{row\` and \`}}}\`.
- Vertical super block: wrap sibling blocks in \`{{{col\` and \`}}}\`.
- IAL attributes: \`{: custom-key="value"}\`; use dedicated attribute actions for programmatic metadata.

Do not invent unsupported Markdown extensions. For detailed layout rules or unfamiliar write fields, inspect {{help block append}} before writing.
`,
        calls: {
            append: call('block', 'append', { parentID: '<doc-id>', dataType: 'markdown', data: '## Heading\n\nParagraph with **bold** text.' }),
        },
    },
];
