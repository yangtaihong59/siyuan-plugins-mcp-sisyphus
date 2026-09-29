import { renderAiLayoutGuide } from './ai-layout-guide';
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
