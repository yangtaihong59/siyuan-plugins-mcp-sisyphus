import minimist from 'minimist';

import { getFlagAliasRules, type ArgumentAliasContext } from '../core/argument-aliases';

type JsonSchema = Record<string, any>;

export interface FlagMapResult {
    args: Record<string, unknown>;
    warnings: string[];
    /** Flags the selected action does not accept; dispatch rejects these instead of dropping them. */
    unknownFlags: string[];
    /** Canonical argument names the selected action accepts (for error messages). */
    acceptedArgs: string[];
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
    const props = collectInputProperties(inputSchema, context?.action);

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
    const unknownFlags: string[] = [];
    const jsonOverrides: Record<string, unknown> = {};

    for (const [rawKey, rawVal] of Object.entries(parsed)) {
        if (rawKey === '_') continue;

        // JSON-sidecar: --parent-id-json, --assets-json, etc.
        if (rawKey.endsWith('-json')) {
            const baseKey = rawKey.slice(0, -'-json'.length);
            const canonical = canonicalByLower.get(baseKey.toLowerCase());
            if (!canonical) {
                unknownFlags.push(`--${rawKey}`);
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
            unknownFlags.push(`--${rawKey}`);
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

    const acceptedArgs = Object.keys(props).filter((name) => name !== 'action');
    return { args: { ...result, ...jsonOverrides }, warnings, unknownFlags, acceptedArgs };
}

const WRITE_SAFETY_FLAG_SCHEMAS: Record<string, JsonSchema> = {
    requestId: { type: 'string' },
    validateOnly: { type: 'boolean' },
    preview: { type: 'string', enum: ['summary', 'full'] },
    expectedStateHash: { type: 'string' },
    expectedStructureHash: { type: 'string' },
    expectedValueHash: { type: 'string' },
    expectedManifestHash: { type: 'string' },
    expectedSourceHash: { type: 'string' },
};

function collectInputProperties(inputSchema: JsonSchema, action?: string): Record<string, JsonSchema> {
    const internalBranches = inputSchema['x-sisyphus-actionSchemas'];
    const branches = Array.isArray(internalBranches)
        ? internalBranches
        : Array.isArray(inputSchema.oneOf)
        ? inputSchema.oneOf
        : Array.isArray(inputSchema.anyOf)
            ? inputSchema.anyOf
            : [];

    // Prefer the selected action's own branch so flags of sibling actions are
    // reported as unknown instead of being silently stripped by validation.
    const own = action
        ? branches.find((branch: JsonSchema) => branch?.properties?.action?.const === action)
        : undefined;
    if (own && own.properties && typeof own.properties === 'object' && !Array.isArray(own.properties)) {
        // Write-safety fields are accepted by every action regardless of how the
        // branch was published (some writes are always coordinated).
        return { ...WRITE_SAFETY_FLAG_SCHEMAS, ...(own.properties as Record<string, JsonSchema>) };
    }

    const props: Record<string, JsonSchema> = { ...((inputSchema.properties ?? {}) as Record<string, JsonSchema>) };

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
            // Users naturally pass JSON arrays to plain flags (--include '["id","path"]').
            const trimmed = value.trim();
            if (trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (Array.isArray(parsed)) return parsed.map((v) => coerceItem(v, schema.items));
                } catch { /* not JSON: fall through to comma splitting */ }
            }
            return value.split(',').map((s) => coerceItem(s.trim(), schema.items));
        }
        return [value];
    }

    if (type === 'number' || type === 'integer') {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const n = type === 'integer' ? parseInt(value, 10) : parseFloat(value);
            // Non-numeric words go through unchanged: argument aliases map named
            // values (e.g. --rating good), and the tool validator reports the rest.
            if (Number.isNaN(n)) return value;
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

function flagTokens(name: string): string[] {
    return name.replace(/^-+/, '').replace(/-json$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().split(/[-_]+/).filter(Boolean);
}

function editDistance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
}

/**
 * Nearest accepted argument for a mistyped flag: a prefix (--old → oldLabel),
 * per-word prefixes (--doc-id → documentId), or a small typo. Undefined when
 * nothing is close enough to be a useful guess.
 */
export function suggestFlag(unknownFlag: string, acceptedArgs: string[]): string | undefined {
    const input = flagTokens(unknownFlag);
    const joined = input.join('');
    if (!joined) return undefined;
    let best: { name: string; score: number } | undefined;
    for (const name of acceptedArgs) {
        const tokens = flagTokens(name);
        const candidate = tokens.join('');
        let score: number | undefined;
        if (candidate.startsWith(joined) && joined.length >= 3) score = 1;
        else if (joined.length >= 2 && input.length <= tokens.length && input.every((token, index) => tokens[index].startsWith(token))) score = 2;
        else {
            const distance = editDistance(joined, candidate);
            if (distance <= Math.max(1, Math.floor(candidate.length / 4))) score = 3 + distance;
        }
        if (score !== undefined && (!best || score < best.score || (score === best.score && candidate.length < flagTokens(best.name).join('').length))) {
            best = { name, score };
        }
    }
    return best?.name;
}
