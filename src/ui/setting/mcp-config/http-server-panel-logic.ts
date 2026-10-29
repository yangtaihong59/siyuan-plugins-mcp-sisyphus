/* Pure helpers for HttpServerPanel: MCP client config generators, URLs and changelog parsing. */
import { type HttpServerSettings } from "../tool-config-storage";
import { getWorkspaceApiUrl } from "@/shared/workspace-api-url";

export const MCP_SERVER_NAME = "siyuan-sisyphus";

export const MCP_CLIENT_PRESETS = [
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
        id: "dsh",
        titleKey: "mcpPresetDshTitle",
        titleFallback: "DSH (DeepSeek Harness)",
        descKey: "mcpPresetDshDesc",
        descFallback: "Copy Cordis YAML patch configuration for DSH.",
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

export type McpClientPresetId = (typeof MCP_CLIENT_PRESETS)[number]["id"];

export const MCP_TRANSPORT_PRESETS = [
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

export type McpTransportId = (typeof MCP_TRANSPORT_PRESETS)[number]["id"];

export function parseChangelogDescription(description: string): Array<{ text: string; strong: boolean }> {
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

export function parseChangelogEntries(text: string): Array<{ version: string; date: string; description: string; segments: Array<{ text: string; strong: boolean }> }> {
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

export function getWorkspaceScriptPath(): string {
    const workspaceDir = (window as any)?.siyuan?.config?.system?.workspaceDir;
    if (typeof workspaceDir !== "string" || !workspaceDir.trim()) {
        return "{SIYUAN_PATH}/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs";
    }
    return `${workspaceDir.replace(/[\\/]+$/, "")}/data/plugins/siyuan-plugins-mcp-sisyphus/mcp-server.cjs`;
}

export function getSiYuanApiToken(): string {
    const token = (window as any)?.siyuan?.config?.api?.token;
    if (typeof token !== "string" || !token.trim()) {
        return "xxxxxx";
    }
    return token;
}

export function getHttpMcpUrl(s: HttpServerSettings): string {
    const scheme = s.tlsEnabled ? "https" : "http";
    return `${scheme}://${s.host}:${s.port}/mcp`;
}

export function getHttpAuthHeaders(s: HttpServerSettings): Record<string, string> | undefined {
    return s.authEnabled ? { Authorization: `Bearer ${s.token}` } : undefined;
}

export function getStdioServerConfig(includeType = false) {
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

export function generateClaudeCodeConfig(s: HttpServerSettings, mode: McpTransportId): string {
    const url = getHttpMcpUrl(s);
    if (mode === "http") {
        const headers = getHttpAuthHeaders(s);
        const obj: any = { mcpServers: { [MCP_SERVER_NAME]: { type: "http", url } } };
        if (headers) obj.mcpServers[MCP_SERVER_NAME].headers = headers;
        return JSON.stringify(obj, null, 2);
    }
    return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: getStdioServerConfig(true) } }, null, 2);
}

export function generateCursorJsonConfig(s: HttpServerSettings, mode: McpTransportId): string {
    if (mode === "http") {
        const server: any = { url: getHttpMcpUrl(s) };
        const headers = getHttpAuthHeaders(s);
        if (headers) server.headers = headers;
        return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
    }
    return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: getStdioServerConfig() } }, null, 2);
}

export function tomlString(value: string): string {
    return JSON.stringify(value);
}

export function generateCodexConfig(s: HttpServerSettings, transport: McpTransportId): string {
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

export function generateDshConfig(s: HttpServerSettings, transport: McpTransportId): string {
    const lines = [
        "- insert:",
        `    - id: mcp-${MCP_SERVER_NAME}`,
        '      name: "@deepseek-ai/dsh-mcp-client"',
        "      config:",
        `        serverName: ${MCP_SERVER_NAME}`,
        `        transport: ${transport === "http" ? "streamable-http" : "stdio"}`,
    ];
    if (transport === "http") {
        lines.push(`        url: ${JSON.stringify(getHttpMcpUrl(s))}`);
        if (s.authEnabled) lines.push("        headers:", `          Authorization: !!js "'Bearer ' + process.env.MCP_TOKEN"`);
    } else {
        const stdio = getStdioServerConfig();
        lines.push(
            `        command: ${JSON.stringify(stdio.command)}`,
            `        args: ${JSON.stringify(stdio.args)}`,
            "        env:",
            `          SIYUAN_API_URL: ${JSON.stringify(stdio.env.SIYUAN_API_URL)}`,
            stdio.env.SIYUAN_TOKEN ? "          SIYUAN_TOKEN: !!js process.env.SIYUAN_TOKEN" : '          SIYUAN_TOKEN: ""',
        );
    }
    lines.push("        failOnStartupError: true");
    return lines.join("\n");
}

export function generateKimiConfig(s: HttpServerSettings, transport: McpTransportId): string {
    if (transport === "stdio") {
        return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: getStdioServerConfig() } }, null, 2);
    }
    const server: any = { url: getHttpMcpUrl(s), transport: "http" };
    const headers = getHttpAuthHeaders(s);
    if (headers) server.headers = headers;
    return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
}

export function generateOpenCodeConfig(s: HttpServerSettings, transport: McpTransportId): string {
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

export function generateCherryStudioConfig(s: HttpServerSettings, transport: McpTransportId): string {
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

export function generateCcSwitchConfig(s: HttpServerSettings, transport: McpTransportId): string {
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

export function generatePresetSnippet(s: HttpServerSettings, preset: McpClientPresetId, transport: McpTransportId): string {
    if (preset === "claude-code") return generateClaudeCodeConfig(s, transport);
    if (preset === "kimi") return generateKimiConfig(s, transport);
    if (preset === "opencode") return generateOpenCodeConfig(s, transport);
    if (preset === "codex") return generateCodexConfig(s, transport);
    if (preset === "dsh") return generateDshConfig(s, transport);
    if (preset === "cherry-studio") return generateCherryStudioConfig(s, transport);
    if (preset === "cc-switch") return generateCcSwitchConfig(s, transport);
    return generateCursorJsonConfig(s, transport);
}

export function replacePromptTokens(template: string, values: Record<string, string>): string {
    return Object.entries(values).reduce(
        (result, [key, value]) => result.split(`{{${key}}}`).join(value),
        template,
    );
}

// getWorkspaceApiUrl throws outside an http(s) origin; the prompt still needs a usable default.
export function getCurrentWorkspaceApiUrl(): string {
    try {
        return getWorkspaceApiUrl(window?.location?.origin);
    } catch {
        return "http://127.0.0.1:6806";
    }
}
