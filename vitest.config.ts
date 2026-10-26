import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Cold dynamic imports of the kernel/server graph can exceed the 10s default under full parallel load.
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.svelte'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'siyuan': path.resolve(__dirname, './tests/mocks/siyuan.ts'),
      'virtual:siyuan-mcp-app-html': path.resolve(__dirname, './tests/fixtures/mcp-app-html.ts'),
    },
  },
});
