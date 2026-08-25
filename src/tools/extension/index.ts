import type { SiYuanClient } from '../../api/client';
import type { ExtensionCategoryToolConfig } from '../../core/config';
import type {
    OfficialMcpDiscoverySnapshot,
    OfficialMcpRuntime,
    OfficialMcpTool,
} from '../../core/official-mcp-bridge';
import type { PermissionManager } from '../../core/permissions';
import type { ToolDescriptor } from '../../core/tool-registry';
import type { ActionVariant, ToolResult } from '../internal/shared';
import {
    toPluginMcpToolName,
    validateExplicitExtensionPackage,
} from './package-validator';

const EXTENSION_DESCRIPTION = [
    'Bridge tools exposed through the official SiYuan /mcp endpoint.',
    'Plugin tools are included by default; native SiYuan tools are included only when includeNativeTools is enabled.',
    'Use action="list" to inspect discovery status; while native tools are disabled, it returns counts only and omits tool details.',
    'Every exposed tool keeps its official name as the action.',
    'Pass downstream parameters inside arguments={...}. Tools without readOnlyHint=true may mutate data and require explicit user confirmation.',
    'validate_package and diagnose_plugin_mcp are local read-only diagnostics; neither installs, enables, trusts, reloads, nor invokes an extension.',
].join(' ');
// The aggregate owns these names. Filtering them prevents a discovered
// official tool from silently being routed to a different local action.
const RESERVED_EXTENSION_ACTIONS = new Set(['help', 'list', 'validate_package', 'diagnose_plugin_mcp']);

export const EXTENSION_VARIANTS: ActionVariant<'list' | 'validate_package' | 'diagnose_plugin_mcp'>[] = [{
    action: 'list',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            action: { type: 'string', const: 'list' },
            refresh: {
                type: 'boolean',
                description: 'Refresh the official SiYuan MCP registry before returning discovery status. Tool details are omitted while native tools are disabled.',
            },
        },
        required: ['action'],
    },
}, {
    action: 'validate_package',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            action: { type: 'string', const: 'validate_package' },
            package: {
                type: 'object',
                description: 'Explicit package metadata and text files to validate in memory. This action never accepts or reads a host filesystem path.',
                additionalProperties: false,
                properties: {
                    type: { type: 'string', enum: ['plugin', 'theme', 'widget'] },
                    manifest: { type: 'object', additionalProperties: true },
                    files: {
                        type: 'object',
                        description: 'Relative package filenames mapped to UTF-8 text. Include required entries such as index.js, kernel.js, theme.css, or index.html when applicable.',
                        additionalProperties: { type: 'string' },
                    },
                },
                required: ['type', 'manifest', 'files'],
            },
            runtime: {
                type: 'object',
                description: 'Optional observed compatibility context. Omit values that were not actually observed.',
                additionalProperties: false,
                properties: {
                    appVersion: { type: 'string' },
                    backend: { type: 'string' },
                    frontend: { type: 'string' },
                },
            },
        },
        required: ['action', 'package'],
    },
}, {
    action: 'diagnose_plugin_mcp',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            action: { type: 'string', const: 'diagnose_plugin_mcp' },
            pluginName: {
                type: 'string',
                description: 'The plugin manifest name. SiYuan sanitizes it before forming plugin MCP tool names.',
            },
            expectedToolNames: {
                type: 'array',
                description: 'Optional plugin-local MCP tool names expected after the separately performed lifecycle step. Each is checked against the refreshed Source=plugin registry.',
                items: { type: 'string' },
            },
            expectedState: {
                type: 'string',
                enum: ['present', 'absent'],
                description: 'Whether expectedToolNames should be present or absent in this fresh registry observation. Defaults to present.',
            },
        },
        required: ['action', 'pluginName'],
    },
}];

function textResult(value: unknown, isError = false): ToolResult {
    return {
        content: [{
            type: 'text',
            text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        }],
        ...(isError ? { isError: true } : {}),
    };
}

function isSourceEnabled(tool: OfficialMcpTool, config: ExtensionCategoryToolConfig): boolean {
    return tool.source === 'plugin' || config.includeNativeTools;
}

