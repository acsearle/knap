// Adversarial review of src/core/kinematics.ts and src/core/examples.ts against DESIGN.md §3 / §8.
// Expectations are re-derived by hand from the spec (and, where marked DEFECT, from the physical
// intent the spec states: "a loose smooth pin's own spin is irrelevant", "fix the root part in
// space"). Tests marked "fixed (was DEFECT)" failed against the first implementation and pass now.
import { describe, expect, it } from 'vitest';
import { ModelBuilder, EXAMPLES, axle, beam, beamPath, buildExample, bush, cell, holes, pin } from '../../src/core/examples';
import { analyze, lineKey, type KinematicGraph } from '../../src/core/kinematics';
import { setRoot, validateModel } from '../../src/core/model';
import type { Cell, Model } from '../../src/core/types';
import { mk, plain, rng, shuffleModel } from '../kinematics/helpers';

function A(m: Model): KinematicGraph {
  expect(validateModel(m)).toEqual([]);
  return analyze(m);
}
const parts = (g: KinematicGraph) => g.bodies.map((b) => b.partIds);
const sameBody = (g: KinematicGraph, p: number, q: number) => g.bodyOfPart.get(p) === g.bodyOfPart.get(q);
const jointBetween = (g: KinematicGraph, p: number, q: number) => {
  const a = g.bodyOfPart.get(p)!;
  const b = g.bodyOfPart.get(q)!;
  return g.joints.find((j) => (j.bodyA === a && j.bodyB === b) || (j.bodyA === b && j.bodyB === a));
};
/** Planar Grübler count, all joints 1-DOF revolutes about Z. */
const planarDof = (g: KinematicGraph) => 3 * (g.bodies.length - 1) - 2 * g.joints.length;

// ---------------------------------------------------------------------------------------------
// Graph invariants that must hold for every model (§3.1 step 4, §3.2)

