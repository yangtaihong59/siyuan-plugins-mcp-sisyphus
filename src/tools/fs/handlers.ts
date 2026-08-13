import * as blockApi from '../../api/block';
import * as documentApi from '../../api/document';
import * as fileApi from '../../api/file';
import * as notebookApi from '../../api/notebook';
import { AGENT_MEMORY_VIRTUAL_PATH, USER_RULES_VIRTUAL_PATH, loadToolConfigFromApiFile, writeAgentSiyuanMemory, type FsAction } from '../../core/config';
import { normalizeMarkdownContent } from '../../core/normalize';
import {
    FsLsSchema,
    FsMvSchema,
    FsReorderSchema,
    FsReplaceSchema,
    FsReadSchema,
    FsRmSchema,
    FsSearchSchema,
    FsTreeSchema,
    FsWriteSchema,
} from '../../core/types';
import { ensurePermissionForNotebook, listChildDocumentsByPath } from '../internal/context';
import type { ToolActionHandler } from '../internal/define-tool';
import {
    resolveFsCreateTarget,
    resolveFsDestinationTarget,
    resolveFsScopePath,
    type FsDocumentPath,
    type FsScopePath,
} from '../internal/helpers/fs-path';
import {
    applyDocumentReorder,
    readDocumentReorderState,
    resolveFsReorderOrder,
} from '../internal/helpers/document-reorder';
import { applyExactReplaceEdits } from '../internal/replace';
import { createJsonResult, createPaginatedResult, type ToolResult } from '../internal/shared';
import { applyUiRefresh } from '../internal/ui-refresh';
import { applyDocumentKramdownDomReplacements, createFootnoteReferenceHint, createSiyuanBlockLinkHint, createUnresolvedBlockRefHint, hasBlockRefIdFallbackAnchors, hasFootnoteReferences, hasSiyuanBlockLinks, stripRedundantTitleHeading } from '../internal/kramdown-safe';
import {
    createSyntheticDocumentBlockWindow,
    listDocumentBlocksInTreeOrder,
    readDocumentBlockWindow,
    type DocumentBlockWindow,
    type OrderedDocumentBlock,
} from '../internal/document-kramdown';
import { normalizeMarkdownInputRefs, normalizeReplaceEditsRefs } from '../internal/markdown-input';

type FsActionHandler = ToolActionHandler;

interface FsListItem {
    name: string;
    path: string;
    children: number;
    virtual?: boolean;
}

interface ExportedMarkdownPayload {
    content: string;
    hPath?: string;
}

const AV_ID_ATTR_PATTERN = /\bdata-av-id=(?:"([^"]+)"|'([^']+)')/i;
const NON_FIDELITY_BLOCK_TYPES = new Set([
    's',
    'av',
    'iframe',
    'widget',
    'query_embed',
    'html',
    'video',
    'audio',
]);

function isNonFidelityBlockType(type: string | undefined): boolean {
    return Boolean(type && NON_FIDELITY_BLOCK_TYPES.has(type));
}

function createFsNonFidelityHint(blocks: Array<{ type?: string }>): Record<string, unknown> {
    const complexBlockTypes = Array.from(new Set(blocks
        .map((block) => block.type)
        .filter((type): type is string => isNonFidelityBlockType(type))));
    if (complexBlockTypes.length === 0) return {};
    return {
        nonFidelityWarning: 'fs is intentionally limited to pure Markdown-style document operations. This document contains SiYuan-native structures; inspect or modify those blocks with advanced tools instead of fs.',
        complexBlockTypes,
        recommendedReads: ['file.export_md', 'block.dom'],
    };
}

function findComplexFsBlocks(blocks: Array<{ id?: string; type?: string }>): Array<{ id?: string; type: string }> {
    return blocks.flatMap((block) => (
        isNonFidelityBlockType(block.type)
            ? [{ ...(block.id ? { id: block.id } : {}), type: block.type! }]
            : []
    ));
}

function isFsReplaceCandidateBlock(block: { type?: string }): boolean {
    return Boolean(block.type && !isNonFidelityBlockType(block.type));
}

function createComplexBlocksNotSupportedResult(
    action: 'write' | 'replace',
    path: string,
    documentId: string,
    complexBlocks: Array<{ id?: string; type: string }>,
): ToolResult {
    return {
        content: [{
            type: 'text',
            text: JSON.stringify({
                error: {
                    type: 'complex_blocks_not_supported_by_fs',
                    message: `fs.${action} is limited to pure Markdown documents and will not modify documents containing SiYuan-native complex blocks.`,
                    path,
                    id: documentId,
                    complexBlocks,
                    recommendedTools: ['file.export_md', 'block.dom', 'block.update', 'block.append', 'av'],
                    hint: 'Use fs for pure Markdown content only. For database blocks, super blocks, embeds, widgets, HTML/media, or precise native structure changes, inspect with block.dom and edit with the matching advanced tool.',
                },
            }, null, 2),
        }],
        isError: true,
    };
}

