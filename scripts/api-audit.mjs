#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIYUAN = path.join(ROOT, 'sample/siyuan');
const CURRENT_COMMIT = '251596fc0de2f9528c00c224252fd073a99973f4';
const PREVIOUS_COMMIT = 'eef10568384e2e7cf547adb029ae46a72e43c287';
const CURRENT_VERSION = 'v3.8.0';
const PREVIOUS_VERSION = 'v3.7.3';
const EXPECTED = Object.freeze({
    declarations: 593,
    uniquePaths: 589,
    apiPaths: 582,
    added: 43,
    removed: 1,
    deprecated: 4,
    permissionChanges: 11,
    tools: 14,
    actions: 143,
    backendApiLiterals: 150,
    validBackendApiLiterals: 149,
    uiApiLiterals: 5,
});

const COMPLETE_DOC = path.join(ROOT, 'API_COMPLETE_MAPPING.md');
const PLUGIN_DOC = path.join(ROOT, 'API_MCP_MAPPING.md');
const MANUAL_START = '<!-- API_AUDIT_MANUAL_START -->';
const MANUAL_END = '<!-- API_AUDIT_MANUAL_END -->';

function fail(message) {
    throw new Error(`[api-audit] ${message}`);
}

function git(args) {
    return execFileSync('git', ['-C', SIYUAN, ...args], { encoding: 'utf8' }).trimEnd();
}

function assertBaseline() {
    if (!fs.existsSync(path.join(SIYUAN, '.git'))) {
        fail(`缺少独立思源源码仓库 ${SIYUAN}；需要 v3.8.0 (${CURRENT_COMMIT}) 及 v3.7.3 Git object。`);
    }
    const head = git(['rev-parse', 'HEAD']).trim();
    if (head !== CURRENT_COMMIT) fail(`sample/siyuan HEAD 为 ${head}，预期 ${CURRENT_COMMIT} (${CURRENT_VERSION})。`);
    const currentTag = git(['rev-list', '-n', '1', CURRENT_VERSION]).trim();
    const previousTag = git(['rev-list', '-n', '1', PREVIOUS_VERSION]).trim();
    if (currentTag !== CURRENT_COMMIT) fail(`${CURRENT_VERSION} 指向 ${currentTag}，预期 ${CURRENT_COMMIT}。`);
    if (previousTag !== PREVIOUS_COMMIT) fail(`${PREVIOUS_VERSION} 指向 ${previousTag}，预期 ${PREVIOUS_COMMIT}。`);
}

function sourceAt(commit, relativePath) {
    return git(['show', `${commit}:${relativePath}`]);
}

function lineAt(source, offset) {
    return source.slice(0, offset).split('\n').length;
}

/** Remove Go/JS comments while preserving strings, newlines and byte offsets. */
export function stripComments(source) {
    const chars = [...source];
    let state = 'code';
    let quote = '';
    for (let i = 0; i < chars.length; i += 1) {
        const c = chars[i];
        const n = chars[i + 1];
        if (state === 'line') {
            if (c === '\n') state = 'code';
            else chars[i] = ' ';
            continue;
        }
        if (state === 'block') {
            if (c === '*' && n === '/') {
                chars[i] = chars[i + 1] = ' ';
                i += 1;
                state = 'code';
            } else if (c !== '\n') chars[i] = ' ';
            continue;
        }
        if (state === 'string') {
            if (quote !== '`' && c === '\\') {
                i += 1;
            } else if (c === quote) {
                state = 'code';
            }
            continue;
        }
        if (c === '/' && n === '/') {
            chars[i] = chars[i + 1] = ' ';
            i += 1;
            state = 'line';
        } else if (c === '/' && n === '*') {
            chars[i] = chars[i + 1] = ' ';
            i += 1;
            state = 'block';
        } else if (c === '"' || c === "'" || c === '`') {
            state = 'string';
            quote = c;
        }
    }
    if (state === 'block' || state === 'string') fail(`源码存在未闭合的 ${state}。`);
    return chars.join('');
}

function splitArgs(source) {
    const args = [];
    let start = 0;
    let depth = 0;
    let state = 'code';
    let quote = '';
    for (let i = 0; i < source.length; i += 1) {
        const c = source[i];
        if (state === 'string') {
            if (quote !== '`' && c === '\\') i += 1;
            else if (c === quote) state = 'code';
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            state = 'string'; quote = c; continue;
        }
        if ('([{'.includes(c)) depth += 1;
        else if (')]}'.includes(c)) depth -= 1;
        else if (c === ',' && depth === 0) {
            args.push(source.slice(start, i).trim());
            start = i + 1;
        }
    }
    args.push(source.slice(start).trim());
    return args;
}

