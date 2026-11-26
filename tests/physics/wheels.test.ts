// Wheels and ground (DESIGN §2.6, §5.1 "Ground" / "Wheels", §5.3 "Wheels, ground and free root"):
// colliders and groups, mass, a loose wheel resting / rolling / on an incline, drops onto the
// ground, a fixed root above the ground, wheels against parts, the crank wheel. The cart (free
// root) is in cart.test.ts.
import { describe, expect, it } from 'vitest';
import type { Collider, World } from '@dimforge/rapier3d-compat';
import { ModelBuilder, axle, beam, beamPath, buildExample, pin } from '../../src/core/examples';
import { groundLevel, makeCell, setFixRoot, setGround, setRim, validateModel } from '../../src/core/model';
import type { Axis, Cell, Model, Part } from '../../src/core/types';
import { HC } from '../../src/geometry/dims';
import { G, GRAB_PRESS_LIMIT, Simulation } from '../../src/physics/sim';
import { applyTransform } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { BEVEL, WHEEL_BEVEL, WHEEL_SEGMENTS, WHEEL_SLABS, partShapes } from '../../src/physics/shapes';
import { RAPIER } from '../../src/physics/rapier';
import { angleZ, report, total, unwrap, where } from './helpers';
import { looseWheel, rollRadius } from './wheelModels';

/** The Simulation's Rapier world (white-box checks of colliders and groups). */
function worldOf(s: Simulation): World {
  return (s as unknown as { world: World }).world;
}

function colliders(s: Simulation): Collider[] {
  const out: Collider[] = [];
  worldOf(s).forEachCollider((c) => void out.push(c));
  return out;
}

/** Edit-time collider points of a part (hull vertices, box corners, wheel hull vertices). */
function shapePoints(part: Part): Vec3[] {
  const out: Vec3[] = [];
  for (const sh of partShapes(part, 16)) {
    if (sh.kind === 'hull') out.push(...sh.points);
    else if (sh.kind === 'wheel') for (const piece of sh.hull) out.push(...piece);
    else
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1])
            out.push([sh.center[0] + sx * sh.halfExtents[0], sh.center[1] + sy * sh.halfExtents[1], sh.center[2] + sz * sh.halfExtents[2]]);
  }
  return out;
}

/** Least-squares slope. */
function slope(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  return sxy / sxx;
}

// DESIGN §5.1 "Wheels" (ground 1, round 2, hull 4, part 8) plus the ground guard 16 (DEVIATIONS §5).
const GROUPS = {
  ground: (0x1 << 16) | (0x2 | 0x8 | 0x10),
  round: (0x2 << 16) | (0x1 | 0x2),
  hull: (0x4 << 16) | 0x8,
  part: (0x8 << 16) | (0x1 | 0x4 | 0x8),
  guard: (0x10 << 16) | 0x1,
};