function stripSySuffix(name: string | undefined): string | undefined {
    return typeof name === 'string' ? name.replace(/\.sy$/, '') : undefined;
}

function lastSegment(path: string | undefined): string | undefined {
    if (!path) return undefined;
    return path.split('/').filter(Boolean).at(-1);
}

function joinHumanPath(parent: string, name: string): string {
    const base = parent === '/' ? '' : parent.replace(/\/+$/, '');
    return `${base}/${name.replace(/^\/+/, '')}`;
}

function normalizeFsPath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) throw new Error('fs path must not be empty.');
    const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    const collapsed = withLeadingSlash.replace(/\/+/g, '/');
    return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

const VIRTUAL_ROOT_FILES = [AGENT_MEMORY_VIRTUAL_PATH, USER_RULES_VIRTUAL_PATH] as const;
type VirtualRootFilePath = typeof VIRTUAL_ROOT_FILES[number];

function getVirtualRootFilePath(path: string): VirtualRootFilePath | null {
    const normalized = normalizeFsPath(path);
    return VIRTUAL_ROOT_FILES.find((virtualPath) => normalized === virtualPath) ?? null;
}

function getVirtualRootFileDescendantPath(path: string): VirtualRootFilePath | null {
    const normalized = normalizeFsPath(path);
    return VIRTUAL_ROOT_FILES.find((virtualPath) => normalized.startsWith(`${virtualPath}/`)) ?? null;
}

function assertNotVirtualRootFileDescendant(path: string) {
    const virtualPath = getVirtualRootFileDescendantPath(path);
    if (virtualPath) {
        throw new Error(`${virtualPath} is a virtual file and has no children.`);
    }
}

function assertUserRulesWritable(path: string) {
    const virtualPath = getVirtualRootFilePath(path) ?? getVirtualRootFileDescendantPath(path);
    if (virtualPath === USER_RULES_VIRTUAL_PATH) {
        throw new Error(`${USER_RULES_VIRTUAL_PATH} is a read-only virtual file. Edit user rules in the plugin settings.`);
    }
}

function createVirtualListItem(path: VirtualRootFilePath): FsListItem {
    return {
        name: path.slice(1),
        path,
        children: 0,
        virtual: true,
    };
}

function createVirtualTreeNode(path: VirtualRootFilePath): { name: string; path: string; children: unknown[]; virtual: true } {
    return {
        name: path.slice(1),
        path,
        children: [],
        virtual: true,
    };
}

function canonicalNotebookPath(notebookName: string, hPath: string): string {
    return hPath === '/'
        ? `/${notebookName}`
        : `/${notebookName}${hPath}`;
}

function compactChild(parentPath: string, child: { name?: string; path: string; subFileCount?: number; count?: number }): FsListItem {
    const name = stripSySuffix(child.name) ?? stripSySuffix(lastSegment(child.path)) ?? child.path;
    return {
        name,
        path: joinHumanPath(parentPath, name),
        children: child.subFileCount ?? child.count ?? 0,
    };
}

async function listReadableNotebooks(client: Parameters<FsActionHandler>[0]['client'], permMgr: Parameters<FsActionHandler>[0]['permMgr']) {
    await permMgr.reload();
    const result = await notebookApi.listNotebooks(client);
    return result.notebooks.filter((notebook) => permMgr.canRead(notebook.id));
}

async function listScopeChildren(client: Parameters<FsActionHandler>[0]['client'], scope: FsScopePath): Promise<FsListItem[]> {
    if (scope.type === 'root') return [];
    const children = await listChildDocumentsByPath(client, scope.notebook, scope.storagePath);
    return children.map((child) => compactChild(scope.canonicalPath, child));
}

function deriveTreeNodeFallback(node: Record<string, unknown>, parentPath: string): { name: string; path: string } {
    const name = stripSySuffix(typeof node.name === 'string' ? node.name : undefined)
        ?? stripSySuffix(lastSegment(typeof node.hPath === 'string' ? node.hPath : undefined))
        ?? stripSySuffix(lastSegment(typeof node.path === 'string' ? node.path : undefined))
        ?? (typeof node.id === 'string' ? node.id : 'Untitled');
    return {
        name,
        path: joinHumanPath(parentPath, name),
    };
}

async function normalizeTreeNodes(
    client: Parameters<FsActionHandler>[0]['client'],
    nodes: unknown,
    parentPath: string,
    notebookName: string,
    maxDepth: number,
    depth = 0,
    hPathCache = new Map<string, Promise<string>>(),
): Promise<unknown[]> {
    if (!Array.isArray(nodes)) return [];
    return Promise.all(nodes.map(async (node) => {
        const typed = node && typeof node === 'object' ? node as Record<string, unknown> : {};
        const fallback = deriveTreeNodeFallback(typed, parentPath);
        let name = fallback.name;
        let path = fallback.path;
        const id = typeof typed.id === 'string' ? typed.id : undefined;
        if (id) {
            try {
                let pending = hPathCache.get(id);
                if (!pending) {
                    pending = documentApi.getHPathByID(client, id);
                    hPathCache.set(id, pending);
                }
                const hPath = await pending;
                const resolvedName = stripSySuffix(lastSegment(hPath));
                if (resolvedName) {
                    name = resolvedName;
                    path = canonicalNotebookPath(notebookName, hPath);
                }
            } catch {
                // Keep the fallback name/path when hPath lookup fails.
            }
        }
        const rawChildren = Array.isArray(typed.children) ? typed.children : [];
        const compact: Record<string, unknown> = {
            name,
            path,
        };
        if (depth >= maxDepth) {
            compact.children = rawChildren.length;
        } else {
            compact.children = await normalizeTreeNodes(
                client,
                rawChildren,
                compact.path as string,
                notebookName,
                maxDepth,
                depth + 1,
                hPathCache,
            );
        }
        return compact;
    }));
}

