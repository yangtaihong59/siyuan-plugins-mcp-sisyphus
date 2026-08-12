export interface ImageReferenceAudit {
    expectedRefs: string[];
    actualRefs: string[];
    missingRefs: string[];
    extraRefs: string[];
    expectedCount: number;
    actualCount: number;
    ok: boolean;
}

/**
 * Compare source references with SiYuan's HTTP-returned image paths. Imports
 * may append a timestamp/id suffix; basename matching keeps that documented
 * normalization while the action remains pure and never touches local `.sy`.
 *
 * This is deliberately a multiset comparison: normalization is only the match
 * key, not a reason to collapse references. Each successful match consumes one
 * occurrence, so callers can audit repeated links and same-basename paths. If
 * several source paths normalize to one basename, input order determines which
 * occurrence remains unmatched; removing that order would hide import loss.
 */
export function imageReferenceBasename(reference: string): string {
    const withoutQuery = reference.split(/[?#]/u, 1)[0];
    const basename = withoutQuery.slice(Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\')) + 1);
    const extensionIndex = basename.lastIndexOf('.');
    const stem = extensionIndex > 0 ? basename.slice(0, extensionIndex) : basename;
    const extension = extensionIndex > 0 ? basename.slice(extensionIndex) : '';
    return `${stem.replace(/-\d{14}-[a-z0-9]{7}$/u, '')}${extension}`;
}

export function auditImageReferences(expectedInput: readonly string[], actualInput: readonly string[]): ImageReferenceAudit {
    const expectedRefs = expectedInput.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
    const actualRefs = actualInput.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
    const actualCounts = countNormalizedReferences(actualRefs);
    const expectedCounts = countNormalizedReferences(expectedRefs);
    const missingRefs = unmatchedOccurrences(expectedRefs, actualCounts);
    const extraRefs = unmatchedOccurrences(actualRefs, expectedCounts);
    return { expectedRefs, actualRefs, missingRefs, extraRefs, expectedCount: expectedRefs.length, actualCount: actualRefs.length, ok: missingRefs.length === 0 && extraRefs.length === 0 };
}

function countNormalizedReferences(references: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const reference of references) {
        const normalized = imageReferenceBasename(reference);
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return counts;
}

function unmatchedOccurrences(references: readonly string[], availableCounts: Map<string, number>): string[] {
    const remaining = new Map(availableCounts);
    const unmatched: string[] = [];
    for (const reference of references) {
        const normalized = imageReferenceBasename(reference);
        const available = remaining.get(normalized) ?? 0;
        if (available === 0) {
            unmatched.push(reference);
        } else {
            remaining.set(normalized, available - 1);
        }
    }
    return unmatched;
}
