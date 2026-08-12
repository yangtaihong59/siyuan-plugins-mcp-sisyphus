import fs from 'node:fs';

import type { SiYuanClient } from '../api/client';
import { WriteOutcomeUnknownError } from '../api/client';
import { normalizeTemplatePath, readTemplateSource } from '../api/template';
import { readPuppyStats } from './puppy-state';
import { readLinkTargetScope } from './document-link-targets';
import type { PermissionManager } from './permissions';
import type { ToolResult } from '../tools/internal/shared';
import {
    listDocumentBlocksInTreeOrder,
    readDocumentEditableMarkdown,
} from '../tools/internal/document-kramdown';
import {
    AGENT_MEMORY_VIRTUAL_PATH,
    isDangerousAction,
    USER_RULES_VIRTUAL_PATH,
    type ToolCategory,
} from './config';
import { hashWriteBytes, hashWriteState, parseWriteHashCredential } from './write-safety-hash';
import {
    WritePreflightLeasePool,
    type WritePreflightLease,
    type WritePreflightLeaseScope,
} from './write-preflight-lease';
import {
    PRECONDITION_FIELD,
    getActionSafetyPolicy,
    type ActionSafetyPolicy,
} from './write-safety-policy';
import {
    WriteSafetyLedger,
    safetyError,
    stripSafetyFields,
    type WriteLedgerEntry,
} from './write-safety-ledger';

export interface WriteSafetyExecution {
    client: SiYuanClient;
    permMgr: PermissionManager;
    category: ToolCategory;
    action: string;
    args: Record<string, unknown>;
    strictMode: boolean;
    execute(args: Record<string, unknown>): Promise<ToolResult>;
}

interface StateProbe {
    hash: string;
    targetIds: string[];
    summary: Record<string, unknown>;
}

/**
 * Process-wide mutation coordinator. HTTP mode shares one runtime across all
 * sessions, so this mutex, lease pool, and ledger form the sole Sisyphus
 * write gateway.
 */
export class WriteSafetyCoordinator {
    private readonly ledger: WriteSafetyLedger;
    private readonly preflightLeases = new WritePreflightLeasePool();
    private serial: Promise<void> = Promise.resolve();

    constructor(client: SiYuanClient) {
        this.ledger = new WriteSafetyLedger(client);
    }

    async run(execution: WriteSafetyExecution): Promise<ToolResult> {
        const policy = getActionSafetyPolicy(execution.category, execution.action, execution.args);
        if (policy.mode === 'read') return execution.execute(execution.args);
        if (policy.mode === 'external') {
            if (execution.args.validateOnly === true) {
                return writeSafetyFailure(
                    'preflight_unavailable',
                    'This action has an external or local side effect that cannot be verified by the strict write coordinator. Nothing was executed.',
                );
            }
            return addSafetyMetadata(await execution.execute(stripSafetyFields(execution.args)), {
                writeSafetyMode: execution.strictMode ? 'strict' : 'legacy',
                writeSafetyGuaranteed: false,
                reason: 'external_uncontrolled',
            });
        }
        if (!execution.strictMode) {
            if (execution.args.validateOnly === true) {
                return writeSafetyFailure(
                    'strict_mode_disabled',
                    'Strict safe writes are disabled. The preflight did not execute the mutation.',
                );
            }
            return addSafetyMetadata(await execution.execute(stripSafetyFields(execution.args)), {
                writeSafetyMode: 'legacy',
                writeSafetyGuaranteed: false,
            });
        }
        return this.exclusive(() => this.runStrict(execution, policy));
    }