export function getExposedExtensionTools(
    config: ExtensionCategoryToolConfig,
    runtime?: OfficialMcpRuntime,
): OfficialMcpTool[] {
    if (!config.enabled || !runtime) return [];
    return filterExposedTools(runtime.bridge.getTools(), config);
}

function filterExposedTools(
    tools: OfficialMcpTool[],
    config: ExtensionCategoryToolConfig,
): OfficialMcpTool[] {
    const blocked = new Set(config.blockedTools);
    return tools.filter((tool) =>
        isSourceEnabled(tool, config)
        && !blocked.has(tool.name)
        && !RESERVED_EXTENSION_ACTIONS.has(tool.name),
    );
}

export function rebaseOfficialSchemaRefs(
    value: unknown,
    basePointer: string,
): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => rebaseOfficialSchemaRefs(item, basePointer));
    }
    if (value === null || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => {
            if (key === '$ref' && typeof child === 'string' && child.startsWith('#')) {
                return [key, `${basePointer}${child.slice(1)}`];
            }
            return [key, rebaseOfficialSchemaRefs(child, basePointer)];
        }),
    );
}

function actionVariant(tool: OfficialMcpTool, branchIndex: number): Record<string, unknown> {
    const safety = tool.readOnlyHint
        ? 'Declared read-only by the official MCP registry.'
        : 'May modify data or trigger side effects. Explicit user confirmation is required before calling.';
    const degradation = tool.schemaDegraded
        ? ' The original input schema was invalid and has been degraded to a generic object.'
        : '';
    return {
        type: 'object',
        title: tool.title || tool.name,
        description: `${tool.description || tool.name} ${safety}${degradation}`,
        source: tool.source,
        readOnlyHint: tool.readOnlyHint,
        ...(tool.effectScope ? { effectScope: tool.effectScope } : {}),
        properties: {
            action: {
                type: 'string',
                const: tool.name,
                description: `Official SiYuan MCP tool name: ${tool.name}`,
            },
            arguments: rebaseOfficialSchemaRefs(
                tool.inputSchema,
                `#/oneOf/${branchIndex}/properties/arguments`,
            ),
        },
        required: ['action', 'arguments'],
        additionalProperties: false,
    };
}

function staticDiagnosticVariants(): Record<string, unknown>[] {
    return [{
        type: 'object',
        title: 'Validate explicit extension package content',
        description: 'Validate caller-supplied plugin, theme, or widget metadata and text files without reading a host path or changing SiYuan runtime state.',
        properties: {
            action: { type: 'string', const: 'validate_package' },
            package: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    type: { type: 'string', enum: ['plugin', 'theme', 'widget'] },
                    manifest: { type: 'object', additionalProperties: true },
                    files: { type: 'object', additionalProperties: { type: 'string' } },
                },
                required: ['type', 'manifest', 'files'],
            },
            runtime: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    appVersion: { type: 'string' },
                    backend: { type: 'string' },
                    frontend: { type: 'string' },
                },
            },
        },
        required: ['action', 'package'],
        additionalProperties: false,
    }, {
        type: 'object',
        title: 'Diagnose plugin MCP registry state',
        description: 'Refresh the official registry and inspect Source=plugin tools for one plugin. It does not reload, enable, disable, or invoke a plugin.',
        properties: {
            action: { type: 'string', const: 'diagnose_plugin_mcp' },
            pluginName: { type: 'string' },
            expectedToolNames: { type: 'array', items: { type: 'string' } },
            expectedState: { type: 'string', enum: ['present', 'absent'] },
        },
        required: ['action', 'pluginName'],
        additionalProperties: false,
    }];
}

