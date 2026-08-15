import { AGENT_MEMORY_STALE_AFTER_DAYS, USER_RULES_VIRTUAL_PATH, formatDangerousActionsList } from './config';
import { CHANGELOG_RESOURCE_URI } from './changelog';

function formatUserRules(userRulesText = ''): string {
    const normalizedUserRules = typeof userRulesText === 'string' ? userRulesText.trim() : '';
    if (!normalizedUserRules) return '';

    const lines = normalizedUserRules
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length === 0) return '';

    return lines.map(line => `- ${line}`).join('\n');
}

export interface ServerInstructionInput {
    userRulesText?: string;
    agentSiyuanMemoryText?: string;
    agentSiyuanMemoryUpdatedAt?: string;
    agentSiyuanMemoryConfigSource?: 'api_file' | 'default_fallback';
    agentSiyuanMemoryConfigOk?: boolean;
    agentSiyuanMemoryConfigError?: string;
}

type NormalizedServerInstructionInput = Required<Pick<ServerInstructionInput,
    'userRulesText' | 'agentSiyuanMemoryText' | 'agentSiyuanMemoryUpdatedAt'
>> & Pick<ServerInstructionInput,
    'agentSiyuanMemoryConfigSource' | 'agentSiyuanMemoryConfigOk' | 'agentSiyuanMemoryConfigError'
>;

function normalizeInstructionInput(input: string | ServerInstructionInput = '', agentSiyuanMemoryText = ''): NormalizedServerInstructionInput {
    if (typeof input === 'string') {
        return {
            userRulesText: input,
            agentSiyuanMemoryText,
            agentSiyuanMemoryUpdatedAt: '',
        };
    }
    return {
        userRulesText: typeof input.userRulesText === 'string' ? input.userRulesText : '',
        agentSiyuanMemoryText: typeof input.agentSiyuanMemoryText === 'string' ? input.agentSiyuanMemoryText : '',
        agentSiyuanMemoryUpdatedAt: typeof input.agentSiyuanMemoryUpdatedAt === 'string' ? input.agentSiyuanMemoryUpdatedAt : '',
        agentSiyuanMemoryConfigSource: input.agentSiyuanMemoryConfigSource,
        agentSiyuanMemoryConfigOk: input.agentSiyuanMemoryConfigOk,
        agentSiyuanMemoryConfigError: typeof input.agentSiyuanMemoryConfigError === 'string' ? input.agentSiyuanMemoryConfigError : undefined,
    };
}

function getAgentMemoryStatus(memoryText: string, updatedAt: string): {
    status: 'missing' | 'fresh' | 'stale';
    updatedAtLabel: string;
    ageLabel: string;
} {
    if (!memoryText.trim()) {
        return {
            status: 'missing',
            updatedAtLabel: 'not created',
            ageLabel: 'unknown',
        };
    }

    const updatedTime = Date.parse(updatedAt);
    if (!updatedAt.trim() || Number.isNaN(updatedTime)) {
        return {
            status: 'stale',
            updatedAtLabel: updatedAt.trim() ? `${updatedAt} (invalid)` : 'unknown',
            ageLabel: 'unknown',
        };
    }

    const ageMs = Date.now() - updatedTime;
    const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));
    return {
        status: ageDays > AGENT_MEMORY_STALE_AFTER_DAYS ? 'stale' : 'fresh',
        updatedAtLabel: new Date(updatedTime).toISOString(),
        ageLabel: `${ageDays} day${ageDays === 1 ? '' : 's'}`,
    };
}

function formatAgentMemoryConfigSource(input: NormalizedServerInstructionInput): string {
    const source = input.agentSiyuanMemoryConfigSource === 'default_fallback'
        ? 'default fallback'
        : 'api file';
    if (input.agentSiyuanMemoryConfigOk === false) {
        const error = input.agentSiyuanMemoryConfigError?.trim();
        return error
            ? `default fallback; read failed: ${error}`
            : 'default fallback; read failed';
    }
    return source;
}

