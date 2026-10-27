import { z } from "zod";
import { MASCOT_ACTIONS } from "../../core/config";

export const MascotActionSchema = z.enum(MASCOT_ACTIONS);

export const MascotGetBalanceSchema = z.object({
    action: z.literal("get_balance"),
});

export const MascotShopSchema = z.object({
    action: z.literal("shop"),
});

export const MascotBuySchema = z.object({
    action: z.literal("buy"),
    item_id: z.string().describe("Stable shop item ID returned by mascot(action=\"shop\")"),
});
