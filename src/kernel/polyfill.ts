/*
 * Side-effect module — must be imported first. Installs a minimal `process`
 * global so bundled modules that read process.env at module top-level do not
 * crash inside the goja sandbox.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { sha256 } from './sha256';

// SiYuan exposes goja_nodejs Buffer. Capture it before installing our fallback.
const nativeBuffer = typeof (globalThis as any).Buffer === 'function' ? (globalThis as any).Buffer : undefined;

const g = globalThis as {
    process?: { env: Record<string, string>; cwd: () => string; argv: string[] };
    TextEncoder?: any;
    TextDecoder?: any;
    crypto?: { getRandomValues?: (arr: Uint8Array) => Uint8Array; subtle?: unknown; randomUUID?: () => string };
    setTimeout?: (fn: () => void, ms?: number) => unknown;
    queueMicrotask?: (fn: () => void) => void;
};

if (typeof g.process === 'undefined' || g.process === null) {
    g.process = { env: {}, cwd: () => '/', argv: [] };
} else {
    if (typeof g.process.env !== 'object' || g.process.env === null) g.process.env = {};
    if (typeof g.process.cwd !== 'function') g.process.cwd = () => '/';
    if (!Array.isArray(g.process.argv)) g.process.argv = [];
}

/* ---------- TextEncoder / TextDecoder ----------
 * goja exposes neither. document-kramdown, canonical-state and
 * markdown-snapshot all call new TextEncoder().encode() to measure UTF-8
 * byte length, so without this every document read/write check throws
 * "TextEncoder is not defined". Pure-JS UTF-8 implementation.
 */

function utf8EncodeString(s: string): Uint8Array {
    if (nativeBuffer) return nativeBuffer.from(s, 'utf8');
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
        let cp = s.charCodeAt(i);
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
            const lo = s.charCodeAt(i + 1);
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

function utf8DecodeBytes(bytes: Uint8Array): string {
    if (nativeBuffer) return nativeBuffer.from(bytes).toString('utf8');
    let out = '';
    let i = 0;
    while (i < bytes.length) {
        const b = bytes[i];
        if (b < 0x80) { out += String.fromCharCode(b); i += 1; }
        else if ((b & 0xe0) === 0xc0) {
            const cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
            out += String.fromCharCode(cp); i += 2;
        } else if ((b & 0xf0) === 0xe0) {
            const cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
            out += String.fromCharCode(cp); i += 3;
        } else {
            let cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); i += 4;
        }
    }
    return out;
}

if (typeof g.TextEncoder === 'undefined') {
    g.TextEncoder = class TextEncoder {
        encode(input?: string): Uint8Array {
            return utf8EncodeString(input ?? '');
        }
        encodeInto(input: string, dest: Uint8Array) {
            const bytes = utf8EncodeString(input);
            const n = Math.min(bytes.length, dest.length);
            dest.set(bytes.subarray(0, n));
            return { read: n, written: n };
        }
        get encoding() { return 'utf-8'; }
    };
}
if (typeof g.TextDecoder === 'undefined') {
    g.TextDecoder = class TextDecoder {
        decode(input?: Uint8Array): string {
            return utf8DecodeBytes(input ?? new Uint8Array(0));
        }
        get encoding() { return 'utf-8'; }
        get fatal() { return false; }
        get ignoreBOM() { return false; }
    };
}

/* ---------- timers ----------
 * SiYuan supplies real timers through goja_nodejs/eventloop. The fallback
 * below exists only for minimal embedders; it must never replace host timers.
 */
if (typeof g.setTimeout === 'undefined') {
    g.setTimeout = ((fn: () => void) => { fn(); return 0; }) as any;
}
if (typeof g.queueMicrotask === 'undefined') {
    g.queueMicrotask = (fn: () => void) => { Promise.resolve().then(fn); };
}

