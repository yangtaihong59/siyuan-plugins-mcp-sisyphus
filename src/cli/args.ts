import minimist from 'minimist';

import { CLI_COMMAND_ALIAS, PRIMARY_CLI_COMMAND } from '../shared/constants';

export type Command = 'dispatch' | 'list' | 'help' | 'init' | 'config' | 'skill' | 'show-help' | 'version';
export type ConfigCommandAction = 'list' | 'get' | 'set' | 'use';
export type SkillCommandAction = 'list' | 'read' | 'install' | 'uninstall';
export type SkillBundle = 'cli' | 'mcp' | 'all';

export { PRIMARY_CLI_COMMAND, CLI_COMMAND_ALIAS } from '../shared/constants';

export interface ParsedArgs {
    command: Command;
    tool?: string;
    action?: string;
    configAction?: ConfigCommandAction;
    configName?: string;
    skillAction?: SkillCommandAction;
    skillName?: string;
    bundle?: SkillBundle;
    rest: string[];
    configPath?: string;
    profile?: string;
    url?: string;
    token?: string;
    target?: string;
    local?: boolean;
    dryRun?: boolean;
    json: boolean;
    debug: boolean;
}

const HELP_TEXT = `${PRIMARY_CLI_COMMAND} — Direct command-line control for SiYuan Note

Agent bootstrap:
  If you are an AI model or coding agent, run \`${PRIMARY_CLI_COMMAND} skill install\`
  before using this CLI for SiYuan work. The bundled skills contain the
  task-specific guidance for safe search, reading, editing, export, database,
  tag, flashcard, and system operations.

Commands:
  ${PRIMARY_CLI_COMMAND} <tool> <action> [--flag value ...]   Execute a SiYuan operation
  ${PRIMARY_CLI_COMMAND} list [tool]                          List tools or a tool's actions
  ${PRIMARY_CLI_COMMAND} help <tool> [action]                 Show terminal-friendly help
  ${PRIMARY_CLI_COMMAND} init                                 Create ~/.siyuan-sisyphus/config.json
  ${PRIMARY_CLI_COMMAND} config <action> ...                  Manage saved SiYuan profiles
  ${PRIMARY_CLI_COMMAND} skill install [--bundle cli|mcp|all] Install bundled agent skills
  ${PRIMARY_CLI_COMMAND} skill list [--bundle cli|mcp|all]    List bundled agent skills
  ${PRIMARY_CLI_COMMAND} --help | -h                          Show this help
  ${PRIMARY_CLI_COMMAND} --version | -v                       Show version

Tools:
  fs, notebook, document, block, av, file, search, tag, timeline, system, flashcard, extension, mascot, feedback

Alias:
  ${CLI_COMMAND_ALIAS}                                         Same CLI, shorter command name

Global options:
  --config <file>    Load config from <file> instead of ~/.siyuan-sisyphus/config.json
  --profile <name>   Use a saved profile from config.json
  --url <url>        SiYuan API base URL (default http://127.0.0.1:6806)
  --token <token>    SiYuan API token
  --json             Emit compact JSON for scripts and pipes
  --debug            Include stack traces and extra diagnostics

Paging:
  Paginated results in an interactive terminal support Enter/n for next page,
  p for previous page, and q/Esc/Ctrl+C to quit. Pipes and scripts should use
  --page, --page-size, and --json explicitly.

Examples:
  ${PRIMARY_CLI_COMMAND} notebook list
  ${PRIMARY_CLI_COMMAND} --profile work notebook list
  ${PRIMARY_CLI_COMMAND} config set work --url http://127.0.0.1:6807 --token xxx
  ${PRIMARY_CLI_COMMAND} config use work
  ${PRIMARY_CLI_COMMAND} skill install
  ${PRIMARY_CLI_COMMAND} skill install --bundle mcp
  ${PRIMARY_CLI_COMMAND} skill install --target claude
  ${PRIMARY_CLI_COMMAND} skill install --target .codex --local
  ${PRIMARY_CLI_COMMAND} help document create
  ${PRIMARY_CLI_COMMAND} fs read --path "/Inbox/Test"
  ${PRIMARY_CLI_COMMAND} document create --notebook <id> --path "/Folder/Test" --markdown "正文从这里开始"
  ${PRIMARY_CLI_COMMAND} block append --parent-id <id> --data-type markdown --data "- item"
  ${PRIMARY_CLI_COMMAND} search fulltext --query "keyword" --page-size 10
  ${PRIMARY_CLI_COMMAND} timeline list-nodes --scope all --document-id <id>
  ${PRIMARY_CLI_COMMAND} extension list --refresh
  ${PRIMARY_CLI_COMMAND} extension plugin__example__tool --arguments-json '{"key":"value"}'
  ${PRIMARY_CLI_COMMAND} document list-tree --notebook <id> --json | jq '.data[].title'

Config precedence:
  --url/--token > --profile > environment variables > active config profile > defaults

Environment:
  SIYUAN_API_URL, SIYUAN_TOKEN

Flag naming:
  Use kebab-case or camelCase freely: --parent-id, --parentID, --parentId all work.
  Action names accept either form: set_open_state or set-open-state.
  Common action aliases are accepted when the target tool supports them: list/ls,
  move/mv, remove/rm/delete/del.
  fs accepts common path positionals: fs ls /, fs search / keyword,
  fs mv /Notebook/Old /Notebook/New.
  Boolean flags: use --flag, --flag=false, or --no-flag.
  For complex object/array values, use --<key>-json '<json>'.
`;

