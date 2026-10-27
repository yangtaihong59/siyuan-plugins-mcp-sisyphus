/* av new-item templates: set_new_item_templates and create_from_template. */
import { writeHashPool } from '../../core/write-safety-hash';
import type { SiYuanClient } from '@/api/client';
import * as avApi from '../../api/av';
import * as blockApi from '../../api/block';
import * as documentApi from '../../api/document';
import * as systemApi from '../../api/system';
import { hashCanonicalState } from '../../shared/canonical-state';
import { AvCreateFromTemplateSchema, AvSetNewItemTemplatesSchema } from './schemas';
import { ensurePermissionForDocumentId, ensurePermissionForNotebook } from '../internal/context';
import type { ToolHandlerContext } from '../internal/define-tool';
import { createWriteSuccessResult, type ToolResult } from '../internal/shared';
import { ATTRIBUTE_VIEW_ID_PATTERN, type AttributeViewDefinition, type AvKeyDefinition, type AvKeyValueDefinition, asAttributeViewDefinition, avWriteSuccess, cloneJsonRecord, createAvValidationErrorResult, dispatchAvTransaction, ensurePermissionForAvId, extractAvRowLookup, getAvKey, getAvKeyValue, requireWritableRelationDestinations } from './common';
import { readRelationPostimage } from './relation-handlers';

function getTemplate(definition: AttributeViewDefinition, templateID: string, context: string): Record<string, unknown> {
    const templates = definition.newItemTemplates;
    if (!Array.isArray(templates)) throw new Error(`${context}: attribute view has no native new-item templates.`);
    const matches = templates.filter((template): template is Record<string, unknown> => Boolean(
        template && typeof template === 'object' && !Array.isArray(template)
            && (template as Record<string, unknown>).id === templateID,
    ));
    if (matches.length !== 1) throw new Error(`${context}: templateID "${templateID}" did not resolve exactly once.`);
    return matches[0];
}

function validateTemplateFieldValues(definition: AttributeViewDefinition, template: Record<string, unknown>, context: string): void {
    const fieldValues = template.fieldValues;
    if (fieldValues === undefined) return;
    if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) {
        throw new Error(`${context}: template fieldValues must be an object when present.`);
    }
    for (const [keyID, rawFieldValue] of Object.entries(fieldValues as Record<string, unknown>)) {
        const key = getAvKey(definition, keyID, context);
        if (!rawFieldValue || typeof rawFieldValue !== 'object' || Array.isArray(rawFieldValue)) {
            throw new Error(`${context}: template field ${keyID} has an invalid field value.`);
        }
        const fieldValue = rawFieldValue as Record<string, unknown>;
        const mode = fieldValue.mode === undefined ? 'static' : fieldValue.mode;
        if (mode === 'currentTime') {
            if (key.type !== 'date') throw new Error(`${context}: currentTime is only valid for date key "${keyID}".`);
            continue;
        }
        if (mode !== 'static' || !fieldValue.value || typeof fieldValue.value !== 'object' || Array.isArray(fieldValue.value)) {
            throw new Error(`${context}: template field ${keyID} has an invalid static value.`);
        }
        const typedValue = fieldValue.value as Record<string, unknown>;
        if (typedValue.type !== key.type) throw new Error(`${context}: template field ${keyID} has a mismatched value type.`);
        if (key.type === 'select' || key.type === 'mSelect') {
            const validNames = new Set((Array.isArray(key.options) ? key.options : []).flatMap((option) => (
                option && typeof option === 'object' && typeof (option as Record<string, unknown>).name === 'string'
                    ? [(option as Record<string, unknown>).name as string] : []
            )));
            const selections = Array.isArray(typedValue.mSelect) ? typedValue.mSelect : [];
            if (selections.length === 0 || (key.type === 'select' && selections.length !== 1)
                || selections.some((selection) => !selection || typeof selection !== 'object'
                    || typeof (selection as Record<string, unknown>).content !== 'string'
                    || !validNames.has((selection as Record<string, unknown>).content as string))) {
                // SiYuan can prune an absent option only in its creation clone,
                // returning success without a field warning. Refuse before the
                // write; silently adding options would broaden this action.
                throw new Error(`${context}: template ${keyID} contains an option absent from this AV key.`);
            }
        }
        if (key.type === 'relation') {
            const relation = typedValue.relation;
            if (!relation || typeof relation !== 'object' || Array.isArray(relation)
                || !Array.isArray((relation as Record<string, unknown>).blockIDs)) {
                throw new Error(`${context}: template relation field ${keyID} has no blockIDs array.`);
            }
        }
    }
}