function extractTreeArray(result: unknown): unknown[] {
    if (Array.isArray(result)) return result;
    if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).tree)) {
        return (result as Record<string, unknown>).tree as unknown[];
    }
    return [];
}

function collectTreeIds(nodes: unknown): string[] {
    if (!Array.isArray(nodes)) return [];
    const ids: string[] = [];
    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const typed = node as Record<string, unknown>;
        if (typeof typed.id === 'string') ids.push(typed.id);
        if (Array.isArray(typed.children)) ids.push(...collectTreeIds(typed.children));
    }
    return ids;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deriveDocumentTitle(hPath: string | undefined): string | undefined {
    const segment = stripSySuffix(lastSegment(hPath));
    return typeof segment === 'string' && segment.length > 0 ? segment : undefined;
}

function stripExportedDocumentWrapper(payload: ExportedMarkdownPayload): string {
    let content = payload.content;
    const title = deriveDocumentTitle(payload.hPath);

    if (content.startsWith('---\n')) {
        const frontMatterMatch = content.match(/^---\n[\s\S]*?\n---\n*/);
        if (frontMatterMatch) {
            content = content.slice(frontMatterMatch[0].length);
        }
    }

    if (title) {
        const headingPattern = new RegExp(`^# ${escapeRegExp(title)}\\s*\\n+`);
        content = content.replace(headingPattern, '');
    }

    return content;
}

async function overwriteDocumentBody(
    client: Parameters<FsActionHandler>[0]['client'],
    documentId: string,
    markdown: string,
) {
    const blocks = await blockApi.getChildBlocks(client, documentId);
    for (const block of blocks) {
        if (typeof block.id === 'string') {
            await blockApi.deleteBlock(client, block.id);
        }
    }
    if (markdown.trim().length > 0) {
        await blockApi.appendBlock(client, 'markdown', markdown, documentId);
    }
}

function extractAttributeViewIdFromKramdown(kramdown: string): string | undefined {
    const match = kramdown.match(AV_ID_ATTR_PATTERN);
    return match?.[1] ?? match?.[2];
}

async function listDocumentAttributeViews(
    client: Parameters<FsActionHandler>[0]['client'],
    documentId: string,
    knownBlocks?: OrderedDocumentBlock[],
): Promise<Array<{ blockID: string; avID?: string }>> {
    const blocks = knownBlocks ?? await listDocumentBlocksInTreeOrder(client, documentId);
    const avBlocks = blocks.filter((block) => block.type === 'av');
    return Promise.all(avBlocks.map(async (block) => {
        const result = await blockApi.getBlockKramdown(client, block.id);
        const kramdown = typeof result.kramdown === 'string' ? result.kramdown : '';
        return {
            blockID: block.id,
            ...(extractAttributeViewIdFromKramdown(kramdown) ? { avID: extractAttributeViewIdFromKramdown(kramdown) } : {}),
        };
    }));
}

function createFsReadWindowPayload(
    path: string,
    window: DocumentBlockWindow,
    includeBlockIds: boolean,
): Record<string, unknown> {
    const { nextBlockStart, ...payload } = window;
    if (nextBlockStart === undefined) return { path, ...payload };
    const nextWindow = {
        action: 'read',
        path,
        blockStart: nextBlockStart,
        blockLimit: window.blockLimit,
        tokenBudget: window.tokenBudget,
        ...(includeBlockIds ? { includeBlockIds: true } : {}),
    };
    return {
        path,
        ...payload,
        nextWindow,
        nextWindowHint: `Continue with fs(${JSON.stringify(nextWindow)}).`,
    };
}

function createAttributeViewFsHint(attributeViews: Array<{ blockID: string; avID?: string }>): Record<string, unknown> {
    return {
        attributeViews,
        warning: 'This document contains database/attribute-view blocks. fs is only a pure Markdown convenience layer and will not safely edit these SiYuan-native structures. Use av(action="get"|"render"|"set_cells"|"add_rows"|"remove_rows"|"add_column"|"remove_column") for rows, columns, and cells.',
        avToolHint: {
            read: 'av(action="get", id="<av-id>") or av(action="render", id="<av-id>", blockID="<database-block-id>")',
            write: 'av(action="set_cells"|"add_rows"|"remove_rows"|"add_column"|"remove_column", avID="<av-id>", ...)',
        },
    };
}

