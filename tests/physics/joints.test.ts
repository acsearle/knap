// Joint mapping: the cylindrical (generic joint + raw LinX limits) and prismatic constructions,
// for every axis and both body orders, with gravity toward and away from each stop. Joint.limits
// is "displacement of body B relative to body A along +axis"; a sign or frame-order error would
// put the stop on the wrong side or at the wrong distance.
import { describe, expect, it } from 'vitest';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { axle, bush, cell, holes } from '../../src/core/examples';
import { analyze } from '../../src/core/kinematics';
import type { Axis, Cell, Model } from '../../src/core/types';
import { ModelBuilder } from '../../src/core/examples';
import { unitAxis } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { G, mk, report, sim, where } from './helpers';

const AXES: Axis[] = [0, 1, 2];
const NAME = 'XYZ';

function at(k: Axis, t: number, extra: Vec3 = [0, 0, 0]): [number, number, number] {
  const p: [number, number, number] = [extra[0], extra[1], extra[2]];
  p[k] += t;
  return p;
}

/**
 * Fixed 2-hole beam (holes along k) at the origin; axle along k from −2 to +2 through it; an arm
 * (bush + pin hole, offset along v) welded on the axle at +2. Axle body: slides [−1, +2]
 * relative to the frame (bush stops it at −1, engagement at +2), rotates freely.
 */
function cylModel(k: Axis, axleFirst: boolean): { model: Model; axleBody: number; frameBody: number } {
  const u = ((k + 1) % 3) as Axis;
  const v = ((k + 2) % 3) as Axis;
  const frame = holes([0, 0, 0], unitAxis(u) as [number, number, number], k);
  const rod = axle(at(k, -2), at(k, 2));
  const arm: Cell[] = [cell(at(k, 2), 'axleHole', k), cell(at(k, 2, unitAxis(v)), 'pinHole', k)];
  const b = new ModelBuilder();
  let root: number;
  if (axleFirst) {
    b.add(rod);
    b.add(arm);
    root = b.add(frame);
  } else {
    root = b.add(frame);
    b.add(rod);
    b.add(arm);
  }
  const model = b.root(root).build();
  return { model, axleBody: axleFirst ? 0 : 1, frameBody: axleFirst ? 1 : 0 };
}

/**
 * Fixed 2-hole beam (holes along k, row along u) at the origin; a slider = 2 axle holes at +3
 * along k plus two axles from −1 to +3 through both beams. Slider: prismatic [−2, +1].
 */
function prisModel(k: Axis, sliderFirst: boolean): { model: Model; slider: number } {
  const u = ((k + 1) % 3) as Axis;
  const eu = unitAxis(u);
  const frame = holes([0, 0, 0], eu as [number, number, number], k);
  const slider = holes(at(k, 3), at(k, 3, eu), k, 'axleHole');
  const a1 = axle(at(k, -1), at(k, 3));
  const a2 = axle(at(k, -1, eu), at(k, 3, eu));
  const b = new ModelBuilder();
  let root: number;
  if (sliderFirst) {
    b.add(slider);
    b.add(a1);
    b.add(a2);
    root = b.add(frame);
  } else {
    root = b.add(frame);
    b.add(slider);
    b.add(a1);
    b.add(a2);
  }
  return { model: b.root(root).build(), slider: sliderFirst ? 0 : 1 };
}

describe('Rapier enum values the sim relies on', () => {
  it('JointAxis.LinX is 0 (used as the raw axis for jointSetLimits)', async () => {
    await initPhysics();
    expect(RAPIER.JointAxis.LinX).toBe(0);
  });
});

