// Own config: `npx vitest run --config spikes/gearlook/vitest.config.ts` (npm test never runs these).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  test: { include: ['*.test.ts'], environment: 'node', testTimeout: 600000 },
});
