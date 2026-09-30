/*
 * Shared shop catalog. Kept in its own module so both the schema-bearing
 * index.ts and the goja-safe handlers.ts can read it without circularity.
 */
export const SHOP_ITEMS = [
    { id: 'cat-food', label: 'Cat Food', cost: 5, type: 'food', emoji: '🍖' },
    { id: 'milk', label: 'Milk', cost: 3, type: 'drink', emoji: '🥛' },
    { id: 'dried-fish', label: 'Dried Fish', cost: 4, type: 'food', emoji: '🐟' },
    { id: 'can-food', label: 'Canned Food', cost: 6, type: 'food', emoji: '🥫' },
    { id: 'catnip', label: 'Catnip', cost: 5, type: 'snack', emoji: '🌿' },
    { id: 'chicken-leg', label: 'Chicken Leg', cost: 7, type: 'food', emoji: '🍗' },
    { id: 'cheese', label: 'Cheese', cost: 4, type: 'snack', emoji: '🧀' },
] as const;
export const FOOD_ITEM = SHOP_ITEMS[0];
export const DRINK_ITEM = SHOP_ITEMS[1];

export function getShopItem(itemId: string) {
    return SHOP_ITEMS.find((item) => item.id === itemId) ?? null;
}
