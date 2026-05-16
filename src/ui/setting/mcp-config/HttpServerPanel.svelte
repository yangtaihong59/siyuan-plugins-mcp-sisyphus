<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { showMessage } from "siyuan";

    import SettingPanel from "../../shared/setting-panel.svelte";
    import type { HttpServerStatus } from "../../server-launcher";
    import { hasValidHttpTlsFiles, regenerateHttpServerToken, savePersistedHttpServerSettings, type HttpServerSettings } from "../tool-config-storage";

    export let plugin: any;
    export let group: string;
    export let display = false;
    export let httpSettings: HttpServerSettings;
    export let getLabel: (key: string, fallback: string) => string;

    const CLI_COMMAND = "siyuan-sisyphus";
    const MCP_SERVER_NAME = "siyuan-sisyphus";
    const MCP_CLIENT_PRESETS = [
        {
            id: "claude-code",
            titleKey: "mcpPresetClaudeCodeTitle",
            titleFallback: "Claude Code",
            descKey: "mcpPresetClaudeCodeDesc",
            descFallback: "Copy .mcp.json / mcpServers JSON for Claude Code.",
        },
        {
            id: "kimi",
            titleKey: "mcpPresetKimiTitle",
            titleFallback: "Kimi Code",
            descKey: "mcpPresetKimiDesc",
            descFallback: "Copy ~/.kimi/mcp.json compatible configuration.",
        },
        {
            id: "opencode",
            titleKey: "mcpPresetOpenCodeTitle",
            titleFallback: "OpenCode",
            descKey: "mcpPresetOpenCodeDesc",
            descFallback: "Copy OpenCode opencode.jsonc mcp configuration.",
        },
        {
            id: "codex",
            titleKey: "mcpPresetCodexTitle",
            titleFallback: "Codex CLI",
            descKey: "mcpPresetCodexDesc",
            descFallback: "Copy ~/.codex/config.toml mcp_servers configuration.",
        },
        {
            id: "cherry-studio",
            titleKey: "mcpPresetCherryTitle",
            titleFallback: "Cherry Studio",
            descKey: "mcpPresetCherryDesc",
            descFallback: "Copy fields for Settings -> MCP Server -> Add server.",
        },
        {
            id: "cc-switch",
            titleKey: "mcpPresetCcSwitchTitle",
            titleFallback: "CC Switch",
            descKey: "mcpPresetCcSwitchDesc",
            descFallback: "Copy CC Switch server-map JSON.",
        },
        {
            id: "generic-json",
            titleKey: "mcpPresetGenericTitle",
            titleFallback: "Cursor / Generic JSON",
            descKey: "mcpPresetGenericDesc",
            descFallback: "Copy the common mcpServers JSON used by many MCP clients.",
        },
    ] as const;
    type McpClientPresetId = (typeof MCP_CLIENT_PRESETS)[number]["id"];
    const MCP_TRANSPORT_PRESETS = [
        {
            id: "stdio",
            titleKey: "mcpTransportStdioTitle",
            titleFallback: "stdio",
        },
        {
            id: "http",
            titleKey: "mcpTransportHttpTitle",
            titleFallback: "HTTP/HTTPS",
        },
    ] as const;
    type McpTransportId = (typeof MCP_TRANSPORT_PRESETS)[number]["id"];
    const CLI_SNIPPETS = [
        {
            titleKey: "cliGuideInstallTitle",
            titleFallback: "Install CLI",
            descKey: "cliGuideInstallDesc",
            descFallback: "Install the published package globally.",
            command: `npm i -g ${CLI_COMMAND}`,
        },
        {
            titleKey: "cliGuideInitTitle",
            titleFallback: "Initialize config",
            descKey: "cliGuideInitDesc",
            descFallback: "Create the local config file with API URL and token.",
            command: `${CLI_COMMAND} init`,
        },
        {
            titleKey: "cliGuideVerifyTitle",
            titleFallback: "Verify connection",
            descKey: "cliGuideVerifyDesc",
            descFallback: "Run a simple command to confirm connectivity.",
            command: `${CLI_COMMAND} notebook list`,
        },
        {
            titleKey: "cliGuideHelpTitle",
            titleFallback: "Discover commands",
            descKey: "cliGuideHelpDesc",
            descFallback: "List tools and inspect action help from the terminal.",
            command: `${CLI_COMMAND} list\n${CLI_COMMAND} help <tool> <action>`,
        },
    ] as const;

    let httpStatus: HttpServerStatus = { running: false, host: httpSettings.host, port: httpSettings.port };
    let httpRecentLogs: string[] = [];
    let httpDirty = false;
    let httpBusy = false;
    let httpUnsubStatus: (() => void) | null = null;
    let httpUnsubLogs: (() => void) | null = null;
    let selectedMcpClientPreset: McpClientPresetId = "claude-code";
    let selectedMcpTransport: McpTransportId = "stdio";
    $: changelogTitle = getLabel("toolSettingsChangelogTitle", "更新日志");
    $: changelogText = getLabel("toolSettingsChangelogText", "连接设置现按 MCP / CLI 分组，MCP 下再区分 HTTP/HTTPS 与 stdio。");

    onMount(() => {
        if (plugin?.httpLauncher) {
            httpStatus = plugin.httpLauncher.getStatus();
            httpRecentLogs = plugin.httpLauncher.getRecentLogs();
            httpUnsubStatus = plugin.httpLauncher.onStatusChange((s: HttpServerStatus) => {
                httpStatus = s;
            });
            httpUnsubLogs = plugin.httpLauncher.onLogsChange((lines: string[]) => {
                httpRecentLogs = lines;
            });
        }
    });

    onDestroy(() => {
        httpUnsubStatus?.();
        httpUnsubLogs?.();
    });

    function getWorkspaceScriptPath(): string {
        const workspaceDir = (window as any)?.siyuan?.config?.system?.workspaceDir;
        if (typeof workspaceDir !== "string" || !workspaceDir.trim()) {
            return "{SIYUAN_PATH}/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs";
        }
        return `${workspaceDir.replace(/[\\/]+$/, "")}/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs`;
    }

    function getSiYuanApiToken(): string {
        const token = (window as any)?.siyuan?.config?.api?.token;
        if (typeof token !== "string" || !token.trim()) {
            return "xxxxxx";
        }
        return token;
    }

    function onTlsEnabledChange(event: Event) {
        const target = event.currentTarget as HTMLInputElement;
        httpSettings = { ...httpSettings, tlsEnabled: target.checked };
        httpDirty = true;
    }

    function getTlsMissingFilesMessage(): string {
        return getLabel("httpTlsMissingFiles", "⚠️ Cert and Key file paths are required for HTTPS.");
    }

    function validateTlsBeforeStart(): boolean {
        if (hasValidHttpTlsFiles(httpSettings)) {
            return true;
        }
        showMessage(getTlsMissingFilesMessage());
        return false;
    }

    function getHttpMcpUrl(s: HttpServerSettings): string {
        const scheme = s.tlsEnabled ? "https" : "http";
        return `${scheme}://${s.host}:${s.port}/mcp`;
    }

    function getHttpAuthHeaders(s: HttpServerSettings): Record<string, string> | undefined {
        return s.authEnabled ? { Authorization: `Bearer ${s.token}` } : undefined;
    }

    function getStdioServerConfig(includeType = false) {
        const config: any = {
            command: "node",
            args: [getWorkspaceScriptPath()],
            env: {
                SIYUAN_API_URL: "http://127.0.0.1:6806",
                SIYUAN_TOKEN: getSiYuanApiToken(),
            },
        };
        if (includeType) config.type = "stdio";
        return config;
    }

    function generateClaudeCodeConfig(s: HttpServerSettings, mode: McpTransportId): string {
        const url = getHttpMcpUrl(s);
        if (mode === "http") {
            const headers = getHttpAuthHeaders(s);
            const obj: any = { mcpServers: { [MCP_SERVER_NAME]: { type: "http", url } } };
            if (headers) obj.mcpServers[MCP_SERVER_NAME].headers = headers;
            return JSON.stringify(obj, null, 2);
        }
        return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: getStdioServerConfig(true) } }, null, 2);
    }

    function generateCursorJsonConfig(s: HttpServerSettings, mode: McpTransportId): string {
        if (mode === "http") {
            const server: any = { url: getHttpMcpUrl(s) };
            const headers = getHttpAuthHeaders(s);
            if (headers) server.headers = headers;
            return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
        }
        return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: getStdioServerConfig() } }, null, 2);
    }

    function tomlString(value: string): string {
        return JSON.stringify(value);
    }

    function generateCodexConfig(s: HttpServerSettings, transport: McpTransportId): string {
        if (transport === "stdio") {
            const stdio = getStdioServerConfig();
            return [
                `[mcp_servers.${MCP_SERVER_NAME}]`,
                `command = ${tomlString(stdio.command)}`,
                `args = [${stdio.args.map(tomlString).join(", ")}]`,
                `env = { "SIYUAN_API_URL" = ${tomlString(stdio.env.SIYUAN_API_URL)}, "SIYUAN_TOKEN" = ${tomlString(stdio.env.SIYUAN_TOKEN)} }`,
                "enabled = true",
            ].join("\n");
        }
        const lines = [
            `[mcp_servers.${MCP_SERVER_NAME}]`,
            `url = ${tomlString(getHttpMcpUrl(s))}`,
            "enabled = true",
        ];
        if (s.authEnabled) {
            lines.push(`http_headers = { "Authorization" = ${tomlString(`Bearer ${s.token}`)} }`);
        }
        return lines.join("\n");
    }

    function generateKimiConfig(s: HttpServerSettings, transport: McpTransportId): string {
        if (transport === "stdio") {
            return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: getStdioServerConfig() } }, null, 2);
        }
        const server: any = { url: getHttpMcpUrl(s), transport: "http" };
        const headers = getHttpAuthHeaders(s);
        if (headers) server.headers = headers;
        return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
    }

    function generateOpenCodeConfig(s: HttpServerSettings, transport: McpTransportId): string {
        const stdio = getStdioServerConfig();
        const server: any = transport === "http"
            ? {
                type: "remote",
                url: getHttpMcpUrl(s),
                enabled: true,
            }
            : {
                type: "local",
                command: [stdio.command, ...stdio.args],
                enabled: true,
                environment: stdio.env,
            };
        const headers = getHttpAuthHeaders(s);
        if (transport === "http" && headers) server.headers = headers;
        return JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcp: { [MCP_SERVER_NAME]: server },
        }, null, 2);
    }

    function generateCherryStudioConfig(s: HttpServerSettings, transport: McpTransportId): string {
        if (transport === "http") {
            const server: any = {
                type: "streamableHttp",
                url: getHttpMcpUrl(s),
                headers: { "Content-Type": "application/json" },
            };
            if (s.authEnabled) {
                server.headers["Authorization"] = `Bearer ${s.token}`;
            }
            return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
        }
        const stdio = getStdioServerConfig();
        const server: any = {
            command: stdio.command,
            args: stdio.args,
        };
        if (stdio.env && Object.keys(stdio.env).length > 0) {
            server.env = stdio.env;
        }
        return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
    }

    function generateCcSwitchConfig(s: HttpServerSettings, transport: McpTransportId): string {
        if (transport === "stdio") {
            return JSON.stringify({ [MCP_SERVER_NAME]: getStdioServerConfig() }, null, 2);
        }
        const server: any = {
            type: "http",
            url: getHttpMcpUrl(s),
        };
        const headers = getHttpAuthHeaders(s);
        if (headers) server.headers = headers;
        return JSON.stringify({ [MCP_SERVER_NAME]: server }, null, 2);
    }

    function generatePresetSnippet(s: HttpServerSettings, preset: McpClientPresetId, transport: McpTransportId): string {
        if (preset === "claude-code") return generateClaudeCodeConfig(s, transport);
        if (preset === "kimi") return generateKimiConfig(s, transport);
        if (preset === "opencode") return generateOpenCodeConfig(s, transport);
        if (preset === "codex") return generateCodexConfig(s, transport);
        if (preset === "cherry-studio") return generateCherryStudioConfig(s, transport);
        if (preset === "cc-switch") return generateCcSwitchConfig(s, transport);
        return generateCursorJsonConfig(s, transport);
    }

    async function copyText(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            showMessage(getLabel("copySuccess", "✅ Copied"));
        } catch {
            showMessage(getLabel("copyFailed", "Failed to copy to clipboard"));
        }
    }

    async function persistHttpSettings(next: HttpServerSettings, restart: boolean) {
        if (!plugin) return;
        if (restart && typeof plugin.updateHttpServerSettings === "function") {
            httpBusy = true;
            try {
                httpSettings = await plugin.updateHttpServerSettings(next);
            } finally {
                httpBusy = false;
            }
        } else if (typeof plugin.setHttpServerSettings === "function") {
            httpSettings = await plugin.setHttpServerSettings(next);
        } else {
            httpSettings = await savePersistedHttpServerSettings(next, plugin);
        }
        httpDirty = false;
    }

    async function toggleHttpServer() {
        if (!plugin?.httpLauncher) {
            showMessage(getLabel("httpUnsupported", "HTTP server is only available in the SiYuan desktop app."));
            return;
        }
        httpBusy = true;
        try {
            if (httpStatus.running) {
                await plugin.stopHttpServer();
            } else {
                if (!validateTlsBeforeStart()) {
                    return;
                }
                if (httpDirty) {
                    await persistHttpSettings(httpSettings, false);
                }
                await plugin.startHttpServer();
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showMessage(`${getLabel("httpStartError", "HTTP server error")}: ${msg}`);
        } finally {
            httpBusy = false;
        }
    }

    async function applyHttpSettings() {
        if (!validateTlsBeforeStart()) {
            return;
        }
        await persistHttpSettings(httpSettings, true);
        showMessage(getLabel("httpSettingsSaved", "✅ HTTP server settings saved"));
    }

    function regenerateToken() {
        httpSettings = regenerateHttpServerToken(httpSettings);
        httpDirty = true;
    }

    function markHttpDirty() {
        httpDirty = true;
    }

    async function toggleHttpAutoStart(value: boolean) {
        const next = { ...httpSettings, enabled: value };
        await persistHttpSettings(next, false);
    }

    async function onHttpAutoStartChange(event: Event) {
        const target = event.currentTarget as HTMLInputElement;
        await toggleHttpAutoStart(target.checked);
    }

    function onHttpAuthChange(event: Event) {
        const target = event.currentTarget as HTMLInputElement;
        httpSettings = { ...httpSettings, authEnabled: target.checked };
        httpDirty = true;
    }
</script>

<SettingPanel {group} settingItems={[]} {display}>
    <div class="http-server-section">
        <section class="http-changelog" aria-labelledby="tool-settings-changelog-title">
            <div id="tool-settings-changelog-title" class="http-changelog-title">{changelogTitle}</div>
            <textarea class="b3-text-field http-changelog-text" readonly aria-label={changelogTitle}>{changelogText}</textarea>
        </section>

        <section class="http-overview" aria-labelledby="connection-overview-title">
            <div id="connection-overview-title" class="http-overview-title">{getLabel("connectionOverviewTitle", "先看这里")}</div>
            <div class="http-choice-card">
                <table class="http-choice-table">
                    <thead>
                        <tr>
                            <th>{getLabel("connectionTableScene", "思源安装方式")}</th>
                            <th>{getLabel("connectionTableRecommended", "推荐连接方式")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>{getLabel("connectionTableDesktop", "桌面端（Windows / macOS / Linux）")}</td>
                            <td>{getLabel("connectionTableDesktopModes", "stdio 或 HTTP 或 CLI")}</td>
                        </tr>
                        <tr>
                            <td>{getLabel("connectionTableRemote", "Docker")}</td>
                            <td>{getLabel("connectionTableRemoteModes", "stdio 或 CLI")}</td>
                        </tr>
                        <tr>
                            <td>{getLabel("connectionTableMobile", "手机端")}</td>
                            <td>{getLabel("connectionTableMobileModes", "CLI")}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <details class="http-guide">
            <summary>{getLabel("mcpGuideTitle", "MCP 连接")}</summary>
            <div class="http-guide-content">

                <div class="mcp-client-presets">
                    <div class="mcp-client-presets-title">{getLabel("mcpClientPresetsTitle", "常用客户端配置")}</div>
                    <div class="mcp-client-preset-row">
                        <label class="mcp-client-preset-select">
                            <span class="http-label">{getLabel("mcpClientPresetSelectLabel", "客户端")}</span>
                            <select class="b3-select" bind:value={selectedMcpClientPreset}>
                                {#each MCP_CLIENT_PRESETS as preset}
                                    <option value={preset.id}>{getLabel(preset.titleKey, preset.titleFallback)}</option>
                                {/each}
                            </select>
                        </label>
                        <label class="mcp-client-preset-select">
                            <span class="http-label">{getLabel("mcpTransportSelectLabel", "连接方式")}</span>
                            <select class="b3-select" bind:value={selectedMcpTransport}>
                                {#each MCP_TRANSPORT_PRESETS as transport}
                                    <option value={transport.id}>{getLabel(transport.titleKey, transport.titleFallback)}</option>
                                {/each}
                            </select>
                        </label>
                        <button class="b3-button b3-button--outline" on:click={() => copyText(generatePresetSnippet(httpSettings, selectedMcpClientPreset, selectedMcpTransport))}>
                            {getLabel("mcpClientPresetCopy", "复制配置")}
                        </button>
                    </div>
                    <pre>{generatePresetSnippet(httpSettings, selectedMcpClientPreset, selectedMcpTransport)}</pre>
                    <div class="http-note">
                        {#each MCP_CLIENT_PRESETS as preset}
                            {#if preset.id === selectedMcpClientPreset}
                                {getLabel(preset.descKey, preset.descFallback)}
                            {/if}
                        {/each}
                    </div>
                    <div class="http-note">{getLabel("mcpClientPresetsNote", "先选择客户端和连接方式，再复制对应格式。stdio 会使用当前思源插件目录下的 mcp-server.cjs；HTTP/HTTPS 会使用当前服务地址。")}</div>
                </div>

                <details class="http-subproject">
                    <summary class="http-subproject-summary">
                        <span>{getLabel("httpClientSnippet", "HTTP/HTTPS 连接")}</span>
                        <span class="http-summary-status">
                            <span class="http-status-dot" class:running={httpStatus.running}></span>
                            {httpStatus.running ? getLabel("httpStatusRunning", "Running") : getLabel("httpStatusStopped", "Stopped")}
                        </span>
                    </summary>
                    <div class="http-guide-content">
                        <div class="http-guide-intro">{getLabel("mcpHttpGuideDesc", "适合桌面端直连、WSL、局域网和跨机器访问。开启 TLS 后就是 HTTPS。")}</div>

                        <div class="http-status-row">
                            <span class="http-status-dot" class:running={httpStatus.running}></span>
                            {#if httpStatus.running}
                                <span class="http-status-text">
                                    {getLabel("httpStatusRunning", "Running")}: <code>{httpSettings.tlsEnabled ? "https" : "http"}://{httpStatus.host}:{httpStatus.port}/mcp</code>
                                    {#if httpStatus.pid} (PID {httpStatus.pid}){/if}
                                </span>
                            {:else}
                                <span class="http-status-text">{getLabel("httpStatusStopped", "Stopped")}</span>
                                {#if httpStatus.lastError}
                                    <span class="http-error">{httpStatus.lastError}</span>
                                {/if}
                            {/if}
                        </div>

                        {#if !plugin?.httpLauncher}
                            <div class="http-warning">{getLabel("httpUnsupported", "HTTP server is only available in the SiYuan desktop app.")}</div>
                        {/if}

                        <div class="http-actions">
                            <button class="b3-button b3-button--outline" on:click={toggleHttpServer} disabled={httpBusy || !plugin?.httpLauncher}>
                                {httpStatus.running ? getLabel("httpStop", "Stop") : getLabel("httpStart", "Start")}
                            </button>
                            <button class="b3-button b3-button--outline" on:click={applyHttpSettings} disabled={httpBusy || !httpDirty}>
                                {getLabel("httpApply", "Apply & Restart")}
                            </button>
                        </div>

                        <div class="http-form">
                            <label class="http-field">
                                <input type="checkbox" checked={httpSettings.enabled} on:change={onHttpAutoStartChange} />
                                {getLabel("httpAutoStart", "Auto-start with SiYuan")}
                            </label>

                            <label class="http-field">
                                <span class="http-label">{getLabel("httpHost", "Host")}</span>
                                <input type="text" class="b3-text-field" bind:value={httpSettings.host} on:input={markHttpDirty} placeholder="127.0.0.1" />
                            </label>

                            <label class="http-field">
                                <span class="http-label">{getLabel("httpPort", "Port")}</span>
                                <input type="number" class="b3-text-field" bind:value={httpSettings.port} on:input={markHttpDirty} min="1" max="65535" />
                            </label>

                            <label class="http-field">
                                <input type="checkbox" checked={httpSettings.authEnabled} on:change={onHttpAuthChange} />
                                {getLabel("httpEnableAuth", "Require Bearer token")}
                            </label>

                            {#if httpSettings.authEnabled}
                                <div class="http-field http-token-row">
                                    <span class="http-label">{getLabel("httpToken", "Token")}</span>
                                    <input type="text" class="b3-text-field http-token-input" readonly value={httpSettings.token} />
                                    <button class="b3-button b3-button--outline" on:click={() => copyText(httpSettings.token)}>{getLabel("httpCopy", "Copy")}</button>
                                    <button class="b3-button b3-button--outline" on:click={regenerateToken}>{getLabel("httpRegenerate", "Regenerate")}</button>
                                </div>
                            {/if}

                            <label class="http-field">
                                <input type="checkbox" checked={httpSettings.tlsEnabled} on:change={onTlsEnabledChange} />
                                {getLabel("httpEnableTls", "Enable HTTPS (TLS)")}
                            </label>

                            {#if httpSettings.tlsEnabled}
                                <label class="http-field">
                                    <span class="http-label">{getLabel("httpTlsCert", "Cert")}</span>
                                    <input type="text" class="b3-text-field http-path-input" bind:value={httpSettings.tlsCertFile} on:input={markHttpDirty} placeholder={getLabel("httpTlsCertPlaceholder", "/path/to/cert.pem")} />
                                </label>
                                <label class="http-field">
                                    <span class="http-label">{getLabel("httpTlsKey", "Key")}</span>
                                    <input type="text" class="b3-text-field http-path-input" bind:value={httpSettings.tlsKeyFile} on:input={markHttpDirty} placeholder={getLabel("httpTlsKeyPlaceholder", "/path/to/key.pem")} />
                                </label>
                                <label class="http-field">
                                    <span class="http-label">{getLabel("httpTlsCa", "CA")}</span>
                                    <input type="text" class="b3-text-field http-path-input" bind:value={httpSettings.tlsCaFile} on:input={markHttpDirty} placeholder={getLabel("httpTlsCaPlaceholder", "/path/to/ca.pem (optional)")} />
                                </label>
                                {#if !hasValidHttpTlsFiles(httpSettings)}
                                    <div class="http-warning">{getTlsMissingFilesMessage()}</div>
                                {/if}
                            {/if}
                        </div>

                        {#if httpSettings.host !== "127.0.0.1" && httpSettings.host !== "localhost" && !httpSettings.authEnabled}
                            <div class="http-warning">{getLabel("httpWarnExposedNoAuth", "⚠️ Bound to a non-loopback address with auth disabled. Other devices on the network can access your SiYuan workspace.")}</div>
                        {/if}

                    </div>
                </details>

                <details class="http-snippet">
                    <summary>{getLabel("httpRecentLogs", "Recent server logs")}</summary>
                    <pre class="http-log-box">{httpRecentLogs.length ? httpRecentLogs.join("\n") : getLabel("httpNoLogs", "(no logs yet)")}</pre>
                </details>
            </div>
        </details>

        <details class="http-guide">
            <summary>
                {getLabel("cliGuideTitle", "CLI 连接")}
                <span class="cli-preview-badge">{getLabel("cliPreviewBadge", "Preview")}</span>
            </summary>
            <div class="http-guide-content">
                <div class="http-guide-intro">{getLabel("cliGuideDesc", "CLI 直接通过 SiYuan HTTP API 连接，不依赖 MCP server。适合终端、脚本、自动化任务。")}</div>
                <div class="http-note">{getLabel("cliChooseDesc", "如果你不是在给 MCP 客户端配工具，而是想自己在终端里执行 `siyuan-sisyphus ...` 命令，就选 CLI。")}</div>

                {#each CLI_SNIPPETS as snippet}
                    <div class="http-snippet cli-snippet">
                        <div class="cli-snippet-meta">
                            <div class="cli-snippet-title">{getLabel(snippet.titleKey, snippet.titleFallback)}</div>
                            <div class="cli-snippet-desc">{getLabel(snippet.descKey, snippet.descFallback)}</div>
                        </div>
                        <pre>{snippet.command}</pre>
                        <button class="b3-button b3-button--outline" on:click={() => copyText(snippet.command)}>{getLabel("httpCopy", "Copy")}</button>
                    </div>
                {/each}
            </div>
        </details>
    </div>
</SettingPanel>

<style lang="scss">
    .http-server-section {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        font-size: 13px;

        .http-changelog {
            background: var(--b3-theme-surface);
            border-radius: 6px;
            padding: 10px 12px;
        }

        .http-overview {
            background: var(--b3-theme-surface);
            border-radius: 6px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .http-overview-title {
            color: var(--b3-theme-primary);
            font-weight: 600;
        }

        .http-overview-text {
            color: var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
            line-height: 1.5;
        }

        .http-changelog-title {
            color: var(--b3-theme-primary);
            font-weight: 600;
            margin-bottom: 8px;
        }

        .http-changelog-text {
            box-sizing: border-box;
            min-height: 4.5em;
            resize: vertical;
            width: 100%;
        }

        .http-status-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .http-status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--b3-theme-error, #d33);
            display: inline-block;
        }

        .http-status-dot.running {
            background: var(--b3-theme-success, #3b3);
        }

        .http-status-text code {
            background: var(--b3-theme-surface);
            padding: 1px 6px;
            border-radius: 3px;
        }

        .http-error {
            color: var(--b3-theme-error, #d33);
        }

        .http-warning {
            padding: 8px 12px;
            background: var(--b3-card-warning-background, rgba(255, 180, 0, 0.12));
            border-left: 3px solid var(--b3-theme-warning, #e0a000);
            border-radius: 3px;
            color: var(--b3-card-warning-color, inherit);
        }

        .http-actions {
            display: flex;
            gap: 8px;
        }

        .http-form {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .http-field {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .http-label {
            min-width: 60px;
        }

        .http-token-row {
            .http-token-input {
                flex: 1;
                min-width: 240px;
                font-family: monospace;
                font-size: 12px;
            }
        }

        .http-path-input {
            flex: 1;
            min-width: 280px;
            font-family: monospace;
            font-size: 12px;
        }

        .http-snippet {
            background: var(--b3-theme-surface);
            border-radius: 4px;
            padding: 8px 12px;

            summary {
                cursor: pointer;
                user-select: none;
            }

            pre {
                margin: 8px 0;
                padding: 8px;
                background: var(--b3-theme-background);
                border-radius: 3px;
                overflow: auto;
                max-height: 200px;
                font-size: 12px;
            }
        }

        .http-log-box {
            white-space: pre-wrap;
            word-break: break-all;
        }

        .http-guide {
            background: var(--b3-theme-surface);
            border-radius: 6px;
            padding: 10px 12px;

            > summary {
                cursor: pointer;
                user-select: none;
                font-weight: 600;
            }
        }

        .http-guide-content {
            margin-top: 10px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .http-choice-card,
        .http-subproject {
            background: var(--b3-theme-background);
            border-radius: 6px;
            padding: 10px 12px;
        }

        .http-subproject > summary {
            cursor: pointer;
            user-select: none;
            font-weight: 600;
        }

        .http-subproject-summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
        }

        .http-subproject-summary::before {
            content: "";
            display: inline-block;
            width: 0;
            height: 0;
            margin-right: 2px;
            border-top: 5px solid transparent;
            border-bottom: 5px solid transparent;
            border-left: 6px solid var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
            transition: transform 0.15s ease;
        }

        .http-subproject[open] > .http-subproject-summary::before {
            transform: rotate(90deg);
        }

        .http-subproject-summary > span:first-child {
            margin-right: auto;
        }

        .http-summary-status {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
            font-size: 12px;
            font-weight: 500;
        }

        .http-choice-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;

            th,
            td {
                padding: 8px 10px;
                border: 1px solid var(--b3-border-color);
                text-align: left;
                vertical-align: top;
            }

            th {
                background: var(--b3-theme-surface);
                font-weight: 600;
            }
        }

        .http-choice-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            line-height: 1.6;
        }

        .http-guide-intro {
            color: var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
            line-height: 1.5;
        }

        .http-note {
            color: var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
            line-height: 1.6;
        }

        .mcp-client-presets {
            background: var(--b3-theme-surface);
            border-radius: 4px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .mcp-client-presets-title {
            color: var(--b3-theme-primary);
            font-weight: 600;
        }

        .mcp-client-preset-row {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }

        .mcp-client-preset-select {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .mcp-client-presets pre {
            margin: 0;
            padding: 8px;
            background: var(--b3-theme-background);
            border-radius: 3px;
            overflow: auto;
            max-height: 220px;
            font-size: 12px;
        }

        .cli-snippet {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .cli-snippet-meta {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .cli-snippet-title {
            font-weight: 600;
        }

        .cli-snippet-desc {
            color: var(--b3-theme-on-surface-light, var(--b3-theme-on-surface));
            line-height: 1.5;
        }

        .cli-preview-badge {
            display: inline-block;
            margin-left: 6px;
            padding: 1px 6px;
            font-size: 11px;
            font-weight: 500;
            line-height: 1.4;
            color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest, rgba(0, 0, 0, 0.05));
            border: 1px solid var(--b3-theme-primary-light, var(--b3-theme-primary));
            border-radius: 10px;
            vertical-align: middle;
        }
    }

    @media (max-width: 768px) {
        .http-server-section {
            padding: 10px;
            gap: 10px;
        }

        .http-token-input,
        .http-path-input {
            min-width: auto;
            width: 100%;
        }

        .http-choice-table {
            font-size: 12px;

            th,
            td {
                padding: 6px 8px;
            }
        }

        .http-field {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
        }

        .http-label {
            min-width: auto;
        }

        .mcp-client-preset-row,
        .mcp-client-preset-select {
            width: 100%;
            align-items: flex-start;
        }

        .mcp-client-preset-select {
            flex-direction: column;
            gap: 4px;
        }

        .mcp-client-preset-select select {
            width: 100%;
        }
    }
</style>
