/* av relations: set_relation, configure_two_way_relation, configure_rollup. */
import { writeHashPool } from '../../core/write-safety-hash';
import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import { hashCanonicalState } from '../../shared/canonical-state';
import { AvConfigureRollupSchema, AvConfigureTwoWayRelationSchema, AvSetRelationSchema } from './schemas';
import { ensurePermissionForDocumentId } from '../internal/context';
import type { ToolHandlerContext } from '../internal/define-tool';
import { createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { ATTRIBUTE_VIEW_ID_PATTERN, type AttributeViewDefinition, type AvKeyDefinition, type RelationMetadata, asAttributeViewDefinition, avWriteSuccess, cloneJsonRecord, createAvValidationErrorResult, dispatchAvTransaction, ensurePermissionForAvId, extractAvRowLookup, extractRelationCellItemIDs, getAvKey, normalizeIdSet, requireWritableRelationDestinations, resolveVerifiedAvCarrier, sameIdSet } from './common';

function relationCellValue(itemIDs: string[]): Record<string, unknown> {
    return {
        type: 'relation',
        relation: {
            // Kernel calls this blockIDs, but the values are AV item IDs. A
            // bound document block ID would make a cross-AV relation unsafe.
            blockIDs: itemIDs,
            contents: null,
        },
    };
}

export async function readRelationPostimage(
    client: SiYuanClient,
    sourceAvID: string,
    sourceKeyID: string,
    sourceItemID: string,
    expectedItemIDs: string[],
    destinationAvID: string,
    backKeyID: string | undefined,
    priorItemIDs: string[],
    context: string,
): Promise<{ source: AttributeViewDefinition; destination: AttributeViewDefinition }> {
    const source = asAttributeViewDefinition((await avApi.getAttributeView(client, sourceAvID)).av, sourceAvID);
    const sourceActual = extractRelationCellItemIDs(source, sourceKeyID, sourceItemID, context);
    if (!sameIdSet(sourceActual, expectedItemIDs)) {
        throw new Error(`${context}: source relation readback did not match the complete requested itemID set.`);
    }
    const destination = asAttributeViewDefinition((await avApi.getAttributeView(client, destinationAvID)).av, destinationAvID);
    if (!backKeyID) return { source, destination };
    for (const destinationItemID of normalizeIdSet([...priorItemIDs, ...expectedItemIDs])) {
        const reverseItemIDs = extractRelationCellItemIDs(destination, backKeyID, destinationItemID, context);
        const shouldContainSource = expectedItemIDs.includes(destinationItemID);
        if (reverseItemIDs.includes(sourceItemID) !== shouldContainSource) {
            throw new Error(`${context}: two-way reverse relation readback did not ${shouldContainSource ? 'add' : 'clear'} source itemID for destination item "${destinationItemID}".`);
        }
    }
    return { source, destination };
}

export async function handleSetRelation({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetRelationSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_relation',
    });
    if (denied) return denied;
    const source = asAttributeViewDefinition(avData, parsed.avID);
    const sourceLookup = extractAvRowLookup(source);
    if (!sourceLookup.rowIDs.has(parsed.itemID)) {
        return createAvValidationErrorResult('set_relation', {
            reason: 'source_item_not_found',
            message: `itemID "${parsed.itemID}" is not an AV row item ID in source AV "${parsed.avID}".`,
            hint: 'Use the row item ID stored in value.blockID, not the bound document block.id and not a cell value id.',
        });
    }

    let target: { destinationAvID: string; backKeyID?: string; destination: AttributeViewDefinition };
    let priorItemIDs: string[];
    try {
        priorItemIDs = extractRelationCellItemIDs(source, parsed.keyID, parsed.itemID, 'set_relation preflight');
        target = await requireWritableRelationDestinations(client, permMgr, source, parsed.keyID, parsed.relatedItemIDs, 'set_relation preflight');
    } catch (error) {
        return createAvValidationErrorResult('set_relation', {
            reason: 'relation_preflight_failed',
            message: error instanceof Error ? error.message : String(error),
        });
    }

    const verifyExactPostimage = () => readRelationPostimage(
        client, parsed.avID, parsed.keyID, parsed.itemID, parsed.relatedItemIDs,
        target.destinationAvID, target.backKeyID, priorItemIDs, 'set_relation readback',
    );
    try {
        const observed = await verifyExactPostimage();
        return createWriteSuccessResult({
            action: 'set_relation', avID: parsed.avID, keyID: parsed.keyID, itemID: parsed.itemID,
            destinationAvID: target.destinationAvID, relatedItemIDs: parsed.relatedItemIDs,
            cleared: parsed.relatedItemIDs.length === 0,
            changed: false,
            status: 'already_applied',
            sourcePreimageHash: writeHashPool.issue(await hashCanonicalState(observed.source)),
            sourcePostimageHash: writeHashPool.issue(await hashCanonicalState(observed.source)),
            destinationPreimageHash: writeHashPool.issue(await hashCanonicalState(observed.destination)),
            destinationPostimageHash: writeHashPool.issue(await hashCanonicalState(observed.destination)),
            ...(target.backKeyID ? { backRelationKeyID: target.backKeyID, reverseReadback: 'verified' } : {}),
        });
    } catch {
        // The expected relation postimage is not established yet. Continue to
        // one native write; a response failure below deliberately reaches the
        // coordinator as outcome_unknown because raw state has no request ID.
    }
    await avApi.setAttributeViewBlockAttr(client, {
        avID: parsed.avID,
        keyID: parsed.keyID,
        itemID: parsed.itemID,
        value: relationCellValue(parsed.relatedItemIDs),
    });
    const after = await verifyExactPostimage();
    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'set_relation', avID: parsed.avID, keyID: parsed.keyID, itemID: parsed.itemID,
        destinationAvID: target.destinationAvID, relatedItemIDs: parsed.relatedItemIDs,
        cleared: parsed.relatedItemIDs.length === 0,
        sourcePreimageHash: writeHashPool.issue(await hashCanonicalState(source)),
        sourcePostimageHash: writeHashPool.issue(await hashCanonicalState(after.source)),
        destinationPreimageHash: writeHashPool.issue(await hashCanonicalState(target.destination)),
        destinationPostimageHash: writeHashPool.issue(await hashCanonicalState(after.destination)),
        ...(target.backKeyID ? { backRelationKeyID: target.backKeyID, reverseReadback: 'verified' } : {}),
    });
}

