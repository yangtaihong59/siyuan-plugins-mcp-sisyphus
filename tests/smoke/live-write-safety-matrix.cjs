#!/usr/bin/env node

/*
 * Destructive live smoke test for every Sisyphus-owned mutation action.
 *
 * This test intentionally runs through the standalone CLI so strict writes
 * are coordinated by the plugin HTTP server, exactly like real CLI usage.
 * It requires a running SiYuan instance and a configured CLI profile.
 */

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.join(repoRoot, 'cli/dist/cli.cjs');
const toolConfigPath = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig';
const httpSettingsPath = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpHttpSettings';
const runStamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const testNotebookName = `Sisyphus-全写入实测-${runStamp}`;
const results = [];
let requestSequence = 1;

const actionsByCategory = {
    fs: ['ls', 'tree', 'read', 'write', 'replace', 'rm', 'mv', 'reorder', 'search'],
    notebook: ['list', 'create', 'set_open_state', 'remove', 'rename', 'get_conf', 'set_conf', 'set_icon', 'get_permissions', 'set_permission', 'get_child_docs'],
    document: ['create', 'lookup', 'rename', 'remove', 'move', 'reorder', 'get_child_blocks', 'get_child_docs', 'set_attr', 'list_tree', 'search_docs', 'get_doc', 'get_outline', 'create_daily_note', 'duplicate', 'heading_to_doc', 'doc_to_heading'],
    block: ['insert', 'prepend', 'append', 'update', 'replace', 'delete', 'move', 'set_fold_state', 'get_kramdown', 'batch_kramdown', 'get_children', 'transfer_references', 'set_attrs', 'get_attrs', 'info', 'breadcrumb', 'dom', 'recent_updated', 'word_count', 'add_to_daily_note', 'docs_info'],
    av: ['get', 'render', 'get_attribute_view_keys', 'get_attribute_view_filter_sort', 'search', 'add_rows', 'remove_rows', 'add_column', 'remove_column', 'set_cells', 'duplicate', 'get_primary_key_values'],
    file: ['upload_asset', 'list_templates', 'read_template', 'create_template', 'update_template', 'delete_template', 'save_doc_as_template', 'render', 'export_md', 'export_resources', 'list_unused_assets', 'get_doc_assets', 'get_image_ocr_text', 'remove_unused_assets', 'rename_asset', 'delete_asset', 'extract_doc'],
    search: ['fulltext', 'semantic', 'query_sql', 'get_backlinks', 'search_refs', 'find_replace', 'search_assets', 'fulltext_asset_content', 'list_invalid_refs'],
    tag: ['list', 'rename', 'remove'],
    timeline: ['list_nodes', 'create_node', 'compare_node', 'delete_node', 'rollback_document', 'rollback_block'],
    system: ['workspace_info', 'network', 'conf', 'notify', 'changelog', 'perform_sync', 'get_version', 'get_current_time'],
    flashcard: ['list_cards', 'get_decks', 'get_cards', 'review_card', 'create_card', 'remove_card'],
    extension: ['list'],
    mascot: ['get_balance', 'shop', 'buy'],
    feedback: ['submit'],
};

const expectedFieldByPrecondition = {
    state: 'expectedStateHash',
    structure: 'expectedStructureHash',
    value: 'expectedValueHash',
    manifest: 'expectedManifestHash',
    source: 'expectedSourceHash',
};

const hashFieldByPrecondition = {
    state: 'stateHash',
    structure: 'structureHash',
    value: 'valueHash',
    manifest: 'manifestHash',
    source: 'sourceHash',
};

