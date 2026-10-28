import type { SiYuanClient } from '../api/client';

/** Serialize read/modify/write metadata operations per runtime client and file group.
 * This is not a cross-process lock or a second note-write coordinator.
 */
const queues = new WeakMap<object, Map<string, Promise<void>>>();
export function queueStorage<T>(client: Pick<SiYuanClient, 'storageIdentity'>, group: string, run: () => Promise<T>): Promise<T> {
    // Kernel task-scoped clients share one storage instance. Unmarked Node
    // clients keep their original per-client queues.
    const identity = client.storageIdentity;
    const key = identity && typeof identity === 'object' ? identity : client;
    let groups = queues.get(key);
    if (!groups) { groups = new Map(); queues.set(key, groups); }
    const next = (groups.get(group) ?? Promise.resolve()).then(run, run);
    const tail = next.then(() => {}, () => {});
    groups.set(group, tail);
    void tail.then(() => { if (groups!.get(group) === tail) groups!.delete(group); });
    return next;
}
