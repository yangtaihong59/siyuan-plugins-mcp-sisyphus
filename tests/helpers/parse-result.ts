import type { ToolResult } from '@/tools/internal/shared';

/**
 * Parse JSON text from a tool call result.
 */
export function parseResult(result: ToolResult) {
    const text = result.content.find((item) => item.type === 'text')?.text;
    if (text === undefined) throw new Error('Tool result contains no text content block.');
    return JSON.parse(text);
}
