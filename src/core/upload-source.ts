/** Bounded, immutable upload staging. Bytes never enter tool arguments or the ledger. */
import { hashWriteBytes, hashWriteBytesAsync, hashWriteState } from './write-safety-hash';

export const MAX_TRANSFER_FILE_BYTES = 10 * 1024 * 1024;
export const UPLOAD_STAGE_TTL_MS = 10 * 60_000;
export interface UploadSource { fileName: string; bytes: Uint8Array; hash: string }
export interface UploadSourceReader { getUploadSource(id: string): UploadSource }

export function validateUploadName(name: unknown): asserts name is string {
    if (typeof name !== 'string' || !name || name.length > 255 || /[\x00-\x1f\x7f/\\"]/.test(name) || name === '.' || name === '..') {
        throw new Error('Invalid upload filename');
    }
}

export class UploadStagingStore {
    private entries = new Map<string, UploadSource & { expiresAt: number }>();
    constructor(private now = Date.now) {}
    private prune() {
        for (const [id, value] of this.entries) if (value.expiresAt <= this.now()) this.entries.delete(id);
    }
    stage(fileName: string, dataBase64: string) {
        this.prune();
        validateUploadName(fileName);
        if (typeof dataBase64 !== 'string' || dataBase64.length > Math.ceil(MAX_TRANSFER_FILE_BYTES / 3) * 4
            || /[^A-Za-z0-9+/=]/.test(dataBase64)) throw new Error('Invalid or oversized upload data (maximum 10 MiB)');
        const bytes = new Uint8Array(Buffer.from(dataBase64, 'base64'));
        if (bytes.byteLength > MAX_TRANSFER_FILE_BYTES || Buffer.from(bytes).toString('base64') !== dataBase64) throw new Error('Invalid or oversized upload data');
        return this.stageBytes(fileName, bytes);
    }
    stageBytes(fileName: string, value: Uint8Array) {
        this.prune();
        validateUploadName(fileName);
        if (value.byteLength > MAX_TRANSFER_FILE_BYTES) throw new Error('Upload exceeds 10 MiB');
        const bytes = value.slice();
        const hash = hashWriteBytes(bytes);
        return this.store(fileName, bytes, hash);
    }
    async stageBytesAsync(fileName: string, value: Uint8Array) {
        validateUploadName(fileName);
        if (value.byteLength > MAX_TRANSFER_FILE_BYTES) throw new Error('Upload exceeds 10 MiB');
        const bytes = value.slice();
        return this.store(fileName, bytes, await hashWriteBytesAsync(bytes));
    }

    private store(fileName: string, bytes: Uint8Array, hash: string) {
        this.prune();
        const uploadSource = hashWriteState({ fileName, hash }).split(':').pop()!;
        const expiresAt = this.now() + UPLOAD_STAGE_TTL_MS;
        if (!this.entries.has(uploadSource)) {
            let total = bytes.byteLength;
            for (const entry of this.entries.values()) total += entry.bytes.byteLength;
            if (this.entries.size >= 64 || total > 32 * 1024 * 1024) throw new Error('Upload staging is full; wait for expiry and repeat preflight');
        }
        this.entries.set(uploadSource, { fileName, bytes, hash, expiresAt });
        return { uploadSource, fileName, bytes: bytes.byteLength, sha256: hash, expiresAt };
    }
    lookup(fileName: string, hash: string, size: number) {
        validateUploadName(fileName);
        if (!/^sha256:v1:[a-f0-9]{64}$/.test(hash) || !Number.isInteger(size) || size < 0 || size > MAX_TRANSFER_FILE_BYTES) throw new Error('Invalid upload fingerprint');
        this.prune();
        const uploadSource = hashWriteState({ fileName, hash }).split(':').pop()!;
        const source = this.entries.get(uploadSource);
        if (!source || source.bytes.byteLength !== size) return undefined;
        source.expiresAt = this.now() + UPLOAD_STAGE_TTL_MS;
        return { uploadSource, fileName, bytes: size, sha256: hash, expiresAt: source.expiresAt };
    }
    getUploadSource(id: string): UploadSource {
        this.prune();
        const source = this.entries.get(id);
        if (!source) throw new Error('upload_source_expired: stage the file again and repeat preflight');
        // No caller can mutate the shared staged snapshot.
        return { ...source, bytes: source.bytes.slice() };
    }
}

export function getStagedUpload(client: unknown, id: string): UploadSource {
    const reader = client as Partial<UploadSourceReader>;
    if (typeof reader.getUploadSource !== 'function') throw new Error('uploadSource requires the kernel coordinator that staged the file');
    return reader.getUploadSource(id);
}
