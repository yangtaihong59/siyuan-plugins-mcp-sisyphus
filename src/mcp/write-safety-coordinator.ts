import { prepareDocumentConversion } from '../tools/document/conversion';
import { AV_CREATION_CONTEXT, type AvCreationProgress, type AvCreationContext } from '../tools/av/creation-context';
import { generateSiYuanNodeId } from '../shared/siyuan-id';
import { BATCH_RENAME_CONTEXT, buildBatchRenamePlan, initialBatchRenameProgress, type BatchRenamePlan, type BatchRenameProgress } from '../tools/document/batch-rename-plan';
import { AV_ADD_ROWS_CONTEXT, createAvAddRowsPlan, summarizeAvAddRowsPlan, type AvAddRowsPlan, type AvAddRowsProgress } from '../tools/av/add-rows-plan';
import { ensurePermissionForDocumentId } from '../tools/internal/context';
import { translateError } from '../tools/internal/errorTranslation';
import type { SiYuanClient } from '../api/client';
import { WriteOutcomeUnknownError } from '../api/client';
import type { PermissionManager } from '../core/permissions';
import { getNotebookNameArgumentHint } from '../tools/internal/helpers/notebook-names';
import { createErrorResult, type ToolResult } from '../tools/internal/shared';
import { type ToolCategory, type WriteOneStepMode } from '../core/config';
import { compactWriteHashFields, hashWriteState, parseWriteHashCredential } from '../core/write-safety-hash';
import { WritePreflightLeasePool, WRITE_PREFLIGHT_LEASE_TTL_MS, type WritePreflightLease, type WritePreflightLeaseScope } from '../core/write-preflight-lease';
import { assertPreflightCommitArgsSize, buildWritePreflight } from '../core/write-preflight';
import {
    ONE_STEP_REFUSAL_MESSAGES,
    PRECONDITION_FIELD,
    decideOneStep,
    getActionSafetyPolicy,
    getWriteIfMatchTarget,
    IF_MATCH_HEX_LENGTH,
    ifMatchMatches,
    parseIfMatch,
    type ActionSafetyPolicy,
} from '../core/write-safety-policy';
import { safetyError } from '../core/write-safety-error';
import { WriteSafetyLedger, stripSafetyFields, type WriteLedgerEntry } from './write-safety-ledger';
import { assertDestinationNotebooksWritable, derivePostWriteProbeArgs, probeCreatedNotebook, probeCurrentState, probePostWriteState, probeUploadedResult, verifyPostWriteSemanticState } from './write-safety-probe';
import { type StateProbe, collectTargetSelectors, isRecord, parseResultObject } from '../core/write-safety-records';
import { buildWriteImpactPreview } from './write-impact-preview';
import { assertAvAddRowsHasInput } from './write-safety-av';
import { annotateHelpWithOneStep, computeIfMatchHash, executeReadWithIfMatch, ifMatchReadCall, ifMatchTargetKey } from './write-safety-if-match';
import { provesNothingApplied, trackWriteDispatch } from './write-dispatch-tracker';

export interface WriteSafetyExecution {
    client: SiYuanClient;
    permMgr: PermissionManager;
    category: ToolCategory;
    action: string;
    args: Record<string, unknown>;
    strictMode: boolean;
    /** writeSafety.oneStep: enables read ifMatch hashes and tiered one-step commits. */
    oneStep?: WriteOneStepMode;
    /** Synchronous cancellation barrier before any executing ledger entry or side effect. */
    beforeCommit?: () => void;
    validateArgs?: (args: Record<string, unknown>) => void;
    /** `client` overrides the handler's client (the coordinator passes a write-tracking wrapper). */
    execute(args: Record<string, unknown>, client?: SiYuanClient): Promise<ToolResult>;
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
    /** ifMatch values this process recently returned, and the target each covers (diagnostics only). */
    private readonly issuedIfMatch = new Map<string, string>();

    constructor(client: SiYuanClient) {
        this.ledger = new WriteSafetyLedger(client);
    }

    async run(execution: WriteSafetyExecution): Promise<ToolResult> {
        return this.runNormalized(execution);
    }

