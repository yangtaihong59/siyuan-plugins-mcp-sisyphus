import { describe, expect, it } from 'vitest';

import { assertAvAddRowsHasInput, assertAvArgumentReferences } from '@/mcp/write-safety-av';

const AV = '20260104000000-avaaaaa';
const CARRIER = '20260104000009-carrier';
const ROW1 = '20260104000001-rowaaaa';
const VALUE1 = '20260104000003-valueaa';
const SRC1 = '20260104000004-srcaaaa';
const readback = {
    av: {
        id: AV,
        name: 'Tasks',
        keyValues: [
            { key: { id: 'k-name', name: 'Name', type: 'block' }, values: [{ id: VALUE1, blockID: ROW1, block: { id: SRC1, content: 'Write report' } }] },
            { key: { id: 'k-hours', name: 'Hours', type: 'number' }, values: [] },
        ],
    },
};

function rejection(action: string, args: Record<string, unknown>): Error & { code?: string } {
    try {
        assertAvArgumentReferences(action, { avID: AV, ...args }, readback);
    } catch (error) {
        return error as Error & { code?: string };
    }
    throw new Error('expected a rejection');
}

describe('AV preflight reference checks', () => {
    it('rejects a rename keyID that is not a column and lists the columns', () => {
        const error = rejection('rename', { keyID: '20260104000005-nosuchk', keyName: 'Task' });
        expect(error.code).toBe('invalid_arguments');
        expect(error.message).toContain('keyID "20260104000005-nosuchk" is not a column of database "Tasks"');
        expect(error.message).toContain('Name = k-name (block); Hours = k-hours (number)');
    });

    it('explains when the carrier block ID was passed as a column', () => {
        expect(rejection('rename', { blockID: CARRIER, keyID: CARRIER, keyName: 'x' }).message).toContain('(it is the database block ID)');
    });

    it('accepts existing columns and database-only renames', () => {
        expect(() => assertAvArgumentReferences('rename', { avID: AV, keyID: 'k-name', keyName: 'Task' }, readback)).not.toThrow();
        expect(() => assertAvArgumentReferences('rename', { avID: AV, name: 'New' }, readback)).not.toThrow();
    });

    it('checks set_cells rows and columns, suggesting the row for a value or source block ID', () => {
        expect(rejection('set_cells', { rowID: ROW1, columnID: 'k-missing' }).message).toContain('columnID "k-missing" is not a column');
        const alias = rejection('set_cells', { cells: [{ rowID: SRC1, columnID: 'k-hours' }] });
        expect(alias.message).toContain(`cells[0].rowID "${SRC1}" is not a row`);
        expect(alias.message).toContain(`It identifies row ${ROW1}`);
        expect(alias.message).toContain(`Write report = ${ROW1}`);
        expect(() => assertAvArgumentReferences('set_cells', { avID: AV, cells: [{ rowID: ROW1, columnID: 'k-hours' }] }, readback)).not.toThrow();
    });

    it('checks remove_column, remove_rows, duplicate_rows, add_column and composite add_rows', () => {
        expect(rejection('remove_column', { columnID: 'k-x' }).message).toContain('columnID "k-x"');
        expect(rejection('remove_rows', { rowIDs: [ROW1, 'k-hours'] }).message).toContain('rowIDs[1] "k-hours" is not a row of database "Tasks" (20260104000000-avaaaaa) (it is a column ID)');
        expect(rejection('duplicate_rows', { sourceRowIDs: ['20260104000006-nothing'] }).message).toContain('sourceRowIDs[0]');
        expect(rejection('add_column', { keyID: 'k-hours', keyName: 'x', keyType: 'text' }).message).toContain('already names a column');
        expect(rejection('add_column', { previousKeyID: 'k-x', keyName: 'x', keyType: 'text' }).message).toContain('previousKeyID');
        expect(rejection('add_rows', { rows: [{ clientKey: 'a', primaryKeyText: 'A', cells: [{ columnID: 'k-x' }] }] }).message).toContain('rows[0].cells[0].columnID');
        expect(() => assertAvArgumentReferences('remove_rows', { avID: AV, srcIDs: ['anything'] }, readback)).not.toThrow();
    });

    it('rejects add_rows without any row', () => {
        expect(() => assertAvAddRowsHasInput({ avID: AV })).toThrow(/at least one row/);
        expect(() => assertAvAddRowsHasInput({ avID: AV, primaryKeyTexts: [] })).toThrow(/at least one row/);
        expect(() => assertAvAddRowsHasInput({ avID: AV, primaryKeyTexts: ['A'] })).not.toThrow();
    });
});
