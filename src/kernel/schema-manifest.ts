/*
 * Kernel tool schema manifest — evaluated at BUILD time (Node), never inside
 * the goja sandbox.
 *
 * Importing TOOL_REGISTRY / defineTool here is intentional and safe: this file
 * is only ever loaded by the codegen script (scripts/gen-kernel-schemas.mjs)
 * through vite ssrLoadModule in a Node host, where z.toJSONSchema() works.
 * The resulting plain JSON is what kernel.js embeds, so the sandbox never runs
 * schema reflection itself.
 */

import { buildDefaultToolConfig, TOOL_CATEGORIES, ACTIONS_BY_CATEGORY, isDangerousAction } from '../core/config';
export { getRegisteredActionSchemas } from '../tools/internal/define-tool';
import { TOOL_REGISTRY, GENERIC_TOOL_OUTPUT_SCHEMA } from '../core/tool-registry';

export interface KernelToolDescriptor {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    title?: string;
    outputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
}

const TOOL_TITLES: Record<string, string> = {
    fs: 'SiYuan Filesystem',
    notebook: 'SiYuan Notebooks',
    document: 'SiYuan Documents',
    block: 'SiYuan Blocks',
    av: 'SiYuan Databases',
    file: 'SiYuan Assets and Exports',
    feedback: 'Sisyphus Feedback',
    search: 'SiYuan Search',
    tag: 'SiYuan Tags',
    timeline: 'SiYuan History',
    system: 'SiYuan System',
    flashcard: 'SiYuan Flashcards',
    extension: 'SiYuan Extension Tools',
    mascot: 'Sisyphus Mascot',
};

/**
 * Collect the aggregated tool descriptors for every statically-known category.
 * Include default-disabled actions so runtime settings can expose them.
 * 'extension' is intentionally skipped: its tools are discovered at runtime
 * through the official MCP bridge, so there is no static schema to bake in.
 */
export function buildKernelToolManifest(): KernelToolDescriptor[] {
    const config = buildDefaultToolConfig();
    const out: KernelToolDescriptor[] = [];
    for (const category of TOOL_CATEGORIES) {
        if (category === 'extension') continue;
        const module = TOOL_REGISTRY[category];
        if (!module || typeof module.listTools !== 'function') continue;
        const descriptors = module.listTools({ ...config[category], enabled: true, actions: Object.fromEntries(ACTIONS_BY_CATEGORY[category].map(action => [action, true])) } as any);
        const hasDangerous = Object.keys(config[category]?.actions ?? {})
            .some((a) => isDangerousAction(category as any, a));
        for (const descriptor of descriptors) {
            const title = descriptor.title ?? TOOL_TITLES[category];
            out.push({
                name: descriptor.name,
                description: descriptor.description,
                inputSchema: descriptor.inputSchema as Record<string, unknown> | undefined,
                title,
                outputSchema: (descriptor.outputSchema as Record<string, unknown> | undefined) ?? { ...GENERIC_TOOL_OUTPUT_SCHEMA },
                annotations: (descriptor.annotations as Record<string, unknown> | undefined) ?? {
                    title,
                    readOnlyHint: false,
                    destructiveHint: hasDangerous,
                    idempotentHint: false,
                    openWorldHint: true,
                },
            });
        }
    }
    return out;
}
