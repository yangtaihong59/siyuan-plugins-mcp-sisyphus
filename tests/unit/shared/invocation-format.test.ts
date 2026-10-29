import { describe, expect, it } from 'vitest';
import { databaseNote } from '@/tools/internal/read-guidance';

import {
    formatActionCall,
    formatActionRef,
    formatFieldRef,
    renderTextFragments,
    translatePresentationPayload,
    translatePresentationText,
} from '@/shared/invocation-format';

describe('presentation/invocation-format', () => {
    it('formats action calls for MCP and CLI targets', () => {
        expect(formatActionRef('block', 'append', 'mcp')).toBe('block(action="append")');
        expect(formatActionRef('block', 'append', 'cli')).toBe('siyuan-sisyphus block append');

        expect(formatActionCall('block', 'append', {
            parentID: '20240318112233-abc123',
            dataType: 'markdown',
            data: '- item',
        }, 'cli')).toBe('siyuan-sisyphus block append --parent-id 20240318112233-abc123 --data-type markdown --data "- item"');
    });

    it('renders structured text fragments per target', () => {
        const fragments = [
            'Use ',
            { kind: 'action-call' as const, tool: 'document', action: 'resolve', args: { id: '...', include: ['path'] } },
            ' before passing ',
            { kind: 'field-ref' as const, field: 'parentID' },
            '.',
        ];

        expect(renderTextFragments(fragments, 'mcp')).toBe('Use document(action="resolve", id="...", include=["path"]) before passing parentID.');
        expect(renderTextFragments(fragments, 'cli')).toBe('Use siyuan-sisyphus document resolve --id ... --include-json \'["path"]\' before passing --parent-id.');
    });

    it('translates legacy MCP-style text into CLI command syntax', () => {
        expect(translatePresentationText(
            'block(action="prepend") or block(action="append") with a document ID targets the document start or end.',
            'cli',
        )).toBe('siyuan-sisyphus block prepend or siyuan-sisyphus block append with a document ID targets the document start or end.');

        expect(translatePresentationText(
            'Call block(action="help", topic="<actionName>") for required fields.',
            'cli',
        )).toBe('Call siyuan-sisyphus help block <action-name> for required fields.');

        expect(translatePresentationText(
            'Use notebook + path + markdown and then page/pageSize if needed.',
            'cli',
        )).toBe('Use --notebook + --path + --markdown and then page/pageSize if needed.');

        expect(translatePresentationText(
            'fs paths are human-readable workspace paths such as /Notebook/Folder/Doc.',
            'cli',
        )).toBe('fs paths are human-readable workspace paths such as /Notebook/Folder/Doc.');

        expect(translatePresentationText(
            'Use old/new shorthand, default /assets/, and block/av/document tools.',
            'cli',
        )).toBe('Use old/new shorthand, default /assets/, and block/av/document tools.');
    });

    it('translates databaseNote and error messages for the CLI only', () => {
        const note = databaseNote(['20261029054824-hh54xgn']);
        const read = translatePresentationPayload({ content: 'x', databaseNote: note }, 'cli') as Record<string, string>;
        expect(read.databaseNote).toContain('siyuan-sisyphus av query --av-id 20261029054824-hh54xgn');
        expect(read.databaseNote).not.toContain('action=');
        expect(databaseNote(['a', 'b'])).toContain('avID="<av-id>"');
        const error = { error: { type: 'permission_denied', message: 'Not here; use document(action="query").', hint: 'Try search(action="fulltext").' } };
        const translated = translatePresentationPayload(error, 'cli') as { error: Record<string, string> };
        expect(translated.error.message).toBe('Not here; use siyuan-sisyphus document query.');
        expect(translated.error.hint).toBe('Try siyuan-sisyphus search fulltext.');
        expect(translatePresentationPayload(error, 'mcp')).toBe(error);
    });

    it('translates structured help payloads without changing MCP payloads', () => {
        const payload = {
            tool: 'block',
            action: 'append',
            hint: 'Use block(action="get_kramdown", id="...") first.',
            shapes: ['dataType + data + parentID'],
            requiredFields: ['dataType', 'data', 'parentID'],
            example: {
                action: 'append',
                dataType: 'markdown',
                data: '- New item',
                parentID: '20240318112233-abc123',
            },
            guidance: ['block(action="append") with a document ID targets the document end.'],
            fullDocResource: 'siyuan://help/action/block/append',
        };

        expect(translatePresentationPayload(payload, 'mcp')).toBe(payload);
        expect(translatePresentationPayload(payload, 'cli')).toEqual({
            tool: 'block',
            action: 'append',
            hint: 'Use siyuan-sisyphus block get-kramdown --id ... first.',
            shapes: ['--data-type + --data + --parent-id'],
            requiredFields: ['--data-type', '--data', '--parent-id'],
            example: 'siyuan-sisyphus block append --data-type markdown --data "- New item" --parent-id 20240318112233-abc123',
            guidance: ['siyuan-sisyphus block append with a document ID targets the document end.'],
            fullDocResource: 'siyuan-sisyphus help block append',
        });
    });
});
