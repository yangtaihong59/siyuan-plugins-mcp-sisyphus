import type { SiYuanClient } from '../api/client';
import { hashWriteState } from './write-safety-hash';
import type { ToolCategory } from './config';

export const WRITE_SAFETY_LEDGER_PATH = '/data/storage/petal/siyuan-plugins-mcp-sisyphus/writeSafetyLedger';
export const WRITE_SAFETY_LEDGER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WRITE_SAFETY_LEDGER_MAX_ENTRIES = 2048;

export type WriteLedgerState =
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
}

export class WriteSafetyLedger {
    private readonly client: SiYuanClient;
    private loaded = false;
    private entries = new Map<string, WriteLedgerEntry>();
    private serial: Promise<void> = Promise.resolve();

    constructor(client: SiYuanClient) {
        this.client = client;
    }

    async inspect(
        requestId: string,
        tool: ToolCategory,
        action: string,
        args: Record<string, unknown>,
    ): Promise<{ argsHash: string; entry?: WriteLedgerEntry }> {
        assertFreshUuidV7(requestId);
        await this.ensureLoaded();
        const argsHash = hashWriteState(stripSafetyFields(args));
        const entry = this.entries.get(requestId);
        if (!entry) return { argsHash };
        if (entry.tool !== tool || entry.action !== action || entry.argsHash !== argsHash) {
            throw safetyError(
                'idempotency_conflict',
                `requestId ${requestId} has already been used for a different operation.`,
            );
        }
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
                for (const entry of parsed.entries) {
                    if (isLedgerEntry(entry)) this.entries.set(entry.requestId, entry);
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
            if (now - entry.createdAt > WRITE_SAFETY_LEDGER_TTL_MS) this.entries.delete(requestId);
        }
    }

    private async persist(): Promise<void> {
        const payload: LedgerFile = {
            version: 1,
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

function assertFreshUuidV7(requestId: string): void {
    const match = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(requestId);
    if (!match) {
        throw safetyError('invalid_request_id', 'requestId must be a UUIDv7 value.');
    }
    const timestamp = Number.parseInt(`${match[1]}${match[2]}`, 16);
    const age = Date.now() - timestamp;
    if (!Number.isFinite(timestamp) || age > WRITE_SAFETY_LEDGER_TTL_MS || age < -5 * 60 * 1000) {
        throw safetyError('request_id_expired', 'requestId timestamp is expired or unreasonably far in the future.');
    }
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
