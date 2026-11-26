// Milestone 8 review (simulation and geometry of gears; reviewer simgeo). Scratch measurements
// behind these tests: spikes/review-m8/simgeo/ (*.out files). Tests titled "FIXED (was FAILS ON
// PURPOSE)" demonstrated a defect, now fixed, with the same strict expectation; the others pin
// behaviour verified in review.
import { beforeAll, describe, expect, it } from 'vitest';
import { ModelBuilder, beam } from '../../src/core/examples';
import { gearPlaneBasis } from '../../src/core/gears';
import { makeCell, validateModel } from '../../src/core/model';
import type { Axis, Cell, Model } from '../../src/core/types';
import { buildPartMesh, gearOutline, initGeometry } from '../../src/geometry';
import { applyTransform } from '../../src/physics/math';
import { Simulation } from '../../src/physics/sim';
import { edgeProblems } from '../geometry/helpers';
import { compound25, gearPair, lockedTrain } from '../physics/gearModels';

type P = [number, number, number];

function energy(s: Simulation): number {
  const e = s.energy();
  return e.kinetic + e.potential;
}

/** Point at in-plane (u, v) and layer l for gear axis ax. */
function at(ax: Axis, u: number, v: number, l: number): P {
  const [iu, iv] = gearPlaneBasis(ax);
  const p: P = [0, 0, 0];
  p[iu] = u;
  p[iv] = v;
  p[ax] = l;
  return p;
}

/**
 * Two gears (radii ra, rb) in layer 1 along +u at mesh distance, each on a column (pivot hole in
 * layer 0 on a smooth pin from a frame beam in layer −1). Teeth are set raw, then the whole model is
 * validated (setGear one at a time refuses an 8 beside the plain hub that becomes its partner).
 */
function pair(ax: Axis, ra: number, rb: number): { model: Model; A: number; B: number } {
  const b = new ModelBuilder();
  const d = ra + rb;
  const C = (u: number, l: number, kind: Cell['kind'] = 'pinHole') => {
    const p = at(ax, u, 0, l);
    return makeCell(p[0], p[1], p[2], kind, ax);
  };
  const fr: Cell[] = [];
  for (let u = 0; u <= d; u++) fr.push(C(u, -1));
  const frame = b.add(fr);
  const A = b.add([C(0, 0), C(0, 1)]);
  b.add([C(0, -1, 'frictionPin'), C(0, 0, 'pin')]);
  const B = b.add([C(d, 0), C(d, 1)]);
  b.add([C(d, -1, 'frictionPin'), C(d, 0, 'pin')]);
  let m = b.root(frame).build();
  const hubs: [number, P, number][] = [[A, at(ax, 0, 0, 1), ra], [B, at(ax, d, 0, 1), rb]];
  m = {
    ...m,
    version: 3,
    parts: m.parts.map((p) => ({
      ...p,
      cells: p.cells.map((c) => {
        const g = hubs.find(([id, q]) => id === p.id && q[0] === c.x && q[1] === c.y && q[2] === c.z);
        return g ? makeCell(c.x, c.y, c.z, c.kind, c.axis, g[2], true) : c;
      }),
    })),
  };
  expect(validateModel(m)).toEqual([]);
  return { model: m, A, B };
}

function spin(s: Simulation, body: number, ax: Axis, w: number): void {
  const v: P = [0, 0, 0];
  v[ax] = w;
  s.setBodyVelocity(body, [0, 0, 0], v);
}

