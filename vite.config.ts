import { readFileSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import zipPack from "vite-plugin-zip-pack";
import fg from "fast-glob";

import vitePluginYamlI18n from "./yaml-plugin";

const env = process.env;
const isSrcmap = env.VITE_SOURCEMAP === "inline";
const isDev = env.NODE_ENV === "development";

const outputDir = isDev ? "dev" : "dist";
const cliOutputDir = "cli/dist";
const mcpAppOutputDir = ".mcp-app-dist";
const mcpAppHtmlPath = resolve(__dirname, mcpAppOutputDir, "index.html");

const serverExternals = [
    "siyuan",
    "process",
    "node:process",
    "path",
    "fs",
    "node:path",
    "node:fs",
    "child_process",
    "node:child_process",
    "node:http",
    "node:crypto",
    "http",
    "crypto",
    "stream",
    "node:stream",
    "http2",
    "node:http2",
    "url",
    "node:url",
    "buffer",
    "node:buffer",
    "events",
    "node:events",
    "net",
    "node:net",
    "tls",
    "node:tls",
    "zlib",
    "node:zlib",
    "querystring",
    "node:querystring",
];

const cliExtraExternals = [
    "os",
    "node:os",
    "readline",
    "node:readline",
];

const validTargets = ["renderer", "server", "cli", "mcp-app"] as const;
type BuildTarget = typeof validTargets[number];
const buildTarget: BuildTarget = (validTargets as readonly string[]).includes(env.BUILD_TARGET ?? "")
    ? (env.BUILD_TARGET as BuildTarget)
    : "renderer";
const pluginVersion = readPluginVersion();

console.log("isDev=>", isDev);
console.log("isSrcmap=>", isSrcmap);
console.log("outputDir=>", outputDir);
console.log("buildTarget=>", buildTarget);

export default defineConfig(() => {
    switch (buildTarget) {
        case "server": return createServerConfig();
        case "cli": return createCliConfig();
        case "mcp-app": return createMcpAppConfig();
        default: return createRendererConfig();
    }
});

function createRendererConfig() {
    return {
        resolve: {
            alias: {
                "@": resolve(__dirname, "src"),
            },
        },
        plugins: [
            svelte(),
            vitePluginYamlI18n({
                inDir: "public/i18n",
                outDir: `${outputDir}/i18n`,
            }),
            viteStaticCopy({
                targets: [
                    { src: "./README.md", dest: "./" },
                    { src: "./README_zh_CN.md", dest: "./" },
                    { src: "./assets/architecture.svg", dest: "./assets" },
                    { src: "./assets/architecture_zh_CN.svg", dest: "./assets" },
                    { src: "./plugin.json", dest: "./" },
                    { src: "./preview.png", dest: "./" },
                    { src: "./icon.png", dest: "./" },
                ],
            }),
        ],
        define: {
            "process.env.DEV_MODE": JSON.stringify(isDev),
            "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV),
            __PLUGIN_VERSION__: JSON.stringify(pluginVersion),
        },
        build: {
            outDir: outputDir,
            emptyOutDir: !isDev,
            minify: true,
            sourcemap: isSrcmap ? "inline" : false,
            lib: {
                entry: resolve(__dirname, "src/index.ts"),
                fileName: () => "index",
                formats: ["cjs"],
            },
            rollupOptions: {
                external: ["siyuan"],
                plugins: [
                    ...(isDev
                        ? [
                            {
                                name: "watch-external",
                                async buildStart() {
                                    const files = await fg([
                                        "public/i18n/**",
                                        "./README.md",
                                        "./README_zh_CN.md",
                                        "./assets/architecture.svg",
                                        "./assets/architecture_zh_CN.svg",
                                        "./plugin.json",
                                    ]);
                                    for (const file of files) {
                                        this.addWatchFile(file);
                                    }
                                },
                            },
                        ]
                        : []),
                    assertNoLocalRequire("index.js"),
                ],
                output: {
                    inlineDynamicImports: true,
                    entryFileNames: "index.js",
                    assetFileNames: (assetInfo) => {
                        if (assetInfo.name === "style.css") {
                            return "index.css";
                        }
                        return assetInfo.name ?? "[name][extname]";
                    },
                },
            },
        },
    };
}

function createServerConfig() {
    return {
        resolve: {
            // The MCP SDK exposes separate browser/workerd/node shims. Vite's
            // default `browser` condition otherwise wins while bundling the
            // Node server and makes the stdio transport throw at startup.
            alias: {
                "@": resolve(__dirname, "src"),
            },
            conditions: ["node", "default"],
        },
        plugins: [
            mcpAppHtmlModule(),
            {
                name: "mcp-shims-node-resolve",
                enforce: "pre" as const,
                resolveId(source) {
                    if (source === "@modelcontextprotocol/server/_shims") {
                        return { id: "\0virtual:mcp-shims-node", moduleSideEffects: false };
                    }
                    return null;
                },
                load(id) {
                    if (id !== "\0virtual:mcp-shims-node") return null;
                    return [
                        'import process from "node:process";',
                        'import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv";',
                        "export { process };",
                        "export const DefaultJsonSchemaValidator = AjvJsonSchemaValidator;",
                    ].join("\n");
                },
            },
        ],
        define: {
            "process.env.DEV_MODE": JSON.stringify(isDev),
            "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV),
            __PLUGIN_VERSION__: JSON.stringify(pluginVersion),
        },
        build: {
            outDir: outputDir,
            emptyOutDir: false,
            minify: true,
            sourcemap: isSrcmap ? "inline" : false,
            lib: {
                entry: resolve(__dirname, "src/core/server.ts"),
                fileName: () => "mcp-server",
                formats: ["cjs"],
            },
            rollupOptions: {
                external: serverExternals,
                plugins: [
                    ...(isDev
                        ? [
                            {
                                name: "remove-livereload-from-node",
                                enforce: "post" as const,
                                renderChunk(code, chunk) {
                                    const isMcpServer = chunk.name === "mcp-server";
                                    const hasLivereload = code.includes("livereload") && code.includes("self.document");

                                    if (isMcpServer || hasLivereload) {
                                        const livereloadPattern = /\(function\([^)]*\)\{[^}]*livereload[^}]*\}\)\(self\.document\);/g;
                                        const cleanedCode = code.replace(livereloadPattern, "");
                                        if (cleanedCode !== code) {
                                            console.log(`[remove-livereload] Removed livereload code from chunk: ${chunk.name || "unknown"}`);
                                        }
                                        return {
                                            code: cleanedCode,
                                            map: null,
                                        };
                                    }
                                },
                                generateBundle(_options, bundle) {
                                    for (const [fileName, chunkOrAsset] of Object.entries(bundle)) {
                                        if (fileName === "mcp-server.cjs" && chunkOrAsset.type === "chunk") {
                                            const livereloadPattern = /\(function\([^)]*\)\{[^}]*livereload[^}]*\}\)\(self\.document\);/g;
                                            const originalCode = chunkOrAsset.code;
                                            chunkOrAsset.code = originalCode.replace(livereloadPattern, "");
                                            if (chunkOrAsset.code !== originalCode) {
                                                console.log("[remove-livereload] Removed livereload code from mcp-server.cjs in generateBundle");
                                            }
                                        }
                                    }
                                },
                            },
                        ]
                        : [
                            cleanupDistFiles({
                                patterns: ["i18n/*.yaml", "i18n/*.md", "mcp-server.js"],
                                distDir: outputDir,
                            }),
                            zipPack({
                                inDir: `./${outputDir}`,
                                outDir: "./",
                                outFileName: "package.zip",
                            }),
                    ]),
                    assertNoLocalRequire("mcp-server.cjs"),
                    assertNodeMcpStdio("mcp-server.cjs"),
                ],
                output: {
                    inlineDynamicImports: true,
                    entryFileNames: "mcp-server.cjs",
                },
            },
        },
    };
}

