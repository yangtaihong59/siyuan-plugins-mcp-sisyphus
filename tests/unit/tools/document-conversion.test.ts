import { describe, expect, it, vi } from 'vitest';
import { prepareDocumentConversion } from '@/tools/document/conversion';
import { WriteSafetyCoordinator } from '@/core/write-safety-coordinator';
import { createMockClient } from '../../helpers/mock-client';
import { createMockPermissionManager } from '../../helpers/mock-permissions';
import { parseResult } from '../../helpers/parse-result';

const source = '20261020000000-source1', target = '20261020000001-target1', heading = '20261020000002-heading', paragraph = '20261020000003-paragra';
function fixture() {
    const infos = {
        [source]: { rootID: source, box: 'nb', path: `/${source}.sy` },
        [target]: { rootID: target, box: 'nb', path: `/${target}.sy` },
        [heading]: { rootID: target, box: 'nb', path: `/${target}.sy` },
        [paragraph]: { rootID: target, box: 'nb', path: `/${target}.sy` },
    };
    const client = createMockClient({ request: vi.fn(async (ep, args) => {
        if (ep === '/api/block/getBlockInfo') return infos[args.id];
        if (ep === '/api/block/getBlockDOM') return { dom: `<div data-type="${args.id === heading ? 'NodeHeading' : 'NodeParagraph'}"></div>` };
        if (ep === '/api/filetree/listDocsByPath') return { files: [] };
        throw Error(`Unexpected API ${ep}`);
    }) });
    return { client, infos, permMgr: createMockPermissionManager() };
}
describe('document conversions protect native tree operations', () => {
    it.each([target, paragraph, source])('rejects unsafe target %s before issuing a strict lease', async (targetID) => {
        const { client, permMgr } = fixture(); const execute = vi.fn();
        const result = parseResult(await new WriteSafetyCoordinator(client).run({ client, permMgr, category: 'document', action: 'doc_to_heading', args: { action: 'doc_to_heading', srcID: source, targetID, validateOnly: true }, strictMode: true, execute }));
        expect(result.error.code).toBe('invalid_arguments');
        expect(result.writeAttempted).toBe(false);
        expect(execute).not.toHaveBeenCalled();
        expect(client.writeFile).not.toHaveBeenCalled();
    });
    it('accepts a real heading in another document', async () => {
        const f = fixture();
        expect((await prepareDocumentConversion(f.client, f.permMgr, 'doc_to_heading', { srcID: source, targetID: heading })).target.documentId).toBe(target);
    });
    it('rejects same-document and descendant insertion', async () => {
        for (const info of [{ rootID: source, path: `/${source}.sy` }, { rootID: target, path: `/${source}/${target}.sy` }]) {
            const f = fixture(); Object.assign(f.infos[heading], info);
            await expect(prepareDocumentConversion(f.client, f.permMgr, 'doc_to_heading', { srcID: source, targetID: heading })).rejects.toThrow(/itself|descendant/);
        }
    });
    it('rejects source documents with child documents before conversion', async () => {
        const f = fixture(); const request = f.client.request.getMockImplementation();
        f.client.request.mockImplementation((ep, args) => ep === '/api/filetree/listDocsByPath' ? Promise.resolve({ files: [{ id: 'child' }] }) : request(ep, args));
        await expect(prepareDocumentConversion(f.client, f.permMgr, 'doc_to_heading', { srcID: source, targetID: heading })).rejects.toThrow(/without child documents/);
    });
    it('rejects a missing target and permission revocation without a native write', async () => {
        const f = fixture();
        await expect(prepareDocumentConversion(f.client, f.permMgr, 'doc_to_heading', { srcID: source, targetID: 'missing' })).rejects.toThrow(/existing/);
        f.permMgr.canWrite.mockReturnValue(false);
        await expect(prepareDocumentConversion(f.client, f.permMgr, 'doc_to_heading', { srcID: source, targetID: heading })).rejects.toThrow(/permission/);
        expect(f.client.request.mock.calls.every(([endpoint]) => !['/api/filetree/doc2Heading', '/api/filetree/heading2Doc'].includes(endpoint))).toBe(true);
    });
    it('defaults extraction to the destination notebook root', async () => {
        const f = fixture(); const plan = await prepareDocumentConversion(f.client, f.permMgr, 'heading_to_doc', { headingID: heading, targetNotebook: 'nb' });
        expect(plan.targetPath).toBe('/'); expect(plan.previousPath).toBe('');
    });
    it.each(['/human/name', '../outside.sy', '', '/bad.sy'])('rejects invalid storage path %s', async targetPath => {
        const f = fixture();
        await expect(prepareDocumentConversion(f.client, f.permMgr, 'heading_to_doc', { headingID: heading, targetNotebook: 'nb', targetPath })).rejects.toThrow(/storage path/);
    });
    it('rejects a path resolved in a different notebook', async () => {
        const f = fixture();
        await expect(prepareDocumentConversion(f.client, f.permMgr, 'heading_to_doc', { headingID: heading, targetNotebook: 'other', targetPath: `/${source}.sy` })).rejects.toThrow(/targetNotebook/);
    });
    it('rechecks destination permissions', async () => {
        const f = fixture(); f.permMgr.canWrite.mockImplementation(id => id === 'nb');
        await expect(prepareDocumentConversion(f.client, f.permMgr, 'heading_to_doc', { headingID: heading, targetNotebook: 'readonly' })).rejects.toThrow(/not writable/);
    });
});
