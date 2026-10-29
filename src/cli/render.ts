import type { ToolResult } from '../tools/internal/shared';
import { isActionHelpPayload, isHelpIndexPayload } from '../shared/help-payload';
import { translatePresentationPayload, translatePresentationText } from '../shared/invocation-format';
import { isRecord as isObject } from '../shared/record';

export interface RenderOptions {
    json: boolean;
    debug: boolean;
}

export interface PaginationInfo {
    page: number;
    pageCount: number;
    hasNextPage: boolean;
}

type Tone = 'success' | 'info' | 'warning' | 'error' | 'muted';
type OutputStream = Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;

const ANSI = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
};

const SUMMARY_KEY_PRIORITY = [
    'id',
    // Flashcards: review/remove take cardID, not the block's id.
    'cardID',
    'name',
    // Timeline nodes: compare/rollback take the tag.
    'tag',
    // Notebook lists: what this client may do there matters more than paths.
    'permission',
    'title',
    'path',
    'hpath',
    'notebook',
    'box',
    'rootID',
    'blockID',
    'docID',
    'avID',
    'deckID',
    'status',
    'version',
    'count',
    'total',
    'page',
    'pageCount',
];

const SUMMARY_KEY_PRIORITY_MAP = new Map(SUMMARY_KEY_PRIORITY.map((key, index) => [key, index]));

function supportsColor(stream: OutputStream): boolean {
    return Boolean(stream.isTTY);
}

function paint(stream: OutputStream, code: string, text: string): string {
    return supportsColor(stream) ? `${code}${text}${ANSI.reset}` : text;
}

function toneCode(tone: Tone): string {
    switch (tone) {
        case 'success': return ANSI.green + ANSI.bold;
        case 'warning': return ANSI.yellow + ANSI.bold;
        case 'error': return ANSI.red + ANSI.bold;
        case 'muted': return ANSI.dim;
        case 'info':
        default:
            return ANSI.cyan + ANSI.bold;
    }
}

