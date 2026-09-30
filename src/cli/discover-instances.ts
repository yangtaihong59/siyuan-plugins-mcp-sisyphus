import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// CLI-only local exception. A desktop kernel binds an ephemeral --port, so a saved
// loopback profile cannot be corrected through the SiYuan API until that port is known.
// This module reads the process table and <workspace>/conf/conf.json (api.token and
// publish.port only). The publish port is reported and never selected as the API.

const KERNEL_BASENAMES = new Set(['SiYuan-Kernel', 'SiYuan-Kernel.exe']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface DiscoveredKernel {
    pid: number;
    port: number;
    apiUrl: string;
    workspace?: string;
    /** Read-only publish service. Never use this as the kernel API. */
    publishPort?: number;
    publishUrl?: string;
}

export interface WorkspaceConfInfo {
    apiToken?: string;
    publishPort?: number;
}

export interface DiscoveryDecision {
    apiUrl: string;
    retargeted: boolean;
    instance?: DiscoveredKernel;
    ambiguous?: DiscoveredKernel[];
    staleUnmatched?: DiscoveredKernel[];
}

export interface DiscoverDeps {
    readProcessTable?: () => Promise<string>;
    readWorkspaceConf?: (workspace: string) => WorkspaceConfInfo | undefined;
    probeKernel?: (apiUrl: string, token: string) => Promise<boolean>;
}

export function isLoopbackApiUrl(apiUrl: string): boolean {
    try {
        const url = new URL(apiUrl);
        return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
    } catch {
        return false;
    }
}

export function portOfApiUrl(apiUrl: string): number | undefined {
    try {
        const url = new URL(apiUrl);
        if (url.port) return Number(url.port);
        if (url.protocol === 'https:') return 443;
        if (url.protocol === 'http:') return 80;
        return undefined;
    } catch {
        return undefined;
    }
}

/** Profile-sourced loopback URLs can follow a restarted desktop kernel. Explicit --url / SIYUAN_API_URL stay put. */
export function shouldAutoDiscover(options: {
    cliUrl?: string;
    envUrl?: string;
    apiUrl: string;
    discoverDisabled: boolean;
}): boolean {
    if (options.discoverDisabled) return false;
    if (options.cliUrl || options.envUrl) return false;
    return isLoopbackApiUrl(options.apiUrl);
}

export function tokenizeCommand(command: string): string[] {
    const tokens: string[] = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    for (let match = pattern.exec(command); match; match = pattern.exec(command)) {
        tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
    }
    return tokens;
}

export function parseKernelProcessLine(line: string): DiscoveredKernel | undefined {
    const trimmed = line.trim();
    const pidMatch = /^(\d+)\s+([\s\S]+)$/.exec(trimmed);
    if (!pidMatch) return undefined;

    const pid = Number(pidMatch[1]);
    const tokens = tokenizeCommand(pidMatch[2]);
    const exeIndex = tokens.findIndex((token) => KERNEL_BASENAMES.has(commandBasename(token)));
    if (exeIndex < 0) return undefined;

    const args = tokens.slice(exeIndex + 1);
    if (!args.includes('serve')) return undefined;

    const portText = readFlag(args, 'port');
    if (!portText || !/^\d+$/.test(portText)) return undefined;

    const port = Number(portText);
    const workspace = readFlag(args, 'workspace');
    return {
        pid,
        port,
        apiUrl: `http://127.0.0.1:${port}`,
        workspace: workspace || undefined,
    };
}

export function readWorkspaceConfFromDisk(workspace: string): WorkspaceConfInfo | undefined {
    try {
        const raw = JSON.parse(readFileSync(join(workspace, 'conf', 'conf.json'), 'utf8')) as {
            api?: { token?: unknown };
            publish?: { enable?: unknown; port?: unknown };
        };
        const apiToken = typeof raw.api?.token === 'string' && raw.api.token ? raw.api.token : undefined;
        const publishPort = raw.publish?.enable === true
            && typeof raw.publish.port === 'number'
            && raw.publish.port > 0
            && raw.publish.port !== undefined
            ? raw.publish.port
            : undefined;
        return { apiToken, publishPort };
    } catch {
        return undefined;
    }
}

export async function discoverLocalKernels(deps: DiscoverDeps = {}): Promise<DiscoveredKernel[]> {
    const table = await (deps.readProcessTable ?? readProcessTable)();
    const readConf = deps.readWorkspaceConf ?? readWorkspaceConfFromDisk;
    const byPort = new Map<number, DiscoveredKernel>();

    for (const line of table.split(/\r?\n/)) {
        const parsed = parseKernelProcessLine(line);
        if (!parsed) continue;
        const conf = parsed.workspace ? readConf(parsed.workspace) : undefined;
        byPort.set(parsed.port, attachPublishEndpoint(parsed, conf));
    }

    return [...byPort.values()].sort((left, right) => left.port - right.port);
}

export async function resolveDiscoveredApiUrl(input: {
    apiUrl: string;
    token: string;
    instances: DiscoveredKernel[];
    readWorkspaceConf?: (workspace: string) => WorkspaceConfInfo | undefined;
    probeKernel?: (apiUrl: string, token: string) => Promise<boolean>;
}): Promise<DiscoveryDecision> {
    const readConf = input.readWorkspaceConf ?? readWorkspaceConfFromDisk;
    const configuredPort = portOfApiUrl(input.apiUrl);
    if (input.instances.length === 0) {
        return { apiUrl: input.apiUrl, retargeted: false };
    }

    let matches: DiscoveredKernel[] = [];
    if (input.token) {
        matches = input.instances.filter((instance) => workspaceTokenMatches(instance, input.token, readConf));
        if (matches.length === 0 && input.probeKernel) {
            for (const instance of input.instances) {
                if (await input.probeKernel(instance.apiUrl, input.token)) matches.push(instance);
            }
        }
    } else if (input.instances.length === 1) {
        matches = input.instances;
    }

    if (matches.length > 1) {
        return { apiUrl: input.apiUrl, retargeted: false, ambiguous: matches };
    }

    const selected = matches[0];
    const configuredLive = input.instances.find((instance) => instance.port === configuredPort);
    if (!selected) {
        if (configuredLive) return { apiUrl: input.apiUrl, retargeted: false, instance: configuredLive };
        return { apiUrl: input.apiUrl, retargeted: false, staleUnmatched: input.instances };
    }

    if (selected.port === configuredPort) {
        return { apiUrl: input.apiUrl, retargeted: false, instance: selected };
    }

    let protocol = 'http:';
    try {
        protocol = new URL(input.apiUrl).protocol;
    } catch {
        protocol = 'http:';
    }
    return {
        apiUrl: `${protocol}//127.0.0.1:${selected.port}`,
        retargeted: true,
        instance: selected,
    };
}

/** Authenticated notebook list. A wrong token is 401; anonymous localhost calls are not used. */
export async function probeKernelToken(apiUrl: string, token: string): Promise<boolean> {
    if (!token) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    try {
        const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/notebook/lsNotebooks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Token ${token}`,
            },
            body: '{}',
            signal: controller.signal,
        });
        if (!response.ok) return false;
        const payload = await response.json() as { code?: unknown };
        return payload.code === 0;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

export function formatDiscoveredKernels(instances: DiscoveredKernel[]): string {
    return instances.map((instance) => {
        const workspace = instance.workspace ? `  ${instance.workspace}` : '';
        const publish = instance.publishUrl ? `  publish ${instance.publishUrl} (not the kernel API)` : '';
        return `  ${instance.apiUrl}${workspace}${publish}`;
    }).join('\n');
}

function attachPublishEndpoint(kernel: DiscoveredKernel, conf: WorkspaceConfInfo | undefined): DiscoveredKernel {
    if (!conf?.publishPort || conf.publishPort === kernel.port) return kernel;
    return {
        ...kernel,
        publishPort: conf.publishPort,
        publishUrl: `http://127.0.0.1:${conf.publishPort}`,
    };
}

function workspaceTokenMatches(
    instance: DiscoveredKernel,
    token: string,
    readConf: (workspace: string) => WorkspaceConfInfo | undefined,
): boolean {
    if (!instance.workspace) return false;
    const conf = readConf(instance.workspace);
    return Boolean(conf?.apiToken) && conf!.apiToken === token;
}

function readFlag(args: string[], name: string): string | undefined {
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === `--${name}`) return args[index + 1];
        if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
    }
    return undefined;
}

function commandBasename(token: string): string {
    const parts = token.split(/[/\\]/);
    return parts[parts.length - 1] ?? token;
}

function execFileText(file: string, args: string[], maxBuffer: number): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { encoding: 'utf8', timeout: 8000, maxBuffer }, (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
        });
    });
}

async function readProcessTable(): Promise<string> {
    if (process.platform === 'win32') {
        return execFileText('powershell.exe', [
            '-NoProfile',
            '-Command',
            "Get-CimInstance Win32_Process -Filter \"Name = 'SiYuan-Kernel.exe'\" | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }",
        ], 4 * 1024 * 1024);
    }

    return execFileText('ps', ['-axww', '-o', 'pid=,command='], 8 * 1024 * 1024);
}
