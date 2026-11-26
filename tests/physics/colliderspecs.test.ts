// "Show colliders" (DESIGN §7.4): colliderSpecs — what the view draws — lists exactly the colliders
// the Simulation creates, checked against Rapier's own colliders (Simulation.colliderDump): the
// same count per body, matched one to one by shape type and role (role read from Rapier's collision
// groups), hull vertex sets equal as convex hulls to 1e-5, box and cylinder parameters to 1e-5.
// For every built-in example (ground on and off) and for seeded random models with wheels and
// gears on all three axes.
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/core/examples';
import { GEAR_RADII } from '../../src/core/gears';
import { addCell, addPart, canAddCell, canSetGear, canSetRim, emptyModel, groundLevel, makeCell, partById, setGear, setGround, setRim } from '../../src/core/model';
import { DIRS, isHole } from '../../src/core/rules';
import type { Axis, Kind, Model } from '../../src/core/types';
import { rotate } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { DEFAULT_CYLINDER_SEGMENTS, colliderSpecs } from '../../src/physics/shapes';
import type { ColliderRole, ColliderSpec } from '../../src/physics/shapes';
import { Simulation } from '../../src/physics/sim';

const TOL = 1e-5;

/** Role (and gear flag) from Rapier's raw collision groups (sim.ts GROUP); null for an unknown membership. */
function roleOf(groups: number, grouped: boolean): { role: ColliderRole; gear: boolean } | null {
  if (!grouped) return groups >>> 0 === 0xffffffff ? { role: 'part', gear: false } : null;
  switch (groups >>> 16) {
    case 0x8:
      return { role: 'part', gear: false };
    case 0x2:
      return { role: 'round', gear: false };
    case 0x20:
      return { role: 'round', gear: true };
    case 0x4:
      return { role: 'hull', gear: false };
    case 0x40:
      return { role: 'hull', gear: true };
    case 0x10:
      return { role: 'guard', gear: false };
    default:
      return null;
  }
}

type Dumped = ReturnType<Simulation['colliderDump']>[number]['colliders'][number];

const addv = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Every point of `pts` lies on or inside the convex hull of `hullPts` (within TOL). */
function insideHull(pts: Vec3[], hullPts: Vec3[]): boolean {
  const h = new ConvexHull().setFromPoints(hullPts.map((p) => new Vector3(...p)));
  for (const f of h.faces) {
    const n = f.normal;
    const c = f.constant;
    for (const p of pts) if (n.x * p[0] + n.y * p[1] + n.z * p[2] - c > TOL) return false;
  }
  return true;
}

/** Does the dumped collider (in edit-time world coordinates through `ref`) match the spec? */
function matches(spec: ColliderSpec, d: Dumped, ref: Vec3): boolean {
  const s = spec.shape;
  const center = addv(ref, d.translation);
  if (s.type === 'hull') {
    if (d.type !== 'convexHull' || !d.vertices) return false;
    const rv = d.vertices.map((v) => addv(center, rotate(d.rotation, v)));
    // Every Rapier vertex is a spec point, and every spec point is on or inside Rapier's hull.
    if (!rv.every((v) => s.points.some((p) => dist(p, v) <= TOL))) return false;
    return insideHull(s.points, rv);
  }
  if (s.type === 'box') {
    if (d.type !== 'cuboid' || !d.halfExtents) return false;
    const r = d.rotation;
    if (Math.abs(Math.abs(r[3]) - 1) > TOL) return false; // axis-aligned
    return dist(center, s.center) <= TOL && dist(d.halfExtents, s.halfExtents) <= TOL;
  }
  if (d.type !== 'cylinder' || d.radius === undefined || d.halfHeight === undefined) return false;
  const ax = rotate(d.rotation, [0, 1, 0]);
  const e: Vec3 = [0, 0, 0];
  e[s.axis] = 1;
  const parallel = Math.abs(Math.abs(ax[0] * e[0] + ax[1] * e[1] + ax[2] * e[2]) - 1) <= TOL;
  return parallel && dist(center, s.center) <= TOL && Math.abs(d.radius - s.radius) <= TOL && Math.abs(d.halfHeight - s.halfLength) <= TOL;
}

interface Check {
  bodies: number;
  colliders: number;
  byRole: Record<ColliderRole, number>;
}

