#!/usr/bin/env node
/*
 * Safe live verification against a running SiYuan (pnpm test:live).
 *
 * Every write happens inside ONE temporary notebook created by this run; the
 * notebook, its permission entry and the attribute-view file it created are
 * removed at the end. Existing notebooks, settings and data are never touched.
 *
 * Env: SIYUAN_API_URL (default http://127.0.0.1:6806), SIYUAN_TOKEN (optional).
 * Runs the built dist/mcp-server.cjs in-process with a Node-owned write
 * coordinator, so it also works when the kernel endpoint is unavailable.
 */
const path = require('node:path');
const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const { createSiYuanServer } = require(path.join(__dirname, '..', '..', 'dist', 'mcp-server.cjs'));

const BASE = (process.env.SIYUAN_API_URL || 'http://127.0.0.1:6806').replace(/\/+$/, '');
process.env.SIYUAN_API_URL = BASE;
const TOKEN = process.env.SIYUAN_TOKEN || '';
const AUTH = TOKEN ? { Authorization: `Token ${TOKEN}` } : {};
const PET = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/';

// Present a Node-owned coordinator in-process only; the stored settings are not modified.
const realFetch = global.fetch;
global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/file/getFile') && options.body) {
        try {
            if (JSON.parse(options.body).path === `${PET}mcpHttpSettings`) {
                return new Response(JSON.stringify({ enabled: true, host: '127.0.0.1', port: 36806, kernelEndpointEnabled: false }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
        } catch { /* not a JSON body */ }
    }
    return realFetch(url, options);
};

const api = async (endpoint, body) => (await realFetch(BASE + endpoint, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const parse = (result) => {
    const text = result.content?.find((item) => item.type === 'text')?.text ?? '';
    try { return JSON.parse(text); } catch { return text; }
};
const has = (value, needle) => JSON.stringify(value).includes(needle);
const results = [];
const log = (status, name, detail = '') => {
    results.push(status);
    console.log(`${status} ${name}${detail ? ` - ${String(detail).slice(0, 300)}` : ''}`);
};

async function main() {
    const server = await createSiYuanServer({ transportMode: 'http' });
    const client = new Client({ name: 'sisyphus-live-verify', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const call = async (name, args) => parse(await client.callTool({ name, arguments: args }));
    const read = async (name, args) => {
        const result = await call(name, args);
        if (result?.error) throw new Error(JSON.stringify(result));
        return result;
    };
    const strict = async (name, args) => {
        const preflight = await call(name, { ...args, validateOnly: true });
        if (!preflight?.preflight?.commitArgs) throw new Error(`preflight: ${JSON.stringify(preflight).slice(0, 400)}`);
        const out = await call(name, preflight.preflight.commitArgs);
        if (out?.error || out?.success === false) throw new Error(`commit: ${JSON.stringify(out).slice(0, 600)}`);
        return out;
    };
    const step = async (name, fn) => {
        try { log('PASS', name, (await fn()) ?? ''); return true; } catch (error) { log('FAIL', name, error.message); return false; }
    };

    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const notebookName = `Sisyphus live verify ${stamp}`;
    let notebook, docID, blockID, avID, carrier, keyID, rowID;
    try {
        if (!await step('notebook.create grants rwd', async () => {
            const created = await strict('notebook', { action: 'create', name: notebookName });
            notebook = created.id ?? created.notebook?.id;
            const perms = await read('notebook', { action: 'get_permissions' });
            const entry = (perms.notebooks ?? []).find((n) => n.id === notebook);
            if (entry?.permission !== 'rwd') throw new Error(`permission=${entry?.permission}`);
            return notebook;
        })) return;
        await step('gate errors use the shared shape', async () => {
            const unknown = await call('no_such_tool', { action: 'x' });
            if (unknown.error?.type !== 'unknown_tool') throw new Error(JSON.stringify(unknown));
        });
        await step('action aliases resolve on every transport (fs list -> ls)', async () => { await read('fs', { action: 'list', path: '/' }); });
        await step('document.create', async () => {
            const doc = await strict('document', { action: 'create', notebook, path: '/verify', markdown: "first O'Brien paragraph\n\nsecond paragraph" });
            docID = doc.id;
            if (!docID) throw new Error(JSON.stringify(doc));
            return docID;
        });
        await step('document.list_tree', async () => { if (!has(await read('document', { action: 'list_tree', notebook, path: '/' }), docID)) throw new Error('missing doc'); });
        await step('fs.ls with a messy path', async () => { if (!has(await read('fs', { action: 'ls', path: `//${notebookName}//` }), 'verify')) throw new Error('missing doc'); });
        await step('fs.read', async () => { if (!has(await read('fs', { action: 'read', path: `/${notebookName}/verify/` }), 'Brien')) throw new Error('missing text'); });
        await step('fs.replace', async () => { await strict('fs', { action: 'replace', path: `/${notebookName}/verify`, edit: { old: 'second paragraph', new: 'second paragraph (replaced)' } }); });
        await step('document.query (multi-JOIN SQL)', async () => { if (!has(await read('document', { action: 'query', notebooks: [notebook], title: 'verify' }), docID)) throw new Error('missing doc'); });
        await step('search.fulltext with a quote', async () => { await read('search', { action: 'fulltext', query: "O'Brien", paths: [notebook] }); });
        await step('block.append', async () => {
            const out = await strict('block', { action: 'append', parentID: docID, dataType: 'markdown', data: 'appended' });
            blockID = JSON.stringify(out).match(/\d{14}-[a-z0-9]{7}/g)?.find((id) => id !== docID);
            if (!blockID) throw new Error(JSON.stringify(out));
        });
        await step('block.update + get_kramdown', async () => {
            await strict('block', { action: 'update', id: blockID, dataType: 'markdown', data: 'updated' });
            if (!has(await read('block', { action: 'get_kramdown', id: blockID }), 'updated')) throw new Error('readback');
        });
        await step('document.rename', async () => {
            await strict('document', { action: 'rename', id: docID, title: 'verify renamed' });
            if (!has(await read('document', { action: 'get_doc', id: docID }), 'verify renamed')) throw new Error('title');
        });
        await step('block.delete', async () => { await strict('block', { action: 'delete', id: blockID }); });
        if (await step('av.create', async () => {
            const out = await strict('av', { action: 'create', parentID: docID });
            avID = out.avID; carrier = out.blockID;
            if (!avID || !carrier) throw new Error(JSON.stringify(out));
            return `${avID} carrier=${carrier}`;
        })) {
            await step('av.get accepts the exact carrier', async () => { await read('av', { action: 'get', avID, blockID: carrier }); });
            await step('av.get rejects the parent document as carrier', async () => {
                const out = await call('av', { action: 'get', avID, blockID: docID });
                if (out?.error?.type !== 'validation_error') throw new Error(JSON.stringify(out).slice(0, 300));
            });
            await step('av.add_column', async () => { keyID = (await strict('av', { action: 'add_column', avID, blockID: carrier, keyName: 'note', keyType: 'text' })).keyID; if (!keyID) throw new Error('no keyID'); });
            await step('av.add_rows', async () => {
                const out = await strict('av', { action: 'add_rows', avID, blockID: carrier, primaryKeyTexts: ['row'] });
                rowID = out.rows?.[0]?.rowID ?? out.rows?.[0]?.id;
                if (!rowID) throw new Error(JSON.stringify(out));
            });
            await step('av.set_cells + readback', async () => {
                await strict('av', { action: 'set_cells', avID, blockID: carrier, rowID, columnID: keyID, valueType: 'text', text: 'cell value' });
                if (!has(await read('av', { action: 'get', avID, blockID: carrier, scope: 'raw' }), 'cell value')) throw new Error('value missing');
            });
            await step('av.remove_rows', async () => { await strict('av', { action: 'remove_rows', avID, blockID: carrier, rowIDs: [rowID] }); });
            await step('av.remove_column', async () => { await strict('av', { action: 'remove_column', avID, blockID: carrier, keyID }); });
        }
    } finally {
        if (docID) await step('cleanup: remove the document', async () => { await strict('document', { action: 'remove', id: docID }); });
        await client.close().catch(() => {});
        await server.close().catch(() => {});
        global.fetch = realFetch;
        await cleanup(notebook, avID);
    }
}

async function cleanup(notebook, avID) {
    if (notebook) {
        const removed = await api('/api/notebook/removeNotebook', { notebook });
        const text = await (await realFetch(`${BASE}/api/file/getFile`, { method: 'POST', headers: AUTH, body: JSON.stringify({ path: `${PET}notebookPermissions` }) })).text();
        const permissions = JSON.parse(text || '{}');
        if (permissions[notebook]) {
            delete permissions[notebook];
            const form = new FormData();
            form.append('path', `${PET}notebookPermissions`);
            form.append('isDir', 'false');
            form.append('file', new Blob([JSON.stringify(permissions, null, 2)]), 'notebookPermissions');
            await realFetch(`${BASE}/api/file/putFile`, { method: 'POST', headers: AUTH, body: form });
        }
        log(removed.code === 0 ? 'PASS' : 'FAIL', 'cleanup: remove the temporary notebook and its permission entry', removed.code === 0 ? '' : JSON.stringify(removed));
    }
    // SiYuan keeps attribute-view files after their carrier is deleted; remove only the one this run
    // created, once the (asynchronous) index confirms nothing references it any more.
    if (avID) {
        let unreferenced = false;
        for (let attempt = 0; attempt < 15 && !unreferenced; attempt += 1) {
            const refs = await api('/api/query/sql', { stmt: `SELECT id FROM blocks WHERE markdown LIKE '%${avID}%'` });
            unreferenced = Array.isArray(refs.data) && refs.data.length === 0;
            if (!unreferenced) await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (unreferenced) await api('/api/file/removeFile', { path: `/data/storage/av/${avID}.json` });
        log(unreferenced ? 'PASS' : 'FAIL', 'cleanup: remove the created attribute-view file', unreferenced ? '' : `still referenced; remove /data/storage/av/${avID}.json manually`);
    }
}

main()
    .catch((error) => log('FAIL', 'unexpected error', error?.stack ?? error))
    .finally(() => {
        const failed = results.filter((status) => status === 'FAIL').length;
        console.log(`\n${results.length - failed}/${results.length} passed`);
        process.exit(failed ? 1 : 0);
    });
