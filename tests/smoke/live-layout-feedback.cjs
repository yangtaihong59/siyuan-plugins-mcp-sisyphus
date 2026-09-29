/** Fresh-CJS regression for layout feedback. Writes only a new fixture in SIYUAN_TEST_NOTEBOOK. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = process.cwd(), req = createRequire(root + '/package.json');
const { Client, InMemoryTransport } = req('@modelcontextprotocol/client');
const { StdioClientTransport } = req('@modelcontextprotocol/client/stdio');
const prefix = 'LAYOUT-FIX-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const reportPath = process.env.SIYUAN_TEST_REPORT || '/tmp/' + prefix + '.json';
const report = { prefix, fixtures: [], checks: [], artifacts: {} };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
const payload = (r) => r.structuredContent || JSON.parse(r.content.find(c => c.type === 'text').text);
let runtime, server, client, stdio;
async function check(name, run) {
    try { const result = await run(); report.checks.push({ name, status: 'passed', result }); save(); console.log('PASS ' + name); return result; }
    catch (e) { report.checks.push({ name, status: 'failed', error: e.message }); save(); throw e; }
}
async function main() {
    const notebook = process.env.SIYUAN_TEST_NOTEBOOK;
    assert(notebook && process.env.SIYUAN_API_URL && process.env.SIYUAN_TOKEN, 'Explicit test notebook and API credentials are required.');
    for (const file of ['dist/mcp-server.cjs', 'cli/dist/cli.cjs']) report.artifacts[file] = crypto.createHash('sha256').update(fs.readFileSync(root + '/' + file)).digest('hex');
    const built = req(root + '/dist/mcp-server.cjs');
    runtime = await built.createSiYuanServerRuntime();
    const ledger = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/writeSafetyLedger';
    const readFile = runtime.client.readFile.bind(runtime.client), writeFile = runtime.client.writeFile.bind(runtime.client);
    report.isolatedLedger = ledger + '-' + prefix;
    runtime.client.readFile = (p, ...args) => readFile(p === ledger ? report.isolatedLedger : p, ...args);
    runtime.client.writeFile = (p, ...args) => writeFile(p === ledger ? report.isolatedLedger : p, ...args);
    const originalConfig = runtime.getToolConfig.bind(runtime);
    let slim = true;
    runtime.getToolConfig = async () => { const config = await originalConfig(); config.debug.slimResponses = slim; return config; };
    assert((await runtime.getToolConfig()).writeSafety.strictMode, 'Strict mode must be enabled.');
    server = await built.createSiYuanServer({ transportMode: 'http', runtime });
    client = new Client({ name: 'layout-feedback-regression', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    const call = async (tool, args) => {
        const result = payload(await client.callTool({ name: tool, arguments: args }));
        (report.calls ??= []).push({ tool, args, result }); save(); return result;
    };
    const mutation = async (tool, args, replay = false) => {
        const preflight = await call(tool, { ...args, validateOnly: true });
        assert(!preflight.error, JSON.stringify(preflight));
        assert.match(preflight.requestId, /^[a-f0-9]{4,64}$/);
        const input = { ...args, requestId: preflight.requestId, ...(preflight.preconditionField ? { [preflight.preconditionField]: preflight[preflight.preconditionField] } : {}) };
        const result = await call(tool, input);
        assert(!result.error, JSON.stringify(result));
        assert.equal(result.safety?.transactionState, 'committed', JSON.stringify(result));
        assert.equal(result.safety?.writeSafetyGuaranteed, true);
        if (replay) { const repeated = await call(tool, input); assert.equal((repeated.safety ?? repeated).replayed, true); }
        return result;
    };
    report.version = await call('system', { action: 'get_version' });
    await check('test notebook exists', async () => {
        const result = await call('notebook', { action: 'list' });
        assert(!result.error, JSON.stringify(result));
        assert((result.value || result).some(n => n.id === notebook)); return { notebook };
    });
    await check('invalid create preflight rejects without requestId', async () => {
        const result = await call('document', { action: 'create', notebook, title: prefix, validateOnly: true });
        assert(result.error); assert(!result.requestId); assert(JSON.stringify(result).includes('Provide path')); return result;
    });
    await check('create help exposes legal combinations and a complete example', async () => {
        const result = await call('document', { action: 'help', topic: 'create' });
        assert.deepEqual(result.shapes, ['notebook + path', 'notebook + parentPath + title']);
        assert(result.example.path || (result.example.parentPath && result.example.title)); return result.shapes;
    });
    await check('resource and tool-only layout guide are identical', async () => {
        const result = await call('fs', { action: 'help', topic: 'ai-layout-guide' });
        const resource = await client.readResource({ uri: 'siyuan://help/ai-layout-guide' });
        assert.equal(result.text, resource.contents[0].text); assert(result.text.length > 12000); return { chars: result.text.length };
    });
    await check('fs.read explains resource URI misuse', async () => {
        const result = await call('fs', { action: 'read', path: 'siyuan://help/ai-layout-guide' });
        assert(result.error); assert(JSON.stringify(result).includes('resources/read')); return result;
    });
    const doc = await check('create by path and replay', () => mutation('document', { action: 'create', notebook, path: '/' + prefix, markdown: '隔离回归测试夹具。', icon: '1f9ea' }, true));
    report.fixtures.push({ type: 'document', id: doc.id, notebook, path: '/' + prefix }); save();
    const child = await check('create by parentPath and title', () => mutation('document', { action: 'create', notebook, parentPath: '/' + prefix, title: 'Child', icon: '1f9ea' }));
    report.fixtures.push({ type: 'document', id: child.id, notebook }); save();
    const av = await check('create isolated AV', () => mutation('av', { action: 'render', blockID: doc.id, createIfNotExist: true }));
    const context = { avID: av.avID, blockID: av.blockID };
    report.fixtures.push({ type: 'av', ...context, parentID: doc.id }); save();
    const rows = await check('add three detached rows', () => mutation('av', { action: 'add_rows', ...context, primaryKeyTexts: ['A', 'B', 'C'] }));
    const text = await check('add text column', () => mutation('av', { action: 'add_column', ...context, keyName: '负责人', keyType: 'text' }));
    const date = await check('add date column', () => mutation('av', { action: 'add_column', ...context, keyName: '截止日期', keyType: 'date' }));
    const selectID = av.view.columns.find(c => c.type === 'select').id;
    const cells = rows.rows.flatMap((row, i) => [
        { rowID: row.rowID, columnID: selectID, valueType: 'select', option: i < 2 ? '进行中' : '待开始' },
        { rowID: row.rowID, columnID: text.keyID, valueType: 'text', text: ['甲', '乙', '丙'][i] },
        { rowID: row.rowID, columnID: date.keyID, valueType: 'date', date: 1788998400000 + i * 86400000, includeTime: false },
    ]);
    await check('nine cells including repeated new select option, then replay', () => mutation('av', { action: 'set_cells', ...context, cells }, true));
    // Exercise the other scalar postimage comparisons added by this fix.
    const extraTypes = [
        ['number', { valueType: 'number', number: 12.5 }],
        ['checkbox', { valueType: 'checkbox', checked: true }],
        ['mSelect', { valueType: 'multi_select', options: ['Alpha', 'Beta'] }],
        ['url', { valueType: 'url', url: 'https://example.com' }],
        ['email', { valueType: 'email', email: 'fixture@example.com' }],
        ['phone', { valueType: 'phone', phone: '123456' }],
    ];
    const extraCells = [];
    for (const [keyType, input] of extraTypes) {
        const column = await check('add ' + keyType + ' verification column', () => mutation('av', { action: 'add_column', ...context, keyName: keyType, keyType }));
        extraCells.push({ rowID: rows.rows[0].rowID, columnID: column.keyID, ...input });
    }
    await check('other scalar types retain their requested values', () => mutation('av', { action: 'set_cells', ...context, cells: extraCells }));
    const raw = await runtime.client.requestRead('/api/av/getAttributeView', { id: av.avID });
    const values = (result) => cells.map(cell => {
        const v = result.av.keyValues.find(k => k.key.id === cell.columnID).values.find(v => v.blockID === cell.rowID);
        return cell.valueType === 'select' ? v.mSelect[0].content : v[cell.valueType].content;
    });
    const expected = cells.map(c => c.option ?? c.text ?? c.date);
    await check('raw API contains all nine requested values', async () => { assert.deepEqual(values(raw), expected); return expected; });
    for (const mode of [true, false]) {
        slim = mode;
        await check('av.get preserves all nine values, slim=' + mode, async () => {
            const result = await call('av', { action: 'get', id: av.avID }); assert.deepEqual(values(result), expected); return values(result);
        });
        await check('av.render preserves repeated option names, slim=' + mode, async () => {
            const result = await call('av', { action: 'render', id: av.avID, blockID: av.blockID });
            const names = result.data.map(row => row.cells[selectID]);
            assert(JSON.stringify(names).includes('进行中')); assert(JSON.stringify(names).includes('待开始')); return names;
        });
    }
    slim = true;
    await check('av.get accepts canonical avID', async () => {
        const result = await call('av', { action: 'get', avID: av.avID }); assert(!result.error); assert.equal(result.av.id, av.avID); return { avID: result.av.id };
    });
    await check('fresh CLI reads all nine values', async () => {
        const result = JSON.parse(cp.execFileSync(process.execPath, [root + '/cli/dist/cli.cjs', 'av', 'get', '--id', av.avID, '--json'], { encoding: 'utf8', env: process.env }));
        assert.deepEqual(values(result), expected); return values(result);
    });
    stdio = new Client({ name: 'layout-feedback-stdio', version: '1' });
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [root + '/dist/mcp-server.cjs'], env: { ...process.env } }));
    await check('fresh stdio reads all nine values', async () => {
        const result = payload(await stdio.callTool({ name: 'av', arguments: { action: 'get', id: av.avID } }));
        assert.deepEqual(values(result), expected); return values(result);
    });
    await check('fresh CLI supports tool-only layout guide', async () => {
        const result = JSON.parse(cp.execFileSync(process.execPath, [root + '/cli/dist/cli.cjs', 'fs', 'help', '--topic', 'ai-layout-guide', '--json'], { encoding: 'utf8', env: process.env }));
        assert(result.text?.length > 12000); return { chars: result.text.length };
    });
    report.cleanup = 'Retained isolated fixtures for review. No existing document was modified.';
    save();
}
main().catch(e => { report.failure = e.message; save(); console.error(e.message); process.exitCode = 1; }).finally(async () => {
    await stdio?.close(); await client?.close(); await server?.close(); await runtime?.close(); console.log('Report: ' + reportPath);
});