    private async runStrict(
        execution: WriteSafetyExecution,
        policy: Extract<ActionSafetyPolicy, { mode: 'mutation' }>,
    ): Promise<ToolResult> {
        const { category, action, args, client, permMgr } = execution;
        const validateOnly = args.validateOnly === true;
        const requestId = typeof args.requestId === 'string' ? args.requestId : '';
        let inspected: Awaited<ReturnType<WriteSafetyLedger['inspect']>> | undefined;
        let activeLease: WritePreflightLease | undefined;

        if (!validateOnly) {
            if (!requestId) {
                return writeSafetyFailure('precondition_required', 'requestId is required for every strict write and must be a fresh UUIDv7.');
            }
            try {
                inspected = await this.ledger.inspect(requestId, category, action, args);
            } catch (error) {
                return fromSafetyError(error);
            }
            if (inspected.entry) return replayLedgerEntry(inspected.entry);
        }

        let before: StateProbe | undefined;
        if (policy.precondition !== 'none') {
            const expectedField = PRECONDITION_FIELD[policy.precondition];
            const expected = args[expectedField] ?? (expectedField === 'expectedStateHash' ? args.expectedHash : undefined);
            const digestPrefix = validateOnly ? undefined : parseWriteHashCredential(expected);
            if (!validateOnly && !digestPrefix) {
                return writeSafetyFailure(
                    'precondition_required',
                    `${expectedField} is required and must be a 4 to 64 character hexadecimal preflight credential, optionally prefixed with sha256:v1:. Run the same action with validateOnly=true to obtain it.`,
                    { expectedField },
                );
            }
            try {
                before = await probeCurrentState(client, permMgr, category, action, args, policy);
            } catch (error) {
                return fromSafetyError(error);
            }
            const leaseScope: WritePreflightLeaseScope = {
                tool: category,
                action,
                argsHash: inspected?.argsHash ?? hashWriteState(stripSafetyFields(args)),
                targetIds: before.targetIds,
            };
            if (validateOnly) {
                const issued = this.preflightLeases.issue(leaseScope, before.hash);
                return jsonResult({
                    action,
                    validateOnly: true,
                    writeSafetyMode: 'strict',
                    writeAttempted: false,
                    writeExecuted: false,
                    preconditionField: expectedField,
                    [hashResultField(policy.precondition)]: issued.credential,
                    hashPrefixLength: issued.hashPrefixLength,
                    leaseExpiresAt: issued.leaseExpiresAt,
                    targetCount: before.targetIds.length,
                    ...before.summary,
                });
            }
            const resolved = this.preflightLeases.resolve(leaseScope, digestPrefix!);
            if (resolved.status === 'invalid') {
                return writeSafetyFailure('preflight_lease_invalid', 'The preflight credential is missing, expired, evicted, or belongs to a previous server process. No write was attempted.', {
                    expectedField,
                    revalidateRequired: true,
                });
            }
            if (resolved.status === 'ambiguous') {
                return writeSafetyFailure('ambiguous_hash_prefix', 'The submitted hash prefix matches multiple active preflight leases in this operation scope. Run validateOnly again to obtain an unambiguous credential.', {
                    expectedField,
                    minimumRequiredLength: resolved.minimumRequiredLength,
                    revalidateRequired: true,
                });
            }
            activeLease = resolved.lease;
            if (activeLease.fullHash !== before.hash) {
                this.preflightLeases.consume(activeLease);
                return writeSafetyFailure('state_changed', 'The target changed after it was read. No write was attempted.', {
                    expectedHash: expected,
                    currentHash: before.hash,
                    revalidateRequired: true,
                });
            }
        } else if (validateOnly) {
            return jsonResult({
                action,
                validateOnly: true,
                writeSafetyMode: 'strict',
                writeAttempted: false,
                writeExecuted: false,
                requestIdRequired: true,
            });
        }

        const targetIds = before?.targetIds ?? collectTargetSelectors(args);
        try {
            await this.ledger.record({
                requestId,
                tool: category,
                action,
                argsHash: inspected!.argsHash,
                targetIds,
                state: 'executing',
            });
        } catch (error) {
            return fromSafetyError(error);
        }

        let result: ToolResult;
        try {
            result = await execution.execute(stripSafetyFields(args));
        } catch (error) {
            await this.recordUnknown(requestId, category, action, inspected!.argsHash, targetIds, error);
            if (activeLease) this.preflightLeases.consume(activeLease);
            return writeSafetyFailureAfterAttempt('outcome_unknown', 'The write transport failed after execution began. Do not retry with a new requestId until the target has been inspected.', {
                requestId,
                cause: error instanceof Error ? error.message : String(error),
            });
        }

        if (result.isError) {
            const errorType = readHandlerErrorType(result);
            if (['permission_denied', 'validation_error', 'invalid_arguments', 'action_disabled'].includes(errorType)) {
                try {
                    await this.ledger.record({
                        requestId,
                        tool: category,
                        action,
                        argsHash: inspected!.argsHash,
                        targetIds,
                        state: 'failed_before_execute',
                        result: { error: errorType },
                    });
                } catch {
                    // The handler already rejected before mutation. Returning
                    // its original error remains the most useful outcome.
                }
                return addSafetyMetadata(result, {
                    requestId,
                    writeSafetyMode: 'strict',
                    writeAttempted: false,
                    writeExecuted: false,
                    replayed: false,
                    transactionState: 'rejected',
                });
            }
            await this.recordUnknown(requestId, category, action, inspected!.argsHash, targetIds, new Error('handler returned an error after execution began'));
            if (activeLease) this.preflightLeases.consume(activeLease);
            return addSafetyMetadata(result, {
                requestId,
                writeSafetyMode: 'strict',
                writeAttempted: true,
                writeExecuted: false,
                replayed: false,
                transactionState: 'unknown',
                error: { code: 'outcome_unknown' },
            });
        }

        let after: StateProbe | undefined;
        try {
            const postWriteArgs = derivePostWriteProbeArgs(category, action, args, result);
            after = category === 'notebook' && action === 'create'
                ? await probeCreatedNotebook(client, result)
                : policy.precondition === 'source'
                ? await probeUploadedResult(client, result, before!)
                : await probePostWriteState(client, permMgr, category, action, postWriteArgs, policy, before);
            await verifyPostWriteSemanticState(client, category, action, args);
        } catch (error) {
            await this.recordUnknown(requestId, category, action, inspected!.argsHash, targetIds, error);
            if (activeLease) this.preflightLeases.consume(activeLease);
            return writeSafetyFailureAfterAttempt('readback_mismatch', 'The write returned, but its result could not be read back. Do not retry automatically.', {
                requestId,
                cause: error instanceof Error ? error.message : String(error),
            });
        }

        if (before && after.hash === before.hash && expectsObservableChange(category, action, result)) {
            await this.recordUnknown(
                requestId,
                category,
                action,
                inspected!.argsHash,
                targetIds,
                new Error('handler reported a mutation but readback state did not change'),
            );
            if (activeLease) this.preflightLeases.consume(activeLease);
            return writeSafetyFailureAfterAttempt(
                'readback_mismatch',
                'The handler reported a mutation, but bounded readback did not observe the requested state change. Inspect the target before retrying.',
                { requestId, previousHash: before.hash, resultHash: after.hash },
            );
        }

        const safetyResult = {
            requestId,
            writeSafetyMode: 'strict',
            writeSafetyGuaranteed: true,
            writeAttempted: true,
            writeExecuted: true,
            replayed: false,
            transactionState: policy.precondition !== 'source' && before && after.hash === before.hash ? 'no_change' : 'committed',
            previousHash: before?.hash,
            resultHash: after.hash,
        };
        try {
            await this.ledger.record({
                requestId,
                tool: category,
                action,
                argsHash: inspected!.argsHash,
                targetIds: after.targetIds.length > 0 ? after.targetIds : targetIds,
                state: 'committed',
                result: safetyResult,
            });
        } catch (error) {
            if (activeLease) this.preflightLeases.consume(activeLease);
            return writeSafetyFailureAfterAttempt('outcome_unknown', 'The write was observed, but its idempotency record could not be committed. Do not retry automatically.', {
                requestId,
                resultHash: after.hash,
            });
        }
        if (activeLease) this.preflightLeases.consume(activeLease);
        return addSafetyMetadata(result, safetyResult);
    }

