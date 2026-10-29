/** A plain JSON-style object: non-null, `typeof 'object'`, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The value as a plain object, or undefined when it is not one. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
    return isRecord(value) ? value : undefined;
}
