// Wheels in the geometry (DESIGN.md §4.2 rim + index mark, §4.3 'disc' collider).
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import {
  H,
  HC,
  MARK_D,
  MARK_R0,
  MARK_W,
  RIM_CHAMFER,
  RIM_INSET,
  R_BORE,
  W_BORE,
  buildPartMesh,
  clearMeshCache,
  initGeometry,
  liveManifoldCount,
  partColliders,
  partSignature,
  partSolidStats,
  rimMarks,
  rimSegments,
} from '../../src/geometry';
import type { ColliderPrim, MeshData } from '../../src/geometry';
import { emptyModel, isHole, makeCell, setRim } from '../../src/core';
import type { Axis, Cell, Kind, Model } from '../../src/core';
import { vertexPatches } from '../../src/view/patches';
import { crossArea, edgeProblems, meshShells, meshVolume, part, randomPart, weld } from './helpers';

let M: ManifoldToplevel;
beforeAll(async () => {
  await initGeometry();
  M = await Module();
  M.setup();
});

const RADII = [1, 1.5, 2, 2.5, 3, 3.5, 4];
const hub = (r: number, kind: Kind = 'pinHole', axis: Axis = 2, at: [number, number, number] = [0, 0, 0]): Cell =>
  makeCell(at[0], at[1], at[2], kind, axis, r);
const c = (x: number, y: number, z: number, kind: Kind, axis: Axis, rim?: number): Cell => makeCell(x, y, z, kind, axis, rim);

function manifoldStatus(m: MeshData): { status: string; genus: number; volume: number; shells: number } {
  const { pos, tri } = weld(m);
  const mf = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: new Float32Array(pos.flat()), triVerts: new Uint32Array(tri) }));
  const parts = mf.decompose();
  const r = { status: mf.status(), genus: mf.genus(), volume: mf.volume(), shells: parts.length };
  for (const q of parts) q.delete();
  mf.delete();
  return r;
}

/** Analytic volume of a chamfered rim disc (radius r − RIM_INSET, thickness 2H) minus nothing. */
function rimDiscVolume(r: number): number {
  const R = r - RIM_INSET;
  const ch = RIM_CHAMFER;
  // Pappus: each chamfer removes a right triangle (legs ch) whose centroid is at R − ch/3.
  return Math.PI * R * R * 2 * H - 2 * (ch * ch) / 2 * 2 * Math.PI * (R - ch / 3);
}
const boreVol = (kind: Kind) => (kind === 'pinHole' ? Math.PI * R_BORE ** 2 : crossArea(W_BORE, R_BORE)) * 2 * H;

/** Every wheel configuration below must give a strict closed 2-manifold with one shell. */
const CONFIGS: [string, Cell[]][] = [
  ...RADII.flatMap((r) =>
    ([0, 1, 2] as Axis[]).flatMap((a) =>
      (['pinHole', 'axleHole'] as Kind[]).map((k): [string, Cell[]] => [`single ${k} hub r ${r} axis ${a}`, [hub(r, k, a)]]),
    ),
  ),
  ['r 1.5 hub at the end of a 3-beam', [hub(1.5), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2)]],
  ['r 2.5 hub in the middle of a 7-beam (beam continues past the edge, no tread groove)', Array.from({ length: 7 }, (_, i) => c(i - 3, 0, 0, 'pinHole', 2, i === 3 ? 2.5 : undefined))],
  ['r 2.5 hub + crank hole at (1,1)', [hub(2.5), c(1, 1, 0, 'pinHole', 2)]],
  ['r 2.5 hub + axle-hole crank at (−2,0) and pin-hole crank at (0,2)', [hub(2.5), c(-2, 0, 0, 'axleHole', 2), c(0, 2, 0, 'pinHole', 2)]],
  ['r 3 hub + crank hole on the mark line at (2,0)', [hub(3), c(2, 0, 0, 'pinHole', 2)]],
  ['r 2 axle-hole hub + side pin of the hub sticking out along Y', [hub(2, 'axleHole'), c(0, 1, 0, 'pin', 1), c(0, 2, 0, 'pin', 1), c(0, 3, 0, 'pin', 1)]],
  ['r 2 hub + coaxial tube (hub with an axial neighbour)', [hub(2), c(0, 0, 1, 'pinHole', 2)]],
  ['double wheel: two coaxial hubs stacked, r 2 and r 1.5', [hub(2), c(0, 0, 1, 'pinHole', 2, 1.5)]],
  ['r 2.5 hub + in-plane perpendicular hole at (1,0) (blind into the rim)', [hub(2.5), c(1, 0, 0, 'pinHole', 0)]],
  ['r 3 hub + in-plane perpendicular hole at (1,1), capped by the rim on both ends (no bore)', [hub(3), c(1, 1, 0, 'pinHole', 0)]],
  ['two perpendicular wheels in one part (r 1.5 about Z, r 1.5 about X, joined by a beam)', [hub(1.5), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2), c(3, 0, 0, 'pinHole', 0, 1.5)]],
  ['wheel on a perpendicular connector (ring↔wall)', [hub(2, 'pinHole', 0), c(0, 1, 0, 'pinHole', 2)]],
  ['r 4 wheel with 4 crank holes', [hub(4), c(2, 0, 0, 'pinHole', 2), c(-2, 0, 0, 'pinHole', 2), c(0, 2, 0, 'pinHole', 2), c(0, -2, 0, 'pinHole', 2)]],
];

