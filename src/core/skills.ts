import { createHash } from 'node:crypto';

import indexSkill from '../../skills/siyuan-mcp/siyuan-mcp-sisyphus/SKILL.md?raw';
import browseReadSkill from '../../skills/siyuan-mcp/siyuan-mcp-browse-read/SKILL.md?raw';
import createEditSkill from '../../skills/siyuan-mcp/siyuan-mcp-create-edit/SKILL.md?raw';
import searchQuerySkill from '../../skills/siyuan-mcp/siyuan-mcp-search-query/SKILL.md?raw';
import databaseSkill from '../../skills/siyuan-mcp/siyuan-mcp-database/SKILL.md?raw';
import fileExportSkill from '../../skills/siyuan-mcp/siyuan-mcp-file-export/SKILL.md?raw';
import tagFlashcardSkill from '../../skills/siyuan-mcp/siyuan-mcp-tag-flashcard/SKILL.md?raw';
import timelineSkill from '../../skills/siyuan-mcp/siyuan-mcp-timeline/SKILL.md?raw';
import systemSafetySkill from '../../skills/siyuan-mcp/siyuan-mcp-system-safety/SKILL.md?raw';
import markupGuideSkill from '../../skills/siyuan-mcp/siyuan-mcp-markup-guide/SKILL.md?raw';
import importMigrationSkill from '../../skills/siyuan-mcp/siyuan-mcp-import-migration/SKILL.md?raw';
import visualAssetsSkill from '../../skills/siyuan-mcp/siyuan-mcp-visual-assets/SKILL.md?raw';
import sepIndexSkill from '../../skills/siyuan-mcp-bundles/siyuan-mcp-sisyphus/SKILL.md?raw';
import sepIndexAgent from '../../skills/siyuan-mcp-bundles/siyuan-mcp-sisyphus/agents/openai.yaml?raw';
import sepReadSkill from '../../skills/siyuan-mcp-bundles/siyuan-mcp-read-discover/SKILL.md?raw';
import sepReadAgent from '../../skills/siyuan-mcp-bundles/siyuan-mcp-read-discover/agents/openai.yaml?raw';
import sepWriteSkill from '../../skills/siyuan-mcp-bundles/siyuan-mcp-write-format/SKILL.md?raw';
import sepWriteAgent from '../../skills/siyuan-mcp-bundles/siyuan-mcp-write-format/agents/openai.yaml?raw';
import sepDataSkill from '../../skills/siyuan-mcp-bundles/siyuan-mcp-data-files/SKILL.md?raw';
import sepDataAgent from '../../skills/siyuan-mcp-bundles/siyuan-mcp-data-files/agents/openai.yaml?raw';
import sepSafetySkill from '../../skills/siyuan-mcp-bundles/siyuan-mcp-organize-safety/SKILL.md?raw';
import sepSafetyAgent from '../../skills/siyuan-mcp-bundles/siyuan-mcp-organize-safety/agents/openai.yaml?raw';

export const SKILL_INDEX_URI = 'siyuan://skills/index';
export const SKILL_RESOURCE_TEMPLATE_URI = 'siyuan://skills/{name}';

export interface McpSkillDefinition {
    name: string;
    title: string;
    description: string;
    promptName: string;
    text: string;
    files: Array<{ path: string; text: string; mimeType: string }>;
}

