import minimist from 'minimist';

import { getFlagAliasRules, type ArgumentAliasContext } from '../core/argument-aliases';

type JsonSchema = Record<string, any>;

export interface FlagMapResult {
    args: Record<string, unknown>;
    warnings: string[];
}

/**
 * Convert CLI flags to a MCP tool-action argument payload, using the tool's
 * inputSchema as the authoritative source for property names and types.
 *
 * - Accepts kebab-case (--parent-id), camelCase (--parentID), or exact match.
 * - Boolean flags: --flag (true), --no-flag (false), --flag=false.
 * - Array flags: repeat the flag, or pass a comma-separated string.
 * - Object / nested flags: use --<key>-json '<json-fragment>'.
 */
export function mapFlagsToArgs(rest: string[], inputSchema: JsonSchema, context?: Partial<ArgumentAliasContext>): FlagMapResult {
    const props = collectInputProperties(inputSchema);

    const canonicalByLower = new Map<string, string>();
    const booleanKeys = new Set<string>();
    const stringKeys = new Set<string>();
    for (const [name, schema] of Object.entries(props)) {
        if (name === 'action') continue;
        const aliases = getFlagAliases(name);
        for (const alias of aliases) canonicalByLower.set(alias.toLowerCase(), name);
        const type = inferType(schema);
        if (type === 'boolean') {
            for (const alias of aliases) booleanKeys.add(alias);
        } else {
            for (const alias of aliases) stringKeys.add(alias);
        }
    }
    for (const rule of getFlagAliasRules(context)) {
        const schema = rule.schema ?? props[rule.canonical] ?? {};
        const aliases = new Set<string>([
            ...getFlagAliases(rule.canonical),
            ...rule.aliases.flatMap(getFlagAliases),
        ]);
        for (const alias of aliases) canonicalByLower.set(alias.toLowerCase(), rule.canonical);
        const type = inferType(schema);
        if (type === 'boolean') {
            for (const alias of aliases) booleanKeys.add(alias);
        } else {
            for (const alias of aliases) stringKeys.add(alias);
        }
        props[rule.canonical] ??= schema;
    }

    // Every potential --<key>-json sidecar is declared as string so values
    // starting with a brace or bracket aren't eaten as the next flag.
    const jsonSidecarKeys: string[] = [];
    for (const name of Object.keys(props)) {
        if (name === 'action') continue;
        for (const alias of getFlagAliases(name)) jsonSidecarKeys.push(`${alias}-json`);
    }

    const valueFlagKeys = [...stringKeys, ...jsonSidecarKeys];
    const knownFlagKeys = [...booleanKeys, ...valueFlagKeys];
    const normalizedRest = bindStringFlagValues(rest, valueFlagKeys, knownFlagKeys);

    const parsed = minimist(normalizedRest, {
        boolean: [...booleanKeys],
        string: [...stringKeys, ...jsonSidecarKeys],
    });
    const providedFlagKeys = collectProvidedFlagKeys(normalizedRest);

    const result: Record<string, unknown> = {};
    const warnings: string[] = [];
    const jsonOverrides: Record<string, unknown> = {};

    for (const [rawKey, rawVal] of Object.entries(parsed)) {
        if (rawKey === '_') continue;

        // JSON-sidecar: --parent-id-json, --assets-json, etc.
        if (rawKey.endsWith('-json')) {
            const baseKey = rawKey.slice(0, -'-json'.length);
            const canonical = canonicalByLower.get(baseKey.toLowerCase());
            if (!canonical) {
                warnings.push(`Unknown flag --${rawKey}.`);
                continue;
            }
            if (typeof rawVal !== 'string' || rawVal.length === 0) continue;
            try {
                jsonOverrides[canonical] = JSON.parse(rawVal);
            } catch (error) {
                throw new Error(`--${rawKey} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    for (const [rawKey, rawVal] of Object.entries(parsed)) {
        if (rawKey === '_' || rawKey.endsWith('-json')) continue;

        const canonical = canonicalByLower.get(rawKey.toLowerCase());
        if (!canonical) {
            warnings.push(`Unknown flag --${rawKey}; ignored.`);
            continue;
        }

        if (canonical in jsonOverrides) continue;
        if (canonical in result) continue; // avoid double-assignment from alias+original
        const schema = props[canonical];
        if (inferType(schema) === 'boolean' && rawVal === false && !providedFlagKeys.has(rawKey.toLowerCase())) {
            continue;
        }
        result[canonical] = coerce(canonical, rawVal, schema);
    }

    if (parsed._.length > 0) {
        warnings.push(`Extra positional arguments ignored: ${parsed._.join(' ')}`);
    }

    return { args: { ...result, ...jsonOverrides }, warnings };
}

function collectInputProperties(inputSchema: JsonSchema): Record<string, JsonSchema> {
    const props: Record<string, JsonSchema> = { ...((inputSchema.properties ?? {}) as Record<string, JsonSchema>) };
    const internalBranches = inputSchema['x-sisyphus-actionSchemas'];
    const branches = Array.isArray(internalBranches)
        ? internalBranches
        : Array.isArray(inputSchema.oneOf)
        ? inputSchema.oneOf
        : Array.isArray(inputSchema.anyOf)
            ? inputSchema.anyOf
            : [];

    for (const branch of branches) {
        if (!branch || typeof branch !== 'object') continue;
        const branchProps = (branch as JsonSchema).properties;
        if (!branchProps || typeof branchProps !== 'object' || Array.isArray(branchProps)) continue;
        for (const [name, schema] of Object.entries(branchProps as Record<string, JsonSchema>)) {
            props[name] ??= schema;
        }
    }

    return props;
}

function coerce(key: string, value: unknown, schema: JsonSchema): unknown {
    const type = inferType(schema);

    if (type === 'array') {
        if (Array.isArray(value)) return value.map((v) => coerceItem(v, schema.items));
        if (typeof value === 'string') {
            return value.split(',').map((s) => coerceItem(s.trim(), schema.items));
        }
        return [value];
    }

    if (type === 'number' || type === 'integer') {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const n = type === 'integer' ? parseInt(value, 10) : parseFloat(value);
            if (Number.isNaN(n)) {
                throw new Error(`--${toKebab(key)} expected a number but got "${value}".`);
            }
            return n;
        }
        return value;
    }

    if (type === 'boolean') {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') return value === 'true' || value === '1' || value === 'yes';
        return Boolean(value);
    }

    if (type === 'object') {
        if (typeof value === 'object' && value !== null) return value;
        if (typeof value === 'string') {
            try { return JSON.parse(value); } catch {
                throw new Error(`--${toKebab(key)} expects JSON for an object field. Use --${toKebab(key)}-json '{"..."}'.`);
            }
        }
        return value;
    }

    // string fallback
    return typeof value === 'string' ? value : String(value);
}

function coerceItem(item: unknown, itemSchema?: JsonSchema): unknown {
    if (!itemSchema) return item;
    const type = inferType(itemSchema);
    if (type === 'number' || type === 'integer') {
        if (typeof item === 'string') return type === 'integer' ? parseInt(item, 10) : parseFloat(item);
    }
    if (type === 'boolean' && typeof item === 'string') {
        return item === 'true' || item === '1' || item === 'yes';
    }
    return item;
}

function inferType(schema: JsonSchema | undefined): string {
    if (!schema) return 'string';
    const type = schema.type;
    if (Array.isArray(type)) return type[0] ?? 'string';
    if (typeof type === 'string') return type;
    if (schema.enum) return 'string';
    if (schema.anyOf || schema.oneOf) return 'string'; // be conservative
    return 'string';
}

function getFlagAliases(name: string): string[] {
    const parts = splitFlagName(name);
    const aliases = new Set<string>([name]);
    if (parts.length === 0) return [...aliases];

    aliases.add(parts.join('-'));
    aliases.add(parts.join('_'));
    aliases.add(toCamel(parts));

    return [...aliases];
}

function splitFlagName(name: string): string[] {
    return name
        .split(/[_-]+/)
        .flatMap((segment) => segment.replace(/([A-Z]+)([A-Z][a-z]{2,})/g, '$1 $2').split(/\s+/))
        .flatMap((segment) => segment.match(/[A-Z]+[a-z]*|[a-z]+|[0-9]+/g) ?? [])
        .map((part) => part.toLowerCase());
}

function toCamel(parts: string[]): string {
    if (parts.length === 0) return '';
    return parts[0] + parts.slice(1).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

function toKebab(name: string): string {
    const parts = splitFlagName(name);
    return parts.length > 0 ? parts.join('-') : name.toLowerCase();
}

function bindStringFlagValues(rest: string[], valueFlagKeys: string[], knownFlagKeys: string[]): string[] {
    const valueFlags = new Set(valueFlagKeys.map((key) => key.toLowerCase()));
    const knownFlags = new Set(knownFlagKeys.map((key) => key.toLowerCase()));
    const out: string[] = [];

    for (let i = 0; i < rest.length; i++) {
        const token = rest[i];
        const flag = parseFlagToken(token);
        if (!flag || flag.hasEquals || flag.negated || !valueFlags.has(flag.key.toLowerCase())) {
            out.push(token);
            continue;
        }

        const next = rest[i + 1];
        if (next === undefined || next === '--' || isKnownFlagToken(next, knownFlags)) {
            out.push(token);
            continue;
        }

        out.push(`${token}=${next}`);
        i++;
    }

    return out;
}

function isKnownFlagToken(token: string, knownFlags: Set<string>): boolean {
    const flag = parseFlagToken(token);
    return Boolean(flag && knownFlags.has(flag.key.toLowerCase()));
}

function parseFlagToken(token: string): { key: string; hasEquals: boolean; negated: boolean } | null {
    if (!token.startsWith('-') || token === '-' || token === '--') return null;
    const prefixLength = token.startsWith('--') ? 2 : 1;
    const eq = token.indexOf('=');
    const rawKey = eq === -1 ? token.slice(prefixLength) : token.slice(prefixLength, eq);
    if (!rawKey) return null;
    const negated = token.startsWith('--') && rawKey.startsWith('no-');
    const key = negated ? rawKey.slice(3) : rawKey;
    if (!key) return null;
    return { key, hasEquals: eq !== -1, negated };
}

function collectProvidedFlagKeys(rest: string[]): Set<string> {
    const keys = new Set<string>();
    for (const token of rest) {
        if (!token.startsWith('-')) continue;
        const eq = token.indexOf('=');
        const rawKey = eq === -1
            ? token.replace(/^-+/, '')
            : token.slice(token.startsWith('--') ? 2 : 1, eq);
        const key = rawKey.startsWith('no-') ? rawKey.slice(3) : rawKey;
        if (key) keys.add(key.toLowerCase());
    }
    return keys;
}
