import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** All TypeScript sources of the MCP Apps page, concatenated for source-contract tests. */
export function readMcpAppSource(): string {
    const dir = resolve(process.cwd(), 'src/mcp-apps');
    return readdirSync(dir)
        .filter((name) => name.endsWith('.ts'))
        .sort()
        .map((name) => readFileSync(resolve(dir, name), 'utf8'))
        .join('\n');
}
