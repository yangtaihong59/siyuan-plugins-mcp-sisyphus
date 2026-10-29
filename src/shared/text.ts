/** Escape a literal for use inside a RegExp source. */
export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Non-overlapping occurrences of a non-empty needle. */
export function countOccurrences(content: string, needle: string): number {
    let count = 0;
    let index = 0;
    while (true) {
        index = content.indexOf(needle, index);
        if (index === -1) return count;
        count += 1;
        index += needle.length;
    }
}
