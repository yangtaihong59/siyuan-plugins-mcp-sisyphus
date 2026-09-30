import { afterEach, expect, it, vi } from 'vitest';
import { KernelEvents } from '@/kernel/events';
afterEach(() => { vi.useRealTimers(); });
const port = () => ({ send: vi.fn(), close: vi.fn(), onopen: undefined as (() => void) | undefined, onclose: undefined as (() => void) | undefined });
it('invalidates on reconnect and config changes, coalesces unchanged polls and releases timers', async () => {
    vi.useFakeTimers(); let revision = 'a';
    const inspect = vi.fn(async () => revision);
    const events = new KernelEvents(inspect, () => true, 10); const p = port();
    await events.attach(p, 'owner', 'session'); p.onopen!(); expect(p.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10); expect(p.send).toHaveBeenCalledTimes(1);
    revision = 'b'; await vi.advanceTimersByTimeAsync(10); expect(p.send).toHaveBeenCalledTimes(2);
    p.onclose!(); const count = inspect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100); expect(inspect).toHaveBeenCalledTimes(count);
});
it('limits connections per owner and closes revoked/expired sessions', async () => {
    vi.useFakeTimers(); let valid = true; const events = new KernelEvents(async () => 'a', () => valid, 10);
    const ports = Array.from({ length: 4 }, port);
    for (const p of ports) { await events.attach(p, 'a', 's'); p.onopen!(); }
    await expect(events.attach(port(), 'a', 's')).rejects.toThrow('capacity');
    valid = false; await vi.advanceTimersByTimeAsync(10);
    for (const p of ports) expect(p.close).toHaveBeenCalledOnce();
});
