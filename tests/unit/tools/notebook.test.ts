import { describe, expect, it } from 'vitest';

import { buildDefaultToolConfig } from '@/core/config';
import { callNotebookTool, listNotebookTools, NOTEBOOK_VARIANTS } from '@/tools/notebook';

describe('notebook tool schemas', () => {
    it('derives nested and enum action variants from Zod schemas', () => {
        const setConf = NOTEBOOK_VARIANTS.find((variant) => variant.action === 'set_conf');
        const setPermission = NOTEBOOK_VARIANTS.find((variant) => variant.action === 'set_permission');
        const getChildDocs = NOTEBOOK_VARIANTS.find((variant) => variant.action === 'get_child_docs');

        expect(setConf?.schema.properties?.conf?.description).toBe('Notebook configuration');
        expect(setConf?.schema.properties?.conf?.properties?.dailyNoteSavePath?.type).toBe('string');
        expect(setPermission?.schema.properties?.permission?.enum).toEqual(['none', 'r', 'rw', 'rwd']);
        expect(setPermission?.schema.properties?.permission?.description).toContain('"rw" allows read and write');
        expect(getChildDocs?.schema.properties?.page?.type).toBe('integer');
        expect(getChildDocs?.schema.properties?.page?.exclusiveMinimum).toBe(0);
    });

    it('publishes typed notebook parameters plus strict internal branches', () => {
        const config = buildDefaultToolConfig().notebook;
        config.actions.set_permission = true;
        const [tool] = listNotebookTools(config);
        const schema = tool.inputSchema;
        const branches = schema['x-sisyphus-actionSchemas'];
        const createBranch = branches?.find((branch) => branch.properties?.action?.const === 'create');
        const setPermissionBranch = branches?.find((branch) => branch.properties?.action?.const === 'set_permission');

        expect(schema.properties?.name).toBeDefined();
        expect(schema.properties?.name?.type).toBe('string');
        expect(schema.properties?.opened?.type).toBe('boolean');
        expect(createBranch?.properties?.name?.description).toBe('Notebook name');
        expect(createBranch?.required).toEqual(['action', 'name']);
        expect(schema.properties?.permission?.type).toBe('string');
        expect(setPermissionBranch?.properties?.permission?.enum).toEqual(['none', 'r', 'rw', 'rwd']);
        expect(setPermissionBranch?.properties?.permission?.description).toContain('"rwd" allows read, write, and delete');
        expect(setPermissionBranch?.additionalProperties).toBe(false);
    });
});

describe('notebook.set_permission validation', () => {
    it('returns a concise tool validation error for unsupported permission values', async () => {
        const config = buildDefaultToolConfig().notebook;
        config.actions.set_permission = true;
        const result = await callNotebookTool(
            {} as never,
            { action: 'set_permission', notebook: '20260407011652-j218odq', permission: 'w' },
            config,
            {} as never,
        );
        const payload = JSON.parse(result.content[0].text);

        expect(result.isError).toBe(true);
        expect(payload.error.type).toBe('validation_error');
        expect(payload.error.message).toBe('Invalid arguments for notebook(action="set_permission").');
        expect(payload.error.fields[0].path).toBe('permission');
        expect(payload.error.fields[0].message).toBe('permission must be one of: "none", "r", "rw", "rwd".');
    });
});
