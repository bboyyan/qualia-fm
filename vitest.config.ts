import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@qualia/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'test' },
  },
});
