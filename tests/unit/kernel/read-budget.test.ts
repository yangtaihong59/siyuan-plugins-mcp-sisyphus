import { expect, it } from 'vitest';
import { KernelReadBudget } from '@/kernel/read-budget';
import { taskClient } from '@/kernel/task-client';
import { KernelScheduler } from '@/kernel/scheduler';
it('bounds aggregate pages and UTF-8/binary bytes', () => {
    const budget = new KernelReadBudget(2, 6);
    budget.before(); budget.after('中文');
    expect(() => budget.after(new Uint8Array(1))).toThrow('Read budget');
    expect(() => budget.before()).toThrow('Read budget');
    const calls = new KernelReadBudget(1); calls.before(); expect(() => calls.before()).toThrow('Read budget');
});
it('stops follow-up reads but never interrupts a committing operation', async () => {
    const scheduler = new KernelScheduler(); const task = scheduler.begin('session', 1); task.readOnly = true;
    let calls = 0;
    const client = taskClient({ requestRead: async () => { calls++; return 'x'; } }, scheduler, task, new KernelReadBudget(1));
    await client.requestRead(); await expect(client.requestRead()).rejects.toThrow('Read budget'); expect(calls).toBe(1);
    scheduler.beginCommit(task); await expect(client.requestRead()).resolves.toBe('x');
});
it('charges resource bodies and latches failure when a handler catches it', async () => {
    const scheduler = new KernelScheduler(); const task = scheduler.begin('r', 1); task.readOnly = true;
    const budget = new KernelReadBudget(10, 5);
    const client = taskClient({ requestResource: async () => ({ text: async () => '中文' }) }, scheduler, task, budget);
    const response = await client.requestResource();
    await expect(response.text()).rejects.toThrow('Read budget');
    expect(() => budget.check()).toThrow('Read budget');
});
it('cooperative read deadlines reject late success and retain commit semantics', async () => {
    const scheduler = new KernelScheduler(); const task = scheduler.begin('r', 2); task.readOnly = true;
    task.deadline = Date.now() - 1;
    expect(() => scheduler.checkpoint(task)).toThrow('deadline');
    task.committing = true;
    expect(() => scheduler.checkpoint(task)).not.toThrow();
});
it('counts retry attempts against the same task budget', async () => {
    const { KernelSiYuanClient } = await import('@/kernel/client');
    const { vi } = await import('vitest');
    const fetch = vi.fn(async () => ({ ok: false, status: 503, text: async () => '' }));
    vi.stubGlobal('siyuan', { client: { fetch } });
    try {
        const scheduler = new KernelScheduler(), task = scheduler.begin('r', 3); task.readOnly = true;
        const client = taskClient(new KernelSiYuanClient(), scheduler, task, new KernelReadBudget(1));
        await expect(client.requestRead('/api/test')).rejects.toThrow('Read budget');
        expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
});
