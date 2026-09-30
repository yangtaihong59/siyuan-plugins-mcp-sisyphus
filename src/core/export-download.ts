/** Shared Node/CLI local export exception: stream into exclusively owned destinations. */
import { nodeFs, nodePath, nodeCrypto } from './node-loader';
import { validateUploadName } from './upload-source';
import { hashWriteBytes } from './write-safety-hash';
import type { SiYuanClient } from '../api/client';
import type { ToolResult } from '../tools/internal/shared';

function relativeAsset(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Invalid asset path');
    const decoded = decodeURIComponent(value);
    if (!decoded || /[\\\x00-\x1f\x7f:?#]/.test(decoded) || decoded.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe asset path in export');
    return decoded;
}

function writeExclusive(path: string, bytes: Uint8Array) {
    const fs = nodeFs();
    const fd = fs.openSync(path, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); }
    catch (error) { fs.closeSync(fd); fs.unlinkSync(path); throw error; }
    fs.closeSync(fd);
    return { bytes: bytes.byteLength, sha256: hashWriteBytes(bytes) };
}

async function downloadExclusive(client: SiYuanClient, remote: string, target: string, signal?: AbortSignal, maxBytes?: number) {
    const fs = nodeFs();
    const handle = await fs.promises.open(target, 'wx', 0o600);
    const hash = nodeCrypto().createHash('sha256');
    try {
        const bytes = await client.streamFile(remote, async chunk => {
            let offset = 0;
            while (offset < chunk.byteLength) {
                const written = await handle.write(chunk, offset, chunk.byteLength - offset);
                if (!written.bytesWritten) throw new Error('Export file write made no progress');
                offset += written.bytesWritten;
            }
            hash.update(chunk);
        }, { signal, maxBytes });
        await handle.close();
        return { bytes, sha256: `sha256:v1:${hash.digest('hex')}` };
    } catch (error) {
        await handle.close().catch(() => {});
        await fs.promises.unlink(target).catch(() => {});
        throw error;
    }
}

export async function saveDownloadExport(client: SiYuanClient, args: Record<string, unknown>, result: ToolResult, signal?: AbortSignal): Promise<ToolResult> {
    if (result.isError || args.validateOnly === true) return result;
    const payload: any = result.structuredContent ?? JSON.parse(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
    if (payload.success === false || payload.delivery !== 'download') throw new Error('Export did not return a complete download manifest');
    const fs = nodeFs(), path = nodePath();
    let saved: Record<string, unknown>;
    if (args.action === 'export_resources') {
        const downloadPath = typeof payload.downloadPath === 'string' ? '/' + decodeURIComponent(payload.downloadPath).replace(/^\/+/, '') : payload.downloadPath;
        if (typeof downloadPath !== 'string' || !downloadPath.startsWith('/temp/') || /[\\\x00-\x1f]/.test(downloadPath) || downloadPath.split('/').includes('..')) throw new Error('Invalid export download path');
        const outputPath = path.resolve(String(args.outputPath));
        if (fs.existsSync(outputPath)) throw new Error('Export destination already exists; choose another outputPath');
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        saved = { ...payload, outputPath, ...await downloadExclusive(client, downloadPath, outputPath, signal) };
    } else {
        if (payload.docId !== args.id || typeof payload.markdown !== 'string' || !Array.isArray(payload.assets)) throw new Error('Invalid document export manifest');
        validateUploadName(payload.docName);
        const assets = [...new Set<string>(payload.assets.map((asset: any) => {
            if (asset.error) throw new Error('Document contains unreadable assets');
            return relativeAsset(asset.path);
        }))];
        const outputRoot = path.resolve(typeof args.outputDir === 'string' ? args.outputDir : path.join(process.env.HOME || process.env.USERPROFILE || '', 'siyuan-extracted'));
        fs.mkdirSync(outputRoot, { recursive: true });
        // An owned, fresh directory prevents traversal through pre-existing asset symlinks.
        const suffix = String(args.id).slice(-7);
        if (!/^[a-zA-Z0-9_-]+$/.test(suffix)) throw new Error('Invalid document ID in export');
        const extractedDir = path.join(outputRoot, `${payload.docName}-${suffix}`);
        fs.mkdirSync(extractedDir);
        const files: Array<Record<string, unknown>> = [];
        try {
            const docMdFile = `${payload.docName}.md`;
            files.push({ path: docMdFile, ...writeExclusive(path.join(extractedDir, docMdFile), new TextEncoder().encode(payload.markdown)) });
            let remaining = 512 * 1024 * 1024 - new TextEncoder().encode(payload.markdown).byteLength;
            if (remaining < 0) throw new Error('Export exceeds 512 MiB');
            for (const asset of assets) {
                const target = path.join(extractedDir, 'assets', asset);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                const downloaded = await downloadExclusive(client, `/data/assets/${asset}`, target, signal, remaining);
                remaining -= downloaded.bytes;
                files.push({ path: `assets/${asset}`, ...downloaded });
            }
            saved = { success: true, transport: payload.transport ?? 'kernel', outputRoot, extractedDir, docMdFile, extractedAssetCount: assets.length, skippedAssetCount: 0, structure: files.map(file => file.path), defaultOutputDirUsed: typeof args.outputDir !== 'string', hint: typeof args.outputDir !== 'string' ? 'Saved under ~/siyuan-extracted/; existing targets are never overwritten.' : 'Saved under outputDir; existing targets are never overwritten.', files, safety: payload.safety };
        } catch (error) {
            fs.rmSync(extractedDir, { recursive: true, force: true });
            throw error;
        }
    }
    return { ...result, content: [{ type: 'text', text: JSON.stringify(saved) }], structuredContent: saved };
}