    private async recordUnknown(
        requestId: string,
        category: ToolCategory,
        action: string,
        argsHash: string,
        targetIds: string[],
        error: unknown,
    ): Promise<void> {
        try {
            await this.ledger.record({
                requestId,
                tool: category,
                action,
                argsHash,
                targetIds,
                state: 'unknown',
                result: {
                    error: error instanceof WriteOutcomeUnknownError ? error.code : 'outcome_unknown',
                },
            });
        } catch {
            // The caller is already receiving outcome_unknown. Never mask it
            // with a secondary ledger persistence failure.
        }
    }

    private async exclusive<T>(work: () => Promise<T>): Promise<T> {
        const previous = this.serial;
        let release!: () => void;
        this.serial = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
            return await work();
        } finally {
            release();
        }
    }
}

function derivePostWriteProbeArgs(
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    result: ToolResult,
): Record<string, unknown> {
    const payload = parseResultObject(result);
    if (category === 'document' && action === 'duplicate' && payload && typeof payload.id === 'string') {
        return { ...args, id: payload.id };
    }
    if (category === 'document' && action === 'ensure_link_targets' && payload && isRecord(payload.linkMap)) {
        const resolvedTargetIds = Object.values(payload.linkMap)
            .flatMap((value) => isRecord(value) && typeof value.id === 'string' ? [value.id] : []);
        return { ...args, resolvedTargetIds };
    }
    if (category === 'av' && action === 'duplicate' && payload && typeof payload.avID === 'string') {
        return {
            ...args,
            avID: payload.avID,
            ...(typeof payload.blockID === 'string' ? { blockID: payload.blockID } : {}),
        };
    }
    return args;
}

async function probeCreatedNotebook(client: SiYuanClient, result: ToolResult): Promise<StateProbe> {
    const payload = parseResultObject(result);
    const notebookID = payload && typeof payload.id === 'string' ? payload.id : '';
    if (!notebookID) {
        throw safetyError('readback_mismatch', 'The notebook creation response did not identify the new notebook.');
    }

    let notebook: Record<string, unknown> | undefined;
    for (const delay of [0, 50, 100, 200, 400]) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        const listed = await client.requestRead<{ notebooks?: Array<Record<string, unknown>> }>('/api/notebook/lsNotebooks');
        notebook = (listed?.notebooks ?? []).find((item) => item.id === notebookID);
        if (notebook) break;
    }
    if (!notebook) {
        throw safetyError('readback_mismatch', `The created notebook ${notebookID} was not observed during bounded readback.`);
    }

    const conf = await client.requestRead('/api/notebook/getNotebookConf', { notebook: notebookID });
    const state = { category: 'notebook', action: 'create', notebook, conf };
    return {
        hash: hashWriteState(state),
        targetIds: [notebookID],
        summary: { targetCount: 1 },
    };
}