function normalizeTemplateValueForKernel(rawValue: Record<string, unknown>, key: AvKeyDefinition): Record<string, unknown> {
    const value = cloneJsonRecord(rawValue);
    for (const field of ['id', 'keyID', 'blockID', 'block', 'template', 'created', 'updated', 'rollup', 'isDetached', 'createdAt', 'updatedAt', 'isRenderAutoFill']) delete value[field];
    value.type = key.type;
    if (key.type === 'number' && value.number && typeof value.number === 'object' && !Array.isArray(value.number)) {
        const number = value.number as Record<string, unknown>;
        if (typeof key.numberFormat === 'string') number.format = key.numberFormat;
        delete number.formattedContent;
    }
    if (key.type === 'date' && value.date && typeof value.date === 'object' && !Array.isArray(value.date)) delete (value.date as Record<string, unknown>).formattedContent;
    if (key.type === 'relation' && value.relation && typeof value.relation === 'object' && !Array.isArray(value.relation)) delete (value.relation as Record<string, unknown>).contents;
    return value;
}

function normalizeTemplateForKernel(rawTemplate: Record<string, unknown>, definition: AttributeViewDefinition, context: string): Record<string, unknown> {
    const template = cloneJsonRecord(rawTemplate);
    template.name = typeof template.name === 'string' ? template.name.trim() : template.name;
    template.icon = typeof template.icon === 'string' ? template.icon.trim() : template.icon;
    template.contentTemplatePath = typeof template.contentTemplatePath === 'string' ? template.contentTemplatePath.trim() : template.contentTemplatePath;
    if (template.targetType !== 'document' || template.icon === '') delete template.icon;
    if (template.contentTemplatePath === '') delete template.contentTemplatePath;
    if (template.saveLocation && typeof template.saveLocation === 'object' && !Array.isArray(template.saveLocation)) {
        const location = template.saveLocation as Record<string, unknown>;
        if (typeof location.boxID === 'string') location.boxID = location.boxID.trim();
        if (typeof location.pathTemplate === 'string') location.pathTemplate = location.pathTemplate.trim();
        if (location.boxID === '') delete location.boxID;
    }
    if (template.fieldValues && typeof template.fieldValues === 'object' && !Array.isArray(template.fieldValues)) {
        const fieldValues = template.fieldValues as Record<string, unknown>;
        for (const [keyID, rawFieldValue] of Object.entries(fieldValues)) {
            if (!rawFieldValue || typeof rawFieldValue !== 'object' || Array.isArray(rawFieldValue)) continue;
            const fieldValue = rawFieldValue as Record<string, unknown>;
            const key = getAvKey(definition, keyID, context);
            if (fieldValue.mode === 'currentTime') delete fieldValue.value;
            else if (fieldValue.value && typeof fieldValue.value === 'object' && !Array.isArray(fieldValue.value)) fieldValue.value = normalizeTemplateValueForKernel(fieldValue.value as Record<string, unknown>, key);
        }
        // The kernel's empty map omits the field during serialization. This is
        // the only template-shape normalization accepted by strict readback.
        if (Object.keys(fieldValues).length === 0) delete template.fieldValues;
    }
    return template;
}

