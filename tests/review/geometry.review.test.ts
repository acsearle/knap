// Adversarial review tests for src/geometry (DESIGN.md §4). Expectations follow from the spec.
import { beforeAll, describe, expect, it } from 'vitest';

// ---- capture the geometry module's WASM memory (must patch before initGeometry runs) ----
const memories: WebAssembly.Memory[] = [];
{
  const grab = (r: unknown): void => {
    const inst = (r as { instance?: WebAssembly.Instance }).instance ?? (r as WebAssembly.Instance);
    const ex = (inst as WebAssembly.Instance)?.exports;
    if (!ex) return;
    for (const v of Object.values(ex)) if (v instanceof WebAssembly.Memory) memories.push(v);
  };
  const oi = WebAssembly.instantiate.bind(WebAssembly);
  (WebAssembly as unknown as { instantiate: unknown }).instantiate = async (...a: unknown[]) => {
    const r = await (oi as (...x: unknown[]) => Promise<unknown>)(...a);
    grab(r);
    return r;
  };
  if (WebAssembly.instantiateStreaming) {
    const os = WebAssembly.instantiateStreaming.bind(WebAssembly);
    (WebAssembly as unknown as { instantiateStreaming: unknown }).instantiateStreaming = async (...a: unknown[]) => {
      const r = await (os as (...x: unknown[]) => Promise<unknown>)(...a);
      grab(r);
      return r;
    };
  }
}

import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { DIRS, KINDS, addCell, addPart, canAddCell, emptyModel, makeCell, partById, validateModel } from '../../src/core';
import type { Axis, Cell, Kind, Part } from '../../src/core';
import {
  EPS,
  E_CONN,
  E_FREE,
  H,
  HC,
  R_BORE,
  R_RIDGE,
  R_ROD,
  W_BORE,
  W_ROD,
  analyzeCells,
  buildPartMesh,
  clearMeshCache,
  initGeometry,
  liveManifoldCount,
  partColliders,
  partOrigin,
  partSolidStats,
  partVolume,
} from '../../src/geometry';
import type { ColliderPrim, MeshData } from '../../src/geometry';
import { CATALOG } from '../../e2e/geom-catalog';
import { V, bbox, crossArea, edgeProblems, meshGenus, meshVolume, weld } from '../geometry/helpers';

let M: ManifoldToplevel;
beforeAll(async () => {
  await initGeometry();
  M = await Module();
  M.setup();
});

const C = (x: number, y: number, z: number, kind: Kind, axis: Axis): Cell => makeCell(x, y, z, kind, axis);
const P = (cells: Cell[]): Part => ({ id: 1, color: '#888888', cells });
const fresh = (p: Part): MeshData => {
  clearMeshCache();
  return buildPartMesh(p);
};

/** Welded output mesh → manifold (owned by caller). */
function toMf(m: MeshData): Manifold {
  const { pos, tri } = weld(m);
  return new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: new Float32Array(pos.flat()), triVerts: new Uint32Array(tri) }));
}
function components(m: MeshData): number[] {
  const mf = toMf(m);
  const parts = mf.decompose();
  const vols = parts.map((q) => q.volume());
  parts.forEach((q) => q.delete());
  mf.delete();
  return vols;
}
/** Rotate so `axis` maps to +Z: returns manifold + map from a local 3D point to the slice's 2D coords. */
function sliceAt(m: MeshData, axis: Axis, value: number): { cs: CrossSection; to2: (p: number[]) => [number, number]; free: () => void } {
  const mf = toMf(m);
  let r: Manifold = mf;
  let to2: (p: number[]) => [number, number] = (p) => [p[0]!, p[1]!];
  if (axis === 0) {
    r = mf.rotate([0, -90, 0]); // x' = -z, z' = x
    to2 = (p) => [-p[2]!, p[1]!];
  } else if (axis === 1) {
    r = mf.rotate([90, 0, 0]); // y' = -z, z' = y
    to2 = (p) => [p[0]!, -p[2]!];
  }
  const cs = r.slice(value);
  return {
    cs,
    to2,
    free: () => {
      cs.delete();
      if (r !== mf) r.delete();
      mf.delete();
    },
  };
}
/** Material area of the slice ⟂ axis at `value`, restricted to the square of half-size `hw` around 3D point p. */
function sliceArea(m: MeshData, axis: Axis, value: number, p?: number[], hw = 0.5): number {
  const s = sliceAt(m, axis, value);
  let a: number;
  if (!p) a = s.cs.area();
  else {
    const [u, v] = s.to2(p);
    const sq = M.CrossSection.square([2 * hw, 2 * hw], true).translate([u, v]);
    const i = s.cs.intersect(sq);
    a = i.area();
    i.delete();
    sq.delete();
  }
  s.free();
  return a;
}

