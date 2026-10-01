import type { SiYuanClient } from '../../api/client';
import type { CategoryToolConfig, MascotAction } from '../../core/config';
import { MASCOT_ACTION_HINTS, MASCOT_GUIDANCE } from '../../core/help';
import type { PermissionManager } from '../../core/permissions';
import {
    MascotActionSchema,
    MascotBuySchema,
    MascotGetBalanceSchema,
    MascotShopSchema,
} from '../../core/types';
import { defineTool } from '../internal/define-tool';
import { createZodActionVariant, type ActionVariant, type ToolResult } from '../internal/shared';
import { MASCOT_ACTION_HANDLERS } from './handlers';

// Re-exported for tests and the kernel bundle (which must not load the
// schema-variant path — z.toJSONSchema hangs the goja sandbox).
export { MASCOT_ACTION_HANDLERS } from './handlers';

export const MASCOT_TOOL_NAME = 'mascot';
export { SHOP_ITEMS, FOOD_ITEM, DRINK_ITEM, getShopItem } from './shop-items';

export const MASCOT_VARIANTS: ActionVariant<MascotAction>[] = [
    createZodActionVariant('get_balance', MascotGetBalanceSchema, 'Get the mascot balance. Every successful MCP tool call earns 1 coin.'),
    createZodActionVariant('shop', MascotShopSchema, 'List the mascot shop inventory.'),
    createZodActionVariant('buy', MascotBuySchema, 'Buy one item from the mascot shop.'),
];

const mascotTool = defineTool<MascotAction>({
    name: 'mascot',
    description: '🐾 Mascot coin balance, shop, and purchases. Every successful MCP call earns 1 coin.',
    variants: MASCOT_VARIANTS,
    actionSchema: MascotActionSchema,
    aggregateOptions: {
        guidance: MASCOT_GUIDANCE,
        actionHints: MASCOT_ACTION_HINTS,
    },
    handlers: MASCOT_ACTION_HANDLERS,
});

export function listMascotTools(config: CategoryToolConfig<MascotAction>) {
    return mascotTool.listTools(config);
}

export async function callMascotTool(
    client: SiYuanClient,
    args: Record<string, unknown> | undefined,
    config: CategoryToolConfig<MascotAction>,
    _permMgr: PermissionManager,
): Promise<ToolResult> {
    return mascotTool.callTool(client, args, config, _permMgr);
}
