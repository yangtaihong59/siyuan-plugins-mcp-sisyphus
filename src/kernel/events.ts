interface Port { send(event: { event: string; data: unknown }): void; close(): void; onopen?: () => void; onclose?: () => void }
/** Small coalesced notifications only; never stream tool bodies into the host's unbounded SSE queue. */
export class KernelEvents {
    private connections = new Map<Port, { owner: string; session: string; expiresAt: number }>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private fingerprint: string | undefined;
    private generation = 0;
    snapshot() { return { connections: this.connections.size, maxConnections: 64, perOwner: 4, pollMs: this.interval, connectionTtlMs: 600_000 }; }
    constructor(private inspect: () => Promise<string>, private valid: (owner: string, session: string) => boolean, private interval = 5000) {}
    async attach(port: Port, owner: string, session: string) {
        if (this.connections.size >= 64 || [...this.connections.values()].filter(c => c.owner === owner).length >= 4) throw new Error('SSE connection capacity reached');
        const fingerprint = await this.inspect();
        if (this.connections.size >= 64 || [...this.connections.values()].filter(c => c.owner === owner).length >= 4) throw new Error('SSE connection capacity reached');
        if (!this.connections.size) this.fingerprint = fingerprint;
        this.connections.set(port, { owner, session, expiresAt: Date.now() + 600_000 });
        port.onclose = () => {
            this.connections.delete(port);
            if (!this.connections.size) { clearTimeout(this.timer); this.timer = undefined; this.fingerprint = undefined; this.generation++; }
        };
        port.onopen = () => {
            // Harmless initial invalidation also refreshes caches after a reconnect.
            this.send(port);
            if (!this.timer) this.schedule();
        };
    }
    private send(port: Port) {
        try { port.send({ event: 'message', data: { jsonrpc: '2.0', method: 'notifications/tools/list_changed' } }); }
        catch { port.close(); port.onclose?.(); }
    }
    private schedule() { this.timer = setTimeout(() => { void this.poll(); }, this.interval); }
    private async poll() {
        const generation = this.generation;
        try {
            for (const [port, c] of this.connections) if (c.expiresAt <= Date.now() || !this.valid(c.owner, c.session)) { port.close(); port.onclose?.(); }
            if (!this.connections.size) return;
            const fingerprint = await this.inspect();
            if (generation !== this.generation) return;
            if (this.fingerprint !== undefined && fingerprint !== this.fingerprint) for (const port of this.connections.keys()) this.send(port);
            this.fingerprint = fingerprint;
        } catch {
            // Fail closed if current endpoint configuration cannot be inspected.
            for (const port of [...this.connections.keys()]) { port.close(); port.onclose?.(); }
        } finally {
            if (generation === this.generation && this.connections.size) this.schedule();
        }
    }
}
