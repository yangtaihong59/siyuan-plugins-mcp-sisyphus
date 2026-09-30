import { hashWriteState } from '../core/write-safety-hash';
import { randomUUID } from './node-shims';

export const MODERN_VERSION = '2026-07-28';
export const VERSION_META = 'io.modelcontextprotocol/protocolVersion';
export const CAPABILITIES_META = 'io.modelcontextprotocol/clientCapabilities';
export const CLIENT_META = 'io.modelcontextprotocol/clientInfo';
const SERVER_META = 'io.modelcontextprotocol/serverInfo';
const CONFIRMATION = 'dangerous-action-confirmation';
export const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export function header(request: any, key: string): string {
    for (const [name, value] of Object.entries(request?.request?.headers ?? {})) {
        if (name.toLowerCase() === key.toLowerCase()) return Array.isArray(value) ? String(value[0]) : String(value);
    }
    return '';
}
export interface ModernContext { params: any; capabilities: Record<string, any>; binding: string }
export function modernContext(request: any, rpc: any): ModernContext | undefined {
    const version = header(request, 'mcp-protocol-version');
    const meta = rpc.params?._meta;
    const claimed = meta?.[VERSION_META];
    if (!claimed && (!version || version < MODERN_VERSION)) return;
    if (claimed !== MODERN_VERSION || (version && version !== claimed)) throw new Error('Unsupported or mismatched MCP protocol version');
    if (!isObject(meta) || !isObject(meta[CAPABILITIES_META])) throw new Error('Modern requests require clientCapabilities in params._meta');
    if (meta[CLIENT_META] !== undefined && (!isObject(meta[CLIENT_META]) || typeof meta[CLIENT_META].name !== 'string' || typeof meta[CLIENT_META].version !== 'string')) throw new Error('Invalid clientInfo');
    return {
        params: rpc.params, capabilities: meta[CAPABILITIES_META],
        // The authenticated principal and client declaration bind a continuation.
        // Elicitation trusts the client to collect human input; it is not a human attestation.
        binding: hashWriteState({ auth: header(request, 'authorization'), cookie: header(request, 'cookie'), client: meta[CLIENT_META] ?? {} }),
    };
}
export function modernResult(method: string, result: any, version: string): any {
    if (!isObject(result)) return result;
    const cacheable = ['server/discover', 'tools/list', 'prompts/list', 'resources/list', 'resources/templates/list', 'resources/read', 'skills/list', 'skills/get'].includes(method);
    const out: Record<string, any> = { ...result, resultType: result.resultType ?? 'complete', ...(cacheable ? { ttlMs: 0, cacheScope: 'private' } : {}), _meta: { ...result._meta, [SERVER_META]: { name: 'siyuan-sisyphus-kernel', version } } };
    if (method === 'tools/list') out.tools = result.tools.map(({ execution: _execution, ...tool }: any) => tool);
    return out;
}

/** Issued continuations are bounded, operation-bound, short-lived and single-use.
 * They protect the MRTR state machine; authorization remains the host's private route.
 */
export class KernelConfirmations {
    private pending = new Map<string, { digest: string; expires: number }>();
    constructor(private now = Date.now, private ttl = 5 * 60_000, private capacity = 128) {}
    check(context: ModernContext, name: string, args: Record<string, unknown>): any | undefined {
        for (const [key, entry] of this.pending) if (entry.expires <= this.now()) this.pending.delete(key);
        const { confirm: _ignored, ...operation } = args;
        const digest = hashWriteState({ binding: context.binding, name, args: operation });
        const { requestState, inputResponses } = context.params;
        if (requestState !== undefined || inputResponses !== undefined) {
            const issued = typeof requestState === 'string' ? this.pending.get(requestState) : undefined;
            if (!issued || issued.digest !== digest) return failure('confirmation_invalid', 'Confirmation expired, was consumed, or does not match this client and operation. Request confirmation again.');
            // Consume before any await or dispatch, including a declined/malformed answer.
            this.pending.delete(requestState);
            const answer = inputResponses?.[CONFIRMATION];
            if (isObject(answer) && answer.action === 'cancel') return failure('confirmation_cancelled', 'The client explicitly cancelled confirmation.');
            if (isObject(answer) && answer.action === 'decline') return failure('confirmation_declined', 'The client explicitly declined confirmation.');
            if (!isObject(answer) || answer.action !== 'accept' || !isObject(answer.content)
                || Object.keys(answer.content).length !== 1 || typeof answer.content.confirm !== 'boolean') {
                return failure('confirmation_invalid', 'Invalid confirmation response; the operation was not executed.');
            }
            if (!answer.content.confirm) return failure('confirmation_declined', 'Execution was not confirmed.');
            return;
        }
        if (!isObject(context.capabilities.elicitation)) return failure('confirmation_unavailable', 'This action requires a client supporting form elicitation.');
        if (this.pending.size >= this.capacity) return failure('confirmation_capacity', 'Too many pending confirmations; wait for expiry.');
        const state = randomUUID();
        this.pending.set(state, { digest, expires: this.now() + this.ttl });
        const preview = JSON.stringify(operation);
        return {
            resultType: 'input_required', requestState: state,
            inputRequests: { [CONFIRMATION]: { method: 'elicitation/create', params: {
                mode: 'form', message: `Confirm high-risk SiYuan action ${name}.\nArguments: ${preview.slice(0, 1800)}\nThe operation has not run yet.`,
                requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean', title: 'Confirm execution' } }, required: ['confirm'], additionalProperties: false },
            } } },
        };
    }
}
function failure(code: string, message: string) {
    const payload = { success: false, cancelled: code === 'confirmation_cancelled', writeAttempted: false, writeExecuted: false, error: { code, message } };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
}
