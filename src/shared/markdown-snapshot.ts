export const MARKDOWN_SNAPSHOT_SCHEMA_VERSION = '1.0.0' as const;

export interface SnapshotDocumentCandidate {
    id: string;
    path?: string;
    hPath?: string;
    name?: string;
}

export interface SnapshotDocumentRecord {
    id: string;
    title: string;
    hPath: string;
    storagePath: string;
    relativePath?: string;
    metadata: {
        id: string;
        title: string;
        hPath: string;
        storagePath: string;
        notebookID: string;
    };
    metadataHash: string;
    content?: string;
    contentHash?: string;
    errors?: SnapshotErrorRecord[];
}

export interface SnapshotErrorRecord {
    code: string;
    message: string;
    documentID?: string;
    path?: string;
    retryable?: boolean;
}

export interface SnapshotConflictRecord {
    code: 'relative_path_collision' | 'case_insensitive_path_collision';
    originalPath?: string;
    relativePath?: string;
    documentIDs: string[];
    disambiguatedPaths?: string[];
    message: string;
}

export function canonicalMetadata(
    notebookID: string,
    candidate: Required<Pick<SnapshotDocumentCandidate, 'id' | 'path' | 'hPath'>> & { name?: string },
) {
    const title = candidate.name?.replace(/\.sy$/i, '') || candidate.hPath.split('/').filter(Boolean).at(-1) || candidate.id;
    return {
        id: candidate.id,
        title,
        hPath: candidate.hPath,
        storagePath: candidate.path,
        notebookID,
    };
}

function canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

async function hashSnapshotBytes(value: Uint8Array): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', value);
    return `sha256:v1:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function hashSnapshotMetadata(metadata: Record<string, unknown>): Promise<string> {
    return hashSnapshotBytes(new TextEncoder().encode(canonicalize(metadata)));
}

export function hashSnapshotContent(content: string): Promise<string> {
    // Hash the exact returned Markdown string, preserving every character
    // (including trailing newlines) while remaining usable in renderer and
    // server bundles without importing Node's crypto module into the browser.
    return hashSnapshotBytes(new TextEncoder().encode(content));
}

export function compareSnapshotText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

export function encodeSnapshotCursor(scopeHash: string, inventoryHash: string, offset: number): string {
    const payload = JSON.stringify({ scopeHash, inventoryHash, offset });
    return encodeURIComponent(payload);
}

export function decodeSnapshotCursor(value: string): { scopeHash: string; inventoryHash: string; offset: number } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeURIComponent(value));
    } catch {
        throw new Error('Invalid export_markdown_snapshot cursor.');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid export_markdown_snapshot cursor.');
    const record = parsed as Record<string, unknown>;
    if (typeof record.scopeHash !== 'string' || typeof record.inventoryHash !== 'string' || !Number.isInteger(record.offset) || (record.offset as number) < 0) {
        throw new Error('Invalid export_markdown_snapshot cursor.');
    }
    return { scopeHash: record.scopeHash, inventoryHash: record.inventoryHash, offset: record.offset as number };
}

export function safeRelativeMarkdownPath(hPath: string): string {
    if (!hPath.startsWith('/')) throw new Error('hPath must be absolute.');
    const parts = hPath.split('/').filter(Boolean);
    if (parts.length === 0) throw new Error('hPath must contain a document title.');
    for (const part of parts) {
        if (part === '.' || part === '..' || part.includes('\0')) {
            throw new Error('hPath contains an unsafe path component.');
        }
    }
    const leaf = parts.pop()!;
    return [...parts, `${leaf}.md`].join('/');
}

export function planSnapshotPaths(
    records: SnapshotDocumentRecord[],
): SnapshotConflictRecord[] {
    const conflicts: SnapshotConflictRecord[] = [];
    const byOriginalPath = new Map<string, SnapshotDocumentRecord[]>();

    for (const record of records) {
        try {
            record.relativePath = safeRelativeMarkdownPath(record.hPath);
        } catch (error) {
            record.errors = [...(record.errors ?? []), {
                code: 'unsafe_relative_path',
                message: error instanceof Error ? error.message : String(error),
                documentID: record.id,
            }];
            continue;
        }
        const group = byOriginalPath.get(record.relativePath) ?? [];
        group.push(record);
        byOriginalPath.set(record.relativePath, group);
    }

    for (const [originalPath, group] of [...byOriginalPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        group.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (group.length <= 1) continue;
        const disambiguatedPaths = group.map((record) => {
            const slash = originalPath.lastIndexOf('/');
            const directory = slash >= 0 ? originalPath.slice(0, slash + 1) : '';
            const filename = slash >= 0 ? originalPath.slice(slash + 1) : originalPath;
            const stem = filename.slice(0, -3);
            return `${directory}${stem} [${record.id}].md`;
        });
        group.forEach((record, index) => { record.relativePath = disambiguatedPaths[index]; });
        conflicts.push({
            code: 'relative_path_collision',
            originalPath,
            documentIDs: group.map((record) => record.id),
            disambiguatedPaths,
            message: `Multiple documents resolve to ${originalPath}; every member was disambiguated by document ID.`,
        });
    }

    const byCaseFoldedPath = new Map<string, SnapshotDocumentRecord[]>();
    for (const record of records) {
        if (!record.relativePath) continue;
        const key = record.relativePath.normalize('NFC').toLocaleLowerCase('en-US');
        const group = byCaseFoldedPath.get(key) ?? [];
        group.push(record);
        byCaseFoldedPath.set(key, group);
    }
    for (const [relativePath, group] of byCaseFoldedPath) {
        if (group.length <= 1) continue;
        const documentIDs = group.map((record) => record.id).sort();
        const conflict: SnapshotConflictRecord = {
            code: 'case_insensitive_path_collision',
            relativePath,
            documentIDs,
            message: `Export paths still collide under case-insensitive filesystems: ${documentIDs.join(', ')}.`,
        };
        conflicts.push(conflict);
        for (const record of group) {
            record.errors = [...(record.errors ?? []), {
                code: conflict.code,
                message: conflict.message,
                documentID: record.id,
            }];
        }
    }
    return conflicts;
}

export function flattenDocumentTree(value: unknown): SnapshotDocumentCandidate[] {
    const output: SnapshotDocumentCandidate[] = [];
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : typeof record.rootID === 'string' ? record.rootID : undefined;
        if (id) {
            output.push({
                id,
                path: typeof record.path === 'string' ? record.path : undefined,
                hPath: typeof record.hPath === 'string' ? record.hPath : undefined,
                name: typeof record.name === 'string' ? record.name : typeof record.content === 'string' ? record.content : undefined,
            });
        }
        visit(record.tree);
        visit(record.children);
    };
    visit(value);
    return output;
}
