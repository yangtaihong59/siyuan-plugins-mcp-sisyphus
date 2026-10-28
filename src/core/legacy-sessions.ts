/**
 * Session policy for 2025-era (Mcp-Session-Id) clients, shared by the Node
 * HTTP transport and the kernel endpoint: bounded size, idle expiry, and
 * an unknown id is expired (HTTP 404) rather than silently re-created.
 */
export const LEGACY_SESSION_LIMIT = 256;
export const LEGACY_SESSION_IDLE_MS = 30 * 60_000;

/** Body sent with the 404 for an unknown or expired session id. */
export const LEGACY_SESSION_EXPIRED_BODY = { error: 'session_expired' } as const;

interface Slot<T> { entry: T; seen: number }

export class LegacySessionTable<T> {
    private readonly slots = new Map<string, Slot<T>>();

    constructor(
        /** Release resources of a session dropped by expiry, eviction or delete. */
        private readonly onDrop: (id: string, entry: T) => void = () => {},
        private readonly limit = LEGACY_SESSION_LIMIT,
        private readonly idleMs = LEGACY_SESSION_IDLE_MS,
    ) {}

    get size(): number { return this.slots.size; }

    /** Drop every session idle for longer than the expiry window. */
    sweep(now = Date.now()): void {
        for (const [id, slot] of this.slots) {
            if (now - slot.seen > this.idleMs) this.drop(id, slot);
        }
    }

    /** Live entry for an id, refreshing its idle clock. */
    touch(id: string, now = Date.now()): T | undefined {
        const slot = this.slots.get(id);
        if (!slot) return undefined;
        if (now - slot.seen > this.idleMs) {
            this.drop(id, slot);
            return undefined;
        }
        slot.seen = now;
        return slot.entry;
    }

    /** Live entry without refreshing it (e.g. an SSE liveness check). */
    peek(id: string, now = Date.now()): T | undefined {
        const slot = this.slots.get(id);
        return slot && now - slot.seen <= this.idleMs ? slot.entry : undefined;
    }

    add(id: string, entry: T, now = Date.now()): void {
        if (!this.slots.has(id) && this.slots.size >= this.limit) {
            const oldest = this.slots.keys().next().value as string;
            this.drop(oldest, this.slots.get(oldest)!);
        }
        this.slots.set(id, { entry, seen: now });
    }

    delete(id: string): void {
        const slot = this.slots.get(id);
        if (slot) this.drop(id, slot);
    }

    /** Forget an id whose resources are already released (no onDrop). */
    forget(id: string): void {
        this.slots.delete(id);
    }

    entries(): IterableIterator<[string, T]> {
        const iterator = this.slots.entries();
        return (function* () {
            for (const [id, slot] of iterator) yield [id, slot.entry] as [string, T];
        })();
    }

    private drop(id: string, slot: Slot<T>): void {
        this.slots.delete(id);
        this.onDrop(id, slot.entry);
    }
}
