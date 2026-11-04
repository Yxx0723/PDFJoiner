import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // The core engine (page ranges, merge, formatting) is DOM-free and is
    // tested in a plain Node environment. Component tests opt into jsdom via
    // a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    reporters: ['default'],
    testTimeout: 30000,
  },
});
