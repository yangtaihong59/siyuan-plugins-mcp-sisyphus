import { vi } from 'vitest';

/**
 * Create a minimal mock SiYuanClient for tool-level tests.
 */
export function createMockClient(overrides: Record<string, unknown> = {}) {
    const client = {
        request: vi.fn(async () => null),
        requestFormData: vi.fn(async () => null),
        writeFile: vi.fn(async () => undefined),
        ...overrides,
    } as any;
    client.requestRead = client.request;
    client.requestWrite = client.request;
    client.requestFormDataRead = client.requestFormData;
    client.requestFormDataWrite = client.requestFormData;
    return client;
}

/**
 * Give a legacy test double that only stubs request()/requestFormData() the
 * explicit read/write methods of the SiYuanClient contract. Delegation happens
 * at call time, so tests may keep reassigning client.request.
 */
export function withRequestSemantics<T extends Record<string, any>>(client: T): T {
    const target = client as Record<string, any>;
    target.requestRead = (...args: unknown[]) => target.request(...args);
    target.requestWrite = (...args: unknown[]) => target.request(...args);
    target.requestFormDataRead = (...args: unknown[]) => target.requestFormData(...args);
    target.requestFormDataWrite = (...args: unknown[]) => target.requestFormData(...args);
    return client;
}