function templateConfigProjection(
    definition: AttributeViewDefinition,
    templates: unknown,
    defaultTemplateID: unknown,
    context: string,
): { templates: Record<string, unknown>[]; defaultTemplateID: string } {
    if (templates === undefined || templates === null) return { templates: [], defaultTemplateID: typeof defaultTemplateID === 'string' ? defaultTemplateID : '' };
    if (!Array.isArray(templates)) throw new Error(`${context}: newItemTemplates must be an array.`);
    return {
        templates: templates.map((template, index) => {
            if (!template || typeof template !== 'object' || Array.isArray(template)) throw new Error(`${context}: template at index ${index} is invalid.`);
            const copied = cloneJsonRecord(template as Record<string, unknown>);
            if (Array.isArray(copied.fieldValues) && copied.fieldValues.length === 0) delete copied.fieldValues;
            return normalizeTemplateForKernel(copied, definition, context);
        }),
        defaultTemplateID: typeof defaultTemplateID === 'string' ? defaultTemplateID : '',
    };
}

function validateCompleteTemplateConfiguration(definition: AttributeViewDefinition, templates: Record<string, unknown>[], defaultTemplateID: string, context: string): void {
    const ids = new Set<string>();
    for (const template of templates) {
        if (typeof template.id !== 'string' || !ATTRIBUTE_VIEW_ID_PATTERN.test(template.id)) throw new Error(`${context}: template has an invalid ID.`);
        if (ids.has(template.id)) throw new Error(`${context}: duplicate template ID "${template.id}".`);
        ids.add(template.id);
        if (typeof template.name !== 'string' || template.name.trim().length === 0 || (template.targetType !== 'detached' && template.targetType !== 'document')) throw new Error(`${context}: template "${template.id}" has invalid required fields.`);
        validateTemplateFieldValues(definition, template, context);
    }
    if (defaultTemplateID && !ids.has(defaultTemplateID)) throw new Error(`${context}: defaultTemplateID "${defaultTemplateID}" is absent from the complete template array.`);
}

// Template, relation, and rollup writes remain separate from the scalar and
// view handlers above. Their native endpoints can alter a second AV or create
// a bound document, so every path below keeps complete raw readback and never
// converts an unknown transport response into a replayed write.
export async function handleSetNewItemTemplates({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvSetNewItemTemplatesSchema.parse(rawArgs);
    const { denied, avData } = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'set_new_item_templates',
    });
    if (denied) return denied;

    const definition = asAttributeViewDefinition(avData, parsed.avID);
    const expectedTemplates = parsed.templates.map((template) => normalizeTemplateForKernel(template, definition, 'set_new_item_templates'));
    try {
        validateCompleteTemplateConfiguration(definition, expectedTemplates, parsed.defaultTemplateID, 'set_new_item_templates');
    } catch (error) {
        return createAvValidationErrorResult('set_new_item_templates', {
            reason: 'template_configuration_invalid',
            message: error instanceof Error ? error.message : String(error),
            hint: 'Every template field must match a currently existing AV key and select/mSelect options must already exist. SiYuan currently prunes unknown options during creation without a warning, so Sisyphus refuses this unsafe configuration instead of adding options automatically.',
        });
    }
    const expected = { templates: expectedTemplates, defaultTemplateID: parsed.defaultTemplateID };
    const observed = templateConfigProjection(
        definition,
        definition.newItemTemplates,
        definition.defaultTemplateID,
        'set_new_item_templates preflight',
    );
    const expectedConfigHash = await templateConfigHash(expected);
    const observedConfigHash = await templateConfigHash(observed);
    if (observedConfigHash === expectedConfigHash) {
        return createWriteSuccessResult({
            action: 'set_new_item_templates',
            avID: parsed.avID,
            templateCount: expected.templates.length,
            defaultTemplateID: expected.defaultTemplateID,
            changed: false,
            status: 'already_applied',
            templatePreimageHash: writeHashPool.issue(await rawTemplateConfigHash(definition)),
            templatePostimageHash: writeHashPool.issue(await rawTemplateConfigHash(definition)),
        });
    }
    const verifyExactPostimage = async (): Promise<{ definition: AttributeViewDefinition; config: { templates: Record<string, unknown>[]; defaultTemplateID: string } }> => {
        const after = await readTemplateConfig(client, parsed.avID, 'set_new_item_templates readback');
        if (await templateConfigHash(after.config) !== await templateConfigHash(expected)) {
            throw new Error(`set_new_item_templates: complete template order, defaults, or defaultTemplateID readback did not match the requested postimage for AV "${parsed.avID}".`);
        }
        return after;
    };

    // A complete replacement may cross a concurrent template edit. The strict
    // preflight protects its preimage; do not fabricate a lossy undo operation
    // that could erase another template field. A lost response must propagate:
    // a matching readback cannot prove this request wrote it, so strict mode
    // records outcome_unknown.
    await dispatchAvTransaction(client, parsed.avID, avData, parsed.blockID, [{
        action: 'setAttrViewNewItemTemplates',
        avID: parsed.avID,
        blockID: parsed.blockID,
        data: expected,
    }]);
    const after = await verifyExactPostimage();
    return avWriteSuccess(client, parsed.avID, avData, parsed.blockID, {
        action: 'set_new_item_templates',
        avID: parsed.avID,
        templateCount: expected.templates.length,
        defaultTemplateID: expected.defaultTemplateID,
        templatePreimageHash: writeHashPool.issue(await rawTemplateConfigHash(definition)),
        templatePostimageHash: writeHashPool.issue(await rawTemplateConfigHash(after.definition)),
    });
}