function findClosingParen(source, open) {
    let depth = 0;
    let state = 'code';
    let quote = '';
    for (let i = open; i < source.length; i += 1) {
        const c = source[i];
        if (state === 'string') {
            if (quote !== '`' && c === '\\') i += 1;
            else if (c === quote) state = 'code';
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { state = 'string'; quote = c; continue; }
        if (c === '(') depth += 1;
        if (c === ')' && --depth === 0) return i;
    }
    fail(`第 ${lineAt(source, open)} 行的调用缺少右括号。`);
}

function parseStringLiteral(value, context) {
    const match = value.match(/^"([^"\\]*(?:\\.[^"\\]*)*)"$/s);
    if (!match) fail(`${context} 使用了无法静态求值的字符串：${value}`);
    return JSON.parse(value);
}

export function parseRouter(source, file = 'kernel/api/router.go') {
    const clean = stripComments(source);
    const routes = [];
    // router.go currently uses Handle/Any exclusively. A shortcut such as PUT must be
    // deliberately added to the parser instead of silently disappearing from the audit.
    const recognized = new Set(['Handle', 'Any', 'Use', 'Group', 'Handler', 'SetTrustedProxies']);
    const memberPattern = /\bginServer\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    for (const match of clean.matchAll(memberPattern)) {
        const kind = match[1];
        if (!recognized.has(kind)) fail(`${file}:${lineAt(source, match.index)} 出现未知 Gin 注册形式 ginServer.${kind}。`);
        if (kind !== 'Handle' && kind !== 'Any') continue;
        const open = match.index + match[0].lastIndexOf('(');
        const close = findClosingParen(clean, open);
        const args = splitArgs(source.slice(open + 1, close));
        const method = kind === 'Any' ? 'ANY' : parseStringLiteral(args[0], `${file}:${lineAt(source, match.index)} method`);
        const routePath = parseStringLiteral(args[kind === 'Any' ? 0 : 1], `${file}:${lineAt(source, match.index)} path`);
        const middlewareAndHandler = args.slice(kind === 'Any' ? 1 : 2).map((arg) => arg.trim());
        const handler = middlewareAndHandler.at(-1)?.replace(/^model\./, '') ?? 'unknown';
        routes.push({
            method,
            path: routePath,
            handler,
            source: file,
            line: lineAt(source, match.index),
            auth: middlewareAndHandler.includes('model.CheckAuth'),
            admin: middlewareAndHandler.includes('model.CheckAdminRole'),
            readonly: middlewareAndHandler.includes('model.CheckReadonly'),
            deprecated: handler === 'deprecated',
            registration: kind,
        });
    }
    return routes;
}

function uniquePaths(routes) {
    return new Set(routes.map((route) => route.path));
}

function routeKey(route) {
    return `${route.method} ${route.path}`;
}

function permissions(route) {
    return [route.auth && 'Auth', route.admin && 'Admin', route.readonly && 'Readonly'].filter(Boolean).join('+') || '公开';
}

function familyOf(routePath) {
    if (!routePath.startsWith('/api/')) return 'protocol';
    return routePath.split('/')[2] || 'root';
}

function mapByPath(routes) {
    const result = new Map();
    for (const route of routes) {
        if (!result.has(route.path)) result.set(route.path, []);
        result.get(route.path).push(route);
    }
    return result;
}

function parseProductionRegistrations(relativePath, source, initialReceivers = ['ginServer']) {
    const clean = stripComments(source);
    const receivers = new Set(initialReceivers);
    for (const match of clean.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*ginServer\.Group\s*\(/g)) receivers.add(match[1]);
    if (relativePath.endsWith('serve.go')) receivers.add('group');
    const routeMethods = new Set(['Handle', 'Any', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'Match', 'Static', 'StaticFS', 'StaticFile', 'StaticFileFS']);
    const infrastructure = new Set(['Group', 'Use', 'Handler', 'SetTrustedProxies']);
    const registrations = [];
    const callPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    for (const match of clean.matchAll(callPattern)) {
        const receiver = match[1];
        const method = match[2];
        if (!receivers.has(receiver)) continue;
        if (!routeMethods.has(method) && !infrastructure.has(method)) fail(`${relativePath}:${lineAt(source, match.index)} 出现未知生产 Gin 调用 ${receiver}.${method}。`);
        if (!routeMethods.has(method)) continue;
        const open = match.index + match[0].lastIndexOf('(');
        const close = findClosingParen(clean, open);
        const args = splitArgs(source.slice(open + 1, close));
        const pathArg = method === 'Handle' ? args[1] : method === 'Match' ? args[1] : args[0];
        registrations.push({ receiver, method, pathExpression: pathArg, source: relativePath, line: lineAt(source, match.index) });
    }
    return registrations;
}

function productionRegistrations() {
    return [
        ['kernel/server/serve.go', sourceAt(CURRENT_COMMIT, 'kernel/server/serve.go')],
        ['kernel/mcp/server.go', sourceAt(CURRENT_COMMIT, 'kernel/mcp/server.go')],
    ].flatMap(([file, source]) => parseProductionRegistrations(file, source));
}

function walkFiles(root, options = {}) {
    if (!fs.existsSync(root)) return [];
    const result = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.name.includes(' 2.') || ['.git', 'node_modules', 'dist', 'dev'].includes(entry.name)) continue;
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) result.push(...walkFiles(full, options));
        else if (!options.extensions || options.extensions.some((ext) => entry.name.endsWith(ext))) result.push(full);
    }
    return result;
}

