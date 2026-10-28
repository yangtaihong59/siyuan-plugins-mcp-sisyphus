import { describe, expect, it } from 'vitest';
import { applyCliWriteGuidance, buildCliCommand, CLI_PREFLIGHT_HINT } from '@/cli/write-guidance';
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

    it('round-trips arrays and objects through -json flags the mapper accepts', () => {
        const commitArgs = { action: 'remove_card', deckID: 'd1', blockIDs: ['b1', 'b2'], requestId: 'c93e' };
        const command = buildCliCommand('flashcard', commitArgs);
        expect(command).toContain(`--block-ids-json '["b1","b2"]'`);
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

    it('leaves ordinary results untouched', () => {
        const original = text({ success: true, id: 'x' });
        expect(applyCliWriteGuidance(original as never, 'document').result).toBe(original);
    });
});
