import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('MCP App timeline diff source contract', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/mcp-apps/index.ts'), 'utf8');
    const appStyles = readFileSync(resolve(process.cwd(), 'src/mcp-apps/style.css'), 'utf8');

    it('uses the plugin-style compact unified diff instead of metric and change cards', () => {
        expect(appSource).toContain('timeline-diff-toolbar');
        expect(appSource).toContain('unified-diff-row removed');
        expect(appSource).toContain('unified-diff-row added');
        expect(appSource).not.toContain('summary-grid');
        expect(appSource).not.toContain('diff-card status-');
        expect(appStyles).toContain('.unified-diff-block');
    });

    it('keeps document and block rollback controls accessible', () => {
        expect(appSource).toContain('aria-label="整篇回退到历史版本"');
        expect(appSource).toContain('aria-label="还原块"');
        expect(appStyles).toContain('@media (hover: none)');
    });

    it('shows confirmation as a non-shifting, click-through status overlay', () => {
        expect(appSource).toContain('role="status" aria-live="polite" aria-atomic="true"');
        expect(appSource).toContain('再次点击“回滚整个文档”以确认。');
        expect(appSource).toContain('再次点击“恢复这个块”以确认。');
        expect(appSource).not.toContain('服务端仍会执行高风险操作确认');
        expect(appStyles).toMatch(/\.timeline-comparison > \.notice \{[\s\S]*?position: absolute;/);
        expect(appStyles).toMatch(/\.timeline-comparison > \.notice \{[\s\S]*?pointer-events: none;/);
    });

    it('routes human mutations through the App-only tool and gates every control', () => {
        expect(appSource.match(/callTool\('timeline_app_action'/g)).toHaveLength(6);
        expect(appSource).toContain("timelineAppCan('create_node')");
        expect(appSource).toContain("timelineAppCan('delete_node')");
        expect(appSource).toContain("timelineAppCan('rollback_document')");
        expect(appSource).toContain("timelineAppCan('rollback_block')");
        expect(appSource).toContain("io.siyuan-sisyphus/timeline-permissions");
    });

    it('omits the redundant app title header from both timeline screens', () => {
        expect(appSource).toMatch(/renderShell\([\s\S]*?'timeline'[\s\S]*?comparison \? 'timeline-comparison' : '',\s*false,/);
        expect(appSource).toContain('const header = showHeader ? `<header class="app-header">');
    });
});
