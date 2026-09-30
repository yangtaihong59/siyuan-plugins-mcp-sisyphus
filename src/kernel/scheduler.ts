/** Transport admission only. Mutation correctness stays in WriteSafetyCoordinator. */
export type KernelLane = 'read' | 'exclusive';
export class KernelQueueError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
}
export interface KernelTask {
    key: string;
    cancelRequested?: boolean;
    cooperative?: boolean;
    readOnly?: boolean;
    committing?: boolean;
    deadline?: number;
    session?: string;
    requestKey?: string;
    state: 'preparing' | 'queued' | 'running' | 'cancelled' | 'done';
}
interface Job { task: KernelTask; lane: KernelLane; run: () => Promise<unknown>; resolve: (value: any) => void; reject: (reason: unknown) => void }
export class KernelScheduler {
    private tasks = new Map<string, KernelTask>();
    private requests = new Map<string, KernelTask>();
    private queue: Job[] = [];
    private active = { read: 0, exclusive: 0 };
    private anonymousId = 0;
    constructor(private readonly readConcurrency = 4, private readonly maxInFlight = 128) {}
    begin(session: string | undefined, id: string | number, request = { session, id }): KernelTask {
        const key = session ? JSON.stringify([session, typeof id, id]) : `anonymous:${++this.anonymousId}`;
        const requestKey = request.session ? JSON.stringify([request.session, typeof request.id, request.id]) : undefined;
        if (this.tasks.has(key) || (requestKey && this.requests.has(requestKey))) throw new KernelQueueError('duplicate_request', 'This MCP request ID is already in flight in this session.');
        if (this.tasks.size >= this.maxInFlight) throw new KernelQueueError('queue_full', 'Kernel request capacity reached; retry later with the same write requestId if applicable.');
        const task: KernelTask = { key, session: request.session, requestKey, state: 'preparing' };
        this.tasks.set(key, task);
        if (requestKey) this.requests.set(requestKey, task);
        return task;
    }
    finish(task: KernelTask) {
        if (this.tasks.get(task.key) === task) this.tasks.delete(task.key);
        if (task.requestKey && this.requests.get(task.requestKey) === task) this.requests.delete(task.requestKey);
        task.state = 'done';
    }
    run<T>(task: KernelTask, lane: KernelLane, run: () => Promise<T>): Promise<T> {
        if (task.state === 'cancelled') return Promise.reject(this.cancelError());
        if (task.state !== 'preparing') return Promise.reject(new Error('Task was already scheduled'));
        task.state = 'queued';
        return new Promise<T>((resolve, reject) => {
            this.queue.push({ task, lane, run, resolve, reject });
            this.pump();
        });
    }
    cancel(session: string, id: string | number): boolean {
        return this.cancelTask(this.tasks.get(JSON.stringify([session, typeof id, id])));
    }
    cancelRequest(session: string, id: string | number): boolean {
        return this.cancelTask(this.requests.get(JSON.stringify([session, typeof id, id])));
    }
    private cancelTask(task: KernelTask | undefined): boolean {
        if (!task || task.committing || task.state === 'done') return false;
        if (task.state === 'running') {
            if (!task.cooperative) return false;
            task.cancelRequested = true;
            return true;
        }
        task.cancelRequested = true;
        task.state = 'cancelled';
        const index = this.queue.findIndex(job => job.task === task);
        if (index >= 0) this.queue.splice(index, 1)[0].reject(this.cancelError());
        return true;
    }
    cancelSession(session: string) {
        for (const task of this.tasks.values()) {
            if (task.session !== session || task.committing) continue;
            if (task.state === 'running') { if (task.cooperative) task.cancelRequested = true; continue; }
            if (task.state !== 'preparing' && task.state !== 'queued') continue;
            task.cancelRequested = true;
            task.state = 'cancelled';
            const index = this.queue.findIndex(job => job.task === task);
            if (index >= 0) this.queue.splice(index, 1)[0].reject(this.cancelError());
        }
    }
    status(session: string, id: string | number) {
        const task = this.tasks.get(JSON.stringify([session, typeof id, id]));
        return task ? { state: task.state, cancelRequested: !!task.cancelRequested, committing: !!task.committing } : undefined;
    }
    checkpoint(task: KernelTask) {
        if (!task.committing && task.readOnly && task.deadline && Date.now() >= task.deadline) throw new KernelQueueError('read_deadline_exceeded', 'Read deadline exceeded; current host I/O was allowed to finish. Retry a smaller read.');
        if (!task.committing && (task.cancelRequested || task.state === 'cancelled')) throw this.cancelError();
    }
    beginCommit(task: KernelTask) { this.checkpoint(task); task.committing = true; }
    snapshot() {
        return { readConcurrency: this.readConcurrency, maxInFlight: this.maxInFlight, inFlight: this.tasks.size, queued: this.queue.length, cancelledRunning: [...this.tasks.values()].filter(t => t.state === 'running' && t.cancelRequested).length, readsRunning: this.active.read, exclusiveRunning: this.active.exclusive };
    }
    private cancelError() { return new KernelQueueError('request_cancelled', 'Cancelled before commit; no business write was attempted. An already-started read was allowed to finish.'); }
    private pump() {
        for (let index = 0; index < this.queue.length;) {
            const job = this.queue[index];
            const limit = job.lane === 'read' ? this.readConcurrency : 1;
            if (this.active[job.lane] >= limit) { index++; continue; }
            this.queue.splice(index, 1);
            this.active[job.lane]++;
            job.task.state = 'running';
            Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
                this.active[job.lane]--;
                this.pump();
            });
        }
    }
}
