import { KernelQueueError } from './scheduler';
/** Aggregate budget for one read-only tool invocation. No interruption after a write commit. */
export class KernelReadBudget {
    private requests = 0;
    private bytes = 0;
    private failed = false;
    check() { if (this.failed) this.exceeded(); }
    constructor(private maxRequests = 128, private maxBytes = 8 * 1024 * 1024) {}
    before() {
        this.check();
        if (++this.requests > this.maxRequests) this.exceeded();
    }
    after(value: unknown) {
        const size = value instanceof ArrayBuffer ? value.byteLength : ArrayBuffer.isView(value) ? value.byteLength
            : new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value) ?? '').byteLength;
        this.bytes += size;
        if (this.bytes > this.maxBytes) this.exceeded();
    }
    private exceeded(): never { this.failed = true; throw new KernelQueueError('read_budget_exceeded', `Read budget exceeded (${this.maxRequests} API reads / ${this.maxBytes} bytes). Narrow the query or use smaller pages. No partial result is presented as complete.`); }
}