function createMcpAppConfig() {
    return {
        root: resolve(__dirname, "src/mcp-apps"),
        publicDir: false as const,
        base: "./",
        resolve: {
            alias: {
                "@": resolve(__dirname, "src"),
            },
        },
        plugins: [viteSingleFile()],
        build: {
            outDir: resolve(__dirname, mcpAppOutputDir),
            emptyOutDir: true,
            minify: !isDev,
            sourcemap: isSrcmap ? "inline" : false,
            assetsInlineLimit: Number.MAX_SAFE_INTEGER,
            cssCodeSplit: false,
            rollupOptions: {
                input: resolve(__dirname, "src/mcp-apps/index.html"),
            },
        },
    };
}

function mcpAppHtmlModule() {
    const publicId = "virtual:siyuan-mcp-app-html";
    const resolvedId = `\0${publicId}`;
    return {
        name: "siyuan-mcp-app-html",
        resolveId(id: string) {
            return id === publicId ? resolvedId : undefined;
        },
        load(id: string) {
            if (id !== resolvedId) return undefined;
            this.addWatchFile(mcpAppHtmlPath);
            try {
                return `export default ${JSON.stringify(readFileSync(mcpAppHtmlPath, "utf8"))};`;
            } catch {
                throw new Error(`MCP App bundle not found at ${mcpAppHtmlPath}. Run npm run build:mcp-app before building the server.`);
            }
        },
    };
}

