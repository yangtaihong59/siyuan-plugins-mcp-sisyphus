import { describe, expect, it } from 'vitest';

import {
    buildChangedFiles,
    diffBlocks,
    diffSnapshotBlocks,
    getDocumentIdFromSnapshotFile,
    getBlockDiffLineStats,
    getRestoreBlockPayload,
    getRestoreInsertPlan,
    getRestoreParentCandidates,
    getSnapshotFileId,
    getUpdateBlockPayload,
    parseSnapshotBlocks,
} from '@/shared/version-control/block-diff';

describe('snapshot block diff', () => {
    it('parses JSON snapshot blocks recursively', () => {
        const blocks = parseSnapshotBlocks(JSON.stringify({
            id: '20260514120000-aaaaaaa',
            type: 'd',
            title: 'Doc',
            children: [
                { id: '20260514120001-bbbbbbb', rootID: '20260514120000-aaaaaaa', type: 'h', markdown: '# Title' },
                { id: '20260514120002-ccccccc', rootID: '20260514120000-aaaaaaa', parentID: '20260514120001-bbbbbbb', type: 'p', content: 'Body' },
            ],
        }));

        expect(blocks.map((block) => block.id)).toEqual([
            '20260514120000-aaaaaaa',
            '20260514120001-bbbbbbb',
            '20260514120002-ccccccc',
        ]);
        expect(blocks[2].text).toBe('Body');
        expect(blocks[2].rootID).toBe('20260514120000-aaaaaaa');
        expect(blocks[2].parentID).toBe('20260514120001-bbbbbbb');
    });

    it('reconstructs markdown for JSON code blocks with language and body fields', () => {
        const blocks = parseSnapshotBlocks(JSON.stringify({
            children: [
                {
                    id: '20260514120001-bbbbbbb',
                    type: 'c',
                    content: 'python',
                    fcontent: 'print("hello")',
                },
            ],
        }));

        expect(blocks[0]).toMatchObject({
            text: 'print("hello")',
            markdown: '```python\nprint("hello")\n```',
        });
    });

    it('reconstructs code and formula bodies from nested snapshot fields', () => {
        const blocks = parseSnapshotBlocks(JSON.stringify({
            children: [
                {
                    id: 'nested-code',
                    type: 'c',
                    content: 'python',
                    children: [
                        { text: 'def answer():' },
                        { text: '    return 42' },
                    ],
                },
                {
                    id: 'nested-math',
                    type: 'm',
                    content: {
                        lines: [
                            { text: 'a + b = \\phi' },
                        ],
                    },
                },
            ],
        }));

        expect(blocks[0].markdown).toBe('```python\ndef answer():\n    return 42\n```');
        expect(blocks[1].markdown).toBe('$$\na + b = \\phi\n$$');
    });

    it('reconstructs markdown for formulas and list items', () => {
        const blocks = parseSnapshotBlocks(JSON.stringify({
            children: [
                { id: 'math', type: 'm', content: 'a + b = \\phi' },
                { id: 'bullet', type: 'i', subtype: 'u', content: 'plain bullet' },
                { id: 'task', type: 'i', subtype: 'task', checked: false, content: 'todo item' },
                { id: 'done', type: 'i', subtype: 'task', checked: true, content: 'done item' },
                { id: 'ordered', type: 'i', subtype: 'o', marker: '3', content: 'ordered item' },
            ],
        }));

        expect(blocks.map((block) => block.markdown)).toEqual([
            '$$\na + b = \\phi\n$$',
            '- plain bullet',
            '- [ ] todo item',
            '- [x] done item',
            '3. ordered item',
        ]);
    });

    it('reconstructs markdown for headings and blockquotes', () => {
        const blocks = parseSnapshotBlocks(JSON.stringify({
            children: [
                { id: 'heading', type: 'h', subtype: 'h3', content: 'Section' },
                { id: 'quote', type: 'b', content: 'first line\nsecond line' },
            ],
        }));

        expect(blocks.map((block) => block.markdown)).toEqual([
            '### Section',
            '> first line\n> second line',
        ]);
    });

    it('keeps explicit markdown and kramdown without wrapping them again', () => {
        const blocks = parseSnapshotBlocks(JSON.stringify({
            children: [
                { id: 'explicit-code', type: 'c', content: 'python', markdown: '```python\nprint("kept")\n```' },
                { id: 'explicit-task', type: 'i', subtype: 'task', content: 'todo', kramdown: '- [ ] already markdown' },
            ],
        }));

        expect(blocks.map((block) => block.markdown)).toEqual([
            '```python\nprint("kept")\n```',
            '- [ ] already markdown',
        ]);
    });

    it('classifies added, removed, modified, and unchanged blocks', () => {
        const entries = diffBlocks(
            [
                { id: 'a', type: 'p', text: 'same', markdown: 'same', order: 0, depth: 0 },
                { id: 'b', type: 'p', text: 'old', markdown: 'old', order: 1, depth: 0 },
                { id: 'c', type: 'p', text: 'gone', markdown: 'gone', order: 2, depth: 0 },
            ],
            [
                { id: 'a', type: 'p', text: 'same', markdown: 'same', order: 0, depth: 0 },
                { id: 'b', type: 'p', text: 'new', markdown: 'new', order: 1, depth: 0 },
                { id: 'd', type: 'p', text: 'added', markdown: 'added', order: 2, depth: 0 },
            ],
        );

        expect(entries.map((entry) => entry.status)).toEqual(['unchanged', 'modified', 'removed', 'added']);
        expect(entries.filter((entry) => entry.status !== 'unchanged').every((entry) => entry.canAcceptBlock)).toBe(true);
    });

    it('falls back to markdown paragraph parsing', () => {
        const entries = diffSnapshotBlocks('A paragraph\n\nOld paragraph', 'A paragraph\n\nNew paragraph');

        expect(entries.some((entry) => entry.status === 'unchanged')).toBe(true);
        expect(entries.some((entry) => entry.status === 'modified')).toBe(true);
    });

    it('keeps fenced code, math, tables, and lists intact when parsing markdown snapshots', () => {
        const blocks = parseSnapshotBlocks([
            '### 演示 Go 代码高亮',
            '',
            '```go',
            'package main',
            '',
            'import "fmt"',
            '',
            'func main() {',
            '\tfmt.Println("Hello, 世界")',
            '}',
            '```',
            '',
            '$$',
            '\\frac{1}{',
            '  \\sqrt{5}',
            '}',
            '$$',
            '',
            '|header 1|header 2|',
            '| ----------| ----------|',
            '|cell 1|cell 2|',
            '',
            '- [X] 发布思源',
            '- [ ] 预约牙医',
        ].join('\n'));

        expect(blocks.map((block) => block.markdown)).toEqual([
            '### 演示 Go 代码高亮',
            '```go\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, 世界")\n}\n```',
            '$$\n\\frac{1}{\n  \\sqrt{5}\n}\n$$',
            '|header 1|header 2|\n| ----------| ----------|\n|cell 1|cell 2|',
            '- [X] 发布思源',
            '- [ ] 预约牙医',
        ]);
    });

    it('splits adjacent top-level list items while keeping nested content with its parent item', () => {
        const blocks = parseSnapshotBlocks([
            '- 图片',
            '  可通过复制粘贴或拖拽来上传图片；上传后的图片可通过拖拽进行大小调整。',
            '  ![](assets/demo.png)',
            '- 加粗',
            '- 倾斜',
            '  - 嵌套项',
            '    嵌套说明',
            '- 下划线',
        ].join('\n'));

        expect(blocks.map((block) => block.markdown)).toEqual([
            '- 图片\n  可通过复制粘贴或拖拽来上传图片；上传后的图片可通过拖拽进行大小调整。\n  ![](assets/demo.png)',
            '- 加粗',
            '- 倾斜\n  - 嵌套项\n    嵌套说明',
            '- 下划线',
        ]);
    });

    it('builds fine-grained inline parts for Chinese modified blocks', () => {
        const [entry] = diffBlocks(
            [{ id: 'a', type: 'p', text: '这个块里的几个字删掉了', markdown: '这个块里的几个字删掉了', order: 0, depth: 0 }],
            [{ id: 'a', type: 'p', text: '这个块里新增了几个字', markdown: '这个块里新增了几个字', order: 0, depth: 0 }],
        );

        expect(entry.status).toBe('modified');
        expect(entry.oldParts?.filter((part) => part.kind === 'removed').map((part) => part.text)).toEqual(['的', '删掉了']);
        expect(entry.newParts?.filter((part) => part.kind === 'added').map((part) => part.text)).toEqual(['新增了']);
    });

    it('keeps English and numeric inline diffs focused on changed fragments', () => {
        const [entry] = diffBlocks(
            [{ id: 'a', type: 'p', text: 'version 0.3.7', markdown: 'version 0.3.7', order: 0, depth: 0 }],
            [{ id: 'a', type: 'p', text: 'version 0.3.8', markdown: 'version 0.3.8', order: 0, depth: 0 }],
        );

        expect(entry.oldParts).toEqual([
            { text: 'version 0.3.', kind: 'same' },
            { text: '7', kind: 'removed' },
        ]);
        expect(entry.newParts).toEqual([
            { text: 'version 0.3.', kind: 'same' },
            { text: '8', kind: 'added' },
        ]);
    });

    it('preserves Markdown punctuation while highlighting changed Chinese content', () => {
        const [entry] = diffBlocks(
            [{ id: 'a', type: 'p', text: '旧内容', markdown: '**旧内容**', order: 0, depth: 0 }],
            [{ id: 'a', type: 'p', text: '新内容', markdown: '**新内容**', order: 0, depth: 0 }],
        );

        expect(entry.oldParts).toEqual([
            { text: '**', kind: 'same' },
            { text: '旧', kind: 'removed' },
            { text: '内容**', kind: 'same' },
        ]);
        expect(entry.newParts).toEqual([
            { text: '**', kind: 'same' },
            { text: '新', kind: 'added' },
            { text: '内容**', kind: 'same' },
        ]);
    });

    it('does not create inline parts for unchanged, added, or removed blocks', () => {
        const entries = diffBlocks(
            [
                { id: 'same', type: 'p', text: 'same', markdown: 'same', order: 0, depth: 0 },
                { id: 'removed', type: 'p', text: 'removed', markdown: 'removed', order: 1, depth: 0 },
            ],
            [
                { id: 'same', type: 'p', text: 'same', markdown: 'same', order: 0, depth: 0 },
                { id: 'added', type: 'p', text: 'added', markdown: 'added', order: 1, depth: 0 },
            ],
        );

        for (const entry of entries.filter((item) => item.status !== 'modified')) {
            expect(entry.oldParts).toBeUndefined();
            expect(entry.newParts).toBeUndefined();
        }
    });

    it('summarizes changed lines for added, removed, modified, and unchanged blocks', () => {
        const entries = diffBlocks(
            [
                { id: 'same', type: 'p', text: 'same', markdown: 'same', order: 0, depth: 0 },
                { id: 'removed', type: 'p', text: 'old A\nold B', markdown: 'old A\nold B', order: 1, depth: 0 },
                { id: 'modified', type: 'p', text: 'version 0.3.7', markdown: 'version 0.3.7', order: 2, depth: 0 },
            ],
            [
                { id: 'same', type: 'p', text: 'same', markdown: 'same', order: 0, depth: 0 },
                { id: 'modified', type: 'p', text: 'version 0.3.8', markdown: 'version 0.3.8', order: 1, depth: 0 },
                { id: 'added', type: 'p', text: 'new A\nnew B\nnew C', markdown: 'new A\nnew B\nnew C', order: 2, depth: 0 },
            ],
        );

        expect(getBlockDiffLineStats(entries)).toEqual({ added: 4, removed: 3 });
    });

    it('counts multi-line modified code block changes by touched lines', () => {
        const [entry] = diffBlocks(
            [{
                id: 'code',
                type: 'c',
                text: 'const a = 1;\nconst b = 2;\nconst c = 3;',
                markdown: '```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```',
                order: 0,
                depth: 0,
            }],
            [{
                id: 'code',
                type: 'c',
                text: 'const a = 1;\nconst b = 20;\nconst c = 30;',
                markdown: '```ts\nconst a = 1;\nconst b = 20;\nconst c = 30;\n```',
                order: 0,
                depth: 0,
            }],
        );

        expect(entry.status).toBe('modified');
        expect(getBlockDiffLineStats([entry])).toEqual({ added: 2, removed: 2 });
    });

    it('parses SiYuan block DOM into displayable blocks', () => {
        const blocks = parseSnapshotBlocks(`
            <div data-node-id="20260514120003-ddddddd" data-type="NodeParagraph">Old <strong>text</strong></div>
            <div data-node-id="20260514120004-eeeeeee" data-type="NodeHeading" data-subtype="h2" data-root-id="20260514120000-aaaaaaa" data-parent-id="20260514120003-ddddddd">Heading</div>
        `);

        expect(blocks).toMatchObject([
            { id: '20260514120003-ddddddd', type: 'p', text: 'Old text' },
            { id: '20260514120004-eeeeeee', type: 'h', subtype: 'h2', rootID: '20260514120000-aaaaaaa', parentID: '20260514120003-ddddddd', text: 'Heading' },
        ]);
    });

    it('lightly reconstructs markdown for SiYuan special block DOM', () => {
        const blocks = parseSnapshotBlocks(`
            <div data-node-id="20260514120006-ggggggg" data-type="NodeCodeBlock" data-subtype="python">print(&quot;hello&quot;)</div>
            <div data-node-id="20260514120007-hhhhhhh" data-type="NodeMathBlock">a + b = \\phi</div>
            <div data-node-id="20260514120008-iiiiiii" data-type="NodeListItem" data-subtype="task">todo from dom</div>
        `);

        expect(blocks.map((block) => block.markdown)).toEqual([
            '```python\nprint("hello")\n```',
            '$$\na + b = \\phi\n$$',
            '- [ ] todo from dom',
        ]);
    });

    it('parses SiYuan list DOM as separate list items instead of one merged list block', () => {
        const blocks = parseSnapshotBlocks(`
            <div data-node-id="list-root" data-type="NodeList" data-subtype="u">
                <div data-node-id="item-a" data-type="NodeListItem" data-subtype="u">块级引用</div>
                <div data-node-id="item-b" data-type="NodeListItem" data-subtype="u">外部链接</div>
                <div data-node-id="item-c" data-type="NodeListItem" data-subtype="u">插入图片</div>
            </div>
        `);

        expect(blocks.map((block) => block.id)).toEqual(['item-a', 'item-b', 'item-c']);
        expect(blocks.map((block) => block.markdown)).toEqual([
            '- 块级引用',
            '- 外部链接',
            '- 插入图片',
        ]);
    });

    it('preserves inline styles, links, and images when parsing ordinary DOM blocks', () => {
        const blocks = parseSnapshotBlocks(`
            <div data-node-id="item-rich" data-type="NodeListItem" data-subtype="u">
                <strong>加粗</strong><em>斜体</em><s>中划线</s><u>下划线</u><mark>标记</mark>
                <a href="https://example.com">超链接</a><img src="assets/demo.png" alt="图片">
                <span data-type="strong em">组合</span><span data-type="a" data-href="siyuan://blocks/20260515101010-abcdefg">块引用</span>
            </div>
        `);

        expect(blocks[0].markdown).toBe('- **加粗***斜体*~~中划线~~<u>下划线</u>==标记==\n                [超链接](https://example.com)![图片](assets/demo.png)\n                ***组合***[块引用](siyuan://blocks/20260515101010-abcdefg)');
        expect(getUpdateBlockPayload({
            key: 'modified-rich',
            status: 'modified',
            canAcceptBlock: true,
            oldBlock: blocks[0],
            newBlock: {
                id: 'item-rich-current',
                type: 'i',
                text: 'changed',
                markdown: '- changed',
                order: 0,
                depth: 0,
            },
        }).data).toContain('[超链接](https://example.com)![图片](assets/demo.png)');
    });

    it('reads SiYuan code block DOM from data-content instead of the language toolbar', () => {
        const blocks = parseSnapshotBlocks(`
            <div data-node-id="20260514120009-jjjjjjj" data-type="NodeCodeBlock" class="render-node" data-subtype="go" data-content="package main&#10;&#10;import &quot;fmt&quot;&#10;&#10;func main() {&#10;    fmt.Println(&quot;Hello&quot;)&#10;}">
                <div spin="1"></div>
                <div class="protyle-attr" contenteditable="false">​</div>
            </div>
            <div data-node-id="20260514120010-kkkkkkk" data-type="NodeCodeBlock" class="code-block">
                <div class="protyle-action"><span class="protyle-action__language" contenteditable="false">java</span></div>
                <div class="hljs"><div></div><div contenteditable="true" spellcheck="false">public class Hello {}</div></div>
            </div>
        `);

        expect(blocks.map((block) => block.markdown)).toEqual([
            '```go\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello")\n}\n```',
            '```java\npublic class Hello {}\n```',
        ]);
    });

    it('keeps generic HTML DOM blocks visible in timeline diffs', () => {
        const blocks = parseSnapshotBlocks(`
            <div data-node-id="iframe-block" data-type="NodeIFrame">
                <iframe src="https://player.bilibili.com/player.html?bvid=BV1ov41187qM&amp;page=1"></iframe>
            </div>
            <div data-node-id="video-block" data-type="NodeVideo" data-src="assets/formatting_elements.mp4"></div>
            <div data-node-id="audio-block" data-type="NodeAudio">
                <audio controls="controls" src="assets/record.wav"></audio>
            </div>
            <div data-node-id="html-block" data-type="NodeHTMLBlock"><section><strong>Custom</strong> HTML</section></div>
        `);

        expect(blocks).toMatchObject([
            { id: 'iframe-block', type: 'html', text: 'https://player.bilibili.com/player.html?bvid=BV1ov41187qM&page=1' },
            { id: 'video-block', type: 'html', text: 'assets/formatting_elements.mp4' },
            { id: 'audio-block', type: 'html', text: 'assets/record.wav' },
            { id: 'html-block', type: 'html', text: 'Custom HTML' },
        ]);
        expect(blocks.map((block) => block.markdown)).toEqual([
            '<iframe src="https://player.bilibili.com/player.html?bvid=BV1ov41187qM&page=1"></iframe>',
            '<div data-node-id="video-block" data-type="NodeVideo" data-src="assets/formatting_elements.mp4"></div>',
            '<audio controls="controls" src="assets/record.wav"></audio>',
            '<section><strong>Custom</strong> HTML</section>',
        ]);
    });

    it('keeps standalone HTML markdown blocks visible', () => {
        const blocks = parseSnapshotBlocks([
            '<iframe src="https://player.bilibili.com/player.html?bvid=BV1ov41187qM&amp;page=1"></iframe>',
            '',
            '<video controls="controls" src="assets/formatting_elements.mp4"></video>',
            '',
            '<audio controls="controls" src="assets/record.wav"></audio>',
            '',
            '<details><summary>More</summary><p>Custom HTML</p></details>',
        ].join('\n'));

        expect(blocks.map((block) => block.type)).toEqual(['html', 'html', 'html', 'html']);
        expect(blocks.map((block) => block.text)).toEqual([
            'https://player.bilibili.com/player.html?bvid=BV1ov41187qM&page=1',
            'assets/formatting_elements.mp4',
            'assets/record.wav',
            'MoreCustom HTML',
        ]);
        expect(blocks.map((block) => block.markdown)).toEqual([
            '<iframe src="https://player.bilibili.com/player.html?bvid=BV1ov41187qM&amp;page=1"></iframe>',
            '<video controls="controls" src="assets/formatting_elements.mp4"></video>',
            '<audio controls="controls" src="assets/record.wav"></audio>',
            '<details><summary>More</summary><p>Custom HTML</p></details>',
        ]);
    });

    it('restores removed ordinary DOM blocks as markdown with their original block id', () => {
        const [oldBlock] = parseSnapshotBlocks(`
            <div data-node-id="20260514120003-ddddddd" data-type="NodeParagraph">Old <strong>text</strong></div>
        `);

        expect(getRestoreBlockPayload({
            key: 'removed',
            status: 'removed',
            canAcceptBlock: true,
            oldBlock,
        })).toEqual({
            dataType: 'markdown',
            data: 'Old **text**\n{: id="20260514120003-ddddddd"}',
            id: '20260514120003-ddddddd',
        });
    });

    it('updates ordinary DOM-backed blocks as markdown instead of writing raw protyle HTML', () => {
        expect(getUpdateBlockPayload({
            key: 'modified-protyle',
            status: 'modified',
            canAcceptBlock: true,
            oldBlock: {
                id: 'old-paragraph',
                type: 'p',
                text: '可通过复制粘贴或拖拽上传图片',
                markdown: '可通过复制粘贴或拖拽上传图片',
                raw: '<div data-node-id="old-paragraph" data-type="NodeParagraph"><protyle-html>可通过复制粘贴或拖拽上传图片</protyle-html></div>',
                order: 0,
                depth: 0,
            },
            newBlock: {
                id: 'new-paragraph',
                type: 'p',
                text: 'changed',
                markdown: 'changed',
                order: 0,
                depth: 0,
            },
        })).toEqual({
            dataType: 'markdown',
            data: '可通过复制粘贴或拖拽上传图片',
            id: 'old-paragraph',
        });
    });

    it('adds an id IAL when restoring removed markdown blocks without raw DOM', () => {
        expect(getRestoreBlockPayload({
            key: 'removed',
            status: 'removed',
            canAcceptBlock: true,
            oldBlock: {
                id: '20260514120005-fffffff',
                type: 'p',
                text: 'Gone',
                markdown: '**Gone**',
                order: 0,
                depth: 0,
            },
        })).toEqual({
            dataType: 'markdown',
            data: '**Gone**\n{: id="20260514120005-fffffff"}',
            id: '20260514120005-fffffff',
        });
    });

    it('updates existing code and math blocks with inner content only', () => {
        expect(getUpdateBlockPayload({
            key: 'modified-code',
            status: 'modified',
            canAcceptBlock: true,
            oldBlock: {
                id: 'code-old',
                type: 'c',
                text: 'package main',
                markdown: '```go\npackage main\n\nimport "fmt"\n```',
                order: 0,
                depth: 0,
            },
            newBlock: {
                id: 'code-new',
                type: 'c',
                text: 'gopackage main',
                markdown: '```\ngopackage main\n```',
                order: 0,
                depth: 0,
            },
        })).toEqual({
            dataType: 'markdown',
            data: 'package main\n\nimport "fmt"',
            id: 'code-old',
        });

        expect(getUpdateBlockPayload({
            key: 'modified-math',
            status: 'modified',
            canAcceptBlock: true,
            oldBlock: {
                id: 'math-old',
                type: 'm',
                text: 'a + b',
                markdown: '$$\na + b = \\phi\n$$',
                order: 0,
                depth: 0,
            },
        })).toEqual({
            dataType: 'markdown',
            data: 'a + b = \\phi',
            id: 'math-old',
        });
    });

    it('updates existing DOM-backed code blocks with DOM to preserve renderer language', () => {
        expect(getUpdateBlockPayload({
            key: 'modified-chart',
            status: 'modified',
            canAcceptBlock: true,
            oldBlock: {
                id: 'old-chart',
                type: 'c',
                subtype: 'echarts',
                text: '{ "title": {} }',
                markdown: '```echarts\n{ "title": {} }\n```',
                raw: '<div data-node-id="old-chart" data-type="NodeCodeBlock" data-subtype="echarts" data-content="{ &quot;title&quot;: {} }"></div>',
                order: 0,
                depth: 0,
            },
            newBlock: {
                id: 'new-chart',
                type: 'c',
                subtype: '',
                text: '{ "title": {} }',
                markdown: '{ "title": {} }',
                order: 0,
                depth: 0,
            },
        })).toEqual({
            dataType: 'dom',
            data: '<div data-node-id="new-chart" data-type="NodeCodeBlock" data-subtype="echarts" data-content="{ &quot;title&quot;: {} }"></div>',
            id: 'new-chart',
        });
    });

    it('allows math blocks to be restored at block level', () => {
        const [entry] = diffBlocks(
            [{ id: 'math', type: 'm', text: 'old', markdown: '$$\nold\n$$', order: 0, depth: 0 }],
            [{ id: 'math', type: 'm', text: 'new', markdown: '$$\nnew\n$$', order: 0, depth: 0 }],
        );

        expect(entry.status).toBe('modified');
        expect(entry.canAcceptBlock).toBe(true);
        expect(entry.acceptReason).toBeUndefined();
    });

    it('allows ordered and unordered list containers to be restored at block level', () => {
        const entries = diffBlocks(
            [
                { id: 'unordered', type: 'l', subtype: 'u', text: 'old bullet', markdown: '- old bullet', order: 0, depth: 0 },
                { id: 'ordered', type: 'l', subtype: 'o', text: 'old ordered', markdown: '1. old ordered', order: 1, depth: 0 },
            ],
            [
                { id: 'unordered', type: 'l', subtype: 'u', text: 'new bullet', markdown: '- new bullet', order: 0, depth: 0 },
                { id: 'ordered', type: 'l', subtype: 'o', text: 'new ordered', markdown: '1. new ordered', order: 1, depth: 0 },
            ],
        );

        expect(entries).toHaveLength(2);
        expect(entries.every((entry) => entry.canAcceptBlock)).toBe(true);
        expect(entries.every((entry) => entry.acceptReason === undefined)).toBe(true);
    });

    it('builds restore parent candidates from block metadata before file fallback', () => {
        const candidates = getRestoreParentCandidates({
            key: 'removed',
            status: 'removed',
            canAcceptBlock: true,
            oldBlock: {
                id: '20260514120005-fffffff',
                parentID: '20260514120003-ddddddd',
                rootID: '20260514120000-aaaaaaa',
                type: 'p',
                text: 'Gone',
                markdown: 'Gone',
                order: 0,
                depth: 0,
            },
        }, {
            documentId: '20260514120009-iiiiiii',
            oldFile: { path: '/box/path/20260514120008-hhhhhhh.sy' },
        });

        expect(candidates).toEqual([
            '20260514120003-ddddddd',
            '20260514120000-aaaaaaa',
            '20260514120009-iiiiiii',
            '20260514120008-hhhhhhh',
        ]);
    });

    it('anchors removed block restoration before the nearest following current sibling', () => {
        const entries = diffBlocks(
            [
                { id: 'a', parentID: 'doc-1', rootID: 'doc-1', type: 'p', text: 'A', markdown: 'A', order: 0, depth: 0 },
                { id: 'b', parentID: 'doc-1', rootID: 'doc-1', type: 'p', text: 'B', markdown: 'B', order: 1, depth: 0 },
                { id: 'c', parentID: 'doc-1', rootID: 'doc-1', type: 'p', text: 'C', markdown: 'C', order: 2, depth: 0 },
            ],
            [
                { id: 'a', parentID: 'doc-1', rootID: 'doc-1', type: 'p', text: 'A', markdown: 'A', order: 0, depth: 0 },
                { id: 'c', parentID: 'doc-1', rootID: 'doc-1', type: 'p', text: 'C', markdown: 'C', order: 1, depth: 0 },
            ],
        );
        const removed = entries.find((entry) => entry.status === 'removed');

        expect(removed).toBeTruthy();
        expect(getRestoreInsertPlan(removed!, entries, { documentId: 'doc-1' })).toMatchObject({
            parentIDs: ['doc-1'],
            nextID: 'c',
            previousID: 'a',
        });
    });

    it('falls back to the nearest previous sibling when no following sibling remains', () => {
        const entries = diffBlocks(
            [
                { id: 'a', parentID: 'doc-1', rootID: 'doc-1', type: 'p', text: 'A', markdown: 'A', order: 0, depth: 0 },
                { id: 'b', parentID: 'doc-1', rootID: 'doc-1', type: 'p', text: 'B', markdown: 'B', order: 1, depth: 0 },
            ],
            [
                { id: 'a', parentID: 'doc-1', rootID: 'doc-1', type: 'p', text: 'A', markdown: 'A', order: 0, depth: 0 },
            ],
        );
        const removed = entries.find((entry) => entry.status === 'removed');

        expect(removed).toBeTruthy();
        expect(getRestoreInsertPlan(removed!, entries, { documentId: 'doc-1' })).toMatchObject({
            parentIDs: ['doc-1'],
            previousID: 'a',
        });
    });

    it('uses fileID from repo diff files before id', () => {
        expect(getSnapshotFileId({ id: 'legacy-id', fileID: 'repo-file-id' })).toBe('repo-file-id');
        expect(getSnapshotFileId({ id: 'legacy-id' })).toBe('legacy-id');
    });

    it('pairs modified files by path/title and preserves fileID values', () => {
        const files = buildChangedFiles({
            updatesLeft: [{ fileID: 'left-file', title: 'Doc', path: '/nb/doc.sy' }],
            updatesRight: [{ fileID: 'right-file', title: 'Doc', path: '/nb/doc.sy' }],
        });

        expect(files).toHaveLength(1);
        expect(files[0]).toMatchObject({
            kind: 'modified',
            title: 'Doc',
            oldFile: { fileID: 'left-file' },
            newFile: { fileID: 'right-file' },
        });
    });

    it('filters repo diff files to SiYuan .sy documents only', () => {
        const files = buildChangedFiles({
            updatesLeft: [
                { fileID: 'doc-left', title: 'Doc', path: '/nb/doc.sy' },
                { fileID: 'conf-left', title: 'Conf', path: '/conf/conf.json' },
            ],
            updatesRight: [
                { fileID: 'doc-right', title: 'Doc', path: '/nb/doc.sy' },
                { fileID: 'conf-right', title: 'Conf', path: '/conf/conf.json' },
            ],
            addsLeft: [{ fileID: 'asset', title: 'Asset', path: '/assets/a.png' }],
            removesRight: [{ fileID: 'settings', title: 'Settings', path: '/storage/settings.json' }],
        });

        expect(files).toHaveLength(1);
        expect(files[0].title).toBe('Doc');
    });

    it('extracts document ids from snapshot file paths', () => {
        expect(getDocumentIdFromSnapshotFile({ path: '/data/20260514120000-aaaaaaa.sy' })).toBe('20260514120000-aaaaaaa');
        expect(getDocumentIdFromSnapshotFile({ docID: '20260514120001-bbbbbbb' })).toBe('20260514120001-bbbbbbb');
    });
});
