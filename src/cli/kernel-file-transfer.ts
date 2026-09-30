/** Local filesystem access is intentional: caller-side upload/export transport only. */
import { nodeFs, nodePath } from '../core/node-loader';
import { MAX_TRANSFER_FILE_BYTES, validateUploadName } from '../core/upload-source';
import { hashWriteBytes } from '../core/write-safety-hash';
import type { CliWriteCoordinatorEndpoint } from '../core/write-coordinator-settings';

export async function stageKernelUpload(endpoint: CliWriteCoordinatorEndpoint, args: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (args.uploadSource || typeof args.localFilePath !== 'string') return args;
    const fs = nodeFs(), path = nodePath();
    const filePath = path.resolve(args.localFilePath);
    const handle = await fs.promises.open(filePath, 'r');
    let bytes: Uint8Array;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_TRANSFER_FILE_BYTES) throw new Error('Kernel upload requires a regular file of at most 10 MiB');
        // Read one extra byte to detect growth without allocating an unbounded file.
        const buffer = Buffer.alloc(MAX_TRANSFER_FILE_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
            const read = await handle.read(buffer, length, buffer.length - length, null);
            if (!read.bytesRead) break;
            length += read.bytesRead;
        }
        if (length > MAX_TRANSFER_FILE_BYTES) throw new Error('Kernel upload exceeds 10 MiB');
        bytes = buffer.subarray(0, length);
    } finally { await handle.close(); }
    const fileName = path.basename(filePath);
    validateUploadName(fileName);
    const url = new URL(endpoint.url);
    const digest = hashWriteBytes(bytes);
    const receiptValid = (value: any) => value && /^[a-f0-9]{64}$/.test(value.uploadSource)
        && value.sha256 === digest && value.bytes === bytes.byteLength && value.fileName === fileName;
    // Reuse only bytes already fingerprinted by the kernel. A claimed digest
    // alone can never create a staged source or authorize an asset write.
    let staged: any;
    const lookup = new URL(url); lookup.pathname = lookup.pathname.replace(/\/mcp\/?$/, '/transfer/lookup');
    try {
        const found = await fetch(lookup, { method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
            headers: { 'Content-Type': 'application/json', ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}) },
            body: JSON.stringify({ fileName, sha256: digest, bytes: bytes.byteLength }) });
        if (found.ok) { const receipt = await found.json(); if (receiptValid(receipt)) staged = receipt; }
        else await found.body?.cancel().catch(() => {});
    } catch { if (signal?.aborted) throw new Error('Upload cancelled'); }
    if (!staged) {
        url.pathname = url.pathname.replace(/\/mcp\/?$/, '/transfer/upload');
        const response = await fetch(url, {
            method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
            headers: { 'Content-Type': 'application/octet-stream', 'X-Sisyphus-File-Name': encodeURIComponent(fileName), ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}) },
            body: bytes as Uint8Array<ArrayBuffer>,
        });
        if (!response.ok) throw new Error(`Kernel upload staging failed: HTTP ${response.status}`);
        staged = await response.json();
        if (!receiptValid(staged)) throw new Error('Kernel upload staging digest mismatch');
    }
    const { localFilePath: _local, ...rest } = args;
    return { ...rest, uploadSource: staged.uploadSource };
}

export function isKernelExport(name: string, args: Record<string, unknown>): boolean {
    return ['file', 'siyuan_file'].includes(name) && (args.action === 'extract_doc' || (args.action === 'export_resources' && typeof args.outputPath === 'string'));
}

export { saveDownloadExport as saveKernelExport } from '../core/export-download';