    private async runNormalized(execution: WriteSafetyExecution): Promise<ToolResult> {
        const policy = getActionSafetyPolicy(execution.category, execution.action, execution.args);
        if (policy.mode === 'read') {
            // Read hashes are produced only when one-step writes are enabled:
            // the default keeps reads, their cost and their payload unchanged.
            if (execution.oneStep !== 'low_risk') return execution.execute(execution.args);
            if (execution.action === 'help') {
                return annotateHelpWithOneStep(execution.category, execution.args, await execution.execute(execution.args));
            }
            return executeReadWithIfMatch(
                execution.client,
                execution.permMgr,
                execution.category,
                execution.action,
                execution.args,
                () => execution.execute(execution.args),
                (ifMatch, target) => this.rememberIfMatch(ifMatch, ifMatchTargetKey(target)),
            );
        }
        try {
            execution.validateArgs?.(stripSafetyFields(execution.args));
        } catch (error) {
            return createErrorResult(error, { tool: execution.category, action: execution.action, rawArgs: execution.args });
        }
        if (policy.mode === 'external') {
            if (execution.args.validateOnly === true) {
                return jsonResult({
                    success: false,
                    writeSafetyMode: execution.strictMode ? 'strict' : 'legacy',
                    writeAttempted: false,
                    writeExecuted: false,
                    transactionState: 'rejected',
                    error: {
                        code: 'preflight_unavailable',
                        message: 'This action has an external or local side effect that cannot be verified by the strict write coordinator. Nothing was executed.',
                        hint: `After the user authorizes the exact external action ${execution.category}.${execution.action}, submit the same business arguments without validateOnly, requestId or hash credentials. Do not retry an uncertain submission automatically.`,
                    },
                    safety: {
                        writeSafetyMode: execution.strictMode ? 'strict' : 'legacy',
                        writeSafetyGuaranteed: false,
                        reason: 'external_uncontrolled',
                    },
                }, true);
            }
            execution.beforeCommit?.();
            return addSafetyMetadata(await execution.execute(stripSafetyFields(execution.args)), {
                writeSafetyMode: execution.strictMode ? 'strict' : 'legacy',
                writeSafetyGuaranteed: false,
                reason: 'external_uncontrolled',
            });
        }
        if (execution.category === 'av' && execution.action === 'create') {
            return this.exclusive(() => this.runStrict(execution, policy));
        }
        // Composite row+cell creation always owns a stage ledger, even when
        // general strict mode is disabled. There is no safe legacy path that
        // could lose stable row identities or retry the row insertion.
        if (execution.category === 'av' && execution.action === 'add_rows' && Array.isArray(execution.args.rows)) {
            return this.exclusive(() => this.runStrict(execution, policy));
        }
        // A bounded batch rename always uses one preflight and one ordered
        // receipt, even when general strict mode is disabled.
        if (execution.category === 'document' && execution.action === 'rename' && Array.isArray(execution.args.items)) {
            return this.exclusive(() => this.runStrict(execution, policy));
        }
        if (!execution.strictMode) {
            if (execution.args.validateOnly === true) {
                return writeSafetyFailure(
                    'strict_mode_disabled',
                    'Strict safe writes are disabled. The preflight did not execute the mutation.',
                );
            }
            execution.beforeCommit?.();
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
        let requestId = typeof args.requestId === 'string' ? args.requestId : '';
        /** Set when this commit runs without a preflight (writeSafety.oneStep). */
        let oneStepTier: 1 | 2 | undefined;
        let inspected: Awaited<ReturnType<WriteSafetyLedger['inspect']>> | undefined;
        let activeLease: WritePreflightLease | undefined;
        let addRowsPlan: AvAddRowsPlan | undefined;
        let addRowsProgress: AvAddRowsProgress | undefined;
        let batchRenamePlan: BatchRenamePlan | undefined;
        let batchRenameProgress: BatchRenameProgress | undefined;

        if (!validateOnly && !requestId) {
            const decision = decideOneStep(execution.oneStep, category, action, args);
            if (decision.allowed === false) {
                // With the setting off and no ifMatch this is exactly the
                // pre-one-step contract; otherwise say why and how to proceed.
                if (decision.reason === 'setting_off' && args.ifMatch === undefined) {
                    return writeSafetyFailure('precondition_required', 'requestId is required for every strict write. Copy it from validateOnly preflight.');
                }
                return writeSafetyFailure(
                    'precondition_required',
                    `requestId is required for this strict write. ${ONE_STEP_REFUSAL_MESSAGES[decision.reason]} Run the same call with validateOnly=true, check its preview, then send preflight.commitArgs unchanged.`,
                    { oneStep: { allowed: false, tier: decision.tier, reason: decision.reason } },
                );
            }
            oneStepTier = decision.tier;
        }
        if (!validateOnly && !oneStepTier) {
            try {
                inspected = await this.ledger.inspect(requestId, category, action, args);
            } catch (error) {
                return fromSafetyError(error);
            }
            if (inspected.entry) return replayLedgerEntry(inspected.entry);
        }

        // Creation has no existing target hash, but still needs current
        // permission and notebook-identity validation before issuing a lease.
        if (category === 'document' && action === 'create' && typeof args.notebook === 'string') {
            try {
                await permMgr.reload();
                if (!permMgr.canWrite(args.notebook)) {
                    const hint = await getNotebookNameArgumentHint(client, permMgr, args.notebook);
                    throw safetyError(hint ? 'invalid_arguments' : 'permission_denied',
                        hint ?? `Notebook ${args.notebook} has permission "${permMgr.get(args.notebook)}"; this write needs write (rw or rwd) access. Nothing was written. Check with notebook(action="get_permissions"); permissions are changed by the user in the plugin settings.`);
                }
            } catch (error) {
                return fromSafetyError(error);
            }
        }

        try {
            await assertDestinationNotebooksWritable(client, permMgr, category, action, args);
        } catch (error) {
            return fromSafetyError(error);
        }

        if (category === 'av' && action === 'create') return this.runAvCreate(execution, inspected?.argsHash, oneStepTier);
        if (category === 'av' && action === 'add_rows') {
            try { assertAvAddRowsHasInput(args); } catch (error) { return fromSafetyError(error); }
        }

        if (category === 'document' && action === 'rename' && Array.isArray(args.items)) {
            try {
                batchRenamePlan = await buildBatchRenamePlan(client, permMgr, args.items);
            } catch (error) {
                return fromSafetyError(error);
            }
        }

        let conversion: Awaited<ReturnType<typeof prepareDocumentConversion>> | undefined;
        if (category === 'document' && ['heading_to_doc', 'doc_to_heading'].includes(action)) {
            try { conversion = await prepareDocumentConversion(client, permMgr, action, args); }
            catch (error) { return fromSafetyError(error); }
        }

        if (args.ifMatch !== undefined) {
            const mismatch = await this.checkIfMatch(execution);
            if (mismatch) return mismatch;
        }

        let before: StateProbe | undefined;
        if (policy.precondition !== 'none') {
            const expectedField = PRECONDITION_FIELD[policy.precondition];
            const expected = args[expectedField] ?? (expectedField === 'expectedStateHash' ? args.expectedHash : undefined);
            const digestPrefix = validateOnly || oneStepTier ? undefined : parseWriteHashCredential(expected);
            if (!validateOnly && !oneStepTier && !digestPrefix) {
                return writeSafetyFailure(
                    'precondition_required',
                    `${expectedField} is required and must be a 4 to 64 character hexadecimal preflight credential, optionally prefixed with sha256:v1:. Run the same action with validateOnly=true to obtain it.`,
                    { expectedField },
                );
            }
            try {
                before = await probeCurrentState(
                    client,
                    permMgr,
                    category,
                    action,
                    args,
                    policy,
                    { ...(batchRenamePlan ? { batchRename: batchRenamePlan } : {}), ...(conversion ? { conversion } : {}) },
                );
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
                // Read-only and never fatal: built from the probe before any
                // credential is issued, so its reads cannot shorten the lease.
                const preview = await buildWriteImpactPreview({ client, permMgr, category, action, args, before, conversion });
                let request;
                try {
                    assertPreflightCommitArgsSize(args);
                    request = await this.ledger.issue(category, action, args);
                } catch (error) {
                    return fromSafetyError(error);
                }
                const issued = this.preflightLeases.issue(leaseScope, before.hash);
                // The requestId is issued before the hash lease is signed. Never
                // advertise a deadline later than either credential actually
                // remains valid; report the earliest real cutoff.
                const effectiveExpiresAt = Math.min(request.requestIdExpiresAt, issued.leaseExpiresAt);
                return jsonResult({
                    action,
                    validateOnly: true,
                    writeSafetyMode: 'strict',
                    writeAttempted: false,
                    writeExecuted: false,
                    ...request,
                    preconditionField: expectedField,
                    [expectedField]: issued.credential,
                    hashPrefixLength: issued.hashPrefixLength,
                    leaseExpiresAt: issued.leaseExpiresAt,
                    expiresAt: effectiveExpiresAt,
                    ttlMs: WRITE_PREFLIGHT_LEASE_TTL_MS,
                    targetCount: before.targetIds.length,
                    ...before.summary,
                    ...buildWritePreflight({
                        category,
                        action,
                        args,
                        requestId: request.requestId,
                        expiresAt: effectiveExpiresAt,
                        guardTargetCount: before.targetIds.length,
                        credentialField: expectedField,
                        credential: issued.credential,
                    }),
                    preview,
                });
            }
            const resolved = oneStepTier
                ? undefined
                : this.preflightLeases.resolve(leaseScope, digestPrefix!);
            if (resolved?.status === 'invalid') {
                return writeSafetyFailure('preflight_lease_invalid', 'The preflight credential is missing, expired, evicted, or belongs to a previous server process. No write was attempted.', {
                    expectedField,
                    revalidateRequired: true,
                });
            }
            if (resolved) activeLease = resolved.lease;
            if (activeLease && activeLease.fullHash !== before.hash) {
                this.preflightLeases.consume(activeLease);
                return writeSafetyFailure('state_changed', 'The target changed after it was read. No write was attempted.', {
                    expectedHash: activeLease.fullHash,
                    currentHash: before.hash,
                    revalidateRequired: true,
                    hint: 'Rerun the validateOnly preflight for fresh hashes. Any write to the same target (for a database: any change to it) invalidates other pending preflights.',
                });
            }
        } else if (validateOnly) {
            const preview = await buildWriteImpactPreview({ client, permMgr, category, action, args });
            let request;
            try {
                assertPreflightCommitArgsSize(args);
                request = await this.ledger.issue(category, action, args);
            } catch (error) {
                return fromSafetyError(error);
            }
            return jsonResult({
                action,
                validateOnly: true,
                writeSafetyMode: 'strict',
                writeAttempted: false,
                writeExecuted: false,
                ...request,
                expiresAt: request.requestIdExpiresAt,
                ttlMs: WRITE_PREFLIGHT_LEASE_TTL_MS,
                ...buildWritePreflight({
                    category,
                    action,
                    args,
                    requestId: request.requestId,
                    expiresAt: request.requestIdExpiresAt,
                }),
                preview,
            });
        }

        let oneStepPreview: unknown;
        if (oneStepTier) {
            // One-step commits skip the preflight round trip, not its checks:
            // state was probed above (permissions, references, ifMatch), the
            // impact preview is returned with the receipt, and the request
            // gets a server-issued ID recorded in the ledger like any other.
            oneStepPreview = await buildWriteImpactPreview({ client, permMgr, category, action, args, before, conversion });
            try {
                requestId = (await this.ledger.issue(category, action, args)).requestId;
                inspected = { argsHash: hashWriteState(stripSafetyFields(args)) };
            } catch (error) {
                return fromSafetyError(error);
            }
        }
        const withOneStep = (response: ToolResult): ToolResult => oneStepTier
            ? addTopLevelFields(response, { oneStep: { tier: oneStepTier, meaning: ONE_STEP_TIER_MEANING[oneStepTier] }, preview: asReceiptPreview(oneStepPreview) })
            : response;

        try { execution.beforeCommit?.(); } catch (error) { return fromSafetyError(error); }
        const targetIds = before?.targetIds ?? collectTargetSelectors(args);
        const executeArgs = stripSafetyFields(args);
        if (category === 'document' && action === 'rename' && batchRenamePlan) {
            batchRenameProgress = initialBatchRenameProgress(batchRenamePlan);
            (executeArgs as Record<symbol, unknown>)[BATCH_RENAME_CONTEXT] = {
                plan: batchRenamePlan,
                checkpoint: async (progress: BatchRenameProgress) => {
                    batchRenameProgress = progress;
                    await this.ledger.record({
                        requestId,
                        tool: category,
                        action,
                        argsHash: inspected!.argsHash,
                        targetIds,
                        state: 'executing',
                        rename: progress,
                    });
                },
            };
        }
        if (category === 'av' && action === 'add_rows' && Array.isArray(args.rows)) {
            addRowsPlan = createAvAddRowsPlan(args.rows);
            addRowsProgress = summarizeAvAddRowsPlan(addRowsPlan, 'reserved', 'insert_rows');
            (executeArgs as Record<symbol, unknown>)[AV_ADD_ROWS_CONTEXT] = {
                plan: addRowsPlan,
                checkpoint: async (progress: AvAddRowsProgress) => {
                    addRowsProgress = progress;
                    await this.ledger.record({
                        requestId,
                        tool: category,
                        action,
                        argsHash: inspected!.argsHash,
                        targetIds,
                        state: 'executing',
                        addRows: progress,
                    });
                },
            };
        }
        try {
            await this.ledger.record({
                requestId,
                tool: category,
                action,
                argsHash: inspected!.argsHash,
                targetIds,
                state: 'executing',
                ...(addRowsProgress ? { addRows: addRowsProgress } : {}),
                ...(batchRenameProgress ? { rename: batchRenameProgress } : {}),
            });
        } catch (error) {
            return fromSafetyError(error);
        }

        let result: ToolResult;
        const dispatch = trackWriteDispatch(client);
        // A definite SiYuan rejection of the only write proves nothing was
        // applied; staged batch flows keep their own conservative receipts.
        const rejectedBeforeApply = () => provesNothingApplied(dispatch.stats) && !addRowsProgress && !batchRenameProgress;
        try {
            result = await execution.execute(executeArgs, dispatch.client);
        } catch (error) {
            if (rejectedBeforeApply()) {
                return this.recordNotApplied(requestId, category, action, inspected!.argsHash, targetIds, activeLease,
                    createErrorResult(error, { tool: category, action, rawArgs: executeArgs }));
            }
            await this.recordUnknown(requestId, category, action, inspected!.argsHash, targetIds, error, addRowsProgress, batchRenameProgress);
            if (activeLease) this.preflightLeases.consume(activeLease);
            return writeSafetyFailureAfterAttempt('outcome_unknown', 'The write transport failed after execution began. Do not retry with a new requestId until the target has been inspected.', {
                requestId,
                cause: error instanceof Error ? error.message : String(error),
                ...(addRowsProgress ? { addRows: addRowsProgress } : {}),
                ...(batchRenameProgress ? { rename: batchRenameProgress } : {}),
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
            if (rejectedBeforeApply()) {
                return this.recordNotApplied(requestId, category, action, inspected!.argsHash, targetIds, activeLease, result);
            }
            await this.recordUnknown(requestId, category, action, inspected!.argsHash, targetIds, new Error('handler returned an error after execution began'), addRowsProgress, batchRenameProgress);
            if (activeLease) this.preflightLeases.consume(activeLease);
            return addSafetyMetadata(result, {
                requestId,
                writeSafetyMode: 'strict',
                writeAttempted: true,
                writeExecuted: false,
                replayed: false,
                transactionState: 'unknown',
                ...(addRowsProgress ? { addRows: addRowsProgress } : {}),
                ...(batchRenameProgress ? { rename: batchRenameProgress } : {}),
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
            return withOneStep(addSafetyMetadata(result, safetyResult));
        }

        let after: StateProbe | undefined;
        try {
            const postWriteArgs = derivePostWriteProbeArgs(category, action, args, result);
            after = category === 'notebook' && action === 'create'
                ? await probeCreatedNotebook(client, result)
                : policy.precondition === 'source'
                ? await probeUploadedResult(client, result, before!)
                : await probePostWriteState(client, permMgr, category, action, postWriteArgs, policy, before);
            await verifyPostWriteSemanticState(client, permMgr, category, action, args, before, after);
        } catch (error) {
            await this.recordUnknown(requestId, category, action, inspected!.argsHash, targetIds, error, addRowsProgress, batchRenameProgress);
            if (activeLease) this.preflightLeases.consume(activeLease);
            return writeSafetyFailureAfterAttempt('readback_mismatch', 'The write returned, but its result could not be read back. Do not retry automatically.', {
                requestId,
                cause: error instanceof Error ? error.message : String(error),
                ...(addRowsProgress ? { addRows: addRowsProgress } : {}),
                ...(batchRenameProgress ? { rename: batchRenameProgress } : {}),
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
                addRowsProgress,
                batchRenameProgress,
            );
            if (activeLease) this.preflightLeases.consume(activeLease);
            return writeSafetyFailureAfterAttempt(
                'readback_mismatch',
                'The handler reported a mutation, but bounded readback did not observe the requested state change. Inspect the target before retrying.',
                {
                    requestId,
                    previousHash: before.hash,
                    resultHash: after.hash,
                    ...(addRowsProgress ? { addRows: addRowsProgress } : {}),
                    ...(batchRenameProgress ? { rename: batchRenameProgress } : {}),
                },
            );
        }

        const resultPayload = parseResultObject(result);
        const batchOverall = category === 'document' && action === 'rename' && batchRenameProgress
            && resultPayload && typeof resultPayload.overallState === 'string'
            ? resultPayload.overallState
            : undefined;
        const batchCommitted = batchOverall === 'committed'
            ? true
            : batchOverall === 'partial' || batchOverall === 'failed'
                ? (isRecord(resultPayload?.counts) && typeof resultPayload.counts.committed === 'number' && resultPayload.counts.committed > 0)
                : true;
        const safetyResult = {
            requestId,
            writeSafetyMode: 'strict',
            writeSafetyGuaranteed: true,
            writeAttempted: batchOverall === 'failed' ? false : true,
            writeExecuted: batchOverall ? batchCommitted : true,
            replayed: false,
            transactionState: policy.precondition !== 'source' && before && after.hash === before.hash ? 'no_change' : 'committed',
            previousHash: before?.hash,
            resultHash: after.hash,
            ...(addRowsProgress ? { addRows: addRowsProgress } : {}),
            ...(batchRenameProgress ? { rename: batchRenameProgress } : {}),
        };
        const response = addSafetyMetadata(result, safetyResult);
        try {
            await this.ledger.record({
                requestId,
                tool: category,
                action,
                argsHash: inspected!.argsHash,
                targetIds: after.targetIds.length > 0 ? after.targetIds : targetIds,
                state: 'committed',
                result: safetyResult,
                ...(addRowsProgress ? { addRows: addRowsProgress } : {}),
                ...(batchRenameProgress ? { rename: batchRenameProgress } : {}),
                ...((addRowsProgress || batchRenameProgress) ? { response } : {}),
            });
        } catch (error) {
            if (activeLease) this.preflightLeases.consume(activeLease);
            return writeSafetyFailureAfterAttempt('outcome_unknown', 'The write was observed, but its idempotency record could not be committed. Do not retry automatically.', {
                requestId,
                resultHash: after.hash,
                ...(addRowsProgress ? { addRows: addRowsProgress } : {}),
                ...(batchRenameProgress ? { rename: batchRenameProgress } : {}),
            });
        }
        if (activeLease) this.preflightLeases.consume(activeLease);
        return withOneStep(response);
    }

    /**
     * Compare a read-derived ifMatch with the target's current canonical state
     * hash. Undefined means it matches; otherwise the rejection to return.
     */
    private async checkIfMatch(execution: WriteSafetyExecution): Promise<ToolResult | undefined> {
        const { client, permMgr, category, action, args } = execution;
        if (!parseIfMatch(args.ifMatch)) {
            return writeSafetyFailure('invalid_arguments', 'ifMatch must be the hexadecimal ifMatch value returned by a read of the target (at least 16 digits, optionally prefixed with sha256:v1:). No write was attempted.', {
                field: 'ifMatch',
            });
        }
        const target = getWriteIfMatchTarget(category, action, args);
        if (!target) {
            return writeSafetyFailure('invalid_arguments', `${category}.${action} with these arguments has no single target an ifMatch can describe. Remove ifMatch and use the validateOnly preflight. No write was attempted.`, {
                field: 'ifMatch',
                oneStep: { allowed: false, reason: 'if_match_unsupported' },
            });
        }
        let current: string;
        try {
            current = await computeIfMatchHash(client, permMgr, target);
        } catch (error) {
            return fromSafetyError(error);
        }
        if (ifMatchMatches(String(args.ifMatch), current)) return undefined;
        const key = ifMatchTargetKey(target);
        const readCall = ifMatchReadCall(target);
        const issuedFor = this.issuedIfMatch.get(parseIfMatch(args.ifMatch)!.slice(0, IF_MATCH_HEX_LENGTH));
        if (issuedFor !== undefined && issuedFor !== key) {
            return writeSafetyFailure('state_changed', `This ifMatch came from a read of ${issuedFor}, not of ${key}. An ifMatch covers only the exact id/path that was read (a get_children ifMatch covers the parent, not its children). No write was attempted.`, {
                expectedField: 'ifMatch',
                ifMatchTarget: key,
                ifMatchIssuedFor: issuedFor,
                currentHash: current,
                revalidateRequired: true,
                hint: `Read this exact target with ${readCall}, re-check the content, then rebuild the write with its ifMatch.`,
            });
        }
        return writeSafetyFailure('state_changed', 'The target changed since the read that produced ifMatch, or the ifMatch came from a read of a different target. No write was attempted.', {
            expectedField: 'ifMatch',
            ifMatchTarget: key,
            currentHash: current,
            revalidateRequired: true,
            hint: `ifMatch must come from a read of this exact target (${key}); a get_children ifMatch covers the parent id. Read it with ${readCall}, re-check the content, then rebuild the write.`,
        });
    }

    private rememberIfMatch(ifMatch: string, key: string): void {
        this.issuedIfMatch.delete(ifMatch);
        this.issuedIfMatch.set(ifMatch, key);
        if (this.issuedIfMatch.size > 512) this.issuedIfMatch.delete(this.issuedIfMatch.keys().next().value!);
    }

    /** Multi-step creation owns a durable identity and result, independent of transport lifetime. */
    private async runAvCreate(execution: WriteSafetyExecution, argsHash?: string, oneStepTier?: 1 | 2): Promise<ToolResult> {
        const { client, permMgr, args } = execution;
        const parentID = args.parentID as string;
        let requestId = args.requestId as string;
        let oneStepPreview: unknown;
        try {
            const { denied } = await ensurePermissionForDocumentId(client, permMgr, parentID, 'write');
            if (denied) return denied;
            if (typeof args.avID === 'string') {
                let existing: any;
                try { existing = await client.requestRead('/api/av/getAttributeView', { id: args.avID }); }
                catch (error) { if (translateError(error)?.code !== 'av_not_found') throw error; }
                if (existing?.av) throw safetyError('already_exists', 'A new create request cannot reuse an existing AV.');
            }
            if (args.validateOnly === true) {
                const preview = await buildWriteImpactPreview({ client, permMgr, category: 'av', action: 'create', args });
                assertPreflightCommitArgsSize(args);
                const request = await this.ledger.issue('av', 'create', args);
                return jsonResult({
                    action: 'create',
                    validateOnly: true,
                    writeAttempted: false,
                    writeExecuted: false,
                    ...request,
                    expiresAt: request.requestIdExpiresAt,
                    ttlMs: WRITE_PREFLIGHT_LEASE_TTL_MS,
                    ...buildWritePreflight({
                        category: 'av',
                        action: 'create',
                        args,
                        requestId: request.requestId,
                        expiresAt: request.requestIdExpiresAt,
                    }),
                    preview,
                });
            }
            if (oneStepTier) {
                // One step skips only the round trip: same checks, a server-issued
                // request ID and staged ledger, and the preview in the receipt.
                oneStepPreview = await buildWriteImpactPreview({ client, permMgr, category: 'av', action: 'create', args });
                requestId = (await this.ledger.issue('av', 'create', args)).requestId;
                argsHash = hashWriteState(stripSafetyFields(args));
            }
            execution.beforeCommit?.();
        } catch (error) { return fromSafetyError(error); }
        const withOneStep = (response: ToolResult): ToolResult => oneStepTier
            ? addTopLevelFields(response, { oneStep: { tier: oneStepTier, meaning: ONE_STEP_TIER_MEANING[oneStepTier] }, preview: oneStepPreview })
            : response;
        let progress: AvCreationProgress = {
            avID: typeof args.avID === 'string' ? args.avID : generateSiYuanNodeId(), blockID: generateSiYuanNodeId(), parentID,
            stage: 'ids_reserved', currentStep: 'create_av',
        };
        const base = { requestId, tool: 'av' as const, action: 'create', argsHash: argsHash!, targetIds: [parentID, progress.avID, progress.blockID] };
        try { await this.ledger.record({ ...base, state: 'executing', creation: { ...progress } }); }
        catch (error) { return fromSafetyError(error); }
        const context: AvCreationContext = {
            progress,
            checkpoint: async (stage, currentStep) => {
                // Keep observed progress in the response even if its persistence fails.
                Object.assign(progress, { stage, currentStep });
                await this.ledger.record({ ...base, state: 'executing', creation: { ...progress } });
            },
        };
        try {
            const input = stripSafetyFields(args);
            (input as any)[AV_CREATION_CONTEXT] = context;
            const result = await execution.execute(input);
            if (result.isError || progress.stage !== 'verified') {
                const payload = parseResultObject(result);
                throw new Error(JSON.stringify(payload?.error ?? 'Creation did not complete verification'));
            }
            const response = addSafetyMetadata(result, { requestId, writeSafetyMode: 'strict', writeSafetyGuaranteed: true, writeAttempted: true, writeExecuted: true, replayed: false, transactionState: 'committed' });
            await this.ledger.record({ ...base, state: 'committed', creation: { ...progress }, response });
            return withOneStep(response);
        } catch (error) {
            const failure = writeSafetyFailureAfterAttempt('outcome_unknown', 'Creation did not complete durable verification. Inspect the returned IDs; do not recreate or resume automatically.', {
                requestId, ...progress, partial: progress.stage !== 'ids_reserved' && progress.stage !== 'verified',
                carrierConfirmed: progress.stage === 'carrier_inserted' || progress.stage === 'verified',
                cause: error instanceof Error ? error.message : String(error),
            });
            const response = jsonResult({ ...parseResultObject(failure), ...progress, requestId, partial: progress.stage !== 'ids_reserved' && progress.stage !== 'verified', carrierConfirmed: progress.stage === 'carrier_inserted' || progress.stage === 'verified' }, true);
            try { await this.ledger.record({ ...base, state: 'unknown', creation: { ...progress }, response }); } catch { /* Earlier durable progress remains sufficient to prohibit another creation. */ }
            return withOneStep(response);
        }
    }

    /**
     * SiYuan explicitly rejected the commit's write before applying anything
     * (an API error code or a 4xx answer, and no other write was sent). The
     * outcome is known: not applied. The request ID is spent; a corrected
     * call gets a new one.
     */
    private async recordNotApplied(
        requestId: string,
        category: ToolCategory,
        action: string,
        argsHash: string,
        targetIds: string[],
        activeLease: WritePreflightLease | undefined,
        result: ToolResult,
    ): Promise<ToolResult> {
        try {
            await this.ledger.record({
                requestId,
                tool: category,
                action,
                argsHash,
                targetIds,
                state: 'failed_before_execute',
                result: { error: 'not_applied' },
            });
        } catch {
            // SiYuan already rejected the write; its error stays the answer.
        }
        if (activeLease) this.preflightLeases.consume(activeLease);
        return addSafetyMetadata({ ...result, isError: true }, {
            requestId,
            writeSafetyMode: 'strict',
            writeAttempted: true,
            writeExecuted: false,
            replayed: false,
            transactionState: 'not_applied',
            error: { code: 'not_applied', message: 'SiYuan rejected the write before applying it; nothing changed. Fix the arguments and send the call again.' },
        });
    }

    private async recordUnknown(
        requestId: string,
        category: ToolCategory,
        action: string,
        argsHash: string,
        targetIds: string[],
        error: unknown,
        addRows?: AvAddRowsProgress,
        rename?: BatchRenameProgress,
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
                    ...(addRows ? { addRows } : {}),
                    ...(rename ? { rename } : {}),
                },
                ...(addRows ? { addRows } : {}),
                ...(rename ? { rename } : {}),
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

function replayLedgerEntry(entry: WriteLedgerEntry): ToolResult {
    if (entry.response) {
        const payload = parseResultObject(entry.response);
        if (payload?.safety && isRecord(payload.safety)) return addSafetyMetadata(entry.response, { ...payload.safety, replayed: true });
        return { ...entry.response, ...jsonResult({ ...payload, replayed: true }, entry.response.isError) };
    }
    if (entry.state === 'committed') {
        return jsonResult({
            ...(entry.result ?? {}),
            requestId: entry.requestId,
            replayed: true,
            writeAttempted: false,
            writeExecuted: false,
        });
    }
    if (entry.creation) return jsonResult({ success: false, ...entry.creation, carrierConfirmed: entry.creation.stage === 'carrier_inserted' || entry.creation.stage === 'verified', partial: entry.creation.stage !== 'ids_reserved' && entry.creation.stage !== 'verified', requestId: entry.requestId, replayed: true, transactionState: 'unknown', error: { code: 'outcome_unknown', message: 'Creation was interrupted. Inspect the reserved IDs; do not recreate automatically.' } }, true);
    if (entry.rename) {
        // inProgressIndex is persisted immediately before dispatch. If the
        // process stopped after that point without a receipt, the item cannot
        // be called not_started; surface it as unknown for manual inspection.
        const items = entry.rename.items.map((item) => (
            item.index === entry.rename!.inProgressIndex
                && item.state !== 'committed'
                && item.state !== 'no_change'
                && item.state !== 'failed_before_execute'
                ? { ...item, state: 'unknown' as const, reason: 'interrupted_before_receipt' }
                : item
        ));
        return jsonResult({
            success: false,
            requestId: entry.requestId,
            replayed: true,
            writeSafetyMode: 'strict',
            writeAttempted: entry.rename.inProgressIndex !== undefined
                || entry.rename.items.some((item) => item.state === 'committed' || item.state === 'unknown'),
            writeExecuted: false,
            transactionState: 'unknown',
            overallState: 'unknown',
            items,
            ...(entry.result ?? {}),
            error: {
                code: 'outcome_unknown',
                message: 'Batch rename was interrupted. Inspect each item; only proven not_started items may be submitted as a new preflight.',
            },
        }, true);
    }
    if (entry.addRows) return jsonResult({
        success: false,
        requestId: entry.requestId,
        replayed: true,
        writeSafetyMode: 'strict',
        // A reserved stage alone cannot prove the insert never dispatched.
        // Keep the receipt conservative instead of reporting "not attempted".
        writeAttempted: true,
        writeExecuted: false,
        transactionState: 'unknown',
        addRows: entry.addRows,
        ...(entry.result ?? {}),
        error: {
            code: 'outcome_unknown',
            message: 'Composite add_rows was interrupted. Inspect the exact rowIDs and stage; do not run add_rows again for these rows.',
        },
    }, true);
    if (entry.state === 'failed_before_execute') {
        return writeSafetyFailure('not_applied', `requestId ${entry.requestId} was rejected before anything was written; nothing changed and it will not run again. Fix the arguments and run a new validateOnly preflight.`, {
            requestId: entry.requestId,
            ledgerState: entry.state,
        });
    }
    return writeSafetyFailure('outcome_unknown', `requestId ${entry.requestId} is in ${entry.state} state. Inspect the target before retrying.`, {
        requestId: entry.requestId,
        ledgerState: entry.state,
        ...(entry.creation ?? {}),
    });
}

function addSafetyMetadata(result: ToolResult, safety: Record<string, unknown>): ToolResult {
    const parsed = parseResultObject(result);
    const payload = { ...(parsed ?? {}), safety: compactWriteHashFields(safety) };
    return {
        ...result,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
    };
}

const ONE_STEP_TIER_MEANING: Record<1 | 2, string> = {
    1: 'additive or name-only change; ifMatch optional',
    2: 'overwrite guarded by ifMatch',
};

/**
 * A one-step receipt carries the preview computed before the write. Target
 * excerpts there are the old content, so name them excerptBefore.
 */
function asReceiptPreview(preview: unknown): unknown {
    if (!isRecord(preview) || !Array.isArray(preview.targets)) return preview;
    return {
        ...preview,
        targets: preview.targets.map((target) => {
            if (!isRecord(target) || typeof target.excerpt !== 'string') return target;
            const { excerpt, ...rest } = target;
            return { ...rest, excerptBefore: excerpt };
        }),
    };
}

/** Response-only fields next to the handler payload (one-step receipt, preview). */
function addTopLevelFields(result: ToolResult, fields: Record<string, unknown>): ToolResult {
    const parsed = parseResultObject(result) ?? {};
    const payload = { ...parsed, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) };
    return {
        ...result,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
    };
}

function readHandlerErrorType(result: ToolResult): string {
    const payload = parseResultObject(result);
    return payload && isRecord(payload.error) && typeof payload.error.type === 'string'
        ? payload.error.type
        : '';
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
    payload = compactWriteHashFields(payload);
    if (isRecord(payload.error)) payload.error = compactWriteHashFields(payload.error);
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        ...(isError ? { isError: true } : {}),
    };
}