function check(m: MeshData): { problems: string[]; status: string; genus: number; comps: number[] } {
  const mf = toMf(m);
  const r = { problems: edgeProblems(m), status: mf.status() as string, genus: mf.genus(), comps: components(m) };
  mf.delete();
  return r;
}

// ------------------------------------------------------------------------------------------
// (1) solids for tricky parts

const block22 = P([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2), C(0, 1, 0, 'pinHole', 2), C(1, 1, 0, 'pinHole', 2)]);
const block222 = P([0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => C(x, y, z, 'pinHole', 2)))));
const roundedSquare = 1 + 4 * H + Math.PI * H * H;

interface Case {
  name: string;
  part: Part;
  genus: number;
  volume?: number;
}
const CASES: Case[] = [
  { name: '2×2 block', part: block22, genus: 4, volume: 2 * H * (roundedSquare - 4 * Math.PI * R_BORE ** 2) },
  { name: '2×2×2 block', part: block222, genus: 4, volume: (1 + 2 * H) * (roundedSquare - 4 * Math.PI * R_BORE ** 2) },
  { name: '15-hole liftarm', part: P(Array.from({ length: 15 }, (_, i) => C(i, 0, 0, 'pinHole', 2))), genus: 15, volume: V.stadium(15) },
  {
    name: '40-long axle',
    part: P(Array.from({ length: 40 }, (_, i) => C(0, i, 0, 'axle', 1))),
    genus: 0,
    volume: crossArea(W_ROD, R_ROD) * (39 + 2 * E_FREE),
  },
  {
    name: '2×2 block, one cell axis X (blind from +X)',
    part: P([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 0), C(0, 1, 0, 'pinHole', 2), C(1, 1, 0, 'pinHole', 2)]),
    genus: 3,
  },
  {
    name: '2×2: X tube + two Z holes',
    part: P([C(0, 0, 0, 'pinHole', 0), C(1, 0, 0, 'pinHole', 0), C(0, 1, 0, 'pinHole', 2), C(1, 1, 0, 'axleHole', 2)]),
    genus: 3,
  },
  {
    name: '3-axis corner cluster',
    part: P([C(0, 0, 0, 'pinHole', 0), C(1, 0, 0, 'axleHole', 1), C(0, 1, 0, 'pinHole', 2), C(0, 0, 1, 'axleHole', 1), C(1, 1, 0, 'pinHole', 0)]),
    genus: -1, // only manifold/one-component checked
  },
  {
    name: 'axles on all four walls of a Z hole',
    part: P([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'axle', 0), C(-1, 0, 0, 'axle', 0), C(0, 1, 0, 'pin', 1), C(0, -1, 0, 'frictionPin', 1)]),
    genus: 1,
  },
  {
    name: 'rods on walls of a 3D-path hole (tube cell)',
    part: P([C(0, 0, 0, 'pinHole', 2), C(0, 0, 1, 'axleHole', 2), C(1, 0, 1, 'axle', 0), C(0, 1, 0, 'pin', 1)]),
    genus: 1,
  },
  {
    name: 'negative coordinates T',
    part: P([C(-5, -3, -9, 'pinHole', 2), C(-4, -3, -9, 'pinHole', 2), C(-3, -3, -9, 'pinHole', 2), C(-4, -4, -9, 'axleHole', 2), C(-4, -5, -9, 'axle', 1)]),
    genus: 4,
  },
  {
    name: 'blind hole both sides (Z, X, Z row)',
    part: P([C(-1, 0, 0, 'pinHole', 2), C(0, 0, 0, 'pinHole', 0), C(1, 0, 0, 'pinHole', 2)]),
    genus: 2,
  },
];

describe('tricky solids: closed manifold, genus, one component, volume', () => {
  for (const cs of CASES) {
    it(cs.name, () => {
      const m = fresh(cs.part);
      const r = check(m);
      expect(r.problems).toEqual([]);
      expect(r.status).toBe('NoError');
      expect(r.comps.length, `components ${JSON.stringify(r.comps)}`).toBe(1);
      if (cs.genus >= 0) expect(r.genus).toBe(cs.genus);
      const raw = partSolidStats(cs.part);
      const slow = partSolidStats(cs.part, { fast: false });
      expect(Math.abs(raw.volume - slow.volume) / slow.volume).toBeLessThan(1e-5);
      expect(raw.genus).toBe(slow.genus);
      if (cs.volume !== undefined) expect(Math.abs(meshVolume(m) - cs.volume) / cs.volume).toBeLessThan(0.01);
      expect(m.origin).toEqual(partOrigin(cs.part));
    });
  }
});

