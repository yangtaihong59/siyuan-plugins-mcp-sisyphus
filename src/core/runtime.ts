/**
 * Runtime environment helpers.
 *
 * No imports — safe to use from any module without circular-dependency risk.
 */

export type InvocationTransport = 'cli' | 'stdio' | 'http' | 'kernel';

export function getInvocationTransport(): InvocationTransport {
    const transport = (process.env.SIYUAN_MCP_TRANSPORT ?? '').toLowerCase();
    if (transport === 'cli' || transport === 'http' || transport === 'kernel') {
        return transport;
    }
    return 'stdio';
}
