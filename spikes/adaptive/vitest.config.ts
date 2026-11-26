// Runs the existing physics tests against spikes/adaptive/sim.ts (inner step dt/k from env KNAP_K).
// Usage (from the repo root): KNAP_K=4 npx vitest run --config spikes/adaptive/vitest.config.ts tests/physics/pendulum.test.ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const REAL = resolve(__dirname, '../../src/physics/sim.ts');
const COPY = resolve(__dirname, 'sim.ts');

export default defineConfig({
  root: resolve(__dirname, '../..'),
  plugins: [
    {
      name: 'swap-sim',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (!importer || importer === COPY) return null;
        const r = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (r && r.id.split('?')[0] === REAL) return COPY;
        return null;
      },
    },
  ],
  test: {
    include: ['tests/physics/**/*.test.ts', 'spikes/adaptive/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600000,
  },
});