async function probePostWriteState(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    policy: Extract<ActionSafetyPolicy, { mode: 'mutation' }>,
    before: StateProbe | undefined,
): Promise<StateProbe> {
    let after = await probeCurrentState(client, permMgr, category, action, args, policy);
    if (!before || after.hash !== before.hash) return after;

    // Several SiYuan mutations acknowledge before secondary indexes and
    // derived file-tree views catch up. A bounded readback poll prevents an
    // actual commit from being mislabeled as no_change while still allowing
    // legitimate idempotent/no-op writes to complete promptly.
    for (const delay of [50, 100, 200, 400, 800]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        after = await probeCurrentState(client, permMgr, category, action, args, policy);
        if (after.hash !== before.hash) break;
    }
    return after;
}

async function probeUploadedResult(client: SiYuanClient, result: ToolResult, source: StateProbe): Promise<StateProbe> {
    const payload = parseResultObject(result);
    const succMap = payload && isRecord(payload.succMap) ? payload.succMap : undefined;
    const uploadedPath = succMap
        ? Object.values(succMap).find((value): value is string => typeof value === 'string')
        : undefined;
    if (!uploadedPath) {
        throw safetyError('readback_mismatch', 'The upload response did not identify the stored asset.');
    }
    const workspacePath = uploadedPath.startsWith('/data/')
        ? uploadedPath
        : `/data/${uploadedPath.replace(/^\/+/, '')}`;
    const bytes = await client.readFileBinary(workspacePath);
    const uploadedHash = hashWriteBytes(bytes);
    if (uploadedHash !== source.hash) {
        throw safetyError('readback_mismatch', 'The uploaded asset digest does not match the validated source file.');
    }
    return {
        hash: uploadedHash,
        targetIds: [workspacePath],
        summary: { uploadedPath: workspacePath, uploadedSize: bytes.byteLength },
    };
}

