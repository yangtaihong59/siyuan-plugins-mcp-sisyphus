/** Measure actual initialize instructions + tools/list, without calling SiYuan.
 * Usage: npm run analyze:mcp -- [--root /path/to/baseline-checkout]
 * The optional root allows reproducible comparisons against a Git archive.
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--root')) {
    throw new Error('Usage: analyze-description-tokens.mjs [--root PATH]');
}
const root = args.length ? path.resolve(args[1]) : fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
    root, configFile: false, server: { middlewareMode: true },
    resolve: { alias: { '@': path.join(root, 'src') } },
});
try {
    const { buildDefaultToolConfig, TOOL_CATEGORIES } = await server.ssrLoadModule('/src/core/config.ts');
    const { listAllTools } = await server.ssrLoadModule('/src/core/tool-registry.ts');
    const { buildServerInstructions } = await server.ssrLoadModule('/src/core/server-instructions.ts');
    const { approximateTokensFromChars } = await server.ssrLoadModule('/src/core/token-usage.ts');
    const measure = (config) => {
        const instructions = buildServerInstructions(config).trim();
        const tools = listAllTools(config);
        const toolsChars = JSON.stringify({ tools }).length;
        const totalChars = instructions.length + toolsChars;
        return {
            instructionsChars: instructions.length, toolsChars, totalChars,
            approximateTokens: approximateTokensFromChars(totalChars),
            tools: tools.map(tool => ({ name: tool.name, chars: JSON.stringify(tool).length })),
        };
    };
    const config = buildDefaultToolConfig();
    const defaults = measure(config);
    for (const category of TOOL_CATEGORIES) {
        config[category].enabled = true;
        for (const action of Object.keys(config[category].actions)) config[category].actions[action] = true;
    }
    console.log(JSON.stringify({
        scope: '14 aggregated tools, empty user rules/memory, no discovered extension tools or optional MCP Apps',
        estimate: 'ceil(serialized characters / 4); not a model tokenizer count',
        defaults, allStaticActions: measure(config),
    }, null, 2));
} finally {
    await server.close();
}
