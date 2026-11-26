// Reviewer "truth" (milestone 9, Show colliders): does the collider view show exactly what the
// simulation collides with? Independent of the builder's tests/physics/colliderspecs.test.ts:
//  - spec ↔ Rapier compared index by index (the documented creation order), with the exact raw
//    collision-group word, and shapes compared by their support functions in 98 directions;
//  - the DRAWN data (view/colliders colliderMeshData / hullGeometry) compared with Rapier's own
//    colliders: signed volume per role = Σ Rapier collider.volume(), every triangle's winding
//    outward (FrontSide culling), and the drawn edges = the hull's feature edges computed by brute
//    force from Rapier's vertices (no diagonals, none missing);
//  - models the builder's generator rarely makes: clustered parts with pins / axles mated in other
//    parts' holes (multi-part bodies, joints), every rim radius 1…4 and every gear radius on X/Y/Z,
//    crank cells in wheel and gear webs, ground on/off × Fix root on/off;
//  - colliderDump() called every step leaves the trajectory bit-identical;
//  - what the simulation does NOT collide although the view draws overlapping colliders whose
//    legend says they hit (jointed pairs, gear tip discs).
import { describe, expect, it } from 'vitest';
import { EXAMPLES, buildExample } from '../../src/core/examples';
import { GEAR_RADII } from '../../src/core/gears';
import { addCell, addPart, canAddCell, canSetGear, canSetRim, emptyModel, groundLevel, makeCell, partById, setFixRoot, setGear, setGround, setRim } from '../../src/core/model';
import { DIRS, isHole } from '../../src/core/rules';
import type { Axis, Kind, Model } from '../../src/core/types';
import { rotate } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { DEFAULT_CYLINDER_SEGMENTS, colliderSpecs } from '../../src/physics/shapes';
import type { ColliderRole, ColliderSpec } from '../../src/physics/shapes';
import { Simulation } from '../../src/physics/sim';
import { colliderMeshData, hullGeometry, partColliderData } from '../../src/view/colliders';
import { colliderLegendRows } from '../../src/ui/colliderlegend';
import { trajHash } from '../physics/gearModels';

// ---------------------------------------------------------------------------------------------
// helpers

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** 98 fixed directions: the 26 lattice directions and 72 golden-spiral points. */
const DIRS98: Vec3[] = (() => {
  const out: Vec3[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) out.push([x, y, z].map((c) => c / Math.hypot(x, y, z)) as Vec3);
  const n = 72;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const t = i * Math.PI * (3 - Math.sqrt(5));
    out.push([r * Math.cos(t), y, r * Math.sin(t)]);
  }
  return out;
})();

type Dumped = ReturnType<Simulation['colliderDump']>[number]['colliders'][number];

/** Expected raw collision-group word of a spec (sim.ts GROUP), or 0xffffffff when ungrouped. */
function expectedGroups(s: ColliderSpec, grouped: boolean): number {
  if (!grouped) return 0xffffffff;
  const W = (m: number, f: number) => ((m << 16) | f) >>> 0;
  if (s.role === 'part') return W(0x8, 0x1 | 0x4 | 0x8 | 0x40);
  if (s.role === 'guard') return W(0x10, 0x1);
  if (s.role === 'round') return s.gear ? W(0x20, 0x1 | 0x2) : W(0x2, 0x1 | 0x2 | 0x20);
  return s.gear ? W(0x40, 0x8) : W(0x4, 0x8);
}

function specSupport(s: ColliderSpec, d: Vec3): number {
  const sh = s.shape;
  if (sh.type === 'hull') return Math.max(...sh.points.map((p) => dot3(p, d)));
  if (sh.type === 'box') return dot3(sh.center, d) + Math.abs(d[0]) * sh.halfExtents[0] + Math.abs(d[1]) * sh.halfExtents[1] + Math.abs(d[2]) * sh.halfExtents[2];
  const a = d[sh.axis]!;
  return dot3(sh.center, d) + sh.halfLength * Math.abs(a) + sh.radius * Math.sqrt(Math.max(0, 1 - a * a));
}