describe('wheel solids are clean closed 2-manifolds', () => {
  for (const [name, cells] of CONFIGS) {
    it(name, () => {
      const m = buildPartMesh(part(cells));
      expect(edgeProblems(m)).toEqual([]);
      expect(meshShells(m)).toBe(1);
      const st = manifoldStatus(m);
      expect(st.status).toBe('NoError');
      expect(st.shells).toBe(1);
      expect(liveManifoldCount()).toBe(0);
    });
  }
});

describe('wheel volumes match the analytic disc minus bores within 1% (index mark excluded)', () => {
  for (const r of RADII)
    for (const kind of ['pinHole', 'axleHole'] as Kind[]) {
      const analytic = rimDiscVolume(r) - boreVol(kind);
      it(`${kind} hub r ${r}: ${analytic.toFixed(4)}`, () => {
        const v = partSolidStats(part([hub(r, kind)]), { marks: false }).volume;
        expect(Math.abs(v / analytic - 1)).toBeLessThan(0.01);
      });
    }
  it('crank hole at (1,1) of an r 2.5 wheel: disc minus two bores; genus 2', () => {
    const st = partSolidStats(part([hub(2.5), c(1, 1, 0, 'pinHole', 2)]), { marks: false });
    const analytic = rimDiscVolume(2.5) - 2 * boreVol('pinHole');
    expect(Math.abs(st.volume / analytic - 1)).toBeLessThan(0.01);
    expect(st.genus).toBe(2);
  });
  it('single hub has genus 1 (its bore) with and without the mark', () => {
    expect(partSolidStats(part([hub(2)])).genus).toBe(1);
    expect(partSolidStats(part([hub(2)]), { marks: false }).genus).toBe(1);
  });
  it('the mark removes a small, positive volume close to its grooves’ box volume', () => {
    for (const r of [1, 2.5, 4]) {
      const v0 = partSolidStats(part([hub(r)]), { marks: false }).volume;
      const v1 = partSolidStats(part([hub(r)])).volume;
      const R = r - RIM_INSET;
      // two face grooves (radial MARK_R0 → R) + the tread groove (full thickness), ignoring the chamfer
      const est = 2 * MARK_W * MARK_D * (R - MARK_R0) + MARK_W * MARK_D * (2 * H - 2 * MARK_D);
      expect(v0 - v1).toBeGreaterThan(0.7 * est);
      expect(v0 - v1).toBeLessThan(1.3 * est);
      expect((v0 - v1) / v0).toBeLessThan(0.01);
    }
  });
  it('rims use ≥ 64 segments from r 2 (≥ 48 below)', () => {
    expect(rimSegments(1.5)).toBeGreaterThanOrEqual(48);
    for (const r of [2, 2.5, 3, 3.5, 4]) expect(rimSegments(r)).toBeGreaterThanOrEqual(64);
  });
});

