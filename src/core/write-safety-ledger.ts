import { randomBytes } from 'node:crypto';
import { WRITE_PREFLIGHT_LEASE_TTL_MS } from './write-preflight-lease';
import type { SiYuanClient } from '../api/client';
import { hashWriteState } from './write-safety-hash';
import type { ToolCategory } from './config';

export const WRITE_SAFETY_LEDGER_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/writeSafetyLedger';
export const WRITE_SAFETY_LEDGER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WRITE_SAFETY_LEDGER_MAX_ENTRIES = 2048;

export type WriteLedgerState =
    | 'issued'
    | 'preparing'
    | 'executing'
    | 'committed'
    | 'unknown'
    | 'failed_before_execute';

export interface WriteLedgerEntry {
    requestId: string;
    tool: ToolCategory;
    action: string;
    argsHash: string;
    targetIds: string[];
    state: WriteLedgerState;
    createdAt: number;
    updatedAt: number;
    result?: Record<string, unknown>;
}

interface LedgerFile {
    version: 1;
    entries: WriteLedgerEntry[];
    reservedRequestIds?: string[];
}

export class WriteSafetyLedger {
    private readonly client: SiYuanClient;
    private loaded = false;
    // Never recycle an issued short ID, even after its result expires.
    private reservedRequestIds = new Set<string>();
    private entries = new Map<string, WriteLedgerEntry>();
    private serial: Promise<void> = Promise.resolve();

    constructor(client: SiYuanClient) {
        this.client = client;
    }

    async issue(tool: ToolCategory, action: string, args: Record<string, unknown>): Promise<{ requestId: string; requestIdExpiresAt: number }> {
        return this.exclusive(async () => {
            await this.ensureLoaded();
            const now = Date.now();
            this.prune(now);
            if (this.entries.size >= WRITE_SAFETY_LEDGER_MAX_ENTRIES) {
                throw safetyError('write_ledger_capacity', 'The write-safety ledger is full. No write was attempted.');
            }
            const digest = randomBytes(32).toString('hex');
            let length = 4;
            while (length <= digest.length && this.reservedRequestIds.has(digest.slice(0, length))) length += 1;
            if (length > digest.length) throw safetyError('request_id_collision', 'Could not issue a unique requestId. Run preflight again.');
            const requestId = digest.slice(0, length);
            this.reservedRequestIds.add(requestId);
            this.entries.set(requestId, {
                requestId, tool, action, argsHash: hashWriteState(stripSafetyFields(args)),
                targetIds: [], state: 'issued', createdAt: now, updatedAt: now,
            });
            try {
                await this.persist();
            } catch (error) {
                this.entries.delete(requestId);
                throw error;
            }
            return { requestId, requestIdExpiresAt: now + WRITE_PREFLIGHT_LEASE_TTL_MS };
        });
    }

    async inspect(
        requestId: string,
        tool: ToolCategory,
        action: string,
        args: Record<string, unknown>,
    ): Promise<{ argsHash: string; entry?: WriteLedgerEntry }> {
        if (!/^[a-f0-9]{4,64}$/.test(requestId)) {
            throw safetyError('invalid_request_id', 'Copy the complete server-issued requestId from validateOnly preflight.');
        }
        await this.ensureLoaded();
        this.prune(Date.now());
        const argsHash = hashWriteState(stripSafetyFields(args));
        const entry = this.entries.get(requestId);
        if (!entry) throw safetyError('request_id_expired', 'requestId is unknown or expired. Run validateOnly preflight again.');
        // Older render requests were hashed before avID -> id normalization.
        // Only equivalent, unambiguous old shapes may reuse a persisted request.
        let matchesArgs = entry.argsHash === argsHash;
        if (!matchesArgs && tool === 'av' && action === 'render' && typeof args.avID === 'string') {
            const legacy = stripSafetyFields(args);
            delete legacy.avID;
            legacy.id = args.avID;
            matchesArgs = entry.argsHash === hashWriteState(legacy)
                || entry.argsHash === hashWriteState({ ...legacy, avID: args.avID });
        }
        if (entry.tool !== tool || entry.action !== action || !matchesArgs) {
            throw safetyError(
                'idempotency_conflict',
                `requestId ${requestId} has already been used for a different operation.`,
            );
        }
        if (entry.state === 'issued') return { argsHash };
        return { argsHash, entry: { ...entry, targetIds: [...entry.targetIds] } };
    }

