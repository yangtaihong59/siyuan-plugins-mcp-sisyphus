import { describe, expect, it } from 'vitest';

import { listHelpResourceTemplates, listHelpResources, readHelpResource } from '@/core/resources';

describe('core/resources', () => {
    it('lists static help resources and the action template', () => {
        const resources = listHelpResources();
        const templates = listHelpResourceTemplates();

        expect(resources.map((resource) => resource.uri)).toEqual(expect.arrayContaining([
            'siyuan://help/tool-overview',
            'siyuan://help/examples',
            'siyuan://help/document-path-semantics',
            'siyuan://help/ai-layout-guide',
            'siyuan://help/changelog',
            'siyuan://help/user-rules',
            'siyuan://skills/index',
            'siyuan://skills/siyuan-mcp-browse-read',
        ]));
        expect(resources.every((resource) => resource.mimeType === 'text/markdown')).toBe(true);
        expect(templates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                uriTemplate: 'siyuan://help/action/{tool}/{action}',
                mimeType: 'text/markdown',
            }),
            expect.objectContaining({
                uriTemplate: 'siyuan://skills/{name}',
                mimeType: 'text/markdown',
            }),
        ]));
    });

    it('lists and reads embedded scenario skills', () => {
        const index = readHelpResource('siyuan://skills/index');
        const skill = readHelpResource('siyuan://skills/siyuan-mcp-create-edit');

        expect(index?.text).toContain('# SiYuan MCP Skill Index');
        expect(index?.text).toContain('siyuan-mcp-create-edit');
        expect(skill?.text).toContain('name: siyuan-mcp-create-edit');
        expect(skill?.text).not.toContain('siyuan-sisyphus block');
        expect(readHelpResource('siyuan://skills/unknown')).toBeNull();
    });

    it('renders static and action help resources with parameter summaries', () => {
        const overview = readHelpResource('siyuan://help/tool-overview');
        const action = readHelpResource('siyuan://help/action/notebook/create');

        expect(overview).toEqual(expect.objectContaining({
            uri: 'siyuan://help/tool-overview',
            mimeType: 'text/markdown',
        }));
        expect(overview?.text).toContain('# SiYuan MCP Tool Overview');
        expect(overview?.text).toContain('Use `fs` first for basic path-style notebook and document operations');
        expect(overview?.text).toContain('fs(action="ls"|"tree"|"read"|"write"|"replace"|"search"|"rm"|"mv"|"reorder")');
        expect(readHelpResource('siyuan://help/changelog')?.text).toContain('AI upgrade review workflow');
        expect(action?.text).toContain('# notebook(action="create")');
        expect(action?.text).toContain('## Valid shapes');
        expect(action?.text).toContain('```json');
    });

    it('renders dynamic user rules resources with empty and configured states', () => {
        const empty = readHelpResource('siyuan://help/user-rules');
        const configured = readHelpResource('siyuan://help/user-rules', 'Rule one\n\nRule two');

        expect(empty?.text).toContain('No user custom rules are currently configured.');
        expect(empty?.text).toContain('- None');
        expect(configured?.text).toContain('- Rule one');
        expect(configured?.text).toContain('- Rule two');
        expect(configured?.text).toContain('do not override safety confirmation requirements');
    });

    it('returns null for unknown URIs and actions', () => {
        expect(readHelpResource('siyuan://help/action/unknown/list')).toBeNull();
        expect(readHelpResource('siyuan://help/action/notebook/unknown')).toBeNull();
        expect(readHelpResource('not a uri')).toBeNull();
    });
});