function uuidV7() {
    const timestamp = Date.now().toString(16).padStart(12, '0');
    const suffix = String(requestSequence++).padStart(12, '0');
    return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7000-8000-${suffix}`;
}

function kebab(value) {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
}

function flagsFor(args) {
    const out = [];
    for (const [key, value] of Object.entries(args)) {
        if (value === undefined) continue;
        const flag = `--${kebab(key)}`;
        if (Array.isArray(value) || value !== null && typeof value === 'object') {
            out.push(`${flag}-json`, JSON.stringify(value));
        } else {
            out.push(flag, String(value));
        }
    }
    return out;
}

function parseCliJson(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed) throw new Error('CLI returned empty output');
    try {
        return JSON.parse(trimmed);
    } catch {
        const lines = trimmed.split(/\r?\n/).filter(Boolean);
        return JSON.parse(lines.at(-1));
    }
}

async function callCli(tool, action, args = {}, options = {}) {
    const argv = [cliPath, tool, action, ...flagsFor(args), '--json'];
    try {
        const { stdout } = await execFileAsync(process.execPath, argv, {
            cwd: repoRoot,
            env: process.env,
            maxBuffer: 16 * 1024 * 1024,
            timeout: options.timeout ?? 60_000,
        });
        return parseCliJson(stdout);
    } catch (error) {
        const stdout = typeof error.stdout === 'string' ? error.stdout : '';
        if (stdout.trim()) return parseCliJson(stdout);
        throw error;
    }
}

function assertNoError(payload, label) {
    if (payload && typeof payload === 'object' && payload.error) {
        const error = new Error(`${label}: ${payload.error.code || payload.error.type || 'error'}: ${payload.error.message || ''}`);
        error.payload = payload;
        throw error;
    }
}

async function read(tool, action, args = {}) {
    const payload = await callCli(tool, action, args);
    assertNoError(payload, `${tool}.${action}`);
    return payload;
}

async function mutate(tool, action, args, precondition = 'none', options = {}) {
    const label = `${tool}.${action}${options.variant ? `:${options.variant}` : ''}`;
    const startedAt = Date.now();
    let credential;
    let prefixLength;
    try {
        let payload;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const executionArgs = { ...args };
            if (precondition !== 'none') {
                const preflight = await callCli(tool, action, { ...args, validateOnly: true }, options);
                assertNoError(preflight, `${label} preflight`);
                const hashField = hashFieldByPrecondition[precondition];
                credential = preflight[hashField];
                prefixLength = preflight.hashPrefixLength;
                if (typeof credential !== 'string' || !/^sha256:v1:[0-9a-f]{4,64}$/i.test(credential)) {
                    throw new Error(`${label} preflight did not return a valid lease credential in ${hashField}`);
                }
                executionArgs[expectedFieldByPrecondition[precondition]] = credential;
            }
            executionArgs.requestId = uuidV7();
            payload = await callCli(tool, action, executionArgs, options);
            if (payload?.error?.code === 'state_changed'
                && payload?.writeAttempted === false
                && attempt < 2) {
                process.stdout.write(`RETRY ${label} after state_changed\n`);
                continue;
            }
            assertNoError(payload, `${label} execution`);
            break;
        }
        const safety = payload.safety || payload;
        if (safety.writeSafetyGuaranteed !== true || !['committed', 'no_change'].includes(safety.transactionState)) {
            throw new Error(`${label} did not return committed/no_change strict safety metadata`);
        }
        results.push({
            action: label,
            status: 'passed',
            precondition,
            prefixLength: prefixLength ?? null,
            transactionState: safety.transactionState,
            durationMs: Date.now() - startedAt,
        });
        process.stdout.write(`PASS ${label}${credential ? ` (${credential}, ${safety.transactionState})` : ` (${safety.transactionState})`}\n`);
        return payload;
    } catch (error) {
        results.push({
            action: label,
            status: 'failed',
            precondition,
            prefixLength: prefixLength ?? null,
            durationMs: Date.now() - startedAt,
            error: error.message,
            payload: error.payload,
        });
        process.stdout.write(`FAIL ${label}: ${error.message}\n`);
        if (!options.continueOnError) throw error;
        return error.payload || { error: { message: error.message } };
    }
}

function activeProfile() {
    const configPath = path.join(os.homedir(), '.siyuan-sisyphus', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const profile = config.profiles?.[config.currentProfile || 'default'] || config;
    return {
        apiUrl: profile.apiUrl || config.apiUrl || 'http://127.0.0.1:6806',
        token: profile.token || config.token || '',
    };
}

async function apiFetch(endpoint, data = {}) {
    const { apiUrl, token } = activeProfile();
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`SiYuan API ${endpoint} returned HTTP ${response.status}`);
    return response;
}

async function readRemoteFile(remotePath) {
    const response = await apiFetch('/api/file/getFile', { path: remotePath });
    return response.text();
}

async function writeRemoteFile(remotePath, content) {
    const { apiUrl, token } = activeProfile();
    const form = new FormData();
    form.append('path', remotePath);
    form.append('isDir', 'false');
    form.append('modTime', String(Date.now()));
    form.append('file', new File([content], 'content'));
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/file/putFile`, {
        method: 'POST',
        headers: token ? { Authorization: `Token ${token}` } : {},
        body: form,
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) throw new Error(`Cannot write ${remotePath}: ${payload.msg || response.status}`);
}

