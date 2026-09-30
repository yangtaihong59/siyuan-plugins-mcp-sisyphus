import { expect, it } from 'vitest';
import { KernelTaskResults } from '@/kernel/task-results';
it('isolates keys, invalidates changed access and expires receipts without refreshing TTL', () => {
    let now = 0; const receipts = new KernelTaskResults(() => now, 100);
    const result = { content: [{ text: 'private' }] };
    receipts.save('owner-a:task', result, 'permissions-v1'); result.content[0].text = 'changed';
    expect(receipts.get('owner-b:task', 'permissions-v1', true)).toBeUndefined();
    expect(receipts.get('owner-a:task', 'permissions-v1')).not.toHaveProperty('result');
    expect(receipts.get('owner-a:task', 'permissions-v1', true)?.result.content[0].text).toBe('private');
    expect(receipts.get('owner-a:task', 'permissions-v2', true)).toMatchObject({ reason: 'access_changed', resultAvailable: false });
    now = 100; expect(receipts.has('owner-a:task')).toBe(false);
});
it('bounds count, aggregate bytes and individual bodies while retaining oversized status', () => {
    const receipts = new KernelTaskResults(Date.now, 1000, 2, 20, 15);
    receipts.save('a', '12345678', 'r'); receipts.save('b', '12345678', 'r'); receipts.save('c', '12345678', 'r');
    expect(receipts.has('a')).toBe(false);
    receipts.save('huge', 'x'.repeat(30), 'r');
    expect(receipts.get('huge', 'r', true)).toMatchObject({ state: 'done', resultAvailable: false, reason: 'result_too_large' });
    expect(receipts.has('b')).toBe(false);
});
