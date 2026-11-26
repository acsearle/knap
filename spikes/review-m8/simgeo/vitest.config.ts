// Scratch config for reviewer simgeo (milestone 8): npx vitest run --config spikes/review-m8/simgeo/vitest.config.ts <filter>
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: resolve(__dirname, '../../..'),
  test: { include: ['spikes/review-m8/simgeo/*.test.ts'], environment: 'node', testTimeout: 3600000, fileParallelism: false },
});
