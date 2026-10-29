/** Bucket a repo snapshot diff into changed document files and resolve their ids and titles. */
import type { ChangedSnapshotFile, DiffBucket, RepoSnapshotFileChange } from './snapshot-types';

export function buildChangedFiles(diff: Record<string, RepoSnapshotFileChange[] | unknown>): ChangedSnapshotFile[] {
    const updatesLeft = asDocumentFileArray(diff.updatesLeft);
    const updatesRight = asDocumentFileArray(diff.updatesRight);
    const addsLeft = asDocumentFileArray(diff.addsLeft);
    const removesRight = asDocumentFileArray(diff.removesRight);
    const changed: ChangedSnapshotFile[] = [];
    const usedRight = new Set<number>();

    for (const [index, oldFile] of updatesLeft.entries()) {
        const match = findMatchingFile(oldFile, updatesRight, usedRight);
        changed.push(createChangedFile('modified', oldFile, match?.file, index));
        if (match) usedRight.add(match.index);
    }

    for (const [index, newFile] of updatesRight.entries()) {
        if (!usedRight.has(index) && updatesLeft.length === 0) {
            changed.push(createChangedFile('modified', undefined, newFile, index));
        }
    }

    for (const [index, file] of addsLeft.entries()) {
        changed.push(createChangedFile('added', undefined, file, index));
    }

    for (const [index, file] of removesRight.entries()) {
        changed.push(createChangedFile('removed', file, undefined, index));
    }

    return changed.filter((file, index, arr) => arr.findIndex((other) => other.key === file.key) === index);
}

export function getSnapshotFileId(file: RepoSnapshotFileChange | undefined): string {
    if (!file) return '';
    const fileID = file.fileID;
    if (typeof fileID === 'string' && fileID.trim()) return fileID;
    const id = file.id;
    return typeof id === 'string' ? id : '';
}

export function getDocumentIdFromSnapshotFile(file: unknown): string | undefined {
    if (!file || typeof file !== 'object') return undefined;
    const record = file as Record<string, unknown>;
    for (const key of ['rootID', 'docID', 'blockID']) {
        const value = record[key];
        if (typeof value === 'string' && isSiYuanId(value)) return value;
    }
    for (const key of ['path', 'name', 'title']) {
        const value = record[key];
        if (typeof value !== 'string') continue;
        const match = value.match(/([0-9]{14}-[a-z0-9]{7})\.sy\b/i) || value.match(/\b([0-9]{14}-[a-z0-9]{7})\b/i);
        if (match?.[1]) return match[1];
    }
    return undefined;
}

export function getFileTitle(file: RepoSnapshotFileChange | undefined): string {
    if (!file) return '';
    for (const key of ['title', 'name', 'path']) {
        const value = file[key];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
}

function isSiYuanId(value: string): boolean {
    return /^[0-9]{14}-[a-z0-9]{7}$/i.test(value);
}

function asFileArray(value: unknown): RepoSnapshotFileChange[] {
    return Array.isArray(value) ? value.filter((item): item is RepoSnapshotFileChange => Boolean(item && typeof item === 'object')) : [];
}

function asDocumentFileArray(value: unknown): RepoSnapshotFileChange[] {
    return asFileArray(value).filter(isSiyuanDocumentSnapshotFile);
}

function isSiyuanDocumentSnapshotFile(file: RepoSnapshotFileChange): boolean {
    const path = typeof file.path === 'string' ? file.path : '';
    return /\.sy$/i.test(path);
}

function findMatchingFile(
    file: RepoSnapshotFileChange | undefined,
    candidates: RepoSnapshotFileChange[],
    usedIndexes: Set<number>,
): { file: RepoSnapshotFileChange; index: number } | undefined {
    if (!file) return undefined;
    const key = getFileIdentity(file);
    const path = typeof file.path === 'string' ? file.path : '';
    const title = getFileTitle(file);
    const index = candidates.findIndex((candidate, candidateIndex) => {
        if (usedIndexes.has(candidateIndex)) return false;
        return getFileIdentity(candidate) === key
            || (path && candidate.path === path)
            || (title && getFileTitle(candidate) === title);
    });
    return index >= 0 ? { file: candidates[index], index } : undefined;
}

function createChangedFile(
    kind: DiffBucket,
    oldFile: RepoSnapshotFileChange | undefined,
    newFile: RepoSnapshotFileChange | undefined,
    index: number,
): ChangedSnapshotFile {
    const documentId = getDocumentIdFromSnapshotFile(newFile) || getDocumentIdFromSnapshotFile(oldFile);
    const title = getFileTitle(newFile) || getFileTitle(oldFile) || documentId || `changed-${index + 1}`;
    return {
        key: `${kind}:${documentId || title}:${getSnapshotFileId(oldFile)}:${getSnapshotFileId(newFile)}:${index}`,
        kind,
        title,
        oldFile,
        newFile,
        documentId,
    };
}

function getFileIdentity(file: RepoSnapshotFileChange | undefined): string {
    return getDocumentIdFromSnapshotFile(file) || getFileTitle(file) || getSnapshotFileId(file) || '';
}
