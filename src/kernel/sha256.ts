/*
 * Pure-JS SHA-256 for the goja sandbox (no Node crypto available).
 * Compact implementation operating on Uint8Array, ES2017-compatible.
 */

const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
}

/** Incremental SHA-256 retains only one partial block and the compression state. */
export class Sha256 {
    private state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    private block = new Uint8Array(64);
    private used = 0;
    private length = 0;
    private finished = false;
    private words = new Int32Array(64);
    update(data: Uint8Array): this {
        if (this.finished) throw new Error('Hash already finalized');
        this.length += data.length;
        let offset = 0;
        if (this.used) {
            const take = Math.min(64 - this.used, data.length);
            this.block.set(data.subarray(0, take), this.used);
            this.used += take; offset += take;
            if (this.used === 64) { this.compress(this.block); this.used = 0; }
        }
        const end = data.length - ((data.length - offset) % 64);
        if (end > offset) { this.compress(data.subarray(offset, end)); offset = end; }
        if (offset < data.length) { this.block.set(data.subarray(offset), 0); this.used = data.length - offset; }
        return this;
    }
    digest(): Uint8Array {
        if (this.finished) throw new Error('Hash already finalized');
        this.finished = true;
        const padded = new Uint8Array(this.used < 56 ? 64 : 128);
        padded.set(this.block.subarray(0, this.used)); padded[this.used] = 0x80;
        const dv = new DataView(padded.buffer);
        const bits = this.length * 8;
        dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000), false);
        dv.setUint32(padded.length - 4, bits >>> 0, false);
        this.compress(padded);
        const out = new Uint8Array(32), view = new DataView(out.buffer);
        this.state.forEach((value, i) => view.setUint32(i * 4, value >>> 0, false));
        return out;
    }
    private compress(bytes: Uint8Array) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), w = this.words;
        let [h0, h1, h2, h3, h4, h5, h6, h7] = this.state;
        for (let off = 0; off < bytes.length; off += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = dv.getInt32(off + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
        }
        this.state = [h0, h1, h2, h3, h4, h5, h6, h7];
    }
}

export function sha256(data: Uint8Array): Uint8Array { return new Sha256().update(data).digest(); }

export function sha256Hex(data: Uint8Array): string {
    const bytes = sha256(data);
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
        s += bytes[i].toString(16).padStart(2, '0');
    }
    return s;
}

export function sha256HexOfString(text: string): string {
    // UTF-8 encode without TextEncoder dependency assumptions
    const encoded = utf8Encode(text);
    return sha256Hex(encoded);
}

function utf8Encode(s: string): Uint8Array {
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
