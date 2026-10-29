import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { shouldSlimResponse, toolCallRequestText } from '../../../src/mcp/tool-execution';

const ENTRY_POINTS = ['src/mcp/server.ts', 'src/kernel/index.ts', 'src/cli/dispatch.ts'];
const source = (file: string) => readFileSync(resolve(__dirname, '../../..', file), 'utf8');

describe('shared tools/call execution', () => {
    it.each(ENTRY_POINTS)('%s runs local tools only through executeLocalTool', (file) => {
        const text = source(file);
        expect(text).toContain('executeLocalTool(');
        // A direct handler call or coordinator run would bypass argument
        // validation, the forced-strict composite writes or both.
        expect(text).not.toMatch(/TOOL_REGISTRY\[[^\]]+\]\.callTool\(/);
        expect(text).not.toMatch(/\.callTool\(\s*(client|scoped)/);
        expect(text).not.toMatch(/(writeSafetyCoordinator|coord|WriteSafetyCoordinator\([^)]*\))\.run\(/);
    });

    it.each(['src/mcp/server.ts', 'src/kernel/index.ts'])('%s shares App execution and result projection', (file) => {
        const text = source(file);
        expect(text).toContain('executeAppTool(');
        expect(text).toContain('finalizeToolResult(');
        expect(text).not.toContain('compactMcpAppToolResult(');
    });

    it('keeps download manifests unslimmed', () => {
        const config = { debug: { slimResponses: true } } as never;
        expect(shouldSlimResponse(config, { action: 'export_resources' })).toBe(true);
        expect(shouldSlimResponse(config, { action: 'export_resources', delivery: 'download' })).toBe(false);
        expect(shouldSlimResponse({ debug: { slimResponses: false } } as never, {})).toBe(false);
    });

    it('never records third-party extension arguments in analytics text', () => {
        expect(toolCallRequestText('extension', 'extension', 'probe', { action: 'probe', secret: 'x' }))
            .toBe(JSON.stringify({ name: 'extension', action: 'probe' }));
        expect(toolCallRequestText('block', 'block', 'get', { action: 'get', id: '1' }))
            .toBe(JSON.stringify({ name: 'block', arguments: { action: 'get', id: '1' } }));
    });
});
