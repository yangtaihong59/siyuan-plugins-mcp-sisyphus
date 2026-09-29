import { AV_ID_ALIAS_ACTIONS } from '../../core/argument-aliases';
import type { ToolResult } from './shared';

/** Response-only migration notice; never part of the write request digest. */
export function withAvIdWarning(result: ToolResult, category: string, args: Record<string, unknown>): ToolResult {
    if (category !== 'av' || !AV_ID_ALIAS_ACTIONS.includes(String(args.action)) || !Object.prototype.hasOwnProperty.call(args, 'id')) return result;
    const warning = { code: 'deprecated_parameter', parameter: 'id', replacement: 'avID', message: 'Parameter id is deprecated; use avID.' };
    const add = (data: Record<string, unknown>) => ({
        ...data,
        warnings: [...(Array.isArray(data.warnings) ? data.warnings.filter((w) =>
            !(w && typeof w === 'object' && w.code === warning.code && w.parameter === 'id')) : []), warning],
    });
    return {
        ...result,
        ...(result.structuredContent ? { structuredContent: add(result.structuredContent) } : {}),
        content: result.content.map((item) => {
            if (item.type !== 'text') return item;
            try {
                const data = JSON.parse(item.text);
                return data && typeof data === 'object' && !Array.isArray(data) ? { ...item, text: JSON.stringify(add(data)) } : item;
            } catch { return item; }
        }),
    };
}
