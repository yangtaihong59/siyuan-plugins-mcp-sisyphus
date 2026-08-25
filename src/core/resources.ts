import { formatDangerousActionsList, isDangerousAction, type ToolCategory } from './config';
import {
    ACTION_RESOURCE_TEMPLATE_URI,
    ACTIONS_BY_CATEGORY,
    AI_LAYOUT_GUIDE_RESOURCE_URI,
    CHANGELOG_RESOURCE_URI,
    DOCUMENT_PATH_RESOURCE_URI,
    EXAMPLES_RESOURCE_URI,
    TOOL_ACTION_HINTS,
    TOOL_GUIDANCE_BY_CATEGORY,
    TOOL_OVERVIEW_RESOURCE_URI,
    USER_RULES_RESOURCE_URI,
    isKnownAction,
    isKnownToolCategory,
} from './help';
import { renderChangelogResource } from './changelog';
import {
    AV_VARIANTS,
    BLOCK_VARIANTS,
    DOCUMENT_VARIANTS,
    EXTENSION_VARIANTS,
    FEEDBACK_VARIANTS,
    FILE_VARIANTS,
    FLASHCARD_VARIANTS,
    FS_VARIANTS,
    MASCOT_VARIANTS,
    NOTEBOOK_VARIANTS,
    SEARCH_VARIANTS,
    SYSTEM_VARIANTS,
    TAG_VARIANTS,
    TIMELINE_VARIANTS,
} from '@/tools/index';
import type { ActionVariant } from '@/tools/internal/shared';
import { buildActionExamplesMarkdown, buildShapeSummaryMarkdown } from '@/tools/internal/help-render';
import {
    MCP_SKILLS,
    SKILL_INDEX_URI,
    SKILL_RESOURCE_TEMPLATE_URI,
    getMcpSkill,
    renderMcpSkillIndex,
} from './skills';


interface HelpResourceDefinition {
    uri: string;
    name: string;
    title: string;
    description: string;
    mimeType: string;
    text: string;
}

interface HelpResourceDescriptor {
    uri: string;
    name: string;
    title: string;
    description: string;
    mimeType: string;
}

const MIME_TYPE = 'text/markdown';

const VARIANTS_BY_CATEGORY: Record<ToolCategory, ActionVariant<string>[]> = {
    fs: FS_VARIANTS,
    notebook: NOTEBOOK_VARIANTS,
    document: DOCUMENT_VARIANTS,
    block: BLOCK_VARIANTS,
    av: AV_VARIANTS,
    file: FILE_VARIANTS,
    search: SEARCH_VARIANTS,
    tag: TAG_VARIANTS,
    timeline: TIMELINE_VARIANTS,
    system: SYSTEM_VARIANTS,
    flashcard: FLASHCARD_VARIANTS,
    extension: EXTENSION_VARIANTS,
    mascot: MASCOT_VARIANTS,
    feedback: FEEDBACK_VARIANTS,
};

