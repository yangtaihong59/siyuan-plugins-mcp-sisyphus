import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface TlsOptions {
    /** Path to PEM-encoded certificate file */
    certFile: string;
    /** Path to PEM-encoded private key file */
    keyFile: string;
    /** Path to PEM-encoded CA certificate file (optional) */
    caFile?: string;
}

export interface HttpServerOptions {
    host: string;
    port: number;
    token?: string;
    path?: string;
    serverFactory?: ServerFactory;
    /** When provided, the server starts in HTTPS mode using these TLS credentials */
    tls?: TlsOptions;
}

export interface HttpMcpServerHandle {
    host: string;
    port: number;
    path: string;
    close(): Promise<void>;
}

interface SessionEntry {
    server: Server;
    transport: StreamableHTTPServerTransport;
}

export type ServerFactory = () => Promise<Server>;

const PARENT_WATCH_INTERVAL_MS = 2000;
const SOCKET_DRAIN_TIMEOUT_MS = 1000;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

function loadTlsCredentials(tls: TlsOptions): { cert: Buffer; key: Buffer; ca?: Buffer } {
    try {
        const cert = readFileSync(tls.certFile);
        const key = readFileSync(tls.keyFile);
        const ca = tls.caFile ? readFileSync(tls.caFile) : undefined;
        return { cert, key, ca };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[MCP][HTTPS] Failed to load TLS credentials: ${msg}`);
    }
}

export async function startHttpMcpServer(opts: HttpServerOptions): Promise<HttpMcpServerHandle> {
    const sessions = new Map<string, SessionEntry>();
    const mcpPath = opts.path ?? '/mcp';
    const sockets = new Set<Socket>();
    let shuttingDown = false;
    let watchdogTimer: NodeJS.Timeout | null = null;
    const isTls = Boolean(opts.tls);
    const createServer = opts.serverFactory ?? (async () => {
        const { createSiYuanServer } = await import('./server');
        return createSiYuanServer();
    });

    const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
        try {
            // Path check
            const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
            if (url.pathname !== mcpPath) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'not_found', path: url.pathname }));
                return;
            }

            // Auth check
            if (opts.token) {
                const auth = req.headers['authorization'];
                if (auth !== `Bearer ${opts.token}`) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'unauthorized' }));
                    return;
                }
            }

            // Parse body for POST
            const parsedBody = req.method === 'POST' ? await readJsonBody(req) : undefined;

            // Session dispatch
            const sessionIdHeader = req.headers['mcp-session-id'];
            const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
            let entry = sessionId ? sessions.get(sessionId) : undefined;

            if (!entry) {
                // New session
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    retryInterval: 5000,
                });
                const server = await createServer();
                await server.connect(transport);

                transport.onclose = () => {
                    if (transport.sessionId) {
                        sessions.delete(transport.sessionId);
                    }
                };

                entry = { server, transport };
                await transport.handleRequest(req, res, parsedBody);
                if (transport.sessionId) {
                    sessions.set(transport.sessionId, entry);
                }
                return;
            }

            await entry.transport.handleRequest(req, res, parsedBody);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('[MCP][HTTP] request error:', msg);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'internal_error', message: msg }));
            } else {
                try { res.end(); } catch { /* noop */ }
            }
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const httpServer = isTls
        ? (require('https') as typeof import('https')).createServer(loadTlsCredentials(opts.tls!), requestHandler)
        : createHttpServer(requestHandler);

    // Prevent Node.js default keepAliveTimeout (5s) from dropping idle SSE connections.
    httpServer.keepAliveTimeout = 0;
    httpServer.timeout = 0;
    httpServer.headersTimeout = 60000;

    httpServer.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => {
            sockets.delete(socket);
        });
    });

    const closeSessionEntry = async (entry: SessionEntry): Promise<void> => {
        try {
            await entry.transport.close();
        } catch (error) {
            console.error('[MCP][HTTP] transport close error:', error instanceof Error ? error.message : String(error));
        }
        try {
            await entry.server.close();
        } catch (error) {
            console.error('[MCP][HTTP] server close error:', error instanceof Error ? error.message : String(error));
        }
    };

    const shutdown = async (reason: string, exitCode?: number): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (watchdogTimer) {
            clearInterval(watchdogTimer);
            watchdogTimer = null;
        }
        process.off('SIGTERM', handleSigterm);
        process.off('SIGINT', handleSigint);
        process.off('beforeExit', handleBeforeExit);
        console.error(`[MCP][HTTP] shutting down: ${reason}`);

        await Promise.allSettled(Array.from(sessions.values()).map(closeSessionEntry));
        sessions.clear();

        await new Promise<void>((resolve) => {
            const drainTimer = setTimeout(() => {
                for (const socket of sockets) {
                    try { socket.destroy(); } catch { /* noop */ }
                }
                resolve();
            }, SOCKET_DRAIN_TIMEOUT_MS);
            httpServer.close(() => {
                clearTimeout(drainTimer);
                resolve();
            });
            httpServer.closeIdleConnections?.();
            httpServer.closeAllConnections?.();
        });

        if (exitCode !== undefined) {
            process.exit(exitCode);
        }
    };

    const handleSigterm = () => { void shutdown('received SIGTERM', 0); };
    const handleSigint = () => { void shutdown('received SIGINT', 0); };
    const handleBeforeExit = () => { void shutdown('process beforeExit'); };

    await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
            httpServer.removeListener('error', onError);
            reject(err);
        };
        httpServer.once('error', onError);
        httpServer.listen(opts.port, opts.host, () => {
            httpServer.removeListener('error', onError);
            const scheme = isTls ? 'https' : 'http';
            const tag = isTls ? '[MCP][HTTPS]' : '[MCP][HTTP]';
            console.error(`${tag} listening on ${scheme}://${opts.host}:${opts.port}${mcpPath}`);
            console.error(`${tag} auth: ${opts.token ? 'Bearer token required' : 'DISABLED (open access)'}`);
            if (opts.host !== '127.0.0.1' && opts.host !== 'localhost' && !opts.token) {
                console.error(`${tag} WARNING: bound to non-loopback address without auth token. Set SIYUAN_MCP_TOKEN to secure.`);
            }
            resolve();
        });
    });

    // Keep listening; runtime errors after start
    httpServer.on('error', (err) => {
        console.error('[MCP][HTTP] server error:', err instanceof Error ? err.message : String(err));
    });

    process.on('SIGTERM', handleSigterm);
    process.on('SIGINT', handleSigint);
    process.on('beforeExit', handleBeforeExit);

    const parentPid = parseInt(process.env.SIYUAN_MCP_PARENT_PID ?? '', 10);
    if (Number.isInteger(parentPid) && parentPid > 1) {
        watchdogTimer = setInterval(() => {
            const currentParentPid = typeof process.ppid === 'number' ? process.ppid : parentPid;
            const parentChanged = currentParentPid > 1 && currentParentPid !== parentPid;
            let parentAlive = true;
            try {
                process.kill(parentPid, 0);
            } catch (err: any) {
                // EPERM / EACCES = process exists but we lack permission to signal it.
                // ESRCH = process does not exist. Only treat "not found" as dead.
                if (err.code === 'EPERM' || err.code === 'EACCES') {
                    parentAlive = true;
                } else {
                    parentAlive = false;
                }
            }
            if (parentChanged || !parentAlive) {
                void shutdown(`parent process ${parentPid} is gone`, 0);
            }
        }, PARENT_WATCH_INTERVAL_MS);
        watchdogTimer.unref?.();
    }

    const address = httpServer.address();
    const port = typeof address === 'object' && address ? address.port : opts.port;

    return {
        host: opts.host,
        port,
        path: mcpPath,
        close: () => shutdown('handle.close()'),
    };
}