function dumpWorldVerts(c: Dumped, ref: Vec3): Vec3[] {
  const o = add3(ref, c.translation);
  return (c.vertices ?? []).map((v) => add3(o, rotate(c.rotation, v)));
}

function dumpSupport(c: Dumped, ref: Vec3, d: Vec3): number {
  const o = add3(ref, c.translation);
  if (c.type === 'convexHull') return Math.max(...dumpWorldVerts(c, ref).map((p) => dot3(p, d)));
  if (c.type === 'cuboid') {
    let s = dot3(o, d);
    for (let k = 0; k < 3; k++) {
      const e: Vec3 = [0, 0, 0];
      e[k] = 1;
      s += Math.abs(dot3(rotate(c.rotation, e), d)) * c.halfExtents![k]!;
    }
    return s;
  }
  if (c.type === 'cylinder') {
    const ax = rotate(c.rotation, [0, 1, 0]);
    const a = dot3(ax, d) / len3(ax);
    return dot3(o, d) + c.halfHeight! * Math.abs(a) + c.radius! * Math.sqrt(Math.max(0, 1 - a * a));
  }
  return NaN;
}

const typeOf = (s: ColliderSpec) => (s.shape.type === 'hull' ? 'convexHull' : s.shape.type === 'box' ? 'cuboid' : 'cylinder');

/** Max support-function difference between a spec and a dumped collider (Infinity on a type mismatch). */
function supportGap(s: ColliderSpec, c: Dumped, ref: Vec3): number {
  if (typeOf(s) !== c.type) return Infinity;
  let g = 0;
  for (const d of DIRS98) g = Math.max(g, Math.abs(specSupport(s, d) - dumpSupport(c, ref, d)));
  return g;
}

/** Feature edges of the convex hull of `pts` by brute force over supporting planes (independent of three's ConvexHull). */
function featureEdges(pts: Vec3[], tol = 2e-5): [Vec3, Vec3][] {
  // dedupe vertices
  const v: Vec3[] = [];
  for (const p of pts) if (!v.some((q) => len3(sub3(p, q)) < tol)) v.push(p);
  const planes: { n: Vec3; d: number }[] = [];
  const n = v.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        let nn = cross3(sub3(v[j]!, v[i]!), sub3(v[k]!, v[i]!));
        const l = len3(nn);
        if (l < 1e-9) continue;
        nn = [nn[0] / l, nn[1] / l, nn[2] / l];
        let d = dot3(nn, v[i]!);
        let above = 0;
        let below = 0;
        for (const p of v) {
          const s = dot3(nn, p) - d;
          if (s > tol) above++;
          else if (s < -tol) below++;
          if (above && below) break;
        }
        if (above && below) continue;
        if (above) {
          nn = [-nn[0], -nn[1], -nn[2]];
          d = -d;
        }
        if (!planes.some((q) => 1 - dot3(q.n, nn) < 1e-7 && Math.abs(q.d - d) < tol)) planes.push({ n: nn, d });
      }
  const on = v.map((p) => planes.map((q) => Math.abs(dot3(q.n, p) - q.d) <= tol));
  const out: [Vec3, Vec3][] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let shared = 0;
      for (let k = 0; k < planes.length; k++) if (on[i]![k] && on[j]![k]) shared++;
      if (shared >= 2) out.push([v[i]!, v[j]!]);
    }
  return out;
}

function sameEdge(a: [Vec3, Vec3], b: [Vec3, Vec3], tol: number): boolean {
  return (len3(sub3(a[0], b[0])) < tol && len3(sub3(a[1], b[1])) < tol) || (len3(sub3(a[0], b[1])) < tol && len3(sub3(a[1], b[0])) < tol);
}