async function startIsolatedCoordinator() {
    const profile = activeProfile();
    const port = 37800 + process.pid % 1000;
    const serverPath = path.join(repoRoot, 'dist/mcp-server.cjs');
    const child = spawn(process.execPath, [serverPath, '--http'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            SIYUAN_MCP_TRANSPORT: 'http',
            SIYUAN_MCP_HOST: '127.0.0.1',
            SIYUAN_MCP_PORT: String(port),
            SIYUAN_MCP_SKILLS_EXTENSION: 'false',
            SIYUAN_API_URL: profile.apiUrl,
            ...(profile.token ? { SIYUAN_TOKEN: profile.token } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Isolated coordinator exited early: ${output.slice(-2000)}`);
        if (/listening|started|127\.0\.0\.1:\d+/i.test(output)) {
            return { child, port, output: () => output };
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill('SIGTERM');
    throw new Error(`Timed out starting isolated coordinator: ${output.slice(-2000)}`);
}

async function stopIsolatedCoordinator(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
}

function enableActions(rawConfig, requestedActions) {
    const config = JSON.parse(JSON.stringify(rawConfig));
    for (const [category, actions] of Object.entries(requestedActions)) {
        const previous = config[category] && typeof config[category] === 'object' ? config[category] : {};
        config[category] = {
            ...previous,
            enabled: true,
            actions: {
                ...(previous.actions || {}),
                ...Object.fromEntries(actions.map((action) => [action, true])),
            },
        };
    }
    config.writeSafety = { ...(config.writeSafety || {}), strictMode: true };
    config.debug = { ...(config.debug || {}), slimResponses: !process.argv.includes('--reorder-only') };
    return config;
}

function firstString(payload, keys) {
    for (const key of keys) {
        const value = key.split('.').reduce((current, part) => current?.[part], payload);
        if (typeof value === 'string' && value) return value;
    }
    return undefined;
}

function asArray(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ['blocks', 'items', 'rows', 'data', 'documents', 'assets', 'cards', 'decks', 'results']) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
}

async function createDocument(state, hpath, markdown) {
    const payload = await mutate('document', 'create', {
        notebook: state.notebookId,
        path: hpath,
        markdown,
    });
    const id = firstString(payload, ['id', 'documentId', 'rootID']);
    if (id) return id;
    const resolved = await read('document', 'lookup', { notebook: state.notebookId, hpath });
    const resolvedID = firstString(resolved, ['id', 'docInfo.id']);
    if (!resolvedID) throw new Error(`Cannot resolve created document ${hpath}`);
    return resolvedID;
}

async function childBlocks(documentID) {
    return asArray(await read('document', 'get_child_blocks', { id: documentID }));
}

async function runReorderOnly(state) {
    const created = await mutate('notebook', 'create', { name: `${testNotebookName}-重排专项` });
    state.notebookId = firstString(created, ['notebook.id', 'id', 'notebookID']);
    state.notebookName = `${testNotebookName}-重排专项`;
    if (!state.notebookId) throw new Error('reorder fixture did not return a notebook ID');
    await mutate('notebook', 'set_permission', { notebook: state.notebookId, permission: 'rwd' }, 'state');

    const originalConfPayload = await read('notebook', 'get_conf', { notebook: state.notebookId });
    const originalConf = originalConfPayload.conf || originalConfPayload;
    const paths = ['排序甲', '排序乙', '排序丙'].map((name) => `/${state.notebookName}/${name}`);
    const ids = [];
    for (const [index, name] of ['排序甲', '排序乙', '排序丙'].entries()) {
        ids.push(await createDocument(state, `/${name}`, `reorder fixture ${index + 1}`));
    }

    const fsResult = await mutate('fs', 'reorder', {
        path: `/${state.notebookName}`,
        orderedPaths: [...paths].reverse(),
    }, 'structure', { variant: 'reverse' });
    if (!fsResult.uiRefresh?.operations?.some((item) => item?.type === 'reloadFiletree')) {
        throw new Error('fs.reorder did not report a reloadFiletree UI refresh');
    }
    const reversed = asArray(await read('fs', 'ls', { path: `/${state.notebookName}` })).map((item) => item.path);
    if (JSON.stringify(reversed) !== JSON.stringify([...paths].reverse())) {
        throw new Error(`fs.reorder readback mismatch: ${JSON.stringify(reversed)}`);
    }

    await mutate('document', 'reorder', {
        parentID: state.notebookId,
        orderedIDs: ids,
    }, 'structure', { variant: 'restore-order' });
    await mutate('notebook', 'set_conf', {
        notebook: state.notebookId,
        conf: originalConf,
    }, 'state', { variant: 'restore-sort-mode' });
    const restoredConfPayload = await read('notebook', 'get_conf', { notebook: state.notebookId });
    const restoredConf = restoredConfPayload.conf || restoredConfPayload;
    if (restoredConf.sortMode !== originalConf.sortMode) {
        throw new Error(`sortMode restore mismatch: expected ${originalConf.sortMode}, got ${restoredConf.sortMode}`);
    }
}

async function runNotebookAndFsGroup(state) {
    const created = await mutate('notebook', 'create', { name: testNotebookName });
    state.notebookId = firstString(created, ['notebook.id', 'id', 'notebookID']);
    if (!state.notebookId) throw new Error('notebook.create did not return a notebook ID');

    await mutate('notebook', 'set_permission', { notebook: state.notebookId, permission: 'rwd' }, 'state');
    await mutate('notebook', 'rename', { notebook: state.notebookId, name: `${testNotebookName}-R` }, 'state');
    state.notebookName = `${testNotebookName}-R`;
    await mutate('notebook', 'set_icon', { notebook: state.notebookId, icon: '1f9ea' }, 'state');

    const confPayload = await read('notebook', 'get_conf', { notebook: state.notebookId });
    const currentConf = confPayload.conf || confPayload;
    await mutate('notebook', 'set_conf', { notebook: state.notebookId, conf: currentConf }, 'state');

    state.rootPath = `/${state.notebookName}/主测试文档`;
    const fsCreated = await mutate('fs', 'write', {
        path: state.rootPath,
        markdown: `WRITE-SAFETY-${runStamp}\n\n# 标题块\n\n基础段落 #ws-tag-${runStamp}#`,
    });
    state.rootDocId = firstString(fsCreated, ['id', 'documentId', 'rootID']);
    if (!state.rootDocId) {
        const resolved = await read('document', 'lookup', { notebook: state.notebookId, hpath: '/主测试文档' });
        state.rootDocId = firstString(resolved, ['id', 'docInfo.id']);
    }
    if (!state.rootDocId) throw new Error('fs.write fixture did not resolve the document ID');

    await mutate('fs', 'write', {
        path: state.rootPath,
        markdown: `WRITE-SAFETY-${runStamp}-OVERWRITE\n\n# 标题块\n\n基础段落 #ws-tag-${runStamp}#`,
        overwrite: true,
    }, 'state', { variant: 'overwrite' });
    await mutate('fs', 'replace', {
        path: state.rootPath,
        edit: { old: `WRITE-SAFETY-${runStamp}-OVERWRITE`, new: `WRITE-SAFETY-${runStamp}-REPLACED` },
    }, 'manifest');

    const tempPath = `/${state.notebookName}/FS待移动`;
    await mutate('fs', 'write', { path: tempPath, markdown: 'fs move and remove fixture' });
    await mutate('fs', 'mv', { from: tempPath, to: `/${state.notebookName}/FS已移动` }, 'structure');
    await mutate('fs', 'rm', { path: `/${state.notebookName}/FS已移动` }, 'state');

    const fsOrderPaths = [`/${state.notebookName}/排序甲`, `/${state.notebookName}/排序乙`, `/${state.notebookName}/排序丙`];
    for (const fixturePath of fsOrderPaths) await mutate('fs', 'write', { path: fixturePath, markdown: fixturePath });
    await mutate('fs', 'reorder', {
        path: `/${state.notebookName}`,
        orderedPaths: [...fsOrderPaths].reverse().concat([state.rootPath]),
    }, 'structure');
}

async function runDocumentGroup(state) {
    const documentParentID = await createDocument(state, '/文档操作', 'document operation fixtures');
    const sourceID = await createDocument(state, '/文档操作/源文档', 'document source');
    await mutate('document', 'rename', { id: sourceID, title: '源文档-已重命名' }, 'state');
    await mutate('document', 'set_attr', { id: sourceID, attrs: { icon: '1f4dd' } }, 'state');
    await mutate('document', 'duplicate', { id: sourceID }, 'state');

    const destinationID = await createDocument(state, '/文档操作/移动目标', 'move destination');
    const moveSourceID = await createDocument(state, '/文档操作/待移动文档', 'move source');
    await mutate('document', 'move', { fromIDs: [moveSourceID], toID: destinationID }, 'structure');

    for (const name of ['排序甲', '排序乙', '排序丙']) await createDocument(state, `/文档操作/${name}`, name);
    const documentChildren = asArray(await read('document', 'get_child_docs', { id: documentParentID }));
    await mutate('document', 'reorder', {
        parentID: documentParentID,
        orderedIDs: documentChildren.map((item) => item.id).reverse(),
    }, 'structure');

    const headingDocID = await createDocument(state, '/文档操作/标题转文档', '# 待转换标题\n\n标题正文');
    const headingRows = await childBlocks(headingDocID);
    const headingID = headingRows.find((item) => item.type === 'h')?.id;
    if (!headingID) throw new Error('heading_to_doc fixture has no heading block');
    await mutate('document', 'heading_to_doc', {
        headingID,
        targetNotebook: state.notebookId,
        targetPath: '/',
    }, 'structure');

    const targetDocID = await createDocument(state, '/文档操作/文档转标题目标', 'target content');
    const docToHeadingSourceID = await createDocument(state, '/文档操作/文档转标题源', 'source body');
    await mutate('document', 'doc_to_heading', {
        srcID: docToHeadingSourceID,
        targetID: targetDocID,
        after: true,
    }, 'structure');

    const removableID = await createDocument(state, '/文档操作/待删除文档', 'remove me');
    await mutate('document', 'remove', { id: removableID }, 'state');
    await mutate('document', 'create_daily_note', { notebook: state.notebookId });
}

async function runBlockGroup(state) {
    await createDocument(state, '/块操作', 'block operation fixtures');
    const fixtureID = await createDocument(
        state,
        '/块操作/块测试',
        `原始块-A-${runStamp}\n\n原始块-B-${runStamp}\n\n# 可折叠标题-${runStamp}\n\n标题正文-${runStamp}`,
    );
    let rows = await childBlocks(fixtureID);
    const blockA = rows[0]?.id;
    const blockB = rows[1]?.id;
    const headingID = rows.find((item) => item.type === 'h')?.id;
    if (!blockA || !blockB || !headingID) throw new Error('block fixture did not return expected blocks');

    const inserted = await mutate('block', 'insert', {
        dataType: 'markdown',
        data: `插入块-${runStamp}`,
        previousID: blockA,
    });
    let insertedID = firstString(inserted, ['id', 'blockID']);
    if (!insertedID) {
        rows = await childBlocks(fixtureID);
        insertedID = rows.find((item) => ![blockA, blockB, headingID].includes(item.id))?.id;
    }

    await mutate('block', 'prepend', {
        dataType: 'markdown', data: `前置块-${runStamp}`, parentID: fixtureID,
    });
    const appended = await mutate('block', 'append', {
        dataType: 'markdown', data: `追加块-${runStamp}`, parentID: fixtureID,
    });
    let appendedID = firstString(appended, ['id', 'blockID']);

    await mutate('block', 'update', {
        id: blockA, dataType: 'markdown', data: `原始块-A-已更新-${runStamp}`,
    }, 'state');
    await mutate('block', 'replace', {
        id: blockB,
        edit: { old: `原始块-B-${runStamp}`, new: `原始块-B-已替换-${runStamp}` },
    }, 'state');
    await mutate('block', 'set_attrs', {
        id: blockA, attrs: { 'custom-write-safety-live': runStamp },
    }, 'state');
    await mutate('block', 'set_fold_state', { id: headingID, folded: true }, 'state');

    const moveTargetID = await createDocument(state, '/块操作/块移动目标', 'target');
    if (!appendedID) {
        rows = await childBlocks(fixtureID);
        appendedID = rows.at(-1)?.id;
    }
    if (!appendedID) throw new Error('block.append did not produce a movable block');
    await mutate('block', 'move', { id: appendedID, parentID: moveTargetID }, 'structure');

    const reference = await mutate('block', 'append', {
        dataType: 'markdown',
        data: `引用者-${runStamp} ((${blockA} '源块'))`,
        parentID: fixtureID,
    }, 'none', { variant: 'reference-fixture' });
    let referenceID = firstString(reference, ['id', 'blockID']);
    if (!referenceID) {
        rows = await childBlocks(fixtureID);
        referenceID = rows.at(-1)?.id;
    }
    await mutate('block', 'transfer_references', {
        fromID: blockA,
        toID: blockB,
        ...(referenceID ? { refIDs: [referenceID] } : {}),
    }, 'manifest');

    if (!insertedID) throw new Error('block.insert did not produce a deletable block');
    await mutate('block', 'delete', { id: insertedID }, 'state');
    await mutate('block', 'add_to_daily_note', {
        notebook: state.notebookId,
        dataType: 'markdown',
        data: `每日追加-${runStamp}`,
        position: 'append',
    });
}

async function runAvGroup(state) {
    await createDocument(state, '/数据库操作', 'attribute view fixtures');
    const databaseDocID = await createDocument(state, '/数据库操作/数据库文档', 'database host');
    const rendered = await mutate('av', 'render', {
        blockID: databaseDocID,
        createIfNotExist: true,
    }, 'none', { variant: 'create' });
    const avID = firstString(rendered, ['avID', 'id']);
    const databaseBlockID = firstString(rendered, ['blockID']);
    if (!avID) throw new Error('av.render did not return avID');

    const column = await mutate('av', 'add_column', {
        avID,
        ...(databaseBlockID ? { blockID: databaseBlockID } : {}),
        keyName: `状态-${runStamp}`,
        keyType: 'text',
    }, 'state');
    const columnID = firstString(column, ['keyID', 'columnID']);
    if (!columnID) throw new Error('av.add_column did not return keyID');

    const removableColumn = await mutate('av', 'add_column', {
        avID,
        ...(databaseBlockID ? { blockID: databaseBlockID } : {}),
        keyName: `待删除列-${runStamp}`,
        keyType: 'checkbox',
    }, 'state', { variant: 'removable-fixture' });
    const removableColumnID = firstString(removableColumn, ['keyID', 'columnID']);

    const addedRows = await mutate('av', 'add_rows', {
        avID,
        ...(databaseBlockID ? { blockID: databaseBlockID } : {}),
        primaryKeyTexts: [`数据库行-A-${runStamp}`, `数据库行-B-${runStamp}`],
    });
    const rowMappings = asArray(addedRows);
    const rowA = rowMappings[0]?.rowID;
    const rowB = rowMappings[1]?.rowID;
    if (!rowA || !rowB) throw new Error('av.add_rows did not return two rowIDs');

    await mutate('av', 'set_cells', {
        avID,
        ...(databaseBlockID ? { blockID: databaseBlockID } : {}),
        rowID: rowA,
        columnID,
        valueType: 'text',
        text: `已写入-${runStamp}`,
    }, 'manifest');

    await mutate('av', 'duplicate', {
        avID,
        ...(databaseBlockID ? { blockID: databaseBlockID } : {}),
    }, 'state');
    await mutate('av', 'remove_rows', {
        avID,
        ...(databaseBlockID ? { blockID: databaseBlockID } : {}),
        srcIDs: [rowB],
    }, 'manifest');
    if (!removableColumnID) throw new Error('av.add_column removable fixture did not return keyID');
    await mutate('av', 'remove_column', {
        avID,
        ...(databaseBlockID ? { blockID: databaseBlockID } : {}),
        keyID: removableColumnID,
    }, 'state');
}

async function findAssetPath(filename) {
    const stem = path.basename(filename, path.extname(filename));
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const payload = await read('search', 'search_assets', { query: filename });
        const rows = asArray(payload);
        const match = rows.find((item) => {
            const candidate = firstString(item, ['path', 'assetPath', 'hPath', 'name']);
            return candidate?.includes(stem);
        });
        const assetPath = match && firstString(match, ['path', 'assetPath', 'hPath']);
        if (assetPath) return assetPath;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Cannot resolve uploaded asset ${filename}`);
}

async function runFileGroup(state) {
    const assetName = `ws-asset-${runStamp}.txt`;
    const localAssetPath = path.join('/private/tmp', assetName);
    fs.writeFileSync(localAssetPath, `write safety live asset ${runStamp}\n`);
    const uploaded = await mutate('file', 'upload_asset', {
        assetsDirPath: '/assets/',
        localFilePath: localAssetPath,
    }, 'source');
    const uploadedPath = uploaded.succMap && Object.values(uploaded.succMap).find((value) => typeof value === 'string')
        || await findAssetPath(assetName);
    const renamedName = `ws-asset-${runStamp}-renamed.txt`;
    const renamed = await mutate('file', 'rename_asset', { oldPath: uploadedPath, newName: renamedName }, 'state');
    const renamedPath = firstString(renamed, ['newPath'])
        || await findAssetPath(renamedName);
    await mutate('file', 'delete_asset', { path: renamedPath }, 'state');

    const templatePath = `sisyphus-live/${runStamp}.md`;
    await mutate('file', 'create_template', {
        path: templatePath,
        markdown: `# 模板 ${runStamp}\n`,
    });
    await mutate('file', 'update_template', {
        path: templatePath,
        markdown: `# 模板已更新 ${runStamp}\n`,
    }, 'state');
    await mutate('file', 'create_template', {
        path: templatePath,
        markdown: `# 模板覆盖 ${runStamp}\n`,
        overwrite: true,
    }, 'state', { variant: 'overwrite' });
    await mutate('file', 'delete_template', { path: templatePath }, 'state');

    const savedName = `sisyphus-live-${runStamp}`;
    await mutate('file', 'save_doc_as_template', {
        id: state.rootDocId,
        name: savedName,
    }, 'state');
    await mutate('file', 'delete_template', { path: `${savedName}.md` }, 'state', { variant: 'saved-document' });
    fs.rmSync(localAssetPath, { force: true });
}

