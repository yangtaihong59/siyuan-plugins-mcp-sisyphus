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
