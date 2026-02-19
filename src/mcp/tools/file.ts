import type { SiYuanClient } from '../../api/client';
import {
    UploadAssetSchema,
    RenderTemplateSchema,
    RenderSprigSchema,
    ExportMdContentSchema,
    ExportResourcesSchema,
    PushMsgSchema,
    PushErrMsgSchema,
    GetVersionSchema,
    GetCurrentTimeSchema,
} from '../../mcp/types';
import * as fileApi from '../../api/file';

const FILE_TOOLS = [
    { name: 'upload_asset', description: 'Upload a file asset to the specified assets directory', inputSchema: { type: 'object' as const, properties: { assetsDirPath: { type: 'string' }, file: { type: 'string' }, fileName: { type: 'string' } }, required: ['assetsDirPath', 'file', 'fileName'] } },
    { name: 'render_template', description: 'Render a template with document context', inputSchema: { type: 'object' as const, properties: { id: { type: 'string' }, path: { type: 'string' } }, required: ['id', 'path'] } },
    { name: 'render_sprig', description: 'Render a Sprig template', inputSchema: { type: 'object' as const, properties: { template: { type: 'string' } }, required: ['template'] } },
    { name: 'export_md_content', description: 'Export document content as Markdown', inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'export_resources', description: 'Export resources (files) as a ZIP archive', inputSchema: { type: 'object' as const, properties: { paths: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } }, required: ['paths'] } },
    { name: 'push_msg', description: 'Push a notification message', inputSchema: { type: 'object' as const, properties: { msg: { type: 'string' }, timeout: { type: 'number' } }, required: ['msg'] } },
    { name: 'push_err_msg', description: 'Push an error notification message', inputSchema: { type: 'object' as const, properties: { msg: { type: 'string' }, timeout: { type: 'number' } }, required: ['msg'] } },
    { name: 'get_version', description: 'Get the SiYuan system version', inputSchema: { type: 'object' as const, properties: {} } },
    { name: 'get_current_time', description: 'Get the current system time (Unix timestamp in milliseconds)', inputSchema: { type: 'object' as const, properties: {} } },
];

const FILE_NAMES = new Set(FILE_TOOLS.map((t) => t.name));

export function listFileTools() {
    return FILE_TOOLS;
}

export async function callFileTool(
    client: SiYuanClient,
    name: string,
    args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
    if (!FILE_NAMES.has(name)) return null;
    try {
        switch (name) {
            case 'upload_asset': {
                const parsed = UploadAssetSchema.parse(args);
                const base64Data = parsed.file;
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
                const byteArray = new Uint8Array(byteNumbers);
                const file = new File([byteArray], parsed.fileName);
                const result = await fileApi.uploadAsset(client, parsed.assetsDirPath, file, parsed.fileName);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'render_template': {
                const parsed = RenderTemplateSchema.parse(args);
                const result = await fileApi.renderTemplate(client, parsed.id, parsed.path);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'render_sprig': {
                const parsed = RenderSprigSchema.parse(args);
                const result = await fileApi.renderSprig(client, parsed.template);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'export_md_content': {
                const parsed = ExportMdContentSchema.parse(args);
                const result = await fileApi.exportMdContent(client, parsed.id);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'export_resources': {
                const parsed = ExportResourcesSchema.parse(args);
                const result = await fileApi.exportResources(client, parsed.paths, parsed.name);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'push_msg': {
                const parsed = PushMsgSchema.parse(args);
                const result = await fileApi.pushMsg(client, parsed.msg, parsed.timeout);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'push_err_msg': {
                const parsed = PushErrMsgSchema.parse(args);
                const result = await fileApi.pushErrMsg(client, parsed.msg, parsed.timeout);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'get_version': {
                GetVersionSchema.parse(args);
                const result = await fileApi.getVersion(client);
                return { content: [{ type: 'text', text: JSON.stringify({ version: result }, null, 2) }] };
            }
            case 'get_current_time': {
                GetCurrentTimeSchema.parse(args);
                const result = await fileApi.getCurrentTime(client);
                return { content: [{ type: 'text', text: JSON.stringify({ currentTime: result }, null, 2) }] };
            }
            default:
                return null;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error: ${errorMessage}` }], isError: true };
    }
}
