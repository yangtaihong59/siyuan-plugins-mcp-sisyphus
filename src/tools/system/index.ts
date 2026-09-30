import type { SiYuanClient } from '../../api/client';
import type { CategoryToolConfig, SystemAction } from '../../core/config';
import { SYSTEM_ACTION_HINTS, SYSTEM_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    SystemActionSchema,
    SystemChangelogSchema,
    SystemConfSchema,
    SystemGetCurrentTimeSchema,
    SystemGetVersionSchema,
    SystemNetworkSchema,
    SystemNotifySchema,
    SystemPerformSyncSchema,
    SystemWorkspaceInfoSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { SYSTEM_ACTION_HANDLERS } from './handlers';

export const SYSTEM_TOOL_NAME = 'system';

export const SYSTEM_VARIANTS: ActionVariant<SystemAction>[] = [
    createZodActionVariant('workspace_info', SystemWorkspaceInfoSchema, 'Get SiYuan workspace metadata. High-risk: exposes the absolute workspace path.'),
    createZodActionVariant('network', SystemNetworkSchema, 'Get current network proxy information.'),
    createZodActionVariant('conf', SystemConfSchema, 'Get masked system configuration with summary-first progressive reading.'),
    createZodActionVariant('notify', SystemNotifySchema, 'Push a notification message.'),
    createZodActionVariant('changelog', SystemChangelogSchema, 'Read the bundled plugin changelog with structured personalization-impact hints.'),
    createZodActionVariant('perform_sync', SystemPerformSyncSchema, 'Trigger SiYuan sync immediately. High-risk: affects local and remote sync state.'),
    createZodActionVariant('get_version', SystemGetVersionSchema, 'Get the SiYuan system version.'),
    createZodActionVariant('get_current_time', SystemGetCurrentTimeSchema, 'Get the current system time.'),
];

const systemTool = defineTool<SystemAction>({
    name: 'system',
    description: '🖥️ SiYuan system info and utilities: version, current time, network, masked config, notifications, plugin changelog, sync.',
    variants: SYSTEM_VARIANTS,
    actionSchema: SystemActionSchema,
    aggregateOptions: {
        guidance: SYSTEM_GUIDANCE,
        actionHints: SYSTEM_ACTION_HINTS,
    },
    handlers: SYSTEM_ACTION_HANDLERS,
});

export function listSystemTools(config: CategoryToolConfig<SystemAction>) {
    return systemTool.listTools(config);
}

export function callSystemTool(
    client: SiYuanClient,
    args: Record<string, unknown> | undefined,
    config: CategoryToolConfig<SystemAction>,
    _permMgr: PermissionManager,
): Promise<ToolResult> {
    return systemTool.callTool(client, args, config, _permMgr);
}
