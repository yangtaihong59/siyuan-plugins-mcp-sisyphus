import {
    MIN_OFFICIAL_MCP_VERSION,
    supportsOfficialMcp,
} from "../../shared/official-mcp-support";

export interface UiOfficialMcpTool {
    name: string;
    title?: string;
    description?: string;
    source: "plugin" | "native";
    readOnlyHint: boolean;
    effectScope?: string;
    schemaBytes: number;
}

export interface UiOfficialMcpDiscovery {
    loading: boolean;
    connected: boolean;
    supported?: boolean;
    siyuanVersion?: string;
    minSupportedVersion?: string;
    tools: UiOfficialMcpTool[];
    refreshedAt?: string;
    error?: string;
}

const SELF_PLUGIN_TOOL_PREFIX = "plugin__siyuan_plugins_mcp_sisyphus__";

export async function getSiYuanVersion(): Promise<string> {
    const response = await fetch("/api/system/version", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }
    const payload = JSON.parse(text);
    if (payload?.code !== 0 || typeof payload?.data !== "string") {
        throw new Error(payload?.msg || "Invalid /api/system/version response.");
    }
    return payload.data;
}

function requestId(): string {
    return `sisyphus-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function postMcp(
    body: Record<string, unknown>,
    sessionId?: string,
): Promise<{ result: any; sessionId?: string }> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
    };
    if (sessionId) {
        headers["Mcp-Session-Id"] = sessionId;
        headers["MCP-Protocol-Version"] = "2025-06-18";
    }
    const response = await fetch("/mcp", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }
    const payload = JSON.parse(text);
    if (payload?.error) {
        throw new Error(payload.error.message || JSON.stringify(payload.error));
    }
    return {
        result: payload?.result,
        sessionId: response.headers.get("Mcp-Session-Id") || sessionId,
    };
}

export async function discoverOfficialTools(): Promise<UiOfficialMcpDiscovery> {
    let sessionId: string | undefined;
    try {
        const siyuanVersion = await getSiYuanVersion();
        if (!supportsOfficialMcp(siyuanVersion)) {
            return {
                loading: false,
                connected: false,
                supported: false,
                siyuanVersion,
                minSupportedVersion: MIN_OFFICIAL_MCP_VERSION,
                tools: [],
                refreshedAt: new Date().toISOString(),
                error: `SiYuan ${siyuanVersion} does not support the official MCP endpoint. Version ${MIN_OFFICIAL_MCP_VERSION} or newer is required for extension tools.`,
            };
        }
        const initialized = await postMcp({
            jsonrpc: "2.0",
            id: requestId(),
            method: "initialize",
            params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "sisyphus-settings", version: "1.0.0" },
            },
        });
        sessionId = initialized.sessionId;
        if (!sessionId) throw new Error("Official MCP initialize response did not include Mcp-Session-Id.");

        const listed = await postMcp({
            jsonrpc: "2.0",
            id: requestId(),
            method: "tools/list",
            params: {},
        }, sessionId);
        const tools = Array.isArray(listed.result?.tools)
            ? listed.result.tools
                .map((tool: any) => ({
                    ...tool,
                    source: !tool?.source ? "native" : tool.source,
                }))
                .filter((tool: any) => tool.source === "plugin" || tool.source === "native")
                .filter((tool: any) => typeof tool.name === "string" && !tool.name.startsWith(SELF_PLUGIN_TOOL_PREFIX))
                .map((tool: any) => ({
                    name: tool.name,
                    title: typeof tool.title === "string" ? tool.title : undefined,
                    description: typeof tool.description === "string" ? tool.description : undefined,
                    source: tool.source as "plugin" | "native",
                    readOnlyHint: tool.readOnlyHint === true,
                    effectScope: typeof tool.effectScope === "string" ? tool.effectScope : undefined,
                    schemaBytes: JSON.stringify(tool.inputSchema ?? {}).length,
                }))
                .sort((left: UiOfficialMcpTool, right: UiOfficialMcpTool) => left.name.localeCompare(right.name))
            : [];
        return {
            loading: false,
            connected: true,
            supported: true,
            siyuanVersion,
            minSupportedVersion: MIN_OFFICIAL_MCP_VERSION,
            tools,
            refreshedAt: new Date().toISOString(),
        };
    } catch (error) {
        return {
            loading: false,
            connected: false,
            minSupportedVersion: MIN_OFFICIAL_MCP_VERSION,
            tools: [],
            refreshedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        if (sessionId) {
            void fetch("/mcp", {
                method: "DELETE",
                credentials: "same-origin",
                headers: {
                    "Mcp-Session-Id": sessionId,
                    "MCP-Protocol-Version": "2025-06-18",
                },
            }).catch(() => {});
        }
    }
}