async function probeCurrentState(
    client: SiYuanClient,
    permMgr: PermissionManager,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
    policy: Extract<ActionSafetyPolicy, { mode: 'mutation' }>,
): Promise<StateProbe> {
    if (policy.precondition === 'source') {
        const localFilePath = typeof args.localFilePath === 'string' ? args.localFilePath : '';
        if (!localFilePath) throw safetyError('precondition_required', 'localFilePath is required to fingerprint the upload source.');
        const bytes = await fs.promises.readFile(localFilePath);
        return {
            hash: hashWriteBytes(bytes),
            targetIds: [localFilePath],
            summary: { sourceSize: bytes.byteLength },
        };
    }

    const targetIds = collectTargetSelectors(args);
    const state: Record<string, unknown> = {
        category,
        action,
        selectors: collectStateSelectors(args),
    };

    if (category === 'fs') {
        await appendHumanPathState(client, args, state);
    } else if (category === 'mascot') {
        state.mascot = await readPuppyStats(client);
    } else if (category === 'notebook') {
        const notebooks = await client.requestRead<{ notebooks?: Array<Record<string, unknown>> }>('/api/notebook/lsNotebooks');
        const selected = (notebooks?.notebooks ?? []).filter((item) => {
            const id = typeof item.id === 'string' ? item.id : '';
            return targetIds.length === 0 || targetIds.includes(id);
        });
        state.notebooks = selected;
        for (const item of selected) {
            const id = typeof item.id === 'string' ? item.id : '';
            if (id) state[`conf:${id}`] = await client.requestRead('/api/notebook/getNotebookConf', { notebook: id });
        }
        if (action === 'set_permission') state.permissions = permMgr.getAll();
    } else if (category === 'av' && typeof args.avID === 'string') {
        state.av = await client.requestRead('/api/av/getAttributeView', { id: args.avID });
    } else if (category === 'flashcard') {
        if (typeof args.deckID === 'string') {
            const cards = await client.requestRead<Record<string, unknown>>('/api/riff/getRiffCards', {
                id: args.deckID,
                page: 1,
                pageSize: 999,
            });
            const cardID = typeof args.cardID === 'string' ? args.cardID : undefined;
            const blockIDs = Array.isArray(args.blockIDs)
                ? args.blockIDs.filter((item): item is string => typeof item === 'string')
                : [];
            const rows = Array.isArray(cards.cards)
                ? cards.cards
                : Array.isArray(cards.blocks)
                    ? cards.blocks
                    : [];
            const selectedRows = cardID
                ? rows.filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).cardID === cardID)
                : blockIDs.length > 0
                    ? rows.filter((item) => {
                        if (!item || typeof item !== 'object') return false;
                        const row = item as Record<string, unknown>;
                        const blockID = typeof row.blockID === 'string' ? row.blockID : typeof row.id === 'string' ? row.id : '';
                        return blockIDs.includes(blockID);
                    })
                    : rows;
            state.flashcards = normalizeFlashcardState(selectedRows);
        } else {
            const blockIDs = Array.isArray(args.blockIDs)
                ? args.blockIDs.filter((item): item is string => typeof item === 'string')
                : [];
            state.flashcards = blockIDs.length > 0
                ? await client.requestRead('/api/riff/getRiffCardsByBlockIDs', { blockIDs })
                : [];
        }
    } else if (category === 'file') {
        await appendFileState(client, action, args, state);
    } else if (category === 'timeline') {
        state.timelineTags = await client.requestRead('/api/repo/getRepoTagSnapshots', {});
        if (typeof args.documentId === 'string' && args.documentId) {
            const blocks = await listDocumentBlocksInTreeOrder(client, args.documentId);
            state.timelineDocument = {
                id: args.documentId,
                blocks,
                markdown: await readDocumentEditableMarkdown(client, args.documentId, blocks),
            };
        }
        await appendBlockRows(client, args, state);
    } else if (category === 'system') {
        state.system = await client.requestRead('/api/system/getConf', {});
    } else if (category === 'document' && action === 'ensure_link_targets') {
        const notebook = typeof args.notebook === 'string' ? args.notebook : '';
        const parentId = typeof args.parentId === 'string' ? args.parentId : '';
        if (!notebook || !parentId) {
            throw safetyError('precondition_required', 'document.ensure_link_targets requires explicit notebook and parentId scope.');
        }
        const scope = await readLinkTargetScope(client, { notebook, parentId });
        const declaredTargetIds = Array.isArray(args.targets)
            ? args.targets.flatMap((target) => isRecord(target) && typeof target.id === 'string' ? [target.id] : [])
            : [];
        const resolvedTargetIds = Array.isArray(args.resolvedTargetIds)
            ? args.resolvedTargetIds.filter((id): id is string => typeof id === 'string')
            : [];
        state.documentLinkTargetScope = {
            notebookID: notebook,
            parent: scope.parent,
            // Creation must freeze the complete direct-child list, not a
            // title search result, so same-title collisions and concurrent
            // child creation invalidate the preflight structure credential.
            children: scope.children,
            declaredTargetIds: [...new Set([...declaredTargetIds, ...resolvedTargetIds])].sort(),
        };
    } else {
        await appendBlockRows(client, args, state);
    }

    const managesNotebookPermission = category === 'notebook' && action === 'set_permission';
    if (category === 'notebook' && !managesNotebookPermission) {
        for (const notebook of targetIds) {
            const allowed = isDangerousAction(category, action)
                ? permMgr.canDelete(notebook)
                : permMgr.canWrite(notebook);
            if (!allowed) throw safetyError('permission_denied', `Notebook ${notebook} does not allow this write.`);
        }
    }
    if (!managesNotebookPermission) {
        enforceNotebookPermission(permMgr, state, targetIds, isDangerousAction(category, action));
    }
    return {
        hash: hashWriteState(state),
        targetIds,
        summary: { targetCount: targetIds.length },
    };
}

async function appendFileState(
    client: SiYuanClient,
    action: string,
    args: Record<string, unknown>,
    state: Record<string, unknown>,
): Promise<void> {
    const templateActions = new Set(['create_template', 'update_template', 'delete_template']);
    if (templateActions.has(action) && typeof args.path === 'string') {
        try {
            const source = await readTemplateSource(client, args.path);
            state.template = { path: normalizeTemplatePath(args.path).relativePath, markdown: source.markdown };
        } catch (error) {
            state.template = { path: normalizeTemplatePath(args.path).relativePath, missing: true };
        }
        return;
    }
    if (action === 'save_doc_as_template' && typeof args.name === 'string') {
        const relativePath = `${args.name.replace(/\.md$/i, '')}.md`;
        try {
            const source = await readTemplateSource(client, relativePath);
            state.destinationTemplate = { path: relativePath, markdown: source.markdown };
        } catch {
            state.destinationTemplate = { path: relativePath, missing: true };
        }
        await appendBlockRows(client, args, state);
        return;
    }
    if (action === 'remove_unused_assets') {
        state.unusedAssets = await client.requestRead('/api/asset/getUnusedAssets', {});
        return;
    }
    const assetPath = typeof args.oldPath === 'string'
        ? args.oldPath
        : typeof args.path === 'string'
            ? args.path
            : undefined;
    if (assetPath) {
        const workspacePath = assetPath.startsWith('/data/')
            ? assetPath
            : `/data/${assetPath.replace(/^\/+/, '')}`;
        try {
            const bytes = await client.readFileBinary(workspacePath);
            state.asset = { path: workspacePath, hash: hashWriteBytes(bytes), size: bytes.byteLength };
        } catch {
            state.asset = { path: workspacePath, missing: true };
        }
    }
    await appendBlockRows(client, args, state);
}

