import { describe, expect, it } from 'vitest';
import { applyCliWriteGuidance, buildCliCommand, CLI_PREFLIGHT_HINT, formatPreflightFooter, formatSafetyStatus, formatWritePreview } from '@/cli/write-guidance';
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

    it('accepts --if-match as a write-safety flag', () => {
        const schema = { type: 'object', 'x-sisyphus-actionSchemas': [{ properties: { action: { const: 'update' }, id: { type: 'string' } } }] };
        const { args, unknownFlags } = mapFlagsToArgs(['--id', 'b1', '--if-match', '0123456789abcdef'], schema, { category: 'block', action: 'update' });
        expect(unknownFlags).toEqual([]);
        expect(args).toEqual({ id: 'b1', ifMatch: '0123456789abcdef' });
    });

    it('prints a one-step receipt preview after the write and keeps it in JSON', () => {
        const preview = { detail: 'summary', targets: [{ id: 'b1', kind: 'block' }], changes: [{ kind: 'update', summary: 'Replaces block b1.' }], risk: ['overwrites_content'] };
        const payload = { success: true, id: 'b1', oneStep: { tier: 2 }, preview, safety: { transactionState: 'committed' } };
        expect(applyCliWriteGuidance(text(payload) as never, 'block').result).toEqual(text(payload));
        const human = applyCliWriteGuidance(text(payload) as never, 'block', false);
        expect(human.commitCommand).toBeUndefined();
        expect(human.previewLines?.[0]).toContain('committed in one step');
        expect(human.previewLines).toContain('    - Replaces block b1.');
        expect(JSON.parse((human.result.content[0] as { text: string }).text)).not.toHaveProperty('preview');
    });

    it('keeps the one-step refusal reason next to the CLI two-step hint', () => {
        const payload = { success: false, error: { code: 'precondition_required', message: 'requestId is required for this strict write. This overwrite can skip preflight only with ifMatch from a fresh read of the target.', oneStep: { allowed: false, tier: 2, reason: 'missing_if_match' } } };
        const parsed = JSON.parse((applyCliWriteGuidance(text(payload, true) as never, 'block').result.content[0] as { text: string }).text);
        expect(parsed.error).toMatchObject({ hint: CLI_PREFLIGHT_HINT, oneStep: { reason: 'missing_if_match' } });
        expect(parsed.error.message).toContain('ifMatch');
    });

    it('puts the preflight preview first and hides its bookkeeping in human output only', () => {
        const commitArgs = { action: 'update', id: 'b1', dataType: 'markdown', data: 'x', validateOnly: false, requestId: 'ed8a', expectedStateHash: '623e' };
        const payload = {
            action: 'update', validateOnly: true, writeSafetyMode: 'strict', writeAttempted: false, writeExecuted: false,
            requestId: 'ed8a', preconditionField: 'expectedStateHash', expectedStateHash: '623e',
            hashPrefixLength: 4, expiresAt: 1793257578371,
            preflight: { version: 2, requestId: 'ed8a', expiresAt: 1793257578371, counts: { operationCount: 1, targetCount: 1 }, commitArgs },
            preview: { targets: [{ id: 'b1', kind: 'block' }], changes: [{ kind: 'content_update', summary: 'Replaces block.' }], risk: ['overwrites_content'] },
        };
        const human = applyCliWriteGuidance(text(payload) as never, 'block', false);
        expect(human).toMatchObject({ previewFirst: true, hideResult: true, expiresAt: 1793257578371 });
        expect(human.previewLines?.[0]).toBe('Preview (read it before committing):');
        expect(JSON.parse((human.result.content[0] as { text: string }).text)).toEqual({});
        // A note the coordinator adds survives; --debug keeps the bookkeeping.
        const noted = applyCliWriteGuidance(text({ ...payload, warning: 'heads up' }) as never, 'block', false);
        expect(noted.hideResult).toBeUndefined();
        expect(JSON.parse((noted.result.content[0] as { text: string }).text)).toEqual({ warning: 'heads up' });
        const debug = JSON.parse((applyCliWriteGuidance(text(payload) as never, 'block', false, true).result.content[0] as { text: string }).text);
        expect(debug).toMatchObject({ requestId: 'ed8a', expectedStateHash: '623e', preflight: { version: 2 } });
        // --json is unchanged apart from the commit command.
        const json = JSON.parse((applyCliWriteGuidance(text(payload) as never, 'block').result.content[0] as { text: string }).text);
        expect(json).toMatchObject({ requestId: 'ed8a', expectedStateHash: '623e', preview: payload.preview });
        expect(formatPreflightFooter('cmd', 1793257578371)).toMatch(/^\nPreflight valid \(expires \d\d:\d\d:\d\d\) — check/);
    });

    it('turns a commit receipt safety block into one status line', () => {
        const safety = { requestId: '92a0', writeSafetyMode: 'strict', writeSafetyGuaranteed: true, writeAttempted: true, writeExecuted: true, replayed: false, transactionState: 'committed', previousHash: '623e', resultHash: '0c2b' };
        const human = applyCliWriteGuidance(text({ success: true, id: 'b1', restoredAttrs: { b1: ['custom-a'] }, safety }) as never, 'block', false);
        expect(human.statusLine).toBe('Write: committed · request 92a0');
        expect(JSON.parse((human.result.content[0] as { text: string }).text)).toEqual({ success: true, id: 'b1', restoredAttrs: { b1: ['custom-a'] } });
        expect(applyCliWriteGuidance(text({ success: true, safety }) as never, 'block').result).toEqual(text({ success: true, safety }));
        expect(formatSafetyStatus({ ...safety, transactionState: 'no_change' })).toBe('Write: no change — the target already had this content · request 92a0');
        expect(formatSafetyStatus({ ...safety, writeSafetyGuaranteed: false, reason: 'external_uncontrolled' })).toContain('not covered by strict write safety (external_uncontrolled)');
        // A replay whose ledger kept only the receipt is the safety record itself.
        const replay = applyCliWriteGuidance(text({ ...safety, replayed: true, writeAttempted: false, writeExecuted: false }) as never, 'block', false);
        expect(replay).toMatchObject({ hideResult: true, statusLine: 'Write: replayed — this request ID already ran; nothing was executed again · request 92a0' });
    });

    it('orders a one-step receipt as result, preview, status', () => {
        const preview = { targets: [{ id: 'd1', kind: 'document' }], changes: [{ kind: 'create_blocks', summary: 'Creates 1 block.' }], risk: [] };
        const human = applyCliWriteGuidance(text({ success: true, id: 'b9', oneStep: { tier: 1 }, preview, safety: { requestId: 'e0c4', transactionState: 'committed', replayed: false } }) as never, 'block', false);
        expect(human.previewFirst).toBeUndefined();
        expect(human.previewLines?.[0]).toBe('Preview (committed in one step, tier 1; verify it matches the intent):');
        expect(human.statusLine).toBe('Write: committed · one step (tier 1: additive or name-only change, no --if-match needed) · request e0c4');
        expect(JSON.parse((human.result.content[0] as { text: string }).text)).toEqual({ success: true, id: 'b9' });
    });

    it('keeps the av create default-column note on a commit receipt', () => {
        const payload = { success: true, avID: 'av-1', defaultColumns: [{ keyID: 'k-1', name: '单选' }],
            removeDefaultColumn: { tool: 'av', arguments: { action: 'remove_column', avID: 'av-1', keyID: 'k-1', validateOnly: true } },
            safety: { requestId: 'r1', transactionState: 'committed' } };
        const human = applyCliWriteGuidance(text(payload) as never, 'av', false);
        expect(human.statusLine).toBe('Write: committed · request r1');
        expect(JSON.parse((human.result.content[0] as { text: string }).text).defaultColumnNote).toContain('av remove-column --av-id av-1 --key-id k-1 --validate-only');
    });

    it('splits find_replace targets into will-change and scanned, and prints recovery notes', () => {
        const lines = formatWritePreview({
            targets: [{ id: 'b2', kind: 'block', excerpt: 'has 进度', matchCount: 1 }],
            changes: [{ kind: 'find_replace', summary: 'Replaces 1 match(es).', unchangedScopeCount: 3, unchangedScopeIds: ['b1', 'b3', 'b4'] }],
            risk: ['irreversible'],
        });
        expect(lines).toContain('  Will change:');
        expect(lines).toContain('    - block b2 "has 进度" — 1 match(es)');
        expect(lines).toContain('  Scanned, no match (3): b1, b3, b4');
        expect(lines.join('\n')).not.toContain('unchangedScopeIds');
        const deletion = formatWritePreview({ targets: [], changes: [{ kind: 'delete', summary: 'Removes document.', recovery: 'SiYuan copies it into file history.' }], risk: ['deletes'] });
        expect(deletion).toContain('        recovery: SiYuan copies it into file history.');
    });

    it('leaves ordinary results untouched', () => {
        const original = text({ success: true, id: 'x' });
        expect(applyCliWriteGuidance(original as never, 'document').result).toBe(original);
    });
});
