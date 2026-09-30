import { selectOfficialTools, type OfficialMcpDiscoverySnapshot } from '../core/official-mcp-tools';
import type { OfficialMcpRuntime } from '../core/official-mcp-bridge';
import type { ToolResult } from '../tools/internal/shared';
declare const siyuan: any;

const OFFICIAL_MCP_PROTOCOL = '2025-03-26';
let officialSessionId: string | null = null;
let officialSessionInit: Promise<string> | null = null;


function headerValue(headers: unknown, name: string): string | null {
    if (!headers || typeof headers !== 'object') return null;
    const want = name.toLowerCase();
    for (const [key, val] of Object.entries(headers as Record<string, unknown>)) {
        if (key.toLowerCase() !== want) continue;
        if (Array.isArray(val)) return typeof val[0] === 'string' ? val[0] : null;
        return typeof val === 'string' ? val : null;
    }
    return null;
}

async function rawMcpPost(body: Record<string, unknown>, sessionId?: string): Promise<{ resp: any; raw: string }> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    headers['MCP-Protocol-Version'] = OFFICIAL_MCP_PROTOCOL;
    const resp = await siyuan.client.fetch('/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    let raw = '';
    try { raw = typeof resp?.text === 'function' ? await resp.text() : ''; } catch { raw = ''; }
    if (raw === '' && typeof resp?.json === 'function') {
        try { raw = JSON.stringify(await resp.json()); } catch { raw = ''; }
    }
    return { resp, raw };
}

async function openOfficialSession(): Promise<string> {
    const { resp, raw } = await rawMcpPost({
        jsonrpc: '2.0', id: 'init', method: 'initialize',
        params: { protocolVersion: OFFICIAL_MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'siyuan-sisyphus-kernel', version: '1.0.0' } },
    });
    const sid = headerValue(resp?.headers, 'mcp-session-id');
    if (!sid) throw new Error('kernel /mcp initialize did not return Mcp-Session-Id. body=' + String(raw).slice(0, 200));
    try {
        await rawMcpPost({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    } catch { /* best-effort */ }
    return sid;
}

async function ensureOfficialSession(): Promise<string> {
    if (officialSessionId) return officialSessionId;
    if (!officialSessionInit) {
        officialSessionInit = openOfficialSession()
            .then((sid) => { officialSessionId = sid; return sid; })
            .finally(() => { officialSessionInit = null; });
    }
    return officialSessionInit;
}

/*
 * Stateful MCP-over-HTTP pass-through to the kernel's own /mcp endpoint.
 * SiYuan's /mcp runs the official StreamableHTTP handler in STATEFUL mode —
 * a bare tools/call POST is rejected. Run initialize -> Mcp-Session-Id ->
 * notifications/initialized -> method. Session id is cached module-wide and
 * rebuilt for the next call when the kernel drops it; writes are never replayed.
 */
async function forwardOfficialMcp(method: string, params: Record<string, unknown>): Promise<any> {
    const sid = await ensureOfficialSession();
    try {
        const { resp, raw } = await rawMcpPost({ jsonrpc: '2.0', id: 1, method, params }, sid);
        if (!resp.ok) throw new Error(`Official MCP HTTP ${resp.status}`);
        const payload = extractJsonRpcPayload(raw) as any;
        if (!payload || payload.id !== 1 || payload.error || !payload.result) {
            throw new Error(payload?.error?.message ?? 'Invalid official MCP response');
        }
        return payload.result;
    } catch (error) {
        // Invalidate for the NEXT request. Never replay a dispatched tool call.
        officialSessionId = null;
        throw error;
    }
}

function extractJsonRpcPayload(raw: string): unknown {
    const text = (raw ?? '').trim();
    if (text === '') return null;
    try {
        return JSON.parse(text);
    } catch {
        // SSE stream: take the last data: line.
        let last: string | null = null;
        for (const line of text.split('\n')) {
            const t = line.trim();
            if (t.startsWith('data:')) last = t.slice(5).trim();
        }
        if (last) {
            try { return JSON.parse(last); } catch { return null; }
        }
        return null;
    }
}


let snapshot: OfficialMcpDiscoverySnapshot = { tools: [], connected: false, changed: false };
let refreshing: Promise<OfficialMcpDiscoverySnapshot> | undefined;
const bridge = {
    getTools: () => snapshot.tools,
    getSnapshot: () => ({ ...snapshot }),
    refresh: async (): Promise<OfficialMcpDiscoverySnapshot> => {
        if (refreshing) return refreshing;
        refreshing = (async () => {
            const lastAttemptAt = new Date().toISOString();
            try {
                const tools: unknown[] = [];
                const cursors = new Set<string>();
                let cursor: string | undefined;
                do {
                    const result = await forwardOfficialMcp('tools/list', cursor ? { cursor } : {});
                    if (!Array.isArray(result.tools)) throw new Error('Invalid official tools/list response');
                    tools.push(...result.tools);
                    cursor = result.nextCursor;
                    if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error('Invalid official MCP pagination');
                    if (cursor) cursors.add(cursor);
                } while (cursor);
                let capabilities: unknown;
                try {
                    const response = await siyuan.client.fetch('/api/ai/lsCapabilities', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
                    });
                    if (response.ok) capabilities = JSON.parse(await response.text()).data;
                } catch { /* metadata is optional on older kernels */ }
                const selected = selectOfficialTools(tools, capabilities);
                snapshot = { tools: selected, connected: true, changed: JSON.stringify(selected) !== JSON.stringify(snapshot.tools), lastAttemptAt, lastSuccessfulRefreshAt: lastAttemptAt };
            } catch (error) {
                // Do not execute tools from stale discovery after a failed refresh.
                snapshot = { ...snapshot, tools: [], connected: false, changed: true, lastAttemptAt, error: String(error) };
            }
            return snapshot;
        })().finally(() => { refreshing = undefined; });
        return refreshing;
    },
    callTool: async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
        try {
            const result = await forwardOfficialMcp('tools/call', { name, arguments: args });
            if (!Array.isArray(result.content)) throw new Error('Invalid official tools/call result');
            return result;
        } catch (error) {
            return { isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'outcome_unknown', message: String(error) }, writeAttempted: true }) }] };
        }
    },
};
export const kernelOfficialRuntime: OfficialMcpRuntime = { bridge };