function writeLine(stream: OutputStream, text = ''): void {
    stream.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function writeHeading(title: string, stream: OutputStream = process.stdout): void {
    writeLine(stream, paint(stream, ANSI.bold, title));
}

export function writeStatus(tone: Tone, text: string, stream: OutputStream = process.stdout): void {
    const icon = tone === 'success'
        ? '✓'
        : tone === 'warning'
            ? '!'
            : tone === 'error'
                ? '✗'
                : '•';
    writeLine(stream, paint(stream, toneCode(tone), `${icon} ${text}`));
}

export function writeMuted(text: string, stream: OutputStream = process.stdout): void {
    writeLine(stream, paint(stream, ANSI.dim, text));
}

export function writeSection(title: string, stream: OutputStream = process.stdout): void {
    writeLine(stream);
    writeLine(stream, paint(stream, ANSI.cyan + ANSI.bold, title));
}

export function writeBulletList(
    items: string[],
    stream: OutputStream = process.stdout,
    tone: Tone = 'info',
): void {
    for (const item of items) {
        writeLine(stream, `${paint(stream, toneCode(tone), '  •')} ${item}`);
    }
}

export function writeKeyValueRows(
    entries: Array<{ key: string; value: unknown }>,
    stream: OutputStream = process.stdout,
): void {
    if (entries.length === 0) return;
    const labels = entries.map((entry) => humanizeKey(entry.key));
    const width = Math.max(...labels.map((label) => label.length));

    for (let i = 0; i < entries.length; i++) {
        const label = labels[i].padEnd(width);
        writeLine(stream, `  ${paint(stream, ANSI.bold, `${label}:`)} ${formatField(entries[i].key, entries[i].value, true)}`);
    }
}

export function writeHint(label: string, text: string, stream: OutputStream = process.stdout): void {
    writeLine(stream, `${paint(stream, ANSI.dim + ANSI.bold, `${label}:`)} ${text}`);
}

export function renderCliError(error: unknown, options: { debug?: boolean; exitHint?: string } = {}): void {
    const out = process.stderr;
    const message = translatePresentationText(error instanceof Error ? error.message : String(error), 'cli');
    writeStatus('error', message, out);

    if (options.exitHint) {
        writeHint('Hint', translatePresentationText(options.exitHint, 'cli'), out);
    }

    if (options.debug && error instanceof Error && error.stack) {
        writeLine(out, error.stack);
    }
}

/**
 * Write a ToolResult to stdout/stderr and return the correct exit code.
 * - --json: emit the raw JSON text (compact single-line if parseable) to stdout.
 * - default: emit a human-readable summary and fall back to pretty JSON when needed.
 */
export function renderToolResult(result: ToolResult, options: RenderOptions): number {
    const firstText = result.content.find((item) => item.type === 'text')?.text ?? '';

    let payload: unknown;
    try {
        payload = firstText ? JSON.parse(firstText) : null;
    } catch {
        process.stdout.write(firstText);
        if (!firstText.endsWith('\n')) process.stdout.write('\n');
        return result.isError ? 1 : 0;
    }

    payload = translatePresentationPayload(payload, 'cli');

    if (options.json) {
        const nonTextContent = result.content.filter((item) => item.type !== 'text');
        if (nonTextContent.length > 0) {
            payload = isObject(payload)
                ? { ...payload, content: nonTextContent }
                : { value: payload, content: nonTextContent };
        }
        return emitJson(payload, result.isError);
    }

    if (result.isError) {
        renderErrorPayload(payload);
        return 1;
    }

    renderSuccessPayload(flattenAvRowCells(payload));
    return 0;
}

/**
 * AV query rows carry cells keyed by column ID, which the generic renderer
 * cannot show. For human output, label each cell with its column name.
 */
export function flattenAvRowCells(payload: unknown): unknown {
    if (!isObject(payload) || !Array.isArray(payload.rows) || !Array.isArray(payload.columns)) return payload;
    const names = new Map<string, string>();
    for (const column of payload.columns) {
        if (!isObject(column)) continue;
        const id = typeof column.columnID === 'string' ? column.columnID : typeof column.id === 'string' ? column.id : '';
        if (id) names.set(id, typeof column.name === 'string' && column.name ? column.name : id);
    }
    if (names.size === 0) return payload;
    // One line per row, every non-empty cell in column order (the generic
    // list renderer would keep only four alphabetically sorted fields).
    const rows = payload.rows.map((row) => {
        if (!isObject(row) || !isObject(row.cells)) return row;
        const cells = row.cells as Record<string, unknown>;
        const parts = typeof row.rowID === 'string' ? [`Row ID: ${row.rowID}`] : [];
        for (const [columnID, name] of names) {
            const text = displayCellValue(cells[columnID]);
            if (text) parts.push(`${name}: ${text}`);
        }
        return parts.join(' · ');
    });
    return { ...payload, rows };
}

function displayCellValue(cell: unknown): string {
    if (!isObject(cell)) return '';
    if (typeof cell.formatted === 'string' && cell.formatted) return cell.formatted;
    const value = cell.value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        return value.map((item) => isObject(item) && typeof item.content === 'string' ? item.content : typeof item === 'string' ? item : '')
            .filter(Boolean).join(', ');
    }
    if (isObject(value) && typeof value.content === 'string') return value.content;
    return '';
}

export function extractPaginationInfo(result: ToolResult): PaginationInfo | null {
    if (result.isError) return null;

    const firstText = result.content.find((item) => item.type === 'text')?.text ?? '';
    let payload: unknown;
    try {
        payload = firstText ? JSON.parse(firstText) : null;
    } catch {
        return null;
    }

    payload = translatePresentationPayload(payload, 'cli');
    if (!isObject(payload)) return null;

    if (
        !Array.isArray(payload.data)
        || (typeof payload.total !== 'number' && payload.total !== null)
        || typeof payload.page !== 'number'
        || typeof payload.pageCount !== 'number'
    ) {
        return null;
    }

    return {
        page: payload.page,
        pageCount: payload.pageCount,
        hasNextPage: typeof payload.hasNextPage === 'boolean'
            ? payload.hasNextPage
            : payload.page < payload.pageCount,
    };
}

function emitJson(payload: unknown, isError?: boolean): number {
    process.stdout.write(JSON.stringify(payload) + '\n');
    return isError ? 1 : 0;
}

function renderErrorPayload(payload: unknown): void {
    const out = process.stderr;

    if (isObject(payload) && isObject(payload.error)) {
        const err = payload.error as Record<string, unknown>;
        const type = typeof err.type === 'string' ? err.type : typeof err.code === 'string' ? err.code : 'error';
        const message = typeof err.message === 'string' ? err.message : 'Unknown error';

        writeStatus('error', `[${type}] ${message}`, out);

        if (Array.isArray(err.fields)) {
            const fieldLines = err.fields
                .filter(isObject)
                .map((field) => {
                    const path = typeof field.path === 'string' && field.path ? field.path : '(field)';
                    const fieldMessage = typeof field.message === 'string' ? field.message : 'Invalid value';
                    return `${paint(out, ANSI.yellow + ANSI.bold, path)} — ${fieldMessage}`;
                });

            if (fieldLines.length > 0) {
                writeSection('Fields', out);
                writeBulletList(fieldLines, out, 'warning');
            }
        }

        if (typeof err.hint === 'string' && err.hint) {
            writeSection('Hint', out);
            writeLine(out, `  ${err.hint}`);
        }

        if (typeof err.details === 'string' && err.details) {
            writeSection('Details', out);
            writeLine(out, indentBlock(err.details, 2));
        }
        return;
    }

    writeStatus('error', `Error: ${prettyJson(payload)}`, out);
}

