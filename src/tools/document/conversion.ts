import type { SiYuanClient } from '../../api/client';
import type { PermissionManager } from '../../core/permissions';
import { safetyError } from '../../core/write-safety-error';

const storagePath = /^\/(?:\d{14}-[a-z0-9]{7}\/)*\d{14}-[a-z0-9]{7}\.sy$/;

/** Resolve native conversion anchors before either issuing a lease or dispatching a write. */
export async function prepareDocumentConversion(
    client: SiYuanClient, permMgr: PermissionManager, action: string, args: Record<string, unknown>,
) {
    await permMgr.reload();
    async function resolve(id: string, type: 'document' | 'heading') {
        const info = await client.requestRead<{ box: string; path: string; rootID: string }>('/api/block/getBlockInfo', { id });
        if (!info?.box || !info.rootID || !storagePath.test(info.path)) {
            throw safetyError('invalid_arguments', 'Conversion requires an existing, resolvable block.');
        }
        if (!permMgr.canWrite(info.box)) throw safetyError('permission_denied', 'Conversion requires write permission for both source and destination notebooks.');
        if (type === 'document' ? id !== info.rootID : id === info.rootID) {
            throw safetyError('invalid_arguments', type === 'heading'
                ? 'Use an actual heading block ID from document.get_outline, not a document ID.'
                : 'srcID must be a document root ID.');
        }
        if (type === 'heading') {
            const dom = await client.requestRead<{ dom: string }>('/api/block/getBlockDOM', { id });
            if (!/^\s*<[^>]*\bdata-type="NodeHeading"/.test(dom?.dom ?? '')) {
                throw safetyError('invalid_arguments', 'Use an actual heading block ID from document.get_outline.');
            }
        }
        return { id, notebook: info.box, path: info.path, documentId: info.rootID };
    }
    const source = await resolve(String(action === 'doc_to_heading' ? args.srcID : args.headingID), action === 'doc_to_heading' ? 'document' : 'heading');
    if (action === 'doc_to_heading') {
        const target = await resolve(String(args.targetID), 'heading');
        if (source.documentId === target.documentId || (source.notebook === target.notebook && target.path.startsWith(source.path.slice(0, -3) + '/'))) {
            throw safetyError('invalid_arguments', 'Cannot merge a document into itself or its descendant documents.');
        }
        const children = await client.requestRead<{ files: unknown[] }>('/api/filetree/listDocsByPath', { notebook: source.notebook, path: source.path, maxListCount: 0 });
        if (!Array.isArray(children?.files) || children.files.length) throw safetyError('invalid_arguments', 'doc_to_heading requires a source document without child documents.');
        return { source, target, targetPath: target.path, previousPath: '' };
    }
    const notebook = String(args.targetNotebook);
    if (!permMgr.canWrite(notebook)) throw safetyError('permission_denied', 'The target notebook is not writable.');
    const targetPath = args.targetPath === undefined ? '/' : String(args.targetPath);
    const previousPath = args.previousPath === undefined ? '' : String(args.previousPath);
    if ((targetPath !== '/' && !storagePath.test(targetPath)) || (previousPath && !storagePath.test(previousPath))) {
        throw safetyError('invalid_arguments', 'targetPath must be / or an existing document storage path ending in .sy; previousPath must be an existing sibling .sy path. Human-readable paths are not accepted.');
    }
    if (previousPath && targetPath !== '/') throw safetyError('invalid_arguments', 'Specify either targetPath or previousPath; previousPath selects sibling placement.');
    const anchorPath = previousPath || (targetPath === '/' ? '' : targetPath);
    const anchor = anchorPath ? await resolve(anchorPath.split('/').at(-1)!.slice(0, -3), 'document') : undefined;
    if (anchor && (anchor.notebook !== notebook || anchor.path !== anchorPath)) throw safetyError('invalid_arguments', 'The destination storage path does not belong to targetNotebook.');
    return { source, target: anchor ?? { notebook, path: '/', documentId: '', id: '' }, targetPath, previousPath };
}
