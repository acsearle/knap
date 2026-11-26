import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['spikes/review-m9/truth/*.mut.test.ts'], environment: 'node', testTimeout: 300000 } });
