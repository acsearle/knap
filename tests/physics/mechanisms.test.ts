// §5.3 required headless tests: triple pendulum, four-bar, axle slide stop, collision, welds.
import { describe, expect, it } from 'vitest';
import { axle, beam, buildExample, bush, holes } from '../../src/core/examples';
import { sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { G, angleZ, isFiniteTransform, maxSpeeds, mk, report, sim, total, toEditFrame, unwrap, where } from './helpers';

describe('triple pendulum (released horizontal)', () => {
  it('10 s: no NaN, joint error < 0.02, energy within +2% / −10%', async () => {
    const s = await sim(buildExample('triple-pendulum'));
    expect(s.graph.joints).toHaveLength(3);
    // Energy scale: what is available to the motion, E0 − E_min, with E_min the potential of
    // the chain hanging straight down. The links start collinear along +x from the pivot (0,0),
    // so hanging puts each centre of mass at y = −x_com(0).
    const e0 = total(s.energy());
    let eMin = 0;
    for (const b of s.graph.bodies) {
      if (b.fixed) continue;
      const mi = s.massInfo(b.id)!;
      eMin -= mi.mass * G * mi.com[0];
    }
    const scale = e0 - eMin;
    let hi = 0;
    let lo = 0;
    let jerr = 0;
    let vmax = 0;
    let wmax = 0;
    const t0 = performance.now();
    const n = Math.round(10 / s.fixedDt);
    for (let i = 1; i <= n; i++) {
      s.stepFixed(1);
      if (i % 4 === 0 || i === n) {
        const e = total(s.energy());
        expect(Number.isFinite(e)).toBe(true);
        hi = Math.max(hi, (e - e0) / scale);
        lo = Math.min(lo, (e - e0) / scale);
        jerr = Math.max(jerr, s.jointError());
        const sp = maxSpeeds(s);
        vmax = Math.max(vmax, sp.v);
        wmax = Math.max(wmax, sp.w);
      }
    }
    const ms = performance.now() - t0;
    for (const b of s.graph.bodies) expect(isFiniteTransform(s.bodyTransform(b.id))).toBe(true);
    report(`triple pendulum 10 s: energy +${(hi * 100).toFixed(2)}% / ${(lo * 100).toFixed(2)}% of E0−Emin, max joint error ${jerr.toExponential(2)}, max |v| ${vmax.toFixed(0)}, max |ω| ${wmax.toFixed(0)}, ${(ms / 10).toFixed(0)} ms per simulated s (incl. diagnostics)`);
    expect(jerr).toBeLessThan(0.02);
    expect(hi).toBeLessThan(0.02);
    expect(lo).toBeGreaterThan(-0.1);
    s.dispose();
  }, 60000);
});

describe('four-bar linkage', () => {
  it('10 s: joint error < 0.02, crank moves > 20°, poses consistent with loop closure', async () => {
    const s = await sim(buildExample('four-bar'));
    const crank = s.bodyOf(2)!;
    const coupler = s.bodyOf(3)!;
    const rocker = s.bodyOf(4)!;
    expect(s.graph.joints).toHaveLength(4);
    const B0: Vec3 = [0, 2, 1];
    const C0: Vec3 = [4, 2, 1];
    const D: Vec3 = [6, 0, 1];
    const lBC = 4;
    const lCD = Math.SQRT2 * 2;
    let phi = 0;
    let phiMin = 0;
    let phiMax = 0;
    let jerr = 0;
    let loopErr = 0;
    let angleErr = 0;
    const n = Math.round(10 / s.fixedDt);
    for (let i = 1; i <= n; i++) {
      s.stepFixed(1);
      if (i % 8 !== 0) continue;
      jerr = Math.max(jerr, s.jointError());
      const tc = s.bodyTransform(crank)!;
      phi = unwrap(phi, angleZ(tc));
      phiMin = Math.min(phiMin, phi);
      phiMax = Math.max(phiMax, phi);
      // 1 DOF: the crank angle alone fixes B, and then C up to the choice of one of the two
      // circle–circle intersections (the linkage is non-Grashof and legitimately passes
      // through its folded change points, switching branch). Check C is on one of them.
      const B = where(s, crank, B0);
      const dx = D[0] - B[0];
      const dy = D[1] - B[1];
      const dist = Math.hypot(dx, dy);
      const a = (lBC * lBC - lCD * lCD + dist * dist) / (2 * dist);
      const h = Math.sqrt(Math.max(0, lBC * lBC - a * a));
      const mx = B[0] + (a * dx) / dist;
      const my = B[1] + (a * dy) / dist;
      const c1: [number, number] = [mx + (h * dy) / dist, my - (h * dx) / dist];
      const c2: [number, number] = [mx - (h * dy) / dist, my + (h * dx) / dist];
      const Cnow = where(s, rocker, C0);
      const pick = Math.hypot(c1[0] - Cnow[0], c1[1] - Cnow[1]) < Math.hypot(c2[0] - Cnow[0], c2[1] - Cnow[1]) ? c1 : c2;
      const Crk = where(s, rocker, C0);
      const Ccp = where(s, coupler, C0);
      loopErr = Math.max(loopErr, Math.hypot(Crk[0] - pick[0], Crk[1] - pick[1]), Math.hypot(Ccp[0] - pick[0], Ccp[1] - pick[1]));
      // Coupler orientation predicted from B and C.
      const pred = Math.atan2(pick[1] - B[1], pick[0] - B[0]) - Math.atan2(C0[1] - B0[1], C0[0] - B0[0]);
      const got = angleZ(s.bodyTransform(coupler)!);
      angleErr = Math.max(angleErr, Math.abs(unwrap(0, got - pred)));
    }
    report(`four-bar 10 s: crank range ${(((phiMax - phiMin) * 180) / Math.PI).toFixed(1)}°, max joint error ${jerr.toExponential(2)}, loop-closure error ${loopErr.toExponential(2)} units / ${angleErr.toExponential(2)} rad`);
    expect(jerr).toBeLessThan(0.02);
    expect(((phiMax - phiMin) * 180) / Math.PI).toBeGreaterThan(20);
    expect(loopErr).toBeLessThan(0.02);
    expect(angleErr).toBeLessThan(0.01);
    s.dispose();
  }, 60000);
});

describe('axle slide stop', () => {
  it('vertical axle with a bush two cells above a fixed liftarm drops 2 and stays', async () => {
    // Liftarm with vertical holes at y = 0; axle y = −2..4 through (0,0,0); bush at y = 3.
    const s = await sim(mk([holes([0, 0, 0], [2, 0, 0], 1), axle([0, -2, 0], [0, 4, 0]), bush([0, 3, 0], 1)], 1));
    expect(s.graph.joints).toHaveLength(1);
    expect(s.graph.joints[0]!.type).toBe('cylindrical');
    expect(s.graph.joints[0]!.limits).toEqual([-2, 2]);
    const axleBody = s.bodyOf(2)!;
    let worstAfter = 0;
    let lowest = 0;
    for (let i = 1; i <= Math.round(3 / s.fixedDt); i++) {
      s.stepFixed(1);
      const y = where(s, axleBody, [0, 3, 0])[1] - 3; // bush displacement
      lowest = Math.min(lowest, y);
      if (s.time >= 0.5) worstAfter = Math.max(worstAfter, Math.abs(y + 2));
    }
    const fin = where(s, axleBody, [0, 3, 0])[1] - 3;
    report(`axle slide stop: final displacement ${fin.toFixed(5)}, deepest ${lowest.toFixed(5)}, max |disp + 2| after 0.5 s ${worstAfter.toExponential(2)}, joint error ${s.jointError().toExponential(2)}`);
    expect(Math.abs(fin + 2)).toBeLessThan(0.03);
    expect(worstAfter).toBeLessThan(0.03);
    expect(lowest).toBeGreaterThan(-2.03);
    s.dispose();
  }, 30000);
});

describe('collision', () => {
  /**
   * Lowest centre of the loose beam's cells that are stacked on the fixed beam. Each loose cell
   * is round (radius 0.46 about its centre), the fixed beam a stadium of half-thickness 0.46
   * about x ∈ [0, 6], y = z = 0, so a cell centre within 0.92 of that centre line horizontally
   * touches the beam at y = 0.92; less is penetration, and below −0.92 it would have passed through.
   */
  function lowestStacked(s: Awaited<ReturnType<typeof sim>>, body: number, cells: Vec3[]): number {
    let y = Infinity;
    for (const c of cells) {
      const p = where(s, body, c);
      const dx = p[0] < 0 ? -p[0] : p[0] > 6 ? p[0] - 6 : 0;
      if (Math.hypot(dx, p[2]) < 0.92) y = Math.min(y, p[1]);
    }
    return y;
  }

  it('a free beam dropped 3 cells crosswise onto a fixed, un-jointed beam comes to rest on it', async () => {
    // Fixed 7-hole beam at y = 0; loose 3-hole beam crosswise (row along Z, holes along X) above its middle.
    const cells: Vec3[] = [[3, 3, -1], [3, 3, 0], [3, 3, 1]];
    const s = await sim(mk([beam([0, 0, 0], [6, 0, 0]), beam([3, 3, -1], [3, 3, 1], 0)], 1));
    expect(s.graph.joints).toHaveLength(0);
    let minLow = Infinity;
    for (let i = 1; i <= Math.round(3 / s.fixedDt); i++) {
      s.stepFixed(1);
      minLow = Math.min(minLow, lowestStacked(s, 1, cells));
    }
    const v = s.bodyVelocity(1)!;
    const com = s.massInfo(1)!.com;
    report(`collision drop 3: lowest stacked cell centre ${minLow.toFixed(4)} (touching at 0.92), final COM y ${com[1].toFixed(4)}, final |v| ${Math.hypot(...v.v).toExponential(2)}`);
    expect(minLow).toBeGreaterThan(0.92 - 0.05); // never into the fixed beam beyond contact tolerance
    expect(com[1]).toBeGreaterThan(0.9); // at rest on top: 0.46 + 0.46 above the frame centre line
    expect(com[1]).toBeLessThan(1.0);
    expect(Math.hypot(...v.v)).toBeLessThan(0.5);
    s.dispose();
  }, 30000);

  it('dropped from 40 cells (≈ 310 units/s at impact) it deflects off the beam and never passes through it', async () => {
    const cells: Vec3[] = [[3, 40, -1], [3, 40, 0], [3, 40, 1]];
    const s = await sim(mk([beam([0, 0, 0], [6, 0, 0]), beam([3, 40, -1], [3, 40, 1], 0)], 1));
    let worst = Infinity;
    let bounced = false;
    for (let i = 1; i <= Math.round(3 / s.fixedDt); i++) {
      s.stepFixed(1);
      if (!s.hasBody(1)) break; // fell away below y = −400
      worst = Math.min(worst, lowestStacked(s, 1, cells));
      if (s.bodyVelocity(1)!.v[1] > 0) bounced = true;
    }
    report(`collision drop 40: bounced ${bounced}, lowest stacked cell centre ${worst.toFixed(4)} (touching at 0.92), removed after falling away ${!s.hasBody(1)}`);
    expect(bounced).toBe(true);
    // The impact moves 0.65 units per step and the contact prediction distance is 0.02, so the
    // first contact can be a transient penetration (measured 0.0–0.29 depending on the step
    // phase at impact); it must stay well short of passing through (centre below 0).
    expect(worst).toBeGreaterThan(0.92 - 0.35);
    s.dispose();
  }, 30000);

  // Parts lying flat (holes vertical) meet with their large flat faces. Rapier keeps only the
  // first four vertices of a contact face, so these exercise the bevelled caps of shapes.ts.
  for (const [name, below, above] of [
    ['3-hole on a 9-hole, parallel', beam([-4, 0, 0], [4, 0, 0], 1), beam([-1, 1, 0], [1, 1, 0], 1)],
    ['5-hole on a 5-hole, crosswise', beam([0, 0, -2], [0, 0, 2], 1), beam([-2, 1, 0], [2, 1, 0], 1)],
    ['3-hole on a 9-hole, crosswise', beam([0, 0, -4], [0, 0, 4], 1), beam([-1, 1, 0], [1, 1, 0], 1)],
  ] as const)
    it(`flat on flat: a ${name}, released 0.08 above contact, rests on it`, async () => {
      const s = await sim(mk([below, above], 1));
      let low = Infinity;
      for (let i = 1; i <= Math.round(3 / s.fixedDt); i++) {
        s.stepFixed(1);
        expect(s.hasBody(1)).toBe(true);
        low = Math.min(low, where(s, 1, [0, 1, 0])[1]);
      }
      const y = where(s, 1, [0, 1, 0])[1];
      const t = s.bodyTransform(1)!;
      const tilt = 2 * Math.acos(Math.min(1, Math.abs(t.q[3])));
      report(`flat on flat, ${name}: rests at ${y.toFixed(4)} (touching at 0.92), lowest ${low.toFixed(4)}, tilt ${tilt.toExponential(1)} rad`);
      expect(low).toBeGreaterThan(0.9);
      expect(y).toBeGreaterThan(0.9);
      expect(y).toBeLessThan(0.93);
      expect(tilt).toBeLessThan(0.01);
      expect(Math.hypot(...s.bodyVelocity(1)!.v)).toBeLessThan(0.05);
      s.dispose();
    }, 30000);

  it('flat on flat: a 3-hole dropped 40 cells crosswise onto a flat 9-hole bounces and never passes through it', async () => {
    // Fixed 9-hole beam along Z (holes Y) at y = 0; loose 3-hole along X (holes Y) at y = 40.
    // Its cells over the fixed beam (|x| < 0.92 from the beam's centre line x = 0, |z| ≤ 4.46)
    // must stay above 0.92 − 0.35 (transient impact penetration, see the drop above).
    // DEVIATIONS §5: Rapier distributes this symmetric 4-point impact unevenly, so the part may
    // be thrown off sideways with some spin; §5.3 allows "deflects off it".
    const s = await sim(mk([beam([0, 0, -4], [0, 0, 4], 1), beam([-1, 40, 0], [1, 40, 0], 1)], 1));
    let worst = Infinity;
    let bounced = false;
    for (let i = 1; i <= Math.round(2 / s.fixedDt) && s.hasBody(1); i++) {
      s.stepFixed(1);
      if (!s.hasBody(1)) break;
      for (const c of [[-1, 40, 0], [0, 40, 0], [1, 40, 0]] as Vec3[]) {
        const p = where(s, 1, c);
        if (Math.abs(p[0]) < 0.92 && Math.abs(p[2]) < 4.46) worst = Math.min(worst, p[1]);
      }
      if (s.bodyVelocity(1)!.v[1] > 0) bounced = true;
    }
    report(`flat drop 40 onto flat beam: bounced ${bounced}, lowest cell centre over the beam ${worst.toFixed(4)} (touching at 0.92), removed after leaving ${!s.hasBody(1)}`);
    expect(bounced).toBe(true);
    expect(worst).toBeGreaterThan(0.92 - 0.35);
    s.dispose();
  }, 30000);
});

describe('welds', () => {
  it('two beams joined by two pins move as one rigid body (relative pose constant to 1e-6)', async () => {
    const s = await sim(buildExample('weld-test'));
    expect(s.bodyOf(2)).toBe(s.bodyOf(3));
    const pts: Vec3[] = [[0, 0, 1], [4, 0, 1], [2, 0, 2], [5, 0, 2]];
    const d0 = pts.map((p) => pts.map((q) => Math.hypot(...sub(p, q))));
    let worst = 0; // relative pose
    let distWorst = 0; // inter-point distances within the pair
    let swing = 0;
    for (let i = 0; i < 400; i++) {
      s.stepFixed(6);
      const ta = s.partTransform(2)!;
      const tb = s.partTransform(3)!;
      // Relative pose of part 3 in part 2's frame: the identity.
      for (const p of pts) {
        const pb = where(s, s.bodyOf(3)!, p);
        const back = toEditFrame(ta, pb);
        worst = Math.max(worst, Math.hypot(...sub(back, p)));
      }
      worst = Math.max(worst, ...tb.q.map((x, k) => Math.abs(x - ta.q[k]!)), ...tb.p.map((x, k) => Math.abs(x - ta.p[k]!)));
      swing = Math.max(swing, 2 * Math.acos(Math.min(1, Math.abs(ta.q[3]))));
      const cur = pts.map((p) => where(s, s.bodyOf(2)!, p));
      for (let a = 0; a < pts.length; a++)
        for (let b = 0; b < pts.length; b++) distWorst = Math.max(distWorst, Math.abs(Math.hypot(...sub(cur[a]!, cur[b]!)) - d0[a]![b]!));
    }
    report(`welds: relative pose deviation ${worst.toExponential(2)}, distance drift ${distWorst.toExponential(2)}, swing ${((swing * 180) / Math.PI).toFixed(0)}°`);
    expect(worst).toBeLessThan(1e-6);
    // Rigid: point distances are preserved (Rapier keeps rotations as f32 unit quaternions).
    expect(distWorst).toBeLessThan(1e-5);
    expect(swing).toBeGreaterThan(Math.PI / 2);
    s.dispose();
  }, 30000);
});