describe('ground and wheel colliders', () => {
  it('no rim and no ground: no ground body, groundY null, every collider keeps the default groups', async () => {
    const s = await Simulation.create(buildExample('four-bar'));
    expect(s.groundY).toBeNull();
    const cs = colliders(s);
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) expect(c.collisionGroups()).toBe(0xffffffff);
    expect(cs.some((c) => c.shape.type === RAPIER.ShapeType.HalfSpace)).toBe(false);
    s.dispose();
  });

  it('ground: one fixed half-space at groundLevel + ½ − HC; parts in the part group; hulls and rounds as §5.1', async () => {
    const b = new ModelBuilder();
    const frame = b.add(beam([0, 0, 0], [4, 0, 0]));
    b.add([makeCell(0, 3, 1, 'pinHole', 2, 2)]); // loose wheel above
    const m = setGround(b.root(frame).build(), true);
    expect(validateModel(m)).toEqual([]);
    expect(groundLevel(m)).toBe(-0.5);
    const s = await Simulation.create(m);
    expect(s.groundY).toBeCloseTo(-0.5 + (0.5 - HC), 12);
    const cs = colliders(s);
    const half = cs.filter((c) => c.shape.type === RAPIER.ShapeType.HalfSpace);
    expect(half.length).toBe(1);
    expect(half[0]!.parent()!.isFixed()).toBe(true);
    expect(half[0]!.translation().y).toBeCloseTo(s.groundY!, 6);
    expect(half[0]!.collisionGroups()).toBe(GROUPS.ground);
    expect(half[0]!.friction()).toBeCloseTo(0.4, 6);
    const cyl = cs.filter((c) => c.shape.type === RAPIER.ShapeType.Cylinder);
    expect(cyl.length).toBe(1);
    expect(cyl[0]!.collisionGroups()).toBe(GROUPS.round);
    expect(cyl[0]!.friction()).toBeCloseTo(0.8, 6);
    // round collider: radius r − 0.04, half-length HC, axis along world Z
    const shape = cyl[0]!.shape as InstanceType<typeof RAPIER.Cylinder>;
    expect(shape.radius).toBeCloseTo(2 - 0.04, 6);
    expect(shape.halfHeight).toBeCloseTo(HC, 6);
    const q = cyl[0]!.rotation();
    const yAxis = applyTransform({ p: [0, 0, 0], q: [q.x, q.y, q.z, q.w] }, [0, 1, 0]);
    expect(Math.abs(yAxis[2])).toBeCloseTo(1, 6);
    // every other collider: the wheel's hull pieces (density 0) or an ordinary part collider
    const rest = cs.filter((c) => c.shape.type !== RAPIER.ShapeType.HalfSpace && c.shape.type !== RAPIER.ShapeType.Cylinder);
    const hulls = rest.filter((c) => c.collisionGroups() === GROUPS.hull);
    expect(hulls.length).toBe(WHEEL_SEGMENTS * WHEEL_SLABS);
    for (const h of hulls) expect(h.density()).toBe(0);
    for (const h of hulls) expect(h.friction()).toBeCloseTo(0.4, 6);
    // the ground guard (DEVIATIONS §5): inside the round collider, density 0, frictionless, ground only
    const guards = rest.filter((c) => c.collisionGroups() === GROUPS.guard);
    expect(guards.length).toBe(1);
    expect(guards[0]!.density()).toBe(0);
    expect(guards[0]!.friction()).toBe(0);
    expect(rest.filter((c) => c.collisionGroups() === GROUPS.part).length).toBe(rest.length - hulls.length - 1);
    s.dispose();
  });

  it('without a ground a wheel has no guard; the round collider still meets only the ground group and other wheels', async () => {
    const s = await Simulation.create(buildExample('crank-wheel'));
    const groups = colliders(s).map((c) => c.collisionGroups());
    expect(groups.filter((g) => g === GROUPS.guard).length).toBe(0);
    expect(groups.filter((g) => g === GROUPS.round).length).toBe(1);
    expect(groups.filter((g) => g === GROUPS.hull).length).toBe(WHEEL_SEGMENTS * WHEEL_SLABS);
    expect(groups.every((g) => Object.values(GROUPS).includes(g))).toBe(true);
    s.dispose();
  });

  it('the wheel hull is the circumscribed 32-gon prism over the round collider, cut into 32 wedges × 2 slabs (every face ≤ 4 vertices)', () => {
    // DESIGN §5.1 "Wheels", requirement added in review; DEVIATIONS §5. (The first hull was one
    // 32-gon prism with an end-face bevel of 0.02·r; a beam's edge across its face gave one contact.)
    expect(WHEEL_SEGMENTS).toBe(32);
    expect(WHEEL_SLABS).toBe(2);
    expect(WHEEL_BEVEL).toBe(0.02); // the ground guard's bevel
    for (const r of [1, 2.5, 4]) {
      const part: Part = { id: 1, color: '#000000', cells: [makeCell(0, 0, 0, 'pinHole', 2, r)] };
      const w = partShapes(part, 16).find((sh) => sh.kind === 'wheel');
      if (w?.kind !== 'wheel') throw new Error('no wheel shape');
      expect(w.radius).toBeCloseTo(r - 0.04, 12);
      expect(w.hull.length).toBe(64);
      const all = w.hull.flat();
      // inradius of the polygon = the cylinder's radius (circumscribed, faces tangent); four sides axis-aligned
      const R = Math.max(...all.map((p) => Math.hypot(p[0], p[1])));
      expect(R * Math.cos(Math.PI / 32)).toBeCloseTo(r - 0.04, 9);
      expect(Math.min(...all.map((p) => p[1]))).toBeCloseTo(-(r - 0.04), 12);
      expect(Math.max(...all.map((p) => p[0]))).toBeCloseTo(r - 0.04, 12);
      for (const piece of w.hull) {
        // a triangle prism: the axis and two adjacent rim vertices, at the two faces of one slab
        expect(piece.length).toBe(6);
        const zs = [...new Set(piece.map((p) => p[2].toFixed(12)))].map(Number).sort((a, b) => a - b);
        expect(zs.length).toBe(2);
        expect(zs[1]! - zs[0]!).toBeCloseTo(HC, 12);
        expect(piece.filter((p) => Math.hypot(p[0], p[1]) < 1e-12).length).toBe(2);
      }
      // the slabs tile ±HC
      const zAll = [...new Set(all.map((p) => p[2].toFixed(12)))].map(Number).sort((a, b) => a - b);
      expect(zAll).toEqual([-HC, 0, HC].map((z) => +z.toFixed(12)));
    }
    expect(BEVEL).toBe(0.01); // ordinary prisms unchanged
  });

  it('mass: the round collider carries the annulus between the hub barrel and the rim (density 1)', async () => {
    for (const r of [1, 2.5, 4]) {
      const bare = new ModelBuilder();
      bare.add([makeCell(0, 0, 0, 'pinHole', 2)]);
      const s0 = await Simulation.create(bare.build());
      const s1 = await Simulation.create(looseWheel(r));
      const R = r - 0.04;
      const L = 2 * HC;
      const ann = Math.PI * (R * R - HC * HC) * L;
      const m0 = s0.massInfo(0)!;
      const m1 = s1.massInfo(0)!;
      expect(m1.mass - m0.mass).toBeCloseTo(ann, 4);
      // about the wheel axis: ½·m·(R² + HC²); transverse: m·(3(R² + HC²) + L²)/12 (f32 engine values)
      expect((m1.inertia[8]! - m0.inertia[8]!) / ((ann * (R * R + HC * HC)) / 2)).toBeCloseTo(1, 4);
      expect((m1.inertia[0]! - m0.inertia[0]!) / ((ann * (3 * (R * R + HC * HC) + L * L)) / 12)).toBeCloseTo(1, 4);
      s0.dispose();
      s1.dispose();
    }
  });

  it('groundSlopeDeg tilts the floor about Z (falls toward +X) and keeps the model on it; validated', async () => {
    const s = await Simulation.create(looseWheel(2), { groundSlopeDeg: 10 });
    const half = colliders(s).find((c) => c.shape.type === RAPIER.ShapeType.HalfSpace)!;
    const n = (half.shape as InstanceType<typeof RAPIER.HalfSpace>).normal;
    expect(n.x).toBeCloseTo(Math.sin((10 * Math.PI) / 180), 6);
    expect(n.y).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 6);
    // the wheel (hub at the origin) starts touching the tilted floor, not inside it
    const h = -s.groundY! * Math.cos((10 * Math.PI) / 180);
    expect(h).toBeCloseTo(2 - 0.04, 6);
    s.dispose();
    for (const bad of [90, -90, NaN, Infinity]) await expect(Simulation.create(looseWheel(2), { groundSlopeDeg: bad })).rejects.toThrow();
  });
});

