import { KernelReadBudget } from './read-budget';
import type { KernelScheduler, KernelTask } from './scheduler';

/** Per-call checkpoints, never a global signal on the shared client.
 * An in-flight host fetch retains its slot until it settles. After commit starts
 * checks become inert, including post-write readback and ledger persistence.
 */
export function taskClient<T extends object>(client: T, scheduler: KernelScheduler, task: KernelTask, budget?: KernelReadBudget): T {
    const scopedFactory = (client as any).forTask;
    if (typeof scopedFactory === 'function') client = scopedFactory.call(client, () => { scheduler.checkpoint(task); if (task.readOnly && !task.committing) budget?.check(); }, () => { if (task.readOnly && !task.committing) budget?.before(); });
    const io = new Set(['request', 'requestRead', 'requestWrite', 'requestApi', 'requestResource', 'readFile', 'readFileBinary', 'writeFile', 'requestFormData', 'requestFormDataRead', 'requestFormDataWrite', 'uploadAssetBytes', 'fetchExternal']);
    return new Proxy(client, {
        get(target, key) {
            const value = Reflect.get(target, key);
            if (typeof value !== 'function') return value;
            if (!io.has(String(key))) return value.bind(target);
            return async (...args: unknown[]) => {
                scheduler.checkpoint(task);
                if (task.readOnly && !task.committing) budget?.before();
                const result = await value.apply(target, args);
                scheduler.checkpoint(task);
                if (String(key) === 'requestResource' && result && typeof result === 'object') {
                    // Charge the consumed response body, not a wrapper containing functions.
                    const wrapped = { ...result };
                    for (const method of ['text', 'json', 'arrayBuffer']) if (typeof result[method] === 'function') {
                        wrapped[method] = async () => {
                            scheduler.checkpoint(task);
                            const body = await result[method]();
                            scheduler.checkpoint(task);
                            if (task.readOnly && !task.committing) budget?.after(body);
                            return body;
                        };
                    }
                    return wrapped;
                }
                if (task.readOnly && !task.committing) budget?.after(result);
                return result;
            };
        },
    });
}
