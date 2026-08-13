#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const configPath = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig';

function activeProfile() {
    const file = path.join(os.homedir(), '.siyuan-sisyphus', 'config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    const profile = config.profiles?.[config.currentProfile || 'default'] || config;
    return {
        apiUrl: profile.apiUrl || config.apiUrl || 'http://127.0.0.1:6806',
        token: profile.token || config.token || '',
    };
}

async function apiFetch(endpoint, data = {}) {
    const { apiUrl, token } = activeProfile();
    return fetch(`${apiUrl.replace(/\/+$/, '')}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify(data),
    });
}

async function readRemoteConfig() {
    const response = await apiFetch('/api/file/getFile', { path: configPath });
    if (!response.ok) throw new Error(`Cannot read tool config: HTTP ${response.status}`);
    return response.text();
}

async function writeRemoteConfig(text) {
    const { apiUrl, token } = activeProfile();
    const form = new FormData();
    form.append('path', configPath);
    form.append('isDir', 'false');
    form.append('modTime', String(Date.now()));
    form.append('file', new File([text], 'mcpToolsConfig'));
    const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/file/putFile`, {
        method: 'POST',
        headers: token ? { Authorization: `Token ${token}` } : {},
        body: form,
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
        throw new Error(`Cannot write tool config: ${payload.msg || response.status}`);
    }
}

function enableActions(original) {
    const config = JSON.parse(JSON.stringify(original));
    const requested = {
        notebook: ['get_permissions'],
        document: ['create', 'lookup', 'get_doc', 'get_child_blocks', 'remove'],
        block: ['get_kramdown', 'update'],
        timeline: ['list_nodes', 'create_node', 'compare_node', 'delete_node', 'rollback_document', 'rollback_block'],
        mascot: ['get_balance', 'shop', 'buy'],
    };
    for (const [category, actions] of Object.entries(requested)) {
        const current = config[category] && typeof config[category] === 'object' ? config[category] : {};
        config[category] = {
            ...current,
            enabled: true,
            actions: {
                ...(current.actions || {}),
                ...Object.fromEntries(actions.map((action) => [action, true])),
            },
        };
    }
    config.writeSafety = { ...(config.writeSafety || {}), strictMode: true };
    return config;
}

async function runChild() {
    const script = path.join(repoRoot, '.agents/skills/siyuan-built-cjs-live-test/scripts/call-built-mcp.cjs');
    const child = spawn(process.execPath, [
        script,
        '--server', 'dist/mcp-server.cjs',
        '--transport', 'direct',
        '--interactive',
        '--confirm-isolated-dangerous',
    ], { cwd: repoRoot, stdio: 'inherit', env: process.env });
    return new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`Live child exited with ${code ?? signal}`));
        });
    });
}

async function main() {
    const originalText = await readRemoteConfig();
    try {
        await writeRemoteConfig(JSON.stringify(enableActions(JSON.parse(originalText)), null, 2));
        await runChild();
    } finally {
        await writeRemoteConfig(originalText);
    }
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