export function listExtensionTools(
    config: ExtensionCategoryToolConfig,
    runtime?: OfficialMcpRuntime,
): ToolDescriptor[] {
    if (!config.enabled) return [];
    const tools = getExposedExtensionTools(config, runtime);
    const actionNames = ['help', 'list', 'validate_package', 'diagnose_plugin_mcp', ...tools.map((tool) => tool.name)];
    const variants: Record<string, unknown>[] = [{
        type: 'object',
        title: 'Extension help',
        properties: {
            action: { type: 'string', const: 'help' },
            topic: {
                type: 'string',
                description: 'Optional official MCP tool name.',
            },
        },
        required: ['action'],
        additionalProperties: false,
    }, {
        type: 'object',
        title: 'List official MCP tools',
        properties: {
            action: { type: 'string', const: 'list' },
            refresh: {
                type: 'boolean',
                description: 'Refresh the official SiYuan MCP registry before returning discovery status. Tool details are omitted while native tools are disabled.',
            },
        },
        required: ['action'],
        additionalProperties: false,
    }, ...staticDiagnosticVariants(), ...tools.map((tool, index) => actionVariant(tool, index + 4))];

    return [{
        name: 'extension',
        description: [
            EXTENSION_DESCRIPTION,
            `Currently exposed actions: ${actionNames.join(', ')}.`,
        ].join('\n\n'),
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: actionNames,
                    description: 'Use list or an exposed official MCP tool name.',
                },
                arguments: {
                    type: 'object',
                    description: 'Arguments forwarded unchanged to the selected official MCP tool.',
                    additionalProperties: true,
                },
                package: { type: 'object', additionalProperties: true },
                runtime: { type: 'object', additionalProperties: true },
                pluginName: { type: 'string' },
                expectedToolNames: { type: 'array', items: { type: 'string' } },
                expectedState: { type: 'string', enum: ['present', 'absent'] },
                refresh: { type: 'boolean' },
                topic: { type: 'string' },
            },
            required: ['action'],
            oneOf: variants,
        },
    }];
}

export async function prepareExtensionTools(
    config: ExtensionCategoryToolConfig,
    runtime?: OfficialMcpRuntime,
): Promise<OfficialMcpDiscoverySnapshot | undefined> {
    if (!config.enabled || !runtime) return undefined;
    const cachedSnapshot = runtime.bridge.getSnapshot();
    if (cachedSnapshot.lastAttemptAt) {
        if (updateExposedToolsFingerprint(config, runtime, cachedSnapshot.tools)) {
            await notifyListChanged(runtime);
        }
        return cachedSnapshot;
    }

    if (runtime.discoveryMode === 'background') {
        updateExposedToolsFingerprint(config, runtime, cachedSnapshot.tools);
        if (!runtime.discoveryPromise) {
            runtime.discoveryPromise = runtime.bridge.refresh()
                .then(async (snapshot) => {
                    if (updateExposedToolsFingerprint(config, runtime, snapshot.tools)) {
                        await notifyListChanged(runtime);
                    }
                    return snapshot;
                })
                .finally(() => {
                    runtime.discoveryPromise = undefined;
                });
        }
        return cachedSnapshot;
    }

    const snapshot = await runtime.bridge.refresh();
    if (updateExposedToolsFingerprint(config, runtime, snapshot.tools)) {
        await notifyListChanged(runtime);
    }
    return snapshot;
}

function updateExposedToolsFingerprint(
    config: ExtensionCategoryToolConfig,
    runtime: OfficialMcpRuntime,
    tools = runtime.bridge.getTools(),
): boolean {
    const nextFingerprint = JSON.stringify(filterExposedTools(tools, config));
    const changed = runtime.exposedToolsFingerprint !== nextFingerprint;
    runtime.exposedToolsFingerprint = nextFingerprint;
    return changed;
}

async function notifyListChanged(runtime: OfficialMcpRuntime): Promise<void> {
    try {
        await runtime.notifyToolListChanged?.();
    } catch {
        // Discovery and calls remain usable even when the outer client has
        // already disconnected or does not accept list-changed notifications.
    }
}