describe('m8 simgeo: defects', () => {
  it('FIXED (was FAILS ON PURPOSE): a 40+40 pair driven by a constant torque keeps gaining speed past 40 rad/s and keeps its drive work (was: stopped near 29 rad/s at k = 1, 54 % lost; k now weighs ω by max(1, √r), DEVIATIONS)', { timeout: 60000 }, async () => {
    // Guard off so the drive's work can be compared with the energy. A 16+16 under the same drive
    // keeps (E − E0)/W ≈ 1.09 to 48 rad/s. Before the fix: ω 28.7, kept 0.463, k max 1.
    const { model, A, B } = pair(2, 2.5, 2.5);
    const s = await Simulation.create(model, { jointFriction: 0, energyGuard: false });
    const a = s.bodyOf(A)!;
    const I = s.massInfo(a)!.inertia[8]! + s.massInfo(s.bodyOf(B)!)!.inertia[8]!;
    s.setDriveTorque(a, [0, 0, I * 15]); // 15 rad/s² at the input: 45 rad/s after 3 s if nothing brakes
    const E0 = energy(s);
    let kMax = 1;
    for (let i = 0; i < 480 * 3; i++) {
      s.stepFixed(1);
      kMax = Math.max(kMax, s.substeps);
    }
    const w = s.bodyVelocity(a)!.w[2]!;
    const kept = (energy(s) - E0) / s.driveWorkTotal;
    console.log(`[m8-simgeo] 40+40 driven 3 s: ω ${w.toFixed(1)} rad/s, (E − E0)/drive work ${kept.toFixed(3)}, k max ${kMax}`);
    s.dispose();
    expect(w).toBeGreaterThan(40);
    expect(kept).toBeGreaterThan(0.95);
  });

  it('FIXED (was FAILS ON PURPOSE): two gears meeting at matched speed keep their energy in the engaging step (was: the step ran at the k chosen before the mesh existed; k now steps up inside the fixed step when a mesh engages)', { timeout: 60000 }, async () => {
    // Measured: 8+8 at 100 rad/s → 1.8 % of the energy left and the input reversed (−13 rad/s);
    // 16+16 at 60 → 0.2 %; 24+24 at 40 → 81 %; 40+40 at 40 → 31 %. Already engaged, the same speeds
    // keep their energy (k steps up at once). Engaging at speed is what the swing-arm selector,
    // a sliding gear or a gear dragged into mesh does.
    const rows: string[] = [];
    let worst = 1;
    for (const [ra, rb, w] of [[0.5, 0.5, 100], [1, 1, 60], [1.5, 1.5, 40], [2.5, 2.5, 40]] as const) {
      const { model, A, B } = pair(2, ra, rb);
      const s = await Simulation.create(model, { jointFriction: 0 });
      spin(s, s.bodyOf(A)!, 2, w);
      spin(s, s.bodyOf(B)!, 2, (-w * ra) / rb);
      const E0 = energy(s);
      s.stepFixed(1); // the mesh engages in this step (teeth in phase, speeds matched)
      const kept = energy(s) / E0;
      rows.push(`${16 * ra}+${16 * rb} at ${w} rad/s: kept ${kept.toFixed(4)}, ω_A after ${s.bodyVelocity(s.bodyOf(A)!)!.w[2]!.toFixed(2)}`);
      worst = Math.min(worst, kept);
      s.dispose();
    }
    console.log('[m8-simgeo] engagement at matched speed: ' + rows.join('; '));
    expect(worst).toBeGreaterThan(0.95);
  });

  it('FIXED (was FAILS ON PURPOSE): a spinning gear meeting one at rest ends at the plastic tooth-impact speed within 5 % (was: reversed, ~3 % of the energy kept, because the engaging step ran at k = 1)', { timeout: 60000 }, async () => {
    // Measured (auto k vs substeps 8 vs analytic): 8+8 A at 100 → ω_A −12.2 / +50.0 / +50;
    // 16+16 at 60 → −4.1 / +30.0 / +30; 40+40 at 40 → +5.6 / +20.0 / +20. At 30 (8, 16) and 15 (40)
    // rad/s auto k is right. A swing-arm selector or a sliding gear engaging a fast pinion does this.
    const rows: string[] = [];
    const bad: string[] = [];
    for (const [ra, w] of [[0.5, 100], [1, 60], [2.5, 40]] as const) {
      const { model, A, B } = pair(2, ra, ra);
      const s = await Simulation.create(model, { jointFriction: 0 });
      const a = s.bodyOf(A)!;
      const Ia = s.massInfo(a)!.inertia[8]!;
      const Ib = s.massInfo(s.bodyOf(B)!)!.inertia[8]!;
      const plastic = (w * Ia) / (Ia + Ib);
      spin(s, a, 2, w);
      s.stepFixed(1);
      const got = s.bodyVelocity(a)!.w[2]!;
      rows.push(`${16 * ra}+${16 * ra}: ω_A ${got.toFixed(2)} vs plastic ${plastic.toFixed(2)}`);
      if (!(Math.abs(got / plastic - 1) < 0.05)) bad.push(rows[rows.length - 1]!);
      s.dispose();
    }
    console.log('[m8-simgeo] engagement against a gear at rest: ' + rows.join('; '));
    expect(bad).toEqual([]);
  });

  it('FIXED (was FAILS ON PURPOSE): after setDriveTorque(body, [0,0,0]) the energy guard no longer credits the drive\'s last work, so the freewheeling pair stays within the guard band (was +51 % in 5 s)', { timeout: 60000 }, async () => {
    // stepFixed clears driveWork only while drives.size > 0, and guardEnergy adds driveWork to eRef.
    // Measured: a 16+16 pair driven to 40 rad/s and released gains 2.1× its energy in 10 s with the
    // guard on (the f32 spin gain the guard exists to stop; guard removed nothing after release).
    const { model, A } = pair(2, 1, 1);
    const s = await Simulation.create(model, { jointFriction: 0 });
    const a = s.bodyOf(A)!;
    s.setDriveTorque(a, [0, 0, 200]);
    while (s.bodyVelocity(a)!.w[2]! < 40) s.stepFixed(1);
    s.setDriveTorque(a, [0, 0, 0]);
    s.stepFixed(1);
    const E1 = energy(s);
    for (let i = 0; i < 480 * 5; i++) s.stepFixed(1);
    const gain = energy(s) / E1 - 1;
    console.log(`[m8-simgeo] after the drive is removed: energy ${(gain * 100).toFixed(1)} % in 5 s (guard on, band 1 %)`);
    s.dispose();
    expect(gain).toBeLessThan(0.011);
  });

  it('FIXED (was FAILS ON PURPOSE): valid parts with two gears give closed manifold render meshes (DESIGN §4.2; was: 3 pinched bore edges each where a web cell\'s barrel touched the gear slab face exactly)', async () => {
    await initGeometry();
    const parts: Cell[][] = [
      [makeCell(0, 0, 0, 'pinHole', 1, 1.5, true), makeCell(1, 0, 0, 'axleHole', 1), makeCell(1, -1, 0, 'axleHole', 1, 1, true), makeCell(1, -2, 0, 'pinHole', 0)],
      [makeCell(0, 0, 0, 'pinHole', 0, 1.5, true), makeCell(0, 1, 0, 'pin', 0), makeCell(1, 0, 0, 'pinHole', 0), makeCell(1, 0, -1, 'axleHole', 0, 1.5, true), makeCell(-1, 1, 0, 'pinHole', 2)],
    ];
    const problems: string[] = [];
    for (const cells of parts) {
      const m: Model = { version: 3, parts: [{ id: 1, color: '#888888', cells }], rootPartId: 1, nextPartId: 2 };
      expect(validateModel(m)).toEqual([]);
      problems.push(...edgeProblems(buildPartMesh(m.parts[0]!)));
    }
    // Both: 3 edges used twice along a bore arc lying exactly in a gear's slab face (local
    // y = 1.53 / x = 1.53), where the web cell's bore meets the second gear's hub below it.
    expect(problems).toEqual([]);
  });
});