function renderSuccessPayload(payload: unknown): void {
    const out = process.stdout;

    if (typeof payload === 'string') {
        out.write(payload);
        if (!payload.endsWith('\n')) out.write('\n');
        return;
    }

    if (payload === null || payload === undefined) {
        writeStatus('success', 'Done', out);
        return;
    }

    if (Array.isArray(payload)) {
        writeStatus('info', `${payload.length} item${payload.length === 1 ? '' : 's'}`, out);
        renderArrayBlock(payload, 'Items', out);
        return;
    }

    if (!isObject(payload)) {
        writeLine(out, prettyJson(payload));
        return;
    }

    const obj = payload as Record<string, unknown>;

    if (isHelpIndexPayload(obj)) {
        renderHelpIndex(obj, out);
        return;
    }

    if (isActionHelpPayload(obj)) {
        renderActionHelp(obj, out);
        return;
    }

    const maybePaginated = obj as Record<string, any>;
    if (Array.isArray(maybePaginated.data) && (typeof maybePaginated.total === 'number' || maybePaginated.total === null) && typeof maybePaginated.page === 'number') {
        renderPaginatedResult(obj, out);
        return;
    }

    renderGenericObject(obj, out);
}

function renderPaginatedResult(obj: Record<string, unknown>, out: OutputStream): void {
    const data = Array.isArray(obj.data) ? obj.data : [];
    const total = typeof obj.total === 'number' ? obj.total : '?';
    const page = typeof obj.page === 'number' ? obj.page : 1;
    const pageCount = typeof obj.pageCount === 'number' ? obj.pageCount : '?';
    const pageSize = typeof obj.pageSize === 'number' ? obj.pageSize : undefined;

    writeStatus('success', `${data.length} of ${total} items · page ${page}/${pageCount}`, out);
    writeKeyValueRows(
        [
            ...(pageSize !== undefined ? [{ key: 'pageSize', value: pageSize }] : []),
            ...(typeof obj.hasNextPage === 'boolean' ? [{ key: 'hasNextPage', value: obj.hasNextPage }] : []),
        ],
        out,
    );

    renderArrayBlock(data, 'Items', out, { maxItems: data.length });

    if (obj.hasNextPage) {
        writeSection('Next Step', out);
        writeHint('Tip', 'More pages are available. In a TTY, press Enter/n for next page, or re-run with `--page <n>`.', out);
    }
}

function renderGenericObject(obj: Record<string, unknown>, out: OutputStream): void {
    const success = obj.success === true;
    const message = typeof obj.message === 'string' ? obj.message : undefined;
    const entries = Object.entries(obj).filter(([key]) => key !== 'success');

    if (success) {
        writeStatus('success', message ?? 'Success', out);
    } else if (message) {
        writeStatus('info', message, out);
    }

    const summaryEntries = pickSummaryEntries(entries, new Set(message ? ['message'] : []));
    if (summaryEntries.length > 0) {
        writeKeyValueRows(summaryEntries, out);
    }

    const renderedKeys = new Set(summaryEntries.map((entry) => entry.key));
    if (message) renderedKeys.add('message');

    const detailEntries = entries.filter(([key]) => !renderedKeys.has(key));
    if (detailEntries.length === 0) {
        if (!success && !message && summaryEntries.length === 0) {
            writeLine(out, prettyJson(obj));
        }
        return;
    }

    for (const [key, value] of detailEntries) {
        renderNamedValue(key, value, out);
    }
}

function renderNamedValue(key: string, value: unknown, out: OutputStream): void {
    if (value === undefined) return;

    if (Array.isArray(value)) {
        renderArrayBlock(value, humanizeKey(key), out);
        return;
    }

    writeSection(humanizeKey(key), out);

    if (isObject(value)) {
        const scalarEntries = getScalarEntries(value);
        if (scalarEntries.length > 0 && scalarEntries.length === Object.keys(value).length) {
            writeKeyValueRows(scalarEntries, out);
            return;
        }

        writeLine(out, indentBlock(prettyJson(value), 2));
        return;
    }

    writeLine(out, `  ${formatScalar(value)}`);
}