/* ---------- crypto.subtle ----------
 * markdown-snapshot's hashSnapshotBytes uses crypto.subtle.digest('SHA-256').
 * goja has no WebCrypto; back it with the bundled pure-JS sha256 so document
 * reads/writes that canonicalize state still produce the same digest.
 */
if (typeof g.crypto === 'undefined' || g.crypto === null) {
    g.crypto = {} as any;
}
if (!g.crypto!.subtle) {
    g.crypto!.subtle = {
        async digest(_algo: string, data: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const out = sha256(bytes);
            return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
        },
    };
}
if (typeof g.crypto!.getRandomValues !== 'function') {
    // Deterministic-enough PRNG for IDs/leases inside the sandbox. Not a
    // security boundary — the kernel already authenticates the endpoint.
    let seed = 0x9e3779b9 ^ Date.now();
    g.crypto!.getRandomValues = (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
            arr[i] = seed & 0xff;
        }
        return arr;
    };
}

/* ---------- Buffer / base64 ----------
 * file(action="read_image") and analytics byte accounting touch Buffer.
 * Provide the small surface used in the codebase: byteLength, from(bytes)
 * .toString('base64'). Backed by the bundled UTF-8 codec + a manual base64
 * encoder (goja has no atob/btoa for binary).
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Encode(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
        out += B64[a >> 2];
        out += B64[((a & 3) << 4) | (i + 1 < bytes.length ? (b as number) >> 4 : 0)];
        out += i + 1 < bytes.length ? B64[((b as number & 15) << 2) | (i + 2 < bytes.length ? (c as number) >> 6 : 0)] : '=';
        out += i + 2 < bytes.length ? B64[(c as number) & 63] : '=';
    }
    return out;
}
function base64Decode(str: string): Uint8Array {
    const clean = str.replace(/[^A-Za-z0-9+/=]/g, '');
    const out: number[] = [];
    for (let i = 0; i < clean.length; i += 4) {
        const n = (B64.indexOf(clean[i]) << 18)
            | (B64.indexOf(clean[i + 1]) << 12)
            | ((clean[i + 2] === '=' ? 0 : B64.indexOf(clean[i + 2])) << 6)
            | (clean[i + 3] === '=' ? 0 : B64.indexOf(clean[i + 3]));
        out.push((n >> 16) & 0xff);
        if (clean[i + 2] !== '=') out.push((n >> 8) & 0xff);
        if (clean[i + 3] !== '=') out.push(n & 0xff);
    }
    return new Uint8Array(out);
}

class KernelBuffer extends Uint8Array {
    toString(encoding?: string): string {
        if (encoding === 'base64') return base64Encode(this);
        return utf8DecodeBytes(this);
    }
}

if (typeof (g as any).Buffer === 'undefined') {
    (g as any).Buffer = {
        byteLength(text: string, encoding?: string): number {
            if (encoding === 'base64' || encoding === 'base64url') {
                return base64Decode(text).length;
            }
            return utf8EncodeString(text).length;
        },
        from(data: unknown, encoding?: string): KernelBuffer {
            if (typeof data === 'string') {
                if (encoding === 'base64' || encoding === 'base64url') return KernelBuffer.from(base64Decode(data));
                return KernelBuffer.from(utf8EncodeString(data));
            }
            if (data instanceof Uint8Array) return KernelBuffer.from(data);
            if (Array.isArray(data)) return KernelBuffer.from(data);
            if (data && typeof data === 'object' && 'length' in (data as any)) {
                return KernelBuffer.from(Array.from(data as ArrayLike<number>));
            }
            return new KernelBuffer(0);
        },
        concat(chunks: Uint8Array[]): KernelBuffer {
            const total = chunks.reduce((n, c) => n + c.length, 0);
            const out = new KernelBuffer(total);
            let off = 0;
            for (const c of chunks) { out.set(c, off); off += c.length; }
            return out;
        },
        isBuffer(v: unknown): boolean { return v instanceof KernelBuffer; },
    };
}

export {};