export async function handleConfigureTwoWayRelation({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvConfigureTwoWayRelationSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'configure_two_way_relation',
    });
    if (denied) return denied;
    const source = asAttributeViewDefinition(avData, parsed.avID);
    let destination: AttributeViewDefinition;
    let sourceRelation: RelationMetadata | undefined;
    try {
        const sourceKey = getAvKey(source, parsed.keyID, 'configure_two_way_relation preflight');
        if (sourceKey.type !== 'relation') throw new Error(`configure_two_way_relation preflight: keyID "${parsed.keyID}" is not a relation key.`);
        sourceRelation = maybeRelationMetadata(sourceKey);
        if (sourceRelation?.avID && sourceRelation.avID !== parsed.destinationAvID) {
            throw new Error(`configure_two_way_relation preflight: existing source relation targets "${sourceRelation.avID}"; retargeting would mutate an unpreflighted third AV.`);
        }
        destination = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.destinationAvID)).av, parsed.destinationAvID);
        const destinationCarrier = await resolveVerifiedAvCarrier(client, parsed.destinationAvID, destination, parsed.destinationBlockID);
        if (!destinationCarrier) throw new Error(`configure_two_way_relation preflight: destination AV "${parsed.destinationAvID}" has no verified database carrier.`);
        const permission = await ensurePermissionForDocumentId(client, permMgr, destinationCarrier, 'write');
        if (permission.denied) return permission.denied;
    } catch (error) {
        return createAvValidationErrorResult('configure_two_way_relation', {
            reason: 'two_way_relation_preflight_failed',
            message: error instanceof Error ? error.message : String(error),
        });
    }

    const expected = {
        sourceAvID: parsed.avID, sourceKeyID: parsed.keyID, destinationAvID: parsed.destinationAvID,
        backRelationKeyID: parsed.backRelationKeyID, sourceName: parsed.sourceName, destinationName: parsed.destinationName,
    };
    const alreadyApplied = (() => {
        try {
            verifyTwoWayRelationMetadata(source, destination!, expected, 'configure_two_way_relation preflight');
            return true;
        } catch {
            return false;
        }
    })();
    if (alreadyApplied) {
        return createWriteSuccessResult({
            action: 'configure_two_way_relation',
            ...expected,
            changed: false,
            status: 'already_applied',
            sourcePreimageHash: writeHashPool.issue(await hashCanonicalState(source)),
            sourcePostimageHash: writeHashPool.issue(await hashCanonicalState(source)),
            destinationPreimageHash: writeHashPool.issue(await hashCanonicalState(destination!)),
            destinationPostimageHash: writeHashPool.issue(await hashCanonicalState(destination!)),
            ...(sourceRelation?.avID ? { priorDestinationAvID: sourceRelation.avID } : {}),
        });
    }
    const verifyExactPostimage = async (): Promise<{ source: AttributeViewDefinition; destination: AttributeViewDefinition }> => {
        const actualSource = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.avID)).av, parsed.avID);
        const actualDestination = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.destinationAvID)).av, parsed.destinationAvID);
        verifyTwoWayRelationMetadata(actualSource, actualDestination, expected, 'configure_two_way_relation readback');
        return { source: actualSource, destination: actualDestination };
    };
    // Exact source/destination state is not a request-specific marker. A lost
    // response must propagate so the strict coordinator fails closed.
    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, [{
        action: 'updateAttrViewColRelation', avID: parsed.avID, keyID: parsed.keyID, id: parsed.destinationAvID,
        backRelationKeyID: parsed.backRelationKeyID, isTwoWay: true,
        name: parsed.destinationName, format: parsed.sourceName,
    }]);
    const after = await verifyExactPostimage();
    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'configure_two_way_relation', ...expected,
        sourcePreimageHash: writeHashPool.issue(await hashCanonicalState(source)), sourcePostimageHash: writeHashPool.issue(await hashCanonicalState(after.source)),
        destinationPreimageHash: writeHashPool.issue(await hashCanonicalState(destination)), destinationPostimageHash: writeHashPool.issue(await hashCanonicalState(after.destination)),
        ...(sourceRelation?.avID ? { priorDestinationAvID: sourceRelation.avID } : {}),
    });
}