function renderArrayBlock(
    values: unknown[],
    title: string,
    out: OutputStream,
    options: { maxItems?: number } = {},
): void {
    if (values.length === 0) {
        writeSection(title, out);
        writeMuted('  No items.', out);
        return;
    }

    writeSection(title, out);

    const maxItems = options.maxItems ?? 10;
    const visible = values.slice(0, maxItems);
    for (const value of visible) {
        const summary = summarizeItem(value);
        if (summary) {
            writeLine(out, `  • ${summary}`);
            continue;
        }

        writeLine(out, indentBlock(prettyJson(value), 2));
    }

    if (values.length > visible.length) {
        writeMuted(`  … ${values.length - visible.length} more item(s) not shown. Use --json for full output.`, out);
    }
}

function renderHelpIndex(obj: Record<string, unknown>, out: OutputStream): void {
    const tool = typeof obj.tool === 'string' ? obj.tool : 'tool';
    writeHeading(`${tool} tool`, out);

    const guidance = toStringArray(obj.guidance);
    if (guidance.length > 0) {
        writeSection('Guidance', out);
        writeBulletList(guidance, out);
    }

    renderActionGroup('Common Actions', toStringArray(obj.commonActions), obj.actionSummaries, out);
    renderActionGroup('Advanced Actions', toStringArray(obj.advancedActions), obj.actionSummaries, out);

    const confirmation = toStringArray(obj.requiresConfirmation);
    if (confirmation.length > 0) {
        writeSection('Confirmation', out);
        writeBulletList(confirmation.map((action) => `${action} is destructive: double-check the preflight before running its commit command (the CLI asks no further question).`), out, 'warning');
    }

    if (typeof obj.detailsHint === 'string' && obj.detailsHint) {
        writeSection('Next Step', out);
        writeHint('Tip', obj.detailsHint, out);
    }
}

function renderActionHelp(obj: Record<string, unknown>, out: OutputStream): void {
    const tool = typeof obj.tool === 'string' ? obj.tool : 'tool';
    const action = typeof obj.action === 'string' ? obj.action : 'help';
    writeHeading(`${tool} ${action}`, out);

    if (typeof obj.hint === 'string' && obj.hint) {
        writeStatus('info', obj.hint, out);
    }

    if (Array.isArray(obj.writeWorkflow)) {
        writeSection('Write Flow (two steps)', out);
        writeBulletList([
            '1. Run the command with --validate-only. Nothing is written; it checks permissions and prints the exact commit command.',
            '2. Run the printed commit command unchanged (it carries --request-id and any --expected-*-hash).',
            '3. Read the target back to confirm. A preflight expires after 10 minutes or when the target changes; then preflight again.',
        ], out);
    }

    const shapes = toStringArray(obj.shapes);
    if (shapes.length > 0) {
        writeSection('Accepted Shapes', out);
        writeBulletList(shapes, out);
    }

    const required = normalizeRequiredFields(obj.requiredFields);
    if (required.length > 0) {
        writeSection('Required Fields', out);
        writeBulletList(required, out);
    }

    const examples = Array.isArray(obj.examples) ? obj.examples : [];
    if (examples.length > 0) {
        writeSection('Examples', out);
        renderCuratedHelpExamples(examples, out);
    } else if (obj.example !== undefined) {
        writeSection('Example', out);
        renderHelpExample(obj.example, out);
    }

    const guidance = toStringArray(obj.guidance);
    if (guidance.length > 0) {
        writeSection('Guidance', out);
        writeBulletList(guidance, out);
    }

    if (obj.requiresConfirmation === true) {
        writeSection('Safety', out);
        writeBulletList(['Destructive: AI agents should get the user\'s go-ahead first. The CLI asks no further question; running the commit command is the confirmation.'], out, 'warning');
    }

    if (typeof obj.fullDocResource === 'string' && obj.fullDocResource) {
        writeSection('Reference', out);
        writeHint('Resource', obj.fullDocResource, out);
    }
}

function renderActionGroup(
    title: string,
    actions: string[],
    actionSummaries: unknown,
    out: OutputStream,
): void {
    if (actions.length === 0) return;

    const summaries = isObject(actionSummaries) ? actionSummaries : {};
    writeSection(title, out);
    writeBulletList(
        actions.map((action) => {
            const summary = typeof summaries[action] === 'string' ? String(summaries[action]) : '';
            return summary ? `${action} — ${summary}` : action;
        }),
        out,
    );
}

