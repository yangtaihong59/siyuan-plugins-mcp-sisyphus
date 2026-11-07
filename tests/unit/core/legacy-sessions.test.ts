import { describe, expect, it, vi } from 'vitest';

import { LegacySessionTable, normalizeSessionIdleMinutes, MAX_SESSION_IDLE_MINUTES } from '@/core/legacy-sessions';

describe('legacy session policy', () => {
    it('keeps default sessions beyond 30 minutes and expires after 24 idle hours', () => {
        const table = new LegacySessionTable<string>();
        table.add('a', 'A', 0);
        expect(table.peek('a', 31 * 60_000)).toBe('A');
        expect(table.peek('a', 24 * 60 * 60_000)).toBe('A');
        expect(table.touch('a', 24 * 60 * 60_000 + 1)).toBeUndefined();
    });

    it('disables expiry in sweep, peek and touch but keeps the capacity limit', () => {
        const table = new LegacySessionTable<string>(undefined, 2);
        table.configureIdleTimeout(0);
        table.add('a', 'A', 0);
        table.add('b', 'B', 0);
        const now = 400 * 24 * 60 * 60_000;
        table.sweep(now);
        expect(table.peek('a', now)).toBe('A');
        expect(table.touch('a', now)).toBe('A');
        table.add('c', 'C', now);
        expect(table.peek('a', now)).toBeUndefined();
        expect(table.size).toBe(2);
    });

    it('applies changed timeout to existing sessions without resetting their idle clock', () => {
        const table = new LegacySessionTable<string>();
        table.add('a', 'A', 0);
        table.configureIdleTimeout(120);
        expect(table.peek('a', 119 * 60_000)).toBe('A');
        table.sweep(121 * 60_000);
        expect(table.size).toBe(0);
    });

    it('normalizes missing, invalid, disabled and bounded timeout settings', () => {
        for (const raw of [undefined, null, '', '30', NaN, Infinity, -1]) {
            expect(normalizeSessionIdleMinutes(raw)).toBe(1440);
        }
        expect(normalizeSessionIdleMinutes(0)).toBe(0);
        expect(normalizeSessionIdleMinutes(0.5)).toBe(1);
        expect(normalizeSessionIdleMinutes(120)).toBe(120);
        expect(normalizeSessionIdleMinutes(1e9)).toBe(MAX_SESSION_IDLE_MINUTES);
    });

    it('evicts the oldest session at the limit and releases it', () => {
        const dropped = vi.fn();
        const table = new LegacySessionTable<string>(dropped, 2, 1000);
        table.add('a', 'A', 0);
        table.add('b', 'B', 0);
        table.add('c', 'C', 0);
        expect(table.peek('a', 0)).toBeUndefined();
        expect(dropped).toHaveBeenCalledWith('a', 'A');
        expect(table.size).toBe(2);
    });

    it('expires idle sessions, while touching keeps them alive', () => {
        const dropped = vi.fn();
        const table = new LegacySessionTable<string>(dropped, 10, 1000);
        table.add('a', 'A', 0);
        table.add('b', 'B', 0);
        expect(table.touch('a', 900)).toBe('A');
        table.sweep(1500);
        expect(table.peek('a', 1500)).toBe('A');
        expect(table.peek('b', 1500)).toBeUndefined();
        expect(dropped).toHaveBeenCalledWith('b', 'B');
        expect(table.touch('a', 3000)).toBeUndefined();
    });

    it('forgets without releasing when the transport already closed itself', () => {
        const dropped = vi.fn();
        const table = new LegacySessionTable<string>(dropped);
        table.add('a', 'A');
        table.forget('a');
        expect(table.size).toBe(0);
        expect(dropped).not.toHaveBeenCalled();
    });
});