function getRelationMetadata(key: AvKeyDefinition, context: string): Record<string, unknown> {
    if (key.type !== 'relation' || !key.relation || typeof key.relation !== 'object' || Array.isArray(key.relation)) {
        throw new Error(`${context}: key is not a relation with native metadata.`);
    }
    return key.relation as Record<string, unknown>;
}

function maybeRelationMetadata(key: AvKeyDefinition): Record<string, unknown> | undefined {
    return key.type === 'relation' && key.relation && typeof key.relation === 'object' && !Array.isArray(key.relation)
        ? key.relation as Record<string, unknown>
        : undefined;
}

function verifyTwoWayRelationMetadata(
    source: AttributeViewDefinition,
    destination: AttributeViewDefinition,
    expected: { sourceAvID: string; sourceKeyID: string; destinationAvID: string; backRelationKeyID: string; sourceName: string; destinationName: string },
    context: string,
): void {
    const sourceKey = getAvKey(source, expected.sourceKeyID, context);
    const sourceRelation = getRelationMetadata(sourceKey, context);
    if (sourceKey.name !== expected.sourceName || sourceRelation.avID !== expected.destinationAvID || sourceRelation.backKeyID !== expected.backRelationKeyID || sourceRelation.isTwoWay !== true) {
        throw new Error(`${context}: source relation metadata does not match the requested two-way postimage.`);
    }
    const backKey = getAvKey(destination, expected.backRelationKeyID, context);
    const backRelation = getRelationMetadata(backKey, context);
    if (backKey.name !== expected.destinationName || backRelation.avID !== expected.sourceAvID || backRelation.backKeyID !== expected.sourceKeyID || backRelation.isTwoWay !== true) {
        throw new Error(`${context}: destination reverse relation metadata does not match the requested two-way postimage.`);
    }
}

