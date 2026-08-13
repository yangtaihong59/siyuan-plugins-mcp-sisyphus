#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function usage() {
    process.stdout.write(`Usage:
  node call-built-mcp.cjs --transport direct|stdio [options]

Options:
  --server <path>                 CJS bundle relative to repository root
                                  (default: dist/mcp-server.cjs)
  --profile <name>                CLI profile; defaults to currentProfile
  --tool <name>                   One-shot tool name
  --args-json <json>              One-shot arguments object
  --list-tools                    List tools and exit
  --interactive                   Read {"tool","args"} JSON objects from stdin
  --confirm-isolated-dangerous    Accept MCP confirmation prompts; isolated fixtures only
  --help                          Show this help

direct loads the specified CJS in this process with transportMode=http, so its
own coordinator and in-memory leases are tested. stdio spawns the specified CJS;
strict mutations then follow the product's normal forwarding to plugin HTTP.
`);
}

function parseOptions(argv) {
    const options = {
        server: 'dist/mcp-server.cjs',
        transport: 'direct',
        argsJson: '{}',
        interactive: false,
        listTools: false,
        confirmDangerous: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--server') options.server = requireValue(argv, ++index, arg);
        else if (arg === '--transport') options.transport = requireValue(argv, ++index, arg);
        else if (arg === '--profile') options.profile = requireValue(argv, ++index, arg);
        else if (arg === '--tool') options.tool = requireValue(argv, ++index, arg);
        else if (arg === '--args-json') options.argsJson = requireValue(argv, ++index, arg);
        else if (arg === '--interactive') options.interactive = true;
        else if (arg === '--list-tools') options.listTools = true;
        else if (arg === '--confirm-isolated-dangerous') options.confirmDangerous = true;
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unknown option: ${arg}`);
    }
    if (!['direct', 'stdio'].includes(options.transport)) {
        throw new Error('--transport must be direct or stdio');
    }
    return options;
}

function requireValue(argv, index, option) {
    if (!argv[index]) throw new Error(`${option} requires a value`);
    return argv[index];
}

function applyCliProfile(profileName) {
    if (process.env.SIYUAN_API_URL && process.env.SIYUAN_TOKEN) return;
    const configPath = path.join(os.homedir(), '.siyuan-sisyphus', 'config.json');
    if (!fs.existsSync(configPath)) return;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const selectedName = profileName || config.currentProfile || 'default';
    const selected = config.profiles?.[selectedName] || config;
    if (!selected || typeof selected !== 'object') {
        throw new Error(`Unknown CLI profile: ${selectedName}`);
    }
    if (!process.env.SIYUAN_API_URL && typeof selected.apiUrl === 'string') {
        process.env.SIYUAN_API_URL = selected.apiUrl;
    }
    if (!process.env.SIYUAN_TOKEN && typeof selected.token === 'string') {
        process.env.SIYUAN_TOKEN = selected.token;
    }
}

function createClient(confirmDangerous) {
    const client = new Client(
        { name: 'siyuan-built-cjs-live-test', version: '1.0.0' },
        confirmDangerous
            ? { capabilities: { elicitation: {} }, versionNegotiation: { mode: 'auto' } }
            : {},
    );
    if (confirmDangerous) {
        client.setRequestHandler('elicitation/create', async () => ({
            action: 'accept',
            content: { confirm: true },
        }));
    }
    return client;
}

async function connect(options, serverPath) {
    const client = createClient(options.confirmDangerous);
    if (options.transport === 'stdio') {
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [serverPath],
            env: { ...process.env },
        });
        await client.connect(transport);
        return { client, close: () => client.close() };
    }

    delete require.cache[require.resolve(serverPath)];
    const built = require(serverPath);
    if (typeof built.createSiYuanServer !== 'function') {
        throw new Error(`${serverPath} does not export createSiYuanServer()`);
    }
    const server = await built.createSiYuanServer({ transportMode: 'http' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return {
        client,
        close: async () => {
            await client.close().catch(() => {});
            await server.close().catch(() => {});
        },
    };
}

function normalizeResult(result) {
    const text = result.content
        ?.filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n') || '';
    let payload = text;
    try {
        payload = JSON.parse(text);
    } catch {
        // Preserve non-JSON text responses.
    }
    return {
        isError: result.isError === true,
        payload,
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    };
}

async function callAndPrint(client, request, sequence) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Each request must be a JSON object');
    }
    if (request.command === 'listTools') {
        const result = await client.listTools();
        process.stdout.write(`${JSON.stringify({ sequence, tools: result.tools.map((tool) => tool.name) })}\n`);
        return;
    }
    if (typeof request.tool !== 'string' || !request.tool) {
        throw new Error('Request requires a non-empty tool');
    }
    const args = request.args && typeof request.args === 'object' && !Array.isArray(request.args)
        ? request.args
        : {};
    const result = await client.callTool({ name: request.tool, arguments: args });
    process.stdout.write(`${JSON.stringify({
        sequence,
        tool: request.tool,
        action: typeof args.action === 'string' ? args.action : undefined,
        ...normalizeResult(result),
    })}\n`);
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
        usage();
        return;
    }
    if (!options.interactive && !options.listTools && !options.tool) {
        throw new Error('Choose --interactive, --list-tools, or --tool');
    }

    applyCliProfile(options.profile);
    const serverPath = path.resolve(REPO_ROOT, options.server);
    if (!fs.existsSync(serverPath) || fs.statSync(serverPath).size === 0) {
        throw new Error(`Built server not found or empty: ${serverPath}`);
    }

    const connection = await connect(options, serverPath);
    try {
        if (options.listTools) {
            await callAndPrint(connection.client, { command: 'listTools' }, 0);
            return;
        }
        if (options.tool) {
            const args = JSON.parse(options.argsJson);
            await callAndPrint(connection.client, { tool: options.tool, args }, 0);
            return;
        }

        const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
        let sequence = 0;
        for await (const rawLine of input) {
            const line = rawLine.trim();
            if (!line) continue;
            if (line === ':quit' || line === ':exit') {
                input.close();
                break;
            }
            try {
                await callAndPrint(connection.client, JSON.parse(line), sequence);
            } catch (error) {
                process.stdout.write(`${JSON.stringify({
                    sequence,
                    harnessError: error instanceof Error ? error.message : String(error),
                })}\n`);
            }
            sequence += 1;
        }
    } finally {
        await connection.close();
    }
}

main().catch((error) => {
    process.stderr.write(`[built-cjs-live-test] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
