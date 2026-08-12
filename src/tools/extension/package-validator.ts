export type ExtensionPackageType = 'plugin' | 'theme' | 'widget';

export interface ExtensionPackageIssue {
    code?: string;
    severity: 'error' | 'warning';
    field: string;
    message: string;
}

export interface StaticPackageValidation {
    kind: 'static_extension_package_validation';
    packageType: ExtensionPackageType | 'unknown';
    staticPackage: 'valid' | 'invalid';
    issues: ExtensionPackageIssue[];
    summary: {
        errors: number;
        warnings: number;
    };
    packageIdentity?: {
        manifestName: string;
        pluginMcpPrefix?: string;
    };
    compatibility: {
        minAppVersion: 'compatible' | 'incompatible' | 'not_checked' | 'invalid';
        backend: 'compatible' | 'incompatible' | 'not_checked';
        frontend: 'compatible' | 'incompatible' | 'not_checked';
        kernel: 'compatible' | 'incompatible' | 'not_applicable' | 'not_checked';
    };
    executableSurfaces: string[];
    lifecycle: {
        trustReview: 'required' | 'not_applicable';
        frontendPluginLoaded: 'not_observed';
        kernelPluginRunning: 'not_observed';
        mcpToolRegistration: 'not_observed';
        mcpToolUnregistration: 'not_observed';
        reload: 'not_triggered';
        functionAfterReload: 'not_verified';
    };
    staticSignals?: {
        frontendOnUnload: 'detected' | 'not_detected' | 'not_applicable';
        kernelMcpRegistrationCalls: number;
        kernelMcpUnregistrationCalls: number;
    };
    limitations: string[];
}

interface RuntimeCompatibility {
    appVersion?: string;
    backend?: string;
    frontend?: string;
}

interface ParsedPackageInput {
    type: ExtensionPackageType | 'unknown';
    manifest?: Record<string, unknown>;
    files: Record<string, string>;
    runtime: RuntimeCompatibility;
}