describe('a loose wheel on the ground', () => {
  it('rests: axis horizontal (r = 1, 1.5, 2.5, 4) moves < 0.01 in 5 s, sinks < 0.03, does not tip; lying flat it stays put', async () => {
    for (const r of [1, 1.5, 2.5, 4])
      for (const axis of [2, 0, 1] as Axis[]) {
        const s = await Simulation.create(looseWheel(r, axis));
        const c0 = s.massInfo(0)!.com;
        s.stepFixed(480 * 5);
        const c = s.massInfo(0)!.com;
        const t = s.bodyTransform(0)!;
        const tilt = 2 * Math.acos(Math.min(1, Math.abs(t.q[3])));
        const move = Math.hypot(c[0] - c0[0], c[2] - c0[2]);
        const sink = c0[1] - c[1];
        report(`wheel at rest r ${r} axis ${'XYZ'[axis]}: moved ${move.toExponential(1)}, sank ${sink.toExponential(1)}, turned ${tilt.toExponential(1)} rad in 5 s`);
        expect(s.hasBody(0)).toBe(true);
        expect(move).toBeLessThan(0.01);
        expect(sink).toBeLessThan(0.03);
        expect(sink).toBeGreaterThan(-0.01);
        expect(tilt).toBeLessThan(1e-3);
        s.dispose();
      }
  }, 120000);

  it('rolls: started at 40 units/s it keeps its speed within 1 % over 160 units (r = 1, 1.5, 2.5, 4)', async () => {
    for (const r of [1, 1.5, 2.5, 4]) {
      const s = await Simulation.create(looseWheel(r));
      const R = rollRadius(r);
      s.setBodyVelocity(0, [40, 0, 0], [0, 0, -40 / R]);
      const x0 = s.massInfo(0)!.com[0];
      let lo = Infinity;
      let hi = -Infinity;
      let n = 0;
      while (s.massInfo(0)!.com[0] - x0 < 160 && n < 480 * 6) {
        s.stepFixed(1);
        n++;
        const v = s.bodyVelocity(0)!.v[0];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      const drift = Math.abs(s.massInfo(0)!.com[2]);
      report(`wheel rolling r ${r}: 160 units in ${(n / 480).toFixed(2)} s, speed ${lo.toFixed(3)}…${hi.toFixed(3)} (from 40), sideways ${drift.toFixed(3)}, guard removed ${s.guardRemoved.toFixed(1)}`);
      expect(s.massInfo(0)!.com[0] - x0).toBeGreaterThanOrEqual(160);
      expect(Math.abs(lo - 40) / 40).toBeLessThan(0.01);
      expect(Math.abs(hi - 40) / 40).toBeLessThan(0.01);
      s.dispose();
    }
  }, 120000);

  it('rolls down a 5° and a 15° floor from rest at g·sinθ/(1 + I/(m r²)) within 2 % (r = 1.5, 2.5, 4)', async () => {
    for (const r of [1.5, 2.5, 4])
      for (const deg of [5, 15]) {
        const s = await Simulation.create(looseWheel(r), { groundSlopeDeg: deg });
        const mi = s.massInfo(0)!;
        const R = rollRadius(r);
        const th = (deg * Math.PI) / 180;
        const a0 = (G * Math.sin(th)) / (1 + mi.inertia[8]! / (mi.mass * R * R));
        s.stepFixed(24);
        const ts: number[] = [];
        const vs: number[] = [];
        for (let i = 0; i < 240; i++) {
          s.stepFixed(1);
          const v = s.bodyVelocity(0)!.v;
          ts.push(s.time);
          vs.push(v[0] * Math.cos(th) - v[1] * Math.sin(th));
        }
        const a = slope(ts, vs);
        report(`wheel on ${deg}° r ${r}: a ${a.toFixed(2)} vs ${a0.toFixed(2)} (${(((a - a0) / a0) * 100).toFixed(2)} %)`);
        expect(Math.abs(a - a0) / a0).toBeLessThan(0.02);
        s.dispose();
      }
  }, 120000);
});

describe('drops onto the ground', () => {
  // A fixed one-cell root at y = 0 far away sets the floor (groundLevel −0.5); the dropped part's
  // lowest cell is 10 units above it. Orientations: lying flat, on edge, on end, spinning.
  const H = 10;
  const cases: [string, Cell[], Vec3][] = [
    ['5-hole liftarm flat', beam([0, H, 0], [4, H, 0], 1), [0, 0, 0]],
    ['5-hole liftarm on edge', beam([0, H, 0], [4, H, 0], 2), [0, 0, 0]],
    ['5-hole liftarm on end', beam([0, H, 0], [0, H + 4, 0], 2), [0, 0, 0]],
    ['5-hole liftarm tumbling', beam([0, H, 0], [4, H, 0], 1), [7, 1, -4]],
    ['15-hole liftarm flat', beam([0, H, 0], [14, H, 0], 1), [0, 0, 0]],
    ['15-hole liftarm tumbling', beam([0, H, 0], [14, H, 0], 2), [2, 3, 1]],
    ['2-cell pin lying', pin([0, H, 0], [1, H, 0]), [0, 0, 0]],
    ['2-cell pin upright', pin([0, H, 0], [0, H + 1, 0]), [0, 0, 0]],
    ['2-cell pin tumbling', pin([0, H, 0], [1, H, 0]), [10, 5, 3]],
    ['4-cell axle lying', axle([0, H, 0], [3, H, 0]), [0, 0, 0]],
    ['4-cell axle upright', axle([0, H, 0], [0, H + 3, 0]), [0, 0, 0]],
    ['L-shaped liftarm tumbling', beamPath([[0, H, 0], [3, H, 0], [3, H + 3, 0]]), [1, 1, 1]],
    ['wheel r 1.5 on edge', [makeCell(0, H + 1, 0, 'pinHole', 2, 1.5)], [0, 0, 0]],
    ['wheel r 2.5 flat', [makeCell(0, H, 0, 'pinHole', 1, 2.5)], [0, 0, 0]],
    ['wheel r 4 on edge, tilted spin', [makeCell(0, H + 3, 0, 'pinHole', 0, 4)], [3, 0, 2]],
    ['wheel r 1 tumbling', [makeCell(0, H, 0, 'pinHole', 2, 1)], [4, 6, 0]],
    ['wheel r 4 tumbling onto its face (wobbles flat)', [makeCell(0, H + 4, 0, 'pinHole', 0, 4)], [3, 0, 2]],
  ];
  it.each(cases)('%s: lands, rests on the floor, never below it, not removed', async (_name, cells, w) => {
    const b = new ModelBuilder();
    const root = b.add([makeCell(-30, 0, -30, 'pinHole', 2)]);
    const id = b.add(cells);
    const m = setGround(b.root(root).build(), true);
    expect(validateModel(m)).toEqual([]);
    const s = await Simulation.create(m);
    const bid = s.bodyOf(id)!;
    if (w.some((x) => x !== 0)) s.setBodyVelocity(bid, [0, 0, 0], w);
    const P = shapePoints(m.parts.find((p) => p.id === id)!);
    const gy = s.groundY!;
    let maxPen = 0;
    let low = 0;
    let c1: Vec3 = [0, 0, 0];
    for (let i = 1; i <= 480 * 5; i++) {
      s.stepFixed(1);
      const t = s.bodyTransform(bid)!;
      low = Infinity;
      for (const q of P) low = Math.min(low, applyTransform(t, q)[1]);
      maxPen = Math.max(maxPen, gy - low);
      if (i === 480 * 4) c1 = s.massInfo(bid)!.com;
    }
    const c = s.massInfo(bid)!.com;
    const drift = Math.hypot(c[0] - c1[0], c[1] - c1[1], c[2] - c1[2]);
    report(`drop ${_name} from ${H}: deepest ${maxPen.toFixed(3)} below the floor, rests ${(gy - low).toFixed(4)} into it, moved ${drift.toExponential(1)} in the last second`);
    expect(s.hasBody(bid)).toBe(true);
    expect(maxPen).toBeLessThan(0.2); // impact at 157 units/s; the resting sink is ≈ 0.01
    expect(gy - low).toBeLessThan(0.03);
    expect(drift).toBeLessThan(0.01);
    s.dispose();
  }, 60000);
});

describe('fixed root with the ground', () => {
  /** Frame standing on the floor (foot at y = −6), a 5-hole link on a pin at (0, 0) in layer 1. */
  function hung(ground: boolean): Model {
    const b = new ModelBuilder();
    const frame = b.add(beamPath([[0, 0, 0], [-2, 0, 0], [-2, -6, 0]]));
    b.add(beam([0, 0, 1], [4, 0, 1]));
    b.add(pin([0, 0, 0], [0, 0, 1]));
    const m = b.root(frame).build();
    return ground ? setGround(m, true) : m;
  }

  it('a pendulum hung above the floor swings exactly as without the floor', async () => {
    const a = await Simulation.create(hung(false), { jointFriction: 0 });
    const g = await Simulation.create(hung(true), { jointFriction: 0 });
    expect(g.groundY).toBeCloseTo(-6.5 + 0.04, 12);
    let diff = 0;
    let lo = Infinity;
    for (let i = 0; i < 480 * 3; i++) {
      a.stepFixed(1);
      g.stepFixed(1);
      const ta = a.partTransform(2)!;
      const tg = g.partTransform(2)!;
      for (let k = 0; k < 3; k++) diff = Math.max(diff, Math.abs(ta.p[k]! - tg.p[k]!));
      for (let k = 0; k < 4; k++) diff = Math.max(diff, Math.abs(ta.q[k]! - tg.q[k]!));
      lo = Math.min(lo, applyTransform(tg, [4, 0, 1])[1]);
    }
    report(`pendulum above the floor: largest pose difference to the run without floor ${diff.toExponential(1)} over 3 s; tip lowest at y ${lo.toFixed(2)} (floor ${g.groundY!.toFixed(2)})`);
    expect(lo).toBeGreaterThan(g.groundY! + 1);
    expect(diff).toBe(0);
    a.dispose();
    g.dispose();
  }, 60000);

  it('a loose link released above the floor lands and rests on it; the fixed root stays put', async () => {
    const b = new ModelBuilder();
    const frame = b.add(beam([0, 0, 0], [4, 0, 0]));
    const link = b.add(beam([0, 6, 3], [4, 6, 3]));
    const m = setGround(b.root(frame).build(), true);
    const s = await Simulation.create(m);
    s.stepFixed(480 * 4);
    const y = s.massInfo(s.bodyOf(link)!)!.com[1];
    report(`loose link above the floor: rests with its centre at y ${y.toFixed(4)} (floor ${s.groundY!.toFixed(2)})`);
    expect(y).toBeGreaterThan(s.groundY! + HC - 0.03);
    expect(y).toBeLessThan(s.groundY! + HC + 0.01);
    expect(s.bodyTransform(s.bodyOf(frame)!)).toEqual({ p: [0, 0, 0], q: [0, 0, 0, 1] });
    s.dispose();
  });
});

describe('wheels against parts (the weak spot; DEVIATIONS §5 "Wheels, ground, free root")', () => {
  // Measured on many more cases than kept here (the full table is in DEVIATIONS): 126 liftarm
  // drops onto a fixed wheel and 144 wheel drops onto a fixed beam, none passed through.

  const armCases: [string, number, number, (top: number) => Cell[], Vec3][] = [
    ['on edge, centred', 2.5, 2, (y) => beam([-2, y, 0], [2, y, 0], 2), [0, 0, 0]],
    ['on edge, off-centre 1', 2.5, 5, (y) => beam([-1, y, 0], [3, y, 0], 2), [0, 0, 0]],
    ['on edge, off-centre 2', 4, 10, (y) => beam([0, y, 0], [4, y, 0], 2), [0, 0, 0]],
    ['flat, centred', 1.5, 10, (y) => beam([-2, y, 0], [2, y, 0], 1), [0, 0, 0]],
    ['flat, off-centre', 2.5, 10, (y) => beam([0, y, 0], [4, y, 0], 1), [0, 0, 0]],
    ['across, centred', 1.5, 10, (y) => beam([0, y, -2], [0, y, 2], 0), [0, 0, 0]],
    ['across, off-centre 1', 4, 5, (y) => beam([1, y, -2], [1, y, 2], 0), [0, 0, 0]],
    ['across, off-centre 2', 2.5, 2, (y) => beam([2, y, -2], [2, y, 2], 0), [0, 0, 0]],
    ['across, flat', 4, 10, (y) => beam([0, y, -2], [0, y, 2], 1), [0, 0, 0]],
    ['on end', 1.5, 5, (y) => beam([0, y, 0], [0, y + 4, 0], 2), [0, 0, 0]],
    ['on end, off-centre', 2.5, 10, (y) => beam([1, y, 0], [1, y + 4, 0], 0), [0, 0, 0]],
    ['on edge, spinning', 4, 5, (y) => beam([-2, y, 0], [2, y, 0], 2), [2, 1, 6]],
    ['across, spinning', 4, 10, (y) => beam([0, y, -2], [0, y, 2], 0), [5, 2, 1]],
    ['flat, spinning', 2.5, 10, (y) => beam([-2, y, 0], [2, y, 0], 1), [1, 7, 2]],
  ];
  it.each(armCases)('a liftarm dropped onto a fixed wheel (%s, r %d, %d units) never passes through it', async (_n, r, h, cells, w) => {
    const b = new ModelBuilder();
    const wheel = b.add([makeCell(0, 0, 0, 'pinHole', 2, r)]);
    const arm = b.add(cells(Math.ceil(r + h + 0.5)));
    const m = b.root(wheel).build();
    expect(validateModel(m)).toEqual([]);
    const s = await Simulation.create(m);
    const ab = s.bodyOf(arm)!;
    if (w.some((x) => x !== 0)) s.setBodyVelocity(ab, [0, 0, 0], w);
    const cellsOf = m.parts.find((p) => p.id === arm)!.cells.map((c): Vec3 => [c.x, c.y, c.z]);
    const R = r - 0.04;
    // Overlap of the arm's cells (barrels of radius HC about their centres) with the disc, from
    // the cell centres in the wheel's layer: R + HC − distance (≤ 0 apart, ≈ 0 resting on the
    // rim); a centre inside R − 0.2 means the arm is passing through the wheel.
    let depth = -Infinity;
    let inside = false;
    let touched = false;
    let v = s.bodyVelocity(ab)!.v;
    for (let i = 0; i < 480 * 3 && s.hasBody(ab); i++) {
      s.stepFixed(1);
      const t = s.bodyTransform(ab);
      if (!t) break;
      for (const c of cellsOf) {
        const p = applyTransform(t, c);
        if (Math.abs(p[2]) > 0.5) continue;
        const d = Math.hypot(p[0], p[1]);
        depth = Math.max(depth, R + HC - d);
        if (d < R - 0.2) inside = true;
      }
      const c = s.massInfo(ab)!.com;
      if (Math.hypot(c[0], c[1]) < R - 0.3 && Math.abs(c[2]) < 0.5) inside = true;
      // touched: the arm's velocity changed by more than gravity alone does in a step
      const v1 = s.bodyVelocity(ab)!.v;
      if (Math.hypot(v1[0] - v[0], v1[1] - v[1] + G * s.fixedDt, v1[2] - v[2]) > 0.5) touched = true;
      v = v1;
    }
    report(`liftarm onto wheel r ${r} from ${h} (${_n}): cells overlap the rim by ≤ ${depth.toFixed(3)}, ${s.hasBody(ab) ? 'still on the wheel' : 'deflected and fell away'}`);
    expect(touched).toBe(true);
    expect(inside).toBe(false);
    expect(depth).toBeLessThan(0.15);
    s.dispose();
  }, 60000);

  const wheelCases: [string, number, number, Axis, number, Vec3][] = [
    ['on edge across the beam, at hole 0', 1.5, 2, 2, 0, [0, 0, 0]],
    ['on edge, at hole 3', 2.5, 5, 2, 3, [0, 0, 0]],
    ['on edge, at hole 7', 4, 10, 2, 7, [0, 0, 0]],
    ['on edge, at hole 13', 1, 10, 2, 13, [0, 0, 0]],
    ['on edge, end hole 14', 2.5, 10, 2, 14, [0, 0, 0]],
    ['on edge along the beam, at hole 3', 1.5, 10, 0, 3, [0, 0, 0]],
    ['on edge along the beam, at hole 7', 4, 5, 0, 7, [0, 0, 0]],
    ['flat', 2.5, 10, 1, 7, [0, 0, 0]],
    ['flat', 1, 5, 1, 7, [0, 0, 0]],
    ['on edge, spinning', 2.5, 10, 2, 7, [0, 0, -20]],
    ['tumbling', 4, 5, 2, 7, [3, 2, 0]],
    ['flat, tumbling', 1.5, 10, 1, 7, [3, 0, 2]],
  ];
  it.each(wheelCases)('a loose wheel dropped onto a fixed 15-hole beam lying flat (%s, r %d, %d units) never passes through it', async (_n, r, h, axis, x, w) => {
    const b = new ModelBuilder();
    const bm = b.add(beam([0, 0, 0], [14, 0, 0], 1));
    const hy = axis === 1 ? Math.ceil(1 + h) : Math.ceil(0.5 + h + r);
    const wid = b.add([makeCell(x, hy, 0, 'pinHole', axis, r)]);
    const m = b.root(bm).build();
    expect(validateModel(m)).toEqual([]);
    const s = await Simulation.create(m);
    const wb = s.bodyOf(wid)!;
    if (w.some((v) => v !== 0)) s.setBodyVelocity(wb, [0, 0, 0], w);
    let through = false;
    let lowest = Infinity;
    for (let i = 0; i < 480 * 3; i++) {
      s.stepFixed(1);
      if (!s.hasBody(wb)) break;
      const c = s.massInfo(wb)!.com;
      // the wheel's centre below the beam's top face while over the beam = passed into / through it
      if (c[0] > -0.4 && c[0] < 14.4 && Math.abs(c[2]) < 0.4 && c[1] < HC && c[1] > -5) through = true;
      if (Math.abs(c[2]) < 0.4 && c[0] > -0.4 && c[0] < 14.4) lowest = Math.min(lowest, c[1]);
    }
    const rest = s.hasBody(wb) ? s.massInfo(wb)!.com[1] : NaN;
    report(`wheel r ${r} onto beam from ${h} (${_n}): lowest centre over the beam ${lowest.toFixed(3)}, ${s.hasBody(wb) ? `ends at y ${rest.toFixed(3)}` : 'rolled or fell off'}`);
    expect(through).toBe(false);
    s.dispose();
  }, 60000);

  it('a pendulum link striking the rim of a pinned wheel bounces off and sets the wheel turning', async () => {
    // Frame (layer 0) holds the wheel's pin at (0, 0) and the link's pivot at (−5, 3); r = 2 wheel
    // and the 5-hole link both in layer 1; the link starts horizontal and swings into the rim.
    const b = new ModelBuilder();
    const frame = b.add(beamPath([[-5, 3, 0], [-5, 0, 0], [0, 0, 0]]));
    const wheel = b.add([makeCell(0, 0, 1, 'pinHole', 2, 2)]);
    const link = b.add(beam([-5, 3, 1], [-1, 3, 1]));
    b.add(pin([0, 0, 0], [0, 0, 1]));
    b.add(pin([-5, 3, 0], [-5, 3, 1]));
    const m = b.root(frame).build();
    expect(validateModel(m)).toEqual([]);
    const s = await Simulation.create(m, { jointFriction: 0 });
    const wb = s.bodyOf(wheel)!;
    const lb = s.bodyOf(link)!;
    let a = 0;
    let minW = 0;
    let rebound = 0;
    let wheelSpin = 0;
    let bounced = false;
    let maxDown = 0;
    let depth = -Infinity;
    const P = shapePoints(m.parts.find((p) => p.id === link)!);
    for (let i = 0; i < 480 * 1; i++) {
      s.stepFixed(1);
      a = unwrap(a, angleZ(s.bodyTransform(lb)!));
      const wz = s.bodyVelocity(lb)!.w[2];
      minW = Math.min(minW, wz);
      if (minW < -5 && wz > 0.05 * -minW) bounced = true; // swinging down (ω < 0), then back up (restitution 0.1)
      maxDown = Math.min(maxDown, a);
      rebound = Math.max(rebound, wz);
      wheelSpin = Math.max(wheelSpin, Math.abs(s.bodyVelocity(wb)!.w[2]));
      const t = s.bodyTransform(lb)!;
      for (const q of P) {
        const p = applyTransform(t, q);
        depth = Math.max(depth, Math.min(2 - 0.04 - Math.hypot(p[0], p[1]), HC - Math.abs(p[2] - 1)));
      }
    }
    report(`link strikes the wheel: at ${(-minW).toFixed(1)} rad/s, rebounds at ${rebound.toFixed(2)} rad/s, stops at ${((maxDown * 180) / Math.PI).toFixed(1)}°; wheel spun up to ${wheelSpin.toFixed(2)} rad/s; deepest ${depth.toFixed(3)} into the rim`);
    expect(bounced).toBe(true);
    expect(wheelSpin).toBeGreaterThan(0.5);
    expect(depth).toBeLessThan(0.15);
    // without the wheel in its path the link would swing down past −90°
    expect(maxDown).toBeGreaterThan(-Math.PI / 2);
    s.dispose();
  }, 60000);
});

describe('crank wheel (DESIGN §8 example 8)', () => {
  it('rocks and comes to rest at friction Realistic; no energy gain beyond the guard band with friction off', async () => {
    const m = buildExample('crank-wheel');
    const s = await Simulation.create(m);
    const wheel = s.bodyOf(2)!;
    let lo = Infinity;
    let hi = -Infinity;
    let a = 0;
    let restAt = 0;
    let prev = 0;
    for (let i = 1; i <= 480 * 15; i++) {
      s.stepFixed(1);
      a = unwrap(a, angleZ(s.bodyTransform(wheel)!));
      if (s.time <= 2) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, a);
      }
      if (i % 240 === 0) {
        if (Math.abs(a - prev) > 1e-3) restAt = s.time;
        prev = a;
      }
    }
    report(`crank wheel (realistic): sweeps ${(((hi - lo) * 180) / Math.PI).toFixed(0)}° in the first 2 s, at rest from ${restAt.toFixed(1)} s at ${((a * 180) / Math.PI).toFixed(1)}° (crank-down is −135°)`);
    expect(((hi - lo) * 180) / Math.PI).toBeGreaterThan(30);
    expect(restAt).toBeGreaterThan(2);
    expect(restAt).toBeLessThan(10);
    expect(Math.abs(a + (3 * Math.PI) / 4)).toBeLessThan(0.2); // crank down, within friction's dead zone
    s.dispose();

    const f = await Simulation.create(m, { jointFriction: 0 });
    const e0 = total(f.energy());
    let eMin = e0;
    let kMax = 0;
    let rise = 0;
    for (let i = 1; i <= 480 * 10; i++) {
      f.stepFixed(1);
      if (i % 4) continue;
      const en = f.energy();
      const e = total(en);
      kMax = Math.max(kMax, en.kinetic);
      eMin = Math.min(eMin, e);
      rise = Math.max(rise, (e - eMin) / kMax);
    }
    report(`crank wheel (off): energy above its running minimum ≤ ${(rise * 100).toFixed(2)} % of KE_max over 10 s, guard removed ${f.guardRemoved.toPrecision(3)}`);
    expect(rise).toBeLessThan(0.0105);
    f.dispose();
  }, 120000);
});