async function templateConfigHash(config: { templates: Record<string, unknown>[]; defaultTemplateID: string }): Promise<string> {
    return hashCanonicalState({ templates: config.templates, defaultTemplateID: config.defaultTemplateID });
}

async function rawTemplateConfigHash(definition: AttributeViewDefinition): Promise<string> {
    // Report complete native state, not a handler-specific projection. The
    // projection is used only for the documented empty-map serialization.
    return hashCanonicalState({ templates: definition.newItemTemplates, defaultTemplateID: definition.defaultTemplateID });
}

async function readTemplateConfig(
    client: SiYuanClient,
    avID: string,
    context: string,
): Promise<{ definition: AttributeViewDefinition; config: { templates: Record<string, unknown>[]; defaultTemplateID: string } }> {
    const definition = asAttributeViewDefinition((await avApi.getAttributeView(client, avID)).av, avID);
    return { definition, config: templateConfigProjection(definition, definition.newItemTemplates, definition.defaultTemplateID, context) };
}

export async function handleCreateFromTemplate({ client, permMgr, rawArgs }: ToolHandlerContext): Promise<ToolResult> {
    const parsed = AvCreateFromTemplateSchema.parse(rawArgs);
    const sourcePermission = await ensurePermissionForAvId(client, permMgr, parsed.avID, 'write', {
        blockID: parsed.blockID,
        action: 'create_from_template',
    });
    if (sourcePermission.denied) return sourcePermission.denied;
    const source = asAttributeViewDefinition(sourcePermission.avData, parsed.avID);
    let template: Record<string, unknown>;
    const relationTargets = new Map<string, { destinationAvID: string; backKeyID?: string; destination: AttributeViewDefinition; relatedItemIDs: string[] }>();
    try {
        template = getTemplate(source, parsed.templateID, 'create_from_template preflight');
        validateTemplateFieldValues(source, template, 'create_from_template preflight');
        const fieldValues = template.fieldValues;
        if (fieldValues && typeof fieldValues === 'object' && !Array.isArray(fieldValues)) {
            for (const [keyID, rawFieldValue] of Object.entries(fieldValues as Record<string, unknown>)) {
                const fieldValue = rawFieldValue && typeof rawFieldValue === 'object' && !Array.isArray(rawFieldValue) ? rawFieldValue as Record<string, unknown> : undefined;
                const value = fieldValue?.value;
                if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).type !== 'relation') continue;
                const relation = (value as Record<string, unknown>).relation;
                const relatedItemIDs = relation && typeof relation === 'object' && !Array.isArray(relation) && Array.isArray((relation as Record<string, unknown>).blockIDs)
                    ? (relation as Record<string, unknown>).blockIDs as string[] : [];
                const target = await requireWritableRelationDestinations(client, permMgr, source, keyID, relatedItemIDs, 'create_from_template preflight');
                relationTargets.set(keyID, { ...target, relatedItemIDs });
            }
        }
        if (template.targetType === 'document') {
            const saveLocation = template.saveLocation;
            if (!saveLocation || typeof saveLocation !== 'object' || Array.isArray(saveLocation)) throw new Error('Document template inherits SiYuan global document-create location, so its target notebook cannot be preflighted. Give this native template an explicit saveLocation before calling create_from_template.');
            const sourceContext = await ensurePermissionForDocumentId(client, permMgr, parsed.blockID, 'write');
            if (sourceContext.denied) return sourceContext.denied;
            const requestedBoxID = (saveLocation as Record<string, unknown>).boxID;
            const targetNotebookID = typeof requestedBoxID === 'string' && requestedBoxID.trim() ? requestedBoxID.trim() : sourceContext.context.notebook;
            const destinationDenied = await ensurePermissionForNotebook(permMgr, targetNotebookID, 'write');
            if (destinationDenied) return destinationDenied;
        }
    } catch (error) {
        return createAvValidationErrorResult('create_from_template', {
            reason: 'template_create_preflight_failed', message: error instanceof Error ? error.message : String(error),
            hint: 'The wrapper creates only fully preflighted native templates. It does not add missing options, infer a global document location, or treat an AV itemID as a document blockID.',
        });
    }

    // currentTime is materialized by the SiYuan kernel. Use the same remote
    // clock for readback so a standalone/remote MCP process cannot reject a
    // successful create merely because its local clock runs ahead. Static-only
    // templates do not need the extra system request.
    const templateFields = template.fieldValues && typeof template.fieldValues === 'object' && !Array.isArray(template.fieldValues)
        ? Object.values(template.fieldValues as Record<string, unknown>)
        : [];
    const hasCurrentTimeField = templateFields.some((field) => Boolean(
        field && typeof field === 'object' && !Array.isArray(field) && (field as Record<string, unknown>).mode === 'currentTime',
    ));
    const createdAfterMs = hasCurrentTimeField ? await systemApi.getCurrentTime(client) : Number.NEGATIVE_INFINITY;
    const response = await avApi.createAttributeViewItem(client, {
        avID: parsed.avID, blockID: parsed.blockID, viewID: parsed.viewID, templateID: parsed.templateID,
        previousID: parsed.previousID, groupID: parsed.groupID,
    });
    if (!response.itemID || !response.blockID || typeof response.isDetached !== 'boolean') throw new Error(`create_from_template: native endpoint returned incomplete itemID/blockID identity for AV "${parsed.avID}".`);

    const after = asAttributeViewDefinition((await avApi.getAttributeView(client, parsed.avID)).av, parsed.avID);
    const createdLookup = extractAvRowLookup(after);
    if (!createdLookup.rowIDs.has(response.itemID)) throw new Error(`create_from_template readback: returned itemID "${response.itemID}" is not a raw AV row item.`);
    await verifyCreatedTemplateFieldValues(after, template, response.itemID, createdAfterMs, 'create_from_template readback');
    for (const [keyID, target] of relationTargets) {
        await readRelationPostimage(client, parsed.avID, keyID, response.itemID, target.relatedItemIDs, target.destinationAvID, target.backKeyID, [], 'create_from_template relation readback');
    }
    if (response.isDetached) {
        if (response.blockID !== response.itemID) throw new Error('create_from_template readback: detached template returned a distinct document blockID.');
    } else {
        const boundBlockID = getBoundBlockIDForItem(after, response.itemID, 'create_from_template readback');
        if (boundBlockID !== response.blockID) throw new Error('create_from_template readback: native returned blockID differs from the row bound block identity.');
        if (response.blockID === response.itemID || !await blockApi.checkBlockExist(client, response.blockID)) throw new Error('create_from_template readback: document template did not materialize its returned bound document block.');
        const hPath = await documentApi.getHPathByID(client, response.blockID);
        if (!hPath || (response.content && !hPath.endsWith(`/${response.content}`))) throw new Error('create_from_template readback: returned document content did not match its persisted document path.');
    }
    return avWriteSuccess(client, parsed.avID, sourcePermission.avData, parsed.blockID, {
        action: 'create_from_template', avID: parsed.avID, templateID: parsed.templateID, itemID: response.itemID,
        blockID: response.blockID, isDetached: response.isDetached, content: response.content, fieldReadback: 'verified',
        ...(relationTargets.size > 0 ? { relationReadback: 'verified' } : {}),
        ...(response.warnings && response.warnings.length > 0 ? { warnings: response.warnings } : {}),
    });
}

