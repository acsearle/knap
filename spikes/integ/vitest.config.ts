// Scratch config for the milestone 8 integration measurements: runs spikes/integ/*.test.ts.
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: resolve(__dirname, '../..'),
  test: { include: ['spikes/integ/*.test.ts'], environment: 'node', testTimeout: 1200000 },
});