async function replaceDocumentBlocksSafely(
    client: Parameters<FsActionHandler>[0]['client'],
    documentId: string,
    edits: Array<{ old: string; new: string; replace_all?: boolean }>,
) {
    const documentBlocks = await listDocumentBlocksInTreeOrder(client, documentId);
    const complexBlocks = findComplexFsBlocks(documentBlocks);
    const blocks = documentBlocks
        .filter(isFsReplaceCandidateBlock)
        .map((block) => ({ id: block.id, type: block.type }));
    if (blocks.length === 0) {
        throw new Error('fs.replace found no editable non-complex Markdown blocks in this document.');
    }

    const kramdownBlocks = await Promise.all(blocks.map(async (block) => {
        const [result, dom] = await Promise.all([
            blockApi.getBlockKramdown(client, block.id),
            blockApi.getBlockDOM(client, block.id),
        ]);
        return {
            id: block.id,
            type: block.type,
            kramdown: typeof result.kramdown === 'string' ? result.kramdown : '',
            dom: typeof dom.dom === 'string' ? dom.dom : '',
        };
    }));
    const replaced = applyDocumentKramdownDomReplacements(kramdownBlocks, edits, 'fs.replace');

    for (const block of replaced.blocks) {
        const shouldReparseIndexedInline = block.touchesIndexedInline && block.type !== 'l';
        await blockApi.updateBlock(
            client,
            shouldReparseIndexedInline ? 'markdown' : 'dom',
            shouldReparseIndexedInline ? block.markdown : block.dom,
            block.id,
        );
    }

    return {
        summary: replaced.summary,
        changedBlockCount: replaced.blocks.length,
        changedMarkdown: replaced.blocks.map((block) => block.markdown).join('\n'),
        skippedComplexBlocks: complexBlocks,
    };
}

async function collectSearchDocuments(
    client: Parameters<FsActionHandler>[0]['client'],
    permMgr: Parameters<FsActionHandler>[0]['permMgr'],
    scope: FsScopePath,
): Promise<Array<{ id: string; notebookName: string }>> {
    if (scope.type === 'document') {
        const tree = extractTreeArray(await documentApi.listDocTree(client, scope.notebook, scope.storagePath));
        return [...new Set([scope.id, ...collectTreeIds(tree)])].map((id) => ({ id, notebookName: scope.notebookName }));
    }
    if (scope.type === 'notebook') {
        const tree = extractTreeArray(await documentApi.listDocTree(client, scope.notebook, '/'));
        return [...new Set(collectTreeIds(tree))].map((id) => ({ id, notebookName: scope.notebookName }));
    }
    const notebooks = await listReadableNotebooks(client, permMgr);
    const docs: Array<{ id: string; notebookName: string }> = [];
    for (const notebook of notebooks) {
        const tree = extractTreeArray(await documentApi.listDocTree(client, notebook.id, '/'));
        docs.push(...[...new Set(collectTreeIds(tree))].map((id) => ({ id, notebookName: notebook.name })));
    }
    return docs;
}

function createMatcher(query: string, regex?: boolean, caseSensitive?: boolean): (line: string) => boolean {
    if (regex) {
        const flags = caseSensitive ? '' : 'i';
        const pattern = new RegExp(query, flags);
        return (line) => pattern.test(line);
    }
    const needle = caseSensitive ? query : query.toLowerCase();
    return (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
}

function collectVirtualTextMatches(content: string, matcher: (line: string) => boolean, path: VirtualRootFilePath): Array<{ path: string; line: number; text: string }> {
    const matches: Array<{ path: string; line: number; text: string }> = [];
    content.split(/\r?\n/).forEach((line, index) => {
        if (matcher(line)) {
            matches.push({
                path,
                line: index + 1,
                text: line.length > 300 ? `${line.slice(0, 297)}...` : line,
            });
        }
    });
    return matches;
}

async function readAgentMemoryState(client: Parameters<FsActionHandler>[0]['client']) {
    const config = await loadToolConfigFromApiFile(client);
    return {
        content: config.agentSiyuanMemoryText ?? '',
        updatedAt: config.agentSiyuanMemoryUpdatedAt ?? '',
    };
}

async function readUserRulesState(client: Parameters<FsActionHandler>[0]['client']) {
    const config = await loadToolConfigFromApiFile(client);
    return {
        content: config.userRulesText ?? '',
    };
}

const handleLs: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsLsSchema.parse(rawArgs);
    assertNotVirtualRootFileDescendant(parsed.path);
    const virtualPath = getVirtualRootFilePath(parsed.path);
    if (virtualPath) {
        throw new Error(`${virtualPath} is a virtual file and has no children.`);
    }
    const scope = await resolveFsScopePath(client, permMgr, parsed.path, 'read');
    if (scope.type === 'root') {
        const notebooks = await listReadableNotebooks(client, permMgr);
        const items: FsListItem[] = VIRTUAL_ROOT_FILES.map((path) => createVirtualListItem(path));
        for (const notebook of notebooks) {
            let children = 0;
            try {
                children = (await listChildDocumentsByPath(client, notebook.id, '/')).length;
            } catch {
                children = 0;
            }
            items.push({ name: notebook.name, path: `/${notebook.name}`, children });
        }
        return createJsonResult({ path: '/', items });
    }
    const denied = await ensurePermissionForNotebook(permMgr, scope.notebook, 'read');
    if (denied) return denied;
    return createJsonResult({ path: scope.canonicalPath, items: await listScopeChildren(client, scope) });
};

