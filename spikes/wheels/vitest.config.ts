// Own config for the spike's tests: `npx vitest run --config spikes/wheels/vitest.config.ts`.
// (The repo's vitest.config.ts includes only tests/**/*.test.ts, so `npm test` never runs these.)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  test: { include: ['*.test.ts'], environment: 'node', testTimeout: 60000 },
});