function formatDiscovery(
    snapshot: OfficialMcpDiscoverySnapshot,
    config: ExtensionCategoryToolConfig,
) {
    const blocked = new Set(config.blockedTools);
    const exposed = filterExposedTools(snapshot.tools, config);
    const sourceCounts = snapshot.tools.reduce((counts, tool) => {
        counts[tool.source] += 1;
        return counts;
    }, { plugin: 0, native: 0 });
    return {
        connected: snapshot.connected,
        supported: snapshot.supported,
        siyuanVersion: snapshot.siyuanVersion,
        minSupportedVersion: snapshot.minSupportedVersion,
        lastSuccessfulRefreshAt: snapshot.lastSuccessfulRefreshAt,
        lastAttemptAt: snapshot.lastAttemptAt,
        error: snapshot.error,
        changed: snapshot.changed,
        discoveredCount: snapshot.tools.length,
        discoveredBySource: sourceCounts,
        nativeToolsEnabled: config.includeNativeTools,
        exposedCount: exposed.length,
        schemaBytes: JSON.stringify(exposed.map((tool) => tool.inputSchema)).length,
        detailsIncluded: config.includeNativeTools,
        ...(config.includeNativeTools
            ? {
                tools: snapshot.tools.map((tool) => ({
                    name: tool.name,
                    title: tool.title,
                    description: tool.description,
                    source: tool.source,
                    readOnlyHint: tool.readOnlyHint,
                    effectScope: tool.effectScope,
                    schemaDegraded: tool.schemaDegraded,
                    blocked: blocked.has(tool.name),
                    sourceEnabled: isSourceEnabled(tool, config),
                    reservedActionConflict: RESERVED_EXTENSION_ACTIONS.has(tool.name),
                    exposed: exposed.some((candidate) => candidate.name === tool.name),
                })),
            }
            : {}),
        hint: snapshot.error
            ? 'Official MCP tools require SiYuan 3.7.0+, an administrator session, and a valid API token.'
            : config.includeNativeTools
                ? 'Plugin and native SiYuan tools are exposed. Call extension(action="<official tool name>", arguments={...}).'
                : 'Plugin tools are exposed. Enable includeNativeTools in settings to expose native SiYuan tools.',
    };
}

function helpResult(
    topic: string | undefined,
    config: ExtensionCategoryToolConfig,
    runtime?: OfficialMcpRuntime,
): ToolResult {
    const discoveredTools = runtime?.bridge.getTools() ?? [];
    const tool = discoveredTools.find((candidate) => candidate.name === topic);
    if (topic && tool) {
        const sourceEnabled = isSourceEnabled(tool, config);
        const reservedActionConflict = RESERVED_EXTENSION_ACTIONS.has(tool.name);
        return textResult({
            tool: tool.name,
            title: tool.title,
            description: tool.description,
            source: tool.source,
            readOnlyHint: tool.readOnlyHint,
            requiresConfirmation: !tool.readOnlyHint,
            effectScope: tool.effectScope,
            blocked: config.blockedTools.includes(tool.name),
            sourceEnabled,
            reservedActionConflict,
            exposed: sourceEnabled
                && !reservedActionConflict
                && !config.blockedTools.includes(tool.name),
            schemaDegraded: tool.schemaDegraded,
            inputSchema: tool.inputSchema,
            call: {
                action: tool.name,
                arguments: {},
            },
        });
    }

    return textResult({
        tool: 'extension',
        description: EXTENSION_DESCRIPTION,
        actions: {
            list: {
                parameters: { refresh: 'boolean, optional' },
                description: 'Inspect or refresh official MCP tool discovery.',
            },
            validate_package: {
                parameters: { package: 'object, required', runtime: 'object, optional' },
                description: 'Statically validate explicit plugin/theme/widget metadata and text files without reading host paths or changing runtime state.',
            },
            diagnose_plugin_mcp: {
                parameters: { pluginName: 'string, required', expectedToolNames: 'string[], optional', expectedState: 'present|absent, optional' },
                description: 'Refresh and inspect the official Source=plugin registry for one plugin without enabling, disabling, reloading, or invoking it.',
            },
            '<official tool name>': {
                parameters: { arguments: 'object, required' },
                description: 'Forward one call to the selected official MCP tool. Calls are never retried.',
            },
        },
        includeNativeTools: config.includeNativeTools,
        discoveredCount: discoveredTools.length,
        discoveredBySource: discoveredTools.reduce((counts, candidate) => {
            counts[candidate.source] += 1;
            return counts;
        }, { plugin: 0, native: 0 }),
        detailsIncluded: config.includeNativeTools,
        ...(config.includeNativeTools
            ? {
                discoveredTools: discoveredTools.map((candidate) => ({
                    name: candidate.name,
                    source: candidate.source,
                    exposed: getExposedExtensionTools(config, runtime)
                        .some((exposedTool) => exposedTool.name === candidate.name),
                })),
            }
            : {}),
    });
}