const PACKAGE_TYPES = new Set<ExtensionPackageType>(['plugin', 'theme', 'widget']);
const RUNTIME_DERIVED_MANIFEST_FIELDS = new Set([
    'enabled',
    'installed',
    'outdated',
    'current',
    'disallowInstall',
    'disallowUpdate',
    'installedIncompatible',
    'bazaarIncompatible',
    'updateRequiredMinAppVer',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelativePackageFile(path: string): boolean {
    if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
    return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function parseInput(input: unknown, issues: ExtensionPackageIssue[]): ParsedPackageInput {
    if (!isRecord(input)) {
        issues.push({ severity: 'error', field: 'package', message: 'package must be an object containing type, manifest, and explicit files.' });
        return { type: 'unknown', files: {}, runtime: {} };
    }

    const packageInput = isRecord(input.package) ? input.package : undefined;
    if (!packageInput) {
        issues.push({ severity: 'error', field: 'package', message: 'package must be an object containing type, manifest, and explicit files.' });
        return { type: 'unknown', files: {}, runtime: {} };
    }

    const type = typeof packageInput.type === 'string' && PACKAGE_TYPES.has(packageInput.type as ExtensionPackageType)
        ? packageInput.type as ExtensionPackageType
        : 'unknown';
    if (type === 'unknown') {
        issues.push({ severity: 'error', field: 'package.type', message: 'type must be plugin, theme, or widget.' });
    }

    const manifest = isRecord(packageInput.manifest) ? packageInput.manifest : undefined;
    if (!manifest) {
        issues.push({ severity: 'error', field: 'package.manifest', message: 'manifest must be an explicit JSON object; no local path is accepted.' });
    }

    const files: Record<string, string> = {};
    if (!isRecord(packageInput.files)) {
        issues.push({ severity: 'error', field: 'package.files', message: 'files must be an object whose relative filenames map to UTF-8 text content.' });
    } else {
        for (const [path, content] of Object.entries(packageInput.files)) {
            if (!isSafeRelativePackageFile(path)) {
                issues.push({ severity: 'error', field: `package.files.${path || '<empty>'}`, message: 'file names must be non-empty relative package paths without traversal or backslashes.' });
                continue;
            }
            if (typeof content !== 'string') {
                issues.push({ severity: 'error', field: `package.files.${path}`, message: 'file content must be a string.' });
                continue;
            }
            files[path] = content;
        }
    }

    const runtime: RuntimeCompatibility = {};
    if (input.runtime !== undefined) {
        if (!isRecord(input.runtime)) {
            issues.push({ severity: 'error', field: 'runtime', message: 'runtime must be an object when supplied.' });
        } else {
            for (const field of ['appVersion', 'backend', 'frontend'] as const) {
                if (input.runtime[field] !== undefined && typeof input.runtime[field] !== 'string') {
                    issues.push({ severity: 'error', field: `runtime.${field}`, message: `${field} must be a string when supplied.` });
                } else if (typeof input.runtime[field] === 'string' && input.runtime[field].trim()) {
                    runtime[field] = input.runtime[field].trim();
                }
            }
        }
    }

    return { type, manifest, files, runtime };
}

function addIssue(issues: ExtensionPackageIssue[], severity: ExtensionPackageIssue['severity'], field: string, message: string): void {
    issues.push({ severity, field, message });
}

function stringArray(
    manifest: Record<string, unknown>,
    field: string,
    issues: ExtensionPackageIssue[],
): string[] | undefined {
    const value = manifest[field];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        addIssue(issues, 'error', `package.manifest.${field}`, `${field} must be an array of strings when supplied.`);
        return undefined;
    }
    return value.map((item) => item.trim()).filter(Boolean);
}

function validateLocaleMap(
    manifest: Record<string, unknown>,
    field: string,
    issues: ExtensionPackageIssue[],
): void {
    const value = manifest[field];
    if (value === undefined) {
        if (field === 'displayName' || field === 'description') {
            addIssue(issues, 'warning', `package.manifest.${field}`, `${field} is absent; a locale map with a default value improves discovery.`);
        }
        return;
    }
    if (!isRecord(value) || Object.entries(value).some(([key, item]) => !key || typeof item !== 'string')) {
        addIssue(issues, 'error', `package.manifest.${field}`, `${field} must be a locale map with string keys and values.`);
        return;
    }
    if (!Object.values(value).some((item) => typeof item === 'string' && item.trim())) {
        addIssue(issues, 'warning', `package.manifest.${field}`, `${field} has no non-empty localized value.`);
    }
}

interface ParsedVersion {
    core: [number, number, number];
    prerelease: string[];
}

function parseVersion(value: string): ParsedVersion | undefined {
    const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return undefined;
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] ? match[4].split('.') : [],
    };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
    for (let index = 0; index < left.core.length; index += 1) {
        if (left.core[index] !== right.core[index]) return left.core[index] > right.core[index] ? 1 : -1;
    }
    if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
    if (left.prerelease.length === 0) return 1;
    if (right.prerelease.length === 0) return -1;
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const a = left.prerelease[index];
        const b = right.prerelease[index];
        if (a === undefined) return -1;
        if (b === undefined) return 1;
        if (a === b) continue;
        const aNumeric = /^\d+$/.test(a);
        const bNumeric = /^\d+$/.test(b);
        if (aNumeric && bNumeric) return Number(a) > Number(b) ? 1 : -1;
        if (aNumeric) return -1;
        if (bNumeric) return 1;
        return a > b ? 1 : -1;
    }
    return 0;
}

function targetCompatibility(
    field: 'backends' | 'frontends' | 'kernels',
    values: string[] | undefined,
    target: string | undefined,
): 'compatible' | 'incompatible' | 'not_checked' {
    if (!target) return 'not_checked';
    if (!values || values.length === 0) return field === 'kernels' ? 'incompatible' : 'compatible';
    return values.includes('all') || values.includes(target) ? 'compatible' : 'incompatible';
}

/**
 * SiYuan qualifies a plugin MCP tool from the plugin's package name after
 * replacing every non-alphanumeric byte with an underscore. Keeping this
 * conversion here lets static validation and registry readback agree without
 * ever resolving a package directory on the host filesystem.
 */
export function sanitizeSiYuanPluginName(name: string): string {
    return name.replace(/[^0-9a-zA-Z]/g, '_');
}

export function toPluginMcpToolName(pluginName: string, toolName: string): string {
    return `plugin__${sanitizeSiYuanPluginName(pluginName)}__${sanitizeSiYuanPluginName(toolName)}`;
}

function countMcpCall(source: string, method: 'registerTool' | 'unregisterTool'): number {
    const pattern = new RegExp(`siyuan\\s*\\.\\s*mcp\\s*\\.\\s*${method}\\s*\\(`, 'g');
    return source.match(pattern)?.length ?? 0;
}

