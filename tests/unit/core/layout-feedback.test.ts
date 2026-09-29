import { describe, expect, it, vi } from 'vitest';
import { slimToolResult } from '@/core/slim-response';
import { verifyAvCellsReadback } from '@/core/av-cell-readback';
import { readHelpResource } from '@/core/resources';
import { TOOL_REGISTRY } from '@/core/tool-registry';
import { buildDefaultToolConfig } from '@/core/config';
import { DocumentCreateSchema } from '@/core/types';
import { validateRegisteredToolArguments } from '@/tools/internal/define-tool';
import { WriteSafetyCoordinator } from '@/core/write-safety-coordinator';
import { parseResult } from '../../helpers/parse-result';

const config = buildDefaultToolConfig();

describe('layout feedback regressions', () => {
    it.each(['get', 'render', 'get_column_options'])('preserves native AV content in %s', (action) => {
        const data = { av: { keyValues: [{ key: { options: [{ name: '进行中', color: '1' }] }, values: [
            { mSelect: [{ content: '进行中', color: '' }, { content: '待开始', color: '2' }] },
            { mAsset: [{ content: 'assets/example.png', name: '图' }] },
            { text: { content: '正文' }, relation: { contents: [{ content: '关联正文' }] } },
        ] }] }, filters: [{ value: { mSelect: [{ content: '进行中' }] } }] };
        const result = { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data };
        expect(slimToolResult(result, { category: 'av', action })).toEqual(result);
    });

    it('rejects invalid create parameters before any ledger or write access', async () => {
        const client = { readFile: vi.fn(), writeFile: vi.fn() } as any;
        const execute = vi.fn();
        const result = await new WriteSafetyCoordinator(client).run({
            client, permMgr: {} as any, category: 'document', action: 'create', strictMode: true,
            args: { action: 'create', notebook: 'nb', title: 'Missing parent', validateOnly: true },
            validateArgs: (args) => validateRegisteredToolArguments('document', args), execute,
        });
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('Provide path');
        expect(execute).not.toHaveBeenCalled();
        expect(client.readFile).not.toHaveBeenCalled();
        expect(client.writeFile).not.toHaveBeenCalled();
        expect(parseResult(result)).not.toHaveProperty('requestId');
    });

    it('returns a valid minimal create example and both legal shapes', async () => {
        const result = parseResult(await TOOL_REGISTRY.document.callTool({} as any,
            { action: 'help', topic: 'create' }, config.document, {} as any));
        expect(result.shapes).toEqual(['notebook + path', 'notebook + parentPath + title']);
        expect(DocumentCreateSchema.safeParse(result.example).success).toBe(true);
        expect(() => validateRegisteredToolArguments('document', { action: 'create', notebook: 'nb', parentPath: '/', title: 'Title' })).not.toThrow();
    });

    it('serves exactly the resource guide through a tool-only help call', async () => {
        const help = parseResult(await TOOL_REGISTRY.fs.callTool({} as any,
            { action: 'help', topic: 'ai-layout-guide' }, config.fs, {} as any));
        expect(help.text).toBe(readHelpResource('siyuan://help/ai-layout-guide')?.text);
        expect(help.text.length).toBeGreaterThan(12000);
    });

    it('explains that help URIs are not filesystem paths', async () => {
        const result = await TOOL_REGISTRY.fs.callTool({} as any,
            { action: 'read', path: 'siyuan://help/ai-layout-guide' }, config.fs, {} as any);
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('resources/read');
        expect(JSON.stringify(result)).toContain('ai-layout-guide');
    });

    it('checks each repeated select value rather than just an overall state change', () => {
        const cells = ['a', 'b', 'c'].map((rowID) => ({ rowID, columnID: 'status', valueType: 'select', option: '进行中' }));
        const definition = { keyValues: [{ key: { id: 'status' }, values: cells.map((cell) => ({ blockID: cell.rowID, mSelect: [{ content: cell.option, color: '13' }] })) }] };
        expect(() => verifyAvCellsReadback({ cells }, definition)).not.toThrow();
        delete (definition.keyValues[0].values[0].mSelect[0] as any).content;
        expect(() => verifyAvCellsReadback({ cells }, definition)).toThrow('a/status');
    });

    it('compares the final request when a batch repeats a cell', () => {
        const cells = ['first', 'last'].map((text) => ({ rowID: 'a', columnID: 'text', valueType: 'text', text }));
        expect(() => verifyAvCellsReadback({ cells }, { keyValues: [{ key: { id: 'text' }, values: [{ blockID: 'a', text: { content: 'last' } }] }] })).not.toThrow();
    });
    it.each([
        [{ valueType: 'number', number: 12, numberFormat: '0.00' }, { number: { isNotEmpty: true, content: 12, format: '0.00', formattedContent: '12.00' } }],
        [{ valueType: 'checkbox', checked: false }, { checkbox: { checked: false } }],
        [{ valueType: 'date', date: '2026-09-10T00:00:00Z', endDate: '2026-09-11T00:00:00Z', includeTime: false },
            { date: { isNotEmpty: true, content: Date.parse('2026-09-10T00:00:00Z'), content2: Date.parse('2026-09-11T00:00:00Z'), hasEndDate: true, isNotTime: true } }],
        [{ valueType: 'multi_select', options: ['A', 'B'] }, { mSelect: [{ content: 'B', color: '2' }, { content: 'A', color: '1' }] }],
        [{ valueType: 'url', url: 'https://example.com' }, { url: { content: 'https://example.com' } }],
        [{ valueType: 'email', email: 'a@example.com' }, { email: { content: 'a@example.com' } }],
        [{ valueType: 'phone', phone: '123' }, { phone: { content: '123' } }],
        [{ valueType: 'mAsset', assets: [{ type: 'image', content: 'assets/test.png' }] }, { mAsset: [{ type: 'image', content: 'assets/test.png', name: '' }] }],
    ])('verifies requested semantics for %j and rejects a missing cell', (input, value) => {
        const args = { rowID: 'row', columnID: 'column', ...input };
        expect(() => verifyAvCellsReadback(args, { keyValues: [{ key: { id: 'column' }, values: [{ blockID: 'row', ...value }] }] })).not.toThrow();
        expect(() => verifyAvCellsReadback(args, { keyValues: [] })).toThrow('row/column');
    });

});
