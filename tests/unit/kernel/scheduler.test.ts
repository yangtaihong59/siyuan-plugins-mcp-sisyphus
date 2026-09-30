import { expect, it, vi } from 'vitest';
import { KernelScheduler } from '@/kernel/scheduler';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
it('limits reads to four, preserves exclusive FIFO and allows each lane to progress independently', async () => {
    const s = new KernelScheduler();
    const gate = deferred(); let reads = 0, maxReads = 0;
    const pending = Array.from({ length: 8 }, (_, i) => s.run(s.begin('s', i), 'read', async () => { reads++; maxReads = Math.max(reads, maxReads); await gate.promise; reads--; }));
    const order: number[] = [];
    const writeGate = deferred();
    const w1 = s.run(s.begin('s', 'w1'), 'exclusive', async () => { order.push(1); await writeGate.promise; });
    const w2 = s.run(s.begin('s', 'w2'), 'exclusive', async () => { order.push(2); });
    await tick(); expect(maxReads).toBe(4); expect(reads).toBe(4); expect(order).toEqual([1]);
    gate.resolve(); await Promise.all(pending); expect(order).toEqual([1]);
    writeGate.resolve(); await Promise.all([w1, w2]); expect(order).toEqual([1, 2]); expect(maxReads).toBe(4);
});
it('cancels only pending requests in the same session with type-sensitive RPC IDs', async () => {
    const s = new KernelScheduler(1), gate = deferred();
    const active = s.run(s.begin('a', 1), 'exclusive', () => gate.promise);
    const run = vi.fn(async () => 'should not run');
    const task = s.begin('a', 2), pending = s.run(task, 'exclusive', run);
    const checked = expect(pending).rejects.toMatchObject({ code: 'request_cancelled' });
    expect(s.cancel('b', 2)).toBe(false); expect(s.cancel('a', '2')).toBe(false);
    expect(s.cancel('a', 1)).toBe(false); expect(s.cancel('a', 2)).toBe(true);
    await checked; s.finish(task); gate.resolve(); await active; expect(run).not.toHaveBeenCalled();
});
it('cancellation during preparation and session close prevent execution without poisoning later work', async () => {
    const s = new KernelScheduler(); const t = s.begin('a', 1); s.cancelSession('a');
    const run = vi.fn(async () => 1);
    await expect(s.run(t, 'read', run)).rejects.toMatchObject({ code: 'request_cancelled' });
    s.finish(t); expect(run).not.toHaveBeenCalled();
    await expect(s.run(s.begin('a', 1), 'read', async () => 42)).resolves.toBe(42);
});
it('bounds admitted requests and refuses duplicate IDs; failure releases execution slots', async () => {
    const s = new KernelScheduler(1, 2); const t = s.begin('a', 1);
    expect(() => s.begin('a', 1)).toThrow('already in flight');
    const other = s.begin('b', 1); expect(() => s.begin('c', 1)).toThrow('capacity');
    const failed = s.run(t, 'read', async () => { throw new Error('failed'); });
    const next = s.run(other, 'read', async () => 'okay');
    await expect(failed).rejects.toThrow('failed'); s.finish(t);
    await expect(next).resolves.toBe('okay'); s.finish(other);
    expect(() => s.begin('c', 1)).not.toThrow();
});
it('cooperatively stops reads without freeing the active slot before native I/O settles', async () => {
    const { taskClient } = await import('@/kernel/task-client');
    const s = new KernelScheduler(1), gate = deferred();
    const task = s.begin('owner', 'task'); task.cooperative = true;
    const native = { requestRead: vi.fn(async () => { await gate.promise; return 1; }) };
    const c = taskClient(native, s, task);
    const first = s.run(task, 'read', async () => { await c.requestRead(); return c.requestRead(); });
    const rejected = expect(first).rejects.toMatchObject({ code: 'request_cancelled' });
    await tick(); expect(s.cancel('owner', 'task')).toBe(true);
    const later = vi.fn(async () => 2);
    const next = s.run(s.begin('owner', 'next'), 'read', later);
    expect(s.snapshot()).toMatchObject({ readsRunning: 1, queued: 1, cancelledRunning: 1 });
    expect(later).not.toHaveBeenCalled();
    gate.resolve(); await rejected; await next;
    expect(native.requestRead).toHaveBeenCalledTimes(1);
});
it('makes commit a synchronous cancellation barrier and continues readback', async () => {
    const s = new KernelScheduler(), task = s.begin('owner', 1); task.cooperative = true;
    const gate = deferred();
    const run = s.run(task, 'exclusive', async () => { s.beginCommit(task); await gate.promise; s.checkpoint(task); return 'committed'; });
    await tick(); expect(s.cancel('owner', 1)).toBe(false); s.cancelSession('owner');
    expect(s.status('owner', 1)).toMatchObject({ committing: true, cancelRequested: false });
    gate.resolve(); await expect(run).resolves.toBe('committed');
});


