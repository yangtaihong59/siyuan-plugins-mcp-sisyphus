/**
 * HttpServerLauncher
 *
 * Spawns and manages the bundled `mcp-server.cjs --http` child process from
 * inside the SiYuan plugin (renderer) process.
 *
 * SiYuan's Electron renderer compiles plugins as CJS bundles, so the global
 * `require` is available directly — `window.require` is NOT exposed.
 *
 * Only safe to instantiate when running inside the SiYuan desktop client.
 * Callers must check `HttpServerLauncher.isSupported()` first.
 */

type ChildProcessModule = typeof import("child_process");
type ChildProcess = import("child_process").ChildProcess;
type SpawnSyncReturns<T> = import("child_process").SpawnSyncReturns<T>;

type PathModule = typeof import("path");

const MAX_LOG_LINES = 200;
const STALE_PROCESS_TERM_TIMEOUT_MS = 1500;
const STALE_PROCESS_KILL_TIMEOUT_MS = 1500;
const GLOBAL_LOG_BUFFER: string[] = [];
const GLOBAL_LOG_LISTENERS = new Set<(lines: string[]) => void>();

function formatLauncherLogLine(message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] ${message}`;
}

function pushGlobalLogLines(lines: string[]): void {
    if (lines.length === 0) return;
    GLOBAL_LOG_BUFFER.push(...lines);
    if (GLOBAL_LOG_BUFFER.length > MAX_LOG_LINES) {
        GLOBAL_LOG_BUFFER.splice(0, GLOBAL_LOG_BUFFER.length - MAX_LOG_LINES);
    }
    const snapshot = [...GLOBAL_LOG_BUFFER];
    for (const fn of GLOBAL_LOG_LISTENERS) {
        try { fn(snapshot); } catch (err) { console.error("[MCP] launcher global log listener error:", err); }
    }
}

function normalizeLogLines(text: string): string[] {
    return text.split(/\r?\n/).filter((l) => l.length > 0);
}

export function appendHttpLifecycleLog(message: string): void {
    pushGlobalLogLines([formatLauncherLogLine(message)]);
}

export function getHttpLifecycleLogs(): string[] {
    return [...GLOBAL_LOG_BUFFER];
}

export function onHttpLifecycleLogsChange(fn: (lines: string[]) => void): () => void {
    GLOBAL_LOG_LISTENERS.add(fn);
    return () => GLOBAL_LOG_LISTENERS.delete(fn);
}

// In SiYuan's CJS plugin bundle, the Node.js `require` is available as a
// global. Try it directly before falling back to window.require.
function getNodeRequire(): NodeRequire | undefined {
    // CJS global require (works inside SiYuan's plugin bundle)
    if (typeof require === "function") {
        try {
            require("child_process"); // probe
            return require;
        } catch { /* not Node require */ }
    }
    // Fallback: window.require (some Electron setups)
    if (typeof window !== "undefined") {
        const w = window as unknown as { require?: NodeRequire };
        if (typeof w.require === "function") return w.require;
    }
    return undefined;
}

function canRequireModule(moduleName: string): boolean {
    const req = getNodeRequire();
    if (!req) return false;
    try {
        req(moduleName);
        return true;
    } catch {
        return false;
    }
}

function getWorkspaceDir(): string | null {
    const workspaceDir = (window as Window & {
        siyuan?: {
            config?: {
                system?: {
                    workspaceDir?: unknown;
                };
            };
        };
    })?.siyuan?.config?.system?.workspaceDir;
    if (typeof workspaceDir !== "string" || !workspaceDir.trim()) {
        return null;
    }
    return workspaceDir;
}

function getPathModule(): PathModule | null {
    const req = getNodeRequire();
    if (!req) return null;
    try {
        return req("path") as PathModule;
    } catch {
        return null;
    }
}

export interface HttpServerStatus {
    running: boolean;
    pid?: number;
    host: string;
    port: number;
    startedAt?: number;
    lastError?: string;
}

export interface HttpServerLaunchOptions {
    host: string;
    port: number;
    token?: string;
    siyuanApiUrl?: string;
    siyuanToken?: string;
    tlsCertFile?: string;
    tlsKeyFile?: string;
    tlsCaFile?: string;
    skillsExtensionEnabled?: boolean;
}

export interface HttpServerSupportInfo {
    supported: boolean;
    reason?: string;
}

export class HttpServerLauncher {
    static getSupportInfo(): HttpServerSupportInfo {
        if (!getNodeRequire()) {
            return { supported: false, reason: "node_require_unavailable" };
        }
        if (!canRequireModule("child_process")) {
            return { supported: false, reason: "child_process_unavailable" };
        }
        if (!getPathModule()) {
            return { supported: false, reason: "path_unavailable" };
        }
        if (!getWorkspaceDir()) {
            return { supported: false, reason: "workspace_dir_unavailable" };
        }
        return { supported: true };
    }

    static isSupported(): boolean {
        return this.getSupportInfo().supported;
    }

    static resolveServerScriptPath(pluginName: string): string | null {
        const support = this.getSupportInfo();
        if (!support.supported) return null;
        const path = getPathModule();
        const workspaceDir = getWorkspaceDir();
        if (!path || !workspaceDir) return null;
        return path.join(workspaceDir, "data", "plugins", pluginName, "mcp-server.cjs");
    }

    private readonly serverScriptPath: string;
    private childProcess: ChildProcessModule | null = null;
    private child: ChildProcess | null = null;
    private status: HttpServerStatus;
    private listeners = new Set<(s: HttpServerStatus) => void>();
    private logBuffer: string[] = [];
    private logListeners = new Set<(lines: string[]) => void>();

    constructor(serverScriptPath: string) {
        this.serverScriptPath = serverScriptPath;
        const req = getNodeRequire();
        if (req) {
            try {
                this.childProcess = req("child_process") as ChildProcessModule;
            } catch (err) {
                console.error("[MCP] failed to require child_process:", err);
            }
        }
        this.status = { running: false, host: "127.0.0.1", port: 0 };
    }

    getStatus(): HttpServerStatus {
        return { ...this.status };
    }

    getRecentLogs(): string[] {
        return getHttpLifecycleLogs();
    }

    onStatusChange(fn: (s: HttpServerStatus) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    onLogsChange(fn: (lines: string[]) => void): () => void {
        this.logListeners.add(fn);
        return () => this.logListeners.delete(fn);
    }

    async start(opts: HttpServerLaunchOptions): Promise<void> {
        if (!this.childProcess) {
            this.appendLifecycleLog("start rejected: child_process module unavailable");
            throw new Error("child_process module unavailable");
        }
        if (this.child?.pid && this.isProcessAlive(this.child.pid)) {
            this.appendLifecycleLog(`start skipped: already running pid=${this.child.pid} ${this.status.host}:${this.status.port}`);
            return; // already running
        }
        this.child = null;

        this.logBuffer = [];
        this.emitLogs();
        this.appendLifecycleLog(`start requested: ${opts.host}:${opts.port} script=${this.serverScriptPath}`);

        await this.cleanupStaleHttpProcesses(opts.port);

        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            ELECTRON_RUN_AS_NODE: "1",
            SIYUAN_MCP_TRANSPORT: "http",
            SIYUAN_MCP_HOST: opts.host,
            SIYUAN_MCP_PORT: String(opts.port),
            SIYUAN_MCP_PARENT_PID: String(process.pid),
            SIYUAN_MCP_SERVER_SCRIPT: this.serverScriptPath,
            SIYUAN_MCP_INSTANCE_ID: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        };
        if (opts.token) env.SIYUAN_MCP_TOKEN = opts.token;
        if (opts.siyuanApiUrl) env.SIYUAN_API_URL = opts.siyuanApiUrl;
        if (opts.siyuanToken) env.SIYUAN_TOKEN = opts.siyuanToken;
        if (opts.tlsCertFile) env.SIYUAN_MCP_TLS_CERT = opts.tlsCertFile;
        if (opts.tlsKeyFile) env.SIYUAN_MCP_TLS_KEY = opts.tlsKeyFile;
        if (opts.tlsCaFile) env.SIYUAN_MCP_TLS_CA = opts.tlsCaFile;
        env.SIYUAN_MCP_SKILLS_EXTENSION = opts.skillsExtensionEnabled ? "true" : "false";

        let child: ChildProcess;
        try {
            child = this.childProcess.spawn(process.execPath, [this.serverScriptPath, "--http"], {
                env,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.appendLifecycleLog(`spawn failed: ${msg}`);
            this.status = { running: false, host: opts.host, port: opts.port, lastError: msg };
            this.emit();
            throw err;
        }

        this.child = child;
        this.status = {
            running: true,
            pid: child.pid,
            host: opts.host,
            port: opts.port,
            startedAt: Date.now(),
            lastError: undefined,
        };
        this.appendLifecycleLog(`started: pid=${child.pid ?? "unknown"} ${opts.host}:${opts.port}`);
        this.emit();

        child.stdout?.on("data", (chunk: Buffer) => this.appendLog(chunk.toString("utf8")));
        child.stderr?.on("data", (chunk: Buffer) => this.appendLog(chunk.toString("utf8")));

        child.on("error", (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.appendLog(`[launcher] spawn error: ${msg}\n`);
            this.status = { ...this.status, running: false, lastError: msg };
            this.child = null;
            this.appendLifecycleLog(`spawn error: ${msg}`);
            this.emit();
        });

        child.on("close", (code, signal) => {
            // Use 'close' instead of 'exit' so all stdout/stderr data has been
            // received before we snapshot the final state.
            const startedAt = this.status.startedAt;
            const lifetime = startedAt ? Date.now() - startedAt : Infinity;
            const shortLived = lifetime < 3000; // < 3s is suspicious

            let detail: string | undefined;
            if (code === 0 && !shortLived) {
                detail = undefined; // normal graceful exit
            } else if (code === 0 && shortLived) {
                detail = `exited code=0 signal=${signal ?? "null"} (short-lived: ${lifetime}ms — possible watchdog false-positive or silent failure)`;
            } else {
                detail = `exited code=${code ?? "null"} signal=${signal ?? "null"}`;
            }

            this.status = { ...this.status, running: false, lastError: detail };
            this.child = null;
            this.appendLifecycleLog(`closed: code=${code ?? "null"} signal=${signal ?? "null"} lifetime=${Number.isFinite(lifetime) ? `${lifetime}ms` : "unknown"}${detail ? ` detail=${detail}` : ""}`);
            this.emit();
        });

        // Wait briefly to catch fast-failures (missing script, syntax error,
        // module resolution failure, watchdog false-positive, etc.).
        // Events must be registered *before* this await.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const cp = this.child as unknown as { exitCode: number | null; signalCode: string | null } | null;
        if (!cp || cp.exitCode !== null || cp.signalCode !== null) {
            const reason = this.status.lastError || "HTTP server process exited immediately after spawn";
            this.appendLifecycleLog(`start failed after spawn: ${reason}`);
            throw new Error(reason);
        }
    }

    async stop(): Promise<void> {
        const c = this.child;
        if (!c) {
            this.appendLifecycleLog("stop skipped: no child process");
            return;
        }
        this.appendLifecycleLog(`stop requested: pid=${c.pid ?? "unknown"}`);
        await new Promise<void>((resolve) => {
            const done = () => {
                clearTimeout(forceTimer);
                this.appendLifecycleLog(`stop completed: pid=${c.pid ?? "unknown"}`);
                resolve();
            };
            c.once("exit", done);
            try {
                c.kill("SIGTERM");
            } catch {
                done();
                return;
            }
            const forceTimer = setTimeout(() => {
                try {
                    if (!c.killed) {
                        this.appendLifecycleLog(`stop timeout: force killing pid=${c.pid ?? "unknown"}`);
                        c.kill("SIGKILL");
                    }
                } catch { /* noop */ }
            }, 3000);
        });
        this.child = null;
    }

    private async cleanupStaleHttpProcesses(port: number): Promise<void> {
        const pids = this.findListeningPidsByPort(port)
            .filter((pid, index, list) => list.indexOf(pid) === index)
            .filter((pid) => pid !== process.pid)
            .filter((pid) => pid !== this.child?.pid);

        for (const pid of pids) {
            if (!this.isMatchingMcpServerProcess(pid)) continue;
            this.appendLog(`[launcher] reclaiming stale MCP HTTP process on port ${port}: pid=${pid}\n`);
            await this.terminateProcess(pid);
        }
    }

    private findListeningPidsByPort(port: number): number[] {
        if (!this.childProcess) return [];

        if (process.platform === "win32") {
            const result = this.runSync("netstat", ["-ano", "-p", "tcp"]);
            if (result.status !== 0) return [];
            const text = `${result.stdout ?? ""}`;
            return text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .filter((line) => line.startsWith("TCP"))
                .filter((line) => line.includes(`:${port}`))
                .filter((line) => /\bLISTENING\b/i.test(line))
                .map((line) => {
                    const parts = line.split(/\s+/);
                    return parseInt(parts[parts.length - 1] ?? "", 10);
                })
                .filter((pid) => Number.isInteger(pid) && pid > 0);
        }

        const result = this.runSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
        if (result.status !== 0) return [];
        return `${result.stdout ?? ""}`
            .split(/\r?\n/)
            .map((line) => parseInt(line.trim(), 10))
            .filter((pid) => Number.isInteger(pid) && pid > 0);
    }

    private isMatchingMcpServerProcess(pid: number): boolean {
        if (!this.childProcess || !this.isProcessAlive(pid)) return false;
        const command = this.getCommandLine(pid);
        if (!command) return false;
        return command.includes(this.serverScriptPath) && command.includes("--http");
    }

    private getCommandLine(pid: number): string {
        if (!this.childProcess) return "";

        if (process.platform === "win32") {
            const result = this.runSync("powershell.exe", [
                "-NoProfile",
                "-Command",
                `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
            ]);
            return `${result.stdout ?? ""}`.trim();
        }

        const result = this.runSync("ps", ["-p", String(pid), "-o", "command="]);
        return `${result.stdout ?? ""}`.trim();
    }

    private async terminateProcess(pid: number): Promise<void> {
        if (!this.isProcessAlive(pid)) return;
        this.killProcess(pid, "SIGTERM");
        const exitedAfterTerm = await this.waitForExit(pid, STALE_PROCESS_TERM_TIMEOUT_MS);
        if (exitedAfterTerm) return;
        this.killProcess(pid, "SIGKILL");
        await this.waitForExit(pid, STALE_PROCESS_KILL_TIMEOUT_MS);
    }

    private killProcess(pid: number, signal: NodeJS.Signals): void {
        try {
            process.kill(pid, signal);
        } catch {
            // ignore already-exited or inaccessible processes
        }
    }

    private async waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (!this.isProcessAlive(pid)) return true;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return !this.isProcessAlive(pid);
    }

    private isProcessAlive(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch (err: any) {
            // EPERM / EACCES = process exists but we lack permission to signal it.
            if (err.code === 'EPERM' || err.code === 'EACCES') {
                return true;
            }
            return false;
        }
    }

    private runSync(command: string, args: string[]): SpawnSyncReturns<string> {
        if (!this.childProcess?.spawnSync) {
            return {
                pid: 0,
                output: [],
                stdout: "",
                stderr: "",
                status: null,
                signal: null,
            } as SpawnSyncReturns<string>;
        }
        try {
            return this.childProcess.spawnSync(command, args, {
                encoding: "utf8",
                windowsHide: true,
            });
        } catch {
            return {
                pid: 0,
                output: [],
                stdout: "",
                stderr: "",
                status: null,
                signal: null,
            } as SpawnSyncReturns<string>;
        }
    }

    private appendLog(text: string): void {
        const lines = normalizeLogLines(text);
        if (lines.length === 0) return;
        this.logBuffer.push(...lines);
        if (this.logBuffer.length > MAX_LOG_LINES) {
            this.logBuffer = this.logBuffer.slice(-MAX_LOG_LINES);
        }
        pushGlobalLogLines(lines);
        this.emitLogs();
    }

    private appendLifecycleLog(message: string): void {
        this.appendLog(formatLauncherLogLine(`[launcher] ${message}`));
    }

    private emit(): void {
        const snapshot = this.getStatus();
        for (const fn of this.listeners) {
            try { fn(snapshot); } catch (err) { console.error("[MCP] launcher status listener error:", err); }
        }
    }

    private emitLogs(): void {
        const snapshot = getHttpLifecycleLogs();
        for (const fn of this.logListeners) {
            try { fn(snapshot); } catch (err) { console.error("[MCP] launcher log listener error:", err); }
        }
    }
}