/** Build a Simulation and compare colliderSpecs with Rapier's colliders, body by body. */
async function check(model: Model, label: string): Promise<Check> {
  const sim = await Simulation.create(model);
  try {
    const ground = groundLevel(model) !== null;
    const grouped = ground || model.parts.some((p) => p.cells.some((c) => c.rim !== undefined));
    const dump = sim.colliderDump();
    const byRole: Record<ColliderRole, number> = { part: 0, round: 0, hull: 0, guard: 0 };
    let total = 0;
    expect(dump.length, `${label}: bodies`).toBe(sim.graph.bodies.length);
    for (const body of dump) {
      const specs: ColliderSpec[] = [];
      for (const p of model.parts) if (sim.bodyOf(p.id) === body.bodyId) specs.push(...colliderSpecs(p, DEFAULT_CYLINDER_SEGMENTS, ground));
      expect(body.colliders.length, `${label}: body ${body.bodyId} collider count`).toBe(specs.length);
      const used = new Set<number>();
      for (const [i, spec] of specs.entries()) {
        let found = -1;
        for (let k = 0; k < body.colliders.length && found < 0; k++) {
          if (used.has(k)) continue;
          const d = body.colliders[k]!;
          const r = roleOf(d.groups, grouped);
          if (!r || r.role !== spec.role || r.gear !== (spec.gear === true && spec.role !== 'guard')) continue;
          if (matches(spec, d, body.ref)) found = k;
        }
        expect(found, `${label}: body ${body.bodyId} spec ${i} (${spec.role} ${spec.shape.type}) has a Rapier collider`).toBeGreaterThanOrEqual(0);
        used.add(found);
        byRole[spec.role]++;
        total++;
      }
    }
    return { bodies: dump.length, colliders: total, byRole };
  } finally {
    sim.dispose();
  }
}

/** Collider counts of the built-in examples (as built, and with the ground toggled): a change is noticed. */
const EXAMPLE_COUNTS: Record<string, { asBuilt: string; toggled: string }> = {
  pendulum: { asBuilt: '4 (part 4, round 0, hull 0, guard 0)', toggled: '4 (part 4, round 0, hull 0, guard 0)' },
  'triple-pendulum': { asBuilt: '10 (part 10, round 0, hull 0, guard 0)', toggled: '10 (part 10, round 0, hull 0, guard 0)' },
  'four-bar': { asBuilt: '13 (part 13, round 0, hull 0, guard 0)', toggled: '13 (part 13, round 0, hull 0, guard 0)' },
  parallelogram: { asBuilt: '14 (part 14, round 0, hull 0, guard 0)', toggled: '14 (part 14, round 0, hull 0, guard 0)' },
  'sliding-axle': { asBuilt: '21 (part 21, round 0, hull 0, guard 0)', toggled: '21 (part 21, round 0, hull 0, guard 0)' },
  'weld-test': { asBuilt: '9 (part 9, round 0, hull 0, guard 0)', toggled: '9 (part 9, round 0, hull 0, guard 0)' },
  collision: { asBuilt: '16 (part 16, round 0, hull 0, guard 0)', toggled: '16 (part 16, round 0, hull 0, guard 0)' },
  // Wheels and gears: 1 round + 64 hull pieces each, + 1 guard with the ground on.
  'crank-wheel': { asBuilt: '74 (part 9, round 1, hull 64, guard 0)', toggled: '75 (part 9, round 1, hull 64, guard 1)' },
  cart: { asBuilt: '301 (part 37, round 4, hull 256, guard 4)', toggled: '297 (part 37, round 4, hull 256, guard 0)' },
  'gear-train': { asBuilt: '294 (part 34, round 4, hull 256, guard 0)', toggled: '298 (part 34, round 4, hull 256, guard 4)' },
};

