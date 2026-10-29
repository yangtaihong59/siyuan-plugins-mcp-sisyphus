import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionManager, type NotebookPermission } from '@/core/permissions';
import type { SiYuanClient } from '@/api/client';

describe('PermissionManager', () => {
    let mockClient: SiYuanClient;
    let manager: PermissionManager;

    beforeEach(() => {
        mockClient = {
            readFile: vi.fn(),
            writeFile: vi.fn(),
        } as unknown as SiYuanClient;
        vi.mocked(mockClient.readFile).mockResolvedValue('');
        manager = new PermissionManager(mockClient);
    });

    describe('constructor', () => {
        it('should create manager without client', () => {
            const mgr = new PermissionManager();
            expect(mgr).toBeDefined();
        });

        it('should create manager with client', () => {
            expect(manager).toBeDefined();
        });
    });

    describe('load', () => {
        it('should load permissions from API', async () => {
            const permissions = { notebook1: 'rwd', notebook2: 'r' };
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify(permissions));

            await manager.load();
            expect(manager.getAll()).toEqual(permissions);
        });

        it('should treat empty API response as fresh install', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue('');

            await manager.load();
            expect(manager.getAll()).toEqual({});
        });

        it('should throw when API fails', async () => {
            vi.mocked(mockClient.readFile).mockRejectedValue(new Error('network down'));

            await expect(manager.load()).rejects.toThrow(/Failed to read permissions/);
            expect(manager.getAll()).toEqual({});
        });

        it('should throw when no client is provided', async () => {
            const mgr = new PermissionManager();

            await expect(mgr.load()).rejects.toThrow(/No SiYuan client/);
        });

        it('should migrate legacy persisted permissions', async () => {
            vi.mocked(mockClient.writeFile).mockResolvedValue();
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ notebook1: 'write', notebook2: 'readonly', notebook3: 'rwd' }));

            await manager.load();

            expect(manager.get('notebook1')).toBe('rw');
            expect(manager.get('notebook2')).toBe('r');
            expect(manager.get('notebook3')).toBe('rwd');
            expect(mockClient.writeFile).not.toHaveBeenCalled();
        });

        it('should still downgrade unknown persisted permissions to none', async () => {
            vi.mocked(mockClient.writeFile).mockResolvedValue();
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ notebook1: 'admin' }));

            await manager.load();

            expect(manager.get('notebook1')).toBe('none');
            expect(mockClient.writeFile).not.toHaveBeenCalled();
        });

        it('should skip loading if already loaded', async () => {
            const permissions = { notebook1: 'rwd' };
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify(permissions));

            await manager.load();
            await manager.load(); // Second call should be skipped

            expect(mockClient.readFile).toHaveBeenCalledTimes(1);
        });
    });

    describe('reload', () => {
        it('should force reload permissions', async () => {
            const permissions1 = { notebook1: 'rwd' };
            const permissions2 = { notebook1: 'r' };

            vi.mocked(mockClient.readFile)
                .mockResolvedValueOnce(JSON.stringify(permissions1))
                .mockResolvedValueOnce(JSON.stringify(permissions2));

            await manager.load();
            await manager.reload();

            expect(mockClient.readFile).toHaveBeenCalledTimes(2);
            expect(manager.get('notebook1')).toBe('r');
        });
    });

    describe('get', () => {
        it('should return permission for existing notebook', async () => {
            const permissions = { nb1: 'rwd', nb2: 'r' };
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify(permissions));

            await manager.load();
            expect(manager.get('nb1')).toBe('rwd');
            expect(manager.get('nb2')).toBe('r');
        });

        it('should default to read-only for unknown notebook', async () => {
            await manager.load();
            expect(manager.get('unknown')).toBe('r');
        });
    });

    describe('set', () => {
        it('should set permission and save', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue('{}');
            vi.mocked(mockClient.writeFile).mockResolvedValue();

            await manager.load();
            await manager.set('notebook1', 'r');

            expect(mockClient.writeFile).toHaveBeenCalled();
            expect(manager.get('notebook1')).toBe('r');
        });

        it('should handle all permission levels', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue('{}');
            vi.mocked(mockClient.writeFile).mockResolvedValue();

            await manager.load();

            const levels: NotebookPermission[] = ['none', 'r', 'rw', 'rwd'];
            for (const level of levels) {
                await manager.set(`nb-${level}`, level);
                expect(manager.get(`nb-${level}`)).toBe(level);
            }
        });
    });

    describe('canRead', () => {
        it('should return true for rwd permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'rwd' }));
            await manager.load();
            expect(manager.canRead('nb')).toBe(true);
        });

        it('should return true for r permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'r' }));
            await manager.load();
            expect(manager.canRead('nb')).toBe(true);
        });

        it('should return true for rw permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'rw' }));
            await manager.load();
            expect(manager.canRead('nb')).toBe(true);
        });

        it('should return false for none permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'none' }));
            await manager.load();
            expect(manager.canRead('nb')).toBe(false);
        });

        it('should return true for unknown notebook (defaults to read-only)', async () => {
            await manager.load();
            expect(manager.canRead('unknown')).toBe(true);
        });
    });

    describe('canWrite', () => {
        it('should return true for rw permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'rw' }));
            await manager.load();
            expect(manager.canWrite('nb')).toBe(true);
        });

        it('should return true for rwd permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'rwd' }));
            await manager.load();
            expect(manager.canWrite('nb')).toBe(true);
        });

        it('should return false for r permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'r' }));
            await manager.load();
            expect(manager.canWrite('nb')).toBe(false);
        });

        it('should return false for none permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'none' }));
            await manager.load();
            expect(manager.canWrite('nb')).toBe(false);
        });

        it('should return false for unknown notebook (defaults to read-only)', async () => {
            await manager.load();
            expect(manager.canWrite('unknown')).toBe(false);
        });
    });

    describe('canDelete', () => {
        it('should return true for rwd permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'rwd' }));
            await manager.load();
            expect(manager.canDelete('nb')).toBe(true);
        });

        it('should return false for rw permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'rw' }));
            await manager.load();
            expect(manager.canDelete('nb')).toBe(false);
        });

        it('should return false for r permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'r' }));
            await manager.load();
            expect(manager.canDelete('nb')).toBe(false);
        });

        it('should return false for none permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ nb: 'none' }));
            await manager.load();
            expect(manager.canDelete('nb')).toBe(false);
        });

        it('should return false for unknown notebook (defaults to read-only)', async () => {
            await manager.load();
            expect(manager.canDelete('unknown')).toBe(false);
        });
    });

    describe('getAll', () => {
        it('should return copy of all permissions', async () => {
            const permissions = { nb1: 'rwd', nb2: 'r' };
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify(permissions));

            await manager.load();
            const all = manager.getAll();

            expect(all).toEqual(permissions);
            // Verify it's a copy
            all.nb1 = 'none';
            expect(manager.get('nb1')).toBe('rwd');
        });
    });

    describe('grantNewNotebook', () => {
        it('grants rwd to an unconfigured notebook and keeps entries written by others', async () => {
            vi.mocked(mockClient.writeFile).mockResolvedValue();
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ other: 'r' }));

            await expect(manager.grantNewNotebook('nb-new')).resolves.toBe('rwd');

            expect(JSON.parse(vi.mocked(mockClient.writeFile).mock.calls[0][1] as string)).toEqual({ other: 'r', 'nb-new': 'rwd' });
        });

        it('never overrides an explicit permission', async () => {
            vi.mocked(mockClient.readFile).mockResolvedValue(JSON.stringify({ 'nb-new': 'r' }));

            await expect(manager.grantNewNotebook('nb-new')).resolves.toBe('r');
            expect(mockClient.writeFile).not.toHaveBeenCalled();
        });

        it('leaves the default for existing unconfigured notebooks at r', async () => {
            await manager.load();
            expect(manager.get('existing-notebook')).toBe('r');
        });
    });
});