describe('cylindrical joint', () => {
  for (const k of AXES)
    for (const axleFirst of [false, true]) {
      const order = axleFirst ? 'axle = body A' : 'axle = body B';
      it(`axis ${NAME[k]}, ${order}: graph limits as expected`, () => {
        const g = analyze(cylModel(k, axleFirst).model);
        expect(g.joints).toHaveLength(1);
        expect(g.joints[0]!.type).toBe('cylindrical');
        expect(g.joints[0]!.axis).toBe(k);
        expect(g.joints[0]!.limits).toEqual(axleFirst ? [-2, 1] : [-1, 2]);
      });

      for (const gs of [-1, 1]) {
        const expected = gs < 0 ? -1 : 2; // axle displacement at rest
        it(`axis ${NAME[k]}, ${order}, gravity ${gs < 0 ? '−' : '+'}${NAME[k]}: slides freely, stops at ${expected}`, async () => {
          const { model, axleBody } = cylModel(k, axleFirst);
          const s = await sim(model, { gravity: unitAxis(k, gs * G) });
          const disp = () => where(s, axleBody, [0, 0, 0])[k];
          // Free slide: x = ½·g·t² before the stop (first stop is reached at t = √(2·1/g) ≈ 0.040 s).
          const n1 = Math.round(0.03 / s.fixedDt);
          s.stepFixed(n1);
          const free = 0.5 * G * (n1 * s.fixedDt) ** 2 * gs;
          expect(disp()).toBeCloseTo(free, 2);
          let worstErr = 0;
          let worstTilt = 0;
          for (let i = 0; i < Math.round(1 / s.fixedDt); i++) {
            s.stepFixed(1);
            const js = s.jointStates()[0]!;
            worstErr = Math.max(worstErr, js.error);
            worstTilt = Math.max(worstTilt, js.tilt);
          }
          expect(disp()).toBeCloseTo(expected, 2); // |Δ| < 0.005
          // The slide coordinate the joint reports is B relative to A.
          expect(s.jointStates()[0]!.slide).toBeCloseTo(axleFirst ? -expected : expected, 2);
          expect(worstErr).toBeLessThan(1e-3); // 2 linear DOF locked
          expect(worstTilt).toBeLessThan(1e-3); // 2 angular DOF locked
          // Gravity along the axis exerts no torque about it: no spin appears.
          expect(Math.abs(s.bodyVelocity(axleBody)!.w[k])).toBeLessThan(1e-2);
          s.dispose();
        });
      }

      it(`axis ${NAME[k]}, ${order}, gravity ⟂ axis: arm swings about the axis, no slide, locked DOF hold`, async () => {
        const { model, axleBody } = cylModel(k, axleFirst);
        const u = ((k + 1) % 3) as Axis;
        const s = await sim(model, { gravity: unitAxis(u, -G) });
        const armPoint = at(k, 2, unitAxis(((k + 2) % 3) as Axis));
        let maxAngle = 0;
        let worstErr = 0;
        let worstTilt = 0;
        let worstSlide = 0;
        for (let i = 0; i < Math.round(0.5 / s.fixedDt); i++) {
          s.stepFixed(1);
          const t = s.bodyTransform(axleBody)!;
          const ang = 2 * Math.acos(Math.min(1, Math.abs(t.q[3])));
          maxAngle = Math.max(maxAngle, ang);
          const js = s.jointStates()[0]!;
          worstErr = Math.max(worstErr, js.error);
          worstTilt = Math.max(worstTilt, js.tilt);
          worstSlide = Math.max(worstSlide, Math.abs(js.slide));
          // the arm point stays at its distance 1 from the axis line and in its plane
          const p = where(s, axleBody, armPoint);
          expect(p[k]).toBeCloseTo(2, 2);
        }
        expect(maxAngle).toBeGreaterThan(Math.PI / 2); // released horizontal: swings ≥ 90°
        expect(worstSlide).toBeLessThan(1e-3);
        expect(worstErr).toBeLessThan(1e-3);
        expect(worstTilt).toBeLessThan(1e-3);
        s.dispose();
      });
    }
});

describe('prismatic joint', () => {
  for (const k of AXES)
    for (const sliderFirst of [false, true])
      for (const gs of [-1, 1]) {
        const order = sliderFirst ? 'slider = body A' : 'slider = body B';
        const expected = gs < 0 ? -2 : 1;
        it(`axis ${NAME[k]}, ${order}, gravity ${gs < 0 ? '−' : '+'}${NAME[k]}: stops at ${expected}, no rotation`, async () => {
          const { model, slider } = prisModel(k, sliderFirst);
          const s = await sim(model, { gravity: unitAxis(k, gs * G) });
          expect(s.graph.joints).toHaveLength(1);
          const j = s.graph.joints[0]!;
          expect(j.type).toBe('prismatic');
          expect(j.limits).toEqual(sliderFirst ? [-1, 2] : [-2, 1]);
          s.stepFixed(Math.round(1 / s.fixedDt));
          expect(where(s, slider, [0, 0, 0])[k]).toBeCloseTo(expected, 2);
          const js = s.jointStates()[0]!;
          expect(js.error).toBeLessThan(1e-3);
          expect(js.tilt).toBeLessThan(1e-3);
          const t = s.bodyTransform(slider)!;
          expect(Math.abs(t.q[3])).toBeGreaterThan(1 - 1e-6); // no rotation
          s.dispose();
        });
      }
});

