#!/usr/bin/env node
'use strict';

// Contract checks against the built bundle with an isolated mock kernel.
// This does not replace real SiYuan or provider acceptance testing.
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { createServer } = require('node:http');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { Client, InMemoryTransport, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const bundlePath = path.resolve(__dirname, '../../dist/mcp-server.cjs');
const report = { mode: 'built CJS with mock kernel', sha256: createHash('sha256').update(readFileSync(bundlePath)).digest('hex'), checks: [] };
const files = {
    '/data/plugins/siyuan-plugins-mcp-sisyphus/plugin.json': JSON.stringify({ name: 'siyuan-plugins-mcp-sisyphus' }),
    '/data/storage/petal/siyuan-plugins-mcp-sisyphus/notebookPermissions': '{}',
};
let feedbackPosts = 0;
let blockMoves = 0;

async function mockFetch(url, init = {}) {
    const pathname = new URL(String(url)).pathname;
    if (String(url).startsWith('https://f-api.wps.cn/')) {
        if (init.method === 'POST') {
            feedbackPosts++;
            return Response.json({ code: 0, data: { aid: 'mock-only' } });
        }
        return Response.json({ code: 0, data: { token: 'mock-only', setting: { baseSetting: { commitConfig: { options: [{ id: 'mock-only' }] } } } } });
    }
    if (pathname === '/api/file/getFile') return new Response(files[JSON.parse(init.body).path] ?? '');
    if (pathname === '/api/file/putFile' && typeof init.body?.get === 'function') {
        const file = init.body.get('file');
        files[init.body.get('path')] = await file.text();
    }
    if (pathname === '/api/block/moveBlock') blockMoves++;
    return Response.json({ code: 0, msg: '', data: pathname === '/api/system/version' ? 'mock-kernel' : {} });
}

function checkSchemas(tools, transport) {
    for (const tool of tools) {
        const root = tool.inputSchema;
        const visit = (node, ancestors = new Set()) => {
            if (!node || typeof node !== 'object') return;
            assert(!ancestors.has(node), `${tool.name}: cyclic schema`);
            const next = new Set(ancestors).add(node);
            if (node.$ref) {
                assert(node.$ref.startsWith('#/'));
                const target = node.$ref.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
                assert(target, `${tool.name}: unresolved reference`);
                visit(target, next);
            }
            Object.values(node).forEach(child => visit(child, next));
        };
        visit(root);
    }
    const feedback = tools.find(tool => tool.name === 'feedback');
    assert(feedback);
    assert(!('validateOnly' in feedback.inputSchema.properties));
    assert.match(feedback.description, /without validateOnly/);
    const av = tools.find(tool => tool.name === 'av');
    assert(av.inputSchema.properties.action.enum.includes('set_filters'));
    report.checks.push({ transport, check: 'acyclic schemas and feedback contract', tools: tools.length, avSchemaBytes: Buffer.byteLength(JSON.stringify(av.inputSchema)) });
}

async function main() {
    const originalFetch = global.fetch;
    global.fetch = mockFetch;
    process.env.SIYUAN_API_URL = 'http://127.0.0.1:1';
    process.env.SIYUAN_TOKEN = 'mock-only';
    const bundle = require(bundlePath);
    const runtime = await bundle.createSiYuanServerRuntime();
    const config = runtime.initialConfigLoad.config;
    config.extension.enabled = false;
    files['/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig'] = JSON.stringify(config);
    runtime.getToolConfig = async () => config;
    const server = await bundle.createSiYuanServer({ transportMode: 'http', runtime });
    const client = new Client({ name: 'built-issue-regressions', version: '1' }, { capabilities: { elicitation: {} }, versionNegotiation: { mode: 'auto' } });
    let confirmation = { action: 'accept', content: {} };
    client.setRequestHandler('elicitation/create', async () => confirmation);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const parse = result => result.structuredContent ?? JSON.parse(result.content[0].text);
    try {
        await Promise.all([client.connect(ct), server.connect(st)]);
        checkSchemas((await client.listTools()).tools, 'direct legacy');
        const move = { name: 'block', arguments: { action: 'move', id: 'source', parentID: 'doc' } };
        assert.equal(parse(await client.callTool(move)).error.code, 'precondition_required');
        assert.equal(blockMoves, 0);
        report.checks.push({ check: 'legacy calls still require strict preflight' });
        const args = { action: 'submit', description: 'mock-only feedback' };
        const preflight = parse(await client.callTool({ name: 'feedback', arguments: { ...args, validateOnly: true } }));
        assert.equal(preflight.error.code, 'preflight_unavailable');
        assert.match(preflight.error.hint, /without validateOnly/);
        assert.equal(feedbackPosts, 0);
        const submitted = parse(await client.callTool({ name: 'feedback', arguments: args }));
        assert.equal(submitted.success, true);
        assert.equal(submitted.safety.writeSafetyGuaranteed, false);
        assert.equal(feedbackPosts, 1);
        report.checks.push({ check: 'feedback zero-send preflight and one mock POST' });
    } finally {
        await client.close();
        await server.close();
        await runtime.close();
        global.fetch = originalFetch;
    }

    // A real stdio child reads only from this disposable local mock API.
    const kernel = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = await mockFetch(`http://127.0.0.1${request.url}`, { method: request.method, body: Buffer.concat(chunks).toString() });
        response.writeHead(result.status, { 'Content-Type': 'application/json' });
        response.end(await result.text());
    });
    await new Promise(resolve => kernel.listen(0, '127.0.0.1', resolve));
    const env = { PATH: process.env.PATH, SIYUAN_API_URL: `http://127.0.0.1:${kernel.address().port}`, SIYUAN_TOKEN: 'mock-only' };
    const transport = new StdioClientTransport({ command: process.execPath, args: [bundlePath], env: { ...env, SIYUAN_MCP_TRANSPORT: 'stdio' }, stderr: 'pipe' });
    const stdio = new Client({ name: 'built-stdio-regressions', version: '1' });
    let httpProcess;
    let httpClient;
    try {
        await stdio.connect(transport);
        checkSchemas((await stdio.listTools()).tools, 'stdio');
        assert.equal(parse(await stdio.callTool({ name: 'system', arguments: { action: 'get_version' } })).version, 'mock-kernel');
        const probe = createServer();
        await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
        const port = probe.address().port;
        await new Promise(resolve => probe.close(resolve));
        httpProcess = spawn(process.execPath, [bundlePath, '--http'], { env: { ...env, SIYUAN_MCP_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Built HTTP server did not start')), 10000);
            httpProcess.once('exit', () => { clearTimeout(timer); reject(new Error('Built HTTP server exited')); });
            httpProcess.once('error', error => { clearTimeout(timer); reject(error); });
            httpProcess.stderr.on('data', data => {
                if (String(data).includes('listening on')) { clearTimeout(timer); resolve(); }
            });
        });
        httpClient = new Client({ name: 'built-http-regressions', version: '1' }, { capabilities: { elicitation: {} }, versionNegotiation: { mode: 'auto' } });
        httpClient.setRequestHandler('elicitation/create', async () => confirmation);
        await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
        assert.equal(httpClient.getNegotiatedProtocolVersion(), '2026-07-28');
        checkSchemas((await httpClient.listTools()).tools, 'HTTP modern');
        const move = { name: 'block', arguments: { action: 'move', id: 'source', parentID: 'doc' } };
        const invalid = parse(await httpClient.callTool(move));
        assert.equal(invalid.error.code, 'confirmation_invalid');
        assert.equal(invalid.cancelled, false);
        confirmation = { action: 'accept', content: { confirm: true } };
        assert.equal(parse(await httpClient.callTool(move)).error.code, 'precondition_required');
        assert.equal(blockMoves, 0);
        report.checks.push({ check: 'built HTTP: invalid confirmation rejected; accepted confirmation cannot bypass strict preflight' });
        const cliPath = path.resolve(__dirname, '../../cli/dist/cli.cjs');
        const cli = await promisify(execFile)(process.execPath, [cliPath, 'system', 'get_version', '--json'], { env });
        assert.match(cli.stdout, /mock-kernel/);
        report.cliSha256 = createHash('sha256').update(readFileSync(cliPath)).digest('hex');
        report.checks.push({ check: 'built CLI read from mock kernel' });
    } finally {
        await stdio.close();
        await transport.close();
        await httpClient?.close();
        if (httpProcess && httpProcess.exitCode === null) {
            const exited = once(httpProcess, 'exit');
            httpProcess.kill('SIGTERM');
            await exited;
        }
        await new Promise(resolve => kernel.close(resolve));
    }
    if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
