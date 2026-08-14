#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Client, InMemoryTransport } = require('@modelcontextprotocol/client');
const { createSiYuanServer } = require(path.join(__dirname, '..', '..', 'dist', 'mcp-server.cjs'));

const SIYUAN_URL = 'http://127.0.0.1:6806';
const CONFIG_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig';

const ALL_ENABLED_CONFIG = {
    fs: {
        enabled: true,
        actions: { ls: true, tree: true, read: true, write: true, replace: true, rm: true, mv: true, search: true },
    },
    notebook: {
        enabled: true,
        actions: { list: true, create: true, set_open_state: true, remove: true, rename: true, get_conf: true, set_conf: true, set_icon: true, get_permissions: true, set_permission: true, get_child_docs: true },
    },
    document: {
        enabled: true,
        actions: { create: true, lookup: true, rename: true, remove: true, move: true, get_child_blocks: true, get_child_docs: true, set_attr: true, list_tree: true, search_docs: true, get_doc: true, get_outline: true, create_daily_note: true, duplicate: true, heading_to_doc: true, doc_to_heading: true },
    },
    block: {
        enabled: true,
        actions: {
            insert: true,
            prepend: true,
            append: true,
            update: true,
            replace: true,
            delete: true,
            move: true,
            set_fold_state: true,
            get_kramdown: true,
            batch_kramdown: true,
            get_children: true,
            transfer_references: true,
            set_attrs: true,
            get_attrs: true,
            info: true,
            breadcrumb: true,
            dom: true,
            recent_updated: true,
            word_count: true,
            add_to_daily_note: true,
            docs_info: true,
        },
    },
    av: {
        enabled: true,
        actions: {
            get: true,
            render: true,
            get_attribute_view_keys: true,
            get_attribute_view_filter_sort: true,
            search: true,
            add_rows: true,
            remove_rows: true,
            add_column: true,
            remove_column: true,
            set_cells: true,
            duplicate: true,
            get_primary_key_values: true,
        },
    },
    file: {
        enabled: true,
        actions: {
            upload_asset: true,
            list_templates: true,
            read_template: true,
            create_template: true,
            update_template: true,
            delete_template: true,
            save_doc_as_template: true,
            render: true,
            export_md: true,
            export_resources: true,
            list_unused_assets: true,
            get_doc_assets: true,
            audit_image_refs: true,
            get_image_ocr_text: true,
            remove_unused_assets: true,
            rename_asset: true,
            delete_asset: true,
            extract_doc: true,
        },
    },
    search: {
        enabled: true,
        actions: {
            fulltext: true,
            query_sql: true,
            get_backlinks: true,
            search_refs: true,
            find_replace: true,
            search_assets: true,
            fulltext_asset_content: true,
            list_invalid_refs: true,
        },
    },
    tag: {
        enabled: true,
        actions: { list: true, rename: true, remove: true },
    },
    system: {
        enabled: true,
        actions: {
            workspace_info: true,
            network: true,
            conf: true,
            notify: true,
            changelog: true,
            perform_sync: true,
            get_version: true,
            get_current_time: true,
        },
    },
    flashcard: {
        enabled: true,
        actions: {
            list_cards: true,
            get_decks: true,
            get_cards: true,
            review_card: true,
            create_card: true,
            remove_card: true,
        },
    },
    mascot: {
        enabled: true,
        actions: {
            get_balance: true,
            shop: true,
            buy: true,
        },
    },
    feedback: {
        enabled: true,
        actions: {
            submit: true,
        },
    },
};