describe('m8 simgeo: verified', () => {
  it('ratio and phase hold for every meshing pair on every axis (6 s at up to 40 rad/s on the input, friction off)', { timeout: 600000 }, async () => {
    const pairs: [number, number][] = [[0.5, 0.5], [0.5, 1.5], [1, 1], [0.5, 2.5], [1.5, 1.5], [1.5, 2.5], [2.5, 2.5]];
    let worstRatio = 0;
    let worstPhase = 0;
    for (const ax of [0, 1, 2] as Axis[])
      for (const [ra, rb] of pairs) {
        const { model, A, B } = pair(ax, ra, rb);
        const s = await Simulation.create(model, { jointFriction: 0 });
        const a = s.bodyOf(A)!;
        const b = s.bodyOf(B)!;
        s.stepFixed(1); // engage at rest, then spin (k steps up at once)
        const w = Math.min(40, 20 / ra); // keeps the bigger gears below the speed where k = 1 brakes them
        spin(s, a, ax, w);
        spin(s, b, ax, (-w * ra) / rb);
        const axis: P = [0, 0, 0];
        axis[ax] = 1;
        const tw = (id: number) => {
          let prev = 0;
          let acc = 0;
          let first = true;
          return () => {
            const q = s.bodyTransform(id)!.q;
            const raw = 2 * Math.atan2(q[0] * axis[0] + q[1] * axis[1] + q[2] * axis[2], q[3]);
            if (first) acc = raw;
            else acc += raw - prev - 2 * Math.PI * Math.round((raw - prev) / (2 * Math.PI));
            first = false;
            prev = raw;
            return acc;
          };
        };
        const ta = tw(a);
        const tb = tw(b);
        const a0 = ta();
        const b0 = tb();
        for (let i = 0; i < 480 * 6; i++) {
          s.stepFixed(1);
          ta();
          tb();
          for (const m of s.meshStates()) worstPhase = Math.max(worstPhase, Math.abs(m.phaseErrorTeeth));
        }
        const ra2 = (tb() - b0) / (ta() - a0);
        worstRatio = Math.max(worstRatio, Math.abs(ra2 / (-ra / rb) - 1));
        s.dispose();
      }
    console.log(`[m8-simgeo] ratio error ≤ ${worstRatio.toExponential(2)}, phase ≤ ${worstPhase.toExponential(2)} teeth`);
    expect(worstRatio).toBeLessThan(1e-4);
    expect(worstPhase).toBeLessThan(0.005);
  });

  it('crane drops (1:5, 1:25) at Off / Low / Realistic: no gear reverses in any world step on the way down', { timeout: 120000 }, async () => {
    for (const [rig, out] of [[gearPair(0.5, 2.5, { armB: 6 }), 'B'], [compound25(6), 'C']] as const)
      for (const mu of [0, 0.05, 0.2]) {
        const s = await Simulation.create(rig.model, { jointFriction: mu });
        const bodies = Object.entries(rig.part).filter(([k]) => k !== 'frame').map(([, id]) => s.bodyOf(id)!);
        const world = (s as unknown as { world: { step: (...a: unknown[]) => void } }).world;
        const step0 = world.step.bind(world);
        const sign = new Map<number, number>();
        let rev = 0;
        world.step = (...x: unknown[]) => {
          step0(...x);
          for (const b of bodies) {
            const w = s.bodyVelocity(b)!.w[2]!;
            if (Math.abs(w) <= 1e-3) continue;
            if (sign.has(b) && sign.get(b) !== Math.sign(w)) rev++;
            sign.set(b, Math.sign(w));
          }
        };
        const o = s.bodyOf(rig.part[out]!)!;
        let bottom = false;
        for (let i = 0; i < 960 && !bottom; i++) {
          s.stepFixed(1);
          const q = s.bodyTransform(o)!.q;
          bottom = 2 * Math.atan2(q[2], q[3]) <= -Math.PI / 2;
        }
        expect(bottom).toBe(true);
        expect(rev).toBe(0);
        s.dispose();
      }
  });

  it('teeth outlines placed by the simulation never intersect (1:25 crane drop, 3 s): clearance ≥ 0.015 (ideal 0.0157)', { timeout: 120000 }, async () => {
    const rig = compound25(6);
    const s = await Simulation.create(rig.model, { jointFriction: 0 });
    const gears = rig.model.parts.flatMap((p) => p.cells.filter((c) => c.teeth).map((c) => ({ body: s.bodyOf(p.id)!, c, local: gearOutline(c.rim!) })));
    const meshed: [number, number][] = [];
    gears.forEach((g, i) =>
      gears.forEach((h, j) => {
        if (j <= i || g.body === h.body || g.c.z !== h.c.z) return;
        if (Math.abs(Math.hypot(g.c.x - h.c.x, g.c.y - h.c.y) - g.c.rim! - h.c.rim!) < 1e-9) meshed.push([i, j]);
      }),
    );
    expect(meshed.length).toBe(2);
    const outline = (g: (typeof gears)[number]): [number, number][] => {
      const t = s.bodyTransform(g.body)!;
      return g.local.map(([x, y]) => {
        const q = applyTransform(t, [g.c.x + x, g.c.y + y, g.c.z]);
        return [q[0], q[1]];
      });
    };
    const clearance = (A: [number, number][], B: [number, number][]) => {
      let best = Infinity;
      for (const p of A) {
        let inside = false;
        let dmin = Infinity;
        for (let i = 0, j = B.length - 1; i < B.length; j = i++) {
          const [xi, yi] = B[i]!;
          const [xj, yj] = B[j]!;
          if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
          const dx = xj - xi;
          const dy = yj - yi;
          const t = Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[1] - yi) * dy) / (dx * dx + dy * dy)));
          dmin = Math.min(dmin, Math.hypot(p[0] - xi - t * dx, p[1] - yi - t * dy));
        }
        best = Math.min(best, inside ? -dmin : dmin);
      }
      return best;
    };
    let worst = Infinity;
    for (let i = 0; i <= 1440; i++) {
      if (i) s.stepFixed(1);
      if (i % 2) continue;
      for (const [x, y] of meshed) {
        const A = outline(gears[x]!);
        const B = outline(gears[y]!);
        worst = Math.min(worst, clearance(A, B), clearance(B, A));
      }
    }
    console.log(`[m8-simgeo] 1:25 crane: min tooth clearance ${worst.toFixed(4)}`);
    expect(worst).toBeGreaterThanOrEqual(0.015);
    s.dispose();
  });

  it('locked train holds at Off / Low / Realistic, even kicked at 20 rad/s; a 16+16 built 1 too far never engages', { timeout: 60000 }, async () => {
    for (const mu of [0, 0.05, 0.2]) {
      const rig = lockedTrain(4);
      const s = await Simulation.create(rig.model, { jointFriction: mu });
      const Pb = s.bodyOf(rig.part.P!)!;
      for (let i = 0; i < 480; i++) s.stepFixed(1);
      s.setBodyVelocity(Pb, [0, 0, 0], [0, 0, 20]);
      const E1 = energy(s);
      let eMax = E1;
      for (let i = 0; i < 960; i++) {
        s.stepFixed(1);
        eMax = Math.max(eMax, energy(s));
      }
      expect(Math.hypot(...s.bodyVelocity(Pb)!.w)).toBeLessThan(1e-4);
      expect(eMax - E1).toBeLessThanOrEqual(0);
      expect(s.jointError()).toBeLessThan(1e-3);
      s.dispose();
    }
    const b = new ModelBuilder();
    const frame = b.add(beam([0, 0, -1], [3, 0, -1]));
    const A = b.add([makeCell(0, 0, 0, 'pinHole', 2), makeCell(0, 0, 1, 'pinHole', 2, 1, true)]);
    b.add([makeCell(0, 0, -1, 'frictionPin', 2), makeCell(0, 0, 0, 'pin', 2)]);
    const B = b.add([makeCell(3, 0, 0, 'pinHole', 2), makeCell(3, 0, 1, 'pinHole', 2, 1, true)]);
    b.add([makeCell(3, 0, -1, 'frictionPin', 2), makeCell(3, 0, 0, 'pin', 2)]);
    const m = b.root(frame).build();
    const s = await Simulation.create(m);
    spin(s, s.bodyOf(A)!, 2, 20);
    for (let i = 0; i < 480; i++) s.stepFixed(1);
    expect(s.meshDiagnostics()[0]!.engagements).toBe(0);
    expect(Math.abs(s.bodyVelocity(s.bodyOf(B)!)!.w[2]!)).toBeLessThan(1e-9);
    s.dispose();
  });
});

beforeAll(async () => {
  await initGeometry();
});