describe('blind bores', () => {
  it('ring↔wall connector: the blind bore stops at the face and leaves a wall before the neighbour bore', () => {
    const m = fresh(P([C(0, 0, 0, 'pinHole', 0), C(1, 0, 0, 'pinHole', 1)]));
    // at x = 0.6 (between the face at 0.5 and the Y bore at x ≥ 0.69), the section around the axis is solid
    const a = sliceArea(m, 0, 0.6, [0.6, 0, 0], 0.2);
    expect(a).toBeCloseTo(0.16, 3);
    // at x = 0.4 there is bore at the centre
    expect(sliceArea(m, 0, 0.4, [0.4, 0, 0], 0.2)).toBeLessThan(1e-6);
  });
  it('blind from both sides makes no sealed internal cavity', () => {
    const m = fresh(P([C(-1, 0, 0, 'pinHole', 2), C(0, 0, 0, 'pinHole', 0), C(1, 0, 0, 'pinHole', 2)]));
    const comps = components(m);
    expect(comps.length, `shells with volumes ${comps.map((v) => v.toFixed(4))}`).toBe(1);
  });
});

describe('connected sides fuse; unconnected sides keep their gap', () => {
  it('end↔ring in the same part: rod end at E_FREE, hole face at H, gap between', () => {
    // hole (0,0,0) axis Z; male (0,0,1) axis Z (end faces the ring of the hole: not connected);
    // male attaches at its other end to the wall of an X hole at (0,0,2), which loops back via x=1.
    const p = P([
      C(0, 0, 0, 'pinHole', 2),
      C(0, 0, 1, 'pin', 2),
      C(0, 0, 2, 'pinHole', 0),
      C(1, 0, 2, 'pinHole', 0),
      C(1, 0, 1, 'pinHole', 2),
      C(1, 0, 0, 'pinHole', 2),
    ]);
    expect(validateModel({ version: 1, parts: [p], rootPartId: null, nextPartId: 2 })).toEqual([]);
    const m = fresh(p);
    expect(check(m).comps.length).toBe(1);
    // nothing in the slab H < z < 1 − E_FREE around the male's axis
    for (const z of [H + 0.005, (H + 1 - E_FREE) / 2, 1 - E_FREE - 0.005]) expect(sliceArea(m, 2, z, [0, 0, z], 0.45)).toBeLessThan(1e-9);
    // the rod is there just above
    expect(sliceArea(m, 2, 1 - E_FREE + 0.03, [0, 0, 0], 0.45)).toBeGreaterThan(0.2);
  });
  it('male end ↔ wall: material crosses the shared face', () => {
    for (const kind of ['axle', 'pin', 'frictionPin'] as const) {
      const m = fresh(P([C(0, 0, 0, 'axleHole', 2), C(1, 0, 0, kind, 0)]));
      const a = sliceArea(m, 0, 0.5, [0.5, 0, 0], 0.5);
      expect(a, kind).toBeGreaterThan(0.2);
      expect(check(m).comps.length).toBe(1);
    }
  });
  it('different-kind male runs (axle → pin → frictionPin) fuse', () => {
    const m = fresh(P([C(0, 0, 0, 'axle', 1), C(0, 1, 0, 'pin', 1), C(0, 2, 0, 'frictionPin', 1)]));
    expect(check(m).comps.length).toBe(1);
    expect(sliceArea(m, 1, 0.5)).toBeGreaterThan(0.2);
    expect(sliceArea(m, 1, 1.5)).toBeGreaterThan(0.2);
  });
});

describe('bores do not cut into neighbouring cells', () => {
  it('pin-hole bore does not counterbore a coaxial axle-hole neighbour', () => {
    const m = fresh(P([C(0, 0, 0, 'pinHole', 0), C(1, 0, 0, 'axleHole', 0)]));
    // inside the axle-hole cell (x ∈ [0.5, 1.5]) the section must be the axle-hole profile
    // (Compared with the section at the cell's centre rather than the analytic πH² − cross: the
    // 3D-path barrel is a 48-gon rotated half a segment, 0.3% smaller than the circle.)
    const want = Math.PI * H * H - crossArea(W_BORE, R_BORE);
    const mid = sliceArea(m, 0, 1.0, [1.0, 0, 0], 0.5);
    expect(Math.abs(mid - want) / want).toBeLessThan(0.01);
    const got = sliceArea(m, 0, 0.505, [0.505, 0, 0], 0.5);
    expect(got).toBeCloseTo(mid, 6);
  });
});