async function appendHumanPathState(
    client: SiYuanClient,
    args: Record<string, unknown>,
    state: Record<string, unknown>,
): Promise<void> {
    const paths = collectPathSelectors(args);
    if (paths.some((path) => path === AGENT_MEMORY_VIRTUAL_PATH || path === USER_RULES_VIRTUAL_PATH)) {
        try {
            state.virtualConfig = await client.readFile('/data/storage/petal/siyuan-plugins-mcp-sisyphus/mcpToolsConfig');
        } catch {
            state.virtualConfig = '';
        }
    }
    const physicalPaths = paths.filter((path) => path !== AGENT_MEMORY_VIRTUAL_PATH && path !== USER_RULES_VIRTUAL_PATH);
    if (physicalPaths.length === 0) return;

    const response = await client.requestRead<{ notebooks?: Array<{ id?: string; name?: string }> }>('/api/notebook/lsNotebooks');
    const notebooks = response?.notebooks ?? [];
    const pathState: Record<string, unknown> = {};
    for (const path of physicalPaths) {
        const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        const notebookName = parts.shift() ?? '';
        const notebook = notebooks.find((item) => item.name === notebookName);
        if (!notebook?.id) {
            pathState[path] = { missing: true, notebookName };
            continue;
        }
        const hpath = `/${parts.join('/')}`;
        let ids: string[] = [];
        try {
            const resolved = await client.requestRead<unknown>('/api/filetree/getIDsByHPath', {
                path: hpath,
                notebook: notebook.id,
            });
            if (Array.isArray(resolved)) {
                ids = resolved.filter((value): value is string => typeof value === 'string');
            }
        } catch {
            // Fall through to the SQL compatibility path below.
        }
        if (ids.length === 0) {
            const roots = await client.requestRead<Array<Record<string, unknown>>>('/api/query/sql', {
                stmt: `SELECT * FROM blocks WHERE box = ${sqlString(notebook.id)} AND hpath = ${sqlString(hpath)} ORDER BY id LIMIT 1`,
            });
            ids = Array.isArray(roots)
                ? roots.flatMap((row) => typeof row?.id === 'string' ? [row.id] : [])
                : [];
        }
        const rootID = ids[0];
        if (!rootID) {
            pathState[path] = { notebookID: notebook.id, hpath, missing: true };
            continue;
        }
        // The blocks SQL table is asynchronously indexed. Hashing it allowed
        // a write immediately after block.append to reuse a stale hash. Read
        // the live block tree and each block's current kramdown instead; these
        // APIs observe the editor state used by the actual write handlers.
        const blocks = await listDocumentBlocksInTreeOrder(client, rootID);
        const markdown = await readDocumentEditableMarkdown(client, rootID, blocks);
        pathState[path] = {
            notebookID: notebook.id,
            hpath,
            rootID,
            blocks,
            markdown,
        };
    }
    state.fsPaths = pathState;
}

async function appendBlockRows(
    client: SiYuanClient,
    args: Record<string, unknown>,
    state: Record<string, unknown>,
): Promise<void> {
    const ids = collectTargetSelectors(args).filter((value) => /^\d{14}-[a-z0-9]{7}$/.test(value));
    const paths = collectPathSelectors(args);
    const tag = typeof args.label === 'string'
        ? args.label
        : typeof args.oldLabel === 'string'
            ? args.oldLabel
            : undefined;
    const clauses: string[] = [];
    if (ids.length > 0) {
        const liveBlocks: Record<string, unknown> = {};
        for (const id of ids) {
            let exists: boolean | undefined;
            try {
                const value = await client.requestRead<unknown>('/api/block/checkBlockExist', { id });
                if (typeof value === 'boolean') exists = value;
            } catch {
                exists = undefined;
            }
            if (exists === false) {
                liveBlocks[id] = { missing: true };
                continue;
            }
            if (exists === true) {
                const [info, attrs, kramdown, children] = await Promise.all([
                    client.requestRead('/api/block/getBlockInfo', { id }),
                    client.requestRead('/api/attr/getBlockAttrs', { id }),
                    client.requestRead('/api/block/getBlockKramdown', { id }),
                    client.requestRead('/api/block/getChildBlocks', { id }),
                ]);
                liveBlocks[id] = normalizeLiveBlockState({ info, attrs, kramdown, children });
                continue;
            }
            const values = ids.map(sqlString).join(',');
            clauses.push(`id IN (${values})`, `root_id IN (${values})`, `parent_id IN (${values})`);
            break;
        }
        state.liveBlocks = liveBlocks;
    }
    for (const path of paths) {
        clauses.push(`path = ${sqlString(path)}`, `hpath = ${sqlString(path)}`);
    }
    if (tag) clauses.push(`markdown LIKE ${sqlString(`%#${tag.replace(/^#|#$/g, '')}#%`)}`);
    if (clauses.length === 0) {
        state.blocks = [];
        return;
    }
    state.blocks = await client.requestRead<unknown[]>('/api/query/sql', {
        stmt: `SELECT * FROM blocks WHERE ${clauses.join(' OR ')} ORDER BY id`,
    });
}

function normalizeLiveBlockState(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeLiveBlockState);
    if (typeof value === 'string') return canonicalizeKramdownIal(value);
    if (!value || typeof value !== 'object') return value;

    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        // These timestamps are derived bookkeeping, not document semantics.
        // SiYuan may also emit IAL attributes in different orders between
        // identical reads, so both forms must be normalized before hashing.
        if (key === 'updated' || key === 'created') continue;
        normalized[key] = normalizeLiveBlockState(nested);
    }
    return normalized;
}