const GLOBAL_BOOLEAN = ['json', 'debug', 'help', 'version'];
const GLOBAL_STRING = ['config', 'profile', 'url', 'token', 'bundle'];

export function parseArgs(argv: string[]): ParsedArgs {
    const parsed = minimist(argv, {
        boolean: GLOBAL_BOOLEAN,
        string: GLOBAL_STRING,
        alias: { h: 'help', v: 'version' },
        stopEarly: false,
    });

    if (parsed.help) return blank('show-help');
    if (parsed.version) return blank('version');

    const positional = parsed._;
    const first = positional[0];

    if (first === 'init') {
        return {
            command: 'init',
            rest: [],
            configPath: parsed.config || undefined,
            profile: parsed.profile || undefined,
            url: parsed.url || undefined,
            token: parsed.token || undefined,
            json: Boolean(parsed.json),
            debug: Boolean(parsed.debug),
        };
    }

    if (first === 'list') {
        return {
            command: 'list',
            tool: typeof positional[1] === 'string' ? positional[1] : undefined,
            rest: [],
            configPath: parsed.config || undefined,
            profile: parsed.profile || undefined,
            url: parsed.url || undefined,
            token: parsed.token || undefined,
            json: Boolean(parsed.json),
            debug: Boolean(parsed.debug),
        };
    }

    if (first === 'help') {
        return {
            command: 'help',
            tool: typeof positional[1] === 'string' ? positional[1] : undefined,
            action: typeof positional[2] === 'string' ? positional[2] : undefined,
            rest: [],
            configPath: parsed.config || undefined,
            profile: parsed.profile || undefined,
            url: parsed.url || undefined,
            token: parsed.token || undefined,
            json: Boolean(parsed.json),
            debug: Boolean(parsed.debug),
        };
    }

    if (first === 'config') {
        const configAction = typeof positional[1] === 'string' ? positional[1] as ConfigCommandAction : undefined;
        if (!configAction || !['list', 'get', 'set', 'use'].includes(configAction)) {
            throw new Error(
                `Missing or invalid config action. Try "${PRIMARY_CLI_COMMAND} config list", ` +
                `"${PRIMARY_CLI_COMMAND} config get [name]", "${PRIMARY_CLI_COMMAND} config set <name> --url <url>", or ` +
                `"${PRIMARY_CLI_COMMAND} config use <name>".`,
            );
        }
        return {
            command: 'config',
            configAction,
            configName: typeof positional[2] === 'string' ? positional[2] : undefined,
            rest: [],
            configPath: parsed.config || undefined,
            profile: parsed.profile || undefined,
            url: parsed.url || undefined,
            token: parsed.token || undefined,
            json: Boolean(parsed.json),
            debug: Boolean(parsed.debug),
        };
    }

    if (first === 'skill') {
        const skillAction = typeof positional[1] === 'string' ? positional[1] as SkillCommandAction : undefined;
        if (!skillAction || !['list', 'read', 'install', 'uninstall'].includes(skillAction)) {
            throw new Error(
                `Missing or invalid skill action. Try "${PRIMARY_CLI_COMMAND} skill list", ` +
                `"${PRIMARY_CLI_COMMAND} skill read [name]", "${PRIMARY_CLI_COMMAND} skill install", or ` +
                `"${PRIMARY_CLI_COMMAND} skill uninstall".`,
            );
        }
        const bundle = parsed.bundle || 'cli';
        if (!['cli', 'mcp', 'all'].includes(bundle)) {
            throw new Error('Invalid skill bundle. Use "cli", "mcp", or "all".');
        }
        return {
            command: 'skill',
            skillAction,
            skillName: typeof positional[2] === 'string' ? positional[2] : undefined,
            bundle: bundle as SkillBundle,
            rest: [],
            configPath: parsed.config || undefined,
            profile: parsed.profile || undefined,
            url: parsed.url || undefined,
            token: parsed.token || undefined,
            target: typeof parsed.target === 'string' ? parsed.target : undefined,
            local: Boolean(parsed.local),
            dryRun: Boolean(parsed['dry-run']),
            json: Boolean(parsed.json),
            debug: Boolean(parsed.debug),
        };
    }

    if (typeof first !== 'string' || !first) {
        return blank('show-help');
    }

    const action = typeof positional[1] === 'string' ? positional[1] : undefined;
    if (!action) {
        throw new Error(`Missing action for tool "${first}". Try "${PRIMARY_CLI_COMMAND} help ${first}".`);
    }

    // Everything after tool+action is the tool-specific flag payload.
    // We need to re-extract these from the original argv because minimist has
    // already parsed global flags, but we want flag-mapper to see them raw
    // alongside the tool-specific ones for schema-aware re-parsing.
    const rest = extractToolRest(argv);

    return {
        command: 'dispatch',
        tool: first,
        action,
        rest,
        configPath: parsed.config || undefined,
        profile: parsed.profile || undefined,
        url: parsed.url || undefined,
        token: parsed.token || undefined,
        json: Boolean(parsed.json),
        debug: Boolean(parsed.debug),
    };
}