export async function callExtensionTool(
    _client: SiYuanClient,
    rawArgs: Record<string, unknown> | undefined,
    config: ExtensionCategoryToolConfig,
    _permMgr: PermissionManager,
    runtime?: OfficialMcpRuntime,
): Promise<ToolResult> {
    const action = typeof rawArgs?.action === 'string' ? rawArgs.action : '';
    if (action === 'help') {
        return helpResult(
            typeof rawArgs?.topic === 'string' ? rawArgs.topic : undefined,
            config,
            runtime,
        );
    }
    if (action === 'validate_package') {
        const packageInput = rawArgs?.package;
        const runtimeInput = rawArgs?.runtime;
        if (runtimeInput !== undefined && (runtimeInput === null || typeof runtimeInput !== 'object' || Array.isArray(runtimeInput))) {
            return textResult('extension.runtime must be an object when supplied.', true);
        }
        return textResult(validateExplicitExtensionPackage({
            package: packageInput,
            runtime: runtimeInput,
        }));
    }
    if (!runtime) {
        return textResult('Official MCP bridge runtime is unavailable.', true);
    }
    if (action === 'list') {
        const cachedSnapshot = runtime.bridge.getSnapshot();
        const snapshot = rawArgs?.refresh === true || !cachedSnapshot.lastAttemptAt
            ? await runtime.bridge.refresh({
                forceVersionCheck: rawArgs?.refresh === true,
            })
            : cachedSnapshot;
        if (updateExposedToolsFingerprint(config, runtime, snapshot.tools)) {
            await notifyListChanged(runtime);
        }
        return textResult(formatDiscovery(snapshot, config));
    }
    if (action === 'diagnose_plugin_mcp') {
        const pluginName = typeof rawArgs?.pluginName === 'string' ? rawArgs.pluginName.trim() : '';
        if (!pluginName) {
            return textResult('extension.pluginName is required for diagnose_plugin_mcp.', true);
        }
        const expectedToolNames = rawArgs?.expectedToolNames;
        if (expectedToolNames !== undefined
            && (!Array.isArray(expectedToolNames) || expectedToolNames.some((name) => typeof name !== 'string' || !name.trim()))) {
            return textResult('extension.expectedToolNames must be an array of non-empty plugin-local tool names when supplied.', true);
        }
        const expectedState = rawArgs?.expectedState === undefined ? 'present' : rawArgs.expectedState;
        if (expectedState !== 'present' && expectedState !== 'absent') {
            return textResult('extension.expectedState must be "present" or "absent" when supplied.', true);
        }

        const snapshot = await runtime.bridge.refresh({ forceVersionCheck: true });
        if (updateExposedToolsFingerprint(config, runtime, snapshot.tools)) {
            await notifyListChanged(runtime);
        }
        const prefix = `plugin__${pluginName.replace(/[^0-9a-zA-Z]/g, '_')}__`;
        // A failed refresh can preserve a previous bridge cache. Showing those
        // entries as current would turn stale data into fake lifecycle proof,
        // so only a successful refresh is allowed to supply registry evidence.
        const observedTools = snapshot.error ? [] : snapshot.tools;
        const matchingTools = observedTools
            .filter((tool) => tool.source === 'plugin' && tool.name.startsWith(prefix))
            .map((tool) => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                readOnlyHint: tool.readOnlyHint,
                effectScope: tool.effectScope,
                schemaDegraded: tool.schemaDegraded,
            }));
        const expected = (expectedToolNames as string[] | undefined)?.map((name) => ({
            localName: name.trim(),
            qualifiedName: toPluginMcpToolName(pluginName, name.trim()),
        })) ?? [];
        const presentNames = new Set(matchingTools.map((tool) => tool.name));
        const expectation = expected.map((item) => ({
            ...item,
            observed: presentNames.has(item.qualifiedName),
            expectationMet: !snapshot.error && (expectedState === 'present'
                ? presentNames.has(item.qualifiedName)
                : !presentNames.has(item.qualifiedName)),
        }));
        const expectedAbsenceObserved = expectedState === 'absent'
            && !snapshot.error
            && (expected.length > 0
                ? expectation.every((item) => item.expectationMet)
                : matchingTools.length === 0);
        return textResult({
            kind: 'plugin_mcp_registry_observation',
            observation: snapshot.error ? 'unavailable' : 'completed',
            registry: {
                connected: snapshot.connected,
                supported: snapshot.supported,
                siyuanVersion: snapshot.siyuanVersion,
                lastSuccessfulRefreshAt: snapshot.lastSuccessfulRefreshAt,
                lastAttemptAt: snapshot.lastAttemptAt,
                error: snapshot.error,
            },
            plugin: {
                manifestName: pluginName,
                sanitizedName: pluginName.replace(/[^0-9a-zA-Z]/g, '_'),
                toolPrefix: prefix,
                source: 'plugin',
                registeredTools: matchingTools,
            },
            ...(expected.length > 0 ? {
                expectation: {
                    expectedState,
                    tools: expectation,
                    allMet: expectation.every((item) => item.expectationMet),
                },
            } : {}),
            lifecycle: {
                staticPackage: 'not_observed',
                trustGranted: 'not_observed',
                frontendPluginLoaded: 'not_observed',
                kernelPluginRunning: snapshot.error ? 'not_observed' : matchingTools.length > 0 ? 'inferred_from_registered_tool' : 'not_observed',
                mcpToolRegistration: !snapshot.error && matchingTools.length > 0
                    ? 'observed_from_fresh_registry'
                    : 'not_observed',
                mcpToolUnregistration: expectedAbsenceObserved
                    ? 'registry_absence_observed_not_proven'
                    : 'not_observed',
                reload: 'not_triggered',
                functionAfterReload: 'not_verified',
            },
            limitations: [
                'This action refreshes only the official MCP tools/list registry. It does not read a package path, install a package, grant trust, enable or disable a plugin, trigger a reload, inspect logs, or invoke a plugin MCP tool.',
                'A registered Source=plugin tool supports an inference that its kernel plugin is running at this observation, but does not prove frontend loading, UI cleanup, or full feature behavior.',
                'A missing tool only means it was absent from this refreshed registry. It does not prove that a requested disable, unload, or reload completed.',
            ],
        }, snapshot.error !== undefined);
    }
    if (!action) {
        return textResult('extension.action is required. Use action="list" to inspect available official MCP tools.', true);
    }
    if (config.blockedTools.includes(action)) {
        return textResult(`Official MCP tool "${action}" is blocked in Sisyphus settings.`, true);
    }

    let tool = getExposedExtensionTools(config, runtime)
        .find((candidate) => candidate.name === action);
    if (!tool) {
        const snapshot = await runtime.bridge.refresh();
        if (updateExposedToolsFingerprint(config, runtime, snapshot.tools)) {
            await notifyListChanged(runtime);
        }
        tool = filterExposedTools(snapshot.tools, config)
            .find((candidate) => candidate.name === action);
    }
    if (!tool) {
        const discovered = runtime.bridge.getTools().find((candidate) => candidate.name === action);
        if (discovered?.source === 'native' && !config.includeNativeTools) {
            return textResult(
                `Native SiYuan MCP tool "${action}" is disabled. Enable extension.includeNativeTools in Sisyphus settings first.`,
                true,
            );
        }
        if (RESERVED_EXTENSION_ACTIONS.has(action)) {
            return textResult(
                `Official MCP tool "${action}" conflicts with a reserved extension action and cannot be exposed.`,
                true,
            );
        }
        return textResult(
            `Unknown official MCP tool "${action}". Use extension(action="list", refresh=true) to inspect current tools.`,
            true,
        );
    }

    const downstreamArgs = rawArgs?.arguments;
    if (downstreamArgs === null || typeof downstreamArgs !== 'object' || Array.isArray(downstreamArgs)) {
        return textResult('extension.arguments must be an object.', true);
    }
    return runtime.bridge.callTool(action, downstreamArgs as Record<string, unknown>);
}