// ------------------------------------------------------------------------------------------
// random valid parts (same generator idea as tests/geometry/fuzz.test.ts, independent seeds)

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
function randomPart(seed: number, size: number): Part {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const kinds = [...KINDS, 'pinHole', 'axleHole'] as const;
  let { model, partId } = addPart(emptyModel(), [makeCell(0, 0, 0, pick(kinds), pick([0, 1, 2] as Axis[]))]);
  for (let tries = 0; tries < size * 30 && partById(model, partId)!.cells.length < size; tries++) {
    const from = pick(partById(model, partId)!.cells);
    const d = pick(DIRS);
    const cell = makeCell(from.x + d[0], from.y + d[1], from.z + d[2], pick(kinds), pick([0, 1, 2] as Axis[]));
    if (canAddCell(model, partId, cell).ok) model = addCell(model, partId, cell);
  }
  return partById(model, partId)!;
}

/** Allowed envelope box of a cell (local frame): ±H / ±E_CONN (holes), ±E_FREE / ±E_CONN axial and rod radius (males). */
function envelope(p: Part): { lo: number[]; hi: number[] }[] {
  const o = partOrigin(p);
  return analyzeCells(p).map((t) => {
    const c = t.cell;
    const ctr = [c.x - o[0], c.y - o[1], c.z - o[2]];
    const lo: number[] = [];
    const hi: number[] = [];
    for (let k = 0; k < 3; k++) {
      let e0: number, e1: number;
      if (c.kind === 'pinHole' || c.kind === 'axleHole') {
        e1 = t.faces[2 * k]!.connected ? E_CONN : H;
        e0 = t.faces[2 * k + 1]!.connected ? E_CONN : H;
      } else if (k === c.axis) {
        e1 = t.faces[2 * k]!.connected ? E_CONN : E_FREE;
        e0 = t.faces[2 * k + 1]!.connected ? E_CONN : E_FREE;
      } else {
        e0 = e1 = c.kind === 'frictionPin' ? R_RIDGE : R_ROD;
      }
      lo.push(ctr[k]! - e0);
      hi.push(ctr[k]! + e1);
    }
    return { lo, hi };
  });
}

describe('random parts: envelope, components, order independence', () => {
  const N = Number(process.env.REVIEW_GEOM_SEEDS ?? 150);
  it(`${N} random parts: every vertex inside some cell envelope; one component`, () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const p = randomPart(seed, 2 + (seed % 9));
      const m = fresh(p);
      const env = envelope(p);
      const tol = 1e-5;
      for (let i = 0; i < m.positions.length; i += 3) {
        const v = [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!];
        if (!env.some((b) => v.every((x, k) => x >= b.lo[k]! - tol && x <= b.hi[k]! + tol))) {
          bad.push(`seed ${seed}: vertex ${v.map((x) => x.toFixed(4))} outside every cell envelope`);
          break;
        }
      }
      const comps = components(m);
      if (comps.length !== 1) bad.push(`seed ${seed} (${p.cells.length} cells): ${comps.length} shells ${comps.map((x) => x.toFixed(4))}`);
    }
    expect(bad).toEqual([]);
  }, 300000);

  it('cell order does not change the geometry (cache defeated)', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const p = randomPart(1000 + seed, 3 + (seed % 7));
      const a = fresh(p);
      const rev = { ...p, cells: [...p.cells].reverse() };
      const b = fresh(rev);
      const va = meshVolume(a), vb = meshVolume(b);
      if (Math.abs(va - vb) > 1e-6) bad.push(`seed ${seed}: volume ${va} vs ${vb}`);
      const ba = bbox(a), bb = bbox(b);
      if (ba.min.some((x, k) => Math.abs(x - bb.min[k]!) > 1e-6) || ba.max.some((x, k) => Math.abs(x - bb.max[k]!) > 1e-6))
        bad.push(`seed ${seed}: bbox differs`);
      if (meshGenus(a) !== meshGenus(b) && !edgeProblems(a).length && !edgeProblems(b).length) bad.push(`seed ${seed}: genus`);
      if (!!edgeProblems(a).length !== !!edgeProblems(b).length) bad.push(`seed ${seed}: manifoldness depends on cell order`);
    }
    expect(bad).toEqual([]);
  }, 120000);
});

// ------------------------------------------------------------------------------------------
// (2) colliders vs §4.3 and vs the mesh