function blank(command: Command): ParsedArgs {
    return { command, rest: [], json: false, debug: false };
}

/**
 * Return argv with the first two positionals (tool + action) and the four
 * global flags (--config / --profile / --url / --token / --json / --debug / --help / --version)
 * stripped. The remainder goes to the schema-aware tool-flag parser.
 */
function extractToolRest(argv: string[]): string[] {
    const out: string[] = [];
    let positionalSeen = 0;
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith('-')) {
            positionalSeen++;
            if (positionalSeen <= 2) continue;
            out.push(token);
            continue;
        }

        const eq = token.indexOf('=');
        const flagName = eq === -1 ? token.replace(/^-+/, '') : token.slice(token.startsWith('--') ? 2 : 1, eq);
        const lookupFlagName = flagName.startsWith('no-') ? flagName.slice(3) : flagName;

        if (GLOBAL_STRING.includes(lookupFlagName)) {
            if (eq === -1) i++; // consume the value token
            continue;
        }
        if (GLOBAL_BOOLEAN.includes(lookupFlagName) || lookupFlagName === 'h' || lookupFlagName === 'v') {
            // --help and --version accept no value; --json/--debug also valueless
            continue;
        }

        out.push(token);
    }
    return out;
}

export function getHelpText(): string {
    return HELP_TEXT;
}