function readCliVersion(): string {
    try {
        const raw = readFileSync(resolve(__dirname, "cli/package.json"), "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.version === "string" ? parsed.version : "0.0.0";
    } catch {
        return "0.0.0";
    }
}

function readPluginVersion(): string {
    try {
        const raw = readFileSync(resolve(__dirname, "plugin.json"), "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.version === "string" ? parsed.version : "0.0.0";
    } catch {
        return "0.0.0";
    }
}

function createCliConfig() {
    const version = readCliVersion();
    return {
        publicDir: false as const,
        resolve: {
            conditions: ["node"],
            alias: {
                "@": resolve(__dirname, "src"),
            },
        },
        define: {
            "process.env.DEV_MODE": JSON.stringify(isDev),
            "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV),
            __CLI_VERSION__: JSON.stringify(version),
            __PLUGIN_VERSION__: JSON.stringify(pluginVersion),
        },
        build: {
            outDir: cliOutputDir,
            emptyOutDir: false,
            minify: true,
            sourcemap: isSrcmap ? "inline" : false,
            lib: {
                entry: resolve(__dirname, "src/cli/index.ts"),
                fileName: () => "cli",
                formats: ["cjs"] as const,
            },
            rollupOptions: {
                external: (id: string) => {
                    if (serverExternals.includes(id)) return true;
                    if (cliExtraExternals.includes(id)) return true;
                    return false;
                },
                plugins: [
                    copyCliSkills(),
                    shebangAndChmod(`${cliOutputDir}/cli.cjs`),
                ],
                output: {
                    inlineDynamicImports: true,
                    entryFileNames: "cli.cjs",
                    banner: "#!/usr/bin/env node",
                },
            },
        },
    };
}

function assertNodeMcpStdio(entryFileName: string) {
    const unsupportedMessage = "StdioServerTransport is not supported in this environment";
    return {
        name: `assert-node-mcp-stdio-${entryFileName}`,
        generateBundle(_options: unknown, bundle: Record<string, any>) {
            const entry = bundle[entryFileName];
            if (entry?.type === "chunk" && entry.code.includes(unsupportedMessage)) {
                this.error(`Browser MCP stdio shim leaked into ${entryFileName}; resolve the SDK with the node condition.`);
            }
        },
    };
}

function copyCliSkills() {
    return {
        name: "cli-copy-skills",
        writeBundle: {
            sequential: true,
            order: "post" as const,
            async handler() {
                const fs = await import("fs");
                const path = await import("path");
                for (const rootName of ["siyuan-sisyphus", "siyuan-mcp"]) {
                    const source = resolve(__dirname, "skills", rootName);
                    const target = resolve(__dirname, cliOutputDir, "skills", rootName);

                    if (!fs.default.existsSync(source)) {
                        console.warn(`[cli-copy-skills] source not found: ${source}`);
                        continue;
                    }

                    fs.default.rmSync(target, { recursive: true, force: true });
                    fs.default.mkdirSync(path.default.dirname(target), { recursive: true });
                    fs.default.cpSync(source, target, { recursive: true, force: true });
                    console.log(`[cli-copy-skills] copied ${source} -> ${target}`);
                }
            },
        },
    };
}

function shebangAndChmod(relPath: string) {
    return {
        name: "cli-shebang-chmod",
        writeBundle: {
            sequential: true,
            order: "post" as const,
            async handler() {
                const fs = await import("fs");
                const target = resolve(__dirname, relPath);
                if (fs.default.existsSync(target)) {
                    try {
                        fs.default.chmodSync(target, 0o755);
                        console.log(`[cli-shebang-chmod] chmod 755 ${target}`);
                    } catch (error) {
                        console.warn(`[cli-shebang-chmod] chmod failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            },
        },
    };
}

function assertNoLocalRequire(entryFileName: string) {
    const localRequirePattern = /require\((['"])\.\/[^'"]+\1\)/;

    return {
        name: `assert-no-local-require-${entryFileName}`,
        generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
            const entry = bundle[entryFileName];
            if (!entry || entry.type !== "chunk" || typeof entry.code !== "string") {
                return;
            }

            const match = entry.code.match(localRequirePattern);
            if (match) {
                throw new Error(`${entryFileName} emitted unexpected local require: ${match[0]}`);
            }
        },
    };
}

function cleanupDistFiles(options: { patterns: string[]; distDir: string }) {
    const { patterns, distDir } = options;

    return {
        name: "rollup-plugin-cleanup",
        enforce: "post" as const,
        writeBundle: {
            sequential: true,
            order: "post" as const,
            async handler() {
                const fastGlob = await import("fast-glob");
                const fs = await import("fs");

                const distPatterns = patterns.map((pat) => `${distDir}/${pat}`);
                console.debug("Cleanup searching patterns:", distPatterns);

                const files = await fastGlob.default(distPatterns, {
                    dot: true,
                    absolute: true,
                    onlyFiles: false,
                });

                for (const file of files) {
                    try {
                        if (fs.default.existsSync(file)) {
                            const stat = fs.default.statSync(file);
                            if (stat.isDirectory()) {
                                fs.default.rmSync(file, { recursive: true });
                            } else {
                                fs.default.unlinkSync(file);
                            }
                            console.log(`Cleaned up: ${file}`);
                        }
                    } catch (error) {
                        console.error(`Failed to clean up ${file}:`, error);
                    }
                }
            },
        },
    };
}
