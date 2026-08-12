import fs from 'node:fs';

import type { SiYuanClient } from '../api/client';
import { WriteOutcomeUnknownError } from '../api/client';
import { normalizeTemplatePath, readTemplateSource } from '../api/template';
import { readPuppyStats } from './puppy-state';
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
import { canonicalizeWriteState, hashWriteBytes, hashWriteState, parseWriteHashCredential } from './write-safety-hash';
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
    /** Raw probe data stays coordinator-internal; only its digest/summary reaches callers. */
    state?: Record<string, unknown>;
}

const AV_VIEW_CONFIGURATION_ACTIONS = new Set([
    'add_view',
    'set_filters',
    'set_sorts',
    'set_group',
    'set_column_visibility',
    'set_column_order',
]);

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

        // A handler may prove its requested postimage was already present
        // before dispatch. That is an idempotent no-op, not a successful
        // mutation: preserving this distinction prevents a lost response or
        // a later replay from being reported as this request having written.
        if (isExplicitNoop(result)) {
            const safetyResult = {
                requestId,
                writeSafetyMode: 'strict',
                writeSafetyGuaranteed: true,
                writeAttempted: false,
                writeExecuted: false,
                replayed: false,
                transactionState: 'no_change',
                previousHash: before?.hash,
                resultHash: before?.hash,
            };
            try {
                await this.ledger.record({
                    requestId,
                    tool: category,
                    action,
                    argsHash: inspected!.argsHash,
                    targetIds,
                    state: 'committed',
                    result: safetyResult,
                });
            } catch {
                if (activeLease) this.preflightLeases.consume(activeLease);
                return writeSafetyFailure('idempotency_unavailable', 'The operation was already applied, but its idempotency result could not be recorded. No write was attempted; revalidate before submitting again.', {
                    requestId,
                });
            }
            if (activeLease) this.preflightLeases.consume(activeLease);
            return addSafetyMetadata(result, safetyResult);
        }

        let after: StateProbe | undefined;
        try {
            const postWriteArgs = derivePostWriteProbeArgs(category, action, args, result);
            after = category === 'notebook' && action === 'create'
                ? await probeCreatedNotebook(client, result)
                : policy.precondition === 'source'
                ? await probeUploadedResult(client, result, before!)
                : await probePostWriteState(client, permMgr, category, action, postWriteArgs, policy, before);
            await verifyPostWriteSemanticState(client, category, action, args, before, after);
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
    // AV view configuration is deliberately one dispatch plus one exact raw
    // definition/carrier readback. The kernel persists these settings in the
    // same request; polling would turn a response-loss investigation into
    // repeated reads without authorizing a retry or changing the decision.
    if (category === 'av' && AV_VIEW_CONFIGURATION_ACTIONS.has(action)) return after;
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
        if (action === 'set_column_options' || isCrossObjectAvMutation(action)) {
            const inspectedAv = await inspectHighRiskAvMutation(
                client,
                permMgr,
                action,
                args,
                state.av,
            );
            state.avMutationScope = inspectedAv.state;
            for (const id of inspectedAv.targetIds) {
                if (!targetIds.includes(id)) targetIds.push(id);
            }
            targetIds.sort();
        }
        if (AV_VIEW_CONFIGURATION_ACTIONS.has(action)) {
            const blockID = typeof args.blockID === 'string' ? args.blockID : '';
            const viewID = typeof args.viewID === 'string' ? args.viewID : '';
            if (!blockID || !viewID) {
                throw safetyError('precondition_required', 'AV view configuration requires explicit avID, blockID, and viewID.');
            }
            const [attrs, dom, blockInfo] = await Promise.all([
                client.requestRead('/api/attr/getBlockAttrs', { id: blockID }),
                client.requestRead('/api/block/getBlockDOM', { id: blockID }),
                client.requestRead('/api/block/getBlockInfo', { id: blockID }),
            ]);
            const selectedViewID = isRecord(attrs) && typeof attrs['custom-sy-av-view'] === 'string'
                ? attrs['custom-sy-av-view']
                : '';
            const rawAv = extractRawAvDefinition(state.av);
            if (!selectedViewID || !findRawAvView(rawAv, selectedViewID)) {
                throw safetyError('precondition_required', 'The AV carrier does not select one exact persisted view. Refusing kernel fallback.');
            }
            if (action !== 'add_view' && selectedViewID !== viewID) {
                throw safetyError('precondition_required', 'The AV carrier no longer selects the requested view. Refusing kernel fallback.');
            }
            const domText = isRecord(dom) && typeof dom.dom === 'string' ? dom.dom : '';
            if (!domText.includes('data-type="NodeAttributeView"') || !domText.includes(`data-av-id="${args.avID}"`)) {
                throw safetyError('precondition_required', 'The explicit AV carrier does not prove NodeAttributeView ownership of the requested avID.');
            }
            const box = isRecord(blockInfo) && typeof blockInfo.box === 'string' ? blockInfo.box.trim() : '';
            if (!box) {
                throw safetyError('precondition_required', 'The explicit AV carrier has no resolvable notebook owner. Refusing an unscoped write.');
            }
            state.avCarrier = {
                blockID,
                viewID: selectedViewID,
                ...(action === 'add_view' ? { requestedViewID: viewID } : {}),
                // This resolved owner is intentionally part of the strict
                // preimage. A handler must not reach a kernel AV write when a
                // carrier cannot be tied to a notebook permission decision.
                box,
                attrs: {
                    'custom-sy-av-view': attrs['custom-sy-av-view'],
                    'custom-sy-av-visible-views': attrs['custom-sy-av-visible-views'],
                },
                dom: domText,
            };
        }
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
        if (category === 'av' && AV_VIEW_CONFIGURATION_ACTIONS.has(action)) {
            // Validate-only also resolves permission so an execution cannot
            // acquire a lease against a target the current permission file no
            // longer permits. Handler-level checks repeat this immediately
            // before dispatch as the final authorization boundary.
            await permMgr.reload();
        }
        enforceNotebookPermission(permMgr, state, targetIds, requiresDeletePermission(category, action));
    }
    return {
        hash: hashWriteState(state),
        targetIds,
        summary: { targetCount: targetIds.length },
        state,
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
    before?: StateProbe,
    after?: StateProbe,
): Promise<void> {
    if (category === 'av' && AV_VIEW_CONFIGURATION_ACTIONS.has(action)) {
        verifyAvViewConfigurationReadback(action, args, before, after);
        return;
    }
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

function verifyAvViewConfigurationReadback(
    action: string,
    args: Record<string, unknown>,
    before?: StateProbe,
    after?: StateProbe,
): void {
    const beforeState = before?.state;
    const afterState = after?.state;
    if (!beforeState || !afterState) {
        throw safetyError('readback_mismatch', 'The strict AV write has no complete pre/post raw-definition probe.');
    }
    const avID = typeof args.avID === 'string' ? args.avID : '';
    const blockID = typeof args.blockID === 'string' ? args.blockID : '';
    const viewID = typeof args.viewID === 'string' ? args.viewID : '';
    if (!avID || !blockID || !viewID) {
        throw safetyError('readback_mismatch', 'The strict AV write lost its explicit target identity during readback.');
    }
    const beforeDefinition = extractRawAvDefinition(beforeState.av);
    const afterDefinition = extractRawAvDefinition(afterState.av);
    const beforeCarrier = requireAvCarrier(beforeState.avCarrier, blockID);
    const afterCarrier = requireAvCarrier(afterState.avCarrier, blockID);
    assertExactAvCarrierReadback(afterCarrier, avID, viewID);

    if (action === 'add_view') {
        assertNativeAddViewCarrierTransition(beforeCarrier, afterCarrier, beforeDefinition, viewID);
    } else if (carrierVisibleViews(beforeCarrier) !== carrierVisibleViews(afterCarrier)) {
        // A carrier-visible list is user configuration, not navigation state.
        // The current kernel does not alter it for these other writes; fail
        // closed if a future implementation starts changing it behind their
        // narrow actions.
        throw safetyError('readback_mismatch', 'The AV carrier visible-view configuration changed outside the requested action.');
    }
    if (carrierBox(beforeCarrier) !== carrierBox(afterCarrier)) {
        throw safetyError('readback_mismatch', 'The AV carrier notebook owner changed during the write.');
    }

    if (action === 'add_view') {
        if (findRawAvView(beforeDefinition, viewID)) {
            throw safetyError('readback_mismatch', `View ${viewID} existed before the requested addition.`);
        }
        const created = findRawAvView(afterDefinition, viewID);
        if (!created || created.type !== args.layout || created.name !== args.name) {
            throw safetyError('readback_mismatch', 'Raw AV readback did not prove the requested new view ID, layout, and name.');
        }
    } else {
        const afterView = requireRawAvView(afterDefinition, viewID);
        verifyAvTargetConfiguration(action, args, afterView, beforeDefinition);
    }

    const protectedBefore = projectProtectedAvDefinition(beforeDefinition, action, args, false);
    const protectedAfter = projectProtectedAvDefinition(afterDefinition, action, args, true);
    if (canonicalizeWriteState(protectedBefore) !== canonicalizeWriteState(protectedAfter)) {
        throw safetyError('readback_mismatch', 'Raw AV readback observed an unrelated persistent definition change.');
    }
}

function extractRawAvDefinition(value: unknown): Record<string, unknown> {
    if (!isRecord(value) || !isRecord(value.av)) {
        throw safetyError('readback_mismatch', 'The raw getAttributeView response has no AV definition.');
    }
    return value.av;
}

function findRawAvView(definition: Record<string, unknown>, viewID: string): Record<string, unknown> | undefined {
    const views = definition.views;
    if (!Array.isArray(views)) return undefined;
    const matches = views.filter((value): value is Record<string, unknown> => isRecord(value) && value.id === viewID);
    if (matches.length > 1) {
        throw safetyError('readback_mismatch', `View ${viewID} resolved more than once in the raw AV definition.`);
    }
    return matches[0];
}

function requireRawAvView(definition: Record<string, unknown>, viewID: string): Record<string, unknown> {
    const view = findRawAvView(definition, viewID);
    if (!view) throw safetyError('readback_mismatch', `View ${viewID} is absent from raw AV readback.`);
    return view;
}

function requireAvCarrier(value: unknown, blockID: string): Record<string, unknown> {
    if (!isRecord(value) || value.blockID !== blockID) {
        throw safetyError('readback_mismatch', 'The exact AV carrier was not present in strict readback.');
    }
    return value;
}

function carrierVisibleViews(carrier: Record<string, unknown>): unknown {
    return isRecord(carrier.attrs) ? carrier.attrs['custom-sy-av-visible-views'] : undefined;
}

function assertNativeAddViewCarrierTransition(
    beforeCarrier: Record<string, unknown>,
    afterCarrier: Record<string, unknown>,
    beforeDefinition: Record<string, unknown>,
    viewID: string,
): void {
    // SiYuan v3.8.0 `addAttrViewView` derives the old carrier list with
    // `GetVisibleViewIDs`, appends the requested ID, then writes both
    // `custom-sy-av-view` and `custom-sy-av-visible-views`. This is an
    // intentional, carrier-scoped side effect of creating a view, not a
    // license to accept a changed list. Reproducing that normalization here
    // catches a wrong/missing new ID, reordered legacy entries, and extra IDs.
    const expected = [...normalizeCarrierVisibleViewIDs(
        carrierVisibleViews(beforeCarrier),
        beforeDefinition,
    ), viewID].join(',');
    if (carrierVisibleViews(afterCarrier) !== expected) {
        throw safetyError('readback_mismatch', 'The new AV view was not the exact native addition to this carrier visible-view list.');
    }
}

function normalizeCarrierVisibleViewIDs(value: unknown, definition: Record<string, unknown>): string[] {
    const views = definition.views;
    if (!Array.isArray(views)) {
        throw safetyError('readback_mismatch', 'Raw AV readback has no view order for carrier visible-view normalization.');
    }
    const orderedViewIDs: string[] = [];
    for (const view of views) {
        if (!isRecord(view) || typeof view.id !== 'string' || !view.id) continue;
        if (orderedViewIDs.includes(view.id)) {
            throw safetyError('readback_mismatch', `Raw AV readback contains duplicate view ID ${view.id}.`);
        }
        orderedViewIDs.push(view.id);
    }
    if (orderedViewIDs.length === 0) {
        throw safetyError('readback_mismatch', 'Raw AV readback has no persisted views for carrier visible-view normalization.');
    }
    // An absent/empty attr means all existing views. A non-empty attr is a
    // set, which the kernel reorders by raw AV view order and falls back to the
    // first view when no configured ID still exists.
    if (value === undefined || value === '') return orderedViewIDs;
    if (typeof value !== 'string') {
        throw safetyError('readback_mismatch', 'The AV carrier visible-view configuration is not a string.');
    }
    const configured = new Set(value.split(',').map((id) => id.trim()).filter(Boolean));
    const normalized = orderedViewIDs.filter((id) => configured.has(id));
    return normalized.length > 0 ? normalized : [orderedViewIDs[0]];
}

function carrierBox(carrier: Record<string, unknown>): string {
    return typeof carrier.box === 'string' ? carrier.box : '';
}

function assertExactAvCarrierReadback(carrier: Record<string, unknown>, avID: string, viewID: string): void {
    const attrs = isRecord(carrier.attrs) ? carrier.attrs : undefined;
    const dom = typeof carrier.dom === 'string' ? carrier.dom : '';
    if (carrier.viewID !== viewID || attrs?.['custom-sy-av-view'] !== viewID
        || !dom.includes('data-type="NodeAttributeView"') || !dom.includes(`data-av-id="${avID}"`)) {
        throw safetyError('readback_mismatch', 'The carrier did not retain the exact AV/view binding requested by this write.');
    }
}

function verifyAvTargetConfiguration(
    action: string,
    args: Record<string, unknown>,
    afterView: Record<string, unknown>,
    definition: Record<string, unknown>,
): void {
    if (action === 'set_filters') {
        if (!sameAvValue(normalizeAvFilters(args.filters), normalizeAvFilters(afterView.filters))) {
            throw safetyError('readback_mismatch', 'The persisted filter tree does not match the requested complete replacement.');
        }
        return;
    }
    if (action === 'set_sorts') {
        const expected = Array.isArray(args.sorts) ? args.sorts : [];
        const actual = Array.isArray(afterView.sorts) ? afterView.sorts : [];
        if (!sameAvValue(expected, actual)) {
            throw safetyError('readback_mismatch', 'The persisted sort list does not match the requested complete replacement.');
        }
        return;
    }
    if (action === 'set_group') {
        if (!sameAvValue(normalizeAvGroup(args.group, definition), normalizeAvGroup(afterView.group, definition))) {
            throw safetyError('readback_mismatch', 'The persisted group configuration does not match the requested semantic group.');
        }
        return;
    }
    const keyID = typeof args.keyID === 'string' ? args.keyID : '';
    const fields = rawViewFields(afterView);
    if (action === 'set_column_visibility') {
        const field = fields.find((value) => isRecord(value) && value.id === keyID);
        if (!field || Boolean((field as Record<string, unknown>).hidden) !== args.hidden) {
            throw safetyError('readback_mismatch', 'The persisted view-field visibility does not match the requested value.');
        }
        return;
    }
    if (action === 'set_column_order') {
        const expected = Array.isArray(args.keyIDs) ? args.keyIDs : [];
        const actual = fields.map((value) => isRecord(value) ? value.id : undefined);
        if (!sameAvValue(expected, actual)) {
            throw safetyError('readback_mismatch', 'The persisted view-field order does not match the required complete order.');
        }
        return;
    }
    throw safetyError('readback_mismatch', `Unsupported AV semantic readback action: ${action}.`);
}

function normalizeAvFilters(value: unknown): unknown[] {
    const source = Array.isArray(value) ? value : [];
    const normalizeNode = (node: unknown): unknown => {
        if (!isRecord(node)) return node;
        const normalized = cloneJsonRecord(node);
        normalized.column = typeof normalized.column === 'string' ? normalized.column : '';
        normalized.operator = typeof normalized.operator === 'string' ? normalized.operator : '';
        if (!('value' in normalized)) normalized.value = null;
        const children = Array.isArray(normalized.filters) ? normalized.filters : [];
        if (children.length > 0) normalized.filters = children.map(normalizeNode);
        else delete normalized.filters;
        return normalized;
    };
    const isGroup = (node: unknown): boolean => isRecord(node)
        && (typeof node.combination === 'string' || Array.isArray(node.filters));
    if (source.length === 1 && isGroup(source[0])) return [normalizeNode(source[0])];
    return [normalizeNode({ combination: 'and', filters: source })];
}

function normalizeAvGroup(value: unknown, definition: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!isRecord(value)) return undefined;
    const normalized: Record<string, unknown> = {
        field: typeof value.field === 'string' ? value.field : '',
        method: typeof value.method === 'number' ? value.method : 0,
        order: typeof value.order === 'number' ? value.order : 0,
        hideEmpty: value.hideEmpty === true,
    };
    if (isRecord(value.range)) {
        normalized.range = {
            numStart: value.range.numStart,
            numEnd: value.range.numEnd,
            numStep: value.range.numStep,
        };
    }
    // The kernel deliberately switches first-time select/multi-select groups
    // to option-order (3), regardless of a caller's stale generic order.
    // This is a documented semantic normalization, not permission to ignore
    // arbitrary group changes or derived group-state drift.
    const keyType = rawAvKeyType(definition, normalized.field as string);
    if (normalized.field && (keyType === 'select' || keyType === 'mSelect')) normalized.order = 3;
    return normalized;
}

