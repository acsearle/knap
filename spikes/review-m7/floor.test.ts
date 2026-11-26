// Item 2: the floor plane vs the lowest collider point, every orientation, flat and tilted; energy at t = 0+.
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts floor
import { it } from 'vitest';
import { floorCases, initialGap, popEnergy } from './floorlib';
import { logger } from './lib';

const log = logger('floor');

it('initial gap (+ floating, − penetrating) and t = 0+ kinetic energy', async () => {
  for (const c of floorCases())
    for (const slope of [0, 5, 15]) {
      const g = await initialGap(c.m, slope);
      const e = await popEnergy(c.m, slope);
      log(`${c.label} slope ${slope}: gap ${g.gap.toExponential(2)} (lowest: ${g.which}), view floor − sim plane ${g.viewMinusSim === null ? '-' : g.viewMinusSim.toExponential(2)}, max KE in first 0.05 s ${e.ke.toExponential(2)} (m g·0.01 = ${e.scale.toExponential(2)}), fall of the lowest point in 0.05 s ${e.drop.toExponential(2)}`);
    }
}, 1800000);