export function validateExplicitExtensionPackage(input: unknown): StaticPackageValidation {
    const issues: ExtensionPackageIssue[] = [];
    const parsed = parseInput(input, issues);
    const compatibility: StaticPackageValidation['compatibility'] = {
        minAppVersion: 'not_checked',
        backend: 'not_checked',
        frontend: 'not_checked',
        kernel: parsed.type === 'plugin' ? 'not_checked' : 'not_applicable',
    };
    const executableSurfaces: string[] = [];
    let packageIdentity: StaticPackageValidation['packageIdentity'];
    let staticSignals: StaticPackageValidation['staticSignals'];

    if (parsed.manifest) {
        const { manifest } = parsed;
        const name = manifest.name;
        if (typeof name !== 'string' || !name.trim()) {
            addIssue(issues, 'error', 'package.manifest.name', 'name is required and must be a non-empty string.');
        } else {
            const normalizedName = name.trim();
            packageIdentity = {
                manifestName: normalizedName,
                ...(parsed.type === 'plugin' ? {
                    pluginMcpPrefix: `plugin__${sanitizeSiYuanPluginName(normalizedName)}__`,
                } : {}),
            };
            if (/[\\/\0]/.test(normalizedName)) {
                addIssue(issues, 'error', 'package.manifest.name', 'name must not contain a path separator or NUL character.');
            } else if (!/^[A-Za-z0-9_.-]+$/.test(normalizedName)) {
                addIssue(issues, 'warning', 'package.manifest.name', 'name contains characters that SiYuan will sanitize before forming plugin MCP tool names.');
            }
        }

        for (const field of ['author', 'url', 'version', 'minAppVersion'] as const) {
            const value = manifest[field];
            if (value !== undefined && typeof value !== 'string') {
                addIssue(issues, 'error', `package.manifest.${field}`, `${field} must be a string when supplied.`);
            }
        }
        for (const field of ['author', 'url', 'version'] as const) {
            if (manifest[field] === undefined) {
                addIssue(issues, 'warning', `package.manifest.${field}`, `${field} is absent.`);
            }
        }

        if (typeof manifest.version === 'string' && manifest.version && !parseVersion(manifest.version)) {
            addIssue(issues, 'warning', 'package.manifest.version', 'version is not semver-like.');
        }

        const minAppVersion = typeof manifest.minAppVersion === 'string' ? manifest.minAppVersion.trim() : '';
        if (minAppVersion) {
            const minimum = parseVersion(minAppVersion);
            if (!minimum) {
                compatibility.minAppVersion = 'invalid';
                addIssue(issues, 'warning', 'package.manifest.minAppVersion', 'minAppVersion is not semver-like, so compatibility cannot be checked.');
            } else if (parsed.runtime.appVersion) {
                const running = parseVersion(parsed.runtime.appVersion);
                if (!running) {
                    addIssue(issues, 'warning', 'runtime.appVersion', 'appVersion is not semver-like, so minAppVersion compatibility cannot be checked.');
                } else if (compareVersions(minimum, running) > 0) {
                    compatibility.minAppVersion = 'incompatible';
                    addIssue(issues, 'error', 'package.manifest.minAppVersion', `minAppVersion ${minAppVersion} is newer than runtime.appVersion ${parsed.runtime.appVersion}.`);
                } else {
                    compatibility.minAppVersion = 'compatible';
                }
            }
        } else if (parsed.runtime.appVersion) {
            compatibility.minAppVersion = 'compatible';
        }

        for (const field of ['displayName', 'description', 'readme'] as const) {
            validateLocaleMap(manifest, field, issues);
        }

        const keywords = stringArray(manifest, 'keywords', issues);
        void keywords;
        const backends = stringArray(manifest, 'backends', issues);
        const frontends = stringArray(manifest, 'frontends', issues);
        const kernels = stringArray(manifest, 'kernels', issues);
        const modes = stringArray(manifest, 'modes', issues);

        compatibility.backend = targetCompatibility('backends', backends, parsed.runtime.backend);
        compatibility.frontend = targetCompatibility('frontends', frontends, parsed.runtime.frontend);
        if (compatibility.backend === 'incompatible') {
            addIssue(issues, 'warning', 'package.manifest.backends', `backends does not include runtime.backend ${JSON.stringify(parsed.runtime.backend)} or "all".`);
        }
        if (compatibility.frontend === 'incompatible') {
            addIssue(issues, 'warning', 'package.manifest.frontends', `frontends does not include runtime.frontend ${JSON.stringify(parsed.runtime.frontend)} or "all".`);
        }

        for (const field of RUNTIME_DERIVED_MANIFEST_FIELDS) {
            if (field in manifest) {
                addIssue(issues, 'warning', `package.manifest.${field}`, `${field} is runtime-derived and should not be authored as local package metadata.`);
            }
        }

        if (parsed.type === 'theme') {
            if (!modes || modes.length === 0 || !modes.some((mode) => mode === 'light' || mode === 'dark')) {
                addIssue(issues, 'error', 'package.manifest.modes', 'a theme must declare at least one usable mode: light or dark.');
            }
            for (const mode of modes ?? []) {
                if (mode !== 'light' && mode !== 'dark') {
                    addIssue(issues, 'warning', 'package.manifest.modes', `unknown theme mode ${JSON.stringify(mode)}; current source classifies light and dark.`);
                }
            }
        }

        if (parsed.type === 'plugin' && 'kernel.js' in parsed.files) {
            compatibility.kernel = targetCompatibility('kernels', kernels, parsed.runtime.backend);
            if (!kernels || kernels.length === 0) {
                compatibility.kernel = 'incompatible';
                addIssue(issues, 'warning', 'package.manifest.kernels', 'kernel.js is present but kernels is empty; SiYuan will not treat the kernel plugin as compatible.');
            } else if (compatibility.kernel === 'incompatible') {
                addIssue(issues, 'warning', 'package.manifest.kernels', `kernels does not include runtime.backend ${JSON.stringify(parsed.runtime.backend)} or "all".`);
            }
        }
    }

    const requiredFiles: Record<ExtensionPackageType, string> = {
        theme: 'theme.css',
        widget: 'index.html',
        plugin: 'index.js',
    };
    if (parsed.type !== 'unknown') {
        const requiredFile = requiredFiles[parsed.type];
        if (!(requiredFile in parsed.files)) {
            issues.push({
                code: 'required_entry_missing',
                severity: 'error',
                field: `package.files.${requiredFile}`,
                message: `${requiredFile} is required for a usable ${parsed.type} package.`,
            });
        } else if (!parsed.files[requiredFile].trim()) {
            issues.push({
                code: 'required_entry_blank',
                severity: 'error',
                field: `package.files.${requiredFile}`,
                message: `${requiredFile} is required and must contain non-whitespace ${parsed.type} entry content.`,
            });
        }
    }

    if (parsed.type === 'theme' && 'theme.js' in parsed.files) {
        executableSurfaces.push('theme.js');
    }
    if (parsed.type === 'widget') {
        executableSurfaces.push('widget package (same-origin authenticated application)');
    }
    if (parsed.type === 'plugin') {
        if ('index.js' in parsed.files) executableSurfaces.push('index.js');
        if ('kernel.js' in parsed.files) executableSurfaces.push('kernel.js');
        const indexJs = parsed.files['index.js'] ?? '';
        const kernelJs = parsed.files['kernel.js'] ?? '';
        const registerCalls = countMcpCall(kernelJs, 'registerTool');
        const unregisterCalls = countMcpCall(kernelJs, 'unregisterTool');
        staticSignals = {
            frontendOnUnload: !indexJs ? 'not_applicable' : /\bonunload\s*\(/.test(indexJs) ? 'detected' : 'not_detected',
            kernelMcpRegistrationCalls: registerCalls,
            kernelMcpUnregistrationCalls: unregisterCalls,
        };
        if (indexJs && !/extends\s+Plugin|require\s*\(\s*["']siyuan["']\s*\)/.test(indexJs)) {
            addIssue(issues, 'warning', 'package.files.index.js', 'index.js does not visibly import or extend the SiYuan Plugin API; bundled code may still be valid.');
        }
        if (registerCalls > 0 && unregisterCalls === 0) {
            addIssue(issues, 'warning', 'package.files.kernel.js', 'kernel.js registers MCP tools but has no explicit unregisterTool call. Kernel stop cleanup may still clear them, so refresh the registry after disable or reload.');
        }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.length - errors;
    return {
        kind: 'static_extension_package_validation',
        packageType: parsed.type,
        staticPackage: errors === 0 ? 'valid' : 'invalid',
        issues,
        summary: { errors, warnings },
        ...(packageIdentity ? { packageIdentity } : {}),
        compatibility,
        executableSurfaces,
        lifecycle: {
            trustReview: executableSurfaces.length > 0 ? 'required' : 'not_applicable',
            frontendPluginLoaded: 'not_observed',
            kernelPluginRunning: 'not_observed',
            mcpToolRegistration: 'not_observed',
            mcpToolUnregistration: 'not_observed',
            reload: 'not_triggered',
            functionAfterReload: 'not_verified',
        },
        ...(staticSignals ? { staticSignals } : {}),
        limitations: [
            'This validates only caller-supplied metadata and in-memory file content. It never reads a package path, installs a package, changes trust, enables a plugin, or reloads SiYuan.',
            'Static validity and executable-surface detection do not prove package provenance, user trust, runtime discovery, frontend loading, kernel startup, MCP registration, cleanup, reload, or feature behavior.',
            'Use diagnose_plugin_mcp after an independently performed lifecycle change to read back the official plugin MCP registry. A registry readback still does not invoke a tool or verify frontend/UI behavior.',
        ],
    };
}
