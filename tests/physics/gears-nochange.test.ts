// DESIGN §5.3 "Gears": no gears, no change. With no engaged mesh k = 1 and the simulation must be
// bit-identical to the code before gears existed. The friction-off example hashes are checked in
// friction.test.ts; this file checks the models with wheels and a ground (collision groups, wheel
// colliders, ground plane, sinks) against hashes recorded from the sources at commit 2d3372a
// (spikes/gearphys/baseline.test.ts runs those sources, extracted with `git archive 2d3372a src`).
import { describe, expect, it } from 'vitest';
import { buildExample } from '../../src/core/examples';
import { Simulation } from '../../src/physics/sim';
import { trajHash } from './gearModels';
import { cart, looseWheel } from './wheelModels';

/** trajHash(sim, steps, 8) recorded by spikes/gearphys/baseline.test.ts from 2d3372a. */
const BASELINE: Record<string, string> = {
  'crank-wheel@0': 'd1ca4dbbd192506e',
  'crank-wheel@0.2': 'e07e88a5ab8e9188',
  'cart@0': '794d1a08071b6f2d',
  'cart@0.2': '10120a76f52e5537',
  'cart-push@0': 'f9dd6d2d9ce16f3e',
  'loose-wheel-toss': 'cdff938e9ee9eb4d',
};

describe('no gears, no change (wheels and ground, against 2d3372a)', () => {
  it('crank wheel and cart examples at friction off and realistic', { timeout: 300000 }, async () => {
    for (const name of ['crank-wheel', 'cart'])
      for (const mu of [0, 0.2]) {
        const s = await Simulation.create(buildExample(name), { jointFriction: mu });
        expect(trajHash(s, 1440, 8), `${name}@${mu}`).toBe(BASELINE[`${name}@${mu}`]);
        expect(s.substeps).toBe(1);
        s.dispose();
      }
  });

  it('a pushed cart and a tossed loose wheel', { timeout: 300000 }, async () => {
    const c = cart(1.5);
    const s = await Simulation.create(c.model, { jointFriction: 0 });
    const wheelBodies = c.wheels.map((w) => s.bodyOf(w));
    for (const b of s.graph.bodies) if (!b.fixed) s.setBodyVelocity(b.id, [40, 0, 0], wheelBodies.includes(b.id) ? [0, 0, -40 / 1.46] : [0, 0, 0]);
    expect(trajHash(s, 960, 8)).toBe(BASELINE['cart-push@0']);
    s.dispose();
    const w = await Simulation.create(looseWheel(2.5, 0), {});
    w.setBodyVelocity(0, [0, 30, 0], [5, 20, 0]);
    expect(trajHash(w, 960, 8)).toBe(BASELINE['loose-wheel-toss']);
    w.dispose();
  });
});