function normalizeFlashcardState(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeFlashcardState);
    if (!value || typeof value !== 'object') return normalizeLiveBlockState(value);
    const normalized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        // The kernel derives a fresh sub-second due timestamp on every read
        // for new cards. Identity, deck binding, reps/state, and lastReview
        // are stable mutation preconditions; the computed due is not.
        if (key === 'due') continue;
        normalized[key] = normalizeFlashcardState(nested);
    }
    return normalizeLiveBlockState(normalized);
}

function canonicalizeKramdownIal(value: string): string {
    return value.replace(/\{:\s*([^}]*)\}/g, (_match, body: string) => {
        const attributes: Array<{ key: string; token: string }> = [];
        const tokenPattern = /([^\s=]+)=("(?:\\.|[^"])*"|[^\s]+)/g;
        let token: RegExpExecArray | null;
        while ((token = tokenPattern.exec(body)) !== null) {
            if (token[1] === 'updated' || token[1] === 'created') continue;
            attributes.push({ key: token[1], token: `${token[1]}=${token[2]}` });
        }
        attributes.sort((left, right) => left.key.localeCompare(right.key));
        return attributes.length > 0 ? `{: ${attributes.map((item) => item.token).join(' ')}}` : '{:}';
    });
}

async function verifyPostWriteSemanticState(
    client: SiYuanClient,
    category: ToolCategory,
    action: string,
    args: Record<string, unknown>,
): Promise<void> {
    if (category !== 'search' || action !== 'find_replace') return;
    const method = typeof args.method === 'number' ? args.method : undefined;
    const methodName = typeof args.methodName === 'string' ? args.methodName : undefined;
    const isPlainKeyword = (method === undefined || method === 0)
        && (methodName === undefined || methodName === 'keyword')
        && args.paths === undefined
        && args.types === undefined
        && args.replaceTypes === undefined;
    if (!isPlainKeyword) return;

    const ids = Array.isArray(args.ids)
        ? args.ids.filter((value): value is string => typeof value === 'string')
        : [];
    const keyword = typeof args.k === 'string' ? args.k : '';
    const replacement = typeof args.r === 'string' ? args.r : '';
    if (ids.length === 0 || !keyword) return;

    const readbacks = await Promise.all(ids.map((id) => client.requestRead<unknown>('/api/block/getBlockKramdown', { id })));
    const markdown = readbacks.map((value) => {
        if (isRecord(value) && typeof value.kramdown === 'string') return value.kramdown;
        return typeof value === 'string' ? value : '';
    }).join('\n');
    if (!replacement.includes(keyword) && markdown.includes(keyword)) {
        throw safetyError('readback_mismatch', 'The find/replace response returned, but the original keyword is still present in the requested targets.');
    }
    if (replacement && replacement !== keyword && !markdown.includes(replacement)) {
        throw safetyError('readback_mismatch', 'The find/replace response returned, but the replacement text was not observed in the requested targets.');
    }
}

function enforceNotebookPermission(
    permMgr: PermissionManager,
    state: Record<string, unknown>,
    targetIds: string[],
    destructive: boolean,
): void {
    const boxes = new Set<string>();
    collectNotebookBoxes(state, boxes);
    for (const value of targetIds) {
        if (/^\d{14}-[a-z0-9]{7}$/.test(value) && permMgr.getAll()[value]) boxes.add(value);
    }
    for (const box of boxes) {
        const allowed = destructive ? permMgr.canDelete(box) : permMgr.canWrite(box);
        if (!allowed) throw safetyError('permission_denied', `Notebook ${box} does not allow this write.`);
    }
}

function collectNotebookBoxes(value: unknown, boxes: Set<string>): void {
    if (Array.isArray(value)) {
        for (const item of value) collectNotebookBoxes(item, boxes);
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if ((key === 'box' || key === 'notebookID') && typeof nested === 'string' && nested.trim()) boxes.add(nested.trim());
        else collectNotebookBoxes(nested, boxes);
    }
}