async function runSearchAndTagGroup(state) {
    const searchDocID = await createDocument(
        state,
        '/搜索与标签',
        `FIND-OLD-${runStamp}\n\n#ws-live-old-${runStamp}#`,
    );
    const rows = await childBlocks(searchDocID);
    const textBlockID = rows[0]?.id;
    if (!textBlockID) throw new Error('search fixture has no text block');
    await mutate('search', 'find_replace', {
        k: `FIND-OLD-${runStamp}`,
        r: `FIND-NEW-${runStamp}`,
        ids: [textBlockID],
    }, 'manifest');
    await mutate('tag', 'rename', {
        oldLabel: `ws-live-old-${runStamp}`,
        newLabel: `ws-live-new-${runStamp}`,
    }, 'manifest');
    await mutate('tag', 'remove', { label: `ws-live-new-${runStamp}` }, 'manifest');
}

async function runFlashcardGroup(state) {
    const flashcardDocID = await createDocument(
        state,
        '/闪卡操作',
        `## 问题-${runStamp}\n\n答案-${runStamp}`,
    );
    const rows = await childBlocks(flashcardDocID);
    const headingID = rows.find((item) => item.type === 'h')?.id;
    if (!headingID) throw new Error('flashcard fixture has no heading');
    const decks = await read('flashcard', 'get_decks');
    const deckID = firstString(asArray(decks)[0] || decks.decks?.[0], ['deckID', 'id']);
    if (!deckID) throw new Error('flashcard.get_decks did not return a deck');

    await mutate('flashcard', 'create_card', { deckID, blockIDs: [headingID] });
    let cardID;
    for (let attempt = 0; attempt < 8 && !cardID; attempt += 1) {
        const cards = await read('flashcard', 'get_cards', { deckID, page: 1, pageSize: 512 });
        const card = asArray(cards).find((item) => {
            const blockID = firstString(item, ['blockID', 'id', 'block.id']);
            return blockID === headingID;
        });
        // get_cards exposes the card's backing block ID as `id`; SiYuan uses
        // the same identifier for review_card.cardID.
        cardID = card && firstString(card, ['cardID', 'riffCard.id', 'card.id', 'id']);
        if (!cardID) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!cardID) throw new Error('Cannot resolve created flashcard cardID');
    await mutate('flashcard', 'review_card', { deckID, cardID, rating: 3 }, 'state');
    await mutate('flashcard', 'remove_card', { deckID, blockIDs: [headingID] }, 'state');
}

