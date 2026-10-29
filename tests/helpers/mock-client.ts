import { vi } from 'vitest';

/**
 * Create a minimal mock SiYuanClient for tool-level tests.
 *
 * `request` / `requestFormData` record every JSON / multipart call regardless
 * of semantics, so tests can assert on endpoints. The contract methods
 * (`requestRead`, `requestWrite`, ...) are separate spies that delegate to
 * them, so a test can also assert whether a call was sent as a read or a
 * write. Delegation happens at call time; tests may reassign `request`.
 */
export function createMockClient(overrides: Record<string, unknown> = {}) {
    const client = {
        request: vi.fn(async () => null),
        requestFormData: vi.fn(async () => null),
        writeFile: vi.fn(async () => undefined),
        ...overrides,
    } as any;
    return withRequestSemantics(client);
}

/**
 * Give a test double that only stubs request()/requestFormData() the explicit
 * read/write methods of the SiYuanClient contract, as distinct spies.
 */
export function withRequestSemantics<T extends Record<string, any>>(client: T): T {
    const target = client as Record<string, any>;
    target.requestRead = vi.fn((...args: unknown[]) => target.request(...args));
    target.requestWrite = vi.fn((...args: unknown[]) => target.request(...args));
    target.requestFormDataRead = vi.fn((...args: unknown[]) => target.requestFormData(...args));
    target.requestFormDataWrite = vi.fn((...args: unknown[]) => target.requestFormData(...args));
    return client;
}