/** Signed volume of a triangle soup (9 floats per triangle) by the divergence theorem about `o`. */
function signedVolume(tri: ArrayLike<number>, start: number, count: number, o: Vec3): number {
  let vol = 0;
  for (let i = start * 3; i < (start + count) * 3; i += 9) {
    const a = sub3([tri[i]!, tri[i + 1]!, tri[i + 2]!], o);
    const b = sub3([tri[i + 3]!, tri[i + 4]!, tri[i + 5]!], o);
    const c = sub3([tri[i + 6]!, tri[i + 7]!, tri[i + 8]!], o);
    vol += dot3(a, cross3(b, c)) / 6;
  }
  return vol;
}

// ---------------------------------------------------------------------------------------------
// random models: clustered parts with mates, every rim / gear radius, crank cells

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

const RIMS = [1, 1.5, 2, 2.5, 3, 3.5, 4];
const MALE: Kind[] = ['pin', 'axle', 'frictionPin'];

function clusteredModel(seed: number): { m: Model; mates: number; rims: string[] } {
  const r = rng(seed * 104729 + 7);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const KINDS: Kind[] = ['pinHole', 'pinHole', 'pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
  let m = emptyModel();
  let mates = 0;
  const rims: string[] = [];
  const nParts = 2 + Math.floor(r() * 3);
  for (let k = 0; k < nParts; k++) {
    let id: number | null = null;
    // Mate: a male cell in a hole of an existing part (60 %), else a fresh hole cell near the origin.
    const holes = m.parts.flatMap((p) => p.cells.filter((c) => isHole(c.kind)));
    if (holes.length && r() < 0.6)
      for (let t = 0; t < 10 && id === null; t++) {
        const h = pick(holes);
        const c = makeCell(h.x, h.y, h.z, pick(MALE), h.axis);
        if (canAddCell(m, null, c).ok) {
          const a = addPart(m, [c]);
          m = a.model;
          id = a.partId;
          mates++;
        }
      }
    for (let t = 0; t < 20 && id === null; t++) {
      const c = makeCell(Math.floor(r() * 5) - 2, Math.floor(r() * 4), Math.floor(r() * 5) - 2, pick(['pinHole', 'axleHole'] as Kind[]), pick([0, 1, 2] as Axis[]));
      if (canAddCell(m, null, c).ok) {
        const a = addPart(m, [c]);
        m = a.model;
        id = a.partId;
      }
    }
    if (id === null) continue;
    const size = 2 + Math.floor(r() * 6);
    for (let t = 0; t < size * 20 && partById(m, id)!.cells.length < size; t++) {
      const from = pick(partById(m, id)!.cells);
      const d = pick(DIRS);
      const c = makeCell(from.x + d[0], from.y + d[1], from.z + d[2], pick(KINDS), pick([0, 1, 2] as Axis[]));
      if (canAddCell(m, id, c).ok) m = addCell(m, id, c);
    }
    if (r() < 0.75) {
      const gear = r() < 0.5;
      for (let t = 0; t < 16; t++) {
        const c = pick(partById(m, id)!.cells);
        if (!isHole(c.kind)) continue;
        const pos: [number, number, number] = [c.x, c.y, c.z];
        const rad = gear ? pick(GEAR_RADII) : pick(RIMS);
        if (gear ? canSetGear(m, id, pos, rad).ok : canSetRim(m, id, pos, rad).ok) {
          m = gear ? setGear(m, id, pos, rad) : setRim(m, id, pos, rad);
          rims.push(`${gear ? 'g' : 'w'}${rad}@${c.axis}`);
          // crank cells in the web: grow in the disc plane next to the hub
          for (let u = 0; u < 12; u++) {
            const dd = pick(DIRS);
            if (dd[c.axis] !== 0) continue;
            const cc = makeCell(c.x + dd[0], c.y + dd[1], c.z + dd[2], pick(['pinHole', 'axleHole', 'pin', 'axle'] as Kind[]), c.axis);
            if (canAddCell(m, id, cc).ok) m = addCell(m, id, cc);
          }
          break;
        }
      }
    }
  }
  return { m, mates, rims };
}

// ---------------------------------------------------------------------------------------------
// the check

/**
 * colliderDump() with the shape data re-read from the engine: Rapier's JS Collider caches the
 * ColliderDesc's own shape object (`_shape`, set by createCollider), so colliderDump's `vertices`,
 * `radius`, `halfHeight` and `halfExtents` are sim.ts's INPUT, not what the engine built. Clearing
 * the cache makes `shape` call Shape.fromRaw (the WASM collider's real shape).
 */
function rawDump(sim: Simulation): ReturnType<Simulation['colliderDump']> {
  const dump = sim.colliderDump();
  const internal = sim as unknown as { bodies: { id: number; rb: { collider(i: number): { _shape: unknown; shape: { vertices?: Float32Array; radius?: number; halfHeight?: number; halfExtents?: { x: number; y: number; z: number } } } } | null }[] };
  for (const b of dump) {
    const rb = internal.bodies[b.bodyId]!.rb!;
    b.colliders.forEach((c, i) => {
      const col = rb.collider(i);
      col._shape = null;
      const sh = col.shape;
      if (c.type === 'convexHull') {
        const v: Vec3[] = [];
        for (let k = 0; k + 2 < sh.vertices!.length; k += 3) v.push([sh.vertices![k]!, sh.vertices![k + 1]!, sh.vertices![k + 2]!]);
        c.vertices = v;
      } else if (c.type === 'cylinder') {
        c.radius = sh.radius;
        c.halfHeight = sh.halfHeight;
      } else if (c.type === 'cuboid') c.halfExtents = [sh.halfExtents!.x, sh.halfExtents!.y, sh.halfExtents!.z];
    });
  }
  return dump;
}

interface Stats {
  bodies: number;
  multiPartBodies: number;
  colliders: number;
  maxGap: number;
  edgesChecked: number;
  volChecked: number;
}

/** Spec vs Rapier (index by index), and drawn data vs Rapier (volume, winding, feature edges). */
async function checkModel(model: Model, label: string, st: Stats, opts: { edges: boolean } = { edges: true }): Promise<void> {
  const sim = await Simulation.create(model);
  try {
    const ground = groundLevel(model) !== null;
    const grouped = ground || model.parts.some((p) => p.cells.some((c) => c.rim !== undefined));
    const dump = rawDump(sim);
    const internal = sim as unknown as { bodies: { id: number; rb: { collider(i: number): { volume(): number } } | null }[] };
    const partById2 = new Map(model.parts.map((p) => [p.id, p]));
    expect(dump.length, `${label}: bodies`).toBe(sim.graph.bodies.filter((b) => b.partIds.some((id) => partById2.get(id)!.cells.length > 0)).length);
    for (const body of dump) {
      const gb = sim.graph.bodies[body.bodyId]!;
      const parts = gb.partIds.map((id) => partById2.get(id)!).filter((p) => p.cells.length > 0);
      if (parts.length > 1) st.multiPartBodies++;
      st.bodies++;
      const specs: { s: ColliderSpec; partId: number }[] = [];
      for (const p of parts) for (const s of colliderSpecs(p, DEFAULT_CYLINDER_SEGMENTS, ground)) specs.push({ s, partId: p.id });
      expect(body.colliders.length, `${label}: body ${body.bodyId} count`).toBe(specs.length);
      const rb = internal.bodies[body.bodyId]!.rb!;
      // Rapier volume per part per role
      const volByPart = new Map<number, Record<ColliderRole, number>>();
      specs.forEach(({ s, partId }, i) => {
        const c = body.colliders[i]!;
        expect(c.groups >>> 0, `${label}: body ${body.bodyId} #${i} ${s.role} groups`).toBe(expectedGroups(s, grouped));
        const g = supportGap(s, c, body.ref);
        expect(g, `${label}: body ${body.bodyId} #${i} ${s.role} ${s.shape.type} support gap`).toBeLessThan(2e-5);
        st.maxGap = Math.max(st.maxGap, g);
        st.colliders++;
        const v = volByPart.get(partId) ?? { part: 0, hull: 0, round: 0, guard: 0 };
        v[s.role] += rb.collider(i).volume();
        volByPart.set(partId, v);
        // the drawn hull of this spec vs Rapier's hull: feature edges and outward winding
        if (opts.edges && s.shape.type === 'hull') {
          const g2 = hullGeometry(s.shape.points);
          const drawn: [Vec3, Vec3][] = [];
          for (let k = 0; k < g2.edges.length; k += 6) drawn.push([[g2.edges[k]!, g2.edges[k + 1]!, g2.edges[k + 2]!], [g2.edges[k + 3]!, g2.edges[k + 4]!, g2.edges[k + 5]!]]);
          const want = featureEdges(dumpWorldVerts(c, body.ref));
          const extra = drawn.filter((e) => !want.some((w) => sameEdge(e, w, 1e-4)));
          const missing = want.filter((w) => !drawn.some((e) => sameEdge(e, w, 1e-4)));
          expect({ extra: extra.length, missing: missing.length }, `${label}: body ${body.bodyId} #${i} ${s.role} hull edges`).toEqual({ extra: 0, missing: 0 });
          for (let k = 0, t = 0; k < g2.triangles.length; k += 9, t += 3) {
            const a: Vec3 = [g2.triangles[k]!, g2.triangles[k + 1]!, g2.triangles[k + 2]!];
            const b: Vec3 = [g2.triangles[k + 3]!, g2.triangles[k + 4]!, g2.triangles[k + 5]!];
            const cc: Vec3 = [g2.triangles[k + 6]!, g2.triangles[k + 7]!, g2.triangles[k + 8]!];
            const w = cross3(sub3(b, a), sub3(cc, a));
            const nrm: Vec3 = [g2.normals[t]!, g2.normals[t + 1]!, g2.normals[t + 2]!];
            expect(dot3(w, nrm) >= -1e-12, `${label}: hull triangle winding vs normal`).toBe(true);
          }
          const vol = signedVolume(g2.triangles, 0, g2.triangles.length / 3, s.shape.points[0]!);
          expect(Math.abs(vol - rb.collider(i).volume()), `${label}: drawn hull volume`).toBeLessThan(1e-4 * Math.max(1, vol));
          st.edgesChecked++;
        }
      });
      // the merged per-part drawing (what the GPU gets): signed volume per role = Rapier's
      for (const p of parts) {
        const data = partColliderData(p, ground);
        const fresh = colliderMeshData(colliderSpecs(p, DEFAULT_CYLINDER_SEGMENTS, ground));
        const v = volByPart.get(p.id)!;
        for (const g of data.groups) {
          const o: Vec3 = [0, 0, 0];
          const drawnVol = signedVolume(data.positions, g.start, g.count, o);
          const freshVol = signedVolume(fresh.positions, fresh.groups.find((x) => x.role === g.role)!.start, g.count, [0, 0, 0]);
          expect(Math.abs(drawnVol - freshVol), `${label}: part ${p.id} ${g.role} cached vs fresh`).toBeLessThan(1e-3);
          // the native cylinder is drawn as an inscribed ≥48-gon: allow its polygon deficit
          const tol = g.role === 'round' ? 3e-3 * v[g.role] + 1e-4 : 1e-4 * Math.max(1, v[g.role]);
          expect(Math.abs(drawnVol - v[g.role]), `${label}: part ${p.id} ${g.role} drawn volume ${drawnVol} vs Rapier ${v[g.role]}`).toBeLessThan(tol);
          st.volChecked++;
        }
        for (const role of ['part', 'hull', 'round', 'guard'] as ColliderRole[])
          if (v[role] > 0) expect(data.groups.some((g) => g.role === role), `${label}: part ${p.id} ${role} drawn`).toBe(true);
      }
    }
  } finally {
    sim.dispose();
  }
}

describe('reviewer truth: the collider view shows what Rapier has', () => {
  it('every example × ground on/off × Fix root on/off, index-wise, support functions, drawn volume and edges', { timeout: 600000 }, async () => {
    const st: Stats = { bodies: 0, multiPartBodies: 0, colliders: 0, maxGap: 0, edgesChecked: 0, volChecked: 0 };
    for (const ex of EXAMPLES) {
      const m0 = ex.build();
      for (const g of [true, false])
        for (const fix of [true, false]) {
          const m = setFixRoot(setGround(m0, g), fix);
          await checkModel(m, `${ex.name} ground=${g} fix=${fix}`, st, { edges: g && fix });
        }
    }
    console.log(`examples: ${JSON.stringify(st)}`);
    expect(st.multiPartBodies).toBeGreaterThan(0);
  });

  it('clustered random models with mates, every rim and gear radius, crank cells', { timeout: 900000 }, async () => {
    const st: Stats = { bodies: 0, multiPartBodies: 0, colliders: 0, maxGap: 0, edgesChecked: 0, volChecked: 0 };
    let mates = 0;
    const rims = new Set<string>();
    let jointedModels = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const { m, mates: k, rims: rr } = clusteredModel(seed);
      mates += k;
      for (const x of rr) rims.add(x);
      const variants: Model[] = [m, setGround(m, true), setFixRoot(setGround(m, true), false)];
      for (const [i, v] of variants.entries()) {
        await checkModel(v, `cluster seed ${seed} v${i}`, st, { edges: i === 1 });
      }
      const s = await Simulation.create(m);
      if (s.graph.joints.length) jointedModels++;
      s.dispose();
    }
    console.log(`clustered: ${JSON.stringify(st)} mates=${mates} jointedModels=${jointedModels} rims=${[...rims].sort().join(' ')}`);
    expect(st.multiPartBodies).toBeGreaterThan(5);
    expect(mates).toBeGreaterThan(20);
  });

  it('teeth: my comparison rejects a dropped collider, a 0.01 shift and a wrong role', async () => {
    const m = buildExample('cart');
    const sim = await Simulation.create(m);
    try {
      const dump = sim.colliderDump();
      const body = dump.find((b) => b.colliders.length > 60)!;
      const parts = sim.graph.bodies[body.bodyId]!.partIds.map((id) => m.parts.find((p) => p.id === id)!);
      const specs = parts.flatMap((p) => colliderSpecs(p, DEFAULT_CYLINDER_SEGMENTS, true));
      expect(specs.length).toBe(body.colliders.length);
      // shift 0.01
      const shifted = JSON.parse(JSON.stringify(specs[0])) as ColliderSpec;
      if (shifted.shape.type === 'hull') shifted.shape.points = shifted.shape.points.map((p) => [p[0] + 0.01, p[1], p[2]]);
      else if (shifted.shape.type === 'box') shifted.shape.center[0] += 0.01;
      else shifted.shape.center[0] += 0.01;
      expect(supportGap(shifted, body.colliders[0]!, body.ref)).toBeGreaterThan(5e-3);
      // wrong role (a wheel hull piece called 'part')
      const hi = specs.findIndex((s) => s.role === 'hull');
      expect(expectedGroups({ ...specs[hi]!, role: 'part' }, true)).not.toBe(body.colliders[hi]!.groups >>> 0);
      // dropped collider: the index-wise pairing then mismatches the next one
      const dropped = specs.filter((_, i) => i !== hi);
      expect(dropped.length).not.toBe(body.colliders.length);
      expect(supportGap(dropped[hi]!, body.colliders[hi]!, body.ref)).toBeGreaterThan(1e-3);
    } finally {
      sim.dispose();
    }
  });

  it('colliderDump() every step leaves Cart, Gear train and Collision bit-identical', { timeout: 300000 }, async () => {
    for (const name of ['cart', 'gear-train', 'collision']) {
      const a = await Simulation.create(buildExample(name));
      const ha = trajHash(a, 720, 8);
      a.dispose();
      const b = await Simulation.create(buildExample(name));
      const orig = b.stepFixed.bind(b);
      (b as unknown as { stepFixed: (n: number) => void }).stepFixed = (n: number) => {
        b.colliderDump();
        orig(n);
        b.colliderDump();
      };
      const hb = trajHash(b, 720, 8);
      b.dispose();
      expect(hb, name).toBe(ha);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// What the simulation does not collide although the view shows overlapping colliders.

type RCollider = { handle: number; collisionGroups(): number; contactCollider(o: RCollider, pred: number): { distance: number } | null };

/** Pairs of colliders on different bodies that overlap by > 0.02 and whose groups let them meet. */
function overlappingPairs(sim: Simulation): { a: number; b: number; ra: number; rb: number; depth: number }[] {
  const internal = sim as unknown as { bodies: { id: number; rb: { numColliders(): number; collider(i: number): RCollider } | null }[] };
  const meet = (g1: number, g2: number) => ((g1 >>> 16) & g2) !== 0 && ((g2 >>> 16) & g1) !== 0;
  const out: { a: number; b: number; ra: number; rb: number; depth: number }[] = [];
  const bs = internal.bodies.filter((b) => b.rb);
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      const A = bs[i]!.rb!;
      const B = bs[j]!.rb!;
      for (let x = 0; x < A.numColliders(); x++)
        for (let y = 0; y < B.numColliders(); y++) {
          const ca = A.collider(x);
          const cb = B.collider(y);
          if (!meet(ca.collisionGroups(), cb.collisionGroups())) continue;
          const c = ca.contactCollider(cb, 0);
          if (c && c.distance < -0.02) out.push({ a: bs[i]!.id, b: bs[j]!.id, ra: ca.collisionGroups() >>> 16, rb: cb.collisionGroups() >>> 16, depth: -c.distance });
        }
    }
  return out;
}

describe('reviewer truth: overlaps the view draws as colliding but the simulation ignores', () => {
  it('FIXED (was FAILS ON PURPOSE): jointed bodies never collide, yet the legend says part shapes "hit parts" and nothing marks them', async () => {
    const report: string[] = [];
    let silent = 0;
    const legends: string[] = [];
    for (const name of ['four-bar', 'crank-wheel', 'cart', 'gear-train']) {
      const m = buildExample(name);
      const sim = await Simulation.create(m);
      const jointPairs = new Set(sim.graph.joints.map((j) => `${Math.min(j.bodyA, j.bodyB)}-${Math.max(j.bodyA, j.bodyB)}`));
      const ov = overlappingPairs(sim);
      const jointedOverlaps = ov.filter((o) => jointPairs.has(`${Math.min(o.a, o.b)}-${Math.max(o.a, o.b)}`));
      silent += jointedOverlaps.length;
      const ground = groundLevel(m) !== null;
      legends.push(colliderLegendRows(m.parts.map((p) => colliderMeshData(colliderSpecs(p, DEFAULT_CYLINDER_SEGMENTS, ground))), ground).map((r) => `${r.label}: ${r.meets}`).join(' | '));
      report.push(`${name}: ${ov.length} overlapping collider pairs (groups allow contact) between bodies, ${jointedOverlaps.length} on jointed pairs, max depth ${Math.max(0, ...jointedOverlaps.map((o) => o.depth)).toFixed(3)}`);
      sim.dispose();
    }
    console.log(report.join('\n'));
    // The legend of every one of these models says that joined parts never hit each other.
    console.log(`legends:\n${legends.join('\n')}`);
    expect(silent).toBeGreaterThan(0);
    for (const words of legends) expect(/pin or axle/i.test(words) && /never hit each other/i.test(words), 'legend mentions that jointed parts do not collide').toBe(true);
  });

  it('FIXED (was FAILS ON PURPOSE): meshing gears\' tip discs overlap; drawn as "smooth rims … hit other wheels" but gear rounds never meet each other', async () => {
    const m = buildExample('gear-train');
    const sim = await Simulation.create(m);
    const internal = sim as unknown as { bodies: { id: number; rb: { numColliders(): number; collider(i: number): RCollider } | null }[] };
    const rounds: { body: number; c: RCollider }[] = [];
    for (const b of internal.bodies) if (b.rb) for (let i = 0; i < b.rb.numColliders(); i++) {
      const c = b.rb.collider(i);
      if (c.collisionGroups() >>> 16 === 0x20) rounds.push({ body: b.id, c });
    }
    let overlapping = 0;
    let maxDepth = 0;
    for (let i = 0; i < rounds.length; i++)
      for (let j = i + 1; j < rounds.length; j++) {
        if (rounds[i]!.body === rounds[j]!.body) continue;
        const d = rounds[i]!.c.contactCollider(rounds[j]!.c, 0);
        if (d && d.distance < 0) {
          overlapping++;
          maxDepth = Math.max(maxDepth, -d.distance);
        }
      }
    sim.dispose();
    // The view draws gear and wheel rounds identically (ColliderSpec.gear is ignored by colliders.ts).
    const fresh = colliderMeshData(m.parts.flatMap((p) => colliderSpecs(p, DEFAULT_CYLINDER_SEGMENTS, false)));
    const ground = groundLevel(m) !== null;
    const rows = colliderLegendRows(m.parts.map((p) => colliderMeshData(colliderSpecs(p, DEFAULT_CYLINDER_SEGMENTS, ground))), ground);
    const discs = rows.find((r) => r.role === 'gearRound');
    console.log(`gear-train: ${rounds.length} gear round colliders, ${overlapping} overlapping pairs, max depth ${maxDepth.toFixed(3)}; legend: ${rows.map((r) => `${r.label} ${r.count ?? ''}: ${r.meets}`).join(' | ')}; drawn round count ${fresh.counts.round}`);
    expect(overlapping).toBeGreaterThan(0);
    // The gear discs have their own legend line, which says they never meet another gear's disc;
    // no line claims discs hit "other wheels".
    expect(discs?.count).toBe(rounds.length);
    expect(/never (hit )?another gear/i.test(discs!.meets), 'gear-disc legend says gears do not meet each other').toBe(true);
    expect(rows.some((r) => r.role === 'round'), 'no wheel-disc line in a gear-only model').toBe(false);
    expect(rows.map((r) => `${r.label} ${r.meets}`).join(' ')).not.toMatch(/wheel/i);
  });
});

describe('reviewer truth: colliderDump reads the engine, not the ColliderDesc (fixed)', () => {
  it('FIXED (was FAILS ON PURPOSE): after the engine\'s cylinder is changed, colliderDump still reports the creation-time shape', async () => {
    const sim = await Simulation.create(buildExample('crank-wheel'));
    try {
      const internal = sim as unknown as { bodies: { rb: { numColliders(): number; collider(i: number): { shapeType(): number; setHalfHeight(h: number): void; setRadius(r: number): void; halfHeight(): number; radius(): number } } | null }[] };
      let changed = 0;
      for (const b of internal.bodies)
        if (b.rb)
          for (let i = 0; i < b.rb.numColliders(); i++) {
            const c = b.rb.collider(i);
            if (c.shapeType() === 10 /* Cylinder */) {
              c.setHalfHeight(0.2);
              c.setRadius(1.0);
              changed++;
              expect(c.halfHeight()).toBeCloseTo(0.2, 6); // the engine has it
            }
          }
      expect(changed).toBe(1);
      const cyl = sim.colliderDump().flatMap((b) => b.colliders).find((c) => c.type === 'cylinder')!;
      // What the dump returns (Collider.shape is the JS object cached from the ColliderDesc at creation):
      console.log(`engine: halfHeight 0.2, radius 1.0; colliderDump: halfHeight ${cyl.halfHeight}, radius ${cyl.radius}`);
      expect({ halfHeight: cyl.halfHeight, radius: cyl.radius }).toEqual({ halfHeight: expect.closeTo(0.2, 6), radius: expect.closeTo(1, 6) });
    } finally {
      sim.dispose();
    }
  });
});
