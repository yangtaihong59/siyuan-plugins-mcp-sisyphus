/** Shapes shared by snapshot parsing, snapshot file bucketing and block diffing. */

export type BlockDiffStatus = 'unchanged' | 'modified' | 'added' | 'removed';

export type InlineDiffKind = 'same' | 'removed' | 'added';

export interface InlineDiffPart {
    text: string;
    kind: InlineDiffKind;
}

export interface SnapshotBlock {
    id?: string;
    parentID?: string;
    rootID?: string;
    type?: string;
    subtype?: string;
    text: string;
    markdown: string;
    raw?: unknown;
    order: number;
    depth: number;
}

export interface BlockDiffEntry {
    key: string;
    status: BlockDiffStatus;
    oldBlock?: SnapshotBlock;
    newBlock?: SnapshotBlock;
    oldParts?: InlineDiffPart[];
    newParts?: InlineDiffPart[];
    canAcceptBlock: boolean;
    acceptReason?: string;
}

export interface BlockDiffLineStats {
    added: number;
    removed: number;
}

export interface RepoSnapshotFileChange {
    id?: string;
    fileID?: string;
    path?: string;
    title?: string;
    name?: string;
    hSize?: string;
    updated?: number | string;
    rootID?: string;
    docID?: string;
    blockID?: string;
    [key: string]: unknown;
}

export type DiffBucket = 'modified' | 'added' | 'removed';

export interface ChangedSnapshotFile {
    key: string;
    kind: DiffBucket;
    title: string;
    oldFile?: RepoSnapshotFileChange;
    newFile?: RepoSnapshotFileChange;
    documentId?: string;
}

export interface RestoreAnchorSource {
    documentId?: string;
    oldFile?: RepoSnapshotFileChange;
    newFile?: RepoSnapshotFileChange;
}

export interface RestoreInsertPlan {
    parentIDs: string[];
    nextID?: string;
    previousID?: string;
}

export interface RestoreBlockPayload {
    dataType: 'markdown' | 'dom';
    data: string;
    id?: string;
}
