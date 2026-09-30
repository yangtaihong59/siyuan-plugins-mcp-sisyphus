import type { MascotAction } from '../../core/config';
import { readPuppyStats, spendPuppyBalance } from '../../core/puppy-state';
import {
    MascotBuySchema,
    MascotGetBalanceSchema,
    MascotShopSchema,
} from '../../core/types';
import type { ToolActionHandler } from '../internal/define-tool';
import { createJsonResult } from '../internal/shared';
import { getShopItem, SHOP_ITEMS } from './shop-items';

/*
 * Mascot handlers in a separate module keep the kernel goja bundle free of
 * the z.toJSONSchema variant construction in index.ts.
 */
export const MASCOT_ACTION_HANDLERS: Record<MascotAction, ToolActionHandler> = {
        get_balance: async ({ client, rawArgs }) => {
            MascotGetBalanceSchema.parse(rawArgs);
            const stats = await readPuppyStats(client);
            return createJsonResult({
                action: 'get_balance',
                balance: stats.balance,
                totalEarned: stats.totalCalls,
            });
        },
        shop: async ({ client, rawArgs }) => {
            MascotShopSchema.parse(rawArgs);
            const stats = await readPuppyStats(client);
            return createJsonResult({
                action: 'shop',
                balance: stats.balance,
                totalEarned: stats.totalCalls,
                items: SHOP_ITEMS,
            });
        },
        buy: async ({ client, rawArgs }) => {
            const parsed = MascotBuySchema.parse(rawArgs);
            const item = getShopItem(parsed.item_id);
            if (!item) {
                throw new Error(`Unknown mascot shop item: ${parsed.item_id}.`);
            }

            const stats = await spendPuppyBalance(client, item.cost, `buy:${item.id}`);
            return createJsonResult({
                success: true,
                action: 'buy',
                item_id: item.id,
                item: item.label,
                type: item.type,
                emoji: item.emoji,
                cost: item.cost,
                balance: stats.balance,
                totalEarned: stats.totalCalls,
            });
        },
};
