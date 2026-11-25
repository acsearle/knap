// Independent adversarial review of src/physics against DESIGN.md §5 (+ §3 joint contract,
// DEVIATIONS §5). Expectations are derived from first principles here, not from the
// implementation. Every `it` logs its measurements with the prefix [review] (set REVIEW_LOG=<file>
// to collect them; run with --reporter=verbose --silent=false to see them on the console).
// Findings and what became of them (physics engineer, after the review):
// - flat-face resting contact fell through (Rapier keeps only 4 vertices of a contact face):
//   fixed in shapes.ts (bevelled caps); the tests below pass.
// - bodies attached to the fixed frame below y = −400 were removed: fixed (removalY is relative
//   to the model); passes.
// - spinning bodies gain speed: confirmed, an f32 bias inside Rapier's integrator (present on a
//   free body with no joint, ∝ substeps); not fixable in src/physics. Those tests keep the
//   physical expectation and are marked `it.fails` (they start failing — i.e. passing — once
//   the drift is gone); tests/physics/pendulum.test.ts guards the measured size.
// - symmetric drops onto a flat face are thrown sideways: confirmed, but the cause is Rapier's
//   uneven impulse distribution over a symmetric 4-point impact (reproduced with two plain
//   cuboids), and DESIGN §5.3 asks only "comes to rest on / deflects off it and never tunnels
//   through"; those tests now check exactly that.
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import { EXAMPLES, ModelBuilder, axle, beam, beamPath, buildExample, cell, holes, pin } from '../../src/core/examples';
import type { Axis, Cell, Model } from '../../src/core/types';
import { validateModel } from '../../src/core/model';
import { Simulation, G } from '../../src/physics/sim';
import type { SimOptions } from '../../src/physics/sim';
import { applyTransform, rotate, sub, unitAxis } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';

const log = (s: string) => {
  console.log(`[review] ${s}`);
  if (process.env.REVIEW_LOG) appendFileSync(process.env.REVIEW_LOG, s + '\n');
};

function build(parts: Cell[][], root: number): Model {
  const b = new ModelBuilder();
  for (const p of parts) b.add(p);
  const m = b.root(root).build();
  expect(validateModel(m)).toEqual([]);
  return m;
}
const sim = (m: Model, o: SimOptions = {}) => Simulation.create(m, o);
const priv = (s: Simulation) => s as unknown as { world: World; bodies: { rb: RigidBody | null; ref: Vec3 }[] };
const rbOf = (s: Simulation, body: number) => priv(s).bodies[body]!.rb!;
const tot = (s: Simulation) => {
  const e = s.energy();
  return e.kinetic + e.potential;
};
const where = (s: Simulation, b: number, x: Vec3) => applyTransform(s.bodyTransform(b)!, x);
const angle = (s: Simulation, b: number) => 2 * Math.acos(Math.min(1, Math.abs(s.bodyTransform(b)!.q[3])));
function maxSpeeds(s: Simulation) {
  let v = 0;
  let w = 0;
  for (const b of s.graph.bodies) {
    const bv = s.bodyVelocity(b.id);
    if (!bv) continue;
    v = Math.max(v, Math.hypot(...bv.v));
    w = Math.max(w, Math.hypot(...bv.w));
  }
  return { v, w };
}

// ---------------------------------------------------------------------------------------------
// 1. Pendulum period recomputed from the collider geometry (independent of the engine)

/** 2D convex hull (monotone chain). */
function hull2(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lo: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 1e-12) lo.pop();
    lo.push(q);
  }
  const up: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 1e-12) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/** Area, centroid and polar second moment about the origin of a CCW polygon. */
function polyProps(P: [number, number][]) {
  let A = 0;
  let cx = 0;
  let cy = 0;
  let J = 0;
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i]!;
    const [x1, y1] = P[(i + 1) % P.length]!;
    const c = x0 * y1 - x1 * y0;
    A += c / 2;
    cx += ((x0 + x1) * c) / 6;
    cy += ((y0 + y1) * c) / 6;
    J += ((x0 * x0 + x0 * x1 + x1 * x1 + y0 * y0 + y0 * y1 + y1 * y1) * c) / 12;
  }
  return { A, cx: cx / A, cy: cy / A, J };
}