function stringLiterals(source) {
    const values = [];
    let state = 'code';
    for (let i = 0; i < source.length; i += 1) {
        const c = source[i];
        const n = source[i + 1];
        if (state === 'line') {
            if (c === '\n') state = 'code';
            continue;
        }
        if (state === 'block') {
            if (c === '*' && n === '/') { i += 1; state = 'code'; }
            continue;
        }
        if (c === '/' && n === '/') { i += 1; state = 'line'; continue; }
        if (c === '/' && n === '*') { i += 1; state = 'block'; continue; }
        if (c !== '"' && c !== "'" && c !== '`') continue;
        const quote = c;
        const start = i;
        let raw = '';
        for (i += 1; i < source.length; i += 1) {
            const current = source[i];
            if (quote !== '`' && current === '\\') {
                raw += current;
                if (i + 1 < source.length) raw += source[++i];
                continue;
            }
            if (current === quote) break;
            raw += current;
        }
        if (i >= source.length) continue; // Regex/rune ambiguity in TS/Go: ignore rather than invent a path.
        let value = raw;
        if (quote !== '`') {
            try { value = JSON.parse(`${quote}${raw}${quote}`.replace(/^'/, '"').replace(/'$/, '"')); } catch { /* path literals do not need full JS escape evaluation */ }
        }
        values.push({ value, index: start });
    }
    return values;
}

function scanApiLiterals() {
    const records = new Map();
    const files = walkFiles(path.join(ROOT, 'src'), { extensions: ['.ts', '.svelte'] });
    for (const file of files) {
        if (file.endsWith('.d.ts')) continue;
        const rel = path.relative(ROOT, file).replaceAll(path.sep, '/');
        const source = fs.readFileSync(file, 'utf8');
        for (const literal of stringLiterals(source)) {
            if (/^(?:(?:\.\.?\/)+|@\/)/.test(literal.value)) continue; // module specifier, not a network path
            const apiMatches = [...literal.value.matchAll(/\/api\/[A-Za-z0-9_/:*-]+/g)];
            for (const apiMatch of apiMatches) {
            const apiPath = apiMatch[0];
            const layer = rel.startsWith('src/api/') ? 'api-wrapper'
                : rel.startsWith('src/ui/') ? 'ui'
                    : rel.startsWith('src/tools/') ? 'tool-direct'
                        : 'core';
            if (!records.has(apiPath)) records.set(apiPath, []);
            records.get(apiPath).push({ file: rel, line: lineAt(source, literal.index + apiMatch.index), layer });
            }
        }
    }
    return records;
}

function parsePluginTools() {
    const configPath = path.join(ROOT, 'src/core/config.ts');
    const source = fs.readFileSync(configPath, 'utf8');
    const categoriesMatch = source.match(/export const TOOL_CATEGORIES\s*=\s*\[([^\]]+)\]\s*as const/);
    if (!categoriesMatch) fail('无法解析 TOOL_CATEGORIES。');
    const categories = [...categoriesMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const actionArrays = new Map();
    for (const match of source.matchAll(/export const ([A-Z]+)_ACTIONS\s*=\s*\[([^\]]*)\]\s*as const/g)) {
        actionArrays.set(match[1].toLowerCase(), [...match[2].matchAll(/'([^']+)'/g)].map((item) => item[1]));
    }
    const tools = categories.map((name) => {
        const actions = actionArrays.get(name);
        if (!actions) fail(`TOOL_CATEGORIES 中的 ${name} 没有对应 *_ACTIONS。`);
        return { name, actions };
    });
    const dangerMatch = source.match(/export const DANGEROUS_ACTIONS[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
    const dangerous = new Set();
    if (dangerMatch) {
        for (const match of dangerMatch[1].matchAll(/([a-zA-Z]+):\s*new Set\(\[([^\]]*)\]\)/g)) {
            for (const action of match[2].matchAll(/'([^']+)'/g)) dangerous.add(`${match[1]}.${action[1]}`);
        }
    }
    const safetySource = fs.readFileSync(path.join(ROOT, 'src/core/write-safety-policy.ts'), 'utf8');
    const safety = new Map();
    for (const tool of tools) {
        const marker = new RegExp(`(?:^|\\n)\\s*${tool.name}:\\s*\\{`, 'm').exec(safetySource);
        if (!marker) fail(`ACTION_SAFETY_POLICIES 缺少 ${tool.name}。`);
        const open = safetySource.indexOf('{', marker.index);
        const block = extractBalancedBlock(safetySource, open);
        if (!block) fail(`无法解析 ${tool.name} write-safety policy。`);
        for (const match of block.body.matchAll(/([a-z_]+):\s*(read|external|mutation)\((?:'([^']+)')?/g)) {
            safety.set(`${tool.name}.${match[1]}`, match[2] === 'mutation' ? `mutation(${match[3] ?? 'none'})` : match[2]);
        }
    }
    for (const tool of tools) for (const action of tool.actions) if (!safety.has(`${tool.name}.${action}`)) fail(`缺少 ${tool.name}.${action} write-safety policy。`);
    return { tools, dangerous, safety };
}

function extractBalancedBlock(source, open) {
    let depth = 0;
    let state = 'code';
    let quote = '';
    for (let i = open; i < source.length; i += 1) {
        const c = source[i];
        const n = source[i + 1];
        if (state === 'line') { if (c === '\n') state = 'code'; continue; }
        if (state === 'block-comment') { if (c === '*' && n === '/') { i += 1; state = 'code'; } continue; }
        if (state === 'string') { if (quote !== '`' && c === '\\') i += 1; else if (c === quote) state = 'code'; continue; }
        if (c === '/' && n === '/') { i += 1; state = 'line'; continue; }
        if (c === '/' && n === '*') { i += 1; state = 'block-comment'; continue; }
        if (c === '"' || c === "'" || c === '`') { state = 'string'; quote = c; continue; }
        if (c === '{') depth += 1;
        else if (c === '}' && --depth === 0) return { body: source.slice(open + 1, i), end: i };
    }
    return null;
}

function apiFunctions() {
    const result = new Map();
    for (const file of walkFiles(path.join(ROOT, 'src/api'), { extensions: ['.ts'] })) {
        if (file.endsWith('.d.ts')) continue;
        const source = fs.readFileSync(file, 'utf8');
        const module = path.basename(file, '.ts');
        for (const match of source.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/g)) {
            const open = source.indexOf('{', match.index + match[0].length);
            const block = extractBalancedBlock(source, open);
            if (!block) continue;
            const paths = stringLiterals(block.body).map((item) => item.value).filter((value) => /^\/api\//.test(value));
            result.set(`${module}.${match[1]}`, [...new Set(paths)]);
        }
    }
    return result;
}

function contractEndpointMap() {
    const file = path.join(ROOT, 'tests/unit/tools/action-contract.test.ts');
    const result = new Map();
    if (!fs.existsSync(file)) return result;
    const source = fs.readFileSync(file, 'utf8');
    const starts = [...source.matchAll(/await runContracts\('([^']+)'/g)];
    for (let i = 0; i < starts.length; i += 1) {
        const tool = starts[i][1];
        const section = source.slice(starts[i].index, starts[i + 1]?.index ?? source.length);
        for (const item of section.matchAll(/^\s*\{\s*action:\s*'([^']+)'.*expectedEndpoint:\s*'([^']+)'\s*\},?\s*$/gm)) {
            result.set(`${tool}.${item[1]}`, [item[2]]);
        }
    }
    return result;
}

function actionEndpointMap(plugin) {
    const wrappers = apiFunctions();
    const contracts = contractEndpointMap();
    const result = new Map();
    for (const tool of plugin.tools) {
        const candidates = [path.join(ROOT, `src/tools/${tool.name}/handlers.ts`), path.join(ROOT, `src/tools/${tool.name}/index.ts`)].filter(fs.existsSync);
        const joined = candidates.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
        const imports = new Map([...joined.matchAll(/import \* as ([A-Za-z0-9_]+) from ['"]\.\.\/\.\.\/api\/([A-Za-z0-9_-]+)['"]/g)].map((m) => [m[1], m[2]]));
        const endpointMentions = new Map();
        for (const match of joined.matchAll(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*\(/g)) {
            const module = imports.get(match[1]);
            if (!module) continue;
            const endpoints = wrappers.get(`${module}.${match[2]}`) ?? [];
            for (const endpoint of endpoints) {
                if (!endpointMentions.has(endpoint)) endpointMentions.set(endpoint, []);
                endpointMentions.get(endpoint).push(match.index);
            }
        }
        const directLiterals = stringLiterals(joined).map((item) => item.value).filter((value) => /^\/api\//.test(value));
        for (const action of tool.actions) {
            const actionPattern = new RegExp(`(?:^|\\n)\\s*${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'm');
            const actionPos = joined.search(actionPattern);
            const nearby = [];
            if (actionPos >= 0) {
                const nextActionPositions = tool.actions.map((other) => other === action ? -1 : joined.slice(actionPos + 1).search(new RegExp(`(?:^|\\n)\\s*${other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'm'))).filter((pos) => pos >= 0);
                const end = actionPos + 1 + (nextActionPositions.length ? Math.min(...nextActionPositions) : 5000);
                for (const [endpoint, positions] of endpointMentions) if (positions.some((pos) => pos >= actionPos && pos < end)) nearby.push(endpoint);
            }
            result.set(`${tool.name}.${action}`, { direct: [...new Set(nearby)], indirect: [], fallback: [] });
        }
        // Source analysis cannot always bind named handlers to their object key. A tool-level conservative set is still auditable.
        const toolEndpoints = [...new Set([...endpointMentions.keys(), ...directLiterals])];
        for (const action of tool.actions) {
            const item = result.get(`${tool.name}.${action}`);
            if (item.direct.length === 0 && toolEndpoints.length === 1) item.indirect = toolEndpoints;
        }
    }

    const explicit = {
        'fs.write': ['/api/filetree/createDocWithMd', '/api/block/getBlockKramdown', '/api/block/updateBlock'],
        'fs.replace': ['/api/block/getBlockKramdown', '/api/block/updateBlock'],
        'fs.mv': ['/api/filetree/moveDocsByID', '/api/filetree/renameDocByID'],
        'notebook.set_open_state': ['/api/notebook/openNotebook', '/api/notebook/closeNotebook'],
        'notebook.get_permissions': ['/api/file/getFile', '/api/notebook/lsNotebooks'],
        'notebook.set_permission': ['/api/file/getFile', '/api/file/putFile'],
        'document.create': ['/api/filetree/createDocWithMd', '/api/filetree/createDoc'],
        'document.rename': ['/api/filetree/renameDocByID', '/api/filetree/renameDoc'],
        'document.remove': ['/api/filetree/removeDocByID', '/api/filetree/removeDoc'],
        'document.move': ['/api/filetree/moveDocsByID', '/api/filetree/moveDocs'],
        'block.set_fold_state': ['/api/block/foldBlock', '/api/block/unfoldBlock'],
        'block.add_to_daily_note': ['/api/block/appendDailyNoteBlock', '/api/block/prependDailyNoteBlock'],
        'av.get': ['/api/av/getAttributeView'],
        'av.render': ['/api/av/renderAttributeView'],
        'av.get_attribute_view_keys': ['/api/av/getAttributeViewKeys'],
        'av.get_attribute_view_filter_sort': ['/api/av/getAttributeViewFilterSort'],
        'av.search': ['/api/av/searchAttributeView'],
        'av.add_rows': ['/api/av/addAttributeViewBlocks'],
        'av.remove_rows': ['/api/av/removeAttributeViewBlocks'],
        'av.add_column': ['/api/av/addAttributeViewKey'],
        'av.remove_column': ['/api/av/removeAttributeViewKey'],
        'av.set_cells': ['/api/av/setAttributeViewBlockAttr', '/api/av/batchSetAttributeViewBlockAttrs'],
        'av.duplicate': ['/api/av/duplicateAttributeViewBlock'],
        'av.get_primary_key_values': ['/api/av/getAttributeViewPrimaryKeyValues'],
        'search.semantic': ['/api/search/semanticSearchBlock'],
        'search.query_sql': ['/api/query/sql'],
        'search.get_backlinks': ['/api/ref/getBacklinkDoc', '/api/ref/getBackmentionDoc'],
        'search.fulltext_asset_content': ['/api/search/getAssetContent', '/api/search/fullTextSearchAssetContent'],
        'file.read_template': ['/templates/*filepath'],
        'file.render': ['/api/template/render', '/api/template/renderSprig'],
        'tag.list': ['/api/tag/getTag', '/api/search/searchTag'],
        'timeline.list_nodes': ['/api/repo/getRepoTagSnapshots', '/api/attr/getBlockAttrs'],
        'timeline.create_node': ['/api/repo/getRepoSnapshots', '/api/repo/createSnapshot', '/api/repo/getRepoTagSnapshots', '/api/repo/tagSnapshot', '/api/attr/getBlockAttrs', '/api/attr/setBlockAttrs'],
        'timeline.compare_node': ['/api/repo/getRepoTagSnapshots', '/api/repo/getRepoSnapshots', '/api/repo/createSnapshot', '/api/repo/diffRepoSnapshots', '/api/repo/openRepoSnapshotFile'],
        'timeline.delete_node': ['/api/repo/getRepoTagSnapshots', '/api/repo/removeRepoTagSnapshot', '/api/attr/getBlockAttrs', '/api/attr/setBlockAttrs'],
        'timeline.rollback_document': ['/api/repo/getRepoTagSnapshots', '/api/repo/getRepoSnapshots', '/api/repo/createSnapshot', '/api/repo/diffRepoSnapshots', '/api/repo/openRepoSnapshotFile', '/api/repo/rollbackRepoSnapshotFile'],
        'timeline.rollback_block': ['/api/repo/getRepoTagSnapshots', '/api/repo/getRepoSnapshots', '/api/repo/createSnapshot', '/api/repo/diffRepoSnapshots', '/api/repo/openRepoSnapshotFile', '/api/block/updateBlock', '/api/block/deleteBlock', '/api/block/insertBlock'],
        'flashcard.list_cards': ['/api/riff/getRiffDueCards', '/api/riff/getNotebookRiffDueCards', '/api/riff/getTreeRiffDueCards'],
        'flashcard.get_decks': ['/api/riff/getRiffDecks'],
        'flashcard.get_cards': ['/api/riff/getRiffCards'],
        'flashcard.review_card': ['/api/riff/reviewRiffCard', '/api/riff/skipReviewRiffCard'],
        'flashcard.create_card': ['/api/riff/addRiffCards'],
        'flashcard.remove_card': ['/api/riff/removeRiffCards'],
        'system.notify': ['/api/notification/pushMsg', '/api/notification/pushErrMsg'],
        'system.changelog': ['local:bundled changelog'],
        'extension.list': ['/mcp'],
        'feedback.submit': ['external:GitHub Issues'],
        'mascot.get_balance': ['external:Sisyphus service'],
        'mascot.shop': ['external:Sisyphus service'],
        'mascot.buy': ['external:Sisyphus service'],
    };
    for (const [key, endpoints] of contracts) {
        const item = result.get(key);
        if (item) item.direct = endpoints;
    }
    for (const [key, endpoints] of Object.entries(explicit)) result.get(key).direct = endpoints;
    const fallback = {
        'document.lookup': ['/api/query/sql'],
        'search.get_backlinks': ['/api/query/sql'],
        'av.search': ['/api/file/readDir'],
    };
    for (const [key, endpoints] of Object.entries(fallback)) result.get(key).fallback = endpoints;
    return result;
}

function nativeTools() {
    const tools = [];
    const root = path.join(SIYUAN, 'kernel/mcp/tools');
    for (const file of walkFiles(root, { extensions: ['.go'] })) {
        if (file.endsWith('_test.go')) continue;
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/Name:\s*"([^"]+)"/g)) {
            const actionMatch = source.match(/"action":\s*\{[\s\S]*?Enum:\s*\[\]string\{([^}]*)\}/);
            const actions = actionMatch ? [...actionMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : [];
            const scope = source.match(/EffectScope:\s*(EffectScope[A-Za-z]+)/)?.[1]?.replace('EffectScope', '').toLowerCase() ?? 'unknown';
            const effects = new Map();
            const effectsMarker = source.match(/ActionEffects:\s*map\[string\]ToolEffects\s*\{/);
            if (effectsMarker?.index !== undefined) {
                const open = source.indexOf('{', effectsMarker.index);
                const block = extractBalancedBlock(source, open);
                if (block) {
                    for (const item of block.body.matchAll(/"([^"]*)":\s*\{([^}]*)\}/g)) {
                        effects.set(item[1], ['LocalRead', 'LocalWrite', 'DataEgress', 'ExternalCost'].filter((flag) => new RegExp(`${flag}:\\s*true`).test(item[2])));
                    }
                }
            }
            tools.push({ name: match[1], actions, scope, effects, file: path.relative(SIYUAN, file).replaceAll(path.sep, '/'), line: lineAt(source, match.index) });
        }
    }
    return tools.sort((a, b) => a.name.localeCompare(b.name));
}

const NATIVE_OVERLAP = Object.freeze({
    fs: ['document', 'block'], notebook: ['notebook'], document: ['document', 'outline', 'dailynote'], block: ['block', 'attr'],
    av: ['database'], file: ['file', 'asset', 'export', 'template'], search: ['search', 'sql', 'ref'], tag: ['tag'],
    timeline: ['repo', 'history'], system: ['system', 'sync', 'workspace'], flashcard: [], extension: ['动态官方 MCP 工具'], mascot: [], feedback: [],
});

function officialApiPaths() {
    const source = sourceAt(CURRENT_COMMIT, 'docs/API.md');
    return new Set([...source.matchAll(/\/api\/[A-Za-z0-9_/:.-]+/g)].map((match) => match[0].replace(/[).,;:]+$/, '')));
}

function frontendApiPaths() {
    const set = new Set();
    for (const file of walkFiles(path.join(SIYUAN, 'app/src'), { extensions: ['.ts', '.tsx', '.js', '.svelte'] })) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/\/api\/[A-Za-z0-9_/:.-]+/g)) set.add(match[0]);
    }
    return set;
}

function md(value) {
    return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function linkSource(file, line) {
    return `\`${file}:${line}\``;
}

function assertCount(label, actual, expected) {
    if (actual !== expected) fail(`${label}=${actual}，预期 ${expected}。`);
}

function buildAuditModel() {
    assertBaseline();
    const currentSource = sourceAt(CURRENT_COMMIT, 'kernel/api/router.go');
    const previousSource = sourceAt(PREVIOUS_COMMIT, 'kernel/api/router.go');
    const routes = parseRouter(currentSource);
    const previousRoutes = parseRouter(previousSource);
    const paths = uniquePaths(routes);
    const previousPaths = uniquePaths(previousRoutes);
    const added = [...paths].filter((item) => !previousPaths.has(item)).sort();
    const removed = [...previousPaths].filter((item) => !paths.has(item)).sort();
    const currentByKey = new Map(routes.map((route) => [routeKey(route), route]));
    const previousByKey = new Map(previousRoutes.map((route) => [routeKey(route), route]));
    const permissionChanges = [...currentByKey].flatMap(([key, route]) => {
        const old = previousByKey.get(key);
        if (!old || permissions(old) === permissions(route)) return [];
        return [{ method: route.method, path: route.path, before: permissions(old), after: permissions(route) }];
    }).sort((a, b) => a.path.localeCompare(b.path));
    const plugin = parsePluginTools();
    const actions = plugin.tools.flatMap((tool) => tool.actions.map((action) => `${tool.name}.${action}`));
    const literals = scanApiLiterals();
    const backendLiterals = new Map([...literals].filter(([, locations]) => locations.some((location) => location.layer === 'api-wrapper')));
    const toolDirectOnly = new Map([...literals].filter(([, locations]) => locations.some((location) => location.layer === 'tool-direct') && locations.every((location) => location.layer !== 'api-wrapper')));
    const uiOnly = new Map([...literals].filter(([, locations]) => locations.every((location) => location.layer === 'ui')));
    const validBackend = [...backendLiterals.keys()].filter((item) => paths.has(item));
    const invalidBackend = [...backendLiterals.keys()].filter((item) => !paths.has(item)).sort();

    assertCount('有效路由声明', routes.length, EXPECTED.declarations);
    assertCount('唯一路径', paths.size, EXPECTED.uniquePaths);
    assertCount('/api 路径', [...paths].filter((item) => item.startsWith('/api/')).length, EXPECTED.apiPaths);
    assertCount('新增路径', added.length, EXPECTED.added);
    assertCount('移除路径', removed.length, EXPECTED.removed);
    assertCount('弃用路径', routes.filter((route) => route.deprecated).length, EXPECTED.deprecated);
    assertCount('权限变化', permissionChanges.length, EXPECTED.permissionChanges);
    assertCount('聚合工具', plugin.tools.length, EXPECTED.tools);
    assertCount('静态 action', actions.length, EXPECTED.actions);
    assertCount('后端 API 字面量', backendLiterals.size, EXPECTED.backendApiLiterals);
    assertCount('有效后端 API 字面量', validBackend.length, EXPECTED.validBackendApiLiterals);
    assertCount('UI-only API 字面量', uiOnly.size, EXPECTED.uiApiLiterals);
    if (invalidBackend.join() !== '/api/asset/setImageAlpha') fail(`失效 wrapper 集合异常：${invalidBackend.join(', ') || '(空)'}`);
    if (removed.join() !== '/api/ai/agent/frontendToolResult') fail(`移除路径集合异常：${removed.join(', ')}`);

    return {
        routes, previousRoutes, paths, added, removed, permissionChanges, plugin, actions, literals, backendLiterals, toolDirectOnly, uiOnly,
        validBackend, invalidBackend, official: officialApiPaths(), frontend: frontendApiPaths(), endpoints: actionEndpointMap(plugin), native: nativeTools(), production: productionRegistrations(),
    };
}

function ancillaryTables(model) {
    const davRead = 'OPTIONS, HEAD, GET, PROPFIND, REPORT（Cal/Card）';
    const davWrite = 'POST, PUT, DELETE, MKCOL, COPY, MOVE, LOCK/UNLOCK（仅 WebDAV）, PROPPATCH';
    return `## 生产启动链中的其他网络接口\n\n这些接口从 \`server.Serve()\` 可达，但不计入上面的 593/589/582 内核 API 基线。\n\n| 类型 | 方法 | 路径模板 | 鉴权/条件 | 处理器/说明 |\n|---|---|---|---|---|\n| MCP | GET, POST, DELETE | \`/mcp\` | Auth + Admin；POST/DELETE 另有 Readonly | Streamable HTTP；工具由运行时注册表投影 |\n| 主 WebSocket | GET | \`/ws\` | 握手后执行会话鉴权 | 命令注册表当前为 \`ping\`、\`closews\` |\n| 插件 HTTP/WS/SSE | ANY | \`/plugin/private/:name/*path\` | Auth + Admin + Readonly | 插件运行时动态 handler；SSE 由 Accept 头选择 |\n| 插件 JSON-RPC | GET/POST/WS | \`/api/plugin/rpc[/:name]\`、\`/ws/plugin/rpc[/:name]\` | 见全量路由表 | 动态插件名 |\n| WebDAV | ${davRead}, ${davWrite} | \`/webdav/*path\` | Auth + Admin；只读模式禁止写方法 | 加密笔记本路径全部拒绝 |\n| CalDAV | ${davRead}, ${davWrite} | \`/.well-known/caldav\`、\`/caldav/*path\` | well-known 无组鉴权；主体 Auth + Admin | 只读模式禁止写方法 |\n| CardDAV | ${davRead}, ${davWrite} | \`/.well-known/carddav\`、\`/carddav/*path\` | well-known 无组鉴权；主体 Auth + Admin | 只读模式禁止写方法 |\n| 上传/资产 | POST/GET | \`/upload\`、\`/assets/*path\` | Auth；上传另有 Admin + Readonly | 受控上传、缩略图、SVG 与加密资产读取 |\n| 导出/历史/仓库差异 | GET | \`/export/*filepath\`、\`/history/*path\`、\`/repo/diff/*path\` | Auth + Admin | 受控临时资源端点 |\n| 包资源 | GET, HEAD | \`/widgets/*filepath\`、\`/plugins/*filepath\`、\`/emojis/*filepath\`、\`/templates/*filepath\` | Auth；模板另有 Admin | 包级 symlink 与发布访问检查 |\n| 其他资源 | GET/HEAD | \`/public/*\`、\`/snippets/*filepath\`、\`/custom-fonts/:id\`、\`/appearance/*\`、\`/stage/*\` | 各自鉴权/内容限制 | 静态页面和前端资源，不计业务 API |\n| 调试 | GET | \`/debug/pprof/*\`（11 个固定路径） | 仅 \`--enable-pprof\`；Auth + Admin | 默认不注册 |\n\n### 监听器（不重复计算被转发路由）\n\n- 主监听器：\`127.0.0.1:<ServerPort>\`；NetworkServe 或 Docker 下为 \`0.0.0.0\`，可由同一 listener 多路复用 HTTP/HTTPS。\n- 固定端口代理：配置端口与主端口不同时启动，反向代理到主 \`ServerURL\`。\n- 发布端口代理：仅 Publish.Enable 时启动，注入 Reader JWT 后转发到主服务。\n\n### 生产 Gin 注册调用点（源码扫描）\n\n| 注册形式 | 路径表达式 | 来源 |\n|---|---|---|\n${model.production.map((item) => `| \`${item.receiver}.${item.method}\` | \`${md(item.pathExpression)}\` | ${linkSource(item.source, item.line)} |`).join('\n')}\n\n该表记录 server/MCP 层的原始注册调用点；Group/helper/Static 的路径组合在上方按实际语义归一。未知 receiver 方法会失败关闭。\n`;
}

function generateComplete(model) {
    const byFamily = new Map();
    for (const route of model.routes.filter((item) => item.path.startsWith('/api/'))) {
        const family = familyOf(route.path);
        if (!byFamily.has(family)) byFamily.set(family, { declarations: 0, paths: new Set(), public: new Set(), covered: new Set() });
        const item = byFamily.get(family);
        item.declarations += 1;
        item.paths.add(route.path);
        if (model.official.has(route.path)) item.public.add(route.path);
        if (model.backendLiterals.has(route.path)) item.covered.add(route.path);
    }
    const duplicatePaths = [...mapByPath(model.routes)].filter(([, items]) => items.length > 1);
    const lines = [
        '# SiYuan v3.8.0 生产网络 API 完整清单', '',
        '> 本文档由 `npm run api:audit` 从固定源码基线全量生成，请勿手工编辑。漂移检查使用 `npm run api:audit:check`。', '',
        '## 基线与统计口径', '',
        `- 唯一真相源：\`sample/siyuan\` tag \`${CURRENT_VERSION}\`，commit \`${CURRENT_COMMIT}\`。`,
        `- 对照版本：\`${PREVIOUS_VERSION}\`，commit \`${PREVIOUS_COMMIT}\`。`,
        `- \`kernel/api/router.go\`：**${model.routes.length}** 条有效注册声明、**${model.paths.size}** 个唯一路径、其中 **${[...model.paths].filter((item) => item.startsWith('/api/')).length}** 个 \`/api/*\`。`,
        `- 官方 \`docs/API.md\` 可静态识别 **${model.official.size}** 个公开路径；其余路由标为内部 API。`,
        `- 插件 API wrapper 覆盖口径：**${model.backendLiterals.size}** 个 API 字面量，**${model.validBackend.length}** 个匹配当前内核，覆盖 \`${(model.validBackend.length / EXPECTED.apiPaths * 100).toFixed(1)}%\`；工具层直调另列。`,
        `- 同路径不同方法造成 ${model.routes.length - model.paths.size} 条声明差；重复路径为 ${duplicatePaths.map(([p]) => `\`${p}\``).join('、')}。`,
        '- 扫描排除注释、测试文件和文件名含 ` 2.` 的重复文件；动态参数保留 Gin 模板。任何未知 `ginServer.<注册方法>` 会使审计失败。', '',
        '## 按 API family 汇总', '',
        '| Family | 声明 | 唯一路径 | 官方公开 | Sisyphus 后端覆盖 |', '|---|---:|---:|---:|---:|',
    ];
    for (const [family, item] of [...byFamily].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`| ${family} | ${item.declarations} | ${item.paths.size} | ${item.public.size} | ${item.covered.size} |`);
    }
    lines.push('', '## v3.7.3 → v3.8.0 变化', '', `路由表路径集合新增 **${model.added.length}**、移除 **${model.removed.length}**、净增 **${model.added.length - model.removed.length}**。这一数字只针对 \`kernel/api/router.go\`；其他生产网络端点另见后文。`, '', '### 新增 43 个路径', '', '| 路径 | 权限 | 处理器 | 请求字段 | 响应概要 | 风险 | 来源 |', '|---|---|---|---|---|---|---|');
    const currentByPath = mapByPath(model.routes);
    for (const routePath of model.added) {
        const route = currentByPath.get(routePath)[0];
        const request = routePath === '/api/filetree/setSort' ? '`notebookSorts[] {id,sort}`、`docSorts[] {id,sort}`' : '未知（内部 handler，未猜测）';
        const response = routePath === '/api/filetree/setSort' ? '`{notebookIDs[], docIDs[]}`' : '未知（内部 handler，未猜测）';
        const risk = route.readonly ? '状态变更；受只读保护' : route.admin ? '管理员级读取/计算或宿主操作' : route.auth ? '鉴权读取/计算' : '未鉴权流程；不得直接暴露给 AI';
        lines.push(`| \`${routePath}\` | ${permissions(route)} | \`${route.handler}\` | ${request} | ${response} | ${risk} | ${linkSource(route.source, route.line)} |`);
    }
    lines.push('', '### 移除 1 个路径', '', '| 路径 | v3.7.3 处理器 | 替代/状态 |', '|---|---|---|');
    const previousByPath = mapByPath(model.previousRoutes);
    for (const routePath of model.removed) lines.push(`| \`${routePath}\` | \`${previousByPath.get(routePath)[0].handler}\` | 由新的 Agent browser capability/permission 回调链替换；不再注册 |`);
    lines.push('', '### 既有路径权限变化（11）', '', '| 方法 | 路径 | v3.7.3 | v3.8.0 |', '|---|---|---|---|');
    for (const item of model.permissionChanges) lines.push(`| ${item.method} | \`${item.path}\` | ${item.before} | ${item.after} |`);
    lines.push('', '另外，v3.8.0 在 `ServeAPI()` 开头全局加入 `boxLeaseMiddleware`；这是租约作用域变化，不重复计入单路径权限变化。', '', '### 弃用接口（4）', '', '| 路径 | 处理器 | 计划状态 |', '|---|---|---|');
    for (const route of model.routes.filter((item) => item.deprecated)) lines.push(`| \`${route.path}\` | \`deprecated\` | 源码标注 2026-12-01 后删除 |`);
    lines.push('', ancillaryTables(model), '', '## 全量路由总表', '', '“发布模式”仅按 middleware 作保守判断：Admin/Readonly 路由不可由发布 Reader 角色调用；仅 Auth 的路由仍可能在 handler 内进行数据级发布访问检查。请求/响应 schema 若未公开则明确为“未知（内部）”。', '', '| # | 方法 | 路径 | Family | 处理器 | Auth | Admin | Readonly | 发布模式 | 公开性 | 前端字面调用 | Sisyphus | 请求/响应概要 | 来源 |', '|---:|---|---|---|---|:---:|:---:|:---:|---|---|:---:|---|---|---|');
    model.routes.forEach((route, index) => {
        const locations = model.backendLiterals.get(route.path) ?? [];
        const pluginText = locations.length ? locations.map((item) => `${item.layer}:${item.file}:${item.line}`).join('<br>') : '—';
        const exposure = model.official.has(route.path) ? '官方公开' : route.path.includes(':') || route.registration === 'Any' ? '动态/内部' : '内部';
        const schema = model.official.has(route.path) ? '见官方 API 文档' : locations.length ? '见插件 wrapper 类型；内核未公开稳定 schema' : '未知（内部）';
        const publish = route.admin || route.readonly ? '不可用' : route.auth ? '条件可用' : '公开可达';
        lines.push(`| ${index + 1} | ${route.method} | \`${route.path}\` | ${familyOf(route.path)} | \`${md(route.handler)}\` | ${route.auth ? '✓' : ''} | ${route.admin ? '✓' : ''} | ${route.readonly ? '✓' : ''} | ${publish} | ${exposure}${route.deprecated ? '/弃用' : ''} | ${model.frontend.has(route.path) ? '✓' : ''} | ${md(pluginText)} | ${schema} | ${linkSource(route.source, route.line)} |`);
    });
    lines.push('', '## 思源原生 MCP 与 WebSocket 元数据', '', `原生 MCP 静态注册表当前识别 **${model.native.length}** 个内建工具。插件及外部 MCP 工具还会在运行时加入注册表，因此这里不是运行时上限。`, '', '| 原生工具 | Action | Effect scope | Action effects | 来源 |', '|---|---|---|---|---|');
    for (const tool of model.native) {
        const actions = tool.actions.length ? tool.actions : ['(single)'];
        const actionText = actions.map((action) => `\`${action}\``).join('、');
        const effectText = actions.map((action) => {
            const flags = tool.effects.get(action) ?? tool.effects.get('') ?? [];
            return `${action}: ${flags.length ? flags.join('+') : '未声明'}`;
        }).join('<br>');
        lines.push(`| \`${tool.name}\` | ${actionText} | \`${tool.scope}\` | ${effectText} | ${linkSource(tool.file, tool.line)} |`);
    }
    lines.push('', '- `/mcp` 的 action/effect 真相源在 `kernel/mcp/tools/*.go`；`ActionEffects` 不通过 `tools/list` 输出，审计必须读取 Go 源。', '- 主 `/ws` 的命令分发入口是 `kernel/cmd/cmd.go`，当前静态命令为 `ping`、`closews`；其他消息是服务端广播事件，不应伪装成 HTTP API。', '', '## 扫描限制', '', '- 静态分析只把能够从注册源码、官方文档或插件类型可靠确认的字段写成确定值；内部 handler 的请求/响应不会靠命名猜测。', '- 前端调用列仅表示在 `app/src` 发现同路径字面量，动态拼接可能导致假阴性。', '- `Any` 保留为 ANY 声明，不展开为多个方法，确保 593 条注册声明基线稳定。', '');
    return lines.join('\n');
}