describe('setBodyVelocity', () => {
  it('sets a dynamic body’s velocity (angular optional), refuses fixed / unknown bodies and bad vectors', async () => {
    const m = setFixRoot(setGround(setRim((() => {
      const b = new ModelBuilder();
      b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
      return b.build();
    })(), 1, [0, 0, 0], 2), true), false);
    const s = await Simulation.create(m);
    expect(s.setBodyVelocity(0, [1, 2, 3], [0, 0, 4])).toBe(true);
    expect(s.bodyVelocity(0)!.v).toEqual([1, 2, 3]);
    expect(s.bodyVelocity(0)!.w).toEqual([0, 0, 4]);
    expect(s.setBodyVelocity(0, [5, 0, 0])).toBe(true);
    expect(s.bodyVelocity(0)!.w).toEqual([0, 0, 4]); // unchanged
    expect(s.setBodyVelocity(0, [NaN, 0, 0])).toBe(false);
    expect(s.setBodyVelocity(7, [0, 0, 0])).toBe(false);
    s.dispose();
    const p = await Simulation.create(buildExample('pendulum'));
    expect(p.setBodyVelocity(0, [1, 0, 0])).toBe(false); // the fixed frame
    p.dispose();
  });
});

describe('grabbing with a ground (DEVIATIONS §5 "Wheels, ground, free root": GRAB_PRESS_LIMIT)', () => {
  /** Lowest point of every wheel's round collider (radius r − 0.04, half-length HC) relative to groundY. */
  const wheelClearance = (s: Simulation, m: Model): number => {
    let lo = Infinity;
    for (const p of m.parts)
      for (const c of p.cells) {
        if (c.rim === undefined) continue;
        const b = s.bodyOf(p.id)!;
        const hub = where(s, b, [c.x, c.y, c.z]);
        const e: Vec3 = [0, 0, 0];
        e[c.axis] = 1;
        const tip = where(s, b, [c.x + e[0], c.y + e[1], c.z + e[2]]);
        const ay = Math.abs(tip[1] - hub[1]);
        lo = Math.min(lo, hub[1] - (c.rim - 0.04) * Math.sqrt(Math.max(0, 1 - ay * ay)) - HC * ay - s.groundY!);
      }
    return lo;
  };

  it('pressing the cart example into the floor does not push its wheels through; lifting still works', async () => {
    const m = buildExample('cart');
    expect(GRAB_PRESS_LIMIT).toBe(2);
    let deepest = Infinity;
    for (const depth of [10, 100]) {
      const s = await Simulation.create(m);
      s.stepFixed(240);
      const chassis = s.bodyOf(1)!;
      expect(s.grab(chassis, [4, 0.5, 0])).toBe(true);
      for (let i = 0; i < 960; i++) {
        s.dragTo([4 + (depth * i) / 960, 0.5 - depth, 0]);
        s.stepFixed(1);
        deepest = Math.min(deepest, wheelClearance(s, m));
      }
      s.release();
      s.stepFixed(960);
      const after = wheelClearance(s, m);
      report(`cart example pressed ${depth} units into the floor for 2 s: deepest wheel ${(-deepest).toFixed(3)} units into it, ${(-after).toFixed(3)} 2 s after release`);
      expect(after).toBeGreaterThan(-0.03);
      expect(s.graph.bodies.every((b) => s.hasBody(b.id))).toBe(true);
      s.dispose();
    }
    // measured: 0.07 (without the limit, at the full 100 g cap: 1.05 and 1.47)
    expect(deepest).toBeGreaterThan(-0.1);
    // lifting keeps the full spring: the chassis follows the cursor up
    const s = await Simulation.create(m);
    s.stepFixed(240);
    s.grab(s.bodyOf(1)!, [4, 0.5, 0]);
    s.dragTo([4, 4.5, 0]);
    s.stepFixed(480);
    expect(s.grabPoint()![1]).toBeGreaterThan(3.5);
    s.dispose();
  }, 120000);
});