describe('extent and frame', () => {
  it('a wheel spans r − 0.03 in its plane and ±H along its axis; the frame origin stays the min cell', () => {
    for (const a of [0, 1, 2] as Axis[]) {
      const m = buildPartMesh(part([hub(2.5, 'pinHole', a, [3, 4, 5])]));
      expect(m.origin).toEqual([3, 4, 5]);
      const { pos } = weld(m);
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(...pos.map((p) => p[k]!));
        const hi = Math.max(...pos.map((p) => p[k]!));
        const want = k === a ? H : 2.5 - RIM_INSET;
        // in-plane: a polygon (vertices on the axes) whose +t vertex the index mark's tread groove cuts away
        const tol = k === a ? 1e-6 : 0.005;
        expect(hi).toBeLessThanOrEqual(want + 1e-6);
        expect(hi).toBeGreaterThan(want - tol);
        expect(lo).toBeGreaterThanOrEqual(-want - 1e-6);
        expect(lo).toBeLessThan(-want + tol);
      }
    }
  });
});

describe('index mark (§4.2)', () => {
  /** Triangles whose three vertices satisfy `pred` (on the output mesh), with their patch ids. */
  function trisWhere(m: MeshData, pred: (p: number[]) => boolean): number[] {
    const out: number[] = [];
    for (let t = 0; t < m.indices.length; t += 3) {
      const vs = [0, 1, 2].map((k) => {
        const i = m.indices[t + k]!;
        return [m.positions[3 * i]!, m.positions[3 * i + 1]!, m.positions[3 * i + 2]!];
      });
      if (vs.every(pred)) out.push(t / 3);
    }
    return out;
  }
  const f32 = (x: number) => Math.fround(x);

  for (const a of [0, 1, 2] as Axis[]) {
    it(`axis ${a}: grooves on both faces and across the tread along +${'XYZ'[(a + 1) % 3]}, each its own smooth patch (so outlined)`, () => {
      const r = 2;
      const p = part([hub(r, 'pinHole', a)]);
      const m = buildPartMesh(p);
      const { patch } = vertexPatches(m.positions.length / 3, m.indices);
      const t = (a + 1) % 3;
      const R = r - RIM_INSET;
      const patchOf = (tri: number) => patch[m.indices[3 * tri]!]!;
      for (const side of [1, -1]) {
        const floor = trisWhere(m, (q) => q[a] === f32(side * (H - MARK_D)));
        const face = trisWhere(m, (q) => q[a] === f32(side * H));
        expect(floor.length, `groove floor side ${side}`).toBeGreaterThan(0);
        expect(face.length).toBeGreaterThan(0);
        // the floor lies along the mark direction, within the groove width
        for (const tri of floor) {
          for (let k = 0; k < 3; k++) {
            const i = m.indices[3 * tri + k]!;
            const q = [m.positions[3 * i]!, m.positions[3 * i + 1]!, m.positions[3 * i + 2]!];
            expect(q[t]!).toBeGreaterThanOrEqual(MARK_R0 - 1e-6);
            expect(Math.abs(q[3 - a - t]!)).toBeLessThanOrEqual(MARK_W / 2 + 1e-6);
          }
        }
        const floorPatches = new Set(floor.map(patchOf));
        const facePatches = new Set(face.map(patchOf));
        for (const fp of floorPatches) expect(facePatches.has(fp)).toBe(false);
      }
      // tread groove floor: a flat at radial distance R − MARK_D along +t
      const tread = trisWhere(m, (q) => q[t] === f32(R - MARK_D));
      expect(tread.length).toBeGreaterThan(0);
      const mk = rimMarks(p)[0]!;
      const want = [0, 0, 0];
      want[t] = 1;
      expect(mk.dir).toEqual(want);
      expect(mk.tread).toBe(true);
      expect(mk.r1).toBeCloseTo(R, 12);
    });
  }
  it('the tread groove is skipped where the part continues past the rim edge along the mark', () => {
    const p = part(Array.from({ length: 5 }, (_, i) => c(i - 2, 0, 0, 'pinHole', 2, i === 2 ? 1.5 : undefined)));
    expect(rimMarks(p)[0]!.tread).toBe(false);
    const q = part([hub(1.5), c(0, 1, 0, 'pinHole', 2), c(0, 2, 0, 'pinHole', 2)]); // beam along Y; mark is along +X
    expect(rimMarks(q)[0]!.tread).toBe(true);
  });
});

