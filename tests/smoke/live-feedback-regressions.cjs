#!/usr/bin/env node
'use strict';

// Real-kernel regression suite. All mutations stay in a newly created document
// inside the explicitly selected notebook. No global settings are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const net = require('node:net');
const { Client, InMemoryTransport, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

const root = path.resolve(__dirname, '../..');
const notebook = process.argv[process.argv.indexOf('--notebook') + 1];
assert(process.argv.includes('--notebook') && /^\d{14}-[a-z0-9]{7}$/.test(notebook), 'Pass --notebook <test notebook ID>');
const prefix = `CJS-FEEDBACK-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-feedback-live-'));
const serverPath = path.join(root, 'dist/mcp-server.cjs');
const cliPath = path.join(root, 'cli/dist/cli.cjs');
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.siyuan-sisyphus/config.json'), 'utf8'));
const profile = config.profiles?.[config.currentProfile || 'default'] || config;
const apiUrl = (process.env.SIYUAN_API_URL || profile.apiUrl || 'http://127.0.0.1:6806').replace(/\/+$/, '');
const token = process.env.SIYUAN_TOKEN || profile.token || '';
process.env.SIYUAN_API_URL = apiUrl;
process.env.SIYUAN_TOKEN = token;
const report = {
    prefix, startedAt: new Date().toISOString(), notebook, fixtures: [], checks: [],
    artifacts: Object.fromEntries([serverPath, cliPath].map(p => [path.relative(root, p), crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),
    scope: 'Reported set_filters schema failure and block.update batch / inline-attribute safety. Other mutation actions are explicitly excluded from this focused regression run.',
};
let client, server;
const save = () => fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
function passed(name, evidence = {}) { report.checks.push({ name, status: 'covered', ...evidence }); save(); console.log(JSON.stringify({ check: name, ...evidence })); }
async function api(endpoint, body = {}) {
    const response = await fetch(apiUrl + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) }, body: JSON.stringify(body) });
    assert(response.ok, `${endpoint}: HTTP ${response.status}`);
    const result = await response.json();
    assert.equal(result.code, 0, `${endpoint}: ${result.msg}`);
    return result.data;
}
function payload(result) {
    const text = result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n');
    if (text) { try { return JSON.parse(text); } catch {} }
    return result.structuredContent;
}
async function call(tool, args, connection = client, allowError = false) {
    const result = await connection.callTool({ name: tool, arguments: args });
    const data = payload(result);
    if (!allowError) assert(!result.isError && !data?.error, `${tool}.${args.action}: ${JSON.stringify(data)}`);
    return data;
}
async function preflight(tool, args, connection = client) {
    const p = await call(tool, { ...args, validateOnly: true }, connection);
    assert.equal(p.writeAttempted, false);
    assert.match(p.requestId, /^[a-f0-9]{4,64}$/);
    assert(p.requestIdExpiresAt > Date.now());
    if (p.preconditionField) {
        assert.match(p[p.preconditionField], /^[a-f0-9]{4,64}$/);
        assert(p.hashPrefixLength >= 4 && p.leaseExpiresAt > Date.now());
    }
    return p;
}
function executionArgs(args, p) {
    const key = p.preconditionField;
    return { ...args, requestId: p.requestId, ...(key ? { [key]: p[key] } : {}) };
}
async function mutate(tool, args, { expectedCount, expectedState = 'committed', additive = false, label = `${tool}.${args.action}`, connection = client } = {}) {
    const p = await preflight(tool, args, connection);
    const spare = p.preconditionField ? await preflight(tool, args, connection) : null;
    if (expectedCount !== undefined) assert.equal(p.targetCount, expectedCount);
    const actual = executionArgs(args, p);
    const result = await call(tool, actual, connection);
    assert.equal(result.safety?.writeSafetyGuaranteed, true, JSON.stringify(result));
    assert.equal(result.safety.transactionState, expectedState, JSON.stringify(result));
    const replay = await call(tool, actual, connection);
    assert.equal(replay.safety?.replayed ?? replay.replayed, true, JSON.stringify(replay));
    if (spare) {
        const consumed = await call(tool, { ...actual, requestId: spare.requestId }, connection, true);
        assert.equal(consumed.error?.code, 'preflight_lease_invalid', JSON.stringify(consumed));
    }
    passed(label, { targetCount: p?.targetCount, transactionState: result.safety.transactionState, replay: true, leaseConsumed: !!spare, previousHash: result.safety.previousHash, resultHash: result.safety.resultHash });
    return result;
}
function validateReferences(tools, transport) {
    let refs = 0;
    for (const tool of tools) {
        const schema = JSON.parse(JSON.stringify(tool.inputSchema));
        const visit = value => {
            if (!value || typeof value !== 'object') return;
            if (typeof value.$ref === 'string') {
                assert(value.$ref === '#' || value.$ref.startsWith('#/'), `${tool.name}: non-local reference`);
                const target = value.$ref === '#' ? schema : value.$ref.slice(2).split('/').reduce((v, k) => v?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], schema);
                assert(target, `${tool.name}: unresolved ${value.$ref}`); refs++;
            }
            Object.values(value).forEach(visit);
        };
        visit(schema);
    }
    const av = tools.find(t => t.name === 'av');
    assert(av?.inputSchema.properties.action.enum.includes('set_filters'));
    assert(refs > 0);
    passed(`tools/list references (${transport})`, { tools: tools.length, refs });
    fs.writeFileSync(path.join(reportDir, `schemas-${transport}.json`), JSON.stringify(tools.map(t => ({ name: t.name, inputSchema: t.inputSchema })), null, 2));
}
async function assertFixture(id) {
    const info = await api('/api/block/getBlockInfo', { id });
    assert.equal(info.box, notebook);
    assert.equal(info.rootID, report.fixtureDocID);
}
async function main() {
    const built = require(serverPath);
    const runtime = await built.createSiYuanServerRuntime();
    const originalRead = runtime.client.requestRead.bind(runtime.client);
    const observations = [];
    runtime.client.requestRead = async (endpoint, args) => {
        const result = await originalRead(endpoint, args);
        if (['/api/av/getAttributeView', '/api/block/getBlockDOM', '/api/attr/getBlockAttrs', '/api/block/getBlockInfo'].includes(endpoint)) {
            observations.push({ endpoint, args, result });
            fs.writeFileSync(path.join(reportDir, 'observations.json'), JSON.stringify(observations, null, 2));
        }
        return result;
    };
    server = await built.createSiYuanServer({ transportMode: 'http', runtime });
    client = new Client({ name: 'sisyphus-real-feedback-regression', version: '1.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    report.version = (await call('system', { action: 'get_version' })).version;
    const permissions = await call('notebook', { action: 'get_permissions', notebook });
    assert(JSON.stringify(permissions).includes('rwd'), 'The selected test notebook must allow rwd');
    validateReferences((await client.listTools()).tools, 'direct');
    const existingID = process.argv.includes('--fixture') ? process.argv[process.argv.indexOf('--fixture') + 1] : undefined;
    if (existingID) {
        const info = await api('/api/block/getBlockInfo', { id: existingID });
        const attrs = await api('/api/attr/getBlockAttrs', { id: existingID });
        assert.equal(info.box, notebook);
        assert(attrs.title?.startsWith('CJS-FEEDBACK-'), 'Only an earlier fixture from this regression suite may be resumed');
    }
    const created = existingID ? { id: existingID } : await mutate('document', { action: 'create', notebook, path: `/${prefix}`, markdown: Array.from({ length: 11 }, (_, i) => `原始段落-${i}`).join('\n\n'), icon: '1f9ea' }, { additive: true });
    const docID = created.id || created.rootID;
    assert(docID, JSON.stringify(created));
    report.fixtureDocID = docID;
    const fixtureTitle = (await api('/api/attr/getBlockAttrs', { id: docID })).title;
    report.fixtures.push({ type: 'document', id: docID, path: `/${fixtureTitle}`, cleanup: 'retained; document.remove is disabled in the current user configuration' }); save();
    if (!process.argv.includes('--av-only')) {
    let blocks = await api('/api/block/getChildBlocks', { id: docID });
    const ids = blocks.filter(b => b.type === 'p').map(b => b.id);
    assert.equal(ids.length, 11);
    const items = ids.map((id, i) => ({ id, dataType: 'markdown', data: `更新段落-${i}` }));
    await mutate('block', { action: 'update', items }, { expectedCount: 11, label: 'block.update 11-item batch' });
    for (let i = 0; i < ids.length; i++) assert((await api('/api/block/getBlockKramdown', { id: ids[i] })).kramdown.includes(`更新段落-${i}`));
    passed('batch readback', { verifiedBlocks: 11 });

    await mutate('block', { action: 'append', parentID: docID, dataType: 'markdown', data: `引用 ((${ids[0]} "更新段落-0"))` }, { additive: true });
    blocks = await api('/api/block/getChildBlocks', { id: docID });
    const refID = blocks.find(b => !ids.includes(b.id))?.id;
    assert(refID);
    await assertFixture(refID);
    const beforeDom = (await api('/api/block/getBlockDOM', { id: refID })).dom;
    assert(beforeDom.includes('data-subtype="d"'), 'Fixture must contain a dynamic reference');
    const afterDom = beforeDom.replace('data-subtype="d"', 'data-subtype="s"').replace('data-type="block-ref"', 'data-type="block-ref strong"');
    assert.notEqual(beforeDom, afterDom);
    const attributeArgs = { action: 'update', id: refID, dataType: 'dom', data: afterDom };
    await mutate('block', attributeArgs, { expectedCount: 1, label: 'block.update DOM subtype + strong' });
    const readbackDom = (await api('/api/block/getBlockDOM', { id: refID })).dom;
    assert(readbackDom.includes('data-subtype="s"') && readbackDom.includes('block-ref strong'));
    passed('DOM persistent attribute readback', { id: refID, subtype: 's', strong: true });
    await mutate('block', { ...attributeArgs, data: readbackDom }, { expectedState: 'no_change', label: 'block.update identical DOM' });

    // Simulate an independent editor changing only persistent inline attributes.
    const staleArgs = { ...attributeArgs, data: readbackDom.replace('block-ref strong', 'block-ref em') };
    const stale = await preflight('block', staleArgs);
    await assertFixture(refID);
    const externalDom = readbackDom.replace('block-ref strong', 'block-ref mark');
    await api('/api/block/updateBlock', { id: refID, dataType: 'dom', data: externalDom });
    const drift = await call('block', executionArgs(staleArgs, stale), client, true);
    assert.equal(drift.error?.code, 'state_changed', JSON.stringify(drift));
    const unchanged = (await api('/api/block/getBlockDOM', { id: refID })).dom;
    assert(unchanged.includes('block-ref mark') && !unchanged.includes('block-ref em'));
    passed('block.update concurrent inline attribute drift', { code: drift.error.code, rejectedWriteAbsent: true });

    }
    const previousAv = process.argv.includes('--av-id') ? { avID: process.argv[process.argv.indexOf('--av-id') + 1], blockID: process.argv[process.argv.indexOf('--av-block') + 1] } : undefined;
    const rendered = previousAv || await mutate('av', { action: 'render', blockID: docID, createIfNotExist: true }, { additive: true });
    const avID = rendered.avID || rendered.id;
    const blockID = rendered.blockID;
    assert(avID && blockID, JSON.stringify(rendered));
    await assertFixture(blockID);
    assert((await api('/api/block/getBlockDOM', { id: blockID })).dom.includes(`data-av-id="${avID}"`));
    report.fixtures.push({ type: 'av', id: avID, blockID, cleanup: 'retained with isolated fixture document' }); save();
    const definition = (await api('/api/av/getAttributeView', { id: avID })).av;
    const attrs = await api('/api/attr/getBlockAttrs', { id: blockID });
    const viewID = attrs['custom-sy-av-view'];
    assert(viewID && definition.views.some(v => v.id === viewID));
    const column = definition.keyValues[0].key.id;
    const filters = [{ combination: 'and', filters: [{ column, operator: 'Is not empty' }, { combination: 'or', filters: [{ column, operator: 'Is empty' }] }] }];
    const filterArgs = { action: 'set_filters', avID, blockID, viewID, filters };
    await mutate('av', filterArgs, { label: 'av.set_filters recursive tree' });
    let av = (await api('/api/av/getAttributeView', { id: avID })).av;
    const filterText = JSON.stringify(av.views.find(v => v.id === viewID));
    assert(filterText.includes('Is not empty') && filterText.includes('Is empty'));
    passed('recursive filters raw readback', { avID, viewID });
    await mutate('av', { ...filterArgs, filters: [] }, { label: 'av.set_filters empty array' });
    av = (await api('/api/av/getAttributeView', { id: avID })).av;
    const cleared = av.views.find(v => v.id === viewID);
    assert(!JSON.stringify(cleared).includes('Is not empty'));
    passed('empty filters raw readback', { avID });

    const stdio = new Client({ name: 'sisyphus-real-feedback-stdio', version: '1.0.0' });
    try {
        await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env: { ...process.env } }));
        validateReferences((await stdio.listTools()).tools, 'stdio');
        assert.equal((await call('system', { action: 'get_version' }, stdio)).version, report.version);
        passed('stdio real-kernel version read');
    } finally { await stdio.close(); }
    const cliOutput = execFileSync(process.execPath, [cliPath, 'system', 'get_version', '--json'], { cwd: root, encoding: 'utf8', env: process.env });
    assert(cliOutput.includes(report.version));
    passed('CLI real-kernel version read');
    // Serve the exact bundle over a real loopback HTTP transport without
    // redirecting the installed plugin or changing persisted HTTP settings.
    const socket = net.createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const httpToken = crypto.randomBytes(24).toString('hex');
    const child = spawn(process.execPath, [serverPath, '--http'], {
        cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, SIYUAN_MCP_HOST: '127.0.0.1', SIYUAN_MCP_PORT: String(port), SIYUAN_MCP_TOKEN: httpToken,
            SIYUAN_MCP_TLS_CERT: '', SIYUAN_MCP_TLS_KEY: '' },
    });
    const http = new Client({ name: 'sisyphus-real-feedback-http', version: '1.0.0' });
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('HTTP bundle startup timeout')), 15000);
            child.stderr.on('data', chunk => { if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve(); } });
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('exit', code => { clearTimeout(timer); reject(new Error(`HTTP bundle exited: ${code}`)); });
        });
        await http.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
            authProvider: { token: async () => httpToken },
        }));
        validateReferences((await http.listTools()).tools, 'http');
        await mutate('av', filterArgs, { label: 'av.set_filters recursive tree (HTTP)', connection: http });
        await mutate('av', { ...filterArgs, filters: [] }, { label: 'av.set_filters empty array (HTTP)', connection: http });
    } finally {
        await http.close().catch(() => {});
        child.kill('SIGTERM');
        await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    }
    report.crossEntryWrites = 'intentionally excluded: CLI/stdio route writes to the installed plugin coordinator; its process has not been restarted or proven to run this exact bundle';
    report.finishedAt = new Date().toISOString();
    const markdown = `思源版本：${report.version}。仅测试用户反馈的 Schema、批量更新、行内属性安全；不是全部 action 的真实验收。\n\n测试文档：[${fixtureTitle}](siyuan://blocks/${docID})\n\n` +
        '| 检查 | 结果 |\n| --- | --- |\n' + report.checks.map(c => `| ${c.name} | 通过${c.transactionState ? '：' + c.transactionState : ''} |`).join('\n') +
        '\n\n文档删除 action 已关闭，本轮夹具保留以供查看。CLI/stdio 已验证工具发现或只读调用；跨入口写入共享租约未测，因为没有重启用户正在使用的插件协调器。';
    fs.writeFileSync(path.join(reportDir, 'report.md'), markdown);
    const summary = await mutate('document', { action: 'create', notebook, path: `/${prefix}-验收报告`, markdown, icon: '2705' }, { additive: true, label: 'document.create test report' });
    report.reportDocID = summary.id;

}
main().catch(error => { report.failure = error.message; console.error(error.message); process.exitCode = 1; }).finally(async () => {
    let category;
    report.mutationCoverage = [];
    for (const line of fs.readFileSync(path.join(root, 'src/core/write-safety-policy.ts'), 'utf8').split('\n')) {
        const group = /^    (\w+): \{/.exec(line);
        if (group) category = group[1];
        for (const match of line.matchAll(/(\w+): mutation\((?:'([^']+)')?/g)) {
            const action = `${category}.${match[1]}`;
            const covered = report.checks.some(check => check.name.startsWith(action));
            report.mutationCoverage.push({ action, precondition: match[2] || 'none', status: covered ? 'covered' : 'intentionally excluded', reason: covered ? 'See check evidence' : 'Outside the three reported regressions; no global or unrelated mutations performed' });
        }
    }
    save();
    await client?.close().catch(() => {});
    await server?.close().catch(() => {});
    console.log(JSON.stringify({ report: path.join(reportDir, 'report.json'), fixtureDocID: report.fixtureDocID }));
});
