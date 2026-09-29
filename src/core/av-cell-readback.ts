import { safetyError } from './write-safety-ledger';

/** Verify requested cell semantics; kernel-assigned colors and display text are not input values. */
export function verifyAvCellsReadback(args: Record<string, any>, definition: Record<string, any>): void {
    const cells = args.cells ?? args.items ?? [args];
    // A batch may address a cell more than once: the last operation is its postimage.
    const finalCells = new Map<string, Record<string, any>>();
    for (const cell of cells) finalCells.set(`${cell.columnID}:${cell.rowID}`, cell);
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const millis = (value: string | number) => typeof value === 'number' ? value : Date.parse(value);
    for (const cell of finalCells.values()) {
        const column = definition.keyValues?.find((entry: any) => entry.key?.id === cell.columnID);
        const value = column?.values?.find((entry: any) => entry.blockID === cell.rowID);
        let matches = false;
        if (value) {
            switch (cell.valueType) {
                case 'text': case 'url': case 'email': case 'phone':
                    matches = value[cell.valueType]?.content === cell[cell.valueType];
                    break;
                case 'select':
                    matches = same(value.mSelect?.map((option: any) => option.content), [cell.option]);
                    break;
                case 'multi_select':
                    matches = same(value.mSelect?.map((option: any) => option.content).sort(), [...new Set(cell.options ?? [])].sort());
                    break;
                case 'number':
                    matches = value.number?.isNotEmpty === true && value.number.content === cell.number
                        && (cell.numberFormat === undefined || value.number.format === cell.numberFormat);
                    break;
                case 'checkbox':
                    matches = value.checkbox?.checked === Boolean(cell.checked);
                    break;
                case 'date':
                    matches = value.date?.isNotEmpty === true && value.date.content === millis(cell.date)
                        && Boolean(value.date.hasEndDate) === (cell.endDate !== undefined)
                        && Boolean(value.date.isNotTime) === (cell.includeTime === false)
                        && (cell.endDate === undefined || value.date.content2 === millis(cell.endDate));
                    break;
                case 'mAsset':
                    matches = same(value.mAsset?.map((asset: any) => [asset.type, asset.name ?? '', asset.content]),
                        (cell.assets ?? []).map((asset: any) => [asset.type, asset.name ?? '', asset.content]))
                        && (cell.text === undefined || value.text?.content === cell.text);
                    break;
            }
        }
        if (!matches) {
            throw safetyError('readback_mismatch', `AV cell ${cell.rowID}/${cell.columnID} did not retain its requested ${cell.valueType} value. Inspect the target before retrying.`);
        }
    }
}
