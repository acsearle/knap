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
  R_ROD,
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
import { addPart, discOverlapsCell, emptyModel, isHole, makeCell, setRim, validateModel } from '../../src/core';
import type { Axis, Cell, Kind, Model } from '../../src/core';
import { vertexPatches } from '../../src/view/patches';
import { crossArea, edgeProblems, insideMesh, meshShells, meshVolume, part, randomPart, weld } from './helpers';

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

// ---------------------------------------------------------------------------------------------
// Crank cells at the rim's edge (§2.6 rule 1, §4.2): every cell the nominal disc overlaps belongs to
// the wheel, so the part must be drawn as one closed shell, the web staying inside the nominal
// disc ∪ the crank cell's own cube.
describe('crank cells at the rim edge are drawn joined to the wheel', () => {
  type V3 = [number, number, number];
  const at = (axis: Axis, du: number, dv: number, base: V3 = [0, 0, 0]): V3 => {
    const p: V3 = [...base];
    p[(axis + 1) % 3]! += du;
    p[(axis + 2) % 3]! += dv;
    return p;
  };
  const isValid = (cells: Cell[]): boolean => {
    try {
      return validateModel(addPart(emptyModel(), cells).model).length === 0;
    } catch {
      return false;
    }
  };
  const volOf = new Map<string, number>();
  const lone = (k: Cell): number => {
    const key = `${k.kind},${k.axis},${k.rim}`;
    let v = volOf.get(key);
    if (v === undefined) volOf.set(key, (v = meshVolume(buildPartMesh(part([{ ...k, x: 0, y: 0, z: 0 }])))));
    return v;
  };
  const radial = (w: Cell, q: readonly number[]): { ax: number; rad: number } => {
    const rel = [q[0]! - w.x, q[1]! - w.y, q[2]! - w.z];
    let r2 = 0;
    for (let j = 0; j < 3; j++) if (j !== w.axis) r2 += rel[j]! ** 2;
    return { ax: rel[w.axis]!, rad: Math.sqrt(r2) };
  };
  /** Every vertex lies in an own cell's cube (±(½ + EPS)) or in the hub layer inside a nominal disc. */
  const strayVertices = (m: MeshData, cells: Cell[]): number => {
    const hubs = cells.filter((q) => q.rim !== undefined);
    let n = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      const q = [m.positions[i]! + m.origin[0], m.positions[i + 1]! + m.origin[1], m.positions[i + 2]! + m.origin[2]];
      const tol = 0.505 + 1e-4;
      if (cells.some((k) => Math.abs(q[0]! - k.x) <= tol && Math.abs(q[1]! - k.y) <= tol && Math.abs(q[2]! - k.z) <= tol)) continue;
      if (hubs.some((w) => { const { ax, rad } = radial(w, q); return Math.abs(ax) <= H + 1e-4 && rad <= w.rim! + 1e-4; })) continue;
      n++;
    }
    return n;
  };
  /** Mesh checks shared by the sweeps; returns failure strings (empty = sound). */
  const check = (label: string, cells: Cell[]): string[] => {
    const m = buildPartMesh(part(cells));
    const f: string[] = [];
    const shells = meshShells(m);
    if (shells !== 1) f.push(`${label}: ${shells} shells`);
    const ep = edgeProblems(m);
    if (ep.length) f.push(`${label}: not a closed manifold (${ep[0]})`);
    const hubs = cells.filter((q) => q.rim !== undefined);
    const rest = cells.filter((q) => q.rim === undefined);
    // Volume: no less than the largest wheel less the crank holes' bores; no more than every wheel and
    // every cell alone plus, per crank cell, a web within its cube and the 0.03 band of the disc.
    const v = meshVolume(m);
    // (a bore in the wheel's plane runs the cell's full length 1 + 4·EPS through the rim, not 2H)
    const bores = rest.filter((q) => isHole(q.kind)).length * Math.PI * R_BORE ** 2 * 1.02 * 1.01;
    const lo = Math.max(...hubs.map(lone)) - bores - 1e-6;
    const hi = hubs.reduce((a, w) => a + lone(w), 0) + rest.reduce((a, q) => a + lone(q) + 2 * H * (1 + 2 * Math.PI * 4 * RIM_INSET), 0);
    if (!(v >= lo && v <= hi)) f.push(`${label}: volume ${v.toFixed(4)} outside [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
    const stray = strayVertices(m, cells);
    if (stray) f.push(`${label}: ${stray} vertices outside own cubes ∪ nominal discs`);
    // Bores open along each hole's axis (hub and crank holes), except an in-plane hole whose bore
    // both ends of lie inside a rim: that would be a sealed cavity, so it has none (DEVIATIONS).
    const capped = (q: Cell, s: number): boolean =>
      hubs.some((w) => {
        if (w.axis === q.axis || [q.x, q.y, q.z][w.axis] !== [w.x, w.y, w.z][w.axis]) return false;
        const o = 3 - q.axis - w.axis;
        const u0 = [q.x - w.x, q.y - w.y, q.z - w.z][q.axis]! + s * 0.51;
        const v0 = Math.abs([q.x - w.x, q.y - w.y, q.z - w.z][o]!) + R_BORE;
        return u0 * u0 + v0 * v0 < (w.rim! - RIM_INSET - RIM_CHAMFER) ** 2;
      });
    for (const q of cells) {
      if (!isHole(q.kind) || (capped(q, -1) && capped(q, 1))) continue;
      for (const t of [-0.4, 0, 0.4]) {
        const p = [q.x, q.y, q.z];
        p[q.axis]! += t;
        if (insideMesh(m, p)) f.push(`${label}: bore of (${q.x},${q.y},${q.z}) closed at ${t}`);
      }
    }
    return f;
  };

  const MALES: Kind[] = ['pin', 'axle', 'frictionPin'];
  it('a male crank (pin, axle, friction pin; parallel or either perpendicular axis) at every in-layer position the disc overlaps: pin/axle hub, r 1…4, axis X/Y/Z', () => {
    const fails: string[] = [];
    let n = 0;
    let band = 0;
    for (const hk of ['pinHole', 'axleHole'] as Kind[])
      for (const r of RADII)
        for (const axis of [0, 1, 2] as Axis[])
          for (let du = 0; du <= 4; du++)
            for (let dv = 0; dv <= 4; dv++) {
              if (du === 0 && dv === 0) continue;
              // Z: the whole quadrant (the mark runs along +u); X and Y: the octant dv ≤ du.
              if (axis !== 2 && dv > du) continue;
              const p = at(axis, du, dv);
              if (!discOverlapsCell([0, 0, 0], axis, r, p)) continue;
              for (const k of MALES)
                for (const ka of [0, 1, 2] as Axis[]) {
                  const cells = [hub(r, hk, axis), c(p[0], p[1], p[2], k, ka)];
                  if (!isValid(cells)) continue;
                  n++;
                  if (Math.hypot(du, dv) - R_ROD > r - RIM_INSET - 0.1) band++;
                  fails.push(...check(`${hk} r ${r} axis ${axis} (${du},${dv}) ${k}/${'XYZ'[ka]}`, cells));
                }
            }
    expect(fails.slice(0, 20)).toEqual([]);
    expect(liveManifoldCount()).toBe(0);
    console.log(`male crank sweep: ${n} solids, ${band} with a parallel rod's circle beyond the drawn rim's reach`);
    expect(n).toBeGreaterThan(2000);
    expect(band).toBeGreaterThan(100);
  }, 600000);

  it('a hole crank (pin or axle hole, parallel or perpendicular) at every in-layer position the disc overlaps: pin/axle hub, r 1…4, axis Z', () => {
    const fails: string[] = [];
    let n = 0;
    for (const hk of ['pinHole', 'axleHole'] as Kind[])
      for (const r of RADII)
        for (let du = 0; du <= 4; du++)
          for (let dv = 0; dv <= 4; dv++) {
            if (du === 0 && dv === 0) continue;
            const p = at(2, du, dv);
            if (!discOverlapsCell([0, 0, 0], 2, r, p)) continue;
            for (const [k, ka] of [['pinHole', 2], ['axleHole', 2], ['pinHole', 0], ['axleHole', 1]] as [Kind, Axis][]) {
              const cells = [hub(r, hk, 2), c(p[0], p[1], p[2], k, ka)];
              if (!isValid(cells)) continue;
              n++;
              fails.push(...check(`${hk} r ${r} (${du},${dv}) ${k}/${'XYZ'[ka]}`, cells));
            }
          }
    expect(fails.slice(0, 20)).toEqual([]);
    expect(n).toBeGreaterThan(300);
  }, 600000);

  it('several crank cells at once, and cranks shared by two wheels of a part', () => {
    const fails: string[] = [];
    let n = 0;
    const run = (label: string, cells: Cell[]): void => {
      expect(isValid(cells), label).toBe(true);
      n++;
      fails.push(...check(label, cells));
    };
    const eight = (a: number, b: number): [number, number][] => [[a, b], [b, a], [-a, b], [-b, a], [a, -b], [b, -a], [-a, -b], [-b, -a]];
    for (const axis of [0, 1, 2] as Axis[]) {
      const u = ((axis + 1) % 3) as Axis;
      const P = (du: number, dv: number, k: Kind, a: Axis = axis, rim?: number): Cell => {
        const p = at(axis, du, dv);
        return c(p[0], p[1], p[2], k, a, rim);
      };
      const W = (r: number, k: Kind = 'pinHole'): Cell => hub(r, k, axis);
      run(`axis ${axis}: r 3, eight pins at (±2,±3)/(±3,±2)`, [W(3), ...eight(2, 3).map(([a, b]) => P(a, b, 'pin'))]);
      run(`axis ${axis}: r 4, eight perpendicular axles at (±2,±4)/(±4,±2)`, [W(4, 'axleHole'), ...eight(2, 4).map(([a, b]) => P(a, b, 'axle', u))]);
      run(`axis ${axis}: r 1, pins, axles, holes at the four corners`, [W(1), P(1, 1, 'pin'), P(-1, 1, 'axle'), P(1, -1, 'pinHole'), P(-1, -1, 'frictionPin', u)]);
      run(`axis ${axis}: r 2.5, crank pin (2,2) with a crank hole beside it at (1,2)`, [W(2.5), P(2, 2, 'pin'), P(1, 2, 'pinHole')]);
      run(`axis ${axis}: r 3, pin at (2,3) between own holes (1,3) and (2,2)`, [W(3), P(2, 3, 'pin'), P(1, 3, 'pinHole'), P(2, 2, 'pinHole')]);
      run(`axis ${axis}: r 3, axle at (2,3) continuing outward as a 3-long axle`, [W(3), P(2, 3, 'axle', u), P(3, 3, 'axle', u), P(4, 3, 'axle', u)]);
      run(`axis ${axis}: two r 3 wheels 5 apart sharing crank pins (2,3), (3,3)`, [W(3), P(5, 0, 'pinHole', axis, 3), P(2, 3, 'pin'), P(3, 3, 'axle'), P(-2, -3, 'frictionPin')]);
      run(`axis ${axis}: r 3 + r 2 overlapping, pins at (2,3) and (5,2)`, [W(3), P(4, 0, 'pinHole', axis, 2), P(2, 3, 'pin'), P(5, 2, 'pin')]);
      // The natural build of the review finding: a 2-long crank pin, in the wheel's layer and out of its face.
      const p0 = at(axis, 2, 2);
      const p1: V3 = [...p0];
      p1[axis] += 1;
      run(`axis ${axis}: r 2.5, 2-long crank pin at (2,2) out of the face`, [W(2.5), c(p0[0], p0[1], p0[2], 'pin', axis), c(p1[0], p1[1], p1[2], 'pin', axis)]);
    }
    expect(fails).toEqual([]);
    expect(n).toBe(27);
    expect(liveManifoldCount()).toBe(0);
  }, 120000);

  it('the review case (r 2.5 pin-hole hub, pins at (2,2,0) and (2,2,1), axis Z) is one shell: the boss fills the 0.063 gap', () => {
    const cells = [hub(2.5), c(2, 2, 0, 'pin', 2), c(2, 2, 1, 'pin', 2)];
    const m = buildPartMesh(part(cells));
    expect(meshShells(m)).toBe(1);
    expect(edgeProblems(m)).toEqual([]);
    // Solid along the line hub → pin through the old gap (rod surface at 2.828 − 0.295 = 2.533, rim at 2.47).
    for (const d of [2.45, 2.5, 2.53]) expect(insideMesh(m, [d / Math.SQRT2, d / Math.SQRT2, 0]), `at ${d}`).toBe(true);
    // A boss round the rod (radius 0.36), not a sliver: solid all round the rod at radius 0.33 mid-layer…
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI;
      expect(insideMesh(m, [2 + 0.33 * Math.cos(a), 2 + 0.33 * Math.sin(a), 0]), `boss at ${i}`).toBe(true);
    }
    // …and the web joins the rim over its full width: across the line at radius 2.5, ±0.3.
    for (const t of [-0.3, -0.15, 0, 0.15, 0.3]) {
      const q = [2.5 / Math.SQRT2 - t / Math.SQRT2, 2.5 / Math.SQRT2 + t / Math.SQRT2, 0];
      expect(insideMesh(m, q), `joint at ${t}`).toBe(true);
    }
  });

  it('webs are clipped to the nominal disc ∪ the crank cell: no solid beyond r outside own cubes (mid-plane, 0.02 grid)', () => {
    // r 3 (2,3) is where the unclipped web reached 0.252 beyond r; (1,1) of r 1 and (2,4) of r 4 the next.
    const cases: [number, number, number, Kind, Axis][] = [
      [3, 2, 3, 'pinHole', 2], [3, 2, 3, 'pin', 2], [3, 3, 2, 'axle', 0], [1, 1, 1, 'pinHole', 2], [1, 1, 1, 'pin', 2], [4, 2, 4, 'pinHole', 2], [4, 2, 4, 'frictionPin', 1], [2.5, 2, 2, 'pin', 2],
    ];
    const out: string[] = [];
    for (const [r, du, dv, k, ka] of cases) {
      const cells = [hub(r), c(du, dv, 0, k, ka)];
      const m = buildPartMesh(part(cells));
      let beyond = 0;
      for (let i = -40; i <= 40; i++)
        for (let j = -40; j <= 40; j++) {
          const q = [du + i * 0.02, dv + j * 0.02, 0];
          if (Math.abs(q[0]! - du) <= 0.5 && Math.abs(q[1]! - dv) <= 0.5) continue;
          if (Math.hypot(q[0]!, q[1]!) <= r) continue;
          if (insideMesh(m, q)) beyond++;
        }
      if (beyond) out.push(`r ${r} (${du},${dv}) ${k}: ${beyond} samples beyond r`);
    }
    expect(out).toEqual([]);
  });
});