const handleTree: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsTreeSchema.parse(rawArgs);
    assertNotVirtualRootFileDescendant(parsed.path);
    const virtualPath = getVirtualRootFilePath(parsed.path);
    if (virtualPath) {
        return createJsonResult({
            path: virtualPath,
            tree: [],
            virtual: true,
            maxDepth: parsed.maxDepth ?? 3,
        });
    }
    const scope = await resolveFsScopePath(client, permMgr, parsed.path, 'read');
    const maxDepth = parsed.maxDepth ?? 3;
    if (scope.type === 'root') {
        const notebooks = await listReadableNotebooks(client, permMgr);
        const tree: Array<{ name: string; path: string; children: unknown[]; virtual?: boolean }> = VIRTUAL_ROOT_FILES.map((path) => createVirtualTreeNode(path));
        for (const notebook of notebooks) {
            const result = await documentApi.listDocTree(client, notebook.id, '/');
            tree.push({
                name: notebook.name,
                path: `/${notebook.name}`,
                children: await normalizeTreeNodes(client, extractTreeArray(result), `/${notebook.name}`, notebook.name, maxDepth),
            });
        }
        return createJsonResult({ path: '/', tree, maxDepth });
    }
    const denied = await ensurePermissionForNotebook(permMgr, scope.notebook, 'read');
    if (denied) return denied;
    const result = await documentApi.listDocTree(client, scope.notebook, scope.storagePath);
    return createJsonResult({
        path: scope.canonicalPath,
        tree: await normalizeTreeNodes(client, extractTreeArray(result), scope.canonicalPath, scope.notebookName, maxDepth),
        maxDepth,
    });
};

const handleRead: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsReadSchema.parse(rawArgs);
    const windowOptions = {
        blockStart: parsed.blockStart,
        blockLimit: parsed.blockLimit,
        tokenBudget: parsed.tokenBudget,
        includeBlockIds: parsed.includeBlockIds,
    };
    assertNotVirtualRootFileDescendant(parsed.path);
    const virtualPath = getVirtualRootFilePath(parsed.path);
    if (virtualPath === AGENT_MEMORY_VIRTUAL_PATH) {
        const memory = await readAgentMemoryState(client);
        const window = createSyntheticDocumentBlockWindow(memory.content, windowOptions);
        return createJsonResult({
            ...createFsReadWindowPayload(AGENT_MEMORY_VIRTUAL_PATH, window, false),
            virtual: true,
            updatedAt: memory.updatedAt || null,
        });
    }
    if (virtualPath === USER_RULES_VIRTUAL_PATH) {
        const rules = await readUserRulesState(client);
        const window = createSyntheticDocumentBlockWindow(rules.content, windowOptions);
        return createJsonResult({
            ...createFsReadWindowPayload(USER_RULES_VIRTUAL_PATH, window, false),
            virtual: true,
        });
    }
    const scope = await resolveFsScopePath(client, permMgr, parsed.path, 'read');
    if (scope.type !== 'document') throw new Error(`fs.read requires a document path, got "${parsed.path}".`);
    const denied = await ensurePermissionForNotebook(permMgr, scope.notebook, 'read');
    if (denied) return denied;
    const blocks = await listDocumentBlocksInTreeOrder(client, scope.id);
    const [window, attributeViews] = await Promise.all([
        readDocumentBlockWindow(client, scope.id, windowOptions, blocks),
        listDocumentAttributeViews(client, scope.id, blocks),
    ]);
    return createJsonResult({
        ...createFsReadWindowPayload(scope.canonicalPath, window, parsed.includeBlockIds ?? false),
        ...(attributeViews.length > 0 ? createAttributeViewFsHint(attributeViews) : {}),
        ...createFsNonFidelityHint(blocks),
    });
};