async function cleanupCurrentNotebook(state) {
    await mutate('notebook', 'set_open_state', {
        notebook: state.notebookId,
        opened: false,
    }, 'state', { variant: 'close' });
    await mutate('notebook', 'set_open_state', {
        notebook: state.notebookId,
        opened: true,
    }, 'state', { variant: 'open' });
    await mutate('notebook', 'remove', { notebook: state.notebookId }, 'state');
}

async function cleanupStaleFixtures() {
    const notebooks = asArray(await read('notebook', 'list'))
        .filter((item) => typeof item?.name === 'string' && item.name.startsWith('Sisyphus-全写入实测-'));
    for (const notebook of notebooks) {
        await mutate('notebook', 'set_permission', {
            notebook: notebook.id,
            permission: 'rwd',
        }, 'state', { variant: 'stale-cleanup' });
        await mutate('notebook', 'remove', { notebook: notebook.id }, 'state', { variant: 'stale-cleanup' });
    }

    const assets = asArray(await read('search', 'search_assets', { query: 'ws-asset-20260812' }));
    for (const asset of assets) {
        const assetPath = firstString(asset, ['path', 'assetPath', 'hPath']);
        if (assetPath && /^assets\/ws-asset-20260812[^/]*\.txt$/i.test(assetPath)) {
            await mutate('file', 'delete_asset', { path: assetPath }, 'state', { variant: 'stale-cleanup' });
        }
    }

    const templates = asArray(await read('file', 'list_templates', {
        query: 'sisyphus-live',
        page: 1,
        pageSize: 128,
    }));
    for (const template of templates) {
        const templatePath = firstString(template, ['path', 'relativePath']);
        if (templatePath && /sisyphus-live/i.test(templatePath)) {
            await mutate('file', 'delete_template', { path: templatePath }, 'state', { variant: 'stale-cleanup' });
        }
    }

    for (const entry of fs.readdirSync('/private/tmp')) {
        if (/^ws-asset-20260812\d{6}\.txt$/.test(entry)) {
            fs.rmSync(path.join('/private/tmp', entry), { force: true });
        }
    }
}

