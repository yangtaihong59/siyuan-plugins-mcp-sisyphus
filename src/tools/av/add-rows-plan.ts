import { generateSiYuanNodeId } from '../../shared/siyuan-id';
import { asRecord } from '../../shared/record';

/** One composite add_rows batch may not be split into an unbounded write. */
export const AV_ADD_ROWS_MAX_ROWS = 200;

export type AvAddRowsStage = 'reserved' | 'rows_created' | 'cells_written' | 'verified';

export interface AvAddRowsProgressRow {
    index: number;
    clientKey: string;
    rowID: string;
    cellCount: number;
    rowResolved?: boolean;
}

export interface AvAddRowsProgress {
    stage: AvAddRowsStage;
    currentStep: string;
    rows: AvAddRowsProgressRow[];
}

export interface AvAddRowsPlanRow {
    index: number;
    clientKey: string;
    primaryKeyText: string;
    rowID: string;
    srcID: string;
    cells: Array<Record<string, unknown>>;
}

export interface AvAddRowsPlan {
    rows: AvAddRowsPlanRow[];
}

export interface AvAddRowsContext {
    plan: AvAddRowsPlan;
    checkpoint(progress: AvAddRowsProgress): Promise<void>;
}

/** In-process hand-off only; never serialized into tool arguments. */
export const AV_ADD_ROWS_CONTEXT = Symbol.for('siyuan.sisyphus.avAddRowsContext');

const VALUE_TYPE_TO_KEY_TYPE: Record<string, string> = {
    text: 'text',
    number: 'number',
    date: 'date',
    checkbox: 'checkbox',
    select: 'select',
    multi_select: 'mSelect',
    relation: 'relation',
    url: 'url',
    email: 'email',
    phone: 'phone',
    mAsset: 'mAsset',
};

const UNWRITABLE_KEY_TYPES = new Set([
    'block',
    'created',
    'updated',
    'template',
    'rollup',
    'lineNumber',
]);

// First phase intentionally accepts only scalar cell types whose write effect
// is confined to this AV cell. Relation and rollup/template fields can mutate
// or depend on another AV; they need a destination-scope permission and hash
// proof that add_rows does not yet have. Keep them on the dedicated actions.
const WRITABLE_KEY_TYPES = new Set(
    Object.values(VALUE_TYPE_TO_KEY_TYPE).filter((keyType) => keyType !== 'relation'),
);

function validationError(message: string): Error & { code: string } {
    return Object.assign(new Error(message), { name: 'AvAddRowsValidationError', code: 'validation_error' });
}

function rawDefinition(avData: unknown): Record<string, unknown> {
    const envelope = asRecord(avData);
    const definition = envelope && asRecord(envelope.av) ? envelope.av as Record<string, unknown> : envelope;
    if (!definition || !Array.isArray(definition.keyValues)) {
        throw validationError('The current attribute view has no readable raw definition. No rows were added.');
    }
    return definition;
}

function columnTypes(definition: Record<string, unknown>): Map<string, string> {
    const columns = new Map<string, string>();
    for (const entry of definition.keyValues as unknown[]) {
        const key = asRecord(asRecord(entry)?.key);
        const id = typeof key?.id === 'string' ? key.id : '';
        const type = typeof key?.type === 'string' ? key.type : '';
        if (id && type) columns.set(id, type);
    }
    return columns;
}

function assertTargetView(definition: Record<string, unknown>, viewID?: string, groupID?: string): void {
    if (groupID && !viewID) {
        throw validationError('groupID requires an explicit viewID so the target group and default fill can be validated. No rows were added.');
    }
    if (!viewID) return;
    const views = Array.isArray(definition.views) ? definition.views : [];
    const matches = views.filter((view) => asRecord(view)?.id === viewID);
    if (matches.length !== 1) {
        throw validationError(`viewID "${viewID}" does not resolve exactly once in the current attribute view. No rows were added.`);
    }
    if (groupID) {
        const groups = asRecord(matches[0])?.groups;
        const groupMatches = Array.isArray(groups)
            ? groups.filter((group) => asRecord(group)?.id === groupID)
            : [];
        if (groupMatches.length !== 1) {
            throw validationError(`groupID "${groupID}" does not resolve exactly once in view "${viewID}". No rows were added.`);
        }
    }
}

/**
 * Validate every row, column, type, target view, and existing previousID
 * before any write. Structural failures therefore produce zero writes.
 */
