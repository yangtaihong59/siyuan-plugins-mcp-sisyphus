import { resolve } from "path"
import { defineConfig, loadEnv } from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy"
import livereload from "rollup-plugin-livereload"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import zipPack from "vite-plugin-zip-pack";
import fg from 'fast-glob';

import vitePluginYamlI18n from './yaml-plugin';

const env = process.env;
const isSrcmap = env.VITE_SOURCEMAP === 'inline';
const isDev = env.NODE_ENV === 'development';

const outputDir = isDev ? "dev" : "dist";

console.log("isDev=>", isDev);
console.log("isSrcmap=>", isSrcmap);
console.log("outputDir=>", outputDir);

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        }
    },

    plugins: [
        svelte(),

        vitePluginYamlI18n({
            inDir: 'public/i18n',
            outDir: `${outputDir}/i18n`
        }),

        viteStaticCopy({
            targets: [
                { src: "./README*.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },
                { src: "./preview.png", dest: "./" },
                { src: "./icon.png", dest: "./" }
            ],
        }),

    ],

    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
    },

    build: {
        outDir: outputDir,
        emptyOutDir: false,
        minify: true,
        sourcemap: isSrcmap ? 'inline' : false,

        lib: {
            entry: {
                index: resolve(__dirname, "src/index.ts"),
                "mcp-server": resolve(__dirname, "src/mcp/server.ts"),
            },
            fileName: "[name]",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: [
                ...(isDev ? [
                    livereload(outputDir),
                    {
                        name: 'watch-external',
                        async buildStart() {
                            const files = await fg([
                                'public/i18n/**',
                                './README*.md',
                                './plugin.json'
                            ]);
                            for (let file of files) {
                                this.addWatchFile(file);
                            }
                        }
                    },
                    {
                        name: 'remove-livereload-from-node',
                        enforce: 'post', // Execute after livereload plugin
                        renderChunk(code, chunk) {
                            // Remove livereload script injection from mcp-server.cjs (Node.js bundle)
                            // Check if this is the mcp-server chunk or if code contains livereload + self.document
                            const isMcpServer = chunk.name === 'mcp-server';
                            const hasLivereload = code.includes('livereload') && code.includes('self.document');
                            
                            if (isMcpServer || hasLivereload) {
                                // Remove livereload script injection pattern
                                // Pattern: (function(e,t){...livereload...})(self.document);
                                const livereloadPattern = /\(function\([^)]*\)\{[^}]*livereload[^}]*\}\)\(self\.document\);/g;
                                const cleanedCode = code.replace(livereloadPattern, '');
                                if (cleanedCode !== code) {
                                    console.log(`[remove-livereload] Removed livereload code from chunk: ${chunk.name || 'unknown'}`);
                                }
                                return {
                                    code: cleanedCode,
                                    map: null
                                };
                            }
                        },
                        generateBundle(options, bundle) {
                            // Also clean up in generateBundle as a fallback (after all chunks are generated)
                            for (const [fileName, chunkOrAsset] of Object.entries(bundle)) {
                                if (fileName === 'mcp-server.cjs' && chunkOrAsset.type === 'chunk') {
                                    const livereloadPattern = /\(function\([^)]*\)\{[^}]*livereload[^}]*\}\)\(self\.document\);/g;
                                    const originalCode = chunkOrAsset.code;
                                    chunkOrAsset.code = originalCode.replace(livereloadPattern, '');
                                    if (chunkOrAsset.code !== originalCode) {
                                        console.log('[remove-livereload] Removed livereload code from mcp-server.cjs in generateBundle');
                                    }
                                }
                            }
                        }
                    }
                ] : [
                    // Clean up unnecessary files under dist dir
                    cleanupDistFiles({
                        patterns: ['i18n/*.yaml', 'i18n/*.md', 'mcp-server.js'],
                        distDir: outputDir
                    }),
                    zipPack({
                        inDir: './dist',
                        outDir: './',
                        outFileName: 'package.zip'
                    })
                ])
            ],

            external: ["siyuan", "process", "path", "fs", "node:path", "node:fs"],

            output: {
                entryFileNames: (chunkInfo) => chunkInfo.name === "mcp-server" ? "mcp-server.cjs" : "[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") {
                        return "index.css"
                    }
                    return assetInfo.name
                },
            },
        },
    }
});


/**
 * Clean up some dist files after compiled
 * @author frostime
 * @param options:
 * @returns 
 */
function cleanupDistFiles(options: { patterns: string[], distDir: string }) {
    const {
        patterns,
        distDir
    } = options;

    return {
        name: 'rollup-plugin-cleanup',
        enforce: 'post',
        writeBundle: {
            sequential: true,
            order: 'post' as 'post',
            async handler() {
                const fg = await import('fast-glob');
                const fs = await import('fs');
                // const path = await import('path');

                // 使用 glob 语法，确保能匹配到文件
                const distPatterns = patterns.map(pat => `${distDir}/${pat}`);
                console.debug('Cleanup searching patterns:', distPatterns);

                const files = await fg.default(distPatterns, {
                    dot: true,
                    absolute: true,
                    onlyFiles: false
                });

                // console.info('Files to be cleaned up:', files);

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
            }
        }
    };
}
