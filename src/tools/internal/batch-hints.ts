/*
 * One-line hints appended to single-item write receipts, so a caller that
 * repeats the same action per item learns the batch form. Batch calls never
 * carry them.
 */
export const BATCH_HINTS = {
    avAddRows: 'add_rows takes rows:[{clientKey,primaryKeyText,cells}] (≤200) to create rows with their cells, dates included, in one call.',
    avSetCells: 'set_cells takes cells:[{rowID,columnID,valueType,...}] to update many cells in one call.',
    documentRename: 'rename takes items:[{id,title}] (≤50) to rename many documents in one call.',
    documentMove: 'move takes several fromIDs (or fromPaths) in one call.',
    fsMv: 'mv takes items:[{from,to}] (≤20) to move many documents in one call.',
} as const;
