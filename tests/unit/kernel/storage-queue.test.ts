import { expect, it, vi } from 'vitest';
import { KernelSiYuanClient } from '@/kernel/client';
import { KernelScheduler } from '@/kernel/scheduler';
import { taskClient } from '@/kernel/task-client';
import { queueStorage } from '@/core/storage-queue';
import { earnPuppyBalance, spendPuppyBalance } from '@/core/puppy-state';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

it('shares a stable readonly storage identity across forTask and multiple task proxies', () => {
    const root = new KernelSiYuanClient();
    const s = new KernelScheduler();
    const scoped = root.forTask(() => {});
    const proxy = taskClient(root, s, s.begin('s', 1));
    const nested = taskClient(scoped, s, s.begin('s', 2));
    const identity = (root as any).storageIdentity;
    expect(typeof identity).toBe('object');
    for (const client of [scoped, proxy, nested]) {
        expect((client as any).storageIdentity).toBe(identity);
        expect(Reflect.set(client, 'storageIdentity', {})).toBe(false);
    }
    expect(Reflect.set(root, 'storageIdentity', {})).toBe(false);
    expect((new KernelSiYuanClient() as any).storageIdentity).not.toBe(identity);
});

it('prevents a gated root reward from overwriting a scoped purchase and later rewards', async () => {
    const root = new KernelSiYuanClient();
    let stored = JSON.stringify({ totalCalls: 1000, balance: 1000, updatedAt: 0 });
    const gate = deferred(); let firstWrite = true;
    root.readFile = vi.fn(async () => stored);
    root.writeFile = vi.fn(async (_path, value) => {
        if (firstWrite) { firstWrite = false; await gate.promise; }
        stored = value;
    });
    const s = new KernelScheduler();
    const proxies = [1, 2, 3].map(id => taskClient(root, s, s.begin('session', id)));
    const reward = earnPuppyBalance(root as any);
    await tick(); expect(root.writeFile).toHaveBeenCalledTimes(1);
    const purchase = spendPuppyBalance(proxies[0] as any, 5);
    const otherRewards = proxies.map(c => earnPuppyBalance(c as any));
    try { await tick(); expect(root.readFile).toHaveBeenCalledTimes(1); }
    finally { gate.resolve(); await Promise.all([reward, purchase, ...otherRewards]); }
    expect(JSON.parse(stored)).toMatchObject({ balance: 999, totalCalls: 1004 });
});

it('keeps independent kernel roots, file groups and unmarked Node clients parallel', async () => {
    const root = new KernelSiYuanClient(), other = new KernelSiYuanClient();
    const gate = deferred();
    const slow = queueStorage(root, 'stats', () => gate.promise);
    await tick();
    try {
        await expect(queueStorage(other, 'stats', async () => 1)).resolves.toBe(1);
        await expect(queueStorage(root.forTask(() => {}), 'events', async () => 2)).resolves.toBe(2);
        await expect(queueStorage({}, 'stats', async () => 3)).resolves.toBe(3);
    } finally { gate.resolve(); await slow; }
});

it('continues the shared queue after a scoped write fails', async () => {
    const root = new KernelSiYuanClient(), gate = deferred();
    const failed = queueStorage(root, 'stats', async () => { await gate.promise; throw new Error('write failed'); });
    const rejection = expect(failed).rejects.toThrow('write failed');
    const next = vi.fn(async () => 42);
    const pending = queueStorage(root.forTask(() => {}), 'stats', next);
    try { await tick(); expect(next).not.toHaveBeenCalled(); }
    finally { gate.resolve(); await rejection; }
    await expect(pending).resolves.toBe(42);
});