function getCellValueForItem(definition: AttributeViewDefinition, keyID: string, itemID: string, context: string): Record<string, unknown> {
    const matches = getAvKeyValue(definition, keyID, context).values.filter((value) => value.blockID === itemID);
    if (matches.length !== 1) throw new Error(`${context}: key "${keyID}" did not return exactly one value for AV itemID "${itemID}".`);
    return matches[0];
}

function getBoundBlockIDForItem(definition: AttributeViewDefinition, itemID: string, context: string): string {
    const blockKeyValue = (definition.keyValues ?? []).find((entry): entry is AvKeyValueDefinition => Boolean(
        entry && typeof entry === 'object' && !Array.isArray(entry)
            && (entry as { key?: unknown; values?: unknown }).key && typeof (entry as { key?: unknown }).key === 'object'
            && ((entry as { key?: Record<string, unknown> }).key?.type === 'block')
            && Array.isArray((entry as { values?: unknown }).values),
    ));
    if (!blockKeyValue) throw new Error(`${context}: AV has no block primary-key definition.`);
    const cell = blockKeyValue.values.find((value) => value.blockID === itemID);
    const boundID = cell?.block && typeof cell.block === 'object' && !Array.isArray(cell.block)
        ? (cell.block as Record<string, unknown>).id : undefined;
    if (typeof boundID !== 'string' || !boundID) throw new Error(`${context}: AV itemID "${itemID}" has no bound block identity.`);
    return boundID;
}