describe('cache and colliders', () => {
  it('the mesh cache signature includes rims', () => {
    clearMeshCache();
    const a = buildPartMesh(part([c(0, 0, 0, 'pinHole', 2)]));
    const b = buildPartMesh(part([hub(1)]));
    const b2 = buildPartMesh(part([hub(1.5)]));
    expect(a.positions).not.toBe(b.positions);
    expect(b.positions).not.toBe(b2.positions);
    expect(partSignature(part([c(0, 0, 0, 'pinHole', 2)]))).toBe('0,0,0,pinHole,2');
    expect(partSignature(part([hub(1.5)]))).toBe('0,0,0,pinHole,2,r1.5');
    expect(buildPartMesh(part([hub(1.5, 'pinHole', 2, [7, 8, 9])])).positions).toBe(b2.positions);
  });
  it('a rim adds one disc primitive (r − 0.04, half-length HC) after the hub’s own primitives', () => {
    const bare = partColliders(part([c(5, 5, 5, 'pinHole', 0), c(6, 5, 5, 'pinHole', 0)]));
    const ps = partColliders(part([c(5, 5, 5, 'pinHole', 0, 2.5), c(6, 5, 5, 'pinHole', 0)]));
    const discs = ps.filter((q): q is Extract<ColliderPrim, { shape: 'disc' }> => q.shape === 'disc');
    expect(ps.filter((q) => q.shape !== 'disc')).toEqual(bare);
    expect(discs).toEqual([{ shape: 'disc', center: [0, 0, 0], axis: 0, radius: 2.5 - (0.5 - HC), halfLength: HC, innerRadius: HC, cell: 0, male: false }]);
    expect(discs[0]!.radius).toBeCloseTo(2.46, 12);
  });
});

describe('cost', () => {
  it('reports the build time of r 1, 2.5 and 4 wheel solids (uncached)', () => {
    for (const r of [1, 2.5, 4]) {
      const p = part([hub(r)]);
      buildPartMesh(p); // warm
      clearMeshCache();
      const t0 = performance.now();
      const n = 5;
      for (let i = 0; i < n; i++) {
        clearMeshCache();
        buildPartMesh(p);
      }
      const ms = (performance.now() - t0) / n;
      const m = buildPartMesh(p);
      console.log(`geometry: r ${r} wheel ${m.indices.length / 3} triangles, ${ms.toFixed(1)} ms per uncached build`);
      expect(ms).toBeLessThan(500);
    }
  });
});

describe('random wheel parts', () => {
  const SEEDS = Number(process.env.WHEEL_FUZZ_SEEDS ?? 200);
  it(`${SEEDS} random valid parts with 1–2 random rims: sound solids and meshes`, () => {
    clearMeshCache();
    const failures: string[] = [];
    const pinched: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const base = randomPart(1000 + seed, 2 + (seed % 9));
      let model = { ...emptyModel(), parts: [base], nextPartId: base.id + 1 } as Model;
      const holes = base.cells.filter((q) => isHole(q.kind));
      if (!holes.length) continue;
      const nr = 1 + (seed % 2);
      for (let k = 0; k < nr; k++) {
        const h = holes[(seed * 7 + k * 3) % holes.length]!;
        const r = RADII[(seed * 5 + k) % RADII.length]!;
        model = setRim(model, base.id, [h.x, h.y, h.z], r);
      }
      const p = model.parts[0]!;
      try {
        const m = buildPartMesh(p);
        const raw = partSolidStats(p);
        const slow = partSolidStats(p, { fast: false });
        if (raw.status !== 'NoError') failures.push(`seed ${seed}: status ${raw.status}`);
        if (Math.abs(slow.volume - raw.volume) > 1e-4 * raw.volume) failures.push(`seed ${seed}: fast/3D volume ${raw.volume} vs ${slow.volume}`);
        if (Math.abs(meshVolume(m) - raw.volume) > 1e-4 * raw.volume) failures.push(`seed ${seed}: mesh volume`);
        const shells = meshShells(m);
        if (shells !== 1) failures.push(`seed ${seed}: ${shells} shells`);
        const probs = edgeProblems(m);
        if (probs.length) pinched.push(`seed ${seed}: ${probs[0]}`);
        if (partColliders(p).filter((q) => q.shape === 'disc').length !== p.cells.filter((q) => q.rim !== undefined).length) failures.push(`seed ${seed}: discs`);
      } catch (e) {
        failures.push(`seed ${seed}: threw ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
    expect(liveManifoldCount()).toBe(0);
    if (pinched.length) console.log(`wheel fuzz: ${pinched.length}/${SEEDS} with pinched edges\n  ${pinched.join('\n  ')}`);
    expect(pinched.length).toBeLessThanOrEqual(Math.ceil(SEEDS * 0.01));
  }, 600000);
});
