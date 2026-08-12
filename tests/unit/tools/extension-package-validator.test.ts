import { describe, expect, it } from 'vitest';

import {
    sanitizeSiYuanPluginName,
    toPluginMcpToolName,
    validateExplicitExtensionPackage,
} from '@/tools/extension/package-validator';

const pluginManifest = {
    name: 'example-plugin',
    author: 'Example',
    url: 'https://example.invalid/example-plugin',
    version: '1.0.0',
    minAppVersion: '3.7.0',
    displayName: { default: 'Example Plugin' },
    description: { default: 'An example.' },
    backends: ['darwin'],
    frontends: ['desktop'],
    kernels: ['darwin'],
};

describe('explicit extension package validator', () => {
    it('validates caller-provided plugin text without accepting a package path', () => {
        const result = validateExplicitExtensionPackage({
            package: {
                type: 'plugin',
                manifest: pluginManifest,
                files: {
                    'index.js': 'const { Plugin } = require("siyuan"); module.exports = class Example extends Plugin { onunload() {} };',
                    'kernel.js': 'async function x() { await siyuan.mcp.registerTool("echo", {}, () => ({})); await siyuan.mcp.unregisterTool("echo"); }',
                },
            },
            runtime: { appVersion: '3.7.3', backend: 'darwin', frontend: 'desktop' },
        });

        expect(result.staticPackage).toBe('valid');
        expect(result.packageIdentity).toEqual({
            manifestName: 'example-plugin',
            pluginMcpPrefix: 'plugin__example_plugin__',
        });
        expect(result.compatibility).toEqual({
            minAppVersion: 'compatible',
            backend: 'compatible',
            frontend: 'compatible',
            kernel: 'compatible',
        });
        expect(result.staticSignals).toEqual({
            frontendOnUnload: 'detected',
            kernelMcpRegistrationCalls: 1,
            kernelMcpUnregistrationCalls: 1,
        });
        expect(result.lifecycle).toEqual(expect.objectContaining({
            frontendPluginLoaded: 'not_observed',
            kernelPluginRunning: 'not_observed',
            mcpToolRegistration: 'not_observed',
            mcpToolUnregistration: 'not_observed',
            reload: 'not_triggered',
            functionAfterReload: 'not_verified',
        }));
    });

    it('rejects host-path shaped input and marks static validity separately from runtime state', () => {
        const result = validateExplicitExtensionPackage({
            package: {
                type: 'plugin',
                manifest: {
                    ...pluginManifest,
                    name: '../unsafe',
                    minAppVersion: '3.8.0',
                    enabled: true,
                },
                files: {
                    '../index.js': 'module.exports = class Example {};',
                    'kernel.js': 'siyuan.mcp.registerTool("echo", {}, () => ({}));',
                },
                path: '/Users/example/data/plugins/unsafe',
            },
            runtime: { appVersion: '3.7.3', backend: 'windows', frontend: 'browser-desktop' },
        });

        expect(result.staticPackage).toBe('invalid');
        expect(result.compatibility).toEqual(expect.objectContaining({
            minAppVersion: 'incompatible',
            backend: 'incompatible',
            frontend: 'incompatible',
            kernel: 'incompatible',
        }));
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'package.files.../index.js' }),
            expect.objectContaining({ field: 'package.manifest.enabled' }),
            expect.objectContaining({ field: 'package.files.index.js' }),
            expect.objectContaining({ field: 'package.files.kernel.js', message: expect.stringContaining('no explicit unregisterTool') }),
        ]));
        expect(result.limitations.join(' ')).toContain('never reads a package path');
    });

    it('validates required theme/widget files and treats their executable or same-origin surfaces as trust-reviewed', () => {
        const theme = validateExplicitExtensionPackage({
            package: {
                type: 'theme',
                manifest: { ...pluginManifest, name: 'theme', modes: ['light'] },
                files: { 'theme.js': 'console.log("executable")' },
            },
        });
        const widget = validateExplicitExtensionPackage({
            package: {
                type: 'widget',
                manifest: { ...pluginManifest, name: 'widget' },
                files: { 'index.html': '<script>console.log("same-origin")</script>' },
            },
        });

        expect(theme.staticPackage).toBe('invalid');
        expect(theme.executableSurfaces).toContain('theme.js');
        expect(theme.lifecycle.trustReview).toBe('required');
        expect(widget.staticPackage).toBe('valid');
        expect(widget.executableSurfaces).toContain('widget package (same-origin authenticated application)');
        expect(widget.lifecycle.trustReview).toBe('required');
    });

    it("uses SiYuan's alphanumeric plugin MCP qualification rule", () => {
        expect(sanitizeSiYuanPluginName('plugin-name 1')).toBe('plugin_name_1');
        expect(toPluginMcpToolName('plugin-name 1', 'read item')).toBe('plugin__plugin_name_1__read_item');
    });
});
