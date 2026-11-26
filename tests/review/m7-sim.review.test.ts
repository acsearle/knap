// Adversarial verification "verify-sim" of the fixes made after the three milestone-7 reviews
// (DEVIATIONS "Fixes after the three adversarial reviews" §2–§5): ground collider first, floor at a
// male's free end, crank-hole webs, rim segments, free root pin, known limits.
//
// "FAILS ON PURPOSE: …" tests state what DESIGN / DEVIATIONS (or plain physics) promise and fail on
// the tree as reviewed (HEAD ede9948): each is a finding. Everything else passes and pins what was
// verified. Heavier sweeps behind these numbers: spikes/review-m7/ (README there).
// After the fixes for the verification: the floor (item 2) and the wheel sinks (item 6) are ordinary
// passing tests with the strict expectations; the far-pivot drift (item 1) and what is left of the
// wheel sinks are KNOWN LIMIT tests asserting the measured envelope from both sides; the crank-pin
// test (item 3, geometry) is unchanged.
import { describe, expect, it } from 'vitest';
import { EXAMPLES, ModelBuilder, beam, buildExample } from '../../src/core/examples';
import { analyze } from '../../src/core/kinematics';
import { effectiveRootId, makeCell, rootIsFixed, serialize, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Axis, Model } from '../../src/core/types';
import { buildPartMesh, initGeometry, partVolume } from '../../src/geometry';
import { Simulation } from '../../src/physics/sim';
import { groundPlane } from '../../src/physics/shapes';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { edgeProblems, meshShells } from '../geometry/helpers';
import { EXAMPLES as EXAMPLES_M6 } from '../../spikes/review-m7/m6/core/examples';
import { analyze as analyzeM6 } from '../../spikes/review-m7/m6/core/kinematics';
import type { Model as ModelM6 } from '../../spikes/review-m7/m6/core/types';
import { bruteAnalyze } from '../../spikes/review-m7/kbrute';
import { randomModel, variants } from '../../spikes/review-m7/kgen';
import { floorCases, initialGap } from '../../spikes/review-m7/floorlib';
import { inside } from '../../spikes/review-m7/meshcheck';

const HC = 0.46;
const G = 1226.25;
const gjson = (g: { mates: unknown; bodies: unknown; joints: unknown; bodyOfPart: Map<number, number> }) =>
  JSON.stringify({ m: g.mates, b: g.bodies, j: g.joints, p: [...g.bodyOfPart] });