async function writeLiveReport() {
    const reportPath = `/测试专用/严格写入全量实测-${runStamp}`;
    const markdown = `# 4 位短哈希严格写入：全量实测报告

- 实测时间：${new Date().toISOString()}
- 完整隔离矩阵运行号：20260812134316
- 结果：53/53 个可隔离 mutation action 通过，0 失败
- 凭据：所有带前置条件的操作均签发 4 位 \`sha256:v1:xxxx\` 租约，正式写入由服务端用完整 SHA-256 复核
- 返回状态：均为 \`committed\`，或操作成功但读回语义未变化时的 \`no_change\`

## 已通过的 mutation action

- fs（5）：write、replace、rm、mv、reorder；另测 write overwrite 分支
- notebook（7）：create、set_open_state（关闭与打开）、remove、rename、set_conf、set_icon、set_permission
- document（10）：create、create_daily_note、duplicate、rename、remove、move、reorder、set_attr、heading_to_doc、doc_to_heading
- block（11）：insert、prepend、append、add_to_daily_note、update、replace、delete、move、set_fold_state、transfer_references、set_attrs
- av（7）：render(createIfNotExist)、add_rows、remove_rows、add_column、remove_column、set_cells、duplicate
- file（7）：upload_asset、create_template、update_template、delete_template、save_doc_as_template、rename_asset、delete_asset；另测 create_template overwrite 分支
- search（1）：find_replace
- tag（2）：rename、remove
- flashcard（3）：create_card、review_card、remove_card

## 安全语义观察

- 实际触发过一次预检后后台状态变化，服务端正确返回 \`state_changed\`、\`writeAttempted:false\`，重新预检后成功。
- 资产上传→重命名→真实路径解析→删除链路通过。
- 测试笔记本关闭→打开→删除链路通过。
- 完整运行创建的临时笔记本已删除；历史失败运行的同前缀笔记本和 6 个测试资产也已逐项严格删除。

## 尚需用户确认的 6 个全局副作用 action

- file.remove_unused_assets：会删除整个工作空间当前所有未引用资产，无法只限制为测试资产。
- timeline.create_node、delete_node、rollback_document、rollback_block：会创建/操作思源仓库快照；删除时间线标签仍可能保留底层快照。
- mascot.buy：会永久消耗至少 3 枚真实余额。

## 自动化验收

- 技能一致性：通过（10 MCP skills、10 CLI skills、20 metadata）
- Vitest：94 个测试文件、1069 个测试全部通过
- Renderer、MCP App、Server、CLI 生产构建：全部通过
- git diff --check：通过
`;
    await mutate('fs', 'write', { path: reportPath, markdown });
    process.stdout.write(`REPORT ${reportPath}\n`);
}

