import { nodeCrypto } from '../core/node-loader';
import { stageKernelUpload, isKernelExport, saveKernelExport } from './kernel-file-transfer';
import type { SiYuanClient } from '../api/client';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import type { ToolResult } from '../tools/internal/shared';
import type { CliWriteCoordinatorSettings } from '../core/write-coordinator-settings';

export async function callCliWriteCoordinator(
    settings: CliWriteCoordinatorSettings | undefined,
    name: string,
    args: Record<string, unknown>,
    fileClient?: SiYuanClient,
    signal?: AbortSignal,
): Promise<ToolResult> {
    if (!settings || settings.endpoints.length !== 1) {
        return failure(
            'write_coordinator_unavailable',
            'Strict safe writes require one configured plugin coordinator (kernel endpoint or Node HTTP server). Check settings and repeat preflight.',
        );
    }

    let lastError: unknown;
    for (const endpoint of settings.endpoints) {
        const client = new Client(
            { name: 'siyuan-sisyphus-cli-write-coordinator', version: '1.0.0' },
            { capabilities: { elicitation: {} } },
        );
        // This internal hop occurs only after CLI authorization or the Node ingress confirmation.
        client.setRequestHandler('elicitation/create', async () => ({ action: 'accept', content: { confirm: true } }));
        const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
            ...(endpoint.token ? {
                authProvider: { token: async () => endpoint.token! },
            } : {}),
            reconnectionOptions: { maxReconnectionDelay: 0, initialReconnectionDelay: 0, reconnectionDelayGrowFactor: 1, maxRetries: 0 },
        });
        const taskId = settings.owner === 'kernel' ? nodeCrypto().randomUUID() : undefined;
        let finished = false;
        let cancelWork: Promise<void> | undefined;
        const cancel = () => {
            if (!taskId || cancelWork || !dispatched) return;
            cancelWork = (async () => {
                const url = new URL(endpoint.url); url.pathname = url.pathname.replace(/\/mcp\/?$/, '/tasks');
                // A cancellation can race request admission. Retry only the control message,
                // never the business call, and stop once the task is found or completes.
                for (let attempt = 0; attempt < 10 && !finished; attempt++) {
                    try {
                        const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(2000),
                            headers: { 'Content-Type': 'application/json', ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}) },
                            body: JSON.stringify({ operation: 'cancel', taskId }) });
                        if (!r.ok) return;
                        if ((await r.json()).found) return;
                    } catch { return; }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            })();
        };
        signal?.addEventListener('abort', cancel, { once: true });
        let dispatched = false;
        let received = false;
        try {
            if (signal?.aborted) return failure('request_cancelled', 'Cancelled before coordinator dispatch.');
            let forwarded = args;
            if (settings.owner === 'kernel' && ['file', 'siyuan_file'].includes(name) && args.action === 'upload_asset') forwarded = await stageKernelUpload(endpoint, args, signal);
            const saveExport = settings.owner === 'kernel' && fileClient && isKernelExport(name, args);
            if (saveExport) forwarded = { ...forwarded, delivery: 'download' };
            await client.connect(transport);
            if (signal?.aborted) return failure('request_cancelled', 'Cancelled before coordinator dispatch.');
            dispatched = true;
            // CLI invocation is confirmation; Node performs its own confirmation
            // before delegation. This marker is consumed by the kernel transport.
            let result: any;
            try { result = await client.callTool({ name, arguments: settings.owner === 'kernel' ? { ...forwarded, confirm: true } : forwarded, ...(taskId ? { _meta: { 'io.siyuan.sisyphus/taskId': taskId } } : {}) }); }
            catch (error) {
                // Only query the original task. Never repeat the business request here.
                const recovered = taskId ? await recoverKernelTask(endpoint, taskId) : undefined;
                if (!recovered) throw error;
                result = recovered;
            }
            received = true;
            if (forwarded.uploadSource && args.validateOnly === true && !result.isError) {
                const payload = (result.structuredContent ?? JSON.parse(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'))) as Record<string, unknown>;
                const preflight = { ...payload, uploadSource: forwarded.uploadSource };
                return { ...result, content: [{ type: 'text', text: JSON.stringify(preflight) }], structuredContent: preflight } as ToolResult;
            }
            return saveExport ? await saveKernelExport(fileClient!, args, result as ToolResult, signal) : result as ToolResult;
        } catch (error) {
            lastError = error;
            if (!dispatched && signal?.aborted) return failure('request_cancelled', 'Cancelled before coordinator dispatch.');
            if (received) return failure(signal?.aborted ? 'local_export_cancelled' : 'local_export_failed', `Kernel returned a result, but local saving failed: ${String(error)}`, true);
            if (dispatched) return failure('outcome_unknown',
                `Coordinator response was lost after dispatch. Reconcile with the same requestId and owner; do not switch endpoints: ${String(error)}`, true, taskId);
        } finally {
            finished = true;
            signal?.removeEventListener('abort', cancel);
            await cancelWork;
            await client.close().catch(() => {});
        }
    }
    return failure(
        'write_coordinator_unavailable',
        `Could not call the plugin write coordinator: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
}

function failure(code: string, message: string, dispatched = false, taskId?: string): ToolResult {
    const payload = {
        success: false,
        writeSafetyMode: 'strict',
        writeAttempted: dispatched,
        ...(dispatched ? {} : { writeExecuted: false }),
        error: { code, message },
        ...(taskId ? { taskId, recovery: { operation: 'result', endpoint: '/tasks' } } : {}),
    };
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        isError: true,
    };
}

async function recoverKernelTask(endpoint: { url: string; token?: string }, taskId: string): Promise<ToolResult | undefined> {
    const url = new URL(endpoint.url); url.pathname = url.pathname.replace(/\/mcp\/?$/, '/tasks');
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(2000),
                headers: { 'Content-Type': 'application/json', ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}) },
                body: JSON.stringify({ operation: 'result', taskId }) });
            if (!response.ok) return;
            const record = await response.json();
            if (record.found && record.state === 'done') {
                return record.resultAvailable && record.result && Array.isArray(record.result.content) ? record.result : undefined;
            }
        } catch { return; }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100));
    }
}
