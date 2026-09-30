import { AGENT_MEMORY_STALE_AFTER_DAYS, USER_RULES_VIRTUAL_PATH } from './config';
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
    /** Matches ToolConfig.writeSafety so callers can pass the whole config. */
    writeSafety?: { strictMode?: boolean };
}

type NormalizedServerInstructionInput = Required<Pick<ServerInstructionInput,
    'userRulesText' | 'agentSiyuanMemoryText' | 'agentSiyuanMemoryUpdatedAt'
>> & Pick<ServerInstructionInput,
    'agentSiyuanMemoryConfigSource' | 'agentSiyuanMemoryConfigOk' | 'agentSiyuanMemoryConfigError'
> & { strictWrites: boolean };

function normalizeInstructionInput(input: string | ServerInstructionInput = '', agentSiyuanMemoryText = ''): NormalizedServerInstructionInput {
    if (typeof input === 'string') {
        return {
            userRulesText: input,
            agentSiyuanMemoryText,
            agentSiyuanMemoryUpdatedAt: '',
            strictWrites: true,
        };
    }
    return {
        userRulesText: typeof input.userRulesText === 'string' ? input.userRulesText : '',
        agentSiyuanMemoryText: typeof input.agentSiyuanMemoryText === 'string' ? input.agentSiyuanMemoryText : '',
        agentSiyuanMemoryUpdatedAt: typeof input.agentSiyuanMemoryUpdatedAt === 'string' ? input.agentSiyuanMemoryUpdatedAt : '',
        agentSiyuanMemoryConfigSource: input.agentSiyuanMemoryConfigSource,
        agentSiyuanMemoryConfigOk: input.agentSiyuanMemoryConfigOk,
        agentSiyuanMemoryConfigError: typeof input.agentSiyuanMemoryConfigError === 'string' ? input.agentSiyuanMemoryConfigError : undefined,
        // Strict safe writes are on by default (buildDefaultToolConfig).
        strictWrites: input.writeSafety?.strictMode !== false,
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

/**
 * Initialize-time instructions carry only session-wide, cross-tool rules.
 * Per-tool usage belongs in tool descriptions; details, examples, and domain
 * guidance are served on demand via action="help", siyuan://help/*, and
 * siyuan://skills/*. Keep this short: it is paid on every connection.
 */
export function buildServerInstructions(input: string | ServerInstructionInput = '', agentSiyuanMemoryText = ''): string {
    const instructionInput = normalizeInstructionInput(input, agentSiyuanMemoryText);
    const formattedUserRules = formatUserRules(instructionInput.userRulesText);
    const normalizedAgentMemory = instructionInput.agentSiyuanMemoryText.trim();
    const agentMemoryStatus = getAgentMemoryStatus(normalizedAgentMemory, instructionInput.agentSiyuanMemoryUpdatedAt);
    const userRulesSection = formattedUserRules
        ? `# Active user custom rules

Apply these before choosing tools or writing content. They override the general guidance below, but never confirmation requirements, notebook permissions, or disabled tools/actions. Current rules: \`fs(action="read", path="${USER_RULES_VIRTUAL_PATH}")\`.

## Rule list

${formattedUserRules}

`
        : '';
    const agentMemoryAction = instructionInput.agentSiyuanMemoryConfigOk === false
        ? 'MCP could not read the configured virtual memory during initialize. Before assuming `/AGENTS.md` is missing, retry `fs(action="read", path="/AGENTS.md")` or ask the user to reconnect after the SiYuan API is reachable.'
        : agentMemoryStatus.status === 'missing'
            ? 'Not initialized yet. Before workspace-aware planning, ask the user whether to create `/AGENTS.md`; if they agree, inspect the workspace with fs/search and write a concise memory.'
            : agentMemoryStatus.status === 'stale'
                ? 'Stale. Before relying on it, ask the user whether to refresh `/AGENTS.md`; if they agree, verify the current state first.'
                : 'Fresh enough to use as startup context; still verify details before high-impact edits.';
    const strictWritesRule = instructionInput.strictWrites
        ? '\n- Strict safe writes are on: call a write action with validateOnly=true first, then repeat the same call with the returned requestId and hash credential before they expire; reuse requestId unchanged on retries.'
        : '';
    return `${userRulesSection}# Agent siyuan memory (/AGENTS.md)

AI-maintained workspace summary, lower priority than user requests, user rules, confirmations, and permissions. Status: ${agentMemoryStatus.status} · Last updated: ${agentMemoryStatus.updatedAtLabel} · Age: ${agentMemoryStatus.ageLabel} (stale after ${AGENT_MEMORY_STALE_AFTER_DAYS} days) · Config source: ${formatAgentMemoryConfigSource(instructionInput)}.
${agentMemoryAction} Never create or update it without the user's consent. Keep it short and verified: key notebooks and documents, active projects, user conventions, cautions. No secrets or transcripts.

## Current memory

${normalizedAgentMemory || '(not created yet)'}

# Working with SiYuan

- Default to \`fs\` with workspace paths like /Notebook/Folder/Doc. Use document, block, search, or av only for block IDs, native layout, attributes, SQL, backlinks, assets, or databases.
- Path formats differ: fs takes /Notebook/Folder/Doc; document(action="create") takes a notebook ID plus a notebook-local path without the notebook name (/Folder/Doc); other document path arguments are .sy storage paths returned by document(action="lookup").
- Copy exact old text from fs.read before fs.replace, or from block(action="get_kramdown") before block.replace (single block only).
- Actions marked * in a tool description need explicit confirmation: say what you will do and wait for the user's yes. The same applies to file(action="export_resources") with outputPath and to uploads over 10 MB (retry with confirmLargeFile=true).${strictWritesRule}
- External submissions (feedback) skip preflight; send only after user authorization and never retry an uncertain submission automatically.

# SiYuan syntax

- Tags: #tag# with both hash marks (nested: #a/b#). Block references: ((block-id 'anchor text')); footnotes and siyuan:// links do not create backlinks.
- Databases are av blocks, not Markdown tables. Change rows, columns, and cells only with the av tool.
- Flashcards: flashcard(action="create_card") on content blocks. Today's note or diary: document(action="create_daily_note").
- Layout: super blocks {{{col / {{{row (never ::: or <div>), block attributes for metadata, renderer code blocks (mermaid, mindmap, echarts) for diagrams. Full guide: siyuan://help/ai-layout-guide.
- When an answer depends on an image, read that one asset with file(action="read_image").

# Help

Every tool accepts action="help" (topic=<action>) for fields, nested shapes, examples, and guidance. Workflow skills: siyuan://skills/index, then siyuan://skills/{name}. Also siyuan://help/tool-overview, siyuan://help/document-path-semantics, siyuan://help/examples. After plugin upgrades: system(action="changelog", fromVersion=...) or ${CHANGELOG_RESOURCE_URI}.
`;
}
