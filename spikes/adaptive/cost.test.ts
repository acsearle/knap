// Cost per simulated second against k: every built-in example (and the cart and a 20-link chain),
// k = 1, 2, 4, 8 interleaved in rounds, 1 simulated second each after 0.25 s of warm-up.
// Reports ms per simulated second in total, inside world.step ("Rapier"), and the rest ("JS").
// Run: npx vitest run --config spikes/adaptive/vitest.config.ts spikes/adaptive/cost.test.ts
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { EXAMPLES, buildExample } from '../../src/core/examples';
import { cart } from '../../tests/physics/wheelModels';
import { Simulation } from './sim';

const OUT = process.env.OUT ?? 'spikes/adaptive/out/cost.jsonl';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const KS = (process.env.KS ?? '1,2,4,8').split(',').map(Number);

it('cost', async () => {
  writeFileSync(OUT, '');
  const models = [...EXAMPLES.map((e) => ({ name: e.name, m: buildExample(e.name) })), { name: 'cart', m: cart(1.5).model }];
  for (let r = 0; r < ROUNDS; r++) {
    for (const { name, m } of models) {
      const order = r % 2 ? [...KS].reverse() : KS;
      for (const k of order) {
        const s = await Simulation.create(m, { substeps: k });
        s.stepFixed(120);
        s.tTotal = 0;
        s.tWorld = 0;
        const t0 = s.time;
        s.stepFixed(480);
        const simS = s.time - t0;
        const o = { round: r, name, k, bodies: s.graph.bodies.length, joints: s.graph.joints.length, total: +(s.tTotal / simS).toFixed(1), rapier: +(s.tWorld / simS).toFixed(1), js: +((s.tTotal - s.tWorld) / simS).toFixed(1) };
        appendFileSync(OUT, JSON.stringify(o) + '\n');
        s.dispose();
      }
    }
  }
});