export function assertAvAddRowsStructure(
    avData: unknown,
    rows: unknown,
    viewID?: string,
    groupID?: string,
    previousID?: string,
): void {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw validationError('rows must contain at least one row. No rows were added.');
    }
    if (rows.length > AV_ADD_ROWS_MAX_ROWS) {
        throw validationError(`rows exceeds the ${AV_ADD_ROWS_MAX_ROWS}-row limit. Split the batch; no rows were added.`);
    }
    const definition = rawDefinition(avData);
    const columns = columnTypes(definition);
    const clientKeys = new Set<string>();

    rows.forEach((rawRow, index) => {
        const row = asRecord(rawRow);
        if (!row) throw validationError(`rows[${index}] must be an object. No rows were added.`);
        const clientKey = typeof row.clientKey === 'string' ? row.clientKey.trim() : '';
        if (!clientKey) throw validationError(`rows[${index}].clientKey is required. No rows were added.`);
        if (clientKeys.has(clientKey)) {
            throw validationError(`rows[${index}].clientKey "${clientKey}" is duplicated within the batch. No rows were added.`);
        }
        clientKeys.add(clientKey);
        const primaryKeyText = typeof row.primaryKeyText === 'string' ? row.primaryKeyText : '';
        if (!primaryKeyText.trim()) {
            throw validationError(`rows[${index}].primaryKeyText must not be blank. No rows were added.`);
        }
        const cells = row.cells ?? [];
        if (!Array.isArray(cells)) {
            throw validationError(`rows[${index}].cells must be an array. No rows were added.`);
        }
        const seenColumns = new Set<string>();
        cells.forEach((rawCell, cellIndex) => {
            const cell = asRecord(rawCell);
            if (!cell) throw validationError(`rows[${index}].cells[${cellIndex}] must be an object. No rows were added.`);
            const columnID = typeof cell.columnID === 'string' ? cell.columnID : '';
            const keyType = columns.get(columnID);
            if (!columnID || !keyType) {
                throw validationError(`rows[${index}].cells[${cellIndex}].columnID "${columnID || '<missing>'}" does not exist in the current attribute view. No rows were added.`);
            }
            if (UNWRITABLE_KEY_TYPES.has(keyType)) {
                throw validationError(`Column "${columnID}" has type "${keyType}", which cannot be written through add_rows cells. No rows were added.`);
            }
            const valueType = typeof cell.valueType === 'string' ? cell.valueType : '';
            if (valueType === 'relation' || keyType === 'relation') {
                throw validationError(`Column "${columnID}" is a relation. Use av(action="set_relation") after the rows exist so both the source and destination databases can be preflighted. No rows were added.`);
            }
            if (!WRITABLE_KEY_TYPES.has(keyType)) {
                throw validationError(`Column "${columnID}" has type "${keyType}", which is not a supported initial-cell type. Use a scalar column or write the field after the rows exist. No rows were added.`);
            }
            if (VALUE_TYPE_TO_KEY_TYPE[valueType] !== keyType) {
                throw validationError(`rows[${index}].cells[${cellIndex}].valueType "${valueType || '<missing>'}" does not match column "${columnID}" type "${keyType}". No rows were added.`);
            }
            if (seenColumns.has(columnID)) {
                throw validationError(`rows[${index}] addresses column "${columnID}" more than once. No rows were added.`);
            }
            seenColumns.add(columnID);
        });
    });

    assertTargetView(definition, viewID, groupID);

    if (previousID) {
        const rowIDs = new Set<string>();
        for (const entry of definition.keyValues as unknown[]) {
            const values = asRecord(entry)?.values;
            if (!Array.isArray(values)) continue;
            for (const value of values) {
                const rowID = asRecord(value)?.blockID;
                if (typeof rowID === 'string' && rowID) rowIDs.add(rowID);
            }
        }
        if (!rowIDs.has(previousID)) {
            throw validationError(`previousID "${previousID}" is not an existing row item ID in the current attribute view. No rows were added.`);
        }
    }
}

/**
 * Stable identities are generated before the insert transaction and persisted
 * by the coordinator's stage ledger. The handler must use exactly these IDs.
 */
export function createAvAddRowsPlan(rows: unknown[]): AvAddRowsPlan {
    return {
        rows: rows.map((rawRow, index) => {
            const row = asRecord(rawRow)!;
            return {
                index,
                clientKey: String(row.clientKey),
                primaryKeyText: String(row.primaryKeyText),
                rowID: generateSiYuanNodeId(),
                srcID: generateSiYuanNodeId(),
                cells: Array.isArray(row.cells)
                    ? row.cells.map((cell) => ({ ...(asRecord(cell) ?? {}) }))
                    : [],
            };
        }),
    };
}

export function summarizeAvAddRowsPlan(plan: AvAddRowsPlan, stage: AvAddRowsStage, currentStep: string, resolved = false): AvAddRowsProgress {
    return {
        stage,
        currentStep,
        rows: plan.rows.map((row) => ({
            index: row.index,
            clientKey: row.clientKey,
            rowID: row.rowID,
            cellCount: row.cells.length,
            ...(stage === 'reserved' ? {} : { rowResolved: resolved }),
        })),
    };
}