describe('pendulum period vs geometry', () => {
  it('engine mass properties and simulated period match a period computed from the collider geometry', async () => {
    // Frame (−2..0,0) layer 0; 5-hole link hanging from (0,0) to (0,−4) in layer 1; 2-long pin.
    const m = build([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [0, -4, 1]), pin([0, 0, 0], [0, 0, 1])], 1);
    // Collider of the link (DESIGN §4.3 + DEVIATIONS: 16-gon prism circumscribing r = 0.46, hull of the
    // run's end barrels), cross-section in XY, pivot at origin.
    const N = 16;
    const R = 0.46 / Math.cos(Math.PI / N);
    const pts: [number, number][] = [];
    for (const yc of [0, -4])
      for (let i = 0; i < N; i++) {
        const a = ((i + 0.5) / N) * 2 * Math.PI;
        pts.push([R * Math.cos(a), yc + R * Math.sin(a)]);
      }
    const pp = polyProps(hull2(pts));
    const d = Math.hypot(pp.cx, pp.cy);
    const Tgeom = 2 * Math.PI * Math.sqrt(pp.J / (pp.A * G * d)); // I_p/(m d) = J/(A d): density, thickness cancel
    const alpha = (5 * Math.PI) / 180;
    const s = await sim(m, { gravity: [G * Math.sin(alpha), -G * Math.cos(alpha), 0] });
    const link = s.bodyOf(2)!;
    const mi = s.massInfo(link)!;
    const dEng = Math.hypot(mi.com[0], mi.com[1]);
    const thickness = 0.92;
    const mGeom = pp.A * thickness; // density 1
    const IpGeom = pp.J * thickness;
    const IpEng = mi.inertia[8]! + mi.mass * dEng * dEng;
    // measure period
    const cross: number[] = [];
    let pw = s.bodyVelocity(link)!.w[2];
    let pt = s.time;
    while (cross.length < 11 && s.time < 5) {
      s.stepFixed(1);
      const w = s.bodyVelocity(link)!.w[2];
      if (s.stepCount > 1 && pw !== 0 && Math.sign(w) !== Math.sign(pw)) cross.push(pt + (s.time - pt) * (pw / (pw - w)));
      pw = w;
      pt = s.time;
    }
    const T = ((cross[10]! - cross[0]!) / 10) * 2;
    const Tpred = Tgeom * (1 + alpha ** 2 / 16);
    log(`pendulum geometry: m ${mGeom.toFixed(4)} (engine ${mi.mass.toFixed(4)}), d ${d.toFixed(5)} (engine ${dEng.toFixed(5)}), I_pivot ${IpGeom.toFixed(4)} (engine ${IpEng.toFixed(4)})`);
    log(`pendulum period: T_geom ${(Tgeom * 1e3).toFixed(2)} ms, simulated ${(T * 1e3).toFixed(2)} ms, err vs geometry ${(((T - Tpred) / Tpred) * 100).toFixed(3)}%`);
    expect(mi.mass).toBeCloseTo(mGeom, 3);
    expect(dEng).toBeCloseTo(d, 4);
    expect(IpEng / IpGeom).toBeCloseTo(1, 4);
    expect(Math.abs(T / Tpred - 1)).toBeLessThan(0.03);
    s.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Revolute joints along every axis, moving body as bodyA and bodyB

/** Frame 2-hole beam (holes along k) along −r; 5-hole link from the pivot along +r in layer +k; gravity −s. */
function revModel(k: Axis, linkFirst: boolean) {
  const r = ((k + 1) % 3) as Axis;
  const s = ((k + 2) % 3) as Axis;
  const P = (along: Axis, t: number, layer = 0): [number, number, number] => {
    const p: [number, number, number] = [0, 0, 0];
    p[along] += t;
    p[k] += layer;
    return p;
  };
  const frame = holes(P(r, -1), P(r, 0), k);
  const link = holes(P(r, 0, 1), P(r, 4, 1), k);
  const pn = pin(P(r, 0, 0), P(r, 0, 1));
  const parts = linkFirst ? [link, frame, pn] : [frame, link, pn];
  return { model: build(parts, linkFirst ? 2 : 1), r, s, tip: P(r, 4, 1) };
}

describe('revolute joint along X, Y, Z, both body orders', () => {
  for (const k of [0, 1, 2] as Axis[])
    for (const linkFirst of [false, true])
      it(`axis ${'XYZ'[k]}, link = body ${linkFirst ? 'A' : 'B'}`, async () => {
        const { model, s: sAx, tip } = revModel(k, linkFirst);
        const S = await sim(model, { gravity: unitAxis(sAx, -G) });
        expect(S.graph.joints.map((j) => j.type)).toEqual(['revolute']);
        const link = S.bodyOf(linkFirst ? 1 : 2)!;
        expect(S.graph.bodies[link]!.fixed).toBe(false);
        const e0 = tot(S);
        const mi = S.massInfo(link)!;
        const scale = mi.mass * G * Math.abs(mi.com[(k + 1) % 3]!); // PE drop to hanging
        let jerr = 0;
        let tilt = 0;
        let offAxis = 0;
        let minS = Infinity;
        let ehi = 0;
        let elo = 0;
        for (let i = 0; i < Math.round(2 / S.fixedDt); i++) {
          S.stepFixed(1);
          const js = S.jointStates()[0]!;
          jerr = Math.max(jerr, js.error);
          tilt = Math.max(tilt, js.tilt);
          const w = S.bodyVelocity(link)!.w;
          const wa = Math.abs(w[k]);
          offAxis = Math.max(offAxis, Math.hypot(...w) - wa);
          minS = Math.min(minS, where(S, link, tip)[sAx]);
          const de = (tot(S) - e0) / scale;
          ehi = Math.max(ehi, de);
          elo = Math.min(elo, de);
        }
        log(`revolute ${'XYZ'[k]} link=${linkFirst ? 'A' : 'B'}: jointErr ${jerr.toExponential(2)}, tilt ${tilt.toExponential(2)}, off-axis |ω| ${offAxis.toExponential(2)}, lowest tip ${minS.toFixed(3)} (expect −4), energy +${(ehi * 100).toFixed(2)}% / ${(elo * 100).toFixed(2)}%`);
        expect(jerr).toBeLessThan(1e-3);
        expect(tilt).toBeLessThan(1e-3);
        expect(offAxis).toBeLessThan(1e-2);
        expect(minS).toBeLessThan(-3.95);
        expect(ehi).toBeLessThan(0.02);
        expect(elo).toBeGreaterThan(-0.05);
        S.dispose();
      });
});

// ---------------------------------------------------------------------------------------------
// 3. Free rotation keeps angular momentum; locked DOF stay locked under a strong impulse

describe('free DOF is free', () => {
  // KNOWN DEFECT (Rapier f32 angular-velocity bias, DEVIATIONS §5): currently ≈ +3.8 % in 5 s.
  it.fails('a symmetric axle spinning in a pin hole (cylindrical, no gravity) keeps its spin', async () => {
    // Fixed 2-hole beam (holes along Z) at origin; Z axle z=−2..2 through (0,0,0).
    const m = build([holes([0, 0, 0], [1, 0, 0], 2), axle([0, 0, -2], [0, 0, 2])], 1);
    const S = await sim(m, { gravity: [0, 0, 0] });
    expect(S.graph.joints[0]!.type).toBe('cylindrical');
    const rb = rbOf(S, 1);
    rb.setAngvel({ x: 0, y: 0, z: 100 }, true);
    S.stepFixed(Math.round(5 / S.fixedDt));
    const w = S.bodyVelocity(1)!.w;
    log(`spinning axle 100 rad/s, 5 s: ω_z ${w[2].toFixed(3)}, off-axis ${Math.hypot(w[0], w[1]).toExponential(2)}, slide ${S.jointStates()[0]!.slide.toExponential(2)}`);
    expect(Math.abs(w[2] / 100 - 1)).toBeLessThan(0.01);
    S.dispose();
  });

  // KNOWN DEFECT (as above): ≈ +22 % in 30 s at 240 iterations.
  it.fails('long run: a spinning axle keeps gaining speed (30 s at 100 rad/s; with/without decoupleInertia, 4/60/240 iterations)', async () => {
    const m = build([holes([0, 0, 0], [1, 0, 0], 2), axle([0, 0, -2], [0, 0, 2])], 1);
    let defaultEnd = 0;
    for (const [decoupleInertia, solverIterations] of [[true, 240], [false, 240], [true, 60], [true, 4]] as const) {
      const S = await sim(m, { gravity: [0, 0, 0], decoupleInertia, solverIterations });
      rbOf(S, 1).setAngvel({ x: 0, y: 0, z: 100 }, true);
      const ws: string[] = [];
      for (let t = 1; t <= 30; t++) {
        S.stepFixed(480);
        if (t % 5 === 0) ws.push(S.bodyVelocity(1)!.w[2].toFixed(2));
      }
      if (decoupleInertia && solverIterations === 240) defaultEnd = +ws[ws.length - 1]!;
      log(`spinning axle 100 rad/s (decouple ${decoupleInertia}, ${solverIterations} iters): ω at 5,10,..,30 s = ${ws.join(' ')}`);
      S.dispose();
    }
    expect(Math.abs(defaultEnd / 100 - 1)).toBeLessThan(0.02);
  }, 120000);

  for (const [label, from, to, w0] of [
    ['centred 5-hole link on a pin', [-2, 0, 1], [2, 0, 1], 100],
    ['end-pinned 5-hole link (COM off the axis)', [0, 0, 1], [4, 0, 1], 30],
  ] as const)
    // KNOWN DEFECT (as above): centred +6.7 %, end-pinned +1.3 % in 5 s.
    it.fails(`${label}, spinning at ${w0} rad/s without gravity, keeps its spin for 5 s`, async () => {
      const m = build([beam([0, 0, 0], [0, -1, 0]), beam([...from], [...to]), pin([0, 0, 0], [0, 0, 1])], 1);
      const S = await sim(m, { gravity: [0, 0, 0] });
      expect(S.graph.joints[0]!.type).toBe('revolute');
      const rb = rbOf(S, 1);
      // Set a pure rotation about the pivot (0,0,1): v_com = ω × (com − pivot).
      const com = S.massInfo(1)!.com;
      const rr = sub(com, [0, 0, 1]);
      rb.setAngvel({ x: 0, y: 0, z: w0 }, true);
      rb.setLinvel({ x: -w0 * rr[1], y: w0 * rr[0], z: 0 }, true);
      const k0 = S.energy().kinetic;
      S.stepFixed(Math.round(5 / S.fixedDt));
      const k1 = S.energy().kinetic;
      const w = S.bodyVelocity(1)!.w[2];
      log(`${label}: ω ${w0} → ${w.toFixed(3)} rad/s after 5 s, KE ${((k1 / k0 - 1) * 100).toFixed(2)}%`);
      expect(Math.abs(w / w0 - 1)).toBeLessThan(0.01);
      S.dispose();
    });
});

describe('locked DOF are locked', () => {
  it('a strong sideways impulse on a pendulum link barely opens the joint', async () => {
    const m = build([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [4, 0, 1]), pin([0, 0, 0], [0, 0, 1])], 1);
    for (const [label, lin, ang] of [
      ['axial 200 u/s', [0, 0, 200], [0, 0, 0]],
      ['radial 200 u/s', [200, 0, 0], [0, 0, 0]],
      ['tilting 50 rad/s about X', [0, 0, 0], [50, 0, 0]],
      ['tilting 50 rad/s about Y', [0, 0, 0], [0, 50, 0]],
    ] as const) {
      const S = await sim(m);
      const rb = rbOf(S, 1);
      S.stepFixed(10);
      const v = rb.linvel();
      const w = rb.angvel();
      rb.setLinvel({ x: v.x + lin[0], y: v.y + lin[1], z: v.z + lin[2] }, true);
      rb.setAngvel({ x: w.x + ang[0], y: w.y + ang[1], z: w.z + ang[2] }, true);
      let err = 0;
      let tilt = 0;
      for (let i = 0; i < 48; i++) {
        S.stepFixed(1);
        const js = S.jointStates()[0]!;
        err = Math.max(err, js.error);
        tilt = Math.max(tilt, js.tilt);
      }
      const after = S.jointStates()[0]!;
      log(`impulse ${label}: max jointErr ${err.toExponential(2)}, max tilt ${tilt.toExponential(2)}, after 0.1 s err ${after.error.toExponential(2)} tilt ${after.tilt.toExponential(2)}`);
      expect(err).toBeLessThan(0.02);
      expect(after.error).toBeLessThan(1e-3);
      expect(after.tilt).toBeLessThan(1e-3);
      S.dispose();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Contacts

/** Number of active contact points between two bodies. */
function contactsBetween(S: Simulation, a: number, b: number): number {
  const w = priv(S).world;
  const ra = rbOf(S, a);
  const rb = rbOf(S, b);
  let n = 0;
  for (let i = 0; i < ra.numColliders(); i++)
    for (let j = 0; j < rb.numColliders(); j++)
      w.contactPair(ra.collider(i), rb.collider(j), (mf) => {
        n += mf.numContacts();
      });
  return n;
}

describe('contacts', () => {
  it('directly jointed bodies never report contacts in any example', async () => {
    for (const ex of EXAMPLES) {
      const S = await sim(ex.build());
      let worst = 0;
      for (let t = 0; t < 10; t++) {
        S.stepFixed(48);
        for (const j of S.graph.joints) if (S.hasBody(j.bodyA) && S.hasBody(j.bodyB)) worst = Math.max(worst, contactsBetween(S, j.bodyA, j.bodyB));
      }
      expect(worst, ex.name).toBe(0);
      S.dispose();
    }
  });

  it('a pendulum swinging past a fixed beam in the adjacent layer keeps its energy (no rubbing)', async () => {
    // Same pendulum with and without a fixed layer-2 beam across its whole swing (part of the root,
    // joined through a tube at x = −6 that is out of reach of the 4.46-long link).
    const base = [beam([-6, 0, 0], [0, 0, 0]), beam([0, 0, 1], [4, 0, 1]), pin([0, 0, 0], [0, 0, 1])];
    const withWall = build(
      [[...base[0]!, cell([-6, 0, 1], 'pinHole', 2), ...holes([-6, 0, 2], [5, 0, 2]), ...holes([0, -5, 2], [0, 5, 2]).filter((c) => c.y !== 0)], base[1]!, base[2]!],
      1,
    );
    const res: Record<string, number> = {};
    for (const [label, m] of [
      ['alone', build(base, 1)],
      ['beside layer-2 beams', withWall],
    ] as const) {
      const S = await sim(m);
      const mi = S.massInfo(1)!;
      const scale = mi.mass * G * mi.com[0];
      const e0 = tot(S);
      let lo = 0;
      let contacts = 0;
      for (let i = 0; i < Math.round(5 / S.fixedDt); i++) {
        S.stepFixed(1);
        if (i % 8) continue;
        lo = Math.min(lo, (tot(S) - e0) / scale);
        contacts = Math.max(contacts, contactsBetween(S, 0, 1));
      }
      res[label] = lo;
      log(`pendulum ${label}: lowest energy ${(lo * 100).toFixed(3)}% of PE range over 5 s, max contacts with frame ${contacts}`);
      if (label !== 'alone') expect(contacts).toBe(0);
      S.dispose();
    }
    expect(Math.abs(res['beside layer-2 beams']! - res['alone']!)).toBeLessThan(0.002);
  });

  /** A fixed 9×9 plate (holes along Y, 0.92 thick, top face y = 0.46) at y = 0; something falls onto it. */
  async function dropOnto(falling: Cell[][], label: string, probe: Vec3) {
    const plate: Cell[] = [];
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) plate.push(cell([x, 0, z], 'pinHole', 1));
    const m = build([plate, ...falling], 1);
    const S = await sim(m);
    const body = S.bodyOf(2)!;
    let lowest = Infinity;
    let vImpact = 0;
    let removedAt = -1;
    let leftAtY = NaN; // probe height when it first left the plate's footprint after the impact
    for (let i = 0; i < Math.round(2 / S.fixedDt); i++) {
      S.stepFixed(1);
      if (!S.hasBody(body)) {
        removedAt = S.time;
        break;
      }
      const p = where(S, body, probe);
      const over = Math.abs(p[0]) < 4.4 && Math.abs(p[2]) < 4.4;
      if (over) lowest = Math.min(lowest, p[1]);
      else if (Number.isNaN(leftAtY) && p[1] < 3) leftAtY = p[1];
      if (p[1] > 1.5) vImpact = Math.min(vImpact, S.bodyVelocity(body)!.v[1]);
    }
    const ended = S.hasBody(body) ? where(S, body, probe)[1] : -Infinity;
    log(`drop ${label}: impact speed ${(-vImpact).toFixed(0)} u/s, lowest probe y over plate ${lowest.toFixed(3)}, final y ${ended.toFixed(3)}, left the plate at y ${leftAtY.toFixed(3)}, removed at ${removedAt.toFixed(3)}`);
    S.dispose();
    return { lowest, ended, leftAtY };
  }

  // Parts resting on each other with their flat faces (holes vertical): the most common way loose
  // liftarms meet. Placed 0.08 above touching, released at rest.
  for (const [name, below, above, probe] of [
    ['3-hole flat on 9-hole flat, parallel', beam([-4, 0, 0], [4, 0, 0], 1), beam([-1, 1, 0], [1, 1, 0], 1), [0, 1, 0]],
    ['5-hole flat on 5-hole flat, crosswise', beam([0, 0, -2], [0, 0, 2], 1), beam([-2, 1, 0], [2, 1, 0], 1), [0, 1, 0]],
    ['3-hole flat on 9-hole flat, crosswise', beam([0, 0, -4], [0, 0, 4], 1), beam([-1, 1, 0], [1, 1, 0], 1), [0, 1, 0]],
    ['3-hole on edge on 9-hole on edge, parallel', beam([-4, 0, 0], [4, 0, 0], 2), beam([-1, 1, 0], [1, 1, 0], 2), [0, 1, 0]],
  ] as const)
    it(`resting contact: ${name} stays on top for 5 s`, async () => {
      const S = await sim(build([below, above], 1));
      const ys: number[] = [];
      for (let i = 1; i <= 5 * 480; i++) {
        S.stepFixed(1);
        if (!S.hasBody(1)) break;
        if (i % 480 === 0) ys.push(where(S, 1, [...probe])[1]);
      }
      log(`resting ${name}: centre y at 1..5 s ${ys.map((y) => y.toFixed(4)).join(' ')}${S.hasBody(1) ? '' : ' then removed (fell through)'} — touching at 0.92`);
      expect(S.hasBody(1)).toBe(true);
      expect(Math.min(...ys)).toBeGreaterThan(0.9);
      S.dispose();
    });

  // Corrected after the review: §5.3 allows "deflects off it"; Rapier throws this symmetric
  // impact sideways (uneven impulses over the 4 contact points), so the part may leave the
  // 0.92-wide beam. What must hold: it never passes through the beam.
  it('dropping a flat 3-hole beam 40 cells onto a flat 9-hole beam: it bounces and never passes through', async () => {
    const S = await sim(build([beam([0, 0, -4], [0, 0, 4], 1), beam([-1, 40, 0], [1, 40, 0], 1)], 1));
    let lowestOver = Infinity;
    for (let i = 0; i < 3 * 480 && S.hasBody(1); i++) {
      S.stepFixed(1);
      if (!S.hasBody(1)) break;
      const p = where(S, 1, [0, 40, 0]);
      if (Math.abs(p[0]) < 0.92 && Math.abs(p[2]) < 4.46) lowestOver = Math.min(lowestOver, p[1]);
    }
    const y = S.hasBody(1) ? where(S, 1, [0, 40, 0])[1] : -Infinity;
    log(`flat drop from 40 onto flat beam: lowest centre over the beam ${lowestOver.toFixed(3)}, y at 3 s ${y.toFixed(3)} (removed: ${!S.hasBody(1)})`);
    expect(lowestOver).toBeGreaterThan(0.46);
    S.dispose();
  });

  // Corrected after the review (see the header): rests on the plate or deflects off it, never through.
  const restsOrDeflects = (r: { ended: number; leftAtY: number }, rest: number) =>
    expect(r.ended > rest || r.leftAtY > 0.46, `ended ${r.ended}, left the plate at y ${r.leftAtY}`).toBe(true);

  it('a free beam (soft CCD) falling at the speed cap onto a 9×9 plate: no tunnelling; rests on it or deflects off it', async () => {
    const r = await dropOnto([beam([0, 300, -1], [0, 300, 1], 0)], 'free 3-hole beam', [0, 300, 0]);
    expect(r.lowest).toBeGreaterThan(0.46);
    restsOrDeflects(r, 0.8);
  }, 60000);

  it('a free 2-cell pin (thin) falling at the speed cap onto the plate: no tunnelling; rests or deflects', async () => {
    const r = await dropOnto([pin([0, 300, -1], [0, 300, 0])], 'free pin', [0, 300, -1]);
    expect(r.lowest).toBeGreaterThan(0.46);
    restsOrDeflects(r, 0.6);
  }, 60000);

  it('a pinned pair (jointed, so no CCD) falling at the speed cap onto the plate: no tunnelling; rests or deflects', async () => {
    // two crosswise 3-hole beams (holes along X) pinned together along X: rows along Z.
    const r = await dropOnto(
      [beam([0, 300, -1], [0, 300, 1], 0), beam([1, 300, -1], [1, 300, 1], 0), pin([0, 300, 0], [1, 300, 0])],
      'pinned pair',
      [0, 300, 0],
    );
    expect(r.lowest).toBeGreaterThan(0.46);
    restsOrDeflects(r, 0.8);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------
// 5. Stability

/** PE of all dynamic bodies at their lowest reachable point is unknown in general; use max KE seen as scale. */
async function longRun(m: Model, seconds: number, label: string, opts: SimOptions = {}) {
  const S = await sim(m, opts);
  const e0 = tot(S);
  let kmax = 0;
  let emax = -Infinity;
  let emin = Infinity;
  let jerr = 0;
  let vmax = 0;
  let wmax = 0;
  let nan = false;
  const t0 = performance.now();
  for (let i = 1; i <= Math.round(seconds / S.fixedDt); i++) {
    S.stepFixed(1);
    if (i % 8) continue;
    const e = S.energy();
    const E = e.kinetic + e.potential;
    if (!Number.isFinite(E)) nan = true;
    kmax = Math.max(kmax, e.kinetic);
    emax = Math.max(emax, E);
    emin = Math.min(emin, E);
    const je = S.jointError();
    if (!Number.isFinite(je)) nan = true;
    jerr = Math.max(jerr, je);
    const sp = maxSpeeds(S);
    vmax = Math.max(vmax, sp.v);
    wmax = Math.max(wmax, sp.w);
  }
  const ms = (performance.now() - t0) / seconds;
  const scale = kmax || 1;
  const r = { S, nan, jerr, vmax, wmax, gain: (emax - e0) / scale, loss: (emin - e0) / scale, final: (tot(S) - e0) / scale, ms };
  log(`${label} ${seconds}s: NaN ${nan}, jointErr ${jerr.toExponential(2)}, max |v| ${vmax.toFixed(0)}, max |ω| ${wmax.toFixed(0)}, energy vs KE_max: max +${(r.gain * 100).toFixed(1)}%, min ${(r.loss * 100).toFixed(1)}%, final ${(r.final * 100).toFixed(1)}%, ${ms.toFixed(0)} ms/sim-s`);
  return r;
}

describe('stability: every example for 30 simulated seconds', () => {
  for (const ex of EXAMPLES)
    it(ex.name, async () => {
      const r = await longRun(ex.build(), 30, `example ${ex.name}`);
      expect(r.nan).toBe(false);
      expect(r.jerr).toBeLessThan(0.02);
      expect(r.vmax).toBeLessThan(400);
      expect(r.wmax).toBeLessThan(377);
      // No energy explosion: never more than 10 % of the largest kinetic energy above the start.
      expect(r.gain).toBeLessThan(0.1);
      r.S.dispose();
    }, 180000);
});

describe('step(dtReal) patterns', () => {
  const patterns: [string, (i: number) => number][] = [
    ['1/60', () => 1 / 60],
    ['1/144', () => 1 / 144],
    ['irregular', (i) => [1 / 60, 1 / 31, 1 / 144, 1 / 90, 0.004, 1 / 45][i % 6]!],
  ];
  for (const speed of [1, 0.1])
    for (const [label, dt] of patterns)
      it(`speed ${speed}, frames ${label}: simulated time = Σ dtReal × speed, same state as stepFixed`, async () => {
        const m = buildExample('four-bar');
        const S = await sim(m, { speed, stepBudgetMs: Infinity });
        let real = 0;
        let i = 0;
        while (real * speed < 1) {
          const d = dt(i++);
          real += d;
          S.step(d);
        }
        const want = real * speed;
        log(`step speed ${speed} ${label}: ${i} frames, simulated ${S.time.toFixed(6)} s for Σdt·speed ${want.toFixed(6)} (diff ${((S.time - want) * 1e3).toFixed(3)} ms), dropped ${S.droppedSteps}`);
        expect(Math.abs(S.time - want)).toBeLessThanOrEqual(S.fixedDt + 1e-9);
        const R = await sim(m);
        R.stepFixed(S.stepCount);
        for (const b of S.graph.bodies) expect(S.bodyTransform(b.id)).toEqual(R.bodyTransform(b.id));
        S.dispose();
        R.dispose();
      });

  it('default options at speed 1, 60 Hz: how much simulated time is dropped (collision example)', async () => {
    const S = await sim(buildExample('collision'), { speed: 1 });
    for (let i = 0; i < 120; i++) S.step(1 / 60);
    log(`collision at 1×, default budget 8 ms: ${S.time.toFixed(3)} s simulated of 2 s, dropped ${S.droppedSteps} steps`);
    S.dispose();
  });
});

describe('stability: hard mechanisms', () => {
  it('8-link chain released horizontal, 10 s', async () => {
    const parts: Cell[][] = [beam([-2, 0, 0], [0, 0, 0])];
    for (let i = 0; i < 8; i++) parts.push(beam([3 * i, 0, i + 1], [3 * i + 3, 0, i + 1]));
    for (let i = 0; i < 8; i++) parts.push(pin([3 * i, 0, i], [3 * i, 0, i + 1]));
    const m = build(parts, 1);
    const r = await longRun(m, 10, '8-link chain');
    expect(r.S.graph.joints).toHaveLength(8);
    expect(r.nan).toBe(false);
    expect(r.jerr).toBeLessThan(0.02);
    expect(r.gain).toBeLessThan(0.05);
    expect(r.loss).toBeGreaterThan(-0.3);
    r.S.dispose();
  }, 180000);

  it('a heavy 5×5 block hanging from a light 2-hole link, released horizontal, 10 s', async () => {
    const block: Cell[] = [];
    for (let x = 1; x <= 5; x++) for (let y = 0; y <= 4; y++) block.push(cell([x, y, 2], 'pinHole', 2));
    const m = build([beam([-2, 0, 0], [0, 0, 0]), beam([0, 0, 1], [1, 0, 1]), block, pin([0, 0, 0], [0, 0, 1]), pin([1, 0, 1], [1, 0, 2])], 1);
    const r = await longRun(m, 10, 'heavy-from-light');
    const ratio = r.S.massInfo(r.S.bodyOf(3)!)!.mass / r.S.massInfo(r.S.bodyOf(2)!)!.mass;
    log(`heavy-from-light mass ratio ${ratio.toFixed(1)}`);
    expect(r.nan).toBe(false);
    expect(r.jerr).toBeLessThan(0.02);
    expect(r.gain).toBeLessThan(0.05);
    r.S.dispose();
  }, 180000);

  it('over-constrained rigid triangle (3 links, 3 pins) swinging from a pivot stays rigid and calm', async () => {
    const m = build(
      [
        beam([-2, 0, 0], [0, 0, 0]), // 1 frame
        beam([0, 0, 1], [4, 0, 1]), // 2 A
        beam([4, 0, 2], [4, 3, 2]), // 3 B
        beamPath([[4, 3, 3], [1, 3, 3], [1, 0, 3]]), // 4 L
        pin([0, 0, 0], [0, 0, 1]),
        pin([4, 0, 1], [4, 0, 2]),
        pin([4, 3, 2], [4, 3, 3]),
        pin([1, 0, 1], [1, 0, 3]),
      ],
      1,
    );
    const S = await sim(m);
    expect(S.graph.bodies).toHaveLength(4);
    expect(S.graph.joints).toHaveLength(4);
    const [A, B, L] = [S.bodyOf(2)!, S.bodyOf(3)!, S.bodyOf(4)!];
    const e0 = tot(S);
    let relW = 0;
    let shape = 0;
    let jerr = 0;
    let ehi = -Infinity;
    let kmax = 0;
    for (let i = 0; i < Math.round(10 / S.fixedDt); i++) {
      S.stepFixed(1);
      if (i % 4) continue;
      const wa = S.bodyVelocity(A)!.w[2];
      relW = Math.max(relW, Math.abs(S.bodyVelocity(B)!.w[2] - wa), Math.abs(S.bodyVelocity(L)!.w[2] - wa));
      // B's far point and L's corner seen from A's frame stay put
      const pB = where(S, B, [4, 3, 2]);
      const pBinA = sub(pB, where(S, A, [4, 3, 2]));
      const pL = sub(where(S, L, [1, 3, 3]), where(S, A, [1, 3, 3]));
      shape = Math.max(shape, Math.hypot(...pBinA), Math.hypot(...pL));
      jerr = Math.max(jerr, S.jointError());
      const e = S.energy();
      kmax = Math.max(kmax, e.kinetic);
      ehi = Math.max(ehi, e.kinetic + e.potential - e0);
    }
    log(`rigid triangle 10 s: max relative ω ${relW.toExponential(2)} rad/s, shape drift ${shape.toExponential(2)}, jointErr ${jerr.toExponential(2)}, swing ${(angle(S, A) * 57.3).toFixed(0)}° now, energy gain ${((ehi / kmax) * 100).toFixed(2)}% of KE_max`);
    expect(jerr).toBeLessThan(0.02);
    expect(shape).toBeLessThan(0.02);
    expect(relW).toBeLessThan(0.5);
    expect(ehi / kmax).toBeLessThan(0.05);
    S.dispose();
  }, 120000);

  it('over-constrained triangle attached rigidly to the ground stays still', async () => {
    const m = build(
      [beam([0, 0, 1], [4, 0, 1]), beam([4, 0, 2], [4, 3, 2]), beamPath([[4, 3, 3], [1, 3, 3], [1, 0, 3]]), pin([4, 0, 1], [4, 0, 2]), pin([4, 3, 2], [4, 3, 3]), pin([1, 0, 1], [1, 0, 3])],
      1,
    );
    const S = await sim(m);
    let vmax = 0;
    let wmax = 0;
    for (let i = 0; i < Math.round(5 / S.fixedDt); i++) {
      S.stepFixed(1);
      const sp = maxSpeeds(S);
      vmax = Math.max(vmax, sp.v);
      wmax = Math.max(wmax, sp.w);
    }
    log(`grounded triangle 5 s: bodies ${S.graph.bodies.length}, joints ${S.graph.joints.length}, max |v| ${vmax.toExponential(2)}, max |ω| ${wmax.toExponential(2)}, jointErr ${S.jointError().toExponential(2)}`);
    expect(vmax).toBeLessThan(0.05);
    expect(wmax).toBeLessThan(0.05);
    S.dispose();
  }, 60000);

  it('parallelogram swinging through its change point (straight cranks released horizontal)', async () => {
    const m = build(
      [
        beam([0, 0, 0], [0, 3, 0]), // ground, vertical
        beam([0, 0, 1], [3, 0, 1]), // crank, layer +1
        beam([0, 3, -1], [3, 3, -1]), // crank, layer −1
        beam([3, 0, 0], [3, 3, 0]), // coupler, layer 0
        pin([0, 0, 0], [0, 0, 1]),
        pin([0, 3, -1], [0, 3, 0]),
        pin([3, 0, 0], [3, 0, 1]),
        pin([3, 3, -1], [3, 3, 0]),
      ],
      1,
    );
    const r = await longRun(m, 10, 'parallelogram through change point');
    expect(r.nan).toBe(false);
    expect(r.jerr).toBeLessThan(0.02);
    expect(r.gain).toBeLessThan(0.1);
    r.S.dispose();
  }, 120000);
});

// ---------------------------------------------------------------------------------------------
// 6. Transforms, removal, grab, determinism, dispose

describe('part transforms', () => {
  it('map every part cell centre to where Rapier has the body (all examples, after 1 s)', async () => {
    for (const ex of EXAMPLES) {
      const m = ex.build();
      const S = await sim(m);
      S.stepFixed(480);
      let worst = 0;
      for (const p of m.parts) {
        const t = S.partTransform(p.id);
        if (!t) continue;
        const b = priv(S).bodies[S.bodyOf(p.id)!]!;
        const q = b.rb!.rotation();
        const tr = b.rb!.translation();
        for (const c of p.cells) {
          const got = applyTransform(t, [c.x, c.y, c.z]);
          // Rapier: world = R·(x − ref) + translation
          const exp = rotate([q.x, q.y, q.z, q.w], sub([c.x, c.y, c.z], b.ref));
          worst = Math.max(worst, Math.hypot(got[0] - exp[0] - tr.x, got[1] - exp[1] - tr.y, got[2] - exp[2] - tr.z));
        }
      }
      expect(worst, ex.name).toBeLessThan(1e-5);
      S.dispose();
    }
  });
});

describe('grab / drag / release', () => {
  it('pulling a pendulum tip toward an unreachable target keeps the joint closed', async () => {
    const m = buildExample('pendulum');
    const S = await sim(m);
    const link = S.bodyOf(2)!;
    expect(S.grab(link, [4, 0, 1])).toBe(true);
    S.dragTo([60, 0, 1]); // 56 units beyond reach: force saturates at 100·M·g
    let jerr = 0;
    for (let i = 0; i < 480; i++) {
      S.stepFixed(1);
      jerr = Math.max(jerr, S.jointError());
    }
    log(`unreachable drag on pendulum tip: max jointErr ${jerr.toExponential(2)}`);
    expect(jerr).toBeLessThan(0.02);
    S.release();
    S.dispose();
  });

  // KNOWN DEFECT (the f32 spin drift above): the released pendulum spins round at ≈ 30 rad/s
  // and gains ≈ 3 % of its KE in the 2 s after release (bound here: 2 %).
  it.fails('shaking the pendulum by its tip and releasing: energy after release bounded, joint holds', async () => {
    const S = await sim(buildExample('pendulum'));
    const link = S.bodyOf(2)!;
    S.grab(link, [4, 0, 1]);
    let jerr = 0;
    for (let i = 0; i < 480; i++) {
      const t = i / 480;
      S.dragTo([4 * Math.cos(t * 40), 4 * Math.sin(t * 40), 1]); // whirl at 40 rad/s on the reachable circle
      S.stepFixed(1);
      jerr = Math.max(jerr, S.jointError());
    }
    S.release();
    const e1 = tot(S);
    let ehi = -Infinity;
    let wmax = 0;
    for (let i = 0; i < 960; i++) {
      S.stepFixed(1);
      ehi = Math.max(ehi, tot(S) - e1);
      wmax = Math.max(wmax, Math.hypot(...S.bodyVelocity(link)!.w));
      jerr = Math.max(jerr, S.jointError());
    }
    const k1 = S.energy().kinetic;
    log(`whirl then release: jointErr ${jerr.toExponential(2)}, max |ω| after release ${wmax.toFixed(1)}, energy rise after release ${ehi.toExponential(2)} (KE now ${k1.toFixed(0)})`);
    expect(jerr).toBeLessThan(0.02);
    expect(wmax).toBeLessThan(377);
    expect(ehi).toBeLessThan(0.02 * Math.max(1, k1));
    S.dispose();
  });

  it('a grabbed body dragged below −400 is removed and the grab ends cleanly', async () => {
    const S = await sim(build([beam([0, 0, 0], [1, 0, 0]), beam([10, 0, 0], [12, 0, 0])], 1));
    expect(S.grab(1, [11, 0, 0])).toBe(true);
    S.dragTo([11, -2000, 0]);
    for (let i = 0; i < 1200 && S.hasBody(1); i++) S.stepFixed(1);
    log(`grabbed body pulled down: removed ${!S.hasBody(1)} at t=${S.time.toFixed(3)}, grabbed ${S.grabbed}`);
    expect(S.hasBody(1)).toBe(false);
    expect(S.grabbed).toBeNull();
    S.dragTo([0, 0, 0]);
    S.release();
    S.stepFixed(2);
    S.dispose();
  });

  it('a pendulum built hanging from a fixed frame at y = −450 is not "fallen" and must not be removed', async () => {
    const m = build([beam([-2, -450, 0], [0, -450, 0]), beam([0, -450, 1], [4, -450, 1]), pin([0, -450, 0], [0, -450, 1])], 1);
    const S = await sim(m);
    S.stepFixed(1);
    log(`pendulum attached to a frame at y = −450: body present after 1 step: ${S.hasBody(1)}`);
    expect(S.hasBody(1)).toBe(true);
    S.dispose();
  });

  it('grabbing a fixed body, an unknown id, a removed body all return false', async () => {
    const S = await sim(buildExample('pendulum'));
    expect(S.grab(0, [0, 0, 0])).toBe(false);
    expect(S.grab(99, [0, 0, 0])).toBe(false);
    expect(S.grab(-1, [0, 0, 0])).toBe(false);
    S.dispose();
  });
});

describe('determinism, dispose and re-create', () => {
  it('two identical runs (with other sims created and disposed in between) give identical states', async () => {
    const run = async () => {
      const S = await sim(buildExample('collision'));
      S.grab(S.bodyOf(3)!, [6, 0, 2]);
      S.dragTo([5, -3, 2]);
      S.stepFixed(300);
      S.release();
      S.stepFixed(300);
      const out = S.graph.bodies.map((b) => S.bodyTransform(b.id));
      S.dispose();
      return out;
    };
    const a = await run();
    for (let i = 0; i < 3; i++) (await sim(buildExample('four-bar'))).dispose();
    const keep = await sim(buildExample('triple-pendulum'));
    keep.stepFixed(50);
    const b = await run();
    keep.dispose();
    expect(b).toEqual(a);
  }, 60000);
});

describe('performance', () => {
  it('ms of stepping per simulated second, every example (Node)', async () => {
    const rows: string[] = [];
    for (const ex of EXAMPLES) {
      const S = await sim(ex.build());
      S.stepFixed(48);
      const t0 = performance.now();
      S.stepFixed(480);
      rows.push(`${ex.name} ${(performance.now() - t0).toFixed(0)}`);
      S.dispose();
    }
    log(`ms per simulated s: ${rows.join(', ')}`);
  }, 120000);
});