it('indexes task IDs and typed session request IDs as one admission, then removes both aliases', () => {
    const s = new KernelScheduler(1, 2);
    const task = s.begin('owner-a', 'task', { session: 'session-a', id: 1 });
    expect(s.snapshot().inFlight).toBe(1);
    expect(s.cancelRequest('session-b', 1)).toBe(false);
    expect(s.cancelRequest('session-a', '1')).toBe(false);
    expect(s.cancel('owner-b', 'task')).toBe(false);
    expect(() => s.begin('owner-a', 'task', { session: 'other', id: 2 })).toThrow('already in flight');
    expect(() => s.begin('owner-a', 'other', { session: 'session-a', id: 1 })).toThrow('already in flight');
    const stringTask = s.begin('owner-a', 'string', { session: 'session-a', id: '1' });
    expect(s.cancelRequest('session-a', 1)).toBe(true);
    expect(s.status('owner-a', 'string')?.cancelRequested).toBe(false);
    s.finish(task);
    expect(s.cancelRequest('session-a', 1)).toBe(false);
    expect(s.status('owner-a', 'task')).toBeUndefined();
    const reused = s.begin('owner-a', 'other', { session: 'session-a', id: 1 });
    s.finish(task); // Late cleanup must not erase a replacement alias.
    expect(s.cancelRequest('session-a', 1)).toBe(true);
    s.finish(reused); s.finish(stringTask);
    expect(s.snapshot().inFlight).toBe(0);
});

it('cancels only the actual legacy session and leaves stateless owner tasks alone', () => {
    const s = new KernelScheduler();
    const a = s.begin('owner', 'a', { session: 'a', id: 1 });
    const b = s.begin('owner', 'b', { session: 'b', id: 1 });
    const modern = s.begin('owner', 'modern', { session: undefined, id: 1 });
    s.cancelSession('owner');
    expect([a, b, modern].some(t => t.cancelRequested)).toBe(false);
    s.cancelSession('a');
    expect(a.cancelRequested).toBe(true);
    expect(b.cancelRequested).toBeUndefined();
    expect(modern.cancelRequested).toBeUndefined();
});

it('protects committing task aliases from every cancellation path until I/O settles', async () => {
    const s = new KernelScheduler(1), gate = deferred();
    const task = s.begin('owner', 'task', { session: 'session', id: 1 }); task.cooperative = true;
    const pending = s.run(task, 'exclusive', async () => { s.beginCommit(task); await gate.promise; s.checkpoint(task); });
    await tick();
    expect(s.cancel('owner', 'task')).toBe(false);
    expect(s.cancelRequest('session', 1)).toBe(false);
    s.cancelSession('session');
    expect(s.snapshot()).toMatchObject({ inFlight: 1, exclusiveRunning: 1 });
    expect(task.cancelRequested).toBeUndefined();
    gate.resolve(); await pending; s.finish(task);
    expect(s.cancelRequest('session', 1)).toBe(false);
    expect(s.status('owner', 'task')).toBeUndefined();
});
