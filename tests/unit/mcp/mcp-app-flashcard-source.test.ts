import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('MCP App classic flashcard review source contract', () => {
    const appSource = readFileSync(resolve(process.cwd(), 'src/mcp-apps/index.ts'), 'utf8');
    const appStyles = readFileSync(resolve(process.cwd(), 'src/mcp-apps/style.css'), 'utf8');

    it('submits ratings only through the App-only action tool', () => {
        expect(appSource).toContain("callTool('flashcard_review_app_action'");
        expect(appSource).not.toContain("callTool('flashcard',");
    });

    it('does not invoke AI or create conversation turns while reviewing cards', () => {
        expect(appSource).not.toContain('createSamplingMessage');
        expect(appSource).not.toContain('updateModelContext');
        expect(appSource).not.toContain('data-form="flash-answer"');
        expect(appSource.match(/sendMessage/g)).toHaveLength(1);
    });

    it('writes ratings with cumulative reviewedCards and supports one explicit handoff', () => {
        expect(appSource).toContain('reviewedCards');
        expect(appSource).toContain("action: 'review_card'");
        expect(appSource).toContain('sendMessage');
        expect(appSource).toContain('所有等级都是我的主观自评');
        expect(appSource).toContain('第一条回复只问一个最有诊断价值的问题');
    });

    it('renders classic reveal, four ratings, and a session report', () => {
        expect(appSource).toContain('data-action="flash-reveal"');
        expect(appSource).toContain('让 AI 讲解本轮');
        expect(appSource).toContain("'', 'flashcard-compact'");
        expect(appStyles).toContain('.classic-card');
        expect(appStyles).toContain('.app-shell.flashcard-compact > .app-header { display: none; }');
        expect(appStyles).toContain('.rating-counts');
        expect(appStyles).toContain('.review-summary-list');
    });
});
