import { vi } from 'vitest';

interface MockPermissionManagerOptions {
    canRead?: (notebookId: string) => boolean;
    canWrite?: (notebookId: string) => boolean;
    canDelete?: (notebookId: string) => boolean;
}

/**
 * Create a mock PermissionManager for tool-level tests.
 */
export function createMockPermissionManager(options: MockPermissionManagerOptions = {}) {
    const mock = {
        reload: vi.fn(async () => undefined),
        canRead: vi.fn(options.canRead ?? (() => true)),
        canWrite: vi.fn(options.canWrite ?? (() => true)),
        canDelete: vi.fn(options.canDelete ?? (() => true)),
        // Derived from the can* mocks so overriding those keeps get() consistent.
        get: vi.fn((notebookId: string) => mock.canDelete(notebookId) ? 'rwd'
            : mock.canWrite(notebookId) ? 'rw'
                : mock.canRead(notebookId) ? 'r' : 'none'),
    };
    return mock as any;
}