function defaultManualSection() {
    return `## 功能候选与人工决策\n\n### 高优先级\n\n| 能力 | 内核接口 | 请求/响应可靠度 | 风险与最低版本 | 建议 |\n|---|---|---|---|---|\n| 语义搜索与嵌入模型管理 | \`semanticSearchBlock\`、\`testEmbeddingModel\`、\`embeddingStat\`、\`reindexEmbedding\`、\`retryFailedEmbedding\` 及 AI 设置 | 搜索 wrapper 已有类型；模型管理 schema 未公开，标记未知 | 数据可能传给外部模型、可能产生费用；最低 v3.8.0 | semantic 已映射；其余先做版本/费用/外传确认设计 |\n| 文档排序 | \`/api/filetree/setSort\` | 官方文档已公开 | 写操作；最低 v3.8.0 | 优先替换/补强现有 changeSort 语义 |\n| 结构导航 | \`getBlockBreadcrumbChildren\`、\`getDocBlocksOrders\`、\`getDocHeadingNumbers\` | 内部 schema，未知 | 只读；最低 v3.8.0 | 适合作为 block/document 高优先候选 |\n| 历史差异 | \`diffDocVersions\`、\`getRepoDocHistory\` | 内部 schema，未知 | 读取历史内容；最低 v3.8.0 | 优先判断 timeline 与原生 history/repo MCP 重叠 |\n| 数据库增强 | \`createAttributeViewItemDocs\`、关系候选、字段视图、搜索目标、条目状态 | 内部 schema，未知 | 部分写操作；最低 v3.8.0 | 在 av 工具内聚合，补充行/列权限校验 |\n\n### 中优先级\n\n- 资源历史、Pandoc 环境诊断、集市包检查与更新。先检查思源原生 MCP 是否已通过 \`extension\` 提供，避免复制同一能力。\n\n### 默认不引入\n\n- OIDC 流程、Agent 会话回调、浏览器 capability 回传、原生 MCP 环境变量。\n- 字体、更新通道、UI 可见性、图谱配置、LAN 同步等宿主管理接口。\n- 网络代理、归档、任意文件及其他高权限内部接口；除非出现明确场景并另做安全设计。`;
}

