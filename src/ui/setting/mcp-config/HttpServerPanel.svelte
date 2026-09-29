<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { showMessage } from "siyuan";

    import SettingPanel from "../../shared/setting-panel.svelte";
    import { getHttpLifecycleLogs, onHttpLifecycleLogsChange, type HttpServerStatus } from "@/server-launcher";
    import { HTTP_BIND_HOST_OPTIONS, hasValidHttpTlsFiles, regenerateHttpServerToken, savePersistedHttpServerSettings, type HttpServerHost, type HttpServerSettings } from "../tool-config-storage";

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
    let httpUnsubLifecycleLogs: (() => void) | null = null;
    let selectedMcpClientPreset: McpClientPresetId = "claude-code";
    let preferredMcpTransport: McpTransportId | null = null;
    $: selectedMcpTransport = preferredMcpTransport ?? (httpStatus.running ? "http" : "stdio");
    let changelogExpanded = false;
    $: changelogTitle = getLabel("toolSettingsChangelogTitle", "更新日志");
    $: changelogText = getLabel("toolSettingsChangelogText", "连接设置现按 MCP / CLI 分组，MCP 下再区分 HTTP/HTTPS 与 stdio。");
    $: changelogEntries = parseChangelogEntries(changelogText);
    $: visibleChangelogEntries = changelogExpanded ? changelogEntries : changelogEntries.slice(0, 1);
    $: httpSupportReason = plugin?.httpLauncher ? "" : getHttpUnsupportedReason();

    function parseChangelogDescription(description: string): Array<{ text: string; strong: boolean }> {
        const segments: Array<{ text: string; strong: boolean }> = [];
        const strongPattern = /\*\*(.+?)\*\*/g;
        let cursor = 0;
        for (const match of description.matchAll(strongPattern)) {
            const index = match.index ?? 0;
            if (index > cursor) segments.push({ text: description.slice(cursor, index), strong: false });
            segments.push({ text: match[1], strong: true });
            cursor = index + match[0].length;
        }
        if (cursor < description.length) segments.push({ text: description.slice(cursor), strong: false });
        return segments.length > 0 ? segments : [{ text: description, strong: false }];
    }

    function parseChangelogEntries(text: string): Array<{ version: string; date: string; description: string; segments: Array<{ text: string; strong: boolean }> }> {
        return text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const match = line.match(/^`?([^`\s]+)`?(?:\s*·\s*(\d{4}-\d{2}-\d{2}))?\s*[—–]\s*(.+)$/);
                const description = match ? match[3] : line;
                return {
                    version: match?.[1] ?? "",
                    date: match?.[2] ?? "",
                    description: description.replace(/\*\*/g, ""),
                    segments: parseChangelogDescription(description),
                };
            });
    }

    onMount(() => {
        httpRecentLogs = getHttpLifecycleLogs();
        httpUnsubLifecycleLogs = onHttpLifecycleLogsChange((lines: string[]) => {
            httpRecentLogs = lines;
        });
        if (plugin?.httpLauncher) {
            httpStatus = plugin.httpLauncher.getStatus();
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
        httpUnsubLifecycleLogs?.();
    });

    function getHttpUnsupportedReason(): string {
        const reason = plugin?.getHttpServerSupportInfo?.()?.reason;
        if (typeof reason === "string" && reason) {
            return reason;
        }
        return "";
    }

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

    function replacePromptTokens(template: string, values: Record<string, string>): string {
        return Object.entries(values).reduce(
            (result, [key, value]) => result.split(`{{${key}}}`).join(value),
            template,
        );
    }

    function getSelectedMcpClientTitle(): string {
        const preset = MCP_CLIENT_PRESETS.find((item) => item.id === selectedMcpClientPreset);
        return preset
            ? getLabel(preset.titleKey, preset.titleFallback)
            : selectedMcpClientPreset;
    }

    function getSelectedMcpTransportTitle(): string {
        const transport = MCP_TRANSPORT_PRESETS.find((item) => item.id === selectedMcpTransport);
        return transport
            ? getLabel(transport.titleKey, transport.titleFallback)
            : selectedMcpTransport;
    }

    function generateMcpAiSetupPrompt(): string {
        const fallback = `Configure SiYuan Sisyphus MCP in my current AI client.

