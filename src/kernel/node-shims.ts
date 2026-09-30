/*
 * goja-compatible replacements for the Node builtin indirection layer
 * (src/core/node-loader.ts). Bundled only in the kernel BUILD_TARGET.
 *
 * - nodeFs(): file-system access is unavailable in the kernel sandbox.
 *   The only caller paths (file.upload_asset source precondition, file
 *   export/extract writes) fail with a clear error — kernel mode cannot
 *   reach the host filesystem by design.
 * - nodePath(): a pure-JS POSIX path implementation covering the surface
 *   used by src/tools (basename, join, resolve, isAbsolute, dirname, extname,
 *   normalize, relative, sep, posix passthrough).
 * - nodeCrypto(): createHash('sha256') via the bundled pure-JS sha256;
 *   randomBytes/randomUUID via crypto.getRandomValues when present.
 */

import { Sha256 } from './sha256';

/* ---------- fs ---------- */

function unavailable(name: string): never {
    throw new Error(
        `kernel sandbox: node:fs '${name}' is unavailable. ` +
        'Operations requiring host filesystem access are not supported by the kernel coordinator endpoint.',
    );
}

const fsHandler: ProxyHandler<object> = {
    get(_t, prop) {
        if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
        return unavailable('fs.' + String(prop));
    },
};

const fsShim = new Proxy({}, fsHandler) as never;

/* ---------- path (POSIX) ---------- */

function normalizePath(p: string): string {
    const isAbs = p.startsWith('/');
    const parts = p.split('/').filter((s) => s.length > 0 && s !== '.');
    const out: string[] = [];
    for (const seg of parts) {
        if (seg === '..') {
            if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
            else if (!isAbs) out.push('..');
        } else {
            out.push(seg);
        }
    }
    const joined = out.join('/');
    const res = (isAbs ? '/' : '') + joined;
    return res === '' ? (isAbs ? '/' : '.') : res;
}

const posixPath = {
    sep: '/' as const,
    delimiter: ':' as const,
    normalize: (p: string) => normalizePath(p),
    join: (...parts: string[]) => normalizePath(parts.filter((s) => s && s.length > 0).join('/')),
    resolve: (...parts: string[]) => {
        // resolve right-to-left until an absolute path is found
        let resolved = '';
        for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i];
            if (!part) continue;
            resolved = resolved ? part + '/' + resolved : part;
            if (part.startsWith('/')) return normalizePath(resolved);
        }
        return normalizePath('/' + resolved);
    },
    isAbsolute: (p: string) => p.startsWith('/'),
    basename: (p: string, ext?: string) => {
        const base = p.split('/').filter(Boolean).pop() ?? '';
        if (ext && base.endsWith(ext)) return base.slice(0, base.length - ext.length);
        return base;
    },
    dirname: (p: string) => {
        const idx = p.lastIndexOf('/');
        if (idx <= 0) return p.startsWith('/') ? '/' : '.';
        return p.slice(0, idx);
    },
    extname: (p: string) => {
        const base = p.split('/').pop() ?? '';
        const idx = base.lastIndexOf('.');
        return idx > 0 ? base.slice(idx) : '';
    },
    relative: (from: string, to: string) => {
        const fromParts = normalizePath(from).split('/').filter(Boolean);
        const toParts = normalizePath(to).split('/').filter(Boolean);
        let i = 0;
        while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
        const ups = fromParts.length - i;
        const rest = toParts.slice(i);
        return [...new Array(ups).fill('..'), ...rest].join('/') || '.';
    },
};

const pathShim = Object.assign(posixPath, { posix: posixPath }) as never;

/* ---------- crypto ---------- */

function toBytes(data: unknown, encoding?: string): Uint8Array {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') {
        if (encoding === 'hex') {
            const out = new Uint8Array(data.length / 2);
            for (let i = 0; i < out.length; i++) out[i] = parseInt(data.slice(i * 2, i * 2 + 2), 16);
            return out;
        }
        // Native goja Buffer avoids a boxed JS number per UTF-8 byte on large templates.
        if (typeof (globalThis as any).Buffer === 'function') return (globalThis as any).Buffer.from(data, 'utf8');
        // utf8 fallback for minimal sandboxes
        const out: number[] = [];
        for (let i = 0; i < data.length; i++) {
            let cp = data.charCodeAt(i);
            if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < data.length) {
                const lo = data.charCodeAt(i + 1);
                if (lo >= 0xdc00 && lo <= 0xdfff) {
                    cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                    i++;
                }
            }
            if (cp < 0x80) out.push(cp);
            else if (cp < 0x800) { out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)); }
            else if (cp < 0x10000) { out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
            else { out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
        }
        return new Uint8Array(out);
    }
    if (Array.isArray(data)) return new Uint8Array(data as number[]);
    // goja ArrayBuffer
    const ab = data as { byteLength?: number };
    if (ab && typeof ab.byteLength === 'number') return new Uint8Array(data as ArrayBuffer);
    return new Uint8Array(0);
}

function bytesToHex(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
}

class HashShim {
    private hash = new Sha256();
    update(data: unknown, encoding?: string): this {
        this.hash.update(toBytes(data, encoding));
        return this;
    }
    digest(encoding?: string): string | Uint8Array {
        const hash = this.hash.digest();
        if (encoding === 'hex' || !encoding) return bytesToHex(hash);
        return hash;
    }
}

function getRandomValues(size: number): Uint8Array {
    const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
    if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
        const arr = new Uint8Array(size);
        return g.crypto.getRandomValues(arr);
    }
    // Fallback: not cryptographically secure, but only used for idempotency keys.
    const arr = new Uint8Array(size);
    for (let i = 0; i < size; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
}

const cryptoFacade = {
    createHash: (algorithm: string) => {
        if (algorithm !== 'sha256') return unavailable('crypto.createHash(' + algorithm + ')');
        return new HashShim();
    },
    randomBytes: (size: number) => ({
        toString: (enc?: string) => (enc === 'hex' ? bytesToHex(getRandomValues(size)) : bytesToHex(getRandomValues(size))),
        buffer: getRandomValues(size),
    }),
    randomUUID: () => {
        const b = getRandomValues(16);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = bytesToHex(b);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
};

/* ---------- exports matching node-loader.ts ---------- */

export function nodeFs(): typeof fsShim { return fsShim; }
export function nodePath(): typeof pathShim { return pathShim; }
export function nodeCrypto(): typeof cryptoFacade { return cryptoFacade; }

export function randomUUID(): string { return cryptoFacade.randomUUID(); }
