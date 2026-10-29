import { PRIMARY_CLI_COMMAND } from '../shared/constants';
import { isActionHelpPayload, isHelpIndexPayload } from './help-payload';

export type PresentationTarget = 'mcp' | 'cli';

export interface ActionRefToken {
    kind: 'action-ref';
    tool: string;
    action: string;
}

export interface ActionCallToken {
    kind: 'action-call';
    tool: string;
    action: string;
    args?: Record<string, unknown>;
}

export interface FieldRefToken {
    kind: 'field-ref';
    field: string;
}

export type TextFragment = string | ActionRefToken | ActionCallToken | FieldRefToken;

const FIELD_STOPWORDS = new Set([
    'action',
    'as',
    'only',
    'optional',
    'required',
    'requires',
    'mode',
]);

export function formatFieldRef(field: string, target: PresentationTarget): string {
    return target === 'cli' ? `--${toKebab(field)}` : field;
}

export function formatActionRef(tool: string, action: string, target: PresentationTarget): string {
    if (target === 'cli') {
        return `${PRIMARY_CLI_COMMAND} ${tool} ${toKebab(action)}`;
    }
    return `${tool}(action="${action}")`;
}

export function formatActionCall(
    tool: string,
    action: string,
    args: Record<string, unknown> = {},
    target: PresentationTarget,
): string {
    if (target === 'cli') {
        const cliArgs = Object.entries(args)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => formatCliArgument(key, value));
        return [PRIMARY_CLI_COMMAND, tool, toKebab(action), ...cliArgs].join(' ').trim();
    }

    const pairs = Object.entries(args)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${formatMcpValue(value)}`);
    return `${tool}(action="${action}"${pairs.length > 0 ? `, ${pairs.join(', ')}` : ''})`;
}

export function renderTextFragments(fragments: TextFragment[], target: PresentationTarget): string {
    return fragments.map((fragment) => {
        if (typeof fragment === 'string') return fragment;
        if (fragment.kind === 'field-ref') return formatFieldRef(fragment.field, target);
        if (fragment.kind === 'action-ref') return formatActionRef(fragment.tool, fragment.action, target);
        return formatActionCall(fragment.tool, fragment.action, fragment.args, target);
    }).join('');
}

export function translatePresentationText(text: string, target: PresentationTarget): string {
    if (target === 'mcp' || !text) return text;

    let translated = text;

    translated = translated.replace(/siyuan:\/\/help\/action\/([a-z_]+)\/([a-z_]+)/g, (_match, tool: string, action: string) =>
        `${PRIMARY_CLI_COMMAND} ${tool} ${toKebab(action)}`,
    );
    translated = translated.replace(/siyuan:\/\/help\/tool-overview/g, `${PRIMARY_CLI_COMMAND} list`);
    translated = translated.replace(/siyuan:\/\/help\/examples/g, `${PRIMARY_CLI_COMMAND} help <tool> <action>`);
    translated = translated.replace(/siyuan:\/\/help\/ai-layout-guide/g, `${PRIMARY_CLI_COMMAND} help document create`);

    translated = translated.replace(/\b([a-z]+)\(action=["”“]([a-z_]+)["”“](?:,\s*([^)]*))?\)/g, (_match, tool: string, action: string, rawArgs?: string) => {
        const args = parseActionArgs(rawArgs);
        if (action === 'help') {
            const topic = typeof args.topic === 'string' ? stripQuotes(args.topic).trim() : '';
            return topic ? `${PRIMARY_CLI_COMMAND} help ${tool} ${toKebab(topic)}` : `${PRIMARY_CLI_COMMAND} help ${tool}`;
        }
        return formatActionCall(tool, action, args, 'cli');
    });

    translated = translated.replace(/\b([A-Za-z][A-Za-z0-9_]*)(\s*\+\s*[A-Za-z][A-Za-z0-9_]*)+\b/g, (match) =>
        translateFieldSequence(match, '+'),
    );
    translated = translated.replace(/\brequires:\s*([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)*)/g, (_match, fields: string) =>
        `requires: ${fields.split(/\s*,\s*/).map((field) => formatFieldRef(field, 'cli')).join(', ')}`,
    );

    if (/^[A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)+$/.test(translated)) {
        return translated.split(/\s*,\s*/).map((field) => formatFieldRef(field, 'cli')).join(', ');
    }

    if (translated === 'action only') {
        return 'command only';
    }

    return translated;
}

export function translatePresentationPayload(payload: unknown, target: PresentationTarget): unknown {
    if (target === 'mcp' || !isObject(payload)) return payload;

    if (isActionHelpPayload(payload)) {
        const translated = { ...payload } as Record<string, unknown>;
        if (typeof translated.hint === 'string') translated.hint = translatePresentationText(translated.hint, target);
        if (Array.isArray(translated.shapes)) translated.shapes = translated.shapes.map((item) => typeof item === 'string' ? translatePresentationText(item, target) : item);
        translated.requiredFields = translateRequiredFields(translated.requiredFields, target);
        translated.example = translateActionHelpExample(translated.tool, translated.action, translated.example, target);
        if (Array.isArray(translated.examples)) {
            translated.examples = translated.examples.map((item) =>
                translateCuratedActionHelpExample(translated.tool, translated.action, item, target),
            );
        }
        if (Array.isArray(translated.guidance)) translated.guidance = translated.guidance.map((item) => typeof item === 'string' ? translatePresentationText(item, target) : item);
        if (typeof translated.fullDocResource === 'string') translated.fullDocResource = `${PRIMARY_CLI_COMMAND} help ${translated.tool} ${toKebab(String(translated.action))}`;
        return translated;
    }

    if (isHelpIndexPayload(payload)) {
        const translated = { ...payload } as Record<string, unknown>;
        if (Array.isArray(translated.guidance)) translated.guidance = translated.guidance.map((item) => typeof item === 'string' ? translatePresentationText(item, target) : item);
        if (isObject(translated.actionSummaries)) {
            translated.actionSummaries = Object.fromEntries(
                Object.entries(translated.actionSummaries).map(([key, value]) => [
                    key,
                    typeof value === 'string' ? translatePresentationText(value, target) : value,
                ]),
            );
        }
        if (isObject(translated.actions)) {
            translated.actions = Object.fromEntries(
                Object.entries(translated.actions).map(([key, value]) => {
                    if (!isObject(value) || typeof value.hint !== 'string') return [key, value];
                    return [key, { ...value, hint: translatePresentationText(value.hint, target) }];
                }),
            );
        }
        if (typeof translated.detailsHint === 'string') translated.detailsHint = translatePresentationText(translated.detailsHint, target);
        if (Array.isArray(translated.helpResources)) translated.helpResources = translated.helpResources.map((item) => typeof item === 'string' ? translatePresentationText(item, target) : item);
        return translated;
    }

    if (isObject(payload.error)) {
        const error = payload.error as Record<string, unknown>;
        return {
            ...payload,
            error: {
                ...error,
                // Messages can name a call too ("…use document(action=\"query\")").
                ...(typeof error.message === 'string' ? { message: translatePresentationText(error.message, target) } : {}),
                ...(typeof error.hint === 'string' ? { hint: translatePresentationText(error.hint, target) } : {}),
                ...(typeof error.details === 'string' ? { details: translatePresentationText(error.details, target) } : {}),
            },
        };
    }

    return translateKnownTextFields(payload, target);
}

function translateKnownTextFields(payload: Record<string, unknown>, target: PresentationTarget): Record<string, unknown> {
    const translated: Record<string, unknown> = { ...payload };
    for (const key of ['hint', 'detailsHint', 'databaseNote']) {
        if (typeof translated[key] === 'string') {
            translated[key] = translatePresentationText(translated[key], target);
        }
    }
    for (const key of ['guidance', 'hints']) {
        if (Array.isArray(translated[key])) {
            translated[key] = translated[key].map((item) => typeof item === 'string' ? translatePresentationText(item, target) : item);
        }
    }
    return translated;
}

function translateActionHelpExample(tool: unknown, action: unknown, example: unknown, target: PresentationTarget): unknown {
    if (target !== 'cli' || typeof tool !== 'string' || typeof action !== 'string') return example;

    if (Array.isArray(example)) {
        return example.map((item) => translateActionHelpExample(tool, action, item, target));
    }

    if (!isObject(example)) {
        return typeof example === 'string' ? translatePresentationText(example, target) : example;
    }

    const args = { ...example };
    delete args.action;
    return formatActionCall(tool, action, args, target);
}

function translateCuratedActionHelpExample(tool: unknown, action: unknown, example: unknown, target: PresentationTarget): unknown {
    if (target !== 'cli' || !isObject(example)) return example;

    const translated = { ...example };
    if (typeof translated.description === 'string') {
        translated.description = translatePresentationText(translated.description, target);
    }
    translated.mcp = translateActionHelpExample(tool, action, translated.mcp, target);
    return translated;
}

function translateRequiredFields(value: unknown, target: PresentationTarget): unknown {
    if (target !== 'cli') return value;

    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        return value.map((item) => formatFieldRef(item, target));
    }

    if (Array.isArray(value)) {
        return value.map((item) => {
            if (!Array.isArray(item)) return item;
            return item.map((part) => typeof part === 'string' ? formatFieldRef(part, target) : part);
        });
    }

    return value;
}

function translateFieldSequence(text: string, separator: '+' | '/'): string {
    const pattern = separator === '+' ? /\s*\+\s*/ : /\s*\/\s*/;
    const parts = text.split(pattern);
    if (parts.some((part) => !isLikelyFieldName(part))) return text;
    return parts.map((part) => formatFieldRef(part, 'cli')).join(` ${separator} `);
}

function isLikelyFieldName(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return false;
    if (FIELD_STOPWORDS.has(normalized.toLowerCase())) return false;
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(normalized);
}

function parseActionArgs(rawArgs?: string): Record<string, string> {
    if (!rawArgs) return {};

    const result: Record<string, string> = {};
    for (const chunk of splitTopLevel(rawArgs, ',')) {
        const segment = chunk.trim();
        if (!segment) continue;
        const eqIndex = segment.indexOf('=');
        if (eqIndex <= 0) continue;
        const key = segment.slice(0, eqIndex).trim();
        const value = segment.slice(eqIndex + 1).trim();
        if (!key) continue;
        result[key] = stripQuotes(value);
    }
    return result;
}

function splitTopLevel(text: string, separator: ',' | ' '): string[] {
    const items: string[] = [];
    let current = '';
    let singleQuoted = false;
    let doubleQuoted = false;
    let smartQuoted = false;
    let bracketDepth = 0;
    let braceDepth = 0;
    let parenDepth = 0;

    for (const char of text) {
        if (char === "'" && !doubleQuoted && !smartQuoted) {
            singleQuoted = !singleQuoted;
            current += char;
            continue;
        }
        if (char === '"' && !singleQuoted && !smartQuoted) {
            doubleQuoted = !doubleQuoted;
            current += char;
            continue;
        }
        if ((char === '“' || char === '”') && !singleQuoted && !doubleQuoted) {
            smartQuoted = !smartQuoted;
            current += char;
            continue;
        }

        if (!singleQuoted && !doubleQuoted && !smartQuoted) {
            if (char === '[') bracketDepth++;
            if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
            if (char === '{') braceDepth++;
            if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
            if (char === '(') parenDepth++;
            if (char === ')') parenDepth = Math.max(0, parenDepth - 1);

            if (char === separator && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
                items.push(current);
                current = '';
                continue;
            }
        }

        current += char;
    }

    if (current) items.push(current);
    return items;
}

function formatCliArgument(key: string, value: unknown): string {
    const flag = formatFieldRef(key, 'cli');
    if (Array.isArray(value) || isObject(value)) {
        return `${flag}-json '${JSON.stringify(value)}'`;
    }
    if (typeof value === 'boolean') return `${flag} ${value ? 'true' : 'false'}`;
    if (typeof value === 'number') return `${flag} ${value}`;
    return `${flag} ${formatCliScalar(String(value))}`;
}

function formatCliScalar(value: string): string {
    if (value === '...' || /^<[^>]+>$/.test(value)) return value;
    if (/^(true|false|null|-?\d+(\.\d+)?)$/i.test(value)) return value;
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
    return JSON.stringify(value);
}

function formatMcpValue(value: unknown): string {
    if (typeof value === 'string') return JSON.stringify(value);
    return JSON.stringify(value);
}

function stripQuotes(value: string): string {
    return value
        .replace(/^["“”']/, '')
        .replace(/["“”']$/, '');
}

function toKebab(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase();
}

function isObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