function expectInvariants(m: Model, g: KinematicGraph) {
  // dense ids, ordered by lowest part id, partIds ascending
  g.bodies.forEach((b, i) => {
    expect(b.id).toBe(i);
    expect([...b.partIds].sort((x, y) => x - y)).toEqual(b.partIds);
    if (i > 0) expect(b.partIds[0]!).toBeGreaterThan(g.bodies[i - 1]!.partIds[0]!);
  });
  // exactly one fixed body iff there are parts
  expect(g.bodies.filter((b) => b.fixed).length).toBe(m.parts.length ? 1 : 0);
  // joints: bodyA < bodyB, one per pair, sorted
  const seen = new Set<string>();
  for (const j of g.joints) {
    expect(j.bodyA).toBeLessThan(j.bodyB);
    const k = `${j.bodyA},${j.bodyB}`;
    expect(seen.has(k)).toBe(false);
    seen.add(k);
    if (j.type === 'revolute') expect(j).not.toHaveProperty('limits');
    else {
      expect(j.limits![0]).toBeLessThanOrEqual(0);
      expect(j.limits![1]).toBeGreaterThanOrEqual(0);
      expect(j.limits![0] === 0 && j.limits![1] === 0).toBe(false);
      expect(Object.is(j.limits![0], -0)).toBe(false);
    }
    // origin is a mate cell between the two bodies, on the joint axis line
    const between = g.mates.filter((mt) => {
      const a = g.bodyOfPart.get(mt.malePart)!;
      const b = g.bodyOfPart.get(mt.holePart)!;
      return Math.min(a, b) === j.bodyA && Math.max(a, b) === j.bodyB;
    });
    expect(between.some((mt) => mt.pos.join() === j.origin.join() && mt.axis === j.axis)).toBe(true);
    if (j.type !== 'prismatic') for (const mt of between) expect(lineKey(mt.pos, mt.axis)).toBe(lineKey(j.origin, j.axis));
  }
  // every non-weld mate between distinct final bodies is covered by a joint; welds never are
  for (const mt of g.mates) {
    const a = g.bodyOfPart.get(mt.malePart)!;
    const b = g.bodyOfPart.get(mt.holePart)!;
    if (mt.type === 'weld') expect(a).toBe(b);
    else if (a !== b) expect(seen.has(`${Math.min(a, b)},${Math.max(a, b)}`)).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------
// Hand-derived expectations that the implementation gets right (verification, should pass)

describe('verified: hand-derived cases', () => {
  it('stale / null root → lowest id is fixed, and absorption prefers it', () => {
    // 3-long pin through three beams; beam 3 is largest, but lowest id (1) is the effective root.
    const base = mk([beam([0, 0, 0], [1, 0, 0]), beam([0, 0, 1], [2, 0, 1]), beam([0, 0, 2], [5, 0, 2]), pin([0, 0, 0], [0, 0, 2])]);
    for (const root of [null, 999]) {
      const m: Model = { ...base, rootPartId: root };
      const g = A(m);
      expect(parts(g)).toEqual([[1, 4], [2], [3]]);
      expect(g.bodies.map((b) => b.fixed)).toEqual([true, false, false]);
      expectInvariants(m, g);
    }
    // explicit root 2 → pin goes to the middle beam
    const g2 = A(setRoot(base, 2));
    expect(parts(g2)).toEqual([[1], [2, 4], [3]]);
    expect(g2.bodies.map((b) => b.fixed)).toEqual([false, true, false]);
  });

  it('two mates of different type on one line → revolute (axle-pin: axle and pin cells in a coaxial tube)', () => {
    // A: tube of coaxial pin holes z=0,1. B: axle z=-2..0 + pin z=1 as one straight part.
    // B is not absorbed (it has a cylindrical mate); the pair has one line with cyl + rev → revolute.
    const m = mk([holes([0, 0, 0], [0, 0, 1], 2), [...axle([0, 0, -2], [0, 0, 0]), cell([0, 0, 1], 'pin', 2)]]);
    const g = A(m);
    expect(parts(g)).toEqual([[1], [2]]);
    expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'revolute', origin: [0, 0, 0], axis: 2 }]);
  });

  it('cylindrical sign convention: same physical stop, axle body as A vs as B', () => {
    // beam at z=0, axle z=-3..3 with bush at z=2 (one cell gap above the beam).
    // Axle relative to beam: can go down by 1 (bush lands on beam), up by 3 (engagement).
    const beamC = beam([0, 0, 0], [1, 0, 0]);
    const ax = axle([0, 0, -3], [0, 0, 3]);
    const bu = bush([0, 0, 2], 2);
    const g1 = A(mk([beamC, ax, bu])); // beam A, axle B
    expect(g1.joints[0]).toMatchObject({ type: 'cylindrical', limits: [-1, 3] });
    const g2 = A(mk([ax, bu, beamC])); // axle A, beam B: beam relative to axle = opposite
    expect(g2.joints[0]).toMatchObject({ type: 'cylindrical', limits: [-3, 1] });
  });

  it('unengaged coaxial pin hole across a gap: travel stops at the gap (shifts must be legal 1..n)', () => {
    // A: pin holes at z=0 and z=2 on the line (joined by an off-line hook). Axle B: 1 long at z=0.
    const m = mk([
      [cell([0, 0, 0], 'pinHole', 2), ...beam([1, 0, 0], [1, 0, 2], 0), cell([0, 0, 2], 'pinHole', 2)],
      axle([0, 0, 0], [0, 0, 0], 2),
    ]);
    // shift +1: no overlap → illegal, so +2 (re-engaged) is unreachable: limits [0,0] → revolute
    expect(A(m).joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'revolute', origin: [0, 0, 0], axis: 2 }]);
  });

  it('blind neighbour: perpendicular hole of the same part right behind a coaxial hole blocks', () => {
    // control: a lone pin hole lets the axle (z=-2..0) rise by 2 (engagement), not drop
    expect(A(mk([[cell([0, 0, 0], 'pinHole', 2)], axle([0, 0, -2], [0, 0, 0])])).joints[0]).toMatchObject({
      type: 'cylindrical',
      limits: [0, 2],
    });
    // a perpendicular hole behind it (blind bore) stops the rise at 0 → [0,0] → revolute
    const m = mk([[cell([0, 0, 0], 'pinHole', 2), cell([0, 0, 1], 'pinHole', 0)], axle([0, 0, -2], [0, 0, 0])]);
    expect(A(m).joints[0]).toMatchObject({ type: 'revolute' });
  });

  it('prismatic: two parallel axles; limits from full cell sets; [0,0] → weld', () => {
    // A: 2-hole beam along X at z=0 (holes Z). B: two axles z=-1..1 joined by a 2-cell axle-hole bar at z=-1.
    const m = mk([
      beam([0, 0, 0], [1, 0, 0]),
      [...holes([0, 0, -1], [1, 0, -1], 2, 'axleHole')],
      axle([0, 0, -1], [0, 0, 1]),
      axle([1, 0, -1], [1, 0, 1]),
    ]);
    const g = A(m);
    expect(parts(g)).toEqual([[1], [2, 3, 4]]);
    // B relative to A: up 0 (bar hits beam), down 1 (engagement on both lines)
    expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'prismatic', origin: [0, 0, 0], axis: 2, limits: [-1, 0] }]);
  });

  it('prismatic needs both lines engaged: one long, one short axle', () => {
    const m = mk([
      beam([0, 0, 0], [1, 0, 0]),
      [...holes([0, 0, -1], [1, 0, -1], 2, 'axleHole')],
      axle([0, 0, -1], [0, 0, 5]),
      axle([1, 0, -1], [1, 0, 0]),
    ]);
    // the short axle leaves the beam after 0 shifts downward... it is at z=-1..0; moving B down
    // disengages it; moving B up hits the bar → [0,0] → rigid
    expect(parts(A(m))).toEqual([[1, 2, 3, 4]]);
  });

  it('fixpoint: A–B weld from two lines, then the merged AB keeps one revolute to C', () => {
    // B and C each joined to A... construct: A beam z=0, B beam z=1, C beam z=2.
    // pins: A–B at x=0 and x=2 (→ AB rigid); a 3-long pin through A,B,C at x=1? that would make
    // the C pair one line. Instead: pin B–C at x=0 (z=1..2) and pin A..C at x=2 (z=0..2).
    const m = mk([
      beam([0, 0, 0], [2, 0, 0]),
      beam([0, 0, 1], [2, 0, 1]),
      beam([0, 0, 2], [2, 0, 2]),
      pin([0, 0, 0], [0, 0, 1]), // A–B
      pin([2, 0, 0], [2, 0, 2]), // A–B–C (absorbed into A, the root)
    ]);
    const g = A(m);
    // A–B: two lines → weld; then AB–C: one line (x=2) → revolute
    expect(parts(g)).toEqual([[1, 2, 4, 5], [3]]);
    expect(g.joints).toEqual([{ bodyA: 0, bodyB: 1, type: 'revolute', origin: [2, 0, 2], axis: 2 }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Fuzz: invariants + determinism on random valid models

function randomModel(seed: number): Model {
  const r = rng(seed);
  const ri = (n: number) => Math.floor(r() * n);
  const b = new ModelBuilder();
  const tryAdd = (cells: Cell[]) => {
    try {
      b.add(cells);
    } catch {
      /* invalid placement: skip */
    }
  };
  const nBeams = 2 + ri(4);
  for (let i = 0; i < nBeams; i++) {
    const z = ri(4);
    const y = ri(3);
    const x0 = ri(4);
    const len = ri(4);
    if (r() < 0.2) tryAdd(holes([x0, y, z], [x0 + len, y, z], 2, 'axleHole'));
    else tryAdd(beam([x0, y, z], [x0 + len, y, z]));
  }
  const nRods = 1 + ri(6);
  for (let i = 0; i < nRods; i++) {
    const x = ri(8);
    const y = ri(3);
    const z0 = ri(4) - 1;
    const len = ri(4);
    const kind = r();
    if (kind < 0.5) tryAdd(pin([x, y, z0], [x, y, z0 + len], 2));
    else tryAdd(axle([x, y, z0], [x, y, z0 + len], 2));
  }
  if (r() < 0.5 && b.model.parts.length) b.root(b.model.parts[ri(b.model.parts.length)]!.id);
  return b.build();
}

describe('verified: fuzz invariants and shuffle determinism', () => {
  it('300 random models', () => {
    let jointed = 0;
    for (let s = 1; s <= 300; s++) {
      const m = randomModel(s);
      expect(validateModel(m)).toEqual([]);
      const g = analyze(m);
      expectInvariants(m, g);
      jointed += g.joints.length;
      const ref = plain(g);
      const r = rng(s * 31);
      for (let i = 0; i < 4; i++) expect(plain(analyze(shuffleModel(m, r)))).toEqual(ref);
    }
    expect(jointed).toBeGreaterThan(50); // the fuzz actually exercises joints
  });
});

// ---------------------------------------------------------------------------------------------
// Former DEFECTS (fixed in kinematics.ts; see DEVIATIONS §3)

describe('fixed (was DEFECT): a root pin must not be absorbed into a beam', () => {
  // A user who places a pin first gets it as part 1 = default root. The pin is fixed in space;
  // beams on a smooth pin must still rotate about it. Absorbing it welds one beam to the ground.
  it('root pin + one beam: the beam must still rotate (2 bodies, 1 revolute)', () => {
    const m = mk([pin([0, 0, 0], [0, 0, 1]), beam([0, 0, 0], [4, 0, 0])]);
    const g = A(m);
    expect(g.bodies.length).toBe(2); // was: 1 body, 0 joints — the beam was welded to the fixed pin
    expect(g.joints.map((j) => j.type)).toEqual(['revolute']);
  });
  it('root pin + two beams: both rotate independently (planar DOF 2)', () => {
    const m = mk([pin([0, 0, 0], [0, 0, 1]), beam([0, 0, 0], [4, 0, 0]), beam([0, 0, 1], [2, 0, 1])]);
    const g = A(m);
    expect(g.bodies.find((b) => b.fixed)!.partIds).toEqual([1]); // was: [1, 2]
    expect(planarDof(g)).toBe(2); // was: 1
  });
});

describe('fixed (was DEFECT): partition must not depend on which body absorbs a multi-body pin', () => {
  // Beams A(z0), B(z1), C(z2). 3-long pin P through all three at x=0; 2-long pin Q through B, C
  // at x=2. B and C share two pin lines (P and Q) → B∪C is rigid; A rotates about P.
  // Correct: 2 bodies {A,…} {B,C,…}, 1 revolute, planar DOF 1.
  const build = (root: number) =>
    mk(
      [
        beam([0, 0, 0], [2, 0, 0]), // 1 A
        beam([0, 0, 1], [2, 0, 1]), // 2 B
        beam([0, 0, 2], [2, 0, 2]), // 3 C
        pin([0, 0, 0], [0, 0, 2]), // 4 P
        pin([2, 0, 1], [2, 0, 2]), // 5 Q
      ],
      root,
    );
  it('root = B (control): B and C weld, 2 bodies — passes', () => {
    const g = A(build(2));
    expect(sameBody(g, 2, 3)).toBe(true);
    expect(g.bodies.length).toBe(2);
  });
  it('root = A: identical mechanism must give the same partition', () => {
    const g = A(build(1));
    // was: P absorbed into A, so B–C only see Q → 3 bodies, 3 revolutes (A–B, A–C, B–C)
    expect(sameBody(g, 2, 3)).toBe(true);
    expect(g.bodies.length).toBe(2);
  });
  it('root = A: the graph must not under-count mobility (Grübler 0 for a 1-DOF mechanism)', () => {
    expect(planarDof(A(build(1)))).toBe(1); // was: 0 (redundant B–C revolute loop)
  });
});

describe('fixed (was DEFECT): slide limits respect a third body\'s pin filling a hole on the line', () => {
  // R (root beam z=0) — pin P (z=0..1) — X: tube of coaxial pin holes z=1..2 — Y: axle z=2..3.
  // P fills X's lower hole, so Y's axle cannot slide down; up by 1 disengages → [0,0] → revolute.
  const cellsR = beam([0, 0, 0], [2, 0, 0]);
  const cellsP = pin([0, 0, 0], [0, 0, 1]);
  const cellsX = holes([0, 0, 1], [0, 0, 2], 2);
  const cellsY = axle([0, 0, 2], [0, 0, 3]);
  it('root = X (control): P is absorbed into X, Y is blocked → revolute — passes', () => {
    const g = A(mk([cellsR, cellsP, cellsX, cellsY], 3));
    expect(jointBetween(g, 3, 4)).toMatchObject({ type: 'revolute' });
  });
  it('root = R: same geometry must give the same X–Y joint', () => {
    const g = A(mk([cellsR, cellsP, cellsX, cellsY], 1));
    // was: P absorbed into R, so X's hole at z=1 looks empty → cylindrical [-2, 0]: Y may
    // slide down through the space occupied by P (and on into R's hole)
    expect(jointBetween(g, 3, 4)).toMatchObject({ type: 'revolute' });
  });
});

// ---------------------------------------------------------------------------------------------
// Examples (§8)

describe('examples: mechanism checks', () => {
  it('every example satisfies the graph invariants and the intended planar DOF', () => {
    const dof: Record<string, number> = { pendulum: 1, 'triple-pendulum': 3, 'four-bar': 1, parallelogram: 1, 'weld-test': 1 };
    for (const e of EXAMPLES) {
      const m = e.build();
      const g = A(m);
      expectInvariants(m, g);
      if (e.name in dof) {
        expect(g.joints.every((j) => j.type === 'revolute' && j.axis === 2)).toBe(true);
        expect(planarDof(g)).toBe(dof[e.name]);
      }
    }
  });

  it('every pin passes through a hole of each of the two (or more) parts it is meant to join', () => {
    for (const e of EXAMPLES) {
      const m = e.build();
      const g = analyze(m);
      for (const p of m.parts) {
        if (!p.cells.every((c) => c.kind === 'pin')) continue;
        const holeParts = new Set(g.mates.filter((mt) => mt.malePart === p.id).map((mt) => mt.holePart));
        expect(holeParts.size).toBe(p.cells.length); // every pin cell is engaged in a distinct part
      }
    }
  });

  it('four-bar: crank and rocker (same layer, not jointed) never touch over the whole motion', () => {
    // pivots O=(0,0), D=(6,0); crank cells (0,0..2); rocker chain (4,2)-(4,0)-(6,0); coupler 4.
    const segDist = (p: number[], q: number[], r: number[], s: number[]) => {
      // min distance between segments pq and rs (2D), by sampling (fine enough for a margin check)
      let best = Infinity;
      for (let i = 0; i <= 40; i++)
        for (let k = 0; k <= 40; k++) {
          const a = [p[0]! + ((q[0]! - p[0]!) * i) / 40, p[1]! + ((q[1]! - p[1]!) * i) / 40];
          const b = [r[0]! + ((s[0]! - r[0]!) * k) / 40, r[1]! + ((s[1]! - r[1]!) * k) / 40];
          best = Math.min(best, Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!));
        }
      return best;
    };
    let minGap = Infinity;
    let feasible = 0;
    for (let t = 0; t < 360; t += 2) {
      const th = (t * Math.PI) / 180;
      const B = [2 * Math.cos(th), 2 * Math.sin(th)];
      const D = [6, 0];
      const rr = Math.SQRT2 * 2;
      const d = Math.hypot(D[0]! - B[0]!, D[1]! - B[1]!);
      const a = (16 - rr * rr + d * d) / (2 * d);
      const h2 = 16 - a * a;
      if (h2 < 0) continue;
      feasible++;
      for (const sgn of [1, -1]) {
        const ex = [(D[0]! - B[0]!) / d, (D[1]! - B[1]!) / d];
        const E = [B[0]! + a * ex[0]! - sgn * Math.sqrt(h2) * ex[1]!, B[1]! + a * ex[1]! + sgn * Math.sqrt(h2) * ex[0]!];
        // rocker rotation taking (4,2) to E about D
        const ang = Math.atan2(E[1]! - D[1]!, E[0]! - D[0]!) - Math.atan2(2, -2);
        const rot = (v: number[]) => {
          const x = v[0]! - 6;
          const y = v[1]!;
          return [6 + Math.cos(ang) * x - Math.sin(ang) * y, Math.sin(ang) * x + Math.cos(ang) * y];
        };
        const rk = [[4, 2], [4, 0], [6, 0]].map(rot);
        for (let i = 0; i < 2; i++) minGap = Math.min(minGap, segDist([0, 0], B, rk[i]!, rk[i + 1]!) - 2 * 0.46);
      }
    }
    expect(feasible).toBeGreaterThan(10);
    expect(minGap).toBeGreaterThan(0.1);
  });

  it('parallelogram: ground and coupler (same layer, not jointed) never overlap on the energy-reachable swing', () => {
    // Revised layout: horizontal ground (0..3, 0), crank vector (2,−2) released 45° from vertical.
    // On the parallel branch the coupler is the ground translated by the crank vector; |φ| <= 45°.
    let minD = Infinity;
    for (let t = -45; t <= 45; t += 1) {
      const ph = (t * Math.PI) / 180;
      const dx = 2 * Math.SQRT2 * Math.sin(ph);
      const dy = -2 * Math.SQRT2 * Math.cos(ph);
      for (let i = 0; i <= 3; i++) for (let k = 0; k <= 3; k++) minD = Math.min(minD, Math.hypot(dx + k - i, dy));
    }
    expect(minD - 2 * 0.46).toBeGreaterThan(1);
  });

  it('parallelogram: the change point (crank parallel to the ground) is out of energetic reach', () => {
    const g = analyze(buildExample('parallelogram'));
    const o = g.joints.map((j) => j.origin);
    expect(o.map((p) => p[1]).sort()).toEqual([-2, -2, 0, 0]); // ground pivots at y=0, coupler pivots at y=−2
    expect(o.map((p) => p[0]).sort()).toEqual([0, 2, 3, 5]); // crank vector (2,−2): 45° from vertical
  });
});

// Unused-import guard for helpers referenced only in comments.
void beamPath;
