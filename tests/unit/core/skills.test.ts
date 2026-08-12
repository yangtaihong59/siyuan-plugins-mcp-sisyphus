import { describe, expect, it } from 'vitest';

import {
    MCP_SKILLS,
    getMcpPrompt,
    listMcpPrompts,
    renderMcpSkillIndex,
} from '@/core/skills';
import {
    AV_VARIANTS,
    BLOCK_VARIANTS,
    DOCUMENT_VARIANTS,
    EXTENSION_VARIANTS,
    FILE_VARIANTS,
    FLASHCARD_VARIANTS,
    FS_VARIANTS,
    NOTEBOOK_VARIANTS,
    SEARCH_VARIANTS,
    SYSTEM_VARIANTS,
    TAG_VARIANTS,
    TIMELINE_VARIANTS,
} from '@/tools/index';
import { scenarios } from '../../../skills/source/scenarios.mjs';

const variantsByTool: Record<string, Array<{ action: string; schema: Record<string, any> }>> = {
    av: AV_VARIANTS,
    block: BLOCK_VARIANTS,
    document: DOCUMENT_VARIANTS,
    extension: EXTENSION_VARIANTS,
    file: FILE_VARIANTS,
    flashcard: FLASHCARD_VARIANTS,
    fs: FS_VARIANTS,
    notebook: NOTEBOOK_VARIANTS,
    search: SEARCH_VARIANTS,
    system: SYSTEM_VARIANTS,
    tag: TAG_VARIANTS,
    timeline: TIMELINE_VARIANTS,
};

describe('core/skills', () => {
    it('embeds ten valid MCP skills without CLI invocation examples', () => {
        expect(MCP_SKILLS).toHaveLength(10);
        expect(new Set(MCP_SKILLS.map((skill) => skill.name)).size).toBe(10);
        expect(new Set(MCP_SKILLS.map((skill) => skill.promptName)).size).toBe(10);

        for (const skill of MCP_SKILLS) {
            expect(skill.text).toContain(`name: ${skill.name}`);
            expect(skill.text).not.toMatch(/\bsiyuan-sisyphus\s+(fs|notebook|document|block|av|file|search|tag|timeline|system|flashcard|mascot|feedback)\b/);
        }
    });

    it('renders a discoverable index and scenario prompts', () => {
        const index = renderMcpSkillIndex();
        const prompts = listMcpPrompts();
        const prompt = getMcpPrompt('siyuan_create_edit', 'Append a summary.');

        expect(index).toContain('siyuan://help/action/{tool}/{action}');
        expect(prompts).toHaveLength(10);
        expect(index).toContain('siyuan-mcp-timeline');
        expect(prompts).toContainEqual(expect.objectContaining({ name: 'siyuan_timeline' }));
        expect(prompts.find((item) => item.name === 'siyuan_create_edit')?.arguments).toEqual([
            expect.objectContaining({ name: 'task', required: false }),
        ]);
        expect(prompt?.messages[0].content.text).toContain('Append a summary.');
        expect(prompt?.messages[0].content.text).toContain('name: siyuan-mcp-create-edit');
        expect(getMcpPrompt('unknown')).toBeNull();
    });

    it('keeps every structured example aligned with the live action schemas', () => {
        for (const scenario of scenarios) {
            for (const [callName, call] of Object.entries(scenario.calls) as Array<[string, { tool: string; action: string; args: Record<string, unknown> }]>) {
                const variant = variantsByTool[call.tool]?.find((item) => item.action === call.action);
                expect(variant, `${scenario.id}.${callName} action`).toBeDefined();

                const properties = variant?.schema.properties ?? {};
                for (const key of Object.keys(call.args)) {
                    expect(properties, `${scenario.id}.${callName} field ${key}`).toHaveProperty(key);
                }
                for (const required of variant?.schema.required ?? []) {
                    if (required === 'action') continue;
                    expect(call.args, `${scenario.id}.${callName} required ${required}`).toHaveProperty(required);
                }
            }
        }
    });
});
