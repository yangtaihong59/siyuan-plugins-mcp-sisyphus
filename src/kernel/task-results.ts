/** Bounded transport receipts, not a second write ledger. Reload clears these records. */
export class KernelTaskResults {
    private records = new Map<string, { expiresAt: number; bytes: number; access: string; value: any }>();
    constructor(private now = Date.now, private ttl = 600_000, private capacity = 128, private maxBytes = 8 * 1024 * 1024, private maxResultBytes = 1024 * 1024) {}
    private prune() { for (const [key, record] of this.records) if (record.expiresAt <= this.now()) this.records.delete(key); }
    snapshot() { this.prune(); return { records: this.records.size, bytes: [...this.records.values()].reduce((sum, r) => sum + r.bytes, 0), ttlMs: this.ttl, capacity: this.capacity, maxBytes: this.maxBytes, maxResultBytes: this.maxResultBytes }; }
    has(key: string) { this.prune(); return this.records.has(key); }
    save(key: string, result: any, access: string) {
        this.prune();
        const json = JSON.stringify(result);
        const bytes = new TextEncoder().encode(json).byteLength;
        const retained = bytes <= this.maxResultBytes && bytes <= this.maxBytes;
        const value = { state: 'done', resultAvailable: retained, ...(retained ? { result: JSON.parse(json) } : { reason: 'result_too_large' }) };
        const record = { expiresAt: this.now() + this.ttl, bytes: retained ? bytes : 0, access, value };
        this.records.delete(key);
        let total = [...this.records.values()].reduce((sum, r) => sum + r.bytes, 0);
        while (this.records.size && (this.records.size >= this.capacity || total + record.bytes > this.maxBytes)) {
            const oldest = this.records.keys().next().value!;
            total -= this.records.get(oldest)!.bytes; this.records.delete(oldest);
        }
        this.records.set(key, record);
    }
    get(key: string, access: string, includeResult = false) {
        this.prune();
        const record = this.records.get(key);
        if (!record) return undefined;
        if (record.access !== access) return { state: 'done', resultAvailable: false, reason: 'access_changed' };
        const { result, ...status } = record.value;
        return { ...status, expiresAt: record.expiresAt, ...(includeResult && result !== undefined ? { result: JSON.parse(JSON.stringify(result)) } : {}) };
    }
}
