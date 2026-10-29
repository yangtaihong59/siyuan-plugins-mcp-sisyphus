import { describe, expect, it } from 'vitest';
import { applyCliWriteGuidance, buildCliCommand, CLI_PREFLIGHT_HINT, formatPreflightFooter, formatWritePreview } from '@/cli/write-guidance';
import { mapFlagsToArgs } from '@/cli/flag-mapper';

const text = (payload: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload) }], ...(isError ? { isError } : {}) });

describe('cli write guidance', () => {
    it('turns preflight commitArgs into a paste-ready commit command', () => {
        const commitArgs = { action: 'update', id: '20260101-abc', dataType: 'markdown', data: "it's done", validateOnly: false, requestId: 'eb9a', expectedStateHash: '9fbf' };
        const { result, commitCommand } = applyCliWriteGuidance(text({ validateOnly: true, preflight: { commitArgs } }) as never, 'block');
        expect(commitCommand).toBe("siyuan-sisyphus block update --id 20260101-abc --data-type markdown --data 'it'\\''s done' --request-id eb9a --expected-state-hash 9fbf");
        expect(JSON.parse((result.content[0] as { text: string }).text).commitCommand).toBe(commitCommand);
        const human = applyCliWriteGuidance(text({ validateOnly: true, preflight: { commitArgs } }) as never, 'block', false);
        expect(human.commitCommand).toBe(commitCommand);
        expect(JSON.parse((human.result.content[0] as { text: string }).text).commitCommand).toBeUndefined();
    });

    it('adds a paste-ready removal preflight for the av create default column', () => {
        const payload = { success: true, action: 'create', avID: 'av-1', defaultColumns: [{ keyID: 'k-1', name: '单选', type: 'select' }],
            removeDefaultColumn: { tool: 'av', arguments: { action: 'remove_column', avID: 'av-1', keyID: 'k-1', validateOnly: true } } };
        const { result, commitCommand } = applyCliWriteGuidance(text(payload) as never, 'av', true);
        expect(commitCommand).toBeUndefined();
        expect(JSON.parse((result.content[0] as { text: string }).text).removeDefaultColumn.cliCommand)
            .toBe('siyuan-sisyphus av remove-column --av-id av-1 --key-id k-1 --validate-only');
        // Human output: one line instead of the step object and column list.
        const human = JSON.parse((applyCliWriteGuidance(text(payload) as never, 'av', false).result.content[0] as { text: string }).text);
        expect(human.removeDefaultColumn).toBeUndefined();
        expect(human.defaultColumns).toBeUndefined();
        expect(human.defaultColumnNote).toBe('SiYuan added a default select column «单选»; keep it (kanban needs one) or remove it with: siyuan-sisyphus av remove-column --av-id av-1 --key-id k-1 --validate-only');
    });

    it('words the preflight footer neutrally', () => {
        const footer = formatPreflightFooter('siyuan-sisyphus block update --id x');
        expect(footer).not.toContain('OK');
        expect(footer).toContain('Preflight valid — check the target and changes above, then commit with:\n  siyuan-sisyphus block update --id x');
    });

    it('round-trips arrays and objects through -json flags the mapper accepts', () => {
        const commitArgs = { action: 'remove_card', deckID: 'd1', blockIDs: ['b1', 'b2'], requestId: 'c93e' };
        const command = buildCliCommand('flashcard', commitArgs);
        expect(command).toContain(`--block-ids-json '["b1","b2"]'`);
        expect(command.startsWith('siyuan-sisyphus flashcard remove-card ')).toBe(true);
        const schema = { type: 'object', properties: { action: { type: 'string' }, deckID: { type: 'string' }, blockIDs: { type: 'array', items: { type: 'string' } }, requestId: { type: 'string' } } };
        const { args, unknownFlags } = mapFlagsToArgs(['--deck-id', 'd1', '--block-ids-json', '["b1","b2"]', '--request-id', 'c93e'], schema);
        expect(unknownFlags).toEqual([]);
        expect(args).toEqual({ deckID: 'd1', blockIDs: ['b1', 'b2'], requestId: 'c93e' });
    });

    it('replaces MCP-only guidance with CLI flags when a preflight credential is missing', () => {
        const payload = { success: false, error: { code: 'precondition_required', message: 'requestId is required for every strict write. Copy it from validateOnly preflight.' } };
        const { result, commitCommand } = applyCliWriteGuidance(text(payload, true) as never, 'document');
        expect(commitCommand).toBeUndefined();
        expect(JSON.parse((result.content[0] as { text: string }).text).error.hint).toBe(CLI_PREFLIGHT_HINT);
    });

    it('keeps the preview in JSON output and prints it readably in human output', () => {
        const commitArgs = { action: 'heading_to_doc', headingID: 'h1', targetNotebook: 'nb', validateOnly: false, requestId: 'eb9a', expectedStructureHash: '9fbf' };
        const preview = {
            detail: 'summary',
            targets: [{ id: 'd1', kind: 'document', title: 'Meeting', hPath: '/Meeting', notebook: { id: 'nb', name: 'Work', permission: 'rw' } }],
            changes: [
                { kind: 'heading_to_doc', summary: 'Moves heading «Notes» (3 blocks). The source document becomes EMPTY.', movedBlocks: ['«a»', '«b»'], source: { becomesEmpty: true } },
                { kind: 'content_update', summary: 'Replaces block.', before: 'old', after: 'new' },
                { kind: 'find_replace', summary: 'Replaces 1 match.', examples: [{ blockID: 'b1', before: 'a cat', after: 'a dog' }] },
            ],
            risk: ['empties_source'],
        };
        const payload = { validateOnly: true, preflight: { commitArgs }, preview };

        const json = applyCliWriteGuidance(text(payload) as never, 'document');
        expect(json.previewLines).toBeUndefined();
        expect(JSON.parse((json.result.content[0] as { text: string }).text).preview).toEqual(preview);

        const human = applyCliWriteGuidance(text(payload) as never, 'document', false);
        expect(JSON.parse((human.result.content[0] as { text: string }).text)).not.toHaveProperty('preview');
        expect(human.commitCommand).toContain('--expected-structure-hash 9fbf');
        expect(human.previewLines).toEqual([
            'Preview (read it before committing):',
            '  Targets:',
            '    - document d1 "Meeting" /Meeting [notebook Work, rw]',
            '  Changes:',
            '    - Moves heading «Notes» (3 blocks). The source document becomes EMPTY.',
            '        movedBlocks: «a»',
            '        movedBlocks: «b»',
            '    - Replaces block.',
            '        before: old',
            '        after: new',
            '    - Replaces 1 match.',
            '        examples: a cat',
            '                → a dog',
            '  Risk: empties_source',
        ]);
        expect(formatWritePreview({ error: 'timeout' })).toEqual(['Preview unavailable: timeout']);
    });

    it('adds the current reach to workspace_wide and spells preview="full" as a flag', () => {
        const lines = formatWritePreview({
            targets: [],
            changes: [
                { kind: 'tag_rename', summary: 'Renames #a# to #b# on 2 block(s) in 1 notebook(s).', blockCount: 2, notebookCount: 1 },
                { kind: 'find_replace', summary: 'Showing 5 of 9 match(es) (5 of 9 block(s)); preview="full" lists all.' },
            ],
            risk: ['workspace_wide'],
        });
        expect(lines).toContain('  Risk: workspace_wide — currently 2 block(s) in 1 notebook(s)');
        expect(lines).toContain('    - Showing 5 of 9 match(es) (5 of 9 block(s)); --preview full lists all.');
    });

    it('accepts --preview full as a write-safety flag', () => {
        const schema = { type: 'object', 'x-sisyphus-actionSchemas': [{ properties: { action: { const: 'update' }, id: { type: 'string' } } }] };
        const { args, unknownFlags } = mapFlagsToArgs(['--id', 'b1', '--validate-only', '--preview', 'full'], schema, { category: 'block', action: 'update' });
        expect(unknownFlags).toEqual([]);
        expect(args).toEqual({ id: 'b1', validateOnly: true, preview: 'full' });
    });

    it('leaves ordinary results untouched', () => {
        const original = text({ success: true, id: 'x' });
        expect(applyCliWriteGuidance(original as never, 'document').result).toBe(original);
    });
});
