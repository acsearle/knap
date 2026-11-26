// Scratch config for the gear-physics baseline (spikes/gearphys): runs spikes/gearphys/*.test.ts.
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: resolve(__dirname, '../..'),
  test: { include: ['spikes/gearphys/*.test.ts'], environment: 'node', testTimeout: 600000 },
});