function renderHelpExample(example: unknown, out: OutputStream): void {
    if (typeof example === 'string') {
        writeLine(out, `  ${example}`);
        return;
    }

    if (Array.isArray(example) && example.every((item) => typeof item === 'string')) {
        writeBulletList(example, out);
        return;
    }

    writeLine(out, indentBlock(prettyJson(example), 2));
}

function renderCuratedHelpExamples(examples: unknown[], out: OutputStream): void {
    for (const example of examples) {
        if (!isObject(example)) {
            renderHelpExample(example, out);
            continue;
        }

        const title = typeof example.title === 'string' ? example.title : 'Example';
        writeLine(out, `  ${paint(out, ANSI.bold, title)}`);

        if (typeof example.description === 'string' && example.description) {
            writeLine(out, `  ${example.description}`);
        }

        const command = example.mcp ?? example.command ?? example.example;
        if (command !== undefined) {
            renderHelpExample(command, out);
        }
    }
}

function pickSummaryEntries(
    entries: Array<[string, unknown]>,
    exclude: Set<string> = new Set(),
): Array<{ key: string; value: unknown }> {
    const scalarEntries = entries
        // Empty strings (unset name/alias/icon) would crowd out real fields.
        .filter(([key, value]) => !exclude.has(key) && isScalar(value) && value !== '')
        .map(([key, value]) => ({ key, value }));

    return scalarEntries
        .sort((a, b) => getKeyOrder(a.key) - getKeyOrder(b.key) || a.key.localeCompare(b.key))
        .slice(0, 8);
}

function getKeyOrder(key: string): number {
    return SUMMARY_KEY_PRIORITY_MAP.get(key) ?? SUMMARY_KEY_PRIORITY.length + 100;
}

function getScalarEntries(obj: Record<string, unknown>): Array<{ key: string; value: unknown }> {
    return Object.entries(obj)
        .filter(([, value]) => isScalar(value))
        .map(([key, value]) => ({ key, value }));
}

function summarizeItem(value: unknown): string | null {
    if (isScalar(value)) {
        return formatScalar(value);
    }

    if (!isObject(value)) return null;

    const scalarEntries = pickSummaryEntries(Object.entries(value));
    if (scalarEntries.length === 0) return null;

    return scalarEntries
        .slice(0, 4)
        .map((entry) => `${humanizeKey(entry.key)}: ${formatField(entry.key, entry.value)}`)
        .join(' · ');
}

function normalizeRequiredFields(value: unknown): string[] {
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        // An empty list means the schema has no unconditional field (multi-mode action).
        return value.length > 0 ? [value.join(', ')] : ['none fixed by the schema; see Examples for each mode'];
    }

    if (Array.isArray(value)) {
        return value
            .filter((item): item is string[] => Array.isArray(item) && item.every((part) => typeof part === 'string'))
            .map((parts) => parts.join(', '));
    }

    return [];
}

function toStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function prettyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function humanizeKey(key: string): string {
    // Data keys (file names, paths, tags) are values, not field names.
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) return key;
    // SiYuan search endpoints echo the keyword as `k`.
    if (key === 'k') return 'Query';
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .map((part) => {
            const lower = part.toLowerCase();
            if (lower === 'ids') return 'IDs';
            if (['id', 'url', 'api', 'sql', 'json', 'ocr', 'html'].includes(lower)) {
                return lower.toUpperCase();
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
}

const EPOCH_MS_KEYS = /^(created|updated|lastReview|due|expiresAt|requestIdExpiresAt|time)$/;

// Body text the caller asked to read; truncating it made readbacks look wrong.
const FULL_TEXT_KEYS = new Set(['markdown', 'documentMarkdown', 'kramdown', 'content']);

/** Epoch-millisecond timestamps read as dates; body text in full; other scalars as-is. */
function formatField(key: string, value: unknown, fullText = false): string {
    if (fullText && typeof value === 'string' && FULL_TEXT_KEYS.has(key)) {
        return value.includes('\n') ? `\n${indentBlock(value, 4)}` : value;
    }
    if (typeof value === 'number' && EPOCH_MS_KEYS.test(key) && value > 1e12 && value < 1e14) {
        const d = new Date(value);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return formatScalar(value);
}

function formatScalar(value: unknown): string {
    if (typeof value === 'string') return truncate(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value === null) return 'null';
    return prettyJson(value);
}

function truncate(value: string, max = 120): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
}

function indentBlock(value: string, spaces: number): string {
    const prefix = ' '.repeat(spaces);
    return value
        .split('\n')
        .map((line) => `${prefix}${line}`)
        .join('\n');
}

function isScalar(value: unknown): value is string | number | boolean | null {
    return typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean'
        || value === null;
}