const handleWrite: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsWriteSchema.parse(rawArgs);
    assertUserRulesWritable(parsed.path);
    assertNotVirtualRootFileDescendant(parsed.path);
    const virtualPath = getVirtualRootFilePath(parsed.path);
    if (virtualPath === AGENT_MEMORY_VIRTUAL_PATH) {
        const config = await writeAgentSiyuanMemory(client, parsed.markdown);
        return createJsonResult({
            success: true,
            path: AGENT_MEMORY_VIRTUAL_PATH,
            virtual: true,
            overwritten: true,
            updatedAt: config.agentSiyuanMemoryUpdatedAt || null,
        });
    }
    const target = await resolveFsCreateTarget(client, permMgr, parsed.path);
    const denied = await ensurePermissionForNotebook(permMgr, target.notebook, 'write');
    if (denied) return denied;

    let existing: FsDocumentPath | null = null;
    try {
        const resolved = await resolveFsScopePath(client, permMgr, target.canonicalPath, 'write');
        existing = resolved.type === 'document' ? resolved : null;
    } catch {
        existing = null;
    }

    if (!existing) {
        const markdown = await normalizeMarkdownInputRefs(client, stripRedundantTitleHeading(parsed.markdown, target.title), 'fs.write');
        const id = await documentApi.createDoc(client, target.notebook, target.hPath, markdown);
        return applyUiRefresh(client, createJsonResult({
            success: true,
            path: target.canonicalPath,
            id,
            created: true,
            ...(hasSiyuanBlockLinks(markdown) ? createSiyuanBlockLinkHint() : {}),
            ...(hasFootnoteReferences(markdown) ? createFootnoteReferenceHint() : {}),
            ...(hasBlockRefIdFallbackAnchors(markdown) ? createUnresolvedBlockRefHint() : {}),
        }), [
            { type: 'reloadProtyle', id },
            { type: 'reloadFiletree' },
        ]);
    }

    if (!parsed.overwrite) {
        throw new Error(`Document already exists at "${existing.canonicalPath}". Pass overwrite=true to replace its body.`);
    }

    const markdown = await normalizeMarkdownInputRefs(client, parsed.markdown, 'fs.write');
    const existingBlocks = await listDocumentBlocksInTreeOrder(client, existing.id);
    const complexBlocks = findComplexFsBlocks(existingBlocks);
    if (complexBlocks.length > 0) {
        return createComplexBlocksNotSupportedResult('write', existing.canonicalPath, existing.id, complexBlocks);
    }
    const attributeViews = await listDocumentAttributeViews(client, existing.id);
    await overwriteDocumentBody(client, existing.id, markdown);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        path: existing.canonicalPath,
        id: existing.id,
        overwritten: true,
        ...(hasSiyuanBlockLinks(markdown) ? createSiyuanBlockLinkHint() : {}),
        ...(hasFootnoteReferences(markdown) ? createFootnoteReferenceHint() : {}),
        ...(hasBlockRefIdFallbackAnchors(markdown) ? createUnresolvedBlockRefHint() : {}),
        ...(attributeViews.length > 0 ? createAttributeViewFsHint(attributeViews) : {}),
    }), [
        { type: 'reloadProtyle', id: existing.id },
        { type: 'reloadFiletree' },
    ]);
};

const handleReplace: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsReplaceSchema.parse(rawArgs);
    assertUserRulesWritable(parsed.path);
    assertNotVirtualRootFileDescendant(parsed.path);
    const virtualPath = getVirtualRootFilePath(parsed.path);
    if (virtualPath === AGENT_MEMORY_VIRTUAL_PATH) {
        const memory = await readAgentMemoryState(client);
        const originalContent = memory.content;
        const edits = Array.isArray(parsed.edit) ? parsed.edit : [parsed.edit];
        const { content: nextContent, summary } = applyExactReplaceEdits(originalContent, edits, 'fs.replace');
        const changed = nextContent !== originalContent;
        let updatedAt = memory.updatedAt;
        if (changed) {
            const config = await writeAgentSiyuanMemory(client, nextContent);
            updatedAt = config.agentSiyuanMemoryUpdatedAt;
        }
        return createJsonResult({
            success: true,
            path: AGENT_MEMORY_VIRTUAL_PATH,
            virtual: true,
            changed,
            editsApplied: summary.length,
            replacements: summary,
            updatedAt: updatedAt || null,
        });
    }
    const scope = await resolveFsScopePath(client, permMgr, parsed.path, 'write');
    if (scope.type !== 'document') throw new Error(`fs.replace requires a document path, got "${parsed.path}".`);
    const denied = await ensurePermissionForNotebook(permMgr, scope.notebook, 'write');
    if (denied) return denied;

    const edits = await normalizeReplaceEditsRefs(client, Array.isArray(parsed.edit) ? parsed.edit : [parsed.edit], 'fs.replace');
    const replaceResult = await replaceDocumentBlocksSafely(client, scope.id, edits);
    const { summary, changedBlockCount, changedMarkdown, skippedComplexBlocks } = replaceResult;
    const changed = changedBlockCount > 0;

    return applyUiRefresh(client, createJsonResult({
        success: true,
        path: scope.canonicalPath,
        changed,
        editsApplied: summary.length,
        replacements: summary,
        ...(skippedComplexBlocks.length > 0 ? {
            warning: 'This document contains SiYuan-native complex blocks. fs.replace edited only matched non-complex Markdown blocks; complex blocks were skipped.',
            skippedComplexBlocks,
            recommendedTools: ['block.dom', 'block.update', 'av', 'file.export_md'],
        } : {}),
        ...(hasSiyuanBlockLinks(changedMarkdown) ? createSiyuanBlockLinkHint() : {}),
        ...(hasFootnoteReferences(changedMarkdown) ? createFootnoteReferenceHint() : {}),
        ...(hasBlockRefIdFallbackAnchors(changedMarkdown) ? createUnresolvedBlockRefHint() : {}),
    }), changed ? [
        { type: 'reloadProtyle', id: scope.id },
        { type: 'reloadFiletree' },
    ] : []);
};

