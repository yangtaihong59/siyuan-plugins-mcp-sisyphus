/**
 * MCP-facing result and descriptor shapes shared by every layer.
 *
 * Type-only and dependency-free so foundation modules (core) can name tool
 * results without importing the tool layer.
 */

export interface ToolTextContent {
    type: 'text';
    text: string;
    data?: undefined;
    mimeType?: undefined;
}

export interface ToolImageContent {
    type: 'image';
    data: string;
    mimeType: string;
    text?: undefined;
    _meta?: Record<string, unknown>;
}

export type ToolContent = ToolTextContent | ToolImageContent;

export interface ToolResult {
    _meta?: Record<string, unknown>;
    content: ToolContent[];
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
}

/**
 * Minimal tool descriptor as consumed by the MCP ListTools response.
 * The per-category list helpers emit these objects directly.
 */
export interface ToolDescriptor {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
    annotations?: {
        title?: string;
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
    };
}