describe('rotation about a non-principal axis (products of inertia)', () => {
  // Fixed beam with an extra Z hole at (4,1,0); a Z axle through it held by an arm (bush + pin
  // hole at +x, at z = 1) and a bush at z = −1: a revolute pendulum whose centre of mass is off
  // the z = 0 plane, so the joint axis Z is not a principal axis of the body.
  const model = () =>
    mk(
      [
        [...holes([0, 0, 0], [4, 0, 0], 1), cell([4, 1, 0], 'pinHole', 2)],
        axle([4, 1, -2], [4, 1, 2]),
        [cell([4, 1, 1], 'axleHole', 2), cell([5, 1, 1], 'pinHole', 2)],
        bush([4, 1, -1], 2),
      ],
      1,
    );

  async function run(decoupleInertia: boolean, energyGuard = true) {
    const s = await sim(model(), { decoupleInertia, energyGuard });
    expect(s.graph.joints.map((j) => j.type)).toEqual(['revolute']);
    const mi = s.massInfo(1)!;
    const e0 = s.energy();
    const avail = 2 * mi.mass * G * Math.hypot(mi.com[0] - 4, mi.com[1] - 1); // PE swing top → bottom
    let wmax = 0;
    let hi = 0;
    for (let i = 0; i < Math.round(10 / s.fixedDt); i++) {
      s.stepFixed(1);
      if (i % 8) continue;
      wmax = Math.max(wmax, Math.hypot(...s.bodyVelocity(1)!.w));
      const e = s.energy();
      hi = Math.max(hi, (e.kinetic + e.potential - e0.kinetic - e0.potential) / avail);
    }
    s.dispose();
    return { mi, wmax, hi };
  }

  it('Rapier spins such a body up unless the products with the axis are dropped; mass, COM and I_zz are kept', async () => {
    // Without the energy guard, to show the instability itself (the guard would also cap it).
    const raw = await run(false, false);
    const fixed = await run(true);
    report(`non-principal revolute 10 s: true inertia → max |ω| ${raw.wmax.toFixed(0)} rad/s, energy +${(raw.hi * 100).toFixed(0)}%; decoupled → max |ω| ${fixed.wmax.toFixed(1)}, energy +${(fixed.hi * 100).toFixed(2)}% (of the swing's PE range)`);
    expect(raw.mi.inertia[2]).not.toBeCloseTo(0, 3); // I_xz ≠ 0: Z is not principal
    expect(fixed.mi.mass).toBeCloseTo(raw.mi.mass, 4);
    for (let k = 0; k < 3; k++) expect(fixed.mi.com[k]).toBeCloseTo(raw.mi.com[k]!, 4);
    expect(fixed.mi.inertia[8]).toBeCloseTo(raw.mi.inertia[8]!, 3); // I_zz
    expect(fixed.mi.inertia[0]).toBeCloseTo(raw.mi.inertia[0]!, 3);
    expect(fixed.mi.inertia[4]).toBeCloseTo(raw.mi.inertia[4]!, 3);
    expect(Math.abs(fixed.mi.inertia[2]!)).toBeLessThan(1e-4); // I_xz dropped
    expect(raw.wmax).toBeGreaterThan(100); // the instability being avoided
    expect(fixed.wmax).toBeLessThan(60);
    // The f32 spin drift (DEVIATIONS §5) is capped by the energy guard at 2 % of the peak KE,
    // which is ≤ 1 % of this PE range; without the guard it was +7.5 % in 10 s.
    expect(fixed.hi).toBeLessThan(0.02);
  }, 60000);
});