const handleRm: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsRmSchema.parse(rawArgs);
    assertUserRulesWritable(parsed.path);
    assertNotVirtualRootFileDescendant(parsed.path);
    const virtualPath = getVirtualRootFilePath(parsed.path);
    if (virtualPath === AGENT_MEMORY_VIRTUAL_PATH) {
        const config = await writeAgentSiyuanMemory(client, '');
        return createJsonResult({
            success: true,
            path: AGENT_MEMORY_VIRTUAL_PATH,
            virtual: true,
            cleared: true,
            updatedAt: config.agentSiyuanMemoryUpdatedAt || null,
        });
    }
    const scope = await resolveFsScopePath(client, permMgr, parsed.path, 'delete');
    if (scope.type !== 'document') throw new Error(`fs.rm requires a document path, got "${parsed.path}".`);
    const denied = await ensurePermissionForNotebook(permMgr, scope.notebook, 'delete');
    if (denied) return denied;
    await documentApi.removeDocByID(client, scope.id);
    return applyUiRefresh(client, createJsonResult({ success: true, path: scope.canonicalPath }), [
        { type: 'reloadProtyle', id: scope.id },
        { type: 'reloadFiletree' },
    ]);
};

const handleMv: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsMvSchema.parse(rawArgs);
    assertUserRulesWritable(parsed.from);
    assertUserRulesWritable(parsed.to);
    if (getVirtualRootFilePath(parsed.from) === AGENT_MEMORY_VIRTUAL_PATH
        || getVirtualRootFilePath(parsed.to) === AGENT_MEMORY_VIRTUAL_PATH
        || getVirtualRootFileDescendantPath(parsed.from) === AGENT_MEMORY_VIRTUAL_PATH
        || getVirtualRootFileDescendantPath(parsed.to) === AGENT_MEMORY_VIRTUAL_PATH) {
        throw new Error(`${AGENT_MEMORY_VIRTUAL_PATH} is a fixed virtual file and cannot be moved or renamed.`);
    }
    const source = await resolveFsScopePath(client, permMgr, parsed.from, 'write');
    if (source.type !== 'document') throw new Error(`fs.mv source must be a document path, got "${parsed.from}".`);
    const destination = await resolveFsDestinationTarget(client, permMgr, parsed.to);
    const sourceDenied = await ensurePermissionForNotebook(permMgr, source.notebook, 'write');
    if (sourceDenied) return sourceDenied;
    const destinationDenied = await ensurePermissionForNotebook(permMgr, destination.notebook, 'write');
    if (destinationDenied) return destinationDenied;
    try {
        const existingDestination = await resolveFsScopePath(client, permMgr, destination.canonicalPath, 'write');
        if (existingDestination.type === 'document' && existingDestination.id !== source.id) {
            throw new Error(`Destination already exists at "${destination.canonicalPath}".`);
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Destination already exists')) {
            throw error;
        }
    }

    await documentApi.moveDocsByID(client, [source.id], destination.parentId ?? destination.notebook);
    if (source.name !== destination.title) {
        await documentApi.renameDocByID(client, source.id, destination.title);
    }
    return applyUiRefresh(client, createJsonResult({
        success: true,
        path: source.canonicalPath,
        movedTo: destination.canonicalPath,
    }), [
        { type: 'reloadProtyle', id: source.id },
        { type: 'reloadFiletree' },
    ]);
};

const handleReorder: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsReorderSchema.parse(rawArgs);
    assertNotVirtualRootFileDescendant(parsed.path);
    if (getVirtualRootFilePath(parsed.path)) {
        throw new Error('fs.reorder requires a notebook or parent document path, not a virtual file.');
    }
    const scope = await resolveFsScopePath(client, permMgr, parsed.path, 'write');
    if (scope.type === 'root') {
        throw new Error('fs.reorder cannot reorder notebook roots. Provide /<notebook name> or a parent document path.');
    }
    const denied = await ensurePermissionForNotebook(permMgr, scope.notebook, 'write');
    if (denied) return denied;

    const parentID = scope.type === 'document' ? scope.id : scope.notebook;
    const state = await readDocumentReorderState(client, scope.notebook, parentID, scope.storagePath);
    const { currentPaths, orderedPaths, orderedIDs } = resolveFsReorderOrder(state, scope.notebookName, parsed.orderedPaths);
    const result = await applyDocumentReorder(client, state, orderedIDs);
    const previousPaths = result.previousOrder.map((id) => currentPaths[state.children.findIndex((child) => child.id === id)]);
    return applyUiRefresh(client, createJsonResult({
        success: true,
        path: scope.canonicalPath,
        parentID,
        notebook: scope.notebook,
        changed: result.changed,
        orderChanged: result.orderChanged,
        sortModeChanged: result.sortModeChanged,
        previousOrder: previousPaths,
        order: orderedPaths,
    }), [{ type: 'reloadFiletree' }]);
};