function collectTargetSelectors(args: Record<string, unknown>): string[] {
    const values = new Set<string>();
    for (const [key, value] of Object.entries(args)) {
        if (!/(?:^id$|^ids$|ID$|IDs$|^notebook$|^path$|^from$|^to$|^oldPath$|^tag$|^label$|^oldLabel$)/.test(key)) continue;
        if (typeof value === 'string' && value.trim()) values.add(value.trim());
        if (Array.isArray(value)) {
            for (const item of value) if (typeof item === 'string' && item.trim()) values.add(item.trim());
        }
    }
    if (typeof args.parentId === 'string' && args.parentId.trim()) values.add(args.parentId.trim());
    if (Array.isArray(args.resolvedTargetIds)) {
        for (const id of args.resolvedTargetIds) if (typeof id === 'string' && id.trim()) values.add(id.trim());
    }
    if (Array.isArray(args.targets)) {
        for (const target of args.targets) {
            if (isRecord(target) && typeof target.id === 'string' && target.id.trim()) values.add(target.id.trim());
        }
    }
    return [...values].sort();
}

function collectPathSelectors(args: Record<string, unknown>): string[] {
    const paths = new Set<string>();
    for (const key of ['path', 'from', 'to', 'oldPath', 'hpath']) {
        const value = args[key];
        if (typeof value === 'string' && value.trim()) paths.add(value.trim());
    }
    return [...paths].sort();
}

function collectStateSelectors(args: Record<string, unknown>): Record<string, unknown> {
    const selectors: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
        if (key === 'action' || key === 'requestId' || key === 'validateOnly' || key.startsWith('expected')) continue;
        if (/(?:^id$|ID$|IDs$|path|notebook|tag|label|row|column|key)/i.test(key)) selectors[key] = value;
    }
    return selectors;
}

function sqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function hashResultField(precondition: string): string {
    if (precondition === 'structure') return 'structureHash';
    if (precondition === 'value') return 'valueHash';
    if (precondition === 'manifest') return 'manifestHash';
    if (precondition === 'source') return 'sourceHash';
    return 'stateHash';
}

function replayLedgerEntry(entry: WriteLedgerEntry): ToolResult {
    if (entry.state === 'committed') {
        return jsonResult({
            ...(entry.result ?? {}),
            requestId: entry.requestId,
            replayed: true,
            writeAttempted: false,
            writeExecuted: false,
        });
    }
    return writeSafetyFailure('outcome_unknown', `requestId ${entry.requestId} is in ${entry.state} state. Inspect the target before retrying.`, {
        requestId: entry.requestId,
        ledgerState: entry.state,
    });
}

function addSafetyMetadata(result: ToolResult, safety: Record<string, unknown>): ToolResult {
    const parsed = parseResultObject(result);
    const payload = parsed ? { ...parsed, safety } : { safety };
    return {
        ...result,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
    };
}

function parseResultObject(result: ToolResult): Record<string, unknown> | null {
    if (result.structuredContent) return result.structuredContent;
    const text = result.content.find((item) => item.type === 'text')?.text;
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function readHandlerErrorType(result: ToolResult): string {
    const payload = parseResultObject(result);
    return payload && isRecord(payload.error) && typeof payload.error.type === 'string'
        ? payload.error.type
        : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function writeSafetyFailure(code: string, message: string, details: Record<string, unknown> = {}): ToolResult {
    return jsonResult({
        success: false,
        writeSafetyMode: 'strict',
        writeAttempted: false,
        writeExecuted: false,
        transactionState: code === 'outcome_unknown' || code === 'readback_mismatch' ? 'unknown' : 'rejected',
        error: { code, message, ...details },
    }, true);
}

function writeSafetyFailureAfterAttempt(
    code: 'outcome_unknown' | 'readback_mismatch',
    message: string,
    details: Record<string, unknown> = {},
): ToolResult {
    return jsonResult({
        success: false,
        writeSafetyMode: 'strict',
        writeAttempted: true,
        writeExecuted: false,
        transactionState: 'unknown',
        error: { code, message, ...details },
    }, true);
}

function expectsObservableChange(category: ToolCategory, action: string, result: ToolResult): boolean {
    const payload = parseResultObject(result);
    if (!payload) return false;
    if (payload.changed === false) return false;
    for (const key of ['changed', 'created', 'updated', 'removed', 'overwritten', 'replaced', 'added']) {
        const value = payload[key];
        if (value === true || (typeof value === 'number' && value > 0)) return true;
    }
    return category === 'search' && action === 'find_replace';
}

function fromSafetyError(error: unknown): ToolResult {
    const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code)
        : 'write_safety_failed';
    return writeSafetyFailure(code, error instanceof Error ? error.message : String(error));
}

function jsonResult(payload: Record<string, unknown>, isError = false): ToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        ...(isError ? { isError: true } : {}),
    };
}