async function verifyCreatedTemplateFieldValues(
    definition: AttributeViewDefinition,
    template: Record<string, unknown>,
    itemID: string,
    createdAfterMs: number,
    context: string,
): Promise<void> {
    const fieldValues = template.fieldValues;
    if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) return;
    for (const [keyID, rawFieldValue] of Object.entries(fieldValues as Record<string, unknown>)) {
        if (!rawFieldValue || typeof rawFieldValue !== 'object' || Array.isArray(rawFieldValue)) continue;
        const fieldValue = rawFieldValue as Record<string, unknown>;
        const key = getAvKey(definition, keyID, context);
        if (key.type === 'relation' && fieldValue.value && typeof fieldValue.value === 'object' && !Array.isArray(fieldValue.value)) {
            const relation = (fieldValue.value as Record<string, unknown>).relation;
            const ids = relation && typeof relation === 'object' && !Array.isArray(relation) ? (relation as Record<string, unknown>).blockIDs : undefined;
            if (Array.isArray(ids) && ids.length === 0) continue;
        }
        const actual = getCellValueForItem(definition, keyID, itemID, context);
        if (fieldValue.mode === 'currentTime') {
            const date = actual.date;
            const content = date && typeof date === 'object' && !Array.isArray(date) ? (date as Record<string, unknown>).content : undefined;
            if (actual.type !== 'date' || typeof content !== 'number' || content < createdAfterMs) throw new Error(`${context}: currentTime field "${keyID}" did not materialize as a new date value.`);
            continue;
        }
        if (!fieldValue.value || typeof fieldValue.value !== 'object' || Array.isArray(fieldValue.value)) throw new Error(`${context}: static field "${keyID}" has no value for readback comparison.`);
        if (await hashCanonicalState(normalizeTemplateValueForKernel(actual, key)) !== await hashCanonicalState(normalizeTemplateValueForKernel(fieldValue.value as Record<string, unknown>, key))) {
            throw new Error(`${context}: static template field "${keyID}" did not match its native readback.`);
        }
    }
}
