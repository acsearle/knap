// Own config for the m7 verification sweeps: `npx vitest run --config spikes/review-m7/vitest.config.ts [filter]`.
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: __dirname,
  test: { include: ['*.test.ts'], environment: 'node', testTimeout: 1800000, fileParallelism: false },
});
