/** Drop the `.sy` storage suffix from a document file name or path. */
export function stripSySuffix(name: string | undefined): string | undefined {
    return typeof name === 'string' ? name.replace(/\.sy$/, '') : undefined;
}

/** Normalize a human-readable fs path: leading slash, collapsed separators, no trailing slash. */
export function normalizeFsPath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) throw new Error('fs path must not be empty.');
    const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const collapsed = withLeadingSlash.replace(/\/+/g, '/');
    return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}
