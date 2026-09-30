import { describe, expect, it, vi } from 'vitest';

import {
    discoverLocalKernels,
    isLoopbackApiUrl,
    parseKernelProcessLine,
    resolveDiscoveredApiUrl,
    shouldAutoDiscover,
    type DiscoveredKernel,
    type WorkspaceConfInfo,
} from '@/cli/discover-instances';

const JDY = '/Users/example/siyuan/jdyLog';
const SOFTWARE = '/Users/example/siyuan/software';

function kernel(port: number, workspace?: string, publishPort?: number): DiscoveredKernel {
    return {
        pid: port,
        port,
        apiUrl: `http://127.0.0.1:${port}`,
        workspace,
        ...(publishPort ? { publishPort, publishUrl: `http://127.0.0.1:${publishPort}` } : {}),
    };
}

function confFor(tokens: Record<string, string>, publish: Record<string, number> = {}): (workspace: string) => WorkspaceConfInfo | undefined {
    return (workspace) => {
        const apiToken = tokens[workspace];
        if (!apiToken && !publish[workspace]) return undefined;
        return {
            apiToken,
            publishPort: publish[workspace],
        };
    };
}

describe('cli/discover-instances', () => {
    it('parses kernel serve commands and ignores publish-only or unrelated processes', () => {
        const parsed = parseKernelProcessLine(
            `15523 /Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel serve --port 63330 --wd /Applications/SiYuan.app/Contents/Resources --attach-ui --workspace ${JDY}`,
        );
        expect(parsed).toMatchObject({ pid: 15523, port: 63330, workspace: JDY, apiUrl: 'http://127.0.0.1:63330' });

        expect(parseKernelProcessLine(
            '27362 /Applications/SiYuan.app/Contents/Resources/kernel/SiYuan-Kernel serve --port=62820 --workspace "/Users/example/My Notes"',
        )).toMatchObject({ port: 62820, workspace: '/Users/example/My Notes' });

        expect(parseKernelProcessLine(
            '17636 /Applications/SiYuan.app/Contents/Frameworks/SiYuan Helper node /work/mcp-server.cjs --http',
        )).toBeUndefined();
        expect(parseKernelProcessLine('999 /bin/ps -axww -o pid=,command=')).toBeUndefined();
    });

    it('attaches the publish port but keeps the kernel --port as apiUrl', async () => {
        const instances = await discoverLocalKernels({
            readProcessTable: async () => [
                `1 /kernel/SiYuan-Kernel serve --port 63330 --workspace ${JDY}`,
                `2 /kernel/SiYuan-Kernel serve --port 62820 --workspace ${SOFTWARE}`,
            ].join('\n'),
            readWorkspaceConf: confFor({ [JDY]: 'jdy-token', [SOFTWARE]: 'soft-token' }, { [JDY]: 6810 }),
        });

        expect(instances).toEqual([
            expect.objectContaining({ pid: 2, port: 62820, workspace: SOFTWARE, apiUrl: 'http://127.0.0.1:62820' }),
            expect.objectContaining({
                pid: 1,
                port: 63330,
                apiUrl: 'http://127.0.0.1:63330',
                publishPort: 6810,
                publishUrl: 'http://127.0.0.1:6810',
            }),
        ]);
    });

    it('follows the workspace whose API token matches, including a stale or publish URL', async () => {
        const instances = [
            kernel(63330, JDY, 6810),
            kernel(62820, SOFTWARE),
        ];
        const readWorkspaceConf = confFor({ [JDY]: 'jdy-token', [SOFTWARE]: 'soft-token' });
        const probeKernel = vi.fn(async () => {
            throw new Error('probe should not run after a unique workspace token match');
        });

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:63106',
            token: 'jdy-token',
            instances,
            readWorkspaceConf,
            probeKernel,
        })).resolves.toMatchObject({ apiUrl: 'http://127.0.0.1:63330', retargeted: true });

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:6810',
            token: 'jdy-token',
            instances,
            readWorkspaceConf,
            probeKernel,
        })).resolves.toMatchObject({ apiUrl: 'http://127.0.0.1:63330', retargeted: true });

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'https://127.0.0.1:63106',
            token: 'soft-token',
            instances,
            readWorkspaceConf,
        })).resolves.toMatchObject({ apiUrl: 'https://127.0.0.1:62820', retargeted: true });

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:63330',
            token: 'jdy-token',
            instances,
            readWorkspaceConf,
            probeKernel,
        })).resolves.toMatchObject({ apiUrl: 'http://127.0.0.1:63330', retargeted: false });
        expect(probeKernel).not.toHaveBeenCalled();
    });

    it('probes only when the workspace token file does not identify a kernel', async () => {
        const instances = [kernel(63330, JDY), kernel(62756)];
        const probeKernel = vi.fn(async (apiUrl: string) => apiUrl.endsWith(':62756'));

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:63106',
            token: 'orphan-token',
            instances,
            readWorkspaceConf: confFor({ [JDY]: 'jdy-token' }),
            probeKernel,
        })).resolves.toMatchObject({ apiUrl: 'http://127.0.0.1:62756', retargeted: true });
        expect(probeKernel).toHaveBeenCalledTimes(2);
    });

    it('refuses to guess when several kernels match, and reports a dead saved port', async () => {
        const instances = [kernel(63330, JDY), kernel(62820, SOFTWARE)];
        const readWorkspaceConf = confFor({ [JDY]: 'same', [SOFTWARE]: 'same' });

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:63106',
            token: 'same',
            instances,
            readWorkspaceConf,
        })).resolves.toMatchObject({ ambiguous: instances });

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:63106',
            token: '',
            instances,
            readWorkspaceConf,
        })).resolves.toMatchObject({ staleUnmatched: instances });

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:63106',
            token: '',
            instances: [kernel(63330, JDY)],
            readWorkspaceConf,
        })).resolves.toMatchObject({ apiUrl: 'http://127.0.0.1:63330', retargeted: true });

        const liveUnmatched = await resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:62820',
            token: 'orphan-token',
            instances,
            readWorkspaceConf,
            probeKernel: async () => false,
        });
        expect(liveUnmatched.apiUrl).toBe('http://127.0.0.1:62820');
        expect(liveUnmatched.retargeted).toBe(false);
        expect(liveUnmatched.staleUnmatched).toBeUndefined();
        expect(liveUnmatched.instance?.port).toBe(62820);

        await expect(resolveDiscoveredApiUrl({
            apiUrl: 'http://127.0.0.1:63106',
            token: 'jdy-token',
            instances: [],
            readWorkspaceConf,
        })).resolves.toEqual({ apiUrl: 'http://127.0.0.1:63106', retargeted: false });
    });

    it('leaves an explicit or non-loopback URL alone', () => {
        expect(shouldAutoDiscover({
            apiUrl: 'http://127.0.0.1:63106',
            discoverDisabled: false,
        })).toBe(true);
        expect(shouldAutoDiscover({
            cliUrl: 'http://127.0.0.1:6810',
            apiUrl: 'http://127.0.0.1:6810',
            discoverDisabled: false,
        })).toBe(false);
        expect(shouldAutoDiscover({
            envUrl: 'http://127.0.0.1:63106',
            apiUrl: 'http://127.0.0.1:63106',
            discoverDisabled: false,
        })).toBe(false);
        expect(shouldAutoDiscover({
            apiUrl: 'http://192.168.31.2:6806',
            discoverDisabled: false,
        })).toBe(false);
        expect(shouldAutoDiscover({
            apiUrl: 'http://127.0.0.1:63106',
            discoverDisabled: true,
        })).toBe(false);
    });
});

it('recognizes IPv6 loopback and rejects invalid process ports', () => {
    expect(isLoopbackApiUrl('http://[::1]:6806')).toBe(true);
    expect(isLoopbackApiUrl('http://[2001:db8::1]:6806')).toBe(false);
    for (const port of ['0', '65536', '999999999999999999999']) {
        expect(parseKernelProcessLine(`1 /kernel/SiYuan-Kernel serve --port ${port}`)).toBeUndefined();
    }
});
