import { describe, expect, it, vi } from 'vitest';

import { LegacySessionTable } from '@/core/legacy-sessions';

describe('legacy session policy', () => {
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