function rawAvKeyType(definition: Record<string, unknown>, keyID: string): string | undefined {
    const keyValues = definition.keyValues;
    if (!Array.isArray(keyValues)) return undefined;
    const found = keyValues.find((value) => isRecord(value) && isRecord(value.key) && value.key.id === keyID);
    return isRecord(found) && isRecord(found.key) && typeof found.key.type === 'string' ? found.key.type : undefined;
}

function rawViewFields(view: Record<string, unknown>): unknown[] {
    if (view.type === 'table' && isRecord(view.table) && Array.isArray(view.table.columns)) return view.table.columns;
    if (view.type === 'gallery' && isRecord(view.gallery) && Array.isArray(view.gallery.fields)) return view.gallery.fields;
    if (view.type === 'kanban' && isRecord(view.kanban) && Array.isArray(view.kanban.fields)) return view.kanban.fields;
    throw safetyError('readback_mismatch', `View ${String(view.id)} has no fields for its persisted layout.`);
}

function projectProtectedAvDefinition(
    definition: Record<string, unknown>,
    action: string,
    args: Record<string, unknown>,
    after: boolean,
): Record<string, unknown> {
    const viewID = typeof args.viewID === 'string' ? args.viewID : '';
    const projected = cloneJsonRecord(definition);
    // AV-level current view is native navigation state. It changes when a
    // view is added and is never proof that a carrier-targeted configuration
    // write selected the intended view.
    delete projected.viewID;
    normalizeDerivedGroups(projected);
    if (!Array.isArray(projected.views)) return projected;
    if (action === 'add_view' && after) {
        projected.views = projected.views.filter((value) => !isRecord(value) || value.id !== viewID);
        return projected;
    }
    const target = projected.views.find((value): value is Record<string, unknown> => isRecord(value) && value.id === viewID);
    if (!target) return projected;
    if (action === 'set_filters') delete target.filters;
    else if (action === 'set_sorts') delete target.sorts;
    else if (action === 'set_group') {
        delete target.group;
        delete target.groups;
        delete target.groupCreated;
        delete target.groupItemIds;
        delete target.groupCalc;
        delete target.groupKey;
    } else if (action === 'set_column_visibility') {
        const keyID = typeof args.keyID === 'string' ? args.keyID : '';
        const fields = rawViewFields(target);
        const field = fields.find((value): value is Record<string, unknown> => isRecord(value) && value.id === keyID);
        if (!field) throw safetyError('readback_mismatch', `View ${viewID} has no requested field ${keyID}.`);
        delete field.hidden;
    } else if (action === 'set_column_order') {
        // The transaction repositions every requested field. Sort the local
        // projection by stable field ID so the comparison still protects each
        // field's full configuration while excluding only presentation order.
        const fields = rawViewFields(target);
        fields.sort((left, right) => {
            const leftID = isRecord(left) && typeof left.id === 'string' ? left.id : '';
            const rightID = isRecord(right) && typeof right.id === 'string' ? right.id : '';
            return leftID.localeCompare(rightID);
        });
    }
    return projected;
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function normalizeDerivedGroups(definition: Record<string, unknown>): void {
    if (!Array.isArray(definition.views)) return;
    for (const rawView of definition.views) {
        if (!isRecord(rawView)) continue;
        delete rawView.groupCreated;
        if (!Array.isArray(rawView.groups)) continue;
        const groups = rawView.groups
            .filter(isRecord)
            .map((group) => {
                const semantic: Record<string, unknown> = {};
                for (const key of ['id', 'groupItemIds', 'groupVal', 'groupFolded', 'groupHidden', 'groupSort']) {
                    if (key in group) semantic[key] = group[key];
                }
                return semantic;
            });
        groups.sort((left, right) => canonicalizeWriteState(left).localeCompare(canonicalizeWriteState(right)));
        rawView.groups = groups;
    }
}

function sameAvValue(left: unknown, right: unknown): boolean {
    return canonicalizeWriteState(left) === canonicalizeWriteState(right);
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

function requiresDeletePermission(category: ToolCategory, action: string): boolean {
    // AV schema/record changes can be dangerous enough to require an explicit
    // confirmation, yet they are not notebook deletion. Keep confirmation and
    // permission as separate concepts: W2 AV writes require rw/rwd, while
    // actual destructive actions retain the rwd gate.
    return isDangerousAction(category, action) && category !== 'av';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function stringField(value: unknown, keys: string[]): string | undefined {
    const record = asRecord(value);
    for (const key of keys) {
        const candidate = record?.[key];
        if (typeof candidate === 'string' && candidate) return candidate;
    }
    return undefined;
}

function avEnvelope(value: unknown): unknown {
    const record = asRecord(value);
    return record && Object.prototype.hasOwnProperty.call(record, 'av') ? record.av : value;
}

function avKeyValueEntries(avData: unknown): Array<{ key: Record<string, unknown>; values: Array<Record<string, unknown>> }> {
    const keyValues = asRecord(avData)?.keyValues;
    if (!Array.isArray(keyValues)) return [];
    return keyValues.flatMap((entry) => {
        const record = asRecord(entry);
        const key = asRecord(record?.key);
        const values = Array.isArray(record?.values)
            ? record.values.flatMap((item) => asRecord(item) ? [item] : [])
            : [];
        return key ? [{ key, values }] : [];
    });
}

function avRelationBlockIDs(value: Record<string, unknown> | undefined): string[] {
    const relation = asRecord(value?.relation);
    return Array.isArray(relation?.blockIDs)
        ? relation.blockIDs.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
}

function inspectDuplicateRowsRelationDestinations(
    avData: unknown,
    sourceRowIDs: string[],
): Array<{ avID: string; backKeyID: string; destinationRowIDs: string[] }> {
    const destinations = new Map<string, { avID: string; backKeyID: string; destinationRowIDs: string[] }>();
    for (const entry of avKeyValueEntries(avData)) {
        if (stringField(entry.key, ['type']) !== 'relation') continue;
        const relation = asRecord(entry.key.relation);
        const avID = stringField(relation, ['avID']);
        const backKeyID = stringField(relation, ['backKeyID']);
        if (relation?.isTwoWay !== true || !avID || !backKeyID) continue;
        const destination = destinations.get(`${avID}:${backKeyID}`) ?? {
            avID,
            backKeyID,
            destinationRowIDs: [],
        };
        for (const sourceRowID of sourceRowIDs) {
            const sourceValue = entry.values.find((value) => stringField(value, ['blockID']) === sourceRowID);
            for (const destinationRowID of avRelationBlockIDs(sourceValue)) {
                if (!destination.destinationRowIDs.includes(destinationRowID)) destination.destinationRowIDs.push(destinationRowID);
            }
        }
        // Only linked rows can receive a reverse-relation mutation. A bare
        // two-way key must not expand the strict preflight's permission scope.
        if (destination.destinationRowIDs.length > 0) {
            destinations.set(`${avID}:${backKeyID}`, destination);
        }
    }
    return [...destinations.values()];
}

async function resolveVerifiedAvCarrier(
    client: SiYuanClient,
    avID: string,
    explicitBlockID?: string,
): Promise<string | undefined> {
    const candidates: string[] = explicitBlockID ? [explicitBlockID] : [];
    if (explicitBlockID) {
        try {
            const response = await client.requestRead<{ dom?: string }>('/api/block/getBlockDOM', { id: explicitBlockID });
            const dom = typeof response?.dom === 'string' ? response.dom : '';
            return dom.includes('data-type="NodeAttributeView"') && dom.includes(`data-av-id="${avID}"`)
                ? explicitBlockID
                : undefined;
        } catch {
            return undefined;
        }
    }
    try {
        const mirrors = await client.requestRead<{ refDefs?: Array<{ refID?: string }> }>('/api/av/getMirrorDatabaseBlocks', { avID });
        for (const ref of mirrors?.refDefs ?? []) {
            if (typeof ref.refID === 'string' && ref.refID && !candidates.includes(ref.refID)) candidates.push(ref.refID);
        }
    } catch {
        // SQL lookup below is the compatibility path for databases without
        // registered mirrors; a missing mirror response alone is not a reason
        // to grant a cross-AV write.
    }
    const escapedAvID = avID.replace(/\0/g, '').replace(/'/g, "''");
    const rows = await client.requestRead<unknown[]>('/api/query/sql', {
        stmt: `SELECT id FROM blocks WHERE type = 'av' AND (markdown LIKE '%${escapedAvID}%' OR ial LIKE '%${escapedAvID}%' OR content LIKE '%${escapedAvID}%') ORDER BY updated DESC LIMIT 20`,
    });
    for (const row of Array.isArray(rows) ? rows : []) {
        const id = stringField(row, ['id']);
        if (id && !candidates.includes(id)) candidates.push(id);
    }
    for (const candidate of candidates) {
        try {
            const response = await client.requestRead<{ dom?: string }>('/api/block/getBlockDOM', { id: candidate });
            const dom = typeof response?.dom === 'string' ? response.dom : '';
            if (dom.includes('data-type="NodeAttributeView"') && dom.includes(`data-av-id="${avID}"`)) return candidate;
        } catch {
            // A stale candidate is not evidence of AV ownership; continue to
            // the next exact carrier candidate and fail closed if none remain.
        }
    }
    return undefined;
}

async function resolveCarrierNotebook(client: SiYuanClient, carrierBlockID: string): Promise<string | undefined> {
    const info = await client.requestRead<unknown>('/api/block/getBlockInfo', { id: carrierBlockID });
    return stringField(info, ['box', 'notebook', 'notebookID']);
}

async function requireCarrierWritePermission(
    client: SiYuanClient,
    permMgr: PermissionManager,
    avID: string,
    explicitBlockID?: string,
): Promise<{ carrierBlockID: string; notebook: string; carrier: Record<string, unknown> }> {
    const carrierBlockID = await resolveVerifiedAvCarrier(client, avID, explicitBlockID);
    if (!carrierBlockID) {
        throw safetyError('permission_denied', `Could not resolve a verified database carrier for attribute view "${avID}". No write was attempted.`);
    }
    const notebook = await resolveCarrierNotebook(client, carrierBlockID);
    if (!notebook) {
        throw safetyError('permission_denied', `Could not resolve the notebook for database carrier "${carrierBlockID}". No write was attempted.`);
    }
    await permMgr.reload();
    if (!permMgr.canWrite(notebook)) {
        throw safetyError('permission_denied', `Notebook ${notebook} does not allow writes to attribute view "${avID}".`);
    }
    const [domResponse, info] = await Promise.all([
        client.requestRead<{ dom?: string }>('/api/block/getBlockDOM', { id: carrierBlockID }),
        client.requestRead<unknown>('/api/block/getBlockInfo', { id: carrierBlockID }),
    ]);
    const dom = typeof domResponse?.dom === 'string' ? domResponse.dom : '';
    const currentNotebook = stringField(info, ['box', 'notebook', 'notebookID']);
    if (!dom.includes('data-type="NodeAttributeView"') || !dom.includes(`data-av-id="${avID}"`) || currentNotebook !== notebook) {
        throw safetyError('precondition_required', `The verified database carrier for attribute view "${avID}" changed while establishing the strict lease. No write was attempted.`);
    }
    return {
        carrierBlockID,
        notebook,
        carrier: { blockID: carrierBlockID, notebook, dom, info },
    };
}

async function inspectHighRiskAvMutation(
    client: SiYuanClient,
    permMgr: PermissionManager,
    action: string,
    args: Record<string, unknown>,
    sourceReadback: unknown,
): Promise<{ state: Record<string, unknown>; targetIds: string[] }> {
    const source = avEnvelope(sourceReadback);
    const avID = typeof args.avID === 'string' ? args.avID : '';
    const explicitSourceBlockID = typeof args.blockID === 'string' && args.blockID ? args.blockID : undefined;
    const sourceCarrier = await requireCarrierWritePermission(client, permMgr, avID, explicitSourceBlockID);
    if (action === 'set_column_options') {
        const keyID = typeof args.keyID === 'string' ? args.keyID : '';
        const key = avKeyValueEntries(source).map((entry) => entry.key).find((candidate) => stringField(candidate, ['id']) === keyID);
        if (!key || !['select', 'mSelect'].includes(stringField(key, ['type']) ?? '')) {
            throw safetyError('precondition_required', `keyID ${keyID || '<missing>'} is not a select or multi-select key in attribute view ${avID}. No write was attempted.`);
        }
        return { state: { source, sourceCarrier }, targetIds: [sourceCarrier.carrierBlockID] };
    }

    if (action === 'set_relation') {
        const sourceItemID = requiredAvActionId(args, 'itemID', action);
        const keyID = requiredAvActionId(args, 'keyID', action);
        const relatedItemIDs = stringArrayArgument(args, 'relatedItemIDs');
        const relation = requireAvRelationKey(source, keyID, action);
        const destination = await inspectAvMutationDestination(client, permMgr, relation.avID);
        for (const itemID of [sourceItemID, ...relatedItemIDs]) {
            const definition = itemID === sourceItemID ? source : destination.av;
            if (!hasAvRowItem(definition, itemID)) {
                throw safetyError('precondition_required', `${action}: itemID ${itemID} is not a canonical AV row in its resolved attribute view. No write was attempted.`);
            }
        }
        return {
            state: {
                source,
                sourceCarrier,
                relation: {
                    keyID,
                    itemID: sourceItemID,
                    relatedItemIDs,
                    ...relation,
                    destination,
                },
            },
            targetIds: sortedUniqueIds([
                avID,
                sourceCarrier.carrierBlockID,
                sourceCarrier.notebook,
                relation.avID,
                destination.carrierBlockID,
                destination.notebook,
            ]),
        };
    }

    if (action === 'configure_two_way_relation') {
        const keyID = requiredAvActionId(args, 'keyID', action);
        const destinationAvID = requiredAvActionId(args, 'destinationAvID', action);
        const sourceKey = avKeyValueEntries(source).map((entry) => entry.key).find((candidate) => stringField(candidate, ['id']) === keyID);
        if (!sourceKey || stringField(sourceKey, ['type']) !== 'relation') {
            throw safetyError('precondition_required', `${action}: keyID ${keyID} is not an existing relation key. No write was attempted.`);
        }
        const configuredDestinationAvID = stringField(asRecord(sourceKey.relation), ['avID']);
        if (configuredDestinationAvID && configuredDestinationAvID !== destinationAvID) {
            throw safetyError('precondition_required', `${action}: source relation targets ${configuredDestinationAvID}, not requested destination ${destinationAvID}. No write was attempted.`);
        }
        const explicitDestinationBlockID = optionalAvActionId(args, 'destinationBlockID');
        const destination = await inspectAvMutationDestination(client, permMgr, destinationAvID, explicitDestinationBlockID);
        return {
            state: {
                source,
                sourceCarrier,
                twoWayRelation: {
                    keyID,
                    destinationAvID,
                    ...(configuredDestinationAvID ? { configuredDestinationAvID } : {}),
                    backRelationKeyID: requiredAvActionId(args, 'backRelationKeyID', action),
                    destination,
                },
            },
            targetIds: sortedUniqueIds([
                avID,
                sourceCarrier.carrierBlockID,
                sourceCarrier.notebook,
                destinationAvID,
                destination.carrierBlockID,
                destination.notebook,
            ]),
        };
    }

    if (action === 'configure_rollup') {
        const relationKeyID = requiredAvActionId(args, 'relationKeyID', action);
        const destinationKeyID = requiredAvActionId(args, 'destinationKeyID', action);
        const relation = requireAvRelationKey(source, relationKeyID, action);
        const destination = await inspectAvMutationDestination(client, permMgr, relation.avID);
        if (!hasAvKey(destination.av, destinationKeyID)) {
            throw safetyError('precondition_required', `${action}: destination key ${destinationKeyID} is absent from attribute view ${relation.avID}. No write was attempted.`);
        }
        return {
            state: {
                source,
                sourceCarrier,
                rollup: {
                    keyID: requiredAvActionId(args, 'keyID', action),
                    relationKeyID,
                    destinationKeyID,
                    relation,
                    destination,
                },
            },
            targetIds: sortedUniqueIds([
                avID,
                sourceCarrier.carrierBlockID,
                sourceCarrier.notebook,
                relation.avID,
                destination.carrierBlockID,
                destination.notebook,
            ]),
        };
    }

    if (action === 'create_from_template') {
        const templateID = requiredAvActionId(args, 'templateID', action);
        const template = requireAvTemplate(source, templateID, action);
        const relationDestinations = await inspectTemplateRelationDestinations(client, permMgr, source, template, action);
        const documentDestination = await inspectTemplateDocumentDestination(client, permMgr, template, sourceCarrier, action);
        return {
            state: {
                source,
                sourceCarrier,
                template: {
                    templateID,
                    definition: template,
                    relationDestinations,
                    documentDestination,
                },
            },
            targetIds: sortedUniqueIds([
                avID,
                sourceCarrier.carrierBlockID,
                sourceCarrier.notebook,
                ...relationDestinations.flatMap((destination) => [destination.avID, destination.carrierBlockID, destination.notebook]),
                ...(documentDestination ? [documentDestination.notebook] : []),
            ]),
        };
    }

    const sourceRowIDs = Array.isArray(args.sourceRowIDs)
        ? args.sourceRowIDs.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : [];
    const destinations = [];
    const targetIds: string[] = [avID, sourceCarrier.carrierBlockID, sourceCarrier.notebook];
    for (const destination of inspectDuplicateRowsRelationDestinations(source, sourceRowIDs)) {
        const response = await client.requestRead('/api/av/getAttributeView', { id: destination.avID });
        const av = avEnvelope(response);
        const carrier = await requireCarrierWritePermission(client, permMgr, destination.avID);
        targetIds.push(
            destination.avID,
            carrier.carrierBlockID,
            carrier.notebook,
        );
        destinations.push({ ...destination, ...carrier, av });
    }
    return { state: { source, sourceCarrier, destinations }, targetIds: sortedUniqueIds(targetIds) };
}

function isCrossObjectAvMutation(action: string): boolean {
    return [
        'duplicate_rows',
        'set_relation',
        'configure_two_way_relation',
        'configure_rollup',
        'create_from_template',
    ].includes(action);
}

function requiredAvActionId(args: Record<string, unknown>, key: string, action: string): string {
    const value = optionalAvActionId(args, key);
    if (!value) throw safetyError('precondition_required', `${action} requires ${key} to resolve its complete strict mutation scope.`);
    return value;
}

function optionalAvActionId(args: Record<string, unknown>, key: string): string | undefined {
    const value = args[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayArgument(args: Record<string, unknown>, key: string): string[] {
    return Array.isArray(args[key])
        ? args[key].filter((value): value is string => typeof value === 'string' && value.trim()).map((value) => value.trim())
        : [];
}

function requireAvRelationKey(
    definition: unknown,
    keyID: string,
    action: string,
): { avID: string; backKeyID?: string; isTwoWay: boolean } {
    const key = avKeyValueEntries(definition).map((entry) => entry.key).find((candidate) => stringField(candidate, ['id']) === keyID);
    const relation = asRecord(key?.relation);
    const avID = stringField(relation, ['avID']);
    if (!key || stringField(key, ['type']) !== 'relation' || !avID) {
        throw safetyError('precondition_required', `${action}: keyID ${keyID} is not a configured relation with a destination AV. No write was attempted.`);
    }
    return {
        avID,
        backKeyID: stringField(relation, ['backKeyID']),
        isTwoWay: relation?.isTwoWay === true,
    };
}

function hasAvKey(definition: unknown, keyID: string): boolean {
    return avKeyValueEntries(definition).some((entry) => stringField(entry.key, ['id']) === keyID);
}

function hasAvRowItem(definition: unknown, itemID: string): boolean {
    return avKeyValueEntries(definition).some((entry) => entry.values.some((value) => stringField(value, ['blockID']) === itemID));
}

function requireAvTemplate(definition: unknown, templateID: string, action: string): Record<string, unknown> {
    const templates = asRecord(definition)?.newItemTemplates;
    const matches = Array.isArray(templates)
        ? templates.filter((template): template is Record<string, unknown> => isRecord(template) && template.id === templateID)
        : [];
    if (matches.length !== 1) {
        throw safetyError('precondition_required', `${action}: templateID ${templateID} did not resolve exactly once in the source AV. No write was attempted.`);
    }
    return matches[0];
}

async function inspectAvMutationDestination(
    client: SiYuanClient,
    permMgr: PermissionManager,
    avID: string,
    explicitBlockID?: string,
): Promise<{ av: unknown; carrierBlockID: string; notebook: string }> {
    const response = await client.requestRead('/api/av/getAttributeView', { id: avID });
    const carrier = await requireCarrierWritePermission(client, permMgr, avID, explicitBlockID);
    // A destination AV can be mutated by a relation/template action even though
    // the API request names only the source. Keeping its raw definition,
    // verified carrier, and notebook in this one coordinator probe makes the
    // lease reject destination drift before the handler can dispatch.
    return { av: avEnvelope(response), ...carrier };
}

async function inspectTemplateRelationDestinations(
    client: SiYuanClient,
    permMgr: PermissionManager,
    source: unknown,
    template: Record<string, unknown>,
    action: string,
): Promise<Array<{ keyID: string; relatedItemIDs: string[]; avID: string; backKeyID?: string; isTwoWay: boolean; av: unknown; carrierBlockID: string; notebook: string }>> {
    const fieldValues = asRecord(template.fieldValues);
    const destinations: Array<{ keyID: string; relatedItemIDs: string[]; avID: string; backKeyID?: string; isTwoWay: boolean; av: unknown; carrierBlockID: string; notebook: string }> = [];
    for (const keyID of Object.keys(fieldValues ?? {}).sort()) {
        const fieldValue = asRecord(fieldValues?.[keyID]);
        const value = asRecord(fieldValue?.value);
        if (value?.type !== 'relation') continue;
        const relatedItemIDs = avRelationBlockIDs(value);
        const relation = requireAvRelationKey(source, keyID, action);
        const destination = await inspectAvMutationDestination(client, permMgr, relation.avID);
        for (const itemID of relatedItemIDs) {
            if (!hasAvRowItem(destination.av, itemID)) {
                throw safetyError('precondition_required', `${action}: template relation itemID ${itemID} is absent from destination AV ${relation.avID}. No write was attempted.`);
            }
        }
        destinations.push({ keyID, relatedItemIDs, ...relation, ...destination });
    }
    return destinations;
}

async function inspectTemplateDocumentDestination(
    client: SiYuanClient,
    permMgr: PermissionManager,
    template: Record<string, unknown>,
    sourceCarrier: { carrierBlockID: string; notebook: string },
    action: string,
): Promise<{ notebook: string; config: unknown } | undefined> {
    if (template.targetType !== 'document') return undefined;
    const saveLocation = asRecord(template.saveLocation);
    if (!saveLocation) {
        throw safetyError('precondition_required', `${action}: document templates require an explicit saveLocation so the destination notebook can enter the strict lease.`);
    }
    const notebook = stringField(saveLocation, ['boxID']) ?? sourceCarrier.notebook;
    await permMgr.reload();
    if (!permMgr.canWrite(notebook)) {
        throw safetyError('permission_denied', `Notebook ${notebook} does not allow this document-template write.`);
    }
    return {
        notebook,
        config: await client.requestRead('/api/notebook/getNotebookConf', { notebook }),
    };
}

function sortedUniqueIds(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))].sort();
}

function collectNotebookBoxes(value: unknown, boxes: Set<string>): void {
    if (Array.isArray(value)) {
        for (const item of value) collectNotebookBoxes(item, boxes);
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if ((key === 'box' || key === 'notebookID' || key === 'notebook') && typeof nested === 'string' && nested.trim()) boxes.add(nested.trim());
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

function isExplicitNoop(result: ToolResult): boolean {
    return parseResultObject(result)?.changed === false;
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
