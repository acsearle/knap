// Mechanisms whose pivots carry more than one link, at the default friction level (fix after review:
// with m_j = the lighter body, a pivot carrying a chain got the friction of one link and these swung
// for minutes — a 15-hole beam on a 2-hole link for ≈ 145 s, a 12-link chain for > 150 s). The load
// estimate is now the weight each joint carries (DEVIATIONS §5 "Joint friction: load estimate").
// Every run must come to rest, and then stay there (stiction hold).
import { describe, expect, it } from 'vitest';
import { ModelBuilder, beam, buildExample, pin } from '../../src/core/examples';
import type { Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { report } from './helpers';

/** Serial chain hanging from a fixed beam at the origin: links of `lens` holes along +x, one layer further out each. */
function chain(lens: number[]): Model {
  const b = new ModelBuilder();
  const frame = b.add(beam([-2, 0, 0], [0, 0, 0]));
  let x = 0;
  lens.forEach((L, i) => {
    b.add(beam([x, 0, i + 1], [x + L - 1, 0, i + 1]));
    b.add(pin([x, 0, i], [x, 0, i + 1]));
    x += L - 1;
  });
  return b.root(frame).build();
}

/** n 3-hole links alternating between layers 1 and 2 (a long chain). */
function linkChain(n: number): Model {
  const b = new ModelBuilder();
  const f = b.add(beam([-2, 0, 0], [0, 0, 0]));
  for (let i = 0; i < n; i++) {
    const z = i % 2 === 0 ? 1 : 2;
    b.add(beam([2 * i, 0, z], [2 * i + 2, 0, z]));
  }
  b.add(pin([0, 0, 0], [0, 0, 1]));
  for (let i = 1; i < n; i++) b.add(pin([2 * i, 0, 1], [2 * i, 0, 2]));
  return b.root(f).build();
}

/**
 * Time (s) at the end of the last 0.5 s window in which any dynamic body turned by more than 1e-3
 * rad, and the largest turn of any body over the `hold` s after `bound` (it must be at rest by then).
 */
async function restAndHold(model: Model, bound: number, hold = 5): Promise<{ restAt: number; after: number }> {
  const s = await Simulation.create(model);
  const dyn = s.graph.bodies.filter((b) => !b.fixed).map((b) => b.id);
  const pose = () => dyn.map((id) => s.bodyTransform(id)!.q);
  const turn = (a: number[][], b: number[][]) =>
    Math.max(...a.map((qa, i) => 2 * Math.acos(Math.min(1, Math.abs(qa.reduce((acc, x, k) => acc + x * b[i]![k]!, 0))))));
  const win = Math.round(0.5 / s.fixedDt);
  let prev = pose();
  let restAt = 0;
  for (let i = 1; i <= Math.round(bound / 0.5); i++) {
    s.stepFixed(win);
    const cur = pose();
    if (turn(prev, cur) > 1e-3) restAt = s.time;
    prev = cur;
  }
  const at = pose();
  s.stepFixed(Math.round(hold / s.fixedDt));
  const after = turn(at, pose());
  s.dispose();
  return { restAt, after };
}

const CASES: { name: string; model: () => Model; bound: number }[] = [
  // Measured rest (s) at "realistic" after the fix → bound: triple pendulum 6.5 (was 17) → 8;
  // 15-hole on 2-hole 22.0 (never in 120 s) → 30; 2-hole + 15-hole chain 22.0 → 30; 5 + 5 8.5 → 15;
  // six 3-hole links 13.0 → 20; three 9-hole links 37.0 (62.5) → 45; twelve 3-hole links 32.0 (> 150) → 40.
  { name: 'triple-pendulum example', model: () => buildExample('triple-pendulum'), bound: 8 },
  {
    name: '15-hole beam hung from a 2-hole link',
    model: () => {
      const b = new ModelBuilder();
      const f = b.add(beam([-2, 0, 0], [0, 0, 0]));
      b.add(beam([0, 0, 1], [1, 0, 1]));
      b.add(beam([1, 0, 2], [15, 0, 2]));
      b.add(pin([0, 0, 0], [0, 0, 1]));
      b.add(pin([1, 0, 1], [1, 0, 2]));
      return b.root(f).build();
    },
    bound: 30,
  },
  { name: 'double pendulum 5 + 5', model: () => chain([5, 5]), bound: 15 },
  { name: 'three 9-hole links', model: () => chain([9, 9, 9]), bound: 45 },
  { name: 'six 3-hole links', model: () => linkChain(6), bound: 20 },
  { name: 'twelve 3-hole links', model: () => linkChain(12), bound: 40 },
];

describe('chains come to rest at the default level and stay there', () => {
  for (const c of CASES)
    it(`${c.name}: at rest by ${c.bound} s`, { timeout: 300000 }, async () => {
      const r = await restAndHold(c.model(), c.bound);
      report(`chain ${c.name} (realistic): at rest from ${r.restAt.toFixed(1)} s; then turns ${r.after.toExponential(1)} rad in 5 s`);
      expect(r.restAt).toBeLessThan(c.bound - 0.5);
      expect(r.after).toBeLessThan(1e-4);
    });
});