function preserveManual(existing) {
    const start = existing.indexOf(MANUAL_START);
    const end = existing.indexOf(MANUAL_END);
    if (start >= 0 && end > start) return existing.slice(start + MANUAL_START.length, end).trim();
    return defaultManualSection();
}

function generatePlugin(model, existing = '') {
    const manual = preserveManual(existing);
    const lines = [
        '# Sisyphus 工具、Action 与 SiYuan API 映射', '',
        '> 生成区由 `npm run api:audit` 重建；人工候选说明仅允许在文末标记区内编辑。', '',
        '## 当前基线', '',
        `- **${model.plugin.tools.length}** 个聚合工具、**${model.actions.length}** 个静态 action（不含隐式 \`help\`、MCP App 重复 action、\`extension\` 运行时动态 action）。`,
        `- \`src/api\` wrapper 覆盖口径为 **${model.backendLiterals.size}** 个唯一 \`/api/*\` 字面量：**${model.validBackend.length}** 个有效，覆盖当前 **${EXPECTED.apiPaths}** 个内核 API 路径的 **${(model.validBackend.length / EXPECTED.apiPaths * 100).toFixed(1)}%**；工具层直调另列，不混入该基线。`,
        `- UI 设置页另有 **${model.uiOnly.size}** 个 UI-only 路径，不计入工具/API 覆盖率。`,
        `- 唯一失效 wrapper：\`${model.invalidBackend[0]}\`（\`src/api/file.ts:93\`）；本轮仅记录，不删除。`,
        '- 生成器直接读取当前工作区注册表，因此新增或移除 action 后会同步更新本页基线。', '',
        '## 工具汇总', '',
        '| 工具 | Action 数 | 危险 Action | 原生 MCP 重叠候选 |', '|---|---:|---|---|',
    ];
    for (const tool of model.plugin.tools) {
        const danger = tool.actions.filter((action) => model.plugin.dangerous.has(`${tool.name}.${action}`));
        lines.push(`| \`${tool.name}\` | ${tool.actions.length} | ${danger.length ? danger.map((item) => `\`${item}\``).join('、') : '—'} | ${(NATIVE_OVERLAP[tool.name] ?? []).map((item) => `\`${item}\``).join('、') || '—'} |`);
    }
    lines.push('', '## 全量 Action 映射', '', '端点角色采用保守静态分析：“直接”是 handler 可绑定的 wrapper/协议调用；“间接”是工具级可见但无法安全绑定到单一分支的调用；“回退”来自显式人工 overlay。权限解析、UI refresh、严格写预检和 lifecycle 属于横切链路，不冒充业务直接端点。', '', '| 工具.Action | 直接端点 | 间接调用 | 回退接口 | 危险/安全级别 | 原生 MCP 重叠 | 备注 |', '|---|---|---|---|---|---|---|');
    for (const tool of model.plugin.tools) {
        for (const action of tool.actions) {
            const key = `${tool.name}.${action}`;
            const endpoints = model.endpoints.get(key);
            const formatEndpoints = (items) => items.length ? items.map((item) => `\`${item}\``).join('<br>') : '—';
            const dangerous = model.plugin.dangerous.has(key);
            const safety = model.plugin.safety.get(key);
            const native = (NATIVE_OVERLAP[tool.name] ?? []).map((item) => `\`${item}\``).join('、') || '—';
            const notes = key === 'search.semantic' ? '数据外传/外部费用风险；最低 SiYuan v3.8.0'
                : tool.name === 'extension' ? `动态读取思源原生 MCP tools/list；运行时动态 action 不计入静态 ${model.actions.length}`
                    : endpoints.direct.length || endpoints.indirect.length || endpoints.fallback.length ? '业务端点；另经过权限/刷新/写安全/lifecycle 横切链' : '本地逻辑、外部服务或静态分析无法可靠绑定；未猜测 endpoint';
            lines.push(`| \`${key}\` | ${formatEndpoints(endpoints.direct)} | ${formatEndpoints(endpoints.indirect)} | ${formatEndpoints(endpoints.fallback)} | \`${safety}\`${dangerous ? '；危险：协议确认' : ''} | ${native} | ${notes} |`);
        }
    }
    const sortedLiterals = [...model.backendLiterals].sort(([a], [b]) => a.localeCompare(b));
    lines.push('', '## 插件后端 API 字面量分类', '', '| API 路径 | 分类 | 位置 | 映射状态 |', '|---|---|---|---|');
    for (const [apiPath, locations] of sortedLiterals) {
        const valid = model.paths.has(apiPath);
        const layers = [...new Set(locations.filter((item) => item.layer !== 'ui').map((item) => item.layer))].join('+');
        lines.push(`| \`${apiPath}\` | ${layers} | ${locations.filter((item) => item.layer !== 'ui').map((item) => `\`${item.file}:${item.line}\``).join('<br>')} | ${valid ? '有效内核路由' : '失效 wrapper（保留审计）'} |`);
    }
    lines.push('', `### API wrapper 层外的工具直调（不计 ${model.backendLiterals.size} wrapper 覆盖口径）`, '', '| API 路径 | 位置 | 状态 |', '|---|---|---|');
    for (const [apiPath, locations] of [...model.toolDirectOnly].sort(([a], [b]) => a.localeCompare(b))) lines.push(`| \`${apiPath}\` | ${locations.filter((item) => item.layer === 'tool-direct').map((item) => `\`${item.file}:${item.line}\``).join('<br>')} | ${model.paths.has(apiPath) ? '有效' : '失效'} |`);
    lines.push('', '### UI-only（不计覆盖率）', '', '| API 路径 | 位置 | 状态 |', '|---|---|---|');
    for (const [apiPath, locations] of [...model.uiOnly].sort(([a], [b]) => a.localeCompare(b))) lines.push(`| \`${apiPath}\` | ${locations.map((item) => `\`${item.file}:${item.line}\``).join('<br>')} | ${model.paths.has(apiPath) ? '有效' : '失效'} |`);
    lines.push('', '## 覆盖层级解释', '', `- **插件直接覆盖**：后端 API wrapper 或工具层直调，列于上表 ${model.backendLiterals.size} 项。`, `- **由 extension 暴露原生工具**：运行时通过思源 \`/mcp\` 发现；动态 action 不纳入静态 ${model.actions.length}。`, '- **仅内核内部使用**：当前内核路由存在，但没有插件后端字面量；不等同于适合暴露给 AI。', '- **不建议引入**：宿主管理、认证回调、任意文件/网络代理等能力，见人工候选区。', '', '## 风险模型说明', '', '- `DANGEROUS_ACTIONS` 表示 MCP 协议级确认，不等价于“是否写入”。', '- `ACTION_SAFETY_POLICIES` 区分 read/mutation/external 与 precondition；`ACTION_TIERS` 只表示披露层级。三者不得合并成一个布尔值。', '- 原生 MCP 的 action effect 需从 Go 源读取，因为 `ActionEffects` 不通过 `/mcp tools/list` 返回。例如 `semantic` 在上游标注 DataEgress 与 ExternalCost。', '', MANUAL_START, manual, MANUAL_END, '');
    return lines.join('\n');
}

function compareOrWrite(file, generated, check) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (check) {
        if (current !== generated) fail(`${path.relative(ROOT, file)} 与生成结果不一致；运行 npm run api:audit。`);
        return false;
    }
    if (current === generated) return false;
    fs.writeFileSync(file, generated);
    return true;
}

export function runAudit({ check = false } = {}) {
    const model = buildAuditModel();
    const existingPlugin = fs.existsSync(PLUGIN_DOC) ? fs.readFileSync(PLUGIN_DOC, 'utf8') : '';
    const complete = generateComplete(model);
    const plugin = generatePlugin(model, existingPlugin);
    const changed = [compareOrWrite(COMPLETE_DOC, complete, check), compareOrWrite(PLUGIN_DOC, plugin, check)].filter(Boolean).length;
    return { changed, model };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const check = process.argv.includes('--check');
        const { changed, model } = runAudit({ check });
        console.log(`[api-audit] ${check ? '检查通过' : `生成完成（更新 ${changed} 个文档）`}：${model.routes.length} declarations / ${model.paths.size} paths / ${EXPECTED.apiPaths} api / ${model.plugin.tools.length} tools / ${model.actions.length} actions / ${model.backendLiterals.size} plugin APIs`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
