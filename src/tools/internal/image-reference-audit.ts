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
    const expectedRefs = [...new Set(expectedInput.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0))];
    const actualRefs = actualInput.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
    const expectedBasenames = new Set(expectedRefs.map(imageReferenceBasename));
    const actualBasenames = new Set(actualRefs.map(imageReferenceBasename));
    const missingRefs = expectedRefs.filter((ref) => !actualBasenames.has(imageReferenceBasename(ref)));
    const extraRefs = actualRefs.filter((ref) => !expectedBasenames.has(imageReferenceBasename(ref)));
    return { expectedRefs, actualRefs, missingRefs, extraRefs, expectedCount: expectedRefs.length, actualCount: actualRefs.length, ok: missingRefs.length === 0 && extraRefs.length === 0 };
}