function makeSiYuanResponse(data, code = 0, msg = '') {
    return new Response(JSON.stringify({ code, msg, data }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

function unwrapWriteResult(value) {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
        return normalized;
    }

    const { uiRefresh, warning, ...rest } = normalized;
    return rest;
}

async function withConfigMode(mode, fn) {
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
        if (String(url) === `${SIYUAN_URL}/api/file/getFile`) {
            const body = options.body ? JSON.parse(options.body) : {};
            if (body.path === CONFIG_PATH) {
                if (mode === 'default') {
                    return new Response('{}', {
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
                return new Response(JSON.stringify(ALL_ENABLED_CONFIG), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }
        return originalFetch(url, options);
    };

    try {
        return await fn();
    } finally {
        global.fetch = originalFetch;
    }
}

async function withClient(fn) {
    const server = await createSiYuanServer();
    const client = new Client({ name: 'live-mcp-smoke', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
        return await fn(client);
    } finally {
        await client.close().catch(() => {});
        await server.close().catch(() => {});
    }
}

async function callToolJson(client, name, args) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        json = text;
    }

    return { result, json };
}

async function callToolJsonUnwrapped(client, name, args) {
    const { result, json } = await callToolJson(client, name, args);
    return { result, json: unwrapWriteResult(json) };
}

async function lookupDoc(client, args) {
    const { json } = await callToolJson(client, 'document', { action: 'lookup', ...args });
    assert.equal(typeof json.idPath, 'object', `lookup idPath missing: ${JSON.stringify(json)}`);
    assert.equal(typeof json.humanPath, 'object', `lookup humanPath missing: ${JSON.stringify(json)}`);
    return {
        raw: json,
        id: json.idPath?.id,
        ids: json.idPath?.ids,
        notebook: json.idPath?.notebook,
        path: json.idPath?.path,
        hPath: json.humanPath?.hPath,
        notebookName: json.humanPath?.notebookName,
    };
}

function blockChildren(payload) {
    return Array.isArray(payload.children) ? payload.children : payload.data;
}

function listItems(payload) {
    return Array.isArray(payload) ? payload : payload.data;
}

async function readResourceText(client, uri) {
    const result = await client.readResource({ uri });
    return result.contents?.[0]?.text ?? '';
}

function removeItem(list, value) {
    const index = list.indexOf(value);
    if (index !== -1) {
        list.splice(index, 1);
    }
}

async function assertPermissionDenied(client, name, args) {
    const { json } = await callToolJson(client, name, args);
    assert.equal(json.error?.type, 'permission_denied');
    return json;
}

async function assertDefaultToolList() {
    await withConfigMode('default', async () => withClient(async (client) => {
        const tools = (await client.listTools()).tools;
        assert.deepEqual(tools.map((tool) => tool.name), ['fs', 'notebook', 'document', 'block', 'av', 'file', 'search', 'tag', 'timeline', 'system', 'flashcard', 'mascot', 'feedback']);

        const descriptions = Object.fromEntries(tools.map((tool) => [tool.name, tool.description]));
        assert.match(descriptions.fs, /Common actions: ls, tree, read, write, replace, search/);
        assert.match(descriptions.fs, /Additional actions: rm, mv, reorder/);
        assert.match(descriptions.notebook, /Common actions: list, create, set_open_state, rename, get_conf, get_child_docs/);
        assert.match(descriptions.notebook, /Additional actions: set_conf, set_icon, get_permissions/);
        assert.match(descriptions.notebook, /Common actions:/);
        assert.match(descriptions.notebook, /Additional actions:/);
        assert.match(descriptions.notebook, /get_permissions/);
        assert.match(descriptions.document, /Common actions: create, lookup, rename, get_child_blocks, get_child_docs, search_docs, get_doc, get_outline/);
        assert.match(descriptions.document, /Additional actions: move, reorder, set_attr, list_tree, create_daily_note, duplicate, heading_to_doc, doc_to_heading/);
        assert.match(descriptions.document, /Common actions: .*get_doc/);
        assert.match(descriptions.document, /Additional actions: .*list_tree/);
        assert.match(descriptions.document, /document\.rename: required \[title\] \| optional \[id, notebook, path\]/);
        assert.match(descriptions.document, /notebook-local human-readable hpath/);
        assert.match(descriptions.document, /storage paths and IDs/);
        assert.match(descriptions.document, /Read siyuan:\/\/help\/action\/document\/\{action\} for details/);
        assert.match(descriptions.block, /Common actions: insert, prepend, append, update, replace, get_kramdown, batch_kramdown, get_children, get_attrs, info/);
        assert.match(descriptions.block, /Additional actions: move, set_fold_state, transfer_references, set_attrs, breadcrumb, dom, recent_updated, word_count, add_to_daily_note, docs_info/);
        assert.match(descriptions.block, /Common actions: .*get_children/);
        assert.match(descriptions.block, /Additional actions: .*move/);
        assert.match(descriptions.block, /Read siyuan:\/\/help\/action\/block\/\{action\} for details/);
        assert.match(descriptions.block, /single-block replacement/i);
        assert.match(descriptions.block, /Multi-line markdown may be truncated to the first line/i);
        assert.match(descriptions.av, /Common actions: get, render, get_attribute_view_keys, get_attribute_view_filter_sort, search, get_primary_key_values/);
        assert.match(descriptions.av, /Additional actions: add_rows, remove_rows, add_column, remove_column, set_cells, duplicate/);
        assert.match(descriptions.av, /database/i);
        assert.match(descriptions.file, /Common actions: upload_asset, list_templates, read_template, create_template, update_template, save_doc_as_template, export_md, get_doc_assets, audit_image_refs, extract_doc/);
        assert.match(descriptions.file, /Additional actions: render, export_resources, list_unused_assets, get_image_ocr_text, remove_unused_assets, rename_asset, delete_asset/);
        assert.match(descriptions.file, /confirmLargeFile/);
        assert.match(descriptions.file, /Read siyuan:\/\/help\/action\/file\/\{action\} for details/);
        assert.match(descriptions.search, /fulltext, semantic, query_sql, get_backlinks/);
        assert.match(descriptions.search, /Additional actions: search_refs, find_replace, search_assets, fulltext_asset_content, list_invalid_refs/);
        assert.match(descriptions.search, /read-only/i);
        assert.match(descriptions.tag, /Common actions: list, rename/);
        assert.match(descriptions.tag, /Additional actions: remove/);
        assert.match(descriptions.tag, /#tag#/);
        assert.doesNotMatch(descriptions.system, /Common actions: [^.]*workspace_info/);
        assert.match(descriptions.system, /Common actions: conf, changelog, get_version, get_current_time/);
        assert.match(descriptions.system, /workspace_info.*disabled by default|disabled by default.*workspace_info/i);
        assert.match(descriptions.feedback, /Submit plain-text GitHub Issue-style feedback/);
        const schemas = Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
        for (const [name, schema] of Object.entries(schemas)) {
            assert.equal(schema.type, 'object', `${name} should expose an object schema`);
            assert.equal(schema.oneOf, undefined, `${name} should not rely on top-level oneOf`);
            assert.equal(typeof schema.properties, 'object', `${name} should expose top-level properties`);
            assert.ok(Array.isArray(schema.properties.action.enum), `${name} should expose action enum choices`);
        }

        assert.ok('id' in schemas.document.properties);
        assert.ok('path' in schemas.document.properties);
        assert.ok('path' in schemas.fs.properties);
        assert.ok('dataType' in schemas.block.properties);
        assert.ok('avID' in schemas.av.properties);
        assert.ok('keyName' in schemas.av.properties);
        assert.ok('template' in schemas.file.properties);
        assert.ok('description' in schemas.feedback.properties);
        assert.ok('query' in schemas.search.properties);
        assert.ok('stmt' in schemas.search.properties);
        assert.ok('k' in schemas.search.properties);
        assert.match(schemas.document.properties.path.description, /For action="create"/);
        assert.match(schemas.block.properties.parentID.description, /document head or tail/);
        assert.match(schemas.system.properties.keyPath.description, /conf\.appearance\.mode/);

        const resources = (await client.listResources()).resources;
        assert.deepEqual(resources.map((resource) => resource.uri), [
            'siyuan://help/tool-overview',
            'siyuan://help/document-path-semantics',
            'siyuan://help/examples',
            'siyuan://help/ai-layout-guide',
            'siyuan://help/changelog',
            'siyuan://help/user-rules',
        ]);

        const resourceTemplates = (await client.listResourceTemplates()).resourceTemplates;
        assert.deepEqual(resourceTemplates.map((template) => template.uriTemplate), [
            'siyuan://help/action/{tool}/{action}',
        ]);

        const toolOverviewText = await readResourceText(client, 'siyuan://help/tool-overview');
        assert.match(toolOverviewText, /SiYuan MCP Tool Overview/);
        assert.match(toolOverviewText, /document\(action="move"\)/);
        assert.match(toolOverviewText, /14 aggregated tools/);
        assert.match(toolOverviewText, /#tag#/);
        assert.match(toolOverviewText, /custom-riff-decks/);
        assert.match(toolOverviewText, /ai-layout-guide/);

        const documentPathText = await readResourceText(client, 'siyuan://help/document-path-semantics');
        assert.match(documentPathText, /Human-readable path/);
        assert.match(documentPathText, /Storage path/);
        assert.match(documentPathText, /existing destination document/);

        const examplesText = await readResourceText(client, 'siyuan://help/examples');
        assert.match(examplesText, /Turn a block into a flashcard/);
        assert.match(examplesText, /custom-riff-decks/);

        const aiLayoutGuideText = await readResourceText(client, 'siyuan://help/ai-layout-guide');
        assert.match(aiLayoutGuideText, /Callouts come from Markdown like `> \[!TIP\]`/);
        assert.match(aiLayoutGuideText, /Common callout markers are `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`/);
        assert.match(aiLayoutGuideText, /Super block layout is defined by Kramdown/);
        assert.match(aiLayoutGuideText, /Do not use `::: row`, HTML `<div>`, or `===`/);
        assert.match(aiLayoutGuideText, /outer `\{\{\{col` and put one child `\{\{\{row` block per column/);
        assert.match(aiLayoutGuideText, /There is no separator-based super block syntax/);
        assert.match(aiLayoutGuideText, /`===` inside a super block is not a column delimiter/);
        assert.match(aiLayoutGuideText, /Inline `<span style="color: \.\.\.">` is not the preferred color-marking pattern/);
        assert.match(aiLayoutGuideText, /`\*\*text\*\*\{:\sstyle="color: var\(--b3-font-color1\);"\}`/);
        assert.match(aiLayoutGuideText, /`<sup>note<\/sup>`/);
        assert.match(aiLayoutGuideText, /`kbd`/);
        assert.match(aiLayoutGuideText, /inline math/);
        assert.match(aiLayoutGuideText, /IAL-based color\/effect spans/);
        assert.match(aiLayoutGuideText, /Database blocks are `type = "av"`/);
        assert.match(aiLayoutGuideText, /Tags belong in block markdown as `#tag#`/);
        assert.match(aiLayoutGuideText, /hierarchical tags use forms such as `#project\/phase#`/);
        assert.match(aiLayoutGuideText, /gitGraph/);
        assert.match(aiLayoutGuideText, /flowchart/);
        assert.match(aiLayoutGuideText, /plantuml/);
        assert.match(aiLayoutGuideText, /graphviz/);
        assert.match(aiLayoutGuideText, /echarts/);
        assert.match(aiLayoutGuideText, /abc/);
        assert.match(aiLayoutGuideText, /NodeAttributeView/);
        assert.match(aiLayoutGuideText, /Databases support records, multiple views, filters, sorts, relations, and rollups/);
        assert.match(aiLayoutGuideText, /Bookmarks are block attributes, not inline tags/);
        assert.match(aiLayoutGuideText, /Bookmarks are for collecting existing blocks/);
        assert.match(aiLayoutGuideText, /Avoid special-symbol-heavy bookmark or tag names/);
        assert.match(aiLayoutGuideText, /cloze answer/);
        assert.match(aiLayoutGuideText, /a super block with the first child as the question/);
        assert.match(aiLayoutGuideText, /`\/AI 编写`/);
        assert.match(aiLayoutGuideText, /related text may be sent to an external model service/);
        assert.match(aiLayoutGuideText, /Flashcards are not a layout type; they are review semantics attached to blocks/);
        assert.match(aiLayoutGuideText, /A blockquote is not a block reference/);
        assert.match(aiLayoutGuideText, /A query embed is not a static block list or an ordinary reference/);
        assert.match(aiLayoutGuideText, /`===` is not a super block column delimiter/);
        assert.match(aiLayoutGuideText, /\{\{\{col/);
        assert.match(aiLayoutGuideText, /exclude the current root document/);
        assert.match(aiLayoutGuideText, /root_id != "<current-doc-id>"/);
        assert.match(aiLayoutGuideText, /av` tool can create and materialize a new database/);
        assert.match(aiLayoutGuideText, /Choose the renderer language by diagram intent/);
        assert.match(aiLayoutGuideText, /`sequenceDiagram` for interactions/);
        assert.match(aiLayoutGuideText, /`gitGraph` for commit history/);
        assert.match(aiLayoutGuideText, /When the user asks for a diary entry, journal, daily log, or today’s note in a notebook, prefer `document\(action="create_daily_note"\)`/);
        assert.match(aiLayoutGuideText, /When the user wants comparison, side-by-side information, cards, dashboards, pros\/cons, or parallel summaries, actively consider super blocks/);
        assert.match(aiLayoutGuideText, /When the user wants reminders, warnings, key conclusions, tips, or highlighted takeaways, actively consider callouts/);
        assert.match(aiLayoutGuideText, /When the user wants lightweight field display, use Markdown tables; when the user wants structured records, multiple views, filters, relations, or rollups, use database blocks instead/);
        assert.match(aiLayoutGuideText, /When the user wants collect, favorite, or save-for-later semantics on an existing block, actively consider the `bookmark` attribute/);
        assert.match(aiLayoutGuideText, /When the user wants review, memorization, Q&A, or cloze-style learning, actively consider flashcard semantics, but keep flashcards separate from layout choice/);
        assert.match(aiLayoutGuideText, /Daily note or diary: use `document\(action="create_daily_note"\)`/);
        assert.match(aiLayoutGuideText, /Meeting notes: headings for agenda, lists for points, task lists for follow-ups, and callouts for decisions or risks/);

        const actionHelpText = await readResourceText(client, 'siyuan://help/action/document/move');
        assert.match(actionHelpText, /document\(action="move"\)/);
        assert.match(actionHelpText, /fromIDs \+ toID/);
        assert.match(actionHelpText, /fromPaths \+ toNotebook \+ toPath/);
        assert.match(actionHelpText, /existing destination document/);

        const blockSetAttrsHelpText = await readResourceText(client, 'siyuan://help/action/block/set_attrs');
        assert.match(blockSetAttrsHelpText, /custom-riff-decks/);
        assert.match(blockSetAttrsHelpText, /flashcard/i);

        const createDailyNoteHelpText = await readResourceText(client, 'siyuan://help/action/document/create_daily_note');
        assert.match(createDailyNoteHelpText, /prefer this action over manually creating a path and then appending content/);

        const validationError = (await callToolJson(client, 'document', {
            action: 'rename',
            id: 'dummy-id-for-validation',
        })).json;
        assert.equal(validationError.error.type, 'validation_error');
        assert.match(validationError.error.message, /document\(action="rename"\)/);
        assert.equal(validationError.error.fields[0].path, 'title');
        assert.match(validationError.error.fields[0].message, /title is required/);
        assert.match(validationError.error.hint, /id \+ title or notebook \+ path \+ title/);
        assert.equal(validationError.error.details, undefined);

        const disabledActionError = (await callToolJson(client, 'document', {
            action: 'remove',
            id: 'dummy-id-for-disabled-action',
        })).json;
        assert.equal(disabledActionError.error.type, 'action_disabled');
        assert.match(disabledActionError.error.message, /Action "remove" is disabled for tool "document"/);
    }));
}

async function runAvSmoke(client, createdBlockIds) {
    const avSearch = await callToolJson(client, 'av', {
        action: 'search',
        keyword: '',
    });
    assert.ok(Array.isArray(avSearch.json.results), 'av search should return results array');

    const candidate = avSearch.json.results.find((item) => item && typeof item.id === 'string');
    if (!candidate) {
        console.log('T24 SKIP - no existing AV found in workspace for live AV smoke');
        return;
    }

    const avID = candidate.id;
    const avGet = await callToolJson(client, 'av', {
        action: 'get',
        id: avID,
    });
    assert.equal(avGet.json.id, avID);
    assert.equal(typeof avGet.json.av, 'object');

    const avPrimary = await callToolJson(client, 'av', {
        action: 'get_primary_key_values',
        avID,
        page: 1,
        pageSize: 5,
    });
    assert.equal(avPrimary.json.avID, avID);
    assert.equal(typeof avPrimary.json.name, 'string');
    assert.ok(Array.isArray(avPrimary.json.blockIDs));
    assert.ok(Array.isArray(avPrimary.json.rows));

    const avDuplicate = await callToolJson(client, 'av', {
        action: 'duplicate',
        avID,
    });
    if (avDuplicate.json.error?.type === 'permission_denied') {
        console.log(`T24 SKIP - AV duplicate denied by notebook permission for ${avID}`);
        return;
    }
    assert.equal(avDuplicate.json.success, true, `Unexpected AV duplicate result: ${JSON.stringify(avDuplicate.json)}`);
    assert.equal(typeof avDuplicate.json.avID, 'string');
    assert.equal(typeof avDuplicate.json.blockID, 'string');
    assert.equal(avDuplicate.json.prepared, true);
    assert.equal(avDuplicate.json.materialized, false);
    assert.equal(avDuplicate.json.semantics, 'kernel_prepared_duplicate');
    console.log(`T24 PASS - AV read/duplicate smoke on ${avID}`);
}

async function runLiveSmoke() {
    await withConfigMode('all-enabled', async () => withClient(async (client) => {
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const notebookName = `Codex MCP Smoke ${stamp}`;
        const createdDocIds = [];
        const createdBlockIds = [];

        const createdNotebook = await callToolJson(client, 'notebook', { action: 'create', name: notebookName });
        const notebookId = createdNotebook.json.id;
        assert.equal(typeof notebookId, 'string');
        const initialPerm = unwrapWriteResult((await callToolJson(client, 'notebook', {
            action: 'set_permission',
            notebook: notebookId,
            permission: 'rwd',
        })).json);
        assert.deepEqual(initialPerm, { success: true, notebook: notebookId, permission: 'rwd' });

        async function cleanup() {
            await callToolJson(client, 'notebook', {
                action: 'set_permission',
                notebook: notebookId,
                permission: 'rwd',
            }).catch(() => {});
            for (const blockId of [...new Set(createdBlockIds)].reverse()) {
                await callToolJson(client, 'block', { action: 'delete', id: blockId }).catch(() => {});
            }
            for (const docId of [...new Set(createdDocIds)].reverse()) {
                await callToolJson(client, 'document', { action: 'remove', id: docId }).catch(() => {});
            }
            await callToolJson(client, 'notebook', { action: 'remove', notebook: notebookId }).catch(() => {});
        }

        try {
            const preheatNotebook = await callToolJson(client, 'notebook', { action: 'list' });
            assert.ok(Array.isArray(preheatNotebook.json));

            const version = await callToolJson(client, 'system', { action: 'get_version' });
            assert.equal(typeof version.json.version, 'string');

            const currentTime = await callToolJson(client, 'system', { action: 'get_current_time' });
            assert.equal(typeof currentTime.json.currentTime, 'number');

            const renderSprig = await callToolJson(client, 'file', {
                action: 'render',
                engine: 'sprig',
                template: 'codex-{{ now | date "2006" }}',
            });
            assert.match(renderSprig.json, /^codex-\d{4}$/);

            const missingNotebookChildren = await callToolJson(client, 'notebook', {
                action: 'get_child_docs',
                notebook: 'missing-notebook-id',
            });
            assert.equal(missingNotebookChildren.json.error?.type, 'internal_error');
            assert.match(missingNotebookChildren.json.error?.message, /does not exist/);

            const source = await callToolJsonUnwrapped(client, 'document', {
                action: 'create',
                notebook: notebookId,
                path: '/SourceDoc',
                markdown: 'seed',
            });
            const target = await callToolJsonUnwrapped(client, 'document', {
                action: 'create',
                notebook: notebookId,
                path: '/TargetDoc',
                markdown: 'target body',
            });
            const pathMove = await callToolJsonUnwrapped(client, 'document', {
                action: 'create',
                notebook: notebookId,
                path: '/PathMoveDoc',
                markdown: 'path move body',
            });
            const childDoc = await callToolJsonUnwrapped(client, 'document', {
                action: 'create',
                notebook: notebookId,
                path: '/TargetDoc/ChildDoc',
                markdown: 'child body',
            });
            const deleteDoc = await callToolJsonUnwrapped(client, 'document', {
                action: 'create',
                notebook: notebookId,
                path: '/DeleteDoc',
                markdown: 'delete body',
            });

            for (const createdDoc of [source, target, pathMove, childDoc, deleteDoc]) {
                assert.equal(typeof createdDoc.json.id, 'string', `document.create did not return id: ${JSON.stringify(createdDoc.json)}`);
            }
            createdDocIds.push(source.json.id, target.json.id, pathMove.json.id, childDoc.json.id, deleteDoc.json.id);

            const preheatedPath = await lookupDoc(client, {
                id: source.json.id,
                include: ['path'],
            });
            assert.equal(preheatedPath.notebook, notebookId);

            const preheatedChildren = (await callToolJson(client, 'block', {
                action: 'get_children',
                id: source.json.id,
            })).json;
            assert.ok(Array.isArray(blockChildren(preheatedChildren)), `block.get_children did not return children: ${JSON.stringify(preheatedChildren)}`);

            const notebookChildren = (await callToolJson(client, 'notebook', {
                action: 'get_child_docs',
                notebook: notebookId,
            })).json;
            const notebookChildDocs = listItems(notebookChildren);
            assert.ok(notebookChildDocs.some((doc) => doc.id === source.json.id));
            assert.ok(notebookChildDocs.some((doc) => doc.id === target.json.id));
            assert.ok(notebookChildDocs.some((doc) => doc.id === pathMove.json.id));
            assert.ok(!notebookChildDocs.some((doc) => doc.id === childDoc.json.id));

            const targetChildDocs = (await callToolJson(client, 'document', {
                action: 'get_child_docs',
                id: target.json.id,
            })).json;
            assert.ok(listItems(targetChildDocs).some((doc) => doc.id === childDoc.json.id));

            const sourcePath = await lookupDoc(client, { id: source.json.id, include: ['path'] });
            assert.equal(sourcePath.notebook, notebookId);
            assert.match(sourcePath.path, /^\/.+\.sy$/);

            const sourceHPath = await lookupDoc(client, { id: source.json.id, include: ['hpath'] });
            assert.equal(sourceHPath.hPath, '/SourceDoc');

            const sourceHPathByPath = await lookupDoc(client, {
                notebook: notebookId,
                path: sourcePath.path,
                include: ['hpath'],
            });
            assert.equal(sourceHPathByPath.hPath, sourceHPath.hPath);

            const sourceIdsByHPath = await lookupDoc(client, {
                notebook: notebookId,
                hpath: sourceHPath.hPath,
                include: ['ids'],
            });
            assert.deepEqual(sourceIdsByHPath.ids, [source.json.id]);

            await callToolJson(client, 'document', {
                action: 'rename',
                notebook: notebookId,
                path: sourcePath.path,
                title: 'SourceDoc Path Renamed',
            });
            const sourcePathAfterPathRename = await lookupDoc(client, {
                id: source.json.id,
                include: ['path'],
            });
            const sourceHPathAfterPathRename = await lookupDoc(client, {
                id: source.json.id,
                include: ['hpath'],
            });
            assert.equal(sourcePathAfterPathRename.path, sourcePath.path);
            assert.equal(sourceHPathAfterPathRename.hPath, '/SourceDoc Path Renamed');

            await callToolJson(client, 'document', {
                action: 'rename',
                id: source.json.id,
                title: 'SourceDoc ID Renamed',
            });
            const sourcePathAfterIdRename = await lookupDoc(client, {
                id: source.json.id,
                include: ['path'],
            });
            const sourceHPathAfterIdRename = await lookupDoc(client, {
                id: source.json.id,
                include: ['hpath'],
            });
            assert.equal(sourcePathAfterIdRename.path, sourcePath.path);
            assert.equal(sourceHPathAfterIdRename.hPath, '/SourceDoc ID Renamed');

            const append = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'append',
                dataType: 'markdown',
                data: '- doc append',
                parentID: source.json.id,
            })).json);
            const prepend = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'prepend',
                dataType: 'markdown',
                data: '- doc prepend',
                parentID: source.json.id,
            })).json);
            const appendBlockId = append.id;
            const prependBlockId = prepend.id;
            assert.equal(append.success, true);
            assert.equal(prepend.success, true);
            createdBlockIds.push(appendBlockId, prependBlockId);

            const insert = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'insert',
                dataType: 'markdown',
                data: '- insert before append',
                nextID: appendBlockId,
            })).json);
            const insertBlockId = insert.id;
            assert.equal(insert.success, true);
            createdBlockIds.push(insertBlockId);

            const docChildren = (await callToolJson(client, 'block', {
                action: 'get_children',
                id: source.json.id,
            })).json;
            const docChildBlocks = blockChildren(docChildren);
            const docChildrenViaDocument = (await callToolJson(client, 'document', {
                action: 'get_child_blocks',
                id: source.json.id,
            })).json;
            assert.deepEqual(docChildrenViaDocument, docChildBlocks);
            assert.equal(docChildBlocks[0].id, prependBlockId, `Unexpected child blocks: ${JSON.stringify(docChildBlocks)}`);
            assert.ok(docChildBlocks.some((block) => block.id === insertBlockId));
            assert.equal(docChildBlocks[docChildBlocks.length - 1].id, appendBlockId);
            assert.ok(docChildBlocks.some((block) => block.type === 'p'));

            const nestedAppend = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'append',
                dataType: 'markdown',
                data: '- child append',
                parentID: appendBlockId,
            })).json);
            const nestedPrepend = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'prepend',
                dataType: 'markdown',
                data: '- child prepend',
                parentID: appendBlockId,
            })).json);
            createdBlockIds.push(nestedAppend.id, nestedPrepend.id);

            await callToolJson(client, 'block', {
                action: 'update',
                dataType: 'markdown',
                data: '- doc append updated',
                id: appendBlockId,
            });
            await callToolJson(client, 'block', {
                action: 'set_attrs',
                id: appendBlockId,
                attrs: { 'custom-codex': 'smoke' },
            });
            const attrs = (await callToolJson(client, 'block', {
                action: 'get_attrs',
                id: appendBlockId,
            })).json;
            assert.equal(attrs['custom-codex'], 'smoke');

            const foldResult = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'set_fold_state',
                id: appendBlockId,
                folded: true,
            })).json);
            const unfoldResult = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'set_fold_state',
                id: appendBlockId,
                folded: false,
            })).json);
            assert.deepEqual(foldResult, { success: true, id: appendBlockId, folded: true });
            assert.deepEqual(unfoldResult, { success: true, id: appendBlockId, folded: false });

            const moveBlockResult = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'move',
                id: insertBlockId,
                previousID: appendBlockId,
                parentID: source.json.id,
            })).json);
            assert.deepEqual(moveBlockResult, {
                success: true,
                id: insertBlockId,
            });

            const docChildrenAfterMove = (await callToolJson(client, 'block', {
                action: 'get_children',
                id: source.json.id,
            })).json;
            const docChildBlocksAfterMove = blockChildren(docChildrenAfterMove);
            const appendIndexAfterMove = docChildBlocksAfterMove.findIndex((block) => block.id === appendBlockId);
            const insertIndexAfterMove = docChildBlocksAfterMove.findIndex((block) => block.id === insertBlockId);
            assert.ok(appendIndexAfterMove >= 0);
            assert.equal(insertIndexAfterMove, appendIndexAfterMove + 1);

            const kramdown = (await callToolJson(client, 'block', {
                action: 'get_kramdown',
                id: source.json.id,
            })).json;
            assert.match(kramdown.kramdown, /doc append updated/);

            await callToolJson(client, 'block', { action: 'delete', id: prependBlockId });
            removeItem(createdBlockIds, prependBlockId);

            const exportMd = (await callToolJson(client, 'file', {
                action: 'export_md',
                id: source.json.id,
            })).json;
            assert.equal(exportMd.hPath, '/SourceDoc ID Renamed');
            assert.match(exportMd.content, /- doc append updated/);

            const getDocMarkdown = (await callToolJson(client, 'document', {
                action: 'get_doc',
                id: source.json.id,
                mode: 'markdown',
            })).json;
            assert.equal(getDocMarkdown.mode, 'markdown');
            assert.equal(getDocMarkdown.hPath, '/SourceDoc ID Renamed');
            assert.match(getDocMarkdown.content, /- doc append updated/);

            const getDocMarkdownPaged = (await callToolJson(client, 'document', {
                action: 'get_doc',
                id: source.json.id,
                mode: 'markdown',
                page: 1,
                pageSize: 20,
            })).json;
            assert.equal(getDocMarkdownPaged.page, 1);
            assert.equal(getDocMarkdownPaged.pageSize, 20);
            assert.equal(typeof getDocMarkdownPaged.pageCount, 'number');

            const localUploadPath = path.join(process.cwd(), 'tmp', 'mcp-smoke-export.txt');
            fs.mkdirSync(path.dirname(localUploadPath), { recursive: true });
            fs.writeFileSync(localUploadPath, 'mcp-smoke-export');
            const uploadAsset = (await callToolJson(client, 'file', {
                action: 'upload_asset',
                assetsDirPath: '/assets/',
                localFilePath: localUploadPath,
            })).json;
            const uploadedAssetPath = Object.values(uploadAsset.succMap ?? {})[0];
            assert.equal(typeof uploadedAssetPath, 'string');
            assert.equal(uploadAsset.localFilePath, localUploadPath);

            const exportResourcesAbsolute = (await callToolJson(client, 'file', {
                action: 'export_resources',
                paths: [uploadedAssetPath],
            })).json;
            assert.equal(typeof exportResourcesAbsolute.path, 'string');

            const exportResourcesRelative = (await callToolJson(client, 'file', {
                action: 'export_resources',
                paths: [String(uploadedAssetPath).replace(/^\//, '')],
            })).json;
            assert.equal(typeof exportResourcesRelative.path, 'string');

            const localZipPath = path.join(process.cwd(), 'tmp', 'mcp-smoke-export.zip');
            fs.rmSync(localZipPath, { force: true });
            const exportResourcesLocal = (await callToolJson(client, 'file', {
                action: 'export_resources',
                paths: [uploadedAssetPath],
                outputPath: localZipPath,
            })).json;
            assert.equal(exportResourcesLocal.outputPath, localZipPath);
            assert.equal(typeof exportResourcesLocal.bytes, 'number');
            assert.ok(fs.existsSync(localZipPath));
            assert.ok(fs.statSync(localZipPath).size > 0);

            const pushMsg = (await callToolJson(client, 'system', {
                action: 'notify',
                msg: 'Codex live smoke test',
                level: 'info',
                timeout: 1000,
            })).json;
            assert.equal(typeof pushMsg.id, 'string');

            // --- Search tool smoke tests ---

            const fulltextResult = (await callToolJson(client, 'search', {
                action: 'fulltext',
                query: 'doc append updated',
                stripHtml: true,
            })).json;
            assert.ok(Array.isArray(fulltextResult.data) || 'blocks' in fulltextResult || 'matchedBlockCount' in fulltextResult, `Unexpected fulltext result: ${JSON.stringify(fulltextResult)}`);
            const fulltextItems = Array.isArray(fulltextResult.data) ? fulltextResult.data : fulltextResult.blocks;
            if (Array.isArray(fulltextItems) && fulltextItems.length > 0) {
                assert.ok('plainContent' in fulltextItems[0] || 'content' in fulltextItems[0]);
            }

            const sqlResult = (await callToolJson(client, 'search', {
                action: 'query_sql',
                stmt: "SELECT * FROM blocks WHERE content LIKE '%doc append updated%' LIMIT 5",
            })).json;
            assert.ok(Array.isArray(sqlResult.rows) || Array.isArray(sqlResult.data), `Unexpected SQL result: ${JSON.stringify(sqlResult)}`);

            const sqlDenied = (await callToolJson(client, 'search', {
                action: 'query_sql',
                stmt: 'DROP TABLE blocks',
            })).json;
            assert.equal(sqlDenied.error?.type, 'internal_error');
            assert.match(sqlDenied.error?.message, /Only SELECT statements/);

            const tagResult = (await callToolJson(client, 'tag', {
                action: 'list',
                keyword: '',
            })).json;
            assert.ok(Array.isArray(tagResult) || 'tags' in tagResult);

            const backlinks = (await callToolJson(client, 'search', {
                action: 'get_backlinks',
                id: source.json.id,
            })).json;
            assert.ok('backlinks' in backlinks);

            const backmentions = (await callToolJson(client, 'search', {
                action: 'get_backlinks',
                id: source.json.id,
                mode: 'mentions',
            })).json;
            assert.ok('backmentions' in backmentions);

            const refs = (await callToolJson(client, 'search', {
                action: 'search_refs',
                id: source.json.id,
            })).json;
            assert.ok(Array.isArray(refs.blocks));

            console.log('Search tool smoke passed');

            const moveById = unwrapWriteResult((await callToolJson(client, 'document', {
                action: 'move',
                fromIDs: [deleteDoc.json.id],
                toID: target.json.id,
            })).json);
            assert.deepEqual(moveById, {
                success: true,
                fromIDs: [deleteDoc.json.id],
                toID: target.json.id,
            });

            await callToolJson(client, 'document', { action: 'remove', id: deleteDoc.json.id });
            removeItem(createdDocIds, deleteDoc.json.id);

            const pathMovePath = await lookupDoc(client, {
                id: pathMove.json.id,
                include: ['path'],
            });
            const targetPath = await lookupDoc(client, {
                id: target.json.id,
                include: ['path'],
            });

            const moveByPath = unwrapWriteResult((await callToolJson(client, 'document', {
                action: 'move',
                fromPaths: [pathMovePath.path],
                toNotebook: notebookId,
                toPath: targetPath.path,
            })).json);
            assert.deepEqual(moveByPath, { success: true });

            const pathMoveAfterMoveByPath = await lookupDoc(client, {
                id: pathMove.json.id,
                include: ['path'],
            });
            assert.match(pathMoveAfterMoveByPath.path, new RegExp(`^${targetPath.path.replace(/\.sy$/, '')}/.+\\.sy$`));

            const readonlyPerm = unwrapWriteResult((await callToolJson(client, 'notebook', {
                action: 'set_permission',
                notebook: notebookId,
                permission: 'r',
            })).json);
            assert.deepEqual(readonlyPerm, { success: true, notebook: notebookId, permission: 'r' });

            await assertPermissionDenied(client, 'document', {
                action: 'create',
                notebook: notebookId,
                path: '/ReadonlyCreateShouldFail',
                markdown: 'denied',
            });
            await assertPermissionDenied(client, 'document', {
                action: 'rename',
                id: source.json.id,
                title: 'Readonly Rename Should Fail',
            });
            await assertPermissionDenied(client, 'document', {
                action: 'remove',
                id: childDoc.json.id,
            });
            await assertPermissionDenied(client, 'document', {
                action: 'move',
                fromIDs: [pathMove.json.id],
                toID: target.json.id,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'append',
                dataType: 'markdown',
                data: '- denied append',
                parentID: source.json.id,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'update',
                dataType: 'markdown',
                data: '- denied update',
                id: appendBlockId,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'delete',
                id: appendBlockId,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'move',
                id: insertBlockId,
                previousID: appendBlockId,
                parentID: source.json.id,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'set_fold_state',
                id: appendBlockId,
                folded: true,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'set_fold_state',
                id: appendBlockId,
                folded: false,
            });
            console.log('T20 PASS - r blocks all tested writes');

            const nonePerm = unwrapWriteResult((await callToolJson(client, 'notebook', {
                action: 'set_permission',
                notebook: notebookId,
                permission: 'none',
            })).json);
            assert.deepEqual(nonePerm, { success: true, notebook: notebookId, permission: 'none' });

            await assertPermissionDenied(client, 'notebook', {
                action: 'get_conf',
                notebook: notebookId,
            });
            await assertPermissionDenied(client, 'notebook', {
                action: 'get_child_docs',
                notebook: notebookId,
            });
            await assertPermissionDenied(client, 'document', {
                action: 'lookup',
                id: source.json.id,
                include: ['path'],
            });
            await assertPermissionDenied(client, 'document', {
                action: 'lookup',
                id: source.json.id,
                include: ['hpath'],
            });
            await assertPermissionDenied(client, 'document', {
                action: 'get_child_blocks',
                id: source.json.id,
            });
            await assertPermissionDenied(client, 'document', {
                action: 'get_child_docs',
                id: target.json.id,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'get_children',
                id: appendBlockId,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'get_kramdown',
                id: source.json.id,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'get_attrs',
                id: appendBlockId,
            });
            await assertPermissionDenied(client, 'document', {
                action: 'create',
                notebook: notebookId,
                path: '/NoneCreateShouldFail',
                markdown: 'denied',
            });
            await assertPermissionDenied(client, 'document', {
                action: 'rename',
                id: source.json.id,
                title: 'None Rename Should Fail',
            });
            await assertPermissionDenied(client, 'document', {
                action: 'remove',
                id: childDoc.json.id,
            });
            await assertPermissionDenied(client, 'document', {
                action: 'move',
                fromIDs: [pathMove.json.id],
                toID: target.json.id,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'append',
                dataType: 'markdown',
                data: '- denied append in none',
                parentID: source.json.id,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'update',
                dataType: 'markdown',
                data: '- denied update in none',
                id: appendBlockId,
            });
            await assertPermissionDenied(client, 'block', {
                action: 'delete',
                id: appendBlockId,
            });
            console.log('T22 PASS - none blocks all tested reads and writes');

            const writePerm = unwrapWriteResult((await callToolJson(client, 'notebook', {
                action: 'set_permission',
                notebook: notebookId,
                permission: 'rwd',
            })).json);
            assert.deepEqual(writePerm, { success: true, notebook: notebookId, permission: 'rwd' });

            const writeConf = (await callToolJson(client, 'notebook', {
                action: 'get_conf',
                notebook: notebookId,
            })).json;
            assert.equal(typeof writeConf, 'object');
            assert.ok(writeConf && !Array.isArray(writeConf));

            const writePath = await lookupDoc(client, {
                id: source.json.id,
                include: ['path'],
            });
            assert.equal(writePath.notebook, notebookId);

            const writeChildren = (await callToolJson(client, 'block', {
                action: 'get_children',
                id: source.json.id,
            })).json;
            assert.ok(Array.isArray(blockChildren(writeChildren)));
            assert.ok(blockChildren(writeChildren).length > 0);

            const writeRecovered = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'append',
                dataType: 'markdown',
                data: '- write restored',
                parentID: source.json.id,
            })).json);
            const writeRecoveredBlockId = writeRecovered.id;
            createdBlockIds.push(writeRecoveredBlockId);

            const writeCreatedDoc = (await callToolJsonUnwrapped(client, 'document', {
                action: 'create',
                notebook: notebookId,
                path: '/WriteModeCreateCheck',
                markdown: 'write ok',
            })).json;
            createdDocIds.push(writeCreatedDoc.id);
            assert.equal(typeof writeCreatedDoc.id, 'string');

            const writeCreatedDocPath = await lookupDoc(client, {
                id: writeCreatedDoc.id,
                include: ['path'],
            });
            assert.equal(writeCreatedDocPath.notebook, notebookId);

            const writeUpdated = unwrapWriteResult((await callToolJson(client, 'block', {
                action: 'update',
                dataType: 'markdown',
                data: '- write restored updated',
                id: writeRecoveredBlockId,
            })).json);
            assert.deepEqual(writeUpdated, {
                success: true,
                id: writeRecoveredBlockId,
            });

            await callToolJson(client, 'document', {
                action: 'rename',
                id: writeCreatedDoc.id,
                title: 'WriteModeCreateCheck Renamed',
            });
            const writeCreatedDocHPath = await lookupDoc(client, {
                id: writeCreatedDoc.id,
                include: ['hpath'],
            });
            assert.equal(writeCreatedDocHPath.hPath, '/WriteModeCreateCheck Renamed');

            await callToolJson(client, 'document', {
                action: 'remove',
                id: writeCreatedDoc.id,
            });
            removeItem(createdDocIds, writeCreatedDoc.id);

            await callToolJson(client, 'block', {
                action: 'delete',
                id: writeRecoveredBlockId,
            });
            removeItem(createdBlockIds, writeRecoveredBlockId);
            console.log('T23 PASS - write restores tested reads and writes');

            await runAvSmoke(client, createdBlockIds);

            await callToolJson(client, 'document', {
                action: 'remove',
                notebook: notebookId,
                path: sourcePathAfterIdRename.path,
            });
            removeItem(createdDocIds, source.json.id);

            console.log(`Live smoke passed against SiYuan ${version.json.version}.`);
            console.log(`Notebook: ${notebookId}`);
            console.log(`Storage path example: ${sourcePath.path}`);
            console.log(`Hierarchical path example: ${sourceHPathAfterIdRename.hPath}`);
        } finally {
            await cleanup();
        }
    }));
}

async function main() {
    const versionCheck = await fetch(`${SIYUAN_URL}/api/system/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    });

    if (!versionCheck.ok) {
        throw new Error(`SiYuan is not reachable at ${SIYUAN_URL}.`);
    }

    await assertDefaultToolList();
    await runLiveSmoke();
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
});