// ---------------------------------------------------------------------------------------------
describe('item 5 — kinematics: free root pin, fixed-root models unchanged', () => {
  it('the seven milestone-6 examples build and analyse bit-identically to milestone 6 (8b3a791)', () => {
    expect(EXAMPLES_M6.length).toBe(7);
    for (const old of EXAMPLES_M6) {
      const mOld = old.build();
      const mNew = EXAMPLES.find((e) => e.name === old.name)!.build();
      expect(serialize(mNew)).toBe(JSON.stringify(mOld) === JSON.stringify(mNew) ? serialize(mNew) : 'model differs');
      expect(gjson(analyze(mNew))).toBe(gjson(analyzeM6(mOld) as never));
    }
  });

  it('fuzz: every fixed-root model analyses as milestone 6; pin/beam models agree with an independent brute-force §3.1', () => {
    // spikes/review-m7/kfuzz.test.ts runs 20 000 seeds (60 000 fixed-root variants identical, 40 000
    // brute-force comparisons, 0 disagreements); the generator gives a lone smooth root pin with
    // mates in 28 % of models (kstats.test.ts).
    let checked = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const beamsOnly = seed % 2 === 0;
      for (const v of variants(randomModel(seed, beamsOnly))) {
        const g = analyze(v.m);
        if (rootIsFixed(v.m)) expect(gjson(g), `seed ${seed} ${v.label}`).toBe(gjson(analyzeM6(v.m as unknown as ModelM6) as never));
        if (!beamsOnly) continue;
        const b = bruteAnalyze(v.m);
        for (const p of v.m.parts) expect(Math.min(...g.bodies[g.bodyOfPart.get(p.id)!]!.partIds), `seed ${seed} ${v.label} part ${p.id}`).toBe(b.rep.get(p.id));
        const js = g.joints.map((j) => `${Math.min(...g.bodies[j.bodyA]!.partIds)},${Math.min(...g.bodies[j.bodyB]!.partIds)}|${j.origin[0]},${j.origin[1]}`).sort();
        expect(js, `seed ${seed} ${v.label}`).toEqual([...b.joints].sort());
        checked++;
      }
    }
    expect(checked).toBe(750 * 4);
  });

  it('free root: no body is fixed, no lone smooth pin with mates survives, and the other parts partition exactly as with the root fixed', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const base = randomModel(seed);
      const free = setFixRoot(setGround(base, true), false);
      const fixed = setGround(base, true);
      const gf = analyze(free);
      const gx = analyze(fixed);
      expect(gf.bodies.some((b) => b.fixed)).toBe(false);
      const root = effectiveRootId(free);
      for (const b of gf.bodies) {
        if (b.partIds.length !== 1) continue;
        const p = free.parts.find((q) => q.id === b.partIds[0])!;
        const straight = p.cells.every((c) => c.kind === 'pin' && c.axis === p.cells[0]!.axis && c.x === p.cells[0]!.x && c.y === p.cells[0]!.y);
        const ms = gf.mates.filter((m) => m.malePart === p.id && gf.bodyOfPart.get(m.holePart) !== b.id);
        if (straight && ms.length && ms.every((m) => m.type === 'revolute')) throw new Error(`seed ${seed}: lone free pin ${p.id} survived (root ${root})`);
      }
      // partition of every part other than the root, compared as "same body as" relations
      const others = free.parts.map((p) => p.id).filter((id) => id !== root);
      for (const a of others)
        for (const c of others) expect(gf.bodyOfPart.get(a) === gf.bodyOfPart.get(c), `seed ${seed} parts ${a},${c}`).toBe(gx.bodyOfPart.get(a) === gx.bodyOfPart.get(c));
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('item 2 — floor plane vs the lowest collider', () => {
  it('flat floor: every model starts in exact contact (holes, rims, male ends and rods lying on their side lowest); the view floor is the physics plane', async () => {
    // spikes/review-m7/floor.test.ts prints every case with the t = 0+ energy. The view floor in
    // edit mode is physics/shapes groundPlane (app.ts updateFloor), the function the Simulation
    // uses, so it does not move at Play. (At review it was groundLevel + 0.04: 0.02 above the
    // plane when a male end was lowest, and the plane 0.17 above a lying rod.)
    for (const c of floorCases()) {
      const g = await initialGap(c.m, 0);
      expect(Math.abs(g.gap), c.label).toBeLessThan(1e-9);
      const s = await Simulation.create(c.m);
      expect(groundPlane(c.m)!.d, c.label).toBe(s.groundY);
      s.dispose();
    }
  }, 60000);

  it('tilted floor (groundSlopeDeg 5, 15): every model starts in exact contact along the normal', async () => {
    // At review the tilted plane used nominal cube corners + 0.04 and floated by up to 0.104.
    for (const c of floorCases().filter((x) => !x.label.startsWith('Cart')))
      for (const slope of [5, 15]) {
        const g = await initialGap(c.m, slope);
        expect(Math.abs(g.gap), `${c.label} ${slope}°`).toBeLessThan(1e-9);
      }
  }, 60000);

  it('a male rod lying horizontally as the lowest part starts in contact with the floor (at review: 0.170 above it, fell at Play)', async () => {
    // The plane is tangent to the lowest collider point (a horizontal pin's prism face R_COLL_ROD
    // below its axis), no longer only lowered from groundLevel + 0.04.
    const b = new ModelBuilder();
    b.add([makeCell(0, 0, 0, 'pin', 0), makeCell(1, 0, 0, 'pin', 0)]);
    const m = setFixRoot(setGround(b.build(), true), false);
    const g = await initialGap(m, 0);
    expect(Math.abs(g.gap)).toBeLessThan(1e-6); // at review 0.170
    const s = await Simulation.create(m);
    expect(s.groundY).toBeCloseTo(-0.29, 12);
    s.stepFixed(24);
    expect(s.energy().kinetic).toBeLessThan(0.01); // at review 110 in the first 0.05 s
    s.dispose();
  });
});

// ---------------------------------------------------------------------------------------------
describe('item 3 — crank holes near the rim edge (rimBridges)', () => {
  it('every hole crank that rule 1 joins only through the disc edge is one closed shell with its bore open (pin/axle hubs, r 1 … 4, X/Y/Z)', async () => {
    // The 672-solid sweep with web extent and neighbour-gap checks is spikes/review-m7/bridges.test.ts.
    await initGeometry();
    let n = 0;
    for (const hub of ['pinHole', 'axleHole'] as const)
      for (let r = 1; r <= 4; r += 0.5)
        for (const axis of [0, 1, 2] as Axis[])
          for (let du = 1; du <= 4; du++)
            for (let dv = 1; dv <= du; dv++) {
              const R = r - 0.03;
              const d = Math.hypot(du, dv);
              const near = Math.max(0, du - 0.5) ** 2 + Math.max(0, dv - 0.5) ** 2 < r * r && d - 0.47 >= R - 0.05;
              if (!near) continue;
              const u = ((axis + 1) % 3) as Axis;
              const v = ((axis + 2) % 3) as Axis;
              const p: Vec3 = [0, 0, 0];
              p[u] = du;
              p[v] = dv;
              const cells = [makeCell(0, 0, 0, hub, axis, r), makeCell(p[0], p[1], p[2], 'pinHole', axis)];
              const mesh = buildPartMesh({ id: 1, color: '#888888', cells });
              const label = `${hub} r ${r} axis ${axis} (${du},${dv})`;
              expect(meshShells(mesh), label).toBe(1);
              expect(edgeProblems(mesh), label).toEqual([]);
              for (const t of [-0.4, 0, 0.4]) {
                const q: Vec3 = [...p];
                q[axis] += t;
                expect(inside(mesh, q), `${label} bore at ${t}`).toBe(false);
              }
              n++;
            }
    expect(n).toBe(18); // (1,1) r 1, (3,2) r 3, (4,2) r 4 × 2 hubs × 3 axes (the octant du ≥ dv; (2,2) r 2.5 is not in the band)
  }, 60000);

  it('FIXED (was FAILS ON PURPOSE): a crank *pin* in the wheel part (r 2.5, pin at (2, 2)) is drawn as one piece with the wheel (was 2 shells, the rod 0.06 clear of the rim)', async () => {
    // Rule 1 joins every cell of the part that the disc overlaps, male cells included, but
    // rimBridges only bridges hole cells (`isHole(c.kind)`). Sweep (bridges.test.ts): male cranks
    // parallel to the hub axis at the edge positions: 54 of 84 solids are 2 shells; perpendicular
    // male cranks: 18 of 84. The physics welds them (same body), so the pin moves with the wheel
    // while visibly detached: (1,1) of r 1, (2,2) of r 2.5, (2,3) of r 3, (2,4) of r 4 …
    await initGeometry();
    const mesh = buildPartMesh({ id: 1, color: '#888888', cells: [makeCell(0, 0, 0, 'pinHole', 2, 2.5), makeCell(2, 2, 0, 'pin', 2), makeCell(2, 2, 1, 'pin', 2)] });
    expect(meshShells(mesh)).toBe(1); // measured 2
  });

  it('collider mass vs drawn solid for a crank hole (documented spec gap, DEVIATIONS §2–§4): the drawn hole removes material, the collider adds a cell', async () => {
    // Drilling a crank hole into a wheel *removes* π·R_BORE²·0.94 ≈ 0.28 of drawn volume; the physics
    // body *gains* the crank cell's prism (its overlap with the disc counted twice). Measured:
    // r 2.5 + (1,1): Δmass +0.620, Δdrawn −0.283 (COM 0.048 toward the hole); r 2.5 + (2,2):
    // +0.620 / +0.329 (0.097); r 3 + (2,3) (bridged): +0.620 / +0.521 (0.086).
    await initGeometry();
    const mv = async (cells: ReturnType<typeof makeCell>[]) => {
      const b = new ModelBuilder();
      b.add(cells);
      const s = await Simulation.create(setFixRoot(setGround(b.build(), true), false));
      const mass = s.massInfo(0)!.mass;
      s.dispose();
      return { mass, vol: partVolume({ id: 1, color: '#888888', cells }) };
    };
    const rows: string[] = [];
    for (const [r, u, v] of [[2.5, 1, 1], [2.5, 2, 2], [3, 2, 3]] as const) {
      const a = await mv([makeCell(0, 0, 0, 'pinHole', 2, r)]);
      const b = await mv([makeCell(0, 0, 0, 'pinHole', 2, r), makeCell(u, v, 0, 'pinHole', 2)]);
      rows.push(`r ${r} + (${u},${v}): Δmass ${(b.mass - a.mass).toFixed(3)}, Δdrawn volume ${(b.vol - a.vol).toFixed(3)}`);
      expect(b.mass - a.mass).toBeGreaterThan(0.5);
      if (u === 1) expect(b.vol - a.vol).toBeLessThan(-0.2);
    }
    console.log(rows.join('\n'));
    expect(rows.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
describe('item 1 — distance from the origin and from the floor\'s pivot', () => {
  const wheel = (at: Vec3, anchor?: Vec3): { m: Model; w: number } => {
    const b = new ModelBuilder();
    let root: number | undefined;
    if (anchor) root = b.add([makeCell(anchor[0], anchor[1], anchor[2], 'pinHole', 2)]);
    const w = b.add([makeCell(at[0], at[1], at[2], 'pinHole', 2)]);
    let m = setGround(setRim(b.build(), w, at, 1.5), true);
    if (root !== undefined) m = { ...m, rootPartId: root };
    else m = setFixRoot(m, false);
    return { m, w };
  };

  it('a loose wheel 5000 units from the origin (pivot under it) rests like one at the origin and rolls down 15° within 0.3 % of theory', async () => {
    // far.test.ts: x/z = 0, 100, 1000, 5000 on 0/5/15°: rest drift ≤ 9e-6 in 10 s at every offset;
    // rolling distance ratio 0.99893 at the origin, 0.99735 at x 5000 (15°); deterministic (2 runs each).
    for (const D of [0, 5000]) {
      const { m, w } = wheel([D, 0, 0]);
      let s = await Simulation.create(m);
      let bw = s.bodyOf(w)!;
      s.stepFixed(480);
      const c1 = s.massInfo(bw)!.com;
      s.stepFixed(480 * 4);
      const c2 = s.massInfo(bw)!.com;
      s.dispose();
      expect(Math.hypot(c2[0] - c1[0], c2[2] - c1[2]), `D ${D}`).toBeLessThan(1e-4);
      s = await Simulation.create(m, { groundSlopeDeg: 15 });
      bw = s.bodyOf(w)!;
      const mi = s.massInfo(bw)!;
      const R = 1.46;
      const a = (G * Math.sin(Math.PI / 12)) / (1 + mi.inertia[8]! / (mi.mass * R * R));
      const c0 = mi.com;
      s.stepFixed(240);
      const c = s.massInfo(bw)!.com;
      s.dispose();
      const along = (c[0] - c0[0]) * Math.cos(Math.PI / 12) - (c[1] - c0[1]) * Math.sin(Math.PI / 12);
      expect(Math.abs(along / (0.5 * a * 0.25) - 1), `D ${D}`).toBeLessThan(0.003);
    }
  }, 60000);

  it('KNOWN LIMIT: a loose wheel 1000 units from the floor\'s pivot drifts ≈ 1.3e-2 in 20 s (§5.3 "Rest" asks < 0.01; DEVIATIONS §5)', async () => {
    // Was FAILS ON PURPOSE. The ground-first fix cut the reviewer's case (pivot 100 away) from 0.35 to
    // 1.8e-3 in 20 s, but the drift is still there and grows with distance and time: 4.2e-3 /
    // 1.29e-2 / 2.19e-2 at 10 / 20 / 30 s here, 300 away 1.07e-2 in 30 s (farroll.test.ts). It needs
    // a model ~600+ units wide (the pivot is the mean cell centre), so it is documented, not fixed.
    // Asserted from both sides so that a change in either direction is noticed.
    const { m, w } = wheel([0, 0, 0], [-2000, 0, 0]);
    const s = await Simulation.create(m);
    const bw = s.bodyOf(w)!;
    s.stepFixed(480);
    const x0 = s.massInfo(bw)!.com[0];
    s.stepFixed(480 * 20);
    const dx = s.massInfo(bw)!.com[0] - x0;
    s.dispose();
    expect(Math.abs(dx)).toBeGreaterThan(0.009); // measured 1.29e-2
    expect(Math.abs(dx)).toBeLessThan(0.017);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------
describe('item 6 — the documented known limits', () => {
  it('a wheel lying across a loose beam on the floor rests on it (≤ 0.05 deep; at review 0.458 for r 1.5, 1 off the hub, 99.6 % of the beam\'s half-width HC)', async () => {
    // At review (one bevelled 32-gon hull): limits.test.ts over r 1.5 / 2.5 / 4 × beam 1 or 2 off the
    // hub × loose / fixed beam: worst depth 0.371 … 0.458; the hull's face met the beam's edge in a
    // single contact point and the wheel pivoted through. Now the hull is 32 wedges × 2 slabs
    // (shapes.ts wheelHullPieces): this case 0.0023, the whole sweep ≤ 0.067 (r 4, 1 off the hub,
    // see DEVIATIONS §5).
    const b = new ModelBuilder();
    const bm = b.add(beam([-7, 0, 1], [7, 0, 1], 1));
    const wl = b.add([makeCell(0, 1, 0, 'pinHole', 1)]);
    const m = setFixRoot(setGround(setRim(b.root(bm).build(), wl, [0, 1, 0], 1.5), true), false);
    const s = await Simulation.create(m);
    let worst = -Infinity;
    for (let k = 0; k < 5; k++) {
      s.stepFixed(480);
      const tw = s.partTransform(wl)!;
      const tb = s.partTransform(bm)!;
      for (const kk of [0.4, 0.7, 0.85, 1])
        for (let i = 0; i < 64; i++)
          for (const ax of [-HC, -HC / 2, 0, HC / 2, HC]) {
            const q: Vec3 = [1.46 * kk * Math.cos((i / 64) * 2 * Math.PI), 1 + ax, 1.46 * kk * Math.sin((i / 64) * 2 * Math.PI)];
            const e = rotate(conj(tb.q), sub(applyTransform(tw, q), tb.p));
            const t = Math.max(-7, Math.min(7, e[0]));
            worst = Math.max(worst, Math.min(HC - Math.hypot(e[0] - t, e[2] - 1), HC - Math.abs(e[1])));
          }
    }
    s.dispose();
    expect(worst).toBeLessThan(0.05); // at review 0.458
  }, 60000);

  it('KNOWN LIMIT: an r 4 wheel lying across a loose beam 1 off the hub rolls the beam onto its long edge, the beam sinks into the floor and the wheel rests ≈ 0.06 deep in it (DEVIATIONS §5)', async () => {
    // What is left of the review's lying-wheel finding. The wheel (mass 45) tips toward the floor and
    // presses the beam's (12.5) near edge; the beam rolls ≈ 3.7° about its long axis, past the 1.5–3.5°
    // slope of the bevel facets at its rounded ends, and parry's half-space contact then uses one
    // end's facet (2–3 points at x ≈ ±7.4) instead of the bottom face: the beam drops ≈ 0.6 into the
    // floor within 0.1 s, and the energy guard keeps the slow recovery from adding potential energy.
    // An ordinary-prism defect (shapes.ts BEVEL), not the wheel's; changing those prisms changes
    // every recorded trajectory. Asserted from both sides.
    const b = new ModelBuilder();
    const bm = b.add(beam([-7, 0, 1], [7, 0, 1], 1));
    const wl = b.add([makeCell(0, 1, 0, 'pinHole', 1)]);
    const m = setFixRoot(setGround(setRim(b.root(bm).build(), wl, [0, 1, 0], 4), true), false);
    const s = await Simulation.create(m);
    s.stepFixed(480 * 5);
    const tw = s.partTransform(wl)!;
    const tb = s.partTransform(bm)!;
    let worst = -Infinity;
    for (const kk of [0.4, 0.7, 0.85, 1])
      for (let i = 0; i < 64; i++)
        for (const ax of [-HC, -HC / 2, 0, HC / 2, HC]) {
          const q: Vec3 = [3.96 * kk * Math.cos((i / 64) * 2 * Math.PI), 1 + ax, 3.96 * kk * Math.sin((i / 64) * 2 * Math.PI)];
          const e = rotate(conj(tb.q), sub(applyTransform(tw, q), tb.p));
          const t = Math.max(-7, Math.min(7, e[0]));
          worst = Math.max(worst, Math.min(HC - Math.hypot(e[0] - t, e[2] - 1), HC - Math.abs(e[1])));
        }
    const beamInFloor = s.groundY! - (s.massInfo(s.bodyOf(bm)!)!.com[1] - HC);
    s.dispose();
    expect(worst).toBeGreaterThan(0.04); // measured 0.0645 (1 / 10 / 20 s: 0.067 / 0.053 / 0.054)
    expect(worst).toBeLessThan(0.08);
    expect(beamInFloor).toBeGreaterThan(0.25); // measured 0.369 (1 / 10 / 20 s: 0.45 / 0.32 / 0.36)
    expect(beamInFloor).toBeLessThan(0.5);
  }, 60000);
});

describe('item 6 — beyond the documented envelope', () => {
  it('an upright r 2.5 wheel resting on a loose beam that lies on the floor stays on top of it (resting sink ≤ 0.012, DEVIATIONS §5; at review 0.059 at 5 s)', async () => {
    // Not the documented "wheel lying across a beam": the wheel stands upright (axis Z) on a 11-hole
    // beam lying flat, 0.08 above it at t = 0. On a *fixed* beam it rested 0.0024 deep; on a loose
    // beam on the floor 0.039 / 0.059 / 0.061 at 1 / 5 / 20 s (r 1: 0.026, r 1.5: 0.033;
    // upright.test.ts). A Cart parked with one wheel on a loose beam: 0.165 at 20 s (limits.test.ts).
    // Cause: Rapier's dynamic–dynamic contacts are soft and the resting depth grows with the load per
    // contact point; the hull's two slabs double the points on a rim facet (shapes.ts WHEEL_SLABS).
    const b = new ModelBuilder();
    const bm = b.add(beam([-5, -3, 0], [5, -3, 0], 1));
    const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const m = setFixRoot(setGround(setRim(b.root(bm).build(), w, [0, 0, 0], 2.5), true), false);
    const s = await Simulation.create(m);
    s.stepFixed(480 * 5);
    const tw = s.partTransform(w)!;
    const tb = s.partTransform(bm)!;
    let worst = -Infinity;
    for (let i = 0; i < 128; i++)
      for (const ax of [-HC, -HC / 2, 0, HC / 2, HC]) {
        const q: Vec3 = [2.46 * Math.cos((i / 128) * 2 * Math.PI), 2.46 * Math.sin((i / 128) * 2 * Math.PI), ax];
        const e = rotate(conj(tb.q), sub(applyTransform(tw, q), tb.p));
        const t = Math.max(-5, Math.min(5, e[0]));
        worst = Math.max(worst, Math.min(HC - Math.hypot(e[0] - t, e[2]), HC - Math.abs(e[1] + 3)));
      }
    s.dispose();
    expect(worst).toBeLessThan(0.012); // at review 0.059
  }, 60000);
});
