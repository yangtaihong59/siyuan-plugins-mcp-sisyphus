import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ToolResult } from '../tools/internal/shared';

export function withStructuredContent(result: ToolResult): CallToolResult {
    if (result.structuredContent) return result as CallToolResult;

    const text = result.content.find((item) => item.type === 'text')?.text ?? '';
    let value: unknown = text;
    try {
        value = JSON.parse(text);
    } catch {
        // Preserve non-JSON tool responses under a stable object key.
    }
    const structuredContent = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : { value };
    return { ...result, structuredContent } as CallToolResult;
}