function formatJsonExample(value: unknown): string {
    return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

function buildActionExamples(tool: ToolCategory, action: string): string[] {
    return buildActionExamplesMarkdown(VARIANTS_BY_CATEGORY[tool], action, tool);
}

function buildShapeSummary(tool: ToolCategory, action: string): string[] {
    return buildShapeSummaryMarkdown(VARIANTS_BY_CATEGORY[tool], action);
}

function renderToolOverview(): string {
    const sections = (Object.keys(ACTIONS_BY_CATEGORY) as ToolCategory[]).map((tool) => {
        const actions = ACTIONS_BY_CATEGORY[tool].join(', ');
        const guidance = TOOL_GUIDANCE_BY_CATEGORY[tool].map((line) => `- ${line}`).join('\n');
        return `## \`${tool}\`\n\nEnabled action family: \`${actions}\`\n\n${guidance}`;
    }).join('\n\n');

    return [
        '# SiYuan MCP Tool Overview',
        '',
        'This server exposes 14 aggregated tools. Use `fs` first for basic path-style notebook and document operations; advanced tools remain available for SiYuan-specific workflows.',
        '',
        '## High-risk actions',
        '',
        ...formatDangerousActionsList(),
        '',
        'Call these only after explicit user confirmation.',
        '- Large local uploads above 10 MB must stop first and be retried only after user confirmation with `confirmLargeFile=true`.',
        '',
        sections,
        '',
        '## More help',
        '',
        '- Basic path operations: prefer `fs(action="ls"|"tree"|"read"|"write"|"replace"|"search"|"rm"|"mv"|"reorder")` with human-readable paths before using lower-level document/block/search tools.',
        '- Tag creation: write tags into block markdown as `#tag#` so `tag(action="list")` can discover them.',
        '- Flashcards: prefer `flashcard(action="create_card")` to turn existing blocks into real flashcards; it writes `custom-riff-decks` and registers the riff card together.',
        '- Review flow: use `flashcard(action="list_cards")` plus `review_card` / `review_card(skip=true)` for scheduled flashcard study.',
        '- Mascot earnings: every successful MCP tool call earns 1 coin. To earn balance quickly, keep using SiYuan MCP tools, then check `mascot(action="get_balance")` or spend with `mascot(action="buy")`.',
        '- Feedback: use `feedback(action="submit")` to send plain-text product feedback to the plugin developer. Avoid secrets and private note content.',
        '- AI layout guide: use the layout guide when you need to decide whether content should become headings, callouts, tables, super blocks, visual code blocks, embeds, media blocks, or database blocks.',
        '- Upgrade review: read the changelog after plugin upgrades, then compare personalization-impact hints with active user rules and `/AGENTS.md` before changing persistent preferences.',
        '',
        `- AI layout guide: \`${AI_LAYOUT_GUIDE_RESOURCE_URI}\``,
        `- Active user custom rules: \`${USER_RULES_RESOURCE_URI}\``,
        `- Plugin changelog: \`${CHANGELOG_RESOURCE_URI}\``,
        `- Path semantics: \`${DOCUMENT_PATH_RESOURCE_URI}\``,
        `- Common examples: \`${EXAMPLES_RESOURCE_URI}\``,
        `- Per-action help template: \`${ACTION_RESOURCE_TEMPLATE_URI}\``,
    ].join('\n');
}

export function renderUserRulesResource(userRulesText = ''): string {
    const rules = typeof userRulesText === 'string'
        ? userRulesText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
        : [];

    return [
        '# Active User Custom Rules',
        '',
        rules.length > 0
            ? 'These rules are currently configured for this MCP server.'
            : 'No user custom rules are currently configured.',
        '',
        '## Rule list',
        '',
        ...(rules.length > 0 ? rules.map((line) => `- ${line}`) : ['- None']),
        '',
        '## Priority',
        '',
        '- Apply these rules before choosing tools or generating SiYuan content.',
        '- These rules are a higher-priority preference layer than general usage suggestions.',
        '- These rules do not override safety confirmation requirements, notebook permissions, disabled tools, or disabled actions.',
        '- If these rules changed after the current MCP session initialized, reconnect the client or restart the MCP HTTP server so initialize-time instructions are refreshed.',
    ].join('\n');
}

function renderDocumentPathSemantics(): string {
    return [
        '# Document Path Semantics',
        '',
        '## fs workspace path',
        '',
        '- Used by `fs` actions such as `read`, `write`, `replace`, `search`, `mv`, and `rm`.',
        '- Prefer a canonical path that includes the notebook name, such as `/Notebook/Folder/Weekly Note`, so resolution is unambiguous.',
        '- A notebook-omitted path such as `/Folder/Weekly Note` is accepted only when it uniquely matches across readable notebooks.',
        '- Root-level creation cannot infer a notebook and therefore requires `/Notebook/Title`.',
        '',
        '## Human-readable path (notebook-local)',
        '',
        '- Used by `document(action="create")` and `document(action="lookup", hpath=...)`.',
        '- It is RELATIVE TO THE NOTEBOOK ROOT and MUST NOT include the notebook name.',
        '- Example: `/Folder/Weekly Note` (NOT `/NotebookName/Folder/Weekly Note`).',
        '- The notebook is supplied separately via the `notebook` parameter (notebook ID).',
        '',
        '## Storage path',
        '',
        '- Used by `document(action="rename")`, `document(action="remove")`, `document(action="move")`, and `document(action="lookup", path=...)` when you pass `notebook + path`.',
        '- Obtain it from `document(action="lookup", id=..., include=["path"])` first.',
        '- Example: `/20240318112233-abc123.sy`',
        '- For path-based `document(action="move")`, `toPath` must point to an existing destination document.',
        '',
        '## Safe calling order',
        '',
        '1. Call `document(action="lookup", id=..., include=["path"])`.',
        '2. Reuse the returned storage path for path-based `rename`, `remove`, `move`, or `lookup`.',
        '3. Do not pass a human-readable path into those path-based actions.',
        '',
        '## Common mistake',
        '',
        '- `document(action="create")` accepts a notebook-local path like `/Folder/Weekly Note` and MUST NOT include the notebook name.',
        '- `document(action="rename", notebook=..., path=...)` expects a storage path like `/20240318112233-abc123.sy`.',
        '- `document(action="move", fromPaths=..., toNotebook=..., toPath=...)` does not accept a non-existent `.sy` path or a plain directory-like path as the destination.',
    ].join('\n');
}

function renderExamples(): string {
    return [
        '# Common MCP Examples',
        '',
        '## Create a document',
        '',
        buildActionExamples('document', 'create')[0],
        '',
        '## Set a cover from a direct URL',
        '',
        formatJsonExample({
            action: 'set_attr',
            id: '20240318112233-abc123',
            source: 'https://images.example.com/cover.jpg',
        }),
        '',
        '## Upload a local file, then use it as a cover',
        '',
        formatJsonExample({
            action: 'upload_asset',
            assetsDirPath: '/assets/',
            localFilePath: './tmp/cover.jpg',
        }),
        '',
        '## Retry a large upload only after user confirmation',
        '',
        formatJsonExample({
            action: 'upload_asset',
            assetsDirPath: '/assets/',
            localFilePath: './tmp/very-large-cover.jpg',
            confirmLargeFile: true,
        }),
        '',
        formatJsonExample({
            action: 'set_attr',
            id: '20240318112233-abc123',
            source: '/assets/cover.jpg',
        }),
        '',
        '## Move documents by ID',
        '',
        buildActionExamples('document', 'move')[1] ?? buildActionExamples('document', 'move')[0],
        '',
        '## Append a block to a document',
        '',
        buildActionExamples('block', 'append')[0],
        '',
        '## Get the SiYuan version',
        '',
        buildActionExamples('system', 'get_version')[0],
        '',
        '## Create tags via block markdown',
        '',
        formatJsonExample({
            action: 'update',
            id: '20240318112233-abc123',
            dataType: 'markdown',
            data: '#holiday# #home# #relax#',
        }),
        '',
        '## Turn a block into a flashcard',
        '',
        buildActionExamples('flashcard', 'create_card')[0],
        '',
        'Low-level fallback: write only the flashcard deck attribute',
        '',
        formatJsonExample({
            action: 'set_attrs',
            id: '20240318112233-abc123',
            attrs: {
                'custom-riff-decks': '20230218211946-2kw8jgx',
            },
        }),
        '',
        'A common pattern is to use an `h2` heading as the question block and keep the following blocks as the answer.',
        '',
        '## Full-text search',
        '',
        buildActionExamples('search', 'fulltext')[0],
        '',
        '## SQL query',
        '',
        buildActionExamples('search', 'query_sql')[0],
    ].join('\n');
}

function renderAiLayoutGuide(): string {
    return [
        '# AI Layout Guide for SiYuan',
        '',
        'Use this guide when you need to turn user intent into a well-structured SiYuan note rather than plain text.',
        '',
        '## Decision order',
        '',
        '1. Start with normal structure blocks first: headings, paragraphs, lists, task lists, blockquotes, callouts, tables, math blocks, and fenced code blocks.',
        '2. Escalate to Kramdown super blocks only when the user needs side-by-side comparison, cards, or dashboard-like layouts.',
        '3. Use block attributes only for metadata or styling, not for structural layout.',
        '4. Use renderer code-block languages when the user wants visual output such as diagrams, charts, mind maps, or music notation.',
        '5. Use media, embeds, HTML, or database blocks only when the user benefits from embedded playback, live views, or structured records.',
        '6. Prefer native SiYuan structures over plain paragraphs whenever they improve readability.',
        '7. Do not confuse layout, metadata, rendering, and database layers.',
        '',
        '## Native structure blocks',
        '',
        '- Headings, paragraphs, unordered lists, ordered lists, task lists, blockquotes, callouts, tables, math blocks, and fenced code blocks are the default safe building blocks.',
        '- Callouts come from Markdown like `> [!TIP]` or `> [!IMPORTANT]` and are stored as `type = "callout"`.',
        '- Common callout markers are `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`.',
        '- Use headings plus lists for most note-taking tasks; this is the default layout baseline.',
        '- Use tables for lightweight structured display. A Markdown table is not the same thing as a real SiYuan database block.',
        '- Tags belong in block markdown as `#tag#`; hierarchical tags use forms such as `#project/phase#`.',
        '',
        '## Formatting elements inventory',
        '',
        '- Inline elements include links, images, bold, italic, underline, strikethrough, highlight, superscript, subscript, `kbd`, inline code, inline math, inline remarks, tags, IAL-based color/effect spans, and emoji.',
        '- Block elements include headings, paragraphs, unordered lists, ordered lists, task lists, blockquotes, callouts, code blocks, tables, HTML blocks, thematic breaks, math blocks, iframe, video, audio, super blocks, and query embeds.',
        '- Renderable code blocks include `mindmap`, `flowchart`, Mermaid `graph`, Mermaid `sequenceDiagram`, Mermaid `gantt`, Mermaid `classDiagram`, Mermaid `journey`, Mermaid `gitGraph`, Mermaid `erDiagram`, `echarts`, `abc`, `graphviz`, and `plantuml`.',
        '- Treat the inventory as a menu of native expression choices, not as a requirement to flatten everything into paragraphs.',
        '',
        '## Kramdown layout',
        '',
        '- Super blocks are real SiYuan blocks with `type = "s"`.',
        '- Horizontal and nested layouts come from nested Kramdown blocks such as `{{{col` and `{{{row`.',
        '- Use super blocks for side-by-side comparison, card grids, split summaries, pros/cons, and dashboard-like sections.',
        '- Super block layout comes from Kramdown, not from block attributes.',
        '- For a horizontal multi-column layout, use an outer `{{{col` and put one child `{{{row` block per column.',
        '- For vertical stacking inside one column, place multiple blocks inside that column\'s child `{{{row`.',
        '- There is no separator-based super block syntax; `===` inside a super block is not a column delimiter.',
        '',
        '### Correct syntax shortcuts',
        '',
        '- Super blocks: use nested `{{{col` and `{{{row` blocks with matching `}}}`. Do not use `::: row`, HTML `<div>`, or `===` as a super block substitute or delimiter.',
        '- Pattern: horizontal columns usually mean outer `{{{col` + one child `{{{row` per column.',
        '- Pattern: each child `{{{row` can contain multiple ordinary blocks stacked vertically.',
        '- Colors: prefer inline attribute lists such as `**text**{: style="color: var(--b3-font-color1);"}` or `**text**{: style="color: var(--b3-font-color1); background-color: var(--b3-font-background1);"}`.',
        '- Callouts: use Markdown like `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!IMPORTANT]`, and `> [!CAUTION]`.',
        '- Remarks: use inline HTML like `<sup>note</sup>` only for small annotations, not for main layout.',
        '',
        '## Block attributes',
        '',
        '- Use block attributes for metadata or style enhancement, not for super block layout.',
        '- Built-in attributes include `name`, `alias`, `memo`, and `bookmark`.',
        '- Custom metadata uses the `custom-*` prefix, for example `custom-status` or `custom-priority`.',
        '- Visual tweaks can use the `style` attribute, for example text alignment or bold styling.',
        '- Inline color and effect samples can also be expressed with inline attribute lists such as `{: style="color: ...; background-color: ...;"}`.',
        '',
        '## Visual code blocks',
        '',
        '- Some rich renderers are still stored as normal code blocks (`type = "c"`). The renderer is chosen by the fenced code language.',
        '- `mindmap`: mind maps.',
        '- `mermaid`: Mermaid diagrams including flow charts (`graph`), sequence diagrams (`sequenceDiagram`), gantt charts (`gantt`), class diagrams (`classDiagram`), Git graphs (`gitGraph`), ER diagrams (`erDiagram`), and journey diagrams (`journey`).',
        '- `flowchart`: Flowchart.js syntax.',
        '- `graphviz`: Graphviz syntax.',
        '- `plantuml`: PlantUML syntax.',
        '- `echarts`: ECharts config blocks; JSON, JavaScript object literals, and IIFE-returned objects are all valid patterns.',
        '- `abc`: abcjs music notation; `%%params ...` may appear at the top.',
        '- Treat these as renderable note structures, not as ordinary code examples, when the user wants visual output.',
        '',
        '## Media, HTML, embeds, and databases',
        '',
        '- Video, audio, iframe, and HTML are distinct rich blocks, not ordinary code fences.',
        '- Their block content is usually stored as HTML tags such as `<video>`, `<audio>`, `<iframe>`, or raw HTML fragments.',
        '- Query embeds use `{{ select ... }}` and are stored as `type = "query_embed"`.',
        '- Use query embeds for dynamic rollups, filtered views, and auto-updating reference sections.',
        '- Unless the user explicitly wants self-referential results, query embeds should exclude the current root document, for example with `root_id != "<current-doc-id>"`.',
        '- Real SiYuan database blocks use `type = "av"` and are stored as `NodeAttributeView` containers such as `<div data-type="NodeAttributeView" ...></div>`.',
        '- Databases support records, multiple views, filters, sorts, relations, and rollups; they are not just prettier tables.',
        '- Do not describe a Markdown table as a database block, and do not describe a database block as just a table.',
        '- The dedicated MCP `av` tool can create and materialize a new database with `render(createIfNotExist=true, blockID=...)`; omit `id` to let MCP generate the AV ID automatically.',
        '',
        '## Recommended usage rules',
        '',
        '- For ordinary summaries and notes, default to headings, lists, callouts, tables, code blocks, and math blocks.',
        '- For side-by-side comparisons or card-like layouts, actively consider super blocks.',
        '- For status, naming, aliases, bookmarks, or custom workflow data, actively consider block attributes.',
        '- For diagrams, timelines, Git history, entity relationships, journeys, charts, mind maps, and music notation, actively consider renderable code-block languages instead of plain text.',
        '- Choose the renderer language by diagram intent, not by “any renderable block is fine”: `graph` or `flowchart` for flow, `sequenceDiagram` for interactions, `gantt` for schedules, `classDiagram` for type relations, `journey` for user paths, `gitGraph` for commit history, and `erDiagram` for entities and relations.',
        '- For media playback or external embeds, use media or iframe blocks only when the user clearly benefits from embedded playback or live preview.',
        '- For structured records with real views and field semantics, use database blocks; for lightweight display only, use Markdown tables.',
        '- For “collect”, “favorite”, or “save for later” semantics on an existing block, consider the `bookmark` attribute rather than inventing a tag.',
        '- For flashcards, prefer `flashcard(action="create_card")`; raw block attributes such as `custom-riff-decks` are only the metadata half of the workflow.',
        '',
        '## Common daily formatting decisions',
        '',
        '- When the user asks for a diary entry, journal, daily log, or today’s note in a notebook, prefer `document(action="create_daily_note")` over manually creating a path and then appending content.',
        '- When the user is organizing notes, summaries, meeting minutes, or plans, prefer headings, paragraphs, lists, task lists, tables, and callouts over one long paragraph.',
        '- When the user wants comparison, side-by-side information, cards, dashboards, pros/cons, or parallel summaries, actively consider super blocks instead of forcing everything into plain lists or tables.',
        '- When the user wants reminders, warnings, key conclusions, tips, or highlighted takeaways, actively consider callouts instead of plain blockquotes or bold-only paragraphs.',
        '- When the user wants flow, sequence, timeline, project scheduling, class relations, Git evolution, metrics trends, mind maps, or music notation, actively consider the corresponding renderer code-block language instead of ordinary code samples.',
        '- When the user wants lightweight field display, use Markdown tables; when the user wants structured records, multiple views, filters, relations, or rollups, use database blocks instead.',
        '- When the user wants categorization, topic labels, or future retrieval, actively consider tags written in markdown.',
        '- When the user wants collect, favorite, or save-for-later semantics on an existing block, actively consider the `bookmark` attribute instead of inventing a tag.',
        '- When the user wants review, memorization, Q&A, or cloze-style learning, actively consider flashcard semantics, but keep flashcards separate from layout choice.',
        '- In normal day-to-day use, choose the simplest native SiYuan structure that matches the user intent while preserving the correct semantics.',
        '',
        '## Example everyday mappings',
        '',
        '- Daily note or diary: use `document(action="create_daily_note")` for the notebook first, then write content into that returned document.',
        '- Meeting notes: headings for agenda, lists for points, task lists for follow-ups, and callouts for decisions or risks.',
        '- Project comparison: super blocks for side-by-side sections, tables for quick field comparison, and callouts for conclusions.',
        '- Knowledge cards: headings for the topic, concise bullet points, small remarks where needed, and tags for retrieval.',
        '- Data tracking: database blocks for structured records and multiple views; Markdown tables only for lightweight display.',
        '- Personal curation: tags for categorization, bookmarks for collecting existing blocks worth revisiting later.',
        '',
        '## Usage semantics from the official guide',
        '',
        '- Bookmarks are for collecting existing blocks and are exposed in SiYuan as a block-level saved item concept.',
        '- Tags are inline markdown tokens such as `#tag#`; hierarchical tags use forms such as `#A/B/C#`.',
        '- Avoid special-symbol-heavy bookmark or tag names when searchability and global management matter.',
        '- Flashcards are scheduled-review artifacts; creating a good note layout and marking a flashcard are separate steps.',
        '- SiYuan flashcard interpretation rules include: marked text `==answer==` as a cloze answer, a super block with the first child as the question, a heading with following blocks as the answer, and a list or list item with child lists treated as the answer area.',
        '- Through MCP, prefer producing final note content or block attributes directly instead of narrating UI-only steps unless the user explicitly asks how to use the built-in SiYuan interface.',
        '- If the user asks how SiYuan built-in AI works, explain that the official entry is the AI settings page plus commands such as `/AI 编写` or block-menu AI actions, and note that related text may be sent to an external model service.',
        '',
        '## Confusion pairs',
        '',
        '- A blockquote is not a block reference.',
        '- A query embed is not a static block list or an ordinary reference.',
        '- Raw HTML `<div>` is not a super block substitute.',
        '- `===` is not a super block column delimiter.',
        '- A Markdown table is not a real `av` database block.',
        '- A bookmark is not a tag.',
        '- A flashcard is not a layout type.',
        '',
        '## Anti-confusion rules',
        '',
        '- `::: row` is not valid SiYuan super block syntax.',
        '- Raw HTML `<div>` is not a substitute for super blocks.',
        '- `===` inside a super block is parsed as a separate element rather than a column delimiter.',
        '- Inline `<span style="color: ...">` is not the preferred color-marking pattern when `{: style="..."}` can express the same intent.',
        '- Super block layout is defined by Kramdown, not block attributes.',
        '- Database blocks are `type = "av"`, not Markdown tables.',
        '- Mermaid, Flowchart, Graphviz, PlantUML, ECharts, ABC, and mindmap are renderer languages attached to code blocks.',
        '- Video, audio, iframe, and HTML blocks are richer than plain paragraphs or code fences and should be chosen intentionally.',
        '- Tags are literal markdown tokens like `#tag#`, not block attributes.',
        '- Bookmarks are block attributes, not inline tags.',
        '- Flashcards are not a layout type; they are review semantics attached to blocks.',
    ].join('\n');
}

function renderActionHelp(tool: ToolCategory, action: string): string {
    const actionVariants = VARIANTS_BY_CATEGORY[tool].filter((variant) => variant.action === action);
    const firstDescription = actionVariants
        .map((variant) => typeof variant.schema.description === 'string' ? variant.schema.description : '')
        .find(Boolean);
    const hint = TOOL_ACTION_HINTS[tool]?.[action];
    const shapes = buildShapeSummary(tool, action).join('\n');
    const examples = buildActionExamples(tool, action).join('\n\n');
    const confirmationNote = isDangerousAction(tool, action)
        ? 'This action requires explicit user confirmation before execution.'
        : null;

    return [
        `# ${tool}(action="${action}")`,
        '',
        firstDescription || 'Grouped MCP action help.',
        '',
        '## Valid shapes',
        '',
        shapes,
        '',
        '## Guidance',
        '',
        ...(TOOL_GUIDANCE_BY_CATEGORY[tool].map((line) => `- ${line}`)),
        ...(hint ? [`- ${hint}`] : []),
        ...(confirmationNote ? [`- ${confirmationNote}`] : []),
        '',
        '## Minimal examples',
        '',
        examples,
    ].join('\n');
}

function buildStaticHelpResources(): HelpResourceDefinition[] {
    return [
        {
            uri: TOOL_OVERVIEW_RESOURCE_URI,
            name: 'tool-overview',
            title: 'SiYuan MCP Tool Overview',
            description: 'Overview of grouped tools, path semantics, and confirmation rules.',
            mimeType: MIME_TYPE,
            text: renderToolOverview(),
        },
        {
            uri: DOCUMENT_PATH_RESOURCE_URI,
            name: 'document-path-semantics',
            title: 'Document Path Semantics',
            description: 'Explains human-readable paths versus storage paths for document actions.',
            mimeType: MIME_TYPE,
            text: renderDocumentPathSemantics(),
        },
        {
            uri: EXAMPLES_RESOURCE_URI,
            name: 'examples',
            title: 'Common MCP Examples',
            description: 'Minimal example calls for common notebook, document, block, file, and search actions.',
            mimeType: MIME_TYPE,
            text: renderExamples(),
        },
        {
            uri: AI_LAYOUT_GUIDE_RESOURCE_URI,
            name: 'ai-layout-guide',
            title: 'AI Layout Guide for SiYuan',
            description: 'Explains how SiYuan layout features map to native blocks, Kramdown, attributes, renderer code blocks, media blocks, embeds, and databases.',
            mimeType: MIME_TYPE,
            text: renderAiLayoutGuide(),
        },
        {
            uri: CHANGELOG_RESOURCE_URI,
            name: 'changelog',
            title: 'SiYuan MCP Sisyphus Changelog',
            description: 'Bundled plugin changelog plus an AI upgrade-review workflow for personalization-impact checks.',
            mimeType: MIME_TYPE,
            text: renderChangelogResource(),
        },
    ];
}

const USER_RULES_RESOURCE_DESCRIPTOR: HelpResourceDescriptor = {
    uri: USER_RULES_RESOURCE_URI,
    name: 'user-rules',
    title: 'Active User Custom Rules',
    description: 'Shows the currently configured user custom rules and their priority limits.',
    mimeType: MIME_TYPE,
};

let staticHelpCache: HelpResourceDefinition[] | undefined;
function getStaticHelpResources(): HelpResourceDefinition[] {
    return (staticHelpCache ??= buildStaticHelpResources());
}

export function listHelpResources() {
    return [
        ...getStaticHelpResources().map(({ text: _text, ...resource }) => resource),
        USER_RULES_RESOURCE_DESCRIPTOR,
        {
            uri: SKILL_INDEX_URI,
            name: 'siyuan-mcp-skill-index',
            title: 'SiYuan MCP Skill Index',
            description: 'Routes tasks to scenario-oriented SiYuan MCP skills.',
            mimeType: MIME_TYPE,
        },
        ...MCP_SKILLS.map((skill) => ({
            uri: `siyuan://skills/${skill.name}`,
            name: skill.name,
            title: skill.title,
            description: skill.description,
            mimeType: MIME_TYPE,
        })),
    ];
}

export function listHelpResourceTemplates() {
    return [
        {
            uriTemplate: ACTION_RESOURCE_TEMPLATE_URI,
            name: 'action-help',
            title: 'Per-action MCP Help',
            description: 'Returns valid shapes, guidance, and minimal examples for a specific tool action.',
            mimeType: MIME_TYPE,
        },
        {
            uriTemplate: SKILL_RESOURCE_TEMPLATE_URI,
            name: 'siyuan-mcp-skill',
            title: 'SiYuan MCP Scenario Skill',
            description: 'Returns a scenario-oriented workflow and safety guide by skill name.',
            mimeType: MIME_TYPE,
        },
    ];
}

export function readHelpResource(uri: string, userRulesText = '') {
    if (uri === USER_RULES_RESOURCE_URI) {
        return {
            uri,
            mimeType: MIME_TYPE,
            text: renderUserRulesResource(userRulesText),
        };
    }

    if (uri === SKILL_INDEX_URI) {
        return {
            uri,
            mimeType: MIME_TYPE,
            text: renderMcpSkillIndex(),
        };
    }

    const staticResource = getStaticHelpResources().find((resource) => resource.uri === uri);
    if (staticResource) {
        return {
            uri: staticResource.uri,
            mimeType: staticResource.mimeType,
            text: staticResource.text,
        };
    }

    let parsed: URL;
    try {
        parsed = new URL(uri);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'siyuan:') return null;

    if (parsed.hostname === 'skills') {
        const skillSegments = parsed.pathname.split('/').filter(Boolean);
        if (skillSegments.length !== 1) return null;
        const skill = getMcpSkill(decodeURIComponent(skillSegments[0]));
        if (!skill) return null;
        return {
            uri,
            mimeType: MIME_TYPE,
            text: skill.text,
        };
    }

    if (parsed.hostname !== 'help') return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'action' || segments.length !== 3) return null;

    const tool = segments[1];
    const action = segments[2];
    if (!isKnownToolCategory(tool) || !isKnownAction(tool, action)) return null;

    return {
        uri,
        mimeType: MIME_TYPE,
        text: renderActionHelp(tool, action),
    };
}