Target client preset: {{client}}
Transport: {{transport}}

Use this configuration:
\`\`\`{{format}}
{{config}}
\`\`\`

You are authorized to inspect and update the current client's MCP configuration. Please:
1. If I have not already specified the configuration scope, ask whether I want user-wide/global configuration or configuration for the current project/workspace, and wait for my answer before making changes. Then detect the OS and locate the configuration entry for that scope. If the client does not support the chosen scope, explain that limitation before changing another scope.
2. Read the existing configuration first, merge only the "{{serverName}}" server entry, and preserve all other servers and settings.
3. Treat every token in this prompt as a secret. Do not echo it in logs, summaries, or your final response.
4. For stdio, verify that Node.js and the server script exist. For HTTP/HTTPS, verify that the endpoint is reachable; if the service is stopped, tell me what must be enabled in SiYuan.
5. Reload or reconnect the MCP client as required, then verify the connection by listing tools or calling a harmless read-only action.
6. Report the files or settings changed and the verification result without exposing credentials.

If you cannot edit the client configuration directly, provide the exact target path and commands or UI steps instead.`;
        return replacePromptTokens(
            getLabel("mcpAiSetupPrompt", fallback),
            {
                client: getSelectedMcpClientTitle(),
                transport: getSelectedMcpTransportTitle(),
                format: selectedMcpClientPreset === "codex" ? "toml" : "json",
                config: generatePresetSnippet(httpSettings, selectedMcpClientPreset, selectedMcpTransport),
                serverName: MCP_SERVER_NAME,
            },
        );
    }

    function generateCliAiSetupPrompt(): string {
        const fallback = `Configure the SiYuan Sisyphus CLI in my current environment.

Connection:
- API URL: {{apiUrl}}
- API token: {{apiToken}}
- Profile: default

You are authorized to install or update the published siyuan-sisyphus npm package and update its own CLI configuration. Please:
1. Detect the current OS and confirm that Node.js and npm are available.
2. Install or update siyuan-sisyphus globally.
3. Inspect existing Sisyphus profiles first. Create or update the "default" profile with the API URL and token above, make it active, and preserve unrelated profiles.
4. Treat the token as a secret. Do not echo it in logs, summaries, shell history where avoidable, or your final response.
5. Run read-only verification with "siyuan-sisyphus --version", "siyuan-sisyphus config list", and "siyuan-sisyphus notebook list".
6. Report the installed version, configuration path, active profile, and verification result without exposing the token.

If the API URL is not reachable from the current host, container, WSL, or remote environment, determine the correct route to this SiYuan instance and explain the required adjustment before changing it.`;
        return replacePromptTokens(
            getLabel("cliAiSetupPrompt", fallback),
            {
                apiUrl: getSiYuanApiUrl(),
                apiToken: getSiYuanApiToken(),
            },
        );
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

    function getHttpHostOptionLabel(host: HttpServerHost): string {
        if (host === "0.0.0.0") {
            return getLabel("httpHostAllInterfaces", "0.0.0.0 (all IPv4 interfaces)");
        }
        return getLabel("httpHostLoopback", "127.0.0.1 (local machine only)");
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

    function onSkillsExtensionChange(event: Event) {
        const target = event.currentTarget as HTMLInputElement;
        httpSettings = { ...httpSettings, skillsExtensionEnabled: target.checked };
        httpDirty = true;
    }

</script>

<SettingPanel {group} settingItems={[]} {display}>
    <div class="http-server-section">
        <section
            class="http-changelog"
            class:http-changelog--expanded={changelogExpanded}
            aria-labelledby="tool-settings-changelog-title"
        >
            <span class="http-changelog-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                    <path d="m12 2 1.55 4.45L18 8l-4.45 1.55L12 14l-1.55-4.45L6 8l4.45-1.55L12 2Zm6.25 10.5.95 2.3 2.3.95-2.3.95-.95 2.3-.95-2.3-2.3-.95 2.3-.95.95-2.3ZM6 14l1.2 3.3L10.5 18l-3.3 1.2L6 22.5l-1.2-3.3L1.5 18l3.3-.7L6 14Z"/>
                </svg>
            </span>
            <div class="http-changelog-copy">
                <button
                    type="button"
                    class="http-changelog-toggle"
                    aria-expanded={changelogExpanded}
                    aria-controls="tool-settings-changelog-list"
                    on:click={() => changelogExpanded = !changelogExpanded}
                >
                    <span id="tool-settings-changelog-title" class="http-changelog-title">{changelogTitle}</span>
                    <span class="http-changelog-toggle__action">
                        {changelogExpanded
                            ? getLabel("toolSettingsChangelogCollapse", "收起")
                            : getLabel("toolSettingsChangelogExpand", "展开")}
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m7 10 5 5 5-5z"/>
                        </svg>
                    </span>
                </button>
                <ol
                    id="tool-settings-changelog-list"
                    class="http-changelog-timeline"
                    class:http-changelog-timeline--collapsed={!changelogExpanded}
                >
                    {#each visibleChangelogEntries as entry, index}
                        <li class:http-changelog-timeline__item--latest={index === 0} class="http-changelog-timeline__item">
                            <div class="http-changelog-timeline__meta">
                                {#if entry.version}
                                    <code>{entry.version}</code>
                                {/if}
                                {#if entry.date}
                                    <time datetime={entry.date}>{entry.date}</time>
                                {/if}
                                {#if index === 0}
                                    <span>{getLabel("toolSettingsChangelogBadge", "Latest")}</span>
                                {/if}
                            </div>
                            <p title={entry.description}>
                                {#each entry.segments as segment}
                                    {#if segment.strong}<strong>{segment.text}</strong>{:else}{segment.text}{/if}
                                {/each}
                            </p>
                        </li>
                    {/each}
                </ol>
            </div>
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
                <div class="ai-setup-card">
                    <div class="ai-setup-card__copy">
                        <div class="ai-setup-card__title">{getLabel("mcpAiSetupTitle", "Let AI configure MCP")}</div>
                        <div class="ai-setup-card__desc">{getLabel("mcpAiSetupDesc", "Copy a prompt containing the selected client, transport, and exact connection config so a trusted AI can merge and verify it for you.")}</div>
                        <div class="ai-setup-card__warning">{getLabel("aiSetupSecretWarning", "The copied prompt contains connection credentials. Share it only with an AI you trust.")}</div>
                    </div>
                    <button class="b3-button b3-button--outline ai-setup-card__button" on:click={() => copyText(generateMcpAiSetupPrompt())}>
                        {getLabel("copyPromptForAi", "Copy prompt for AI")}
                    </button>
                </div>

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
                            <select class="b3-select" value={selectedMcpTransport} on:change={(event) => preferredMcpTransport = event.currentTarget.value === "http" ? "http" : "stdio"}>
                                {#each MCP_TRANSPORT_PRESETS as transport}
                                    <option value={transport.id}>{getLabel(transport.titleKey, transport.titleFallback)}</option>
                                {/each}
                            </select>
                        </label>
                        <button class="b3-button b3-button--outline" on:click={() => copyText(generatePresetSnippet(httpSettings, selectedMcpClientPreset, selectedMcpTransport))}>
                            {getLabel("mcpClientPresetCopy", "复制配置")}
                        </button>
                    </div>
                    <div class="http-note">{getLabel("mcpTransportRecommendation", "Prefer HTTP/HTTPS when available: its fixed MCP address automatically follows the current workspace’s changing kernel port. Give each workspace a different MCP port. stdio uses port 6806, which belongs to the first workspace started, so it cannot reliably select another workspace; its API token must match that workspace.")}</div>
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
                            <div class="http-warning">
                                {getLabel("httpUnsupported", "HTTP server is only available in the SiYuan desktop app.")}
                                {#if httpSupportReason}
                                    <code>{httpSupportReason}</code>
                                {/if}
                            </div>
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
                                <select class="b3-select" bind:value={httpSettings.host} on:change={markHttpDirty}>
                                    {#each HTTP_BIND_HOST_OPTIONS as host}
                                        <option value={host}>{getHttpHostOptionLabel(host)}</option>
                                    {/each}
                                </select>
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

                            <section class="experimental-features" aria-labelledby="skills-over-mcp-title">
                                <div class="experimental-features__header">
                                    <div>
                                        <div id="skills-over-mcp-title" class="experimental-features__title">
                                            {getLabel("skillsOverMcpTitle", "Skills over MCP")}
                                            <span>{getLabel("experimentalFeatureBadge", "Experimental")}</span>
                                        </div>
                                        <p>{getLabel("skillsOverMcpDesc", "Publish all bundled workflow skills through the draft SEP-2640 extension. This affects the built-in HTTP server only.")}</p>
                                    </div>
                                    <label class="experimental-features__master">
                                        <input type="checkbox" checked={httpSettings.skillsExtensionEnabled} on:change={onSkillsExtensionChange} />
                                        {getLabel("skillsOverMcpEnabled", "Enable")}
                                    </label>
                                </div>

                                <p class="experimental-features__note">
                                    {getLabel("skillsOverMcpRestartHint", "Save and restart the HTTP server, then reconnect the MCP client. Clients without SEP-2640 support can continue using the stable SiYuan skill resources.")}
                                </p>
                            </section>
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
                <div class="ai-setup-card">
                    <div class="ai-setup-card__copy">
                        <div class="ai-setup-card__title">{getLabel("cliAiSetupTitle", "Let AI configure the CLI")}</div>
                        <div class="ai-setup-card__desc">{getLabel("cliAiSetupDesc", "Copy a prompt that authorizes a trusted AI to install the CLI, configure the current SiYuan connection, and verify it.")}</div>
                        <div class="ai-setup-card__warning">{getLabel("aiSetupSecretWarning", "The copied prompt contains connection credentials. Share it only with an AI you trust.")}</div>
                    </div>
                    <button class="b3-button b3-button--outline ai-setup-card__button" on:click={() => copyText(generateCliAiSetupPrompt())}>
                        {getLabel("copyPromptForAi", "Copy prompt for AI")}
                    </button>
                </div>

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
        display: flex;
        flex-direction: column;
        gap: var(--mcp-config-section-gap, 14px);
        font-size: 13px;

        .http-changelog {
            align-items: flex-start;
            background: var(--mcp-config-surface, var(--b3-theme-surface));
            border: 1px solid var(--mcp-config-border, var(--b3-border-color));
            border-radius: var(--mcp-config-card-radius, 8px);
            box-shadow: var(--mcp-config-shadow, none);
            display: flex;
            gap: 12px;
            padding: var(--mcp-config-card-padding, 16px);
        }

        .http-changelog-icon {
            align-items: center;
            background: var(--mcp-config-primary-soft, color-mix(in srgb, var(--b3-theme-primary) 12%, transparent));
            border: 1px solid var(--mcp-config-primary-border, color-mix(in srgb, var(--b3-theme-primary) 26%, transparent));
            border-radius: var(--mcp-config-icon-radius, 10px);
            color: var(--b3-theme-primary);
            display: inline-flex;
            flex: 0 0 34px;
            height: 34px;
            justify-content: center;
            width: 34px;
        }

        .http-changelog-icon svg {
            fill: currentColor;
            height: 17px;
            width: 17px;
        }

        .http-changelog-copy {
            flex: 1 1 auto;
            min-width: 0;
        }

        .http-changelog-toggle {
            align-items: center;
            appearance: none;
            background: transparent;
            border: 0;
            color: inherit;
            cursor: pointer;
            display: flex;
            gap: 8px;
            justify-content: space-between;
            margin: 0;
            padding: 0;
            text-align: left;
            width: 100%;
        }

        .http-changelog-toggle__action {
            align-items: center;
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            display: inline-flex;
            flex: 0 0 auto;
            font-size: 11px;
            gap: 2px;
        }

        .http-changelog-toggle__action svg {
            fill: currentColor;
            height: 16px;
            transition: transform 160ms ease;
            width: 16px;
        }

        .http-changelog--expanded .http-changelog-toggle__action svg {
            transform: rotate(180deg);
        }

        .http-overview {
            background: var(--mcp-config-surface-accent, var(--mcp-config-surface-raised, var(--b3-theme-surface)));
            border: 1px solid var(--mcp-config-primary-border, var(--b3-border-color));
            border-radius: var(--mcp-config-card-radius, 8px);
            box-shadow: var(--mcp-config-shadow, none);
            padding: var(--mcp-config-card-padding, 16px);
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .http-overview-title {
            color: var(--mcp-config-title-color, var(--b3-theme-on-background));
            font-size: var(--mcp-config-title-font-size, 14px);
            font-weight: var(--mcp-config-title-font-weight, 500);
        }

        .http-changelog-title {
            color: var(--mcp-config-title-color, var(--b3-theme-on-background));
            font-size: var(--mcp-config-title-font-size, 14px);
            font-weight: var(--mcp-config-title-font-weight, 500);
        }

        .http-changelog-timeline {
            --changelog-item-height: 78px;
            list-style: none;
            margin: 8px 0 0;
            max-height: calc(var(--changelog-item-height) * 3);
            overflow-y: auto;
            padding: 0 10px 0 0;
            scrollbar-gutter: stable;
        }

        .http-changelog-timeline--collapsed {
            max-height: var(--changelog-item-height);
            overflow: hidden;
            padding-right: 0;
            scrollbar-gutter: auto;
        }

        .http-changelog-timeline__item {
            box-sizing: border-box;
            height: var(--changelog-item-height);
            margin: 0;
            padding: 0 0 8px 20px;
            position: relative;
        }

        .http-changelog-timeline__item:last-child {
            padding-bottom: 0;
        }

        .http-changelog-timeline__item::before {
            background: var(--mcp-config-surface, var(--b3-theme-surface));
            border: 2px solid var(--mcp-config-border, var(--b3-border-color));
            border-radius: 50%;
            box-sizing: border-box;
            content: "";
            height: 10px;
            left: 0;
            position: absolute;
            top: 4px;
            width: 10px;
            z-index: 1;
        }

        .http-changelog-timeline__item::after {
            background: var(--mcp-config-border, var(--b3-border-color));
            content: "";
            left: 4px;
            position: absolute;
            top: 14px;
            bottom: -4px;
            width: 2px;
        }

        .http-changelog-timeline__item:last-child::after {
            display: none;
        }

        .http-changelog-timeline__item--latest::before {
            background: var(--b3-theme-primary);
            border-color: color-mix(in srgb, var(--b3-theme-primary) 30%, transparent);
            box-shadow: 0 0 0 4px var(--mcp-config-primary-soft, color-mix(in srgb, var(--b3-theme-primary) 12%, transparent));
        }

        .http-changelog-timeline__meta {
            align-items: center;
            display: flex;
            flex-wrap: wrap;
            gap: 7px;
            min-height: 18px;
        }

        .http-changelog-timeline__meta code {
            background: transparent;
            color: var(--mcp-config-title-color, var(--b3-theme-on-background));
            font-family: var(--mcp-config-code-font);
            font-size: 12px;
            font-weight: 600;
            padding: 0;
        }

        .http-changelog-timeline__meta time {
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            font-size: 11px;
            font-variant-numeric: tabular-nums;
        }

        .http-changelog-timeline__item--latest .http-changelog-timeline__meta code {
            color: var(--b3-theme-primary);
        }

        .http-changelog-timeline__meta > span {
            background: var(--mcp-config-primary-soft, color-mix(in srgb, var(--b3-theme-primary) 12%, transparent));
            border: 1px solid var(--mcp-config-primary-border, color-mix(in srgb, var(--b3-theme-primary) 26%, transparent));
            border-radius: 999px;
            color: var(--b3-theme-primary);
            font-size: 10px;
            font-weight: 600;
            line-height: 1.4;
            padding: 1px 7px;
        }

        .http-changelog-timeline__item p {
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 3;
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            display: -webkit-box;
            font-size: 12px;
            line-height: 1.5;
            margin: 2px 0 0;
            overflow: hidden;
        }

        .http-changelog-timeline__item p strong {
            color: var(--mcp-config-title-color, var(--b3-theme-on-background));
            font-weight: 700;
        }

        .http-status-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .http-status-dot {
            width: 8px;
            height: 8px;
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
            border-radius: var(--b3-border-radius);
            font-family: var(--mcp-config-code-font);
        }

        .http-error {
            color: var(--b3-theme-error, #d33);
        }

        .http-warning {
            padding: 8px 12px;
            background: var(--b3-card-warning-background, rgba(255, 180, 0, 0.12));
            border-left: 3px solid var(--b3-theme-warning, #e0a000);
            border-radius: var(--mcp-config-card-radius, 8px);
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

        .experimental-features {
            background: color-mix(in srgb, var(--mcp-config-primary-soft) 42%, var(--b3-theme-background));
            border: 1px solid var(--mcp-config-primary-border, var(--b3-border-color));
            border-radius: var(--mcp-config-card-radius, 8px);
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-top: 4px;
            padding: 13px 14px;
        }

        .experimental-features__header {
            align-items: flex-start;
            display: flex;
            gap: 16px;
            justify-content: space-between;
        }

        .experimental-features__title {
            align-items: center;
            color: var(--mcp-config-title-color, var(--b3-theme-on-background));
            display: flex;
            font-weight: 650;
            gap: 8px;
        }

        .experimental-features__title span {
            background: color-mix(in srgb, var(--b3-theme-warning, #e0a000) 14%, transparent);
            border: 1px solid color-mix(in srgb, var(--b3-theme-warning, #e0a000) 32%, transparent);
            border-radius: 999px;
            color: var(--b3-theme-warning, #b57600);
            font-size: 10px;
            line-height: 1.4;
            padding: 1px 7px;
        }

        .experimental-features__header p,
        .experimental-features__note {
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            line-height: 1.5;
            margin: 3px 0 0;
        }

        .experimental-features__master {
            align-items: center;
            display: inline-flex;
            flex: 0 0 auto;
            gap: 7px;
            white-space: nowrap;
        }

        @media (max-width: 720px) {
            .experimental-features__header {
                flex-direction: column;
            }
        }

        .http-label {
            min-width: 60px;
        }

        .http-token-row {
            .http-token-input {
                flex: 1;
                min-width: 240px;
                font-family: var(--mcp-config-code-font);
                font-size: 12px;
            }
        }

        .http-path-input {
            flex: 1;
            min-width: 280px;
            font-family: var(--mcp-config-code-font);
            font-size: 12px;
        }

        .http-snippet {
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-border-color);
            border-radius: var(--mcp-config-card-radius, 8px);
            padding: 8px 12px;

            summary {
                cursor: pointer;
                user-select: none;
            }

            pre {
                margin: 8px 0;
                padding: 8px;
                background: var(--b3-theme-background);
                border-radius: var(--b3-border-radius);
                overflow: auto;
                max-height: 200px;
                font-family: var(--mcp-config-code-font);
                font-size: 12px;
            }
        }

        .http-log-box {
            white-space: pre-wrap;
            word-break: break-all;
        }

        .http-guide {
            background: var(--mcp-config-surface, var(--b3-theme-surface));
            border: 1px solid var(--mcp-config-border, var(--b3-border-color));
            border-radius: var(--mcp-config-card-radius, 8px);
            box-shadow: var(--mcp-config-shadow, none);
            overflow: hidden;
            transition: border-color 0.14s ease, box-shadow 0.14s ease;

            > summary {
                align-items: center;
                cursor: pointer;
                color: var(--mcp-config-title-color, var(--b3-theme-on-background));
                display: flex;
                gap: 8px;
                font-size: var(--mcp-config-title-font-size, 14px);
                font-weight: var(--mcp-config-title-font-weight, 500);
                list-style: none;
                min-height: 24px;
                padding: var(--mcp-config-card-padding, 16px);
                user-select: none;
            }

            > summary::-webkit-details-marker {
                display: none;
            }

            > summary::after {
                border-bottom: 2px solid currentColor;
                border-right: 2px solid currentColor;
                color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
                content: "";
                height: 6px;
                margin-left: auto;
                transform: rotate(45deg);
                transition: transform 0.16s ease;
                width: 6px;
            }

            &[open] {
                border-color: color-mix(in srgb, var(--b3-theme-primary) 28%, var(--b3-border-color));
            }

            &[open] > summary {
                background: color-mix(in srgb, var(--mcp-config-primary-soft) 46%, transparent);
                border-bottom: 1px solid var(--mcp-config-border, var(--b3-border-color));
            }

            &[open] > summary::after {
                transform: rotate(225deg);
            }
        }

        .http-guide > .http-guide-content {
            margin-top: 0;
            padding: 16px 18px 18px;
        }

        .http-guide-content {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .http-choice-card,
        .http-subproject {
            background: color-mix(in srgb, var(--b3-theme-background) 72%, transparent);
            border: 1px solid var(--mcp-config-border, var(--b3-border-color));
            border-radius: var(--mcp-config-card-radius, 8px);
            padding: 10px 12px;
        }

        .http-subproject > summary {
            cursor: pointer;
            user-select: none;
            font-weight: var(--mcp-config-title-font-weight, 500);
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
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
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
                border-bottom: 1px solid var(--b3-border-color);
                text-align: left;
                vertical-align: top;
            }

            tr:last-child td {
                border-bottom: 0;
            }

            th {
                background: var(--b3-theme-surface);
                border-bottom: 1px solid var(--b3-border-color);
                color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
                font-size: 12px;
                font-weight: 500;
            }
        }

        .http-guide-intro {
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            line-height: 1.5;
        }

        .http-note {
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            line-height: 1.6;
        }

        .ai-setup-card {
            align-items: center;
            background: color-mix(in srgb, var(--mcp-config-primary-soft) 58%, var(--b3-theme-background));
            border: 1px solid var(--mcp-config-primary-border, var(--b3-border-color));
            border-radius: var(--mcp-config-card-radius, 8px);
            display: flex;
            gap: 14px;
            justify-content: space-between;
            padding: 12px 14px;
        }

        .ai-setup-card__copy {
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
        }

        .ai-setup-card__title {
            color: var(--mcp-config-title-color, var(--b3-theme-on-background));
            font-weight: var(--mcp-config-title-font-weight, 500);
        }

        .ai-setup-card__desc,
        .ai-setup-card__warning {
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            line-height: 1.5;
        }

        .ai-setup-card__warning {
            color: var(--b3-theme-warning, #c07800);
            font-size: 12px;
        }

        .ai-setup-card__button {
            flex: 0 0 auto;
        }

        .mcp-client-presets {
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-border-color);
            border-radius: var(--mcp-config-card-radius, 8px);
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .mcp-client-presets-title {
            color: var(--mcp-config-title-color, var(--b3-theme-on-background));
            font-weight: var(--mcp-config-title-font-weight, 500);
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
            border: 1px solid var(--b3-border-color);
            border-radius: var(--b3-border-radius);
            overflow: auto;
            max-height: 220px;
            font-family: var(--mcp-config-code-font);
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
            font-weight: var(--mcp-config-title-font-weight, 500);
        }

        .cli-snippet-desc {
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            line-height: 1.5;
        }

        .cli-preview-badge {
            display: inline-block;
            margin-left: 6px;
            padding: 1px 6px;
            font-size: 11px;
            font-weight: 500;
            line-height: 1.4;
            color: var(--mcp-config-caption-color, var(--b3-theme-on-surface-light));
            background: var(--b3-theme-primary-lightest, rgba(0, 0, 0, 0.05));
            border: 1px solid var(--b3-border-color);
            border-radius: var(--b3-border-radius);
            vertical-align: middle;
        }
    }

    @media (max-width: 768px) {
        .http-server-section {
            gap: 10px;
        }

        .http-changelog-timeline {
            --changelog-item-height: 96px;
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

        .ai-setup-card {
            align-items: stretch;
            flex-direction: column;
        }

        .ai-setup-card__button {
            width: 100%;
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