export function buildServerInstructions(input: string | ServerInstructionInput = '', agentSiyuanMemoryText = ''): string {
    const instructionInput = normalizeInstructionInput(input, agentSiyuanMemoryText);
    const dangerousActionsList = formatDangerousActionsList().join('\n');
    const formattedUserRules = formatUserRules(instructionInput.userRulesText);
    const normalizedAgentMemory = instructionInput.agentSiyuanMemoryText.trim();
    const agentMemoryStatus = getAgentMemoryStatus(normalizedAgentMemory, instructionInput.agentSiyuanMemoryUpdatedAt);
    const userRulesPrioritySection = formattedUserRules
        ? `
# Active user custom rules

These user custom rules are active for this MCP session. Apply them before choosing tools or generating SiYuan content.
- User custom rules are a higher-priority preference layer than the general usage suggestions below.
- User custom rules do not override safety confirmation requirements, notebook permissions, disabled tools, or disabled actions.
- If a user custom rule conflicts with a general recommendation in these instructions, follow the user custom rule unless it would violate one of those hard limits.
- If the configured rules change, the client must reconnect or the MCP HTTP server must restart before updated rules enter initialize-time instructions.
- To re-check the current configured rules, read \`fs(action="read", path="${USER_RULES_VIRTUAL_PATH}")\` or \`siyuan://help/user-rules\`.

## Rule list

${formattedUserRules}
`
        : '';
    const agentMemoryAction = instructionInput.agentSiyuanMemoryConfigOk === false
        ? '- MCP could not read the configured virtual memory during initialize. Before assuming `/AGENTS.md` is missing, retry `fs(action="read", path="/AGENTS.md")` or ask the user to reconnect after the SiYuan API is reachable.'
        : agentMemoryStatus.status === 'missing'
        ? '- The virtual memory file has not been initialized. Before doing workspace-aware planning or assuming notebook structure, ask the user whether to create `/AGENTS.md`; if they agree, inspect the workspace with `fs`/search, then write a concise initialization memory.'
        : agentMemoryStatus.status === 'stale'
            ? `- The memory is stale because it is older than ${AGENT_MEMORY_STALE_AFTER_DAYS} days or has no valid update time. Before relying on it for workspace-aware work, ask the user whether to refresh \`/AGENTS.md\`; if they agree, verify current state first, then update it.`
            : '- The memory is fresh enough to use as startup context, but still verify details before high-impact edits.';
    const agentMemorySection = `
# Agent siyuan memory

This is an AI-maintained summary of the current SiYuan workspace state, stored as the virtual fs file \`/AGENTS.md\`. Use it as startup context before browsing notes, but treat it as lower priority than user requests, active user custom rules, safety confirmation requirements, notebook permissions, disabled tools, and disabled actions.
- Status: ${agentMemoryStatus.status}
- Last updated: ${agentMemoryStatus.updatedAtLabel}
- Approximate age: ${agentMemoryStatus.ageLabel}
- Stale threshold: ${AGENT_MEMORY_STALE_AFTER_DAYS} days
- Config source: ${formatAgentMemoryConfigSource(instructionInput)}
${agentMemoryAction}
- Do not silently create or update \`/AGENTS.md\` without user consent when the memory is missing or stale.

## What to write in /AGENTS.md

Keep this memory concise and durable. Prefer facts that help future agents orient quickly:
- Workspace map: important notebooks, root folders, dashboards, inboxes, archives, and where active work lives.
- Current projects: active project names, key documents, status, next likely entry points, and known open questions.
- User preferences learned from notes: naming conventions, icon/layout habits, language defaults, tagging style, and database usage.
- Operating cautions: sensitive notebooks to avoid, workflows that require confirmation, conventions that prevent duplicate or misplaced notes.
- Maintenance notes: what was inspected before updating the memory and which areas may still be stale.

Avoid secrets, private credentials, long transcripts, volatile one-off task details, and facts you have not verified. Update this file through \`fs.write\` or \`fs.replace\` after the user agrees.

## Current memory

${normalizedAgentMemory || '(not created yet)'}
`;
    const userRulesReminder = formattedUserRules
        ? `\nActive user custom rules override the general style and workflow suggestions below when they apply. Re-check \`fs(action="read", path="${USER_RULES_VIRTUAL_PATH}")\` or siyuan://help/user-rules if current preferences matter.\n`
        : '';
    return `
${userRulesPrioritySection}
${agentMemorySection}

## Help and progressive disclosure

Each tool exposes common actions in its description. For detailed help on any action (including advanced ones):
- For non-trivial workflows, read \`siyuan://skills/index\` first, then load the narrowest matching \`siyuan://skills/{name}\` scenario skill. Skills explain workflow and safety decisions; action help remains the source of truth for current parameters.
- Read MCP resources: siyuan://help/action/{tool}/{action}, siyuan://help/tool-overview, siyuan://help/document-path-semantics, siyuan://help/examples, siyuan://help/ai-layout-guide, ${CHANGELOG_RESOURCE_URI}
- Read \`fs(action="read", path="${USER_RULES_VIRTUAL_PATH}")\` or siyuan://help/user-rules when user-specific preferences may affect tool choice, naming, formatting, icon behavior, or content style.
- After plugin upgrades, call \`system(action="changelog", fromVersion="<previousVersion>")\` or read \`${CHANGELOG_RESOURCE_URI}\`. If \`personalizationReview.shouldReview\` is true, tell the user which settings, rules, memory, permissions, appearance, timeline, or connection snippets may need review before changing persistent preferences.
- If your client cannot read siyuan:// resources, call any tool with action=”help” to get the same guidance (actions, required fields, hints, and examples).

## MCP App presentation and human handoff

- MCP App UI resources are attached only to the dedicated launch tools: \`timeline_app\`, \`flashcard_review_session\`, and \`mascot_shop_app\`. Ordinary \`timeline\`, \`flashcard\`, and \`mascot\` calls do not open Apps.
- Call a launch tool at most once for the requested surface. After it succeeds, hand control to the user and stop instead of opening more Apps.
- Before calling \`timeline_app\`, determine whether the user requested a particular document. Pass its \`documentId\` before launch; the App has no target-document picker after launch. If \`documentId\` is omitted, the App is global-only and can display only global timeline nodes, not document-specific nodes. Omit \`documentId\` only when the user wants the global timeline.
- After \`timeline_app\` succeeds, never call timeline rollback actions yourself and never simulate rollback with \`block(action="delete")\`, document rewrites, or other editing tools. Reply exactly “时间线界面已打开，请在界面中选择节点并执行操作。” and stop.
- After \`mascot_shop_app\` succeeds, do not call \`mascot(action="buy")\` or purchase on the user’s behalf. Reply exactly “猫猫商店已打开，请在界面中选择并购买物品。” and stop.

- If the dedicated \`flashcard_review_session\` tool is available and succeeds, its MCP App is the sole review surface for that round. The complete prompts and reference answers remain available in structured output for reasoning and compatibility, but you MUST NOT list, quote, restate, or reveal them in the conversation.
- After a successful \`flashcard_review_session\` call, do not start Q1, ask the user to answer in chat, assess an answer, assign ratings, or call \`flashcard(action="review_card")\` yourself. Reply with exactly “复习界面已打开，请在卡片中完成本轮。” and stop.
- Resume discussing card content only if the user explicitly exits the App and requests chat-based review, or after the App sends its explicit post-review teaching handoff.
- If \`flashcard_review_session\` is unavailable, ordinary \`flashcard\` results retain their complete content and may be used for a text-based review flow.

## Path semantics (critical — the most common error source)

For basic path-style notebook and document operations, use \`fs\` whenever the task can be expressed with a human-readable workspace path. Treat \`fs\` as the default virtual filesystem interface:
- List direct children: \`fs(action="ls", path="/Notebook/Folder")\`
- List a recursive tree: \`fs(action="tree", path="/Notebook/Folder")\`
- Read Markdown in complete display-block windows: \`fs(action="read", path="/Notebook/Folder/Doc")\`; continue with the returned \`nextWindow\` or pass \`blockStart\`/\`blockLimit\`/\`tokenBudget\`. Character \`page/pageSize\` pagination is not supported.
- Create or overwrite a document body: \`fs(action="write", path="/Notebook/Folder/Doc", markdown="...", overwrite=true)\`
- Replace exact text in one document: \`fs(action="replace", path="/Notebook/Folder/Doc", edit={ old: "...", new: "..." })\`
- Search Markdown under a path: \`fs(action="search", path="/Notebook/Folder", query="...")\`
- Reorder all visible direct children: first list the parent, then call \`fs(action="reorder", path="/Notebook/Folder", orderedPaths=["/Notebook/Folder/First", "/Notebook/Folder/Second"])\` with every child path exactly once. This enables custom sorting for the notebook.
- Delete, move, or rename by path: \`fs(action="rm", path="/Notebook/Folder/Doc")\`, \`fs(action="mv", from="/Notebook/Old", to="/Notebook/New")\` after explicit confirmation.

\`fs\` paths are human-readable workspace paths and \`fs\` hides notebook IDs, block IDs, and storage paths. Prefer \`fs\` for basic browse/read/write/edit/search/move/delete workflows. Use the lower-level \`document\`, \`block\`, \`search\`, and \`av\` tools only when you need SiYuan-specific block layout, metadata, SQL, backlinks, assets, database operations, or direct block IDs.

\`fs\` is a Markdown-oriented convenience layer. It converts document content through Markdown and Kramdown for reading and writing, so it is not a full-fidelity editor for complex SiYuan-native structures. Use it for ordinary prose, headings, lists, simple tables, exact paragraph/heading text replacement, and path-based file workflows. Prefer lower-level tools when the task involves precise block tree structure, block attributes, embeds, media, query embeds, database rows and cells, flashcard deck bindings, or other native structures that are not naturally represented as Markdown.

The document tool uses exactly two path types. Do not mix them.

| Type | Used by | Example | Notebook name? |
|------|---------|---------|----------------|
| Human-readable (notebook-local) | document(action="create"), document(action="lookup", hpath=...) | /Folder/Weekly Note | MUST NOT include notebook name; notebook is passed separately |
| Storage path | document(action="rename"), remove, move, lookup (with notebook+path) | /20240318112233-abc123.sy | n/a (returned by lookup) |

Safe workflow: call document(action="lookup", id=..., include=["path"]) first, then reuse the returned storage path.

WRONG: document(action="create", notebook="<id>", path="/NotebookName/Folder/Weekly Note", title="New Title") — this will create an extra folder named after the notebook, because path is notebook-local and MUST NOT include the notebook name.
WRONG: document(action="rename", notebook="...", path="/Folder/Weekly Note", title="New Title") — this will fail because rename expects a storage path, not a human-readable path.
CORRECT: document(action="create", notebook="<id>", path="/Folder/Weekly Note")
CORRECT: document(action=”rename”, notebook=”...”, path=”/20240318112233-abc123.sy”, title=”New Title”)

## High-risk operations confirmation

Before calling any of the following actions, you MUST clearly describe the action to the user and wait for explicit confirmation. Do not call them without user confirmation.

**Actions that require confirmation:**
${dangerousActionsList}
- \`file(action=”export_resources”, outputPath=...)\`

Flow: State “I will do X. Proceed?” and only call the tool after the user explicitly agrees.

Additional rules:
- file(action=”upload_asset”) reads a local file path and uploads it into SiYuan assets. Treat this as high-risk.
- If file(action=”upload_asset”) targets a file larger than the configured large-upload threshold (10 MB by default), you MUST stop, tell the user, and only retry after explicit confirmation using confirmLargeFile=true.
- file(action=”export_resources”) without outputPath only generates a ZIP in SiYuan's managed temp area.
- file(action=”export_resources”, outputPath=...) writes to the local filesystem and MUST be treated as high-risk.

## Block insertion semantics

- block(action=”prepend”) with a document ID inserts at the start of the document.
- block(action=”append”) with a document ID inserts at the end of the document.
- With a block ID, prepend/append operate on that block's child list.
- block(action=”update”) is best for single-block replacement. Multi-line markdown may be truncated to the first line by SiYuan; use block(action=”append”), prepend, or insert when you need multiple blocks, tables, or longer multi-line content.
- block(action=”replace”) searches only the kramdown of the single block identified by id. It does not include child blocks, sibling blocks, heading sections, or the whole document. Read block(action=”get_kramdown”) first and copy an exact old snippet from that result; use fs(action=”replace”) for document-level exact replacement.

## Tag creation semantics

- There is no direct create action for tags.
- To create a real SiYuan tag in block markdown, use #tag# with both leading and trailing # characters. Hierarchical: #project/phase#.
- Example: block(action=”update”, dataType=”markdown”, data=”#holiday# #home#”)
- To add tags, write #tag# through fs.write, fs.replace, document.create, block.append/insert/prepend/update, or block.replace.
- To rename tags globally, use tag(action=”rename”, oldLabel=..., newLabel=...).
- To delete a tag globally, use tag(action=”remove”, label=...) only after explicit user confirmation.
- To modify one occurrence, use fs.replace or block.replace on the exact markdown text, replacing #old# with #new# or with plain text. Verify with tag(action=”list”, query=...) because tag indexing can lag briefly.

## Double-link / block reference semantics

- To create a real SiYuan block reference in markdown, use ((block-id 'anchor text')) or ((block-id "anchor text")) with a real target block ID and readable anchor text.
- Naked ((id)) references are allowed and normalized before writing. If anchor lookup fails, MCP falls back to ((id 'id')) with a warning; pass ((id 'anchor text')) when readable anchor text matters. Footnotes like [^1] and [text](siyuan://blocks/id) are allowed, but they do not create SiYuan backlinks; successful writes include hints for those cases.
- To read references, use fs.read/document.get_doc for markdown content, block(action=”get_kramdown”) for exact block content, search(action=”get_backlinks”|"search_refs") for inbound references, and search(action=”list_invalid_refs”) to audit broken references.
- To add references, write the ((id 'anchor text')) token through document.create, fs.write, fs.replace, block.append/insert/prepend/update, or block.replace.
- To update a reference anchor or target inside existing text, prefer fs.replace or block.replace using an exact snippet copied from fs.read or block.get_kramdown.
- To delete a reference occurrence, replace the full ((id 'anchor text')) token with plain text or an empty string through fs.replace/block.replace. Deleting the target block itself is a separate high-risk block/document delete operation.

## Attribute view / database semantics

- Real SiYuan databases are attribute views (AVs) stored as database blocks with type av / NodeAttributeView placeholders. A Markdown table is not a real database.
- fs.read and block.get_kramdown can show an AV block as an HTML placeholder. That placeholder is only the database block container, not the database rows, columns, filters, or cells.
- If a tool result includes attributeViews, databaseBlock, or avToolHint, switch to the av tool for internal database reads and writes.
- To create/materialize a database, use av(action=”render”, blockID=..., createIfNotExist=true). MCP can generate the AV ID when omitted.
- To read database internals, use av(action=”get”, id=...) for the full payload or av(action=”render”, id=..., blockID=...) when a specific rendered block view is needed. In the av tool, get/render use id for the attribute view ID, while write actions such as add_rows, set_cells, remove_rows, add_column, and remove_column use avID.
- To add rows, use av(action=”add_rows”, avID=..., blockIDs=[...]) for bound rows or primaryKeyTexts=[...] for detached rows, then use av(action=”set_cells”) for non-primary-key values.
- To update cells, use av(action=”set_cells”, avID=..., cells=[{rowID, columnID, valueType, ...}]). rowID is the AV row item ID stored in value.blockID or returned by add_rows, not the cell value id and not necessarily the bound source block id.
- To delete rows or columns, use av(action=”remove_rows”, avID=..., srcIDs=[...]) or av(action=”remove_column”, avID=..., keyID=...). To delete the entire visible database block container, use block.delete only after explicit confirmation.
- Do not use fs.write overwrite, block.update, or block.replace to edit AV rows/cells. Those operations can replace or delete the database block container but cannot safely edit the database internals.

## Flashcard semantics

- To turn a block into a flashcard, prefer flashcard(action=”create_card”), which writes “custom-riff-decks” and registers the riff card together.
- block(action=”set_attrs”) with “custom-riff-decks” only writes the metadata binding and is not the full “make flashcard” workflow by itself.
- Common pattern: h2 heading as the question, following blocks as the answer.
- Cloze: \`==answer==\` is treated as a cloze answer in flashcard review.
- For scheduled review and deck operations, prefer the dedicated \`flashcard\` tool.
- To read decks, use flashcard(action=”get_decks”). To list due cards, use flashcard(action=”list_cards”, scope=”all”|"deck"|"notebook"|"tree", filter=”due”|"new"|"old"). To audit all cards in a deck, use flashcard(action=”get_cards”, deckID=..., page=..., pageSize=...).
- To add cards, create or locate the intended content block IDs first, then call flashcard(action=”create_card”, deckID=..., blockIDs=[...]). Document block IDs are rejected; pass content blocks such as headings or paragraphs.
- To review cards, call flashcard(action=”review_card”, deckID=..., cardID=..., rating=1..4) or skip=true. Use a concrete deckID from get_cards/list_cards; an empty deckID is not valid for review.
- To remove cards from a deck, use flashcard(action=”remove_card”, deckID=..., blockIDs=[...]) only after explicit user confirmation. Removing a flashcard binding is separate from deleting the underlying note blocks.

## SiYuan layout model (summary)

When the user asks for polished SiYuan content, consider native layout features instead of plain paragraphs:
1. Start with headings, paragraphs, lists, task lists, blockquotes, callouts, tables, math blocks, and code blocks.
2. When the user asks for a diary entry, journal, daily log, or today’s note in a notebook, prefer \`document(action="create_daily_note")\` instead of manually creating a dated path and then appending content.
3. For side-by-side comparison, cards, or dashboards, use Kramdown super blocks (\`{{{col\` / \`{{{row\`).
4. For metadata, workflow markers, or styling, use block attributes (\`name\`, \`alias\`, \`memo\`, \`bookmark\`, \`custom-*\`, \`style\`).
5. For diagrams, charts, mind maps, use renderer code blocks (\`mindmap\`, \`mermaid\`, \`flowchart\`, \`graphviz\`, \`plantuml\`, \`echarts\`, \`abc\`).
6. For playback, embeds, dynamic queries, or structured records, use \`video\`, \`audio\`, \`iframe\`, \`html\`, \`query_embed\`, or database blocks \`av\`.
7. For real database operations, prefer the dedicated \`av\` tool instead of describing an \`av\` block abstractly.

Critical anti-patterns — do NOT:
- Use \`::: row\`, raw HTML \`<div>\`, or \`===\` separators as super block substitutes.
- Confuse Markdown tables with database blocks, or bookmarks (block attributes) with tags (inline markdown).
- Fake database blocks with Markdown tables when a real \`av\` workflow is required.
- Claim that a real \`av\` block exists after only initializing AV metadata without materializing the NodeAttributeView block into the document tree.

For the full layout guide with formatting inventory, distinctions, and daily heuristics, read siyuan://help/ai-layout-guide or call any tool with action=”help”.

## Usage semantics

- Bookmarks🔖: Collect existing blocks through block attributes; do not use bookmarks as inline tags.
- Tags🏷️: Use inline markdown tokens such as \`#tag#\`; do not use tags as block-level bookmarks.
- Flashcards🧠: Treat flashcards as review semantics, not layout; choose layout and flashcard marking independently.
- MCP✍️: Prefer creating final content directly instead of describing UI-only steps such as \`/AI 编写\`.
${userRulesReminder}
`;
}