describe('colliderSpecs = Rapier’s colliders', () => {
  it('every built-in example, ground on and off', async () => {
    const got: Record<string, { asBuilt: string; toggled: string }> = {};
    const fmt = (c: Check) => `${c.colliders} (part ${c.byRole.part}, round ${c.byRole.round}, hull ${c.byRole.hull}, guard ${c.byRole.guard})`;
    for (const ex of EXAMPLES) {
      const m = ex.build();
      const a = await check(m, `${ex.name}`);
      const t = await check(setGround(m, m.ground !== true), `${ex.name} ground ${m.ground === true ? 'off' : 'on'}`);
      got[ex.name] = { asBuilt: fmt(a), toggled: fmt(t) };
    }
    expect(got).toEqual(EXAMPLE_COUNTS);
  });

  it('seeded random models with wheels and gears on all three axes, ground on and off', async () => {
    const seen = { wheel: [0, 0, 0], gear: [0, 0, 0], ground: 0, noGround: 0, bodies: 0, colliders: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const m = randomModel(seed);
      for (const c of m.parts.flatMap((p) => p.cells))
        if (c.rim !== undefined) seen[c.teeth ? 'gear' : 'wheel'][c.axis]!++;
      const r = await check(m, `seed ${seed}`);
      await check(setGround(m, m.ground !== true), `seed ${seed}, ground toggled`);
      if (m.ground) seen.ground++;
      else seen.noGround++;
      seen.bodies += r.bodies;
      seen.colliders += r.colliders;
    }
    for (const a of [0, 1, 2]) {
      expect(seen.wheel[a], `wheels on axis ${a}`).toBeGreaterThan(0);
      expect(seen.gear[a], `gears on axis ${a}`).toBeGreaterThan(0);
    }
    expect(seen.ground).toBeGreaterThan(5);
    expect(seen.noGround).toBeGreaterThan(5);
    console.log(`random models: ${JSON.stringify(seen)}`);
  });

  it('the comparison catches a wrong spec (a hull point moved 1e-3, a cylinder 1e-3 too wide)', async () => {
    const m = EXAMPLES.find((e) => e.name === 'crank-wheel')!.build();
    const sim = await Simulation.create(m);
    try {
      const ground = groundLevel(m) !== null;
      const dump = sim.colliderDump();
      let hullsTried = 0;
      let cylTried = 0;
      for (const body of dump)
        for (const p of m.parts) {
          if (sim.bodyOf(p.id) !== body.bodyId) continue;
          for (const spec of colliderSpecs(p, DEFAULT_CYLINDER_SEGMENTS, ground)) {
            const ok = body.colliders.some((d) => matches(spec, d, body.ref));
            expect(ok).toBe(true);
            const bad: ColliderSpec = JSON.parse(JSON.stringify(spec));
            if (bad.shape.type === 'hull') {
              bad.shape.points[0]![0] += 1e-3;
              hullsTried++;
            } else if (bad.shape.type === 'cylinder') {
              bad.shape.radius += 1e-3;
              cylTried++;
            } else bad.shape.halfExtents[1] += 1e-3;
            expect(body.colliders.some((d) => matches(bad, d, body.ref))).toBe(false);
          }
        }
      expect(hullsTried).toBeGreaterThan(60);
      expect(cylTried).toBe(1);
    } finally {
      sim.dispose();
    }
  });

  it('colliderSpecs is translation-equivariant (the view caches it per part signature)', () => {
    const m = randomModel(7);
    for (const p of m.parts) {
      const q = { ...p, cells: p.cells.map((c) => ({ ...c, x: c.x + 5, y: c.y - 3, z: c.z + 11 })) };
      const a = colliderSpecs(p, 16, true);
      const b = colliderSpecs(q, 16, true);
      expect(b.length).toBe(a.length);
      const pts = (s: ColliderSpec): Vec3[] => (s.shape.type === 'hull' ? s.shape.points : [s.shape.center]);
      a.forEach((s, i) => {
        const pa = pts(s);
        const pb = pts(b[i]!);
        pa.forEach((v, k) => expect(dist(addv(v, [5, -3, 11]), pb[k]!)).toBeLessThan(1e-9));
      });
    }
  });
});

// ---- seeded random valid models ----

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 1–3 parts of 1–7 cells grown with the core API (every kind, every axis), each part with a good
 * chance of a wheel or a gear on one of its holes, then the ground on for about half the seeds.
 * Parts start 9 apart along X, so they rarely touch; some pins still join neighbours.
 */
function randomModel(seed: number): Model {
  const r = rng(seed * 7919 + 13);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const KINDS: Kind[] = ['pinHole', 'pinHole', 'pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
  let m = emptyModel();
  const nParts = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nParts; k++) {
    const first = makeCell(9 * k, Math.floor(r() * 3), 0, pick(['pinHole', 'axleHole'] as Kind[]), pick([0, 1, 2] as Axis[]));
    if (!canAddCell(m, null, first).ok) continue;
    const added = addPart(m, [first]);
    m = added.model;
    const id = added.partId;
    const size = 1 + Math.floor(r() * 7);
    for (let tries = 0; tries < size * 20 && partById(m, id)!.cells.length < size; tries++) {
      const from = pick(partById(m, id)!.cells);
      const d = pick(DIRS);
      const cell = makeCell(from.x + d[0], from.y + d[1], from.z + d[2], pick(KINDS), pick([0, 1, 2] as Axis[]));
      if (canAddCell(m, id, cell).ok) m = addCell(m, id, cell);
    }
    // A wheel or a gear on a hole of this part (60 %), tried on a few holes and radii.
    if (r() < 0.6) {
      const gear = r() < 0.5;
      for (let tries = 0; tries < 12; tries++) {
        const c = pick(partById(m, id)!.cells);
        if (!isHole(c.kind)) continue;
        const pos: [number, number, number] = [c.x, c.y, c.z];
        if (gear) {
          const rad = pick(GEAR_RADII);
          if (canSetGear(m, id, pos, rad).ok) {
            m = setGear(m, id, pos, rad);
            break;
          }
        } else {
          const rad = pick([1, 1.5, 2, 2.5, 3]);
          if (canSetRim(m, id, pos, rad).ok) {
            m = setRim(m, id, pos, rad);
            break;
          }
        }
      }
    }
  }
  if (r() < 0.5) m = setGround(m, true);
  return m;
}
