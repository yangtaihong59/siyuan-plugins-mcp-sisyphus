import { describe, expect, it } from 'vitest';

import { getHelpText, parseArgs } from '@/cli/args';

describe('cli/args', () => {
    it('parses profile as a global option for dispatch commands', () => {
        expect(parseArgs(['--profile', 'work', 'notebook', 'list'])).toMatchObject({
            command: 'dispatch',
            tool: 'notebook',
            action: 'list',
            profile: 'work',
        });
    });

    it('strips profile from tool-specific rest args', () => {
        expect(parseArgs(['--profile', 'work', 'block', 'append', '--parent-id', 'p1'])).toMatchObject({
            command: 'dispatch',
            rest: ['--parent-id', 'p1'],
        });
    });

    it('strips negated global booleans from tool-specific rest args', () => {
        expect(parseArgs(['notebook', 'list', '--no-json', '--no-debug', '--name', 'ignored'])).toMatchObject({
            command: 'dispatch',
            json: false,
            debug: false,
            rest: ['--name', 'ignored'],
        });
    });

    it('parses instances', () => {
        expect(parseArgs(['instances', '--json'])).toMatchObject({
            command: 'instances',
            json: true,
        });
    });

    it('parses config list', () => {
        expect(parseArgs(['config', 'list'])).toMatchObject({
            command: 'config',
            configAction: 'list',
        });
    });

    it('parses config set with url and token', () => {
        expect(parseArgs(['config', 'set', 'work', '--url', 'http://work', '--token', 'secret'])).toMatchObject({
            command: 'config',
            configAction: 'set',
            configName: 'work',
            url: 'http://work',
            token: 'secret',
        });
    });

    it('parses config use', () => {
        expect(parseArgs(['config', 'use', 'work'])).toMatchObject({
            command: 'config',
            configAction: 'use',
            configName: 'work',
        });
    });

    it('parses skill install options', () => {
        expect(parseArgs(['skill', 'install', '--bundle', 'mcp', '--target', '.codex', '--local', '--dry-run'])).toMatchObject({
            command: 'skill',
            skillAction: 'install',
            bundle: 'mcp',
            target: '.codex',
            local: true,
            dryRun: true,
        });
    });

    it('keeps CLI as the default skill bundle and rejects unknown bundles', () => {
        expect(parseArgs(['skill', 'list'])).toMatchObject({ bundle: 'cli' });
        expect(() => parseArgs(['skill', 'list', '--bundle', 'unknown'])).toThrow('Invalid skill bundle');
    });

    it('documents common action aliases and fs positionals', () => {
        const help = getHelpText();

        expect(help).toContain('Alias:');
        expect(help).toContain('sisyphus');
        expect(help).not.toContain('\n  siyuan                                         Same CLI, shorter command name');
        expect(help).toContain('instances');
        expect(help).toContain('SIYUAN_DISCOVER=0');
        expect(help).toContain('list/ls');
        expect(help).toContain('move/mv');
        expect(help).toContain('remove/rm/delete/del');
        expect(help).toContain('fs ls /');
        expect(help).toContain('fs search / keyword');
    });
});
