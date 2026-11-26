// Baseline hashes of wheel models (no gears) from the sources at 2d3372a (spikes/gearphys/base,
// extracted with git archive). Run: npx vitest run --config spikes/gearphys/vitest.config.ts baseline
import { it } from 'vitest';
import { Simulation } from './base/src/physics/sim';
import { buildExample } from './base/src/core/examples';
import { trajHash } from './hashlib';
import { cart, looseWheel } from './wheelModelsBase';

it('baseline', async () => {
  const out: Record<string, string> = {};
  for (const name of ['crank-wheel', 'cart'])
    for (const mu of [0, 0.2]) {
      const s = await Simulation.create(buildExample(name), { jointFriction: mu });
      out[`${name}@${mu}`] = trajHash(s, 1440, 8);
      s.dispose();
    }
  {
    const c = cart(1.5);
    const s = await Simulation.create(c.model, { jointFriction: 0 });
    for (const b of s.graph.bodies) if (!b.fixed) s.setBodyVelocity(b.id, [40, 0, 0], c.wheels.map((w) => s.bodyOf(w)).includes(b.id) ? [0, 0, -40 / 1.46] : [0, 0, 0]);
    out['cart-push@0'] = trajHash(s, 960, 8);
    s.dispose();
  }
  {
    const s = await Simulation.create(looseWheel(2.5, 0), {});
    s.setBodyVelocity(0, [0, 30, 0], [5, 20, 0]);
    out['loose-wheel-toss'] = trajHash(s, 960, 8);
    s.dispose();
  }
  console.log('BASELINE ' + JSON.stringify(out));
});