    async record(
        entry: Omit<WriteLedgerEntry, 'createdAt' | 'updatedAt'> & Partial<Pick<WriteLedgerEntry, 'createdAt'>>,
    ): Promise<WriteLedgerEntry> {
        return this.exclusive(async () => {
            await this.ensureLoaded();
            const now = Date.now();
            this.prune(now);
            const previous = this.entries.get(entry.requestId);
            if (!previous && this.entries.size >= WRITE_SAFETY_LEDGER_MAX_ENTRIES) {
                throw safetyError(
                    'write_ledger_capacity',
                    'The write-safety ledger is full and has no expired records. No write was attempted.',
                );
            }
            const next: WriteLedgerEntry = {
                ...entry,
                targetIds: [...entry.targetIds].sort(),
                createdAt: entry.createdAt ?? previous?.createdAt ?? now,
                updatedAt: now,
            };
            this.entries.set(next.requestId, next);
            try {
                await this.persist();
            } catch (error) {
                if (previous) this.entries.set(previous.requestId, previous);
                else this.entries.delete(next.requestId);
                throw error;
            }
            return { ...next, targetIds: [...next.targetIds] };
        });
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        try {
            const raw = await this.client.readFile(WRITE_SAFETY_LEDGER_PATH);
            if (raw.trim()) {
                const parsed = JSON.parse(raw) as Partial<LedgerFile> | FileApiErrorEnvelope;
                // SiYuan's /api/file/getFile reports a missing file as HTTP
                // 202 with a JSON error envelope instead of HTTP 404. The
                // generic readFile() intentionally returns the raw body, so a
                // brand-new ledger must recognize that envelope as "empty".
                if (isMissingFileEnvelope(parsed)) {
                    this.prune(Date.now());
                    this.loaded = true;
                    return;
                }
                if (isFileApiErrorEnvelope(parsed)) {
                    throw new Error(`SiYuan file API error: ${parsed.code} - ${parsed.msg}`);
                }
                if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
                    throw new Error('Unsupported or malformed write-safety ledger.');
                }
                if (parsed.reservedRequestIds !== undefined && (!Array.isArray(parsed.reservedRequestIds)
                    || parsed.reservedRequestIds.some(id => typeof id !== 'string'))) {
                    throw new Error('Malformed request ID reservations.');
                }
                this.reservedRequestIds = new Set(parsed.reservedRequestIds ?? []);
                for (const entry of parsed.entries) {
                    if (isLedgerEntry(entry)) {
                        this.entries.set(entry.requestId, entry);
                        this.reservedRequestIds.add(entry.requestId);
                    }
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/HTTP error: 404|not found|does not exist/i.test(message)) {
                throw safetyError('write_ledger_unavailable', `Cannot load the write-safety ledger: ${message}`);
            }
        }
        this.prune(Date.now());
        this.loaded = true;
    }

    private prune(now: number): void {
        for (const [requestId, entry] of this.entries) {
            if (now - entry.createdAt >= (entry.state === 'issued' ? WRITE_PREFLIGHT_LEASE_TTL_MS : WRITE_SAFETY_LEDGER_TTL_MS)) this.entries.delete(requestId);
        }
    }

    private async persist(): Promise<void> {
        const payload: LedgerFile = {
            version: 1,
            reservedRequestIds: [...this.reservedRequestIds],
            entries: [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt),
        };
        await this.client.writeFile(WRITE_SAFETY_LEDGER_PATH, JSON.stringify(payload));
    }

    private async exclusive<T>(work: () => Promise<T>): Promise<T> {
        const previous = this.serial;
        let release!: () => void;
        this.serial = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
            return await work();
        } finally {
            release();
        }
    }
}

interface FileApiErrorEnvelope {
    code: number;
    msg: string;
    data?: unknown;
}

function isFileApiErrorEnvelope(value: unknown): value is FileApiErrorEnvelope {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Partial<FileApiErrorEnvelope>;
    return typeof envelope.code === 'number' && typeof envelope.msg === 'string';
}

function isMissingFileEnvelope(value: unknown): value is FileApiErrorEnvelope {
    return isFileApiErrorEnvelope(value)
        && (value.code === 404 || /not found|does not exist/i.test(value.msg));
}

export function stripSafetyFields(args: Record<string, unknown>): Record<string, unknown> {
    const out = { ...args };
    delete out.requestId;
    delete out.validateOnly;
    delete out.expectedHash;
    delete out.expectedStateHash;
    delete out.expectedStructureHash;
    delete out.expectedValueHash;
    delete out.expectedManifestHash;
    delete out.expectedSourceHash;
    return out;
}

export function safetyError(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { name: 'WriteSafetyError', code });
}

function isLedgerEntry(value: unknown): value is WriteLedgerEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<WriteLedgerEntry>;
    return typeof entry.requestId === 'string'
        && typeof entry.tool === 'string'
        && typeof entry.action === 'string'
        && typeof entry.argsHash === 'string'
        && Array.isArray(entry.targetIds)
        && typeof entry.state === 'string'
        && typeof entry.createdAt === 'number'
        && typeof entry.updatedAt === 'number';
}
