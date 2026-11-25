// The energy guard (src/physics/sim.ts guardEnergy, DEVIATIONS §5 "Free rotation gains speed"):
// Rapier's f32 gyroscopic correction slowly spins bodies up, so a frictionless mechanism used to
// climb above its release height (an arm on an axle: +49 % of its peak KE in 60 s, vertical after
// 60 s). The guard caps the rise at energyGuardBand (1 %) of the peak kinetic energy, never adds
// energy, leaves mechanisms that do not gain untouched, and keeps work done by a grab and energy
// passed between parts in a collision.
import { describe, expect, it } from 'vitest';
import { EXAMPLES, axle, beam, bush, cell, pin } from '../../src/core/examples';
import type { Model } from '../../src/core/types';
import type { Simulation } from '../../src/physics/sim';
import { mk, report, sim, total, where } from './helpers';

/** Axle through the cross hole of a horizontal arm and a pin hole of the frame, bush behind: revolute about Z. */
const axleArm = (): Model =>
  mk([beam([-3, 0, 0], [0, 0, 0]), axle([0, 0, -2], [0, 0, 2]), [cell([0, 0, 1], 'axleHole', 2), ...beam([1, 0, 1], [4, 0, 1])], bush([0, 0, -1], 2)], 1);

/** Spatial chain: revolute about Y, then X, then Z (not a planar mechanism, inertia not decoupled). */
const spatial = (): Model =>
  mk(
    [
      beam([-2, 0, 0], [0, 0, 0], 1),
      [...beam([0, -1, 0], [2, -1, 0], 1), cell([3, -1, 0], 'pinHole', 0)],
      [...beam([4, -1, 0], [4, -3, 0], 0), cell([4, -4, 0], 'pinHole', 2)],
      beam([4, -4, 1], [7, -4, 1], 2),
      pin([0, 0, 0], [0, -1, 0]),
      pin([3, -1, 0], [4, -1, 0]),
      pin([4, -4, 0], [4, -4, 1]),
    ],
    1,
  );

/** Max rise of the total energy over `seconds`, from a reference taken after `settle` s, as a fraction of the peak KE. */
async function rise(model: Model, settle: number, seconds: number, energyGuard = true): Promise<number> {
  const s = await sim(model, { energyGuard, jointFriction: 0 });
  s.stepFixed(Math.round(settle / s.fixedDt));
  const e0 = total(s.energy());
  let eMax = e0;
  let kMax = 0;
  for (let i = 0; i < seconds * 60; i++) {
    s.stepFixed(8);
    const e = s.energy();
    kMax = Math.max(kMax, e.kinetic);
    eMax = Math.max(eMax, total(e));
  }
  s.dispose();
  return (eMax - e0) / kMax;
}

type Rb = { setLinvel(v: object, w: boolean): void };
const rbOf = (s: Simulation, id: number) => (s as unknown as { bodies: { rb: Rb }[] }).bodies[id]!.rb;

describe('energy guard', () => {
  const cases: [string, () => Model, number][] = [
    ['arm on an axle (axle-arm)', axleArm, 0],
    ['spatial chain Y/X/Z', spatial, 0],
    ['sliding-axle example, after its 2 s drop', () => EXAMPLES.find((e) => e.name === 'sliding-axle')!.build(), 2],
  ];
  for (const [label, f, settle] of cases)
    it(`${label}: energy rises by at most 1 % of the peak KE over 60 s`, { timeout: 120000 }, async () => {
      const r = await rise(f(), settle, 60);
      report(`energy guard, ${label}: rise over 60 s = ${(r * 100).toFixed(2)} % of KE_max`);
      expect(r).toBeLessThan(0.0125);
    });

  it('without the guard the arm on an axle gains energy (the defect it removes)', { timeout: 60000 }, async () => {
    const r = await rise(axleArm(), 0, 10, false);
    report(`no energy guard, axle-arm: rise over 10 s = ${(r * 100).toFixed(1)} % of KE_max`);
    expect(r).toBeGreaterThan(0.05);
  });

  it('leaves a mechanism that only loses energy untouched (triple pendulum, 10 s, bit-identical)', { timeout: 60000 }, async () => {
    const m = EXAMPLES.find((e) => e.name === 'triple-pendulum')!.build();
    const a = await sim(m, { jointFriction: 0 });
    const b = await sim(m, { energyGuard: false, jointFriction: 0 });
    a.stepFixed(4800);
    b.stepFixed(4800);
    expect(a.guardRemoved).toBe(0);
    for (const body of a.graph.bodies) expect(a.bodyTransform(body.id)).toEqual(b.bodyTransform(body.id));
    a.dispose();
    b.dispose();
  });

  it('keeps the work done by a grab: a pendulum pulled up and released swings with that energy', { timeout: 60000 }, async () => {
    const s = await sim(EXAMPLES.find((e) => e.name === 'pendulum')!.build(), { jointFriction: 0 });
    const link = s.bodyOf(2)!;
    for (let i = 0; i < 480; i++) s.stepFixed(1); // swing down first (reference = horizontal release)
    expect(s.grab(link, where(s, link, [4, 0, 1]))).toBe(true);
    s.dragTo([0, 4, 1]); // pull the link up to vertical, well above its release height
    s.stepFixed(480);
    s.release();
    const e1 = total(s.energy());
    let eMin = e1;
    let kMax = 0;
    for (let i = 0; i < 480; i++) {
      s.stepFixed(1);
      const e = s.energy();
      kMax = Math.max(kMax, e.kinetic);
      eMin = Math.min(eMin, total(e));
    }
    report(`energy guard, grab: energy after release min ${(((eMin - e1) / kMax) * 100).toFixed(2)} % of KE_max`);
    expect((e1 - eMin) / kMax).toBeLessThan(0.02);
    s.dispose();
  });

  it('keeps energy passed between parts in a collision (groups that touch are merged)', { timeout: 60000 }, async () => {
    // A link hanging straight down on a pin (no gravity), and a loose one-hole part in its layer
    // moving toward the link's lower end at 100 units/s.
    const m = mk([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [0, -4, 1], 2), pin([0, 0, 0], [0, 0, 1]), beam([3, -4, 1], [3, -4, 1])], 1);
    const s = await sim(m, { gravity: [0, 0, 0], jointFriction: 0 });
    const link = s.bodyOf(2)!;
    const loose = s.bodyOf(4)!;
    rbOf(s, loose).setLinvel({ x: -100, y: 0, z: 0 }, true);
    s.stepFixed(1);
    const k0 = s.energy().kinetic;
    s.stepFixed(240);
    const w = s.bodyVelocity(link)!.w;
    const k1 = s.energy().kinetic;
    report(`energy guard, collision: KE ${k0.toFixed(0)} → ${k1.toFixed(0)}, link ω ${w[2].toFixed(2)} rad/s, guard removed ${s.guardRemoved.toExponential(2)}`);
    expect(Math.abs(w[2])).toBeGreaterThan(1); // the link was hit and turns
    expect(s.guardRemoved).toBeLessThan(0.01 * k0);
    s.dispose();
  });
});
