<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { showMessage } from "siyuan";

    import SettingPanel from "../../shared/setting-panel.svelte";
    import { getHttpLifecycleLogs, onHttpLifecycleLogsChange, type HttpServerStatus } from "@/ui/plugin/server-launcher";
    import { HTTP_BIND_HOST_OPTIONS, hasValidHttpTlsFiles, regenerateHttpServerToken, savePersistedHttpServerSettings, type HttpServerHost, type HttpServerSettings } from "../tool-config-storage";
    import { getSiYuanVersion } from "../official-plugin-tools";
    import { MIN_KERNEL_ENDPOINT_VERSION, supportsKernelEndpoint } from "@/shared/siyuan-version";
    import { MCP_CLIENT_PRESETS, MCP_SERVER_NAME, MCP_TRANSPORT_PRESETS, type McpClientPresetId, type McpTransportId, generatePresetSnippet, getCurrentWorkspaceApiUrl, getSiYuanApiToken, parseChangelogEntries, replacePromptTokens } from "./http-server-panel-logic";

    export let plugin: any;
    export let group: string;
    export let display = false;
    export let httpSettings: HttpServerSettings;
    export let getLabel: (key: string, fallback: string) => string;

    const CLI_COMMAND = "siyuan-sisyphus";
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
    $: dshSetupGuide = getLabel("mcpDshSetupGuide", "Desktop: ~/.dsh/profiles/desktop/cordis.patch.yml; other profiles: web / headless / tui. Merge the Cordis insert entry by id; do not add mcpServers or duplicate serverName. Changes hot-reload without restarting. Tools use mcp__siyuan-sisyphus__<tool>. With HTTP authentication, set MCP_TOKEN in the DSH process environment; for authenticated stdio, set SIYUAN_TOKEN to the kernel API token. Environment references contain no literal secrets; a terminal export may not reach the desktop app. Initial connection failure prevents this entry from loading (failOnStartupError: true).");
    let changelogExpanded = false;
    $: changelogTitle = getLabel("toolSettingsChangelogTitle", "更新日志");
    $: changelogText = getLabel("toolSettingsChangelogText", "连接设置现按 MCP / CLI 分组，MCP 下再区分 HTTP/HTTPS 与 stdio。");
    $: changelogEntries = parseChangelogEntries(changelogText);
    $: visibleChangelogEntries = changelogExpanded ? changelogEntries : changelogEntries.slice(0, 1);
    $: httpSupportReason = plugin?.httpLauncher ? "" : getHttpUnsupportedReason();

    // undefined until known; a read failure leaves the switch usable (the endpoint reports its own error).
    let siyuanVersion: string | undefined;
    $: kernelEndpointUnsupported = siyuanVersion !== undefined && !supportsKernelEndpoint(siyuanVersion);

    function formatKernelEndpointUnsupported(key: string, fallback: string): string {
        return getLabel(key, fallback)
            .replace("{version}", siyuanVersion ?? "")
            .replace("{minimum}", MIN_KERNEL_ENDPOINT_VERSION);
    }

    onMount(() => {
        getSiYuanVersion().then((version) => { siyuanVersion = version; }).catch(() => {});
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
        const prompt = replacePromptTokens(
            getLabel("mcpAiSetupPrompt", fallback),
            {
                client: getSelectedMcpClientTitle(),
                transport: getSelectedMcpTransportTitle(),
                format: selectedMcpClientPreset === "dsh" ? "yaml" : selectedMcpClientPreset === "codex" ? "toml" : "json",
                config: generatePresetSnippet(httpSettings, selectedMcpClientPreset, selectedMcpTransport),
                serverName: MCP_SERVER_NAME,
            },
        );
        return selectedMcpClientPreset === "dsh" ? `${prompt}\n\n${dshSetupGuide}` : prompt;
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
                apiUrl: getCurrentWorkspaceApiUrl(),
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

    // The kernel endpoint is served by kernel.js inside the kernel petal and
    // does not depend on the standalone HTTP server — persist immediately so
    // the change takes effect without an Apply/Restart.
    async function onKernelEndpointChange(event: Event) {
        const target = event.currentTarget as HTMLInputElement;
        const next = { ...httpSettings, kernelEndpointEnabled: target.checked };
        await persistHttpSettings(next, false);
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
                    {#if selectedMcpClientPreset === "dsh"}
                        <div class="http-note">{dshSetupGuide}</div>
                    {/if}
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
                                <div class="http-field-hint">{getLabel("kernelEndpointDockerHint", "On Docker/browser the standalone HTTP server is unavailable — enable the Kernel endpoint below to host the write coordinator on the kernel port instead.")}</div>
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


                            <section class="experimental-features" aria-labelledby="kernel-endpoint-title">
                                <div class="experimental-features__header">
                                    <div>
                                        <div id="kernel-endpoint-title" class="experimental-features__title">
                                            {getLabel("kernelEndpointTitle", "Kernel endpoint")}
                                            <span>{getLabel("experimentalFeatureBadge", "Experimental")}</span>
                                        </div>
                                        <p>{getLabel("kernelEndpointDesc", "Serve the write coordinator from inside the kernel via /plugin/private/<plugin>/mcp. Useful on Docker and remote deployments where a separate MCP port cannot be opened.")}</p>
                                    </div>
                                    <label class="experimental-features__master">
                                        <!-- Turning it off always stays possible; turning it on needs a capable SiYuan. -->
                                        <input type="checkbox" checked={httpSettings.kernelEndpointEnabled} disabled={kernelEndpointUnsupported && !httpSettings.kernelEndpointEnabled} on:change={onKernelEndpointChange} />
                                        {getLabel("kernelEndpointEnabled", "Enable")}
                                    </label>
                                </div>

                                {#if kernelEndpointUnsupported}
                                    <p class="experimental-features__note kernel-endpoint-unsupported" role="alert">
                                        {#if httpSettings.kernelEndpointEnabled}
                                            {formatKernelEndpointUnsupported("kernelEndpointUnsupportedEnabled", "SiYuan {version} cannot host the Kernel endpoint (requires {minimum} or later). While it is enabled, every strict write from the CLI and MCP clients fails. Turn it off and use the HTTP server, or upgrade SiYuan.")}
                                        {:else}
                                            {formatKernelEndpointUnsupported("kernelEndpointUnsupported", "Requires SiYuan {minimum} or later (current: {version}).")}
                                        {/if}
                                    </p>
                                {/if}
                                <p class="experimental-features__note">
                                    {getLabel("kernelEndpointHint", "Shares the kernel's own port — no extra listener or firewall rule needed. Remote CLIs auto-detect it when enabled. Takes effect immediately (no restart).")}
                                </p>
                            </section>

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

                        {#if httpSettings.host !== "127.0.0.1" && !httpSettings.authEnabled}
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
    @use "./HttpServerPanel";
</style>