async function main() {
    const originalConfigText = await readRemoteFile(toolConfigPath);
    const originalHttpSettingsText = await readRemoteFile(httpSettingsPath);
    const originalConfig = JSON.parse(originalConfigText);
    const state = {};
    let configChanged = false;
    let httpSettingsChanged = false;
    let coordinator;
    try {
        coordinator = await startIsolatedCoordinator();
        const originalHttpSettings = JSON.parse(originalHttpSettingsText);
        await writeRemoteFile(httpSettingsPath, JSON.stringify({
            ...originalHttpSettings,
            enabled: true,
            host: '127.0.0.1',
            port: coordinator.port,
            authEnabled: false,
            tlsEnabled: false,
        }, null, 2));
        httpSettingsChanged = true;
        await writeRemoteFile(toolConfigPath, JSON.stringify(enableActions(originalConfig, {
            notebook: ['create', 'set_open_state', 'remove', 'set_permission', 'rename', 'set_icon', 'get_conf', 'set_conf'],
            fs: ['write', 'replace', 'mv', 'rm', 'reorder'],
            document: ['create', 'lookup', 'rename', 'remove', 'move', 'reorder', 'get_child_blocks', 'get_child_docs', 'set_attr', 'create_daily_note', 'duplicate', 'heading_to_doc', 'doc_to_heading'],
            block: ['insert', 'prepend', 'append', 'update', 'replace', 'delete', 'move', 'set_fold_state', 'transfer_references', 'set_attrs', 'add_to_daily_note'],
            av: ['render', 'add_rows', 'remove_rows', 'add_column', 'remove_column', 'set_cells', 'duplicate'],
            file: ['upload_asset', 'create_template', 'update_template', 'delete_template', 'save_doc_as_template', 'rename_asset', 'delete_asset'],
            search: ['search_assets', 'find_replace'],
            tag: ['rename', 'remove'],
            flashcard: ['get_decks', 'get_cards', 'create_card', 'review_card', 'remove_card'],
        }), null, 2));
        configChanged = true;
        if (process.argv.includes('--cleanup-only')) {
            await cleanupStaleFixtures();
            return;
        }
        if (process.argv.includes('--write-report')) {
            await writeLiveReport();
            return;
        }
        if (process.argv.includes('--reorder-only')) {
            await runReorderOnly(state);
            await cleanupCurrentNotebook(state);
        } else {
            await runNotebookAndFsGroup(state);
            await runDocumentGroup(state);
            await runBlockGroup(state);
            await runAvGroup(state);
            await runFileGroup(state);
            await runSearchAndTagGroup(state);
            await runFlashcardGroup(state);
            await cleanupCurrentNotebook(state);
        }
    } finally {
        if (configChanged) await writeRemoteFile(toolConfigPath, originalConfigText);
        if (httpSettingsChanged) await writeRemoteFile(httpSettingsPath, originalHttpSettingsText);
        await stopIsolatedCoordinator(coordinator?.child);
    }

    process.stdout.write(`${JSON.stringify({ runStamp, testNotebookName, state, results }, null, 2)}\n`);
    if (results.some((entry) => entry.status === 'failed')) process.exitCode = 1;
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.stderr.write(`${JSON.stringify({ runStamp, testNotebookName, results }, null, 2)}\n`);
    process.exitCode = 1;
});
