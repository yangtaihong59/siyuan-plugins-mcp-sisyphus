import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('MCP App mascot shop source contract', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/mcp-apps/index.ts'), 'utf8');
    const appStyles = readFileSync(resolve(process.cwd(), 'src/mcp-apps/style.css'), 'utf8');

    it('does not overwrite the buy event with an immediate balance lookup', () => {
        expect(appSource).not.toMatch(
            /callTool\('mascot', \{ action: 'buy',[\s\S]{0,240}callTool\('mascot', \{ action: 'get_balance'/,
        );
    });

    it('refreshes the shop with one shop action instead of opening a second app for balance', () => {
        expect(appSource).toMatch(
            /async function refreshShop\(\) \{\s*await callTool\('mascot_shop_app_action', \{ action: 'shop' \}\);\s*\}/,
        );
        expect(appSource).not.toMatch(
            /async function refreshShop\(\)[\s\S]{0,180}action: 'get_balance'/,
        );
        expect(appSource).not.toContain("callTool('mascot',");
    });

    it('queues large purchased items in the pickup slot until collection', () => {
        expect(appSource).toContain('vending-pending-item');
        expect(appSource).toContain('shopState.pendingItems.push(item)');
        expect(appSource).toContain('data-action="shop-pickup-item"');
        expect(appSource).toContain('件，取走喂给猫猫吧');
        expect(appSource).toContain('点击商品取走 · PICK UP');
        expect(appSource).not.toContain('取走全部');
        expect(appStyles).toContain('@keyframes vending-dispense');
        expect(appStyles).toContain('font-size: 46px');
    });

    it('animates only the newly dispensed item, not the next item exposed after pickup', () => {
        expect(appSource).toContain('renderShop(shopState.pendingItems.length - 1)');
        expect(appSource).toContain("index === dispensingIndex ? ' is-dispensing' : ''");
        expect(appStyles).toContain('.vending-pending-item.is-dispensing > span');
        expect(appStyles).not.toContain('.vending-pending-item:last-child > span');
    });

    it('defers each mascot buy call until the matching queued item is clicked', () => {
        expect(appSource).toMatch(/case 'shop-buy':\s*queueShopItem/);
        expect(appSource).toMatch(/case 'shop-pickup-item':\s*await collectShopItem\(Number\(data\.pendingIndex\)\)/);
        expect(appSource).toMatch(/async function collectShopItem\(index: number\)[\s\S]*await buyItem/);
        expect(appSource).not.toContain('collectShopItems');
    });

    it('renders an automated vending machine without a shopkeeper character', () => {
        expect(appSource).toContain('vending-machine');
        expect(appSource).toContain('vending-console');
        expect(appSource).toContain('aria-label="自动售货机商品货道"');
        expect(appSource).not.toContain('pixel-shopkeeper');
        expect(appStyles).toContain('.vending-machine');
        expect(appStyles).toContain('.vending-grid');
    });
});