function createMcpSkill(
    text: string,
    additionalFiles: Array<{ path: string; text: string; mimeType: string }> = [],
): McpSkillDefinition {
    const frontmatter = text.match(/^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---/);
    const heading = text.match(/^# (.+)$/m);
    if (!frontmatter || !heading) {
        throw new Error('Generated MCP skill is missing canonical frontmatter or a title.');
    }

    const name = frontmatter[1];
    const promptSuffix = name === 'siyuan-mcp-sisyphus'
        ? 'mcp_sisyphus'
        : name.replace(/^siyuan-mcp-/, '').replaceAll('-', '_');

    return {
        name,
        title: heading[1].replace(/ with MCP$/, ''),
        description: frontmatter[2],
        promptName: `siyuan_${promptSuffix}`,
        text,
        files: [
            { path: 'SKILL.md', text, mimeType: 'text/markdown' },
            ...additionalFiles,
        ],
    };
}

export const MCP_SKILLS: readonly McpSkillDefinition[] = [
    indexSkill,
    browseReadSkill,
    createEditSkill,
    searchQuerySkill,
    databaseSkill,
    fileExportSkill,
    tagFlashcardSkill,
    timelineSkill,
    systemSafetySkill,
    markupGuideSkill,
    importMigrationSkill,
    visualAssetsSkill,
].map((text) => createMcpSkill(text));

const SEP_LISTED_SKILLS: readonly McpSkillDefinition[] = [
    createMcpSkill(sepIndexSkill, [{ path: 'agents/openai.yaml', text: sepIndexAgent, mimeType: 'application/yaml' }]),
    createMcpSkill(sepReadSkill, [{ path: 'agents/openai.yaml', text: sepReadAgent, mimeType: 'application/yaml' }]),
    createMcpSkill(sepWriteSkill, [{ path: 'agents/openai.yaml', text: sepWriteAgent, mimeType: 'application/yaml' }]),
    createMcpSkill(sepDataSkill, [{ path: 'agents/openai.yaml', text: sepDataAgent, mimeType: 'application/yaml' }]),
    createMcpSkill(sepSafetySkill, [{ path: 'agents/openai.yaml', text: sepSafetyAgent, mimeType: 'application/yaml' }]),
];

const SEP_UNLISTED_SCENARIO_SKILLS = MCP_SKILLS.filter((skill) => skill.name !== 'siyuan-mcp-sisyphus');
export const SEP_MCP_SKILLS: readonly McpSkillDefinition[] = [
    ...SEP_LISTED_SKILLS,
    ...SEP_UNLISTED_SCENARIO_SKILLS,
];

export interface SepSkillEntry {
    uri: string;
    frontmatter: { name: string; description: string };
    resources: Array<{ uri: string; digest: string }>;
}

function skillFileUri(skill: McpSkillDefinition, path: string): string {
    return `skill://${skill.name}/${path}`;
}

function digest(text: string): string {
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function toSepSkillEntry(skill: McpSkillDefinition): SepSkillEntry {
    return {
        uri: skillFileUri(skill, 'SKILL.md'),
        frontmatter: {
            name: skill.name,
            description: skill.description,
        },
        resources: skill.files.map((file) => ({
            uri: skillFileUri(skill, file.path),
            digest: digest(file.text),
        })),
    };
}

export function listSepSkills(): SepSkillEntry[] {
    // The five-entry catalog is intentionally bounded for hosts that scan a
    // small number of skills. The four bundle skills route to the narrower
    // scenario skills, which remain directly retrievable through skills/get.
    return SEP_LISTED_SKILLS.map(toSepSkillEntry);
}

export function getSepSkill(uri: string): SepSkillEntry | undefined {
    const skill = SEP_MCP_SKILLS.find((candidate) => skillFileUri(candidate, 'SKILL.md') === uri);
    return skill ? toSepSkillEntry(skill) : undefined;
}

export function listSepSkillResources() {
    return SEP_MCP_SKILLS.flatMap((skill) => skill.files.map((file) => ({
        uri: skillFileUri(skill, file.path),
        name: file.path === 'SKILL.md' ? skill.name : file.path.split('/').slice(-1)[0] ?? file.path,
        title: file.path === 'SKILL.md' ? skill.title : `${skill.title}: ${file.path}`,
        description: file.path === 'SKILL.md' ? skill.description : `Supporting file for ${skill.name}.`,
        mimeType: file.mimeType,
        })));
}

export function readSepSkillResource(uri: string) {
    for (const skill of SEP_MCP_SKILLS) {
        const file = skill.files.find((candidate) => skillFileUri(skill, candidate.path) === uri);
        if (file) {
            return { uri, mimeType: file.mimeType, text: file.text };
        }
    }
    return undefined;
}

export function getMcpSkill(name: string): McpSkillDefinition | undefined {
    return MCP_SKILLS.find((skill) => skill.name === name);
}

export function getMcpSkillByPromptName(promptName: string): McpSkillDefinition | undefined {
    return MCP_SKILLS.find((skill) => skill.promptName === promptName);
}

export function renderMcpSkillIndex(): string {
    const rows = MCP_SKILLS.map((skill) =>
        `| \`${skill.name}\` | ${skill.description} | \`siyuan://skills/${skill.name}\` |`,
    );

    return [
        '# SiYuan MCP Skill Index',
        '',
        'Use the narrowest scenario skill that matches the task. Skills define workflows, decisions, and safety rules; current parameter shapes remain in `siyuan://help/action/{tool}/{action}`.',
        '',
        '| Skill | Use for | Resource |',
        '| --- | --- | --- |',
        ...rows,
        '',
        'If the client cannot read MCP resources, call the relevant tool with `action="help"`.',
    ].join('\n');
}

export function listMcpPrompts() {
    return MCP_SKILLS.map((skill) => ({
        name: skill.promptName,
        title: skill.title,
        description: skill.description,
        arguments: [{
            name: 'task',
            description: 'Optional concrete SiYuan task to perform with this workflow.',
            required: false,
        }],
    }));
}

export function getMcpPrompt(name: string, task?: string) {
    const skill = getMcpSkillByPromptName(name);
    if (!skill) return null;

    const normalizedTask = typeof task === 'string' ? task.trim() : '';
    const taskSection = normalizedTask
        ? `\n\n## Requested task\n\n${normalizedTask}`
        : '';

    return {
        description: skill.description,
        messages: [{
            role: 'user' as const,
            content: {
                type: 'text' as const,
                text: `${skill.text.trim()}${taskSection}`,
            },
        }],
    };
}
