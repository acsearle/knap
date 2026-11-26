// Own config for the review sweeps: `npx vitest run --config spikes/review-wheels/vitest.config.ts`.
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: __dirname,
  test: { include: ['*.test.ts'], environment: 'node', testTimeout: 1800000 },
});
