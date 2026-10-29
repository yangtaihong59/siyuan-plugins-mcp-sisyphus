/*
 * User attributes block.update restores after updateBlock rebuilds a block
 * from Markdown without its own IAL. Shared with the write-impact preview.
 */
export const PRESERVED_ATTR_NAMES = new Set(['name', 'alias', 'memo', 'bookmark']);

export function preservableAttrs(attrs: Record<string, string> | null | undefined): Record<string, string> {
    return Object.fromEntries(Object.entries(attrs ?? {})
        .filter(([key, value]) => value !== '' && (key.startsWith('custom-') || PRESERVED_ATTR_NAMES.has(key))));
}

/** updatePreservingAttrs only restores for Markdown input without an explicit IAL. */
export function updateRestoresAttrs(dataType: unknown, data: unknown): boolean {
    return dataType === 'markdown' && typeof data === 'string' && !/\{:\s/.test(data);
}