function primBox(q: ColliderPrim): { lo: number[]; hi: number[] } {
  const h = q.shape === 'box' ? q.halfExtents : [0, 1, 2].map((k) => (k === q.axis ? q.halfLength : q.radius));
  return { lo: q.center.map((c, k) => c - h[k]!), hi: q.center.map((c, k) => c + h[k]!) };
}

describe('partColliders', () => {
  it('per-cell collider AABB matches the mesh within the cell (same frame; HC vs H)', () => {
    const parts = [...CATALOG.map((e) => e.part), ...CASES.map((c) => c.part), ...Array.from({ length: 80 }, (_, i) => randomPart(500 + i, 2 + (i % 8)))];
    const bad: string[] = [];
    for (const p of parts) {
      const m = fresh(p);
      const cols = partColliders(p);
      const o = partOrigin(p);
      const topo = analyzeCells(p);
      for (const t of topo) {
        const mine = cols.filter((q) => q.cell === t.index);
        const ctr = [t.cell.x - o[0], t.cell.y - o[1], t.cell.z - o[2]];
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const q of mine) {
          const b = primBox(q);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k]!, b.lo[k]!);
            hi[k] = Math.max(hi[k]!, b.hi[k]!);
          }
        }
        // expected per §4.3
        const isM = t.cell.kind === 'axle' || t.cell.kind === 'pin' || t.cell.kind === 'frictionPin';
        for (let k = 0; k < 3; k++) {
          const cp = t.faces[2 * k]!.connected, cm = t.faces[2 * k + 1]!.connected;
          let e1: number, e0: number;
          if (isM) {
            if (k === t.cell.axis) {
              e1 = cp ? E_CONN : E_FREE;
              e0 = cm ? E_CONN : E_FREE;
            } else e0 = e1 = 0.29;
          } else {
            e1 = cp ? 0.5 : HC;
            e0 = cm ? 0.5 : HC;
          }
          if (Math.abs(hi[k]! - (ctr[k]! + e1)) > 1e-9 || Math.abs(lo[k]! - (ctr[k]! - e0)) > 1e-9)
            bad.push(`${p.cells.length}c cell ${t.index} ${t.cell.kind}/${t.cell.axis} axis ${k}: [${lo[k]! - ctr[k]!}, ${hi[k]! - ctr[k]!}] want [${-e0}, ${e1}]`);
        }
        const m1 = mine.filter((q) => q.shape === 'cylinder');
        if (m1.length !== 1 || (m1[0] as { axis: number }).axis !== t.cell.axis || m1[0]!.male !== isM) bad.push(`cell ${t.index}: cylinder`);
        if (isM && mine.length !== 1) bad.push(`male cell ${t.index}: ${mine.length} prims`);
      }
      // whole-part: collider AABB inside the mesh AABB, close to it
      const mb = bbox(m);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const q of cols) {
        const b = primBox(q);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, b.lo[k]!);
          hi[k] = Math.max(hi[k]!, b.hi[k]!);
        }
      }
      for (let k = 0; k < 3; k++) {
        if (lo[k]! < mb.min[k]! - 1e-4 || hi[k]! > mb.max[k]! + 1e-4) bad.push(`${p.cells.length}c: collider outside mesh on axis ${k}`);
        if (mb.min[k]! < lo[k]! - 0.045 || mb.max[k]! > hi[k]! + 0.045) bad.push(`${p.cells.length}c: mesh far outside colliders on axis ${k}`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  }, 120000);
});

// ------------------------------------------------------------------------------------------
// (3) WASM memory

describe('WASM memory', () => {
  it('captured the geometry module memory', () => {
    expect(memories.length).toBeGreaterThan(0);
  });
  it('thousands of distinct uncached builds do not grow the heap', () => {
    const mem = memories[0]!;
    const run = (from: number, n: number) => {
      for (let i = from; i < from + n; i++) {
        clearMeshCache();
        const p = randomPart(20000 + (i % 400), 2 + (i % 9));
        // translate so signatures/caches can never help; mix in stats/volume too
        buildPartMesh(p);
        if (i % 7 === 0) partSolidStats(p);
        if (i % 11 === 0) partVolume(p);
      }
    };
    run(0, 600);
    const after1 = mem.buffer.byteLength;
    run(600, 3000);
    const after2 = mem.buffer.byteLength;
    console.log(`review: wasm heap ${after1 / 2 ** 20} MiB → ${after2 / 2 ** 20} MiB`);
    expect(liveManifoldCount()).toBe(0);
    expect(after2).toBeLessThanOrEqual(after1 + 2 ** 20);
  }, 600000);
});