export async function handleConfigureRollup({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvConfigureRollupSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'configure_rollup',
    });
    if (denied) return denied;
    const source = asAttributeViewDefinition(avData, parsed.avID);
    let relationDestinationAvID: string;
    try {
        const rollupKey = getAvKey(source, parsed.keyID, 'configure_rollup preflight');
        if (rollupKey.type !== 'rollup') throw new Error(`configure_rollup preflight: keyID "${parsed.keyID}" is not a rollup key.`);
        const relationKey = getAvKey(source, parsed.relationKeyID, 'configure_rollup preflight');
        const relation = getRelationMetadata(relationKey, 'configure_rollup preflight');
        if (typeof relation.avID !== 'string' || !ATTRIBUTE_VIEW_ID_PATTERN.test(relation.avID)) throw new Error('configure_rollup preflight: relation key has no valid destination AV ID.');
        relationDestinationAvID = relation.avID;
        const destination = asAttributeViewDefinition((await avApi.getAttributeView(client, relationDestinationAvID)).av, relationDestinationAvID);
        getAvKey(destination, parsed.destinationKeyID, 'configure_rollup preflight');
        const carrier = await resolveVerifiedAvCarrier(client, relationDestinationAvID, destination);
        if (!carrier) throw new Error(`configure_rollup preflight: destination AV "${relationDestinationAvID}" has no verified database carrier.`);
        const permission = await ensurePermissionForDocumentId(client, permMgr, carrier, 'read');
        if (permission.denied) return permission.denied;
    } catch (error) {
        return createAvValidationErrorResult('configure_rollup', {
            reason: 'rollup_preflight_failed', message: error instanceof Error ? error.message : String(error),
        });
    }

    const alreadyApplied = await (async () => {
        try {
            await verifyRollupMetadata(source, parsed.keyID, parsed.relationKeyID, parsed.destinationKeyID, parsed.calc, 'configure_rollup preflight');
            return true;
        } catch {
            return false;
        }
    })();
    if (alreadyApplied) {
        return createWriteSuccessResult({
            action: 'configure_rollup',
            avID: parsed.avID,
            keyID: parsed.keyID,
            relationKeyID: parsed.relationKeyID,
            destinationAvID: relationDestinationAvID!,
            destinationKeyID: parsed.destinationKeyID,
            calc: parsed.calc,
            changed: false,
            status: 'already_applied',
            sourcePreimageHash: writeHashPool.issue(await hashCanonicalState(source)),
            sourcePostimageHash: writeHashPool.issue(await hashCanonicalState(source)),
            nativeFilterSideEffect: 'filters referencing this rollup key may be removed by SiYuan',
        });
    }

    const verifyExactPostimage = async (): Promise<AttributeViewDefinition> => {
        const actual = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.avID)).av, parsed.avID);
        await verifyRollupMetadata(actual, parsed.keyID, parsed.relationKeyID, parsed.destinationKeyID, parsed.calc, 'configure_rollup readback');
        return actual;
    };
    // The native rollup definition has no request identity. It may equal the
    // postimage before this call, so a transport error must stay unknown.
    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, [{
        action: 'updateAttrViewColRollup', id: parsed.keyID, avID: parsed.avID,
        parentID: parsed.relationKeyID, keyID: parsed.destinationKeyID, data: { calc: parsed.calc },
    }]);
    const after = await verifyExactPostimage();
    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'configure_rollup', avID: parsed.avID, keyID: parsed.keyID, relationKeyID: parsed.relationKeyID,
        destinationAvID: relationDestinationAvID!, destinationKeyID: parsed.destinationKeyID, calc: parsed.calc,
        sourcePreimageHash: writeHashPool.issue(await hashCanonicalState(source)), sourcePostimageHash: writeHashPool.issue(await hashCanonicalState(after)),
        nativeFilterSideEffect: 'filters referencing this rollup key may be removed by SiYuan',
    });
}

async function verifyRollupMetadata(
    definition: AttributeViewDefinition,
    keyID: string,
    relationKeyID: string,
    destinationKeyID: string,
    calc: Record<string, unknown>,
    context: string,
): Promise<void> {
    const key = getAvKey(definition, keyID, context);
    if (key.type !== 'rollup' || !key.rollup || typeof key.rollup !== 'object' || Array.isArray(key.rollup)) {
        throw new Error(`${context}: rollup key is missing native rollup metadata.`);
    }
    const rollup = key.rollup as Record<string, unknown>;
    if (rollup.relationKeyID !== relationKeyID || rollup.keyID !== destinationKeyID
        || await hashCanonicalState(rollupCalcConfiguration(rollup.calc)) !== await hashCanonicalState(rollupCalcConfiguration(calc))) {
        throw new Error(`${context}: native rollup metadata did not match relationKeyID, destinationKeyID, and calc postimage.`);
    }
}

function rollupCalcConfiguration(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const calc = cloneJsonRecord(value as Record<string, unknown>);
    // The official UI submits only the operator, while SiYuan v3.8's Go
    // RollupCalc struct deterministically serializes its missing result as
    // `result: null`. Normalize only that wire default. A non-null result or
    // any other calc field remains part of strict comparison so an unexpected
    // native shape cannot be certified as the requested configuration.
    if (calc.result === null) delete calc.result;
    return calc;
}