const handleSearch: FsActionHandler = async ({ client, permMgr, rawArgs }) => {
    const parsed = FsSearchSchema.parse(rawArgs);
    assertNotVirtualRootFileDescendant(parsed.path);
    const matcher = createMatcher(parsed.query, parsed.regex, parsed.caseSensitive);
    const virtualPath = getVirtualRootFilePath(parsed.path);
    if (virtualPath === AGENT_MEMORY_VIRTUAL_PATH) {
        const memory = await readAgentMemoryState(client);
        const matches = collectVirtualTextMatches(memory.content, matcher, AGENT_MEMORY_VIRTUAL_PATH);
        const page = parsed.page ?? 1;
        const pageSize = parsed.pageSize ?? 50;
        const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
        const normalizedPage = Math.min(page, pageCount);
        const start = (normalizedPage - 1) * pageSize;
        return createPaginatedResult(matches.slice(start, start + pageSize), {
            total: matches.length,
            page: normalizedPage,
            pageSize,
            pageCount,
            hasNextPage: normalizedPage < pageCount,
        }, {
            path: AGENT_MEMORY_VIRTUAL_PATH,
            virtual: true,
            updatedAt: memory.updatedAt || null,
            query: parsed.query,
            regex: parsed.regex ?? false,
            caseSensitive: parsed.caseSensitive ?? false,
        });
    }
    if (virtualPath === USER_RULES_VIRTUAL_PATH) {
        const rules = await readUserRulesState(client);
        const matches = collectVirtualTextMatches(rules.content, matcher, USER_RULES_VIRTUAL_PATH);
        const page = parsed.page ?? 1;
        const pageSize = parsed.pageSize ?? 50;
        const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
        const normalizedPage = Math.min(page, pageCount);
        const start = (normalizedPage - 1) * pageSize;
        return createPaginatedResult(matches.slice(start, start + pageSize), {
            total: matches.length,
            page: normalizedPage,
            pageSize,
            pageCount,
            hasNextPage: normalizedPage < pageCount,
        }, {
            path: USER_RULES_VIRTUAL_PATH,
            virtual: true,
            query: parsed.query,
            regex: parsed.regex ?? false,
            caseSensitive: parsed.caseSensitive ?? false,
        });
    }
    const scope = await resolveFsScopePath(client, permMgr, parsed.path, 'read');
    if (scope.type !== 'root') {
        const denied = await ensurePermissionForNotebook(permMgr, scope.notebook, 'read');
        if (denied) return denied;
    }

    const docs = await collectSearchDocuments(client, permMgr, scope);
    const matches: Array<{ path: string; line: number; text: string }> = [];
    if (scope.type === 'root') {
        matches.push(...collectVirtualTextMatches((await readAgentMemoryState(client)).content, matcher, AGENT_MEMORY_VIRTUAL_PATH));
        matches.push(...collectVirtualTextMatches((await readUserRulesState(client)).content, matcher, USER_RULES_VIRTUAL_PATH));
    }
    for (const doc of docs) {
        const markdown = normalizeMarkdownContent(await fileApi.exportMdContent(client, doc.id));
        const content = typeof markdown.content === 'string' ? markdown.content : '';
        const hPath = typeof markdown.hPath === 'string' ? markdown.hPath : `/${doc.id}`;
        const path = `/${doc.notebookName}${hPath}`;
        content.split(/\r?\n/).forEach((line, index) => {
            if (matcher(line)) {
                matches.push({
                    path,
                    line: index + 1,
                    text: line.length > 300 ? `${line.slice(0, 297)}...` : line,
                });
            }
        });
    }
    const seenMatches = new Set<string>();
    const uniqueMatches = matches.filter((match) => {
        const key = `${match.path}\0${match.line}\0${match.text}`;
        if (seenMatches.has(key)) return false;
        seenMatches.add(key);
        return true;
    });

    const page = parsed.page ?? 1;
    const pageSize = parsed.pageSize ?? 50;
    const pageCount = Math.max(1, Math.ceil(uniqueMatches.length / pageSize));
    const normalizedPage = Math.min(page, pageCount);
    const start = (normalizedPage - 1) * pageSize;
    return createPaginatedResult(uniqueMatches.slice(start, start + pageSize), {
        total: uniqueMatches.length,
        page: normalizedPage,
        pageSize,
        pageCount,
        hasNextPage: normalizedPage < pageCount,
    }, {
        path: scope.canonicalPath,
        query: parsed.query,
        regex: parsed.regex ?? false,
        caseSensitive: parsed.caseSensitive ?? false,
    });
};

export const FS_ACTION_HANDLERS: Record<FsAction, FsActionHandler> = {
    ls: handleLs,
    tree: handleTree,
    read: handleRead,
    write: handleWrite,
    replace: handleReplace,
    rm: handleRm,
    mv: handleMv,
    reorder: handleReorder,
    search: handleSearch,
};
