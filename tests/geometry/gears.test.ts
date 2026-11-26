// Gears in the render solid (DESIGN.md §2.7, §4.2 "Per gear"): involute spur-gear prisms with the
// world-frame tooth phase, hub/web cells absorbed by the gear body, the face groove and index tooth,
// and the soft tooth-band patch in MeshData.
import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  GEAR_RADII,
  addPart,
  canAddCell,
  discOverlapsCell,
  emptyModel,
  gearPlaneBasis,
  gearTeeth,
  gearToothAngle,
  isWebCell,
  makeCell,
  tipRadius,
  validateModel,
  webOffsets,
} from '../../src/core';
import type { Axis, Cell, Kind, Model, Part } from '../../src/core';
import { buildExample } from '../../src/core/examples';
import {
  GEAR_BACKLASH,
  GEAR_MARK_END,
  H,
  MARK_D,
  MARK_R0,
  MARK_W,
  R_BORE,
  W_BORE,
  buildPartMesh,
  clearMeshCache,
  gearBaseRadius,
  gearIndexes,
  gearOutline,
  gearRootRadius,
  indexToothWeights,
  initGeometry,
  liveManifoldCount,
  partSignature,
  partSolidStats,
  rimMarks,
} from '../../src/geometry';
import type { MeshData } from '../../src/geometry';
import { crossArea, edgeProblems, insideMesh, meshShells, meshVolume, part, randomPart, weld } from './helpers';

let M: ManifoldToplevel;
beforeAll(async () => {
  await initGeometry();
  M = await Module();
  M.setup();
});

const AXES: Axis[] = [0, 1, 2];
const HOLES: Kind[] = ['pinHole', 'axleHole'];
const gear = (x: number, y: number, z: number, kind: Kind, axis: Axis, r: number): Cell => makeCell(x, y, z, kind, axis, r, true);
const cl = (x: number, y: number, z: number, kind: Kind, axis: Axis, rim?: number): Cell => makeCell(x, y, z, kind, axis, rim);
/** World position of hub + du·u + dv·v + dw·axis. */
function at(axis: Axis, du: number, dv: number, dw = 0, hub: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const [u, v] = gearPlaneBasis(axis);
  const p: [number, number, number] = [...hub];
  p[u] += du;
  p[v] += dv;
  p[axis] += dw;
  return p;
}
const cellAt = (axis: Axis, du: number, dv: number, dw: number, kind: Kind, rim?: number, teeth = false): Cell => {
  const [x, y, z] = at(axis, du, dv, dw);
  return teeth ? gear(x, y, z, kind, axis, rim!) : cl(x, y, z, kind, axis, rim);
};

function toManifold(m: MeshData): Manifold {
  const { pos, tri } = weld(m);
  const P = new Float32Array(pos.length * 3);
  pos.forEach((p, i) => {
    P[3 * i] = p[0]! + m.origin[0];
    P[3 * i + 1] = p[1]! + m.origin[1];
    P[3 * i + 2] = p[2]! + m.origin[2];
  });
  return new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: P, triVerts: new Uint32Array(tri) }));
}
function manifoldStatus(m: MeshData): { status: string; genus: number; volume: number; shells: number } {
  const mf = toManifold(m);
  const parts = mf.decompose();
  const r = { status: mf.status(), genus: mf.genus(), volume: mf.volume(), shells: parts.length };
  for (const q of parts) q.delete();
  mf.delete();
  return r;
}
/** Volume of the intersection of two parts' meshes (world frame). */
function intersectionVolume(a: MeshData, b: MeshData): number {
  const A = toManifold(a);
  const B = toManifold(b);
  const I = A.intersect(B);
  const v = I.volume();
  for (const m of [A, B, I]) m.delete();
  return v;
}
function expectClosedOneShell(m: MeshData, label: string): { genus: number; volume: number } {
  expect(edgeProblems(m), label).toEqual([]);
  expect(meshShells(m), label).toBe(1);
  const st = manifoldStatus(m);
  expect(st.status, label).toBe('NoError');
  expect(st.shells, label).toBe(1);
  return st;
}
const fresh = (p: Part): MeshData => {
  clearMeshCache();
  return buildPartMesh(p);
};
function valid(parts: Cell[][]): Model {
  let m = emptyModel();
  for (const cells of parts) m = addPart(m, cells).model;
  return m;
}

// ---- the analytic tooth profile (continuous flanks, true arcs; independent of the polygon) ----
/** Half-angle of the tooth at radius ρ (§4.2): involute above the base circle, parallel flank below. */
function halfAngle(r: number, rho: number): number {
  const T = gearTeeth(r);
  const a = (20 * Math.PI) / 180;
  const rb = gearBaseRadius(r);
  const inv = (x: number) => Math.tan(x) - x;
  const halfP = (Math.PI / 16 - GEAR_BACKLASH / 2) / (2 * r);
  const f = (p: number) => halfP + inv(a) - inv(Math.acos(rb / Math.max(p, rb)));
  if (rho >= rb) return f(rho);
  return Math.min((f(rb) * rb) / rho, Math.PI / T - 0.02);
}
/** Area of the gear outline: root disc + T teeth, each ∫ 2·h(ρ)·ρ dρ from root to tip (Simpson). */
function profileArea(r: number): number {
  const T = gearTeeth(r);
  const rf = gearRootRadius(r);
  const ra = tipRadius(r);
  const n = 4000;
  const dr = (ra - rf) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const rho = rf + i * dr;
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    s += w * 2 * halfAngle(r, rho) * rho;
  }
  return Math.PI * rf * rf + T * (s * dr) / 3;
}
const boreArea = (k: Kind) => (k === 'pinHole' ? Math.PI * R_BORE ** 2 : crossArea(W_BORE, R_BORE));
const grooveVol = (r: number) => (r >= 1 ? 2 * MARK_W * MARK_D * (gearRootRadius(r) - GEAR_MARK_END - MARK_R0) : 0);

// ---- mesh helpers ----
/** In-plane (u, v) and axial coordinates of vertex i relative to a hub (world frame). */
function uvw(m: MeshData, i: number, axis: Axis, hub: readonly number[]): [number, number, number] {
  const [u, v] = gearPlaneBasis(axis);
  const p = [m.positions[3 * i]! + m.origin[0] - hub[0]!, m.positions[3 * i + 1]! + m.origin[1] - hub[1]!, m.positions[3 * i + 2]! + m.origin[2] - hub[2]!];
  return [p[u]!, p[v]!, p[axis]!];
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Section of a prism mesh by the plane axial = hub's: segments [u0, v0, u1, v1] about the hub. */
function section(m: MeshData, axis: Axis, hub: readonly number[]): number[][] {
  const out: number[][] = [];
  const I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const q = [0, 1, 2].map((k) => uvw(m, I[t + k]!, axis, hub));
    const pts: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = q[k]!, b = q[(k + 1) % 3]!;
      if (a[2] < 0 !== b[2] < 0) {
        const s = a[2] / (a[2] - b[2]);
        pts.push(a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]));
      }
    }
    if (pts.length === 4) out.push(pts);
  }
  return out;
}
function rot(seg: number[], ang: number, du: number, dv: number): number[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [c * seg[0]! - s * seg[1]! + du, s * seg[0]! + c * seg[1]! + dv, c * seg[2]! - s * seg[3]! + du, s * seg[2]! + c * seg[3]! + dv];
}
function ptSeg(px: number, py: number, s: number[]): number {
  const ux = s[2]! - s[0]!, uy = s[3]! - s[1]!;
  const t = Math.max(0, Math.min(1, ((px - s[0]!) * ux + (py - s[1]!) * uy) / (ux * ux + uy * uy || 1)));
  return Math.hypot(px - s[0]! - t * ux, py - s[1]! - t * uy);
}
function crosses(a: number[], b: number[]): boolean {
  const o = (p: number[], i: number, q: number[], j: number, r: number[], k: number) =>
    Math.sign((q[j]! - p[i]!) * (r[k + 1]! - p[i + 1]!) - (q[j + 1]! - p[i + 1]!) * (r[k]! - p[i]!));
  return o(a, 0, a, 2, b, 0) !== o(a, 0, a, 2, b, 2) && o(b, 0, b, 2, a, 0) !== o(b, 0, b, 2, a, 2);
}
/** Signed clearance between two segment sets: −1 if any pair crosses, else the least distance. */
function clearance(A: number[][], B: number[][]): number {
  let best = Infinity;
  for (const a of A)
    for (const b of B) {
      if (crosses(a, b)) return -1;
      best = Math.min(best, ptSeg(a[0]!, a[1]!, b), ptSeg(a[2]!, a[3]!, b), ptSeg(b[0]!, b[1]!, a), ptSeg(b[2]!, b[3]!, a));
    }
  return best;
}

function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 16777619) >>> 0;
  return h;
}

// ------------------------------------------------------------------------------------------

describe('meshes without gears are unchanged', () => {
  it('existing examples, random parts and wheels hash exactly as before gears (commit 2d3372a)', () => {
    clearMeshCache();
    const names = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision', 'crank-wheel', 'cart'];
    const parts: Part[] = [];
    for (const n of names) parts.push(...buildExample(n).parts);
    for (let s = 1; s <= 30; s++) parts.push(randomPart(s, 8));
    for (const r of [1, 1.5, 2, 2.5, 3]) for (const a of AXES) for (const k of HOLES) parts.push(part([cl(0, 0, 0, k, a, r), cl(1, 0, 0, 'pinHole', a)]));
    let h = 2166136261;
    let sig = 2166136261;
    for (const p of parts) {
      const m = buildPartMesh(p);
      expect(Object.keys(m).sort()).toEqual(['indices', 'normals', 'origin', 'positions']);
      h = fnv(h, new Uint8Array(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength));
      h = fnv(h, new Uint8Array(m.normals.buffer, m.normals.byteOffset, m.normals.byteLength));
      h = fnv(h, new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength));
      sig = fnv(sig, new TextEncoder().encode(partSignature(p)));
    }
    // Recorded at commit 2d3372a (before the gear solid) by the same loop.
    expect(parts.length).toBe(120);
    expect(h.toString(16)).toBe('f189d069');
    expect(sig.toString(16)).toBe('96ac5a7e');
  }, 120000);

  it('the signature tells a gear from a plain rim of the same radius', () => {
    expect(partSignature(part([cl(0, 0, 0, 'axleHole', 2, 1)]))).toBe('0,0,0,axleHole,2,r1');
    expect(partSignature(part([gear(0, 0, 0, 'axleHole', 2, 1)]))).toBe('0,0,0,axleHole,2,r1,t');
  });
});

describe('outline', () => {
  it('16 points per tooth, radii between root and tip, CCW, tooth k centred at (k + ¼)·2π/T', () => {
    for (const r of GEAR_RADII) {
      const T = gearTeeth(r);
      const pts = gearOutline(r);
      expect(pts.length).toBe(16 * T);
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!;
        area += x0 * y1 - x1 * y0;
        const rho = Math.hypot(x0, y0);
        expect(rho).toBeGreaterThanOrEqual(gearRootRadius(r) - 1e-12);
        expect(rho).toBeLessThanOrEqual(tipRadius(r) + 1e-12);
      }
      expect(area).toBeGreaterThan(0);
      // Tip land middle point of tooth k is point 16k + 7, exactly on the tooth centre line.
      for (const k of [0, 1, T - 1]) {
        const [x, y] = pts[16 * k + 7]!;
        expect(Math.hypot(x, y)).toBeCloseTo(tipRadius(r), 12);
        expect(wrap(Math.atan2(y, x) - gearToothAngle(T, k))).toBeCloseTo(0, 12);
      }
      // Tooth thickness on the pitch circle: π/16 − 0.025 (arc), from the analytic half angle.
      expect(2 * halfAngle(r, r) * r).toBeCloseTo(Math.PI / 16 - 0.025, 12);
    }
  });
});

describe('gear solid', () => {
  const TRI: Record<string, number[]> = { pinHole: [704, 1120, 1568, 2464], axleHole: [672, 1088, 1536, 2432] };

  it('single gear: closed one-shell genus-1 manifold for every size × hub kind × axis; volume within 1% of the analytic profile; triangle counts', () => {
    for (const r of GEAR_RADII)
      for (const k of HOLES)
        for (const a of AXES) {
          const label = `r ${r} ${k} axis ${a}`;
          const m = fresh(part([gear(0, 0, 0, k, a, r)]));
          const st = expectClosedOneShell(m, label);
          expect(st.genus, label).toBe(1);
          const want = 2 * H * (profileArea(r) - boreArea(k)) - grooveVol(r);
          expect(Math.abs(meshVolume(m) / want - 1), label).toBeLessThan(0.01);
          expect(m.indices.length / 3, label).toBe(TRI[k]![GEAR_RADII.indexOf(r)]);
        }
  });

  it('volume error against the analytic profile is small (report)', () => {
    const rows: string[] = [];
    for (const r of GEAR_RADII) {
      const m = fresh(part([gear(0, 0, 0, 'axleHole', 2, r)]));
      const want = 2 * H * (profileArea(r) - boreArea('axleHole')) - grooveVol(r);
      const err = meshVolume(m) / want - 1;
      rows.push(`r ${r}: mesh ${meshVolume(m).toFixed(5)} analytic ${want.toFixed(5)} rel ${(err * 100).toFixed(3)}%`);
      expect(Math.abs(err)).toBeLessThan(0.003);
    }
    console.log('[gears] volume vs analytic profile\n  ' + rows.join('\n  '));
  });

  it('teeth: T radial maxima on the face outline, each centred at gearToothAngle(T, k) from +u toward +v, for X, Y and Z', () => {
    for (const r of GEAR_RADII)
      for (const a of AXES) {
        const T = gearTeeth(r);
        const label = `r ${r} axis ${a}`;
        const hub = at(a, 3, -2, 5);
        const m = buildPartMesh(part([gear(hub[0], hub[1], hub[2], 'axleHole', a, r)]));
        // Outline vertices on the +H face beyond the root circle, sorted by angle.
        const pts: [number, number][] = [];
        for (let i = 0; i < m.positions.length / 3; i++) {
          const [pu, pv, pw] = uvw(m, i, a, hub);
          const rho = Math.hypot(pu, pv);
          if (Math.abs(pw - H) < 1e-5 && rho > gearRootRadius(r) - 1e-4) pts.push([Math.atan2(pv, pu), rho]);
        }
        pts.sort((p, q) => p[0] - q[0]);
        // Dedupe equal angles (split vertices), then count runs above the pitch circle (circular).
        const seq: [number, number][] = [];
        for (const p of pts) if (!seq.length || Math.abs(p[0] - seq[seq.length - 1]![0]) > 1e-6) seq.push(p);
        let start = seq.findIndex((p) => p[1] < r);
        const runs: number[][] = [];
        let cur: number[] | null = null;
        for (let j = 0; j < seq.length; j++) {
          const p = seq[(start + j) % seq.length]!;
          if (p[1] > r) (cur ??= []).push(p[0]);
          else if (cur) {
            runs.push(cur);
            cur = null;
          }
        }
        if (cur) runs.push(cur);
        expect(runs.length, label).toBe(T);
        // Centre of each tooth = the tip vertex at the largest radius… use the mean of the run's
        // first and last angle (symmetric flanks), unwrapped.
        const centres = runs.map((run) => {
          const a0 = run[0]!;
          const a1 = a0 + wrap(run[run.length - 1]! - a0);
          return wrap((a0 + a1) / 2);
        });
        const pitch = (2 * Math.PI) / T;
        for (const c of centres) {
          const k = Math.round(c / pitch - 0.25);
          expect(Math.abs(wrap(c - gearToothAngle(T, k))), label).toBeLessThan(1e-5);
        }
        // Tooth 0 (the index tooth) sits a quarter pitch from +u toward +v, not toward −v.
        expect(centres.some((c) => Math.abs(c - Math.PI / (2 * T)) < 1e-5), label).toBe(true);
        expect(centres.some((c) => Math.abs(c + Math.PI / (2 * T)) < 1e-3), label).toBe(false);
        start = 0;
      }
  });

  it('bores are open through the gear; the body around them is solid', () => {
    for (const r of GEAR_RADII)
      for (const k of HOLES)
        for (const a of AXES) {
          const label = `r ${r} ${k} axis ${a}`;
          const m = buildPartMesh(part([gear(0, 0, 0, k, a, r)]));
          for (const w of [-0.6, -0.45, -0.2, 0, 0.2, 0.45, 0.6]) expect(insideMesh(m, at(a, 0.013, 0.021, w)), `${label} bore at ${w}`).toBe(false);
          // In the body just inside the root circle, between groove and teeth, off the groove line.
          const rr = gearRootRadius(r) - 0.02;
          expect(insideMesh(m, at(a, rr * Math.cos(2), rr * Math.sin(2), 0.1)), label).toBe(true);
          // Half way along a tooth (tooth 0), and in the gap beside it.
          const T = gearTeeth(r);
          const tc = gearToothAngle(T, 0);
          expect(insideMesh(m, at(a, r * Math.cos(tc), r * Math.sin(tc), 0)), `${label} tooth`).toBe(true);
          const gc = tc + Math.PI / T;
          expect(insideMesh(m, at(a, r * Math.cos(gc), r * Math.sin(gc), 0)), `${label} gap`).toBe(false);
        }
  });

  it('build time per gear (fresh, cache cleared; report)', () => {
    const rows: string[] = [];
    for (const r of GEAR_RADII) {
      const p = part([gear(0, 0, 0, 'axleHole', 2, r)]);
      fresh(p);
      const n = 8;
      const ts: number[] = [];
      for (let i = 0; i < n; i++) {
        clearMeshCache();
        const t0 = performance.now();
        buildPartMesh(p);
        ts.push(performance.now() - t0);
      }
      ts.sort((x, y) => x - y);
      rows.push(`${gearTeeth(r)} teeth: median ${ts[n >> 1]!.toFixed(1)} ms, min ${ts[0]!.toFixed(1)}, max ${ts[n - 1]!.toFixed(1)}`);
    }
    // Wheel of r 2.5 for comparison.
    const w = part([cl(0, 0, 0, 'axleHole', 2, 2.5)]);
    const ts: number[] = [];
    for (let i = 0; i < 8; i++) {
      clearMeshCache();
      const t0 = performance.now();
      buildPartMesh(w);
      ts.push(performance.now() - t0);
    }
    ts.sort((x, y) => x - y);
    rows.push(`plain wheel r 2.5: median ${ts[4]!.toFixed(1)} ms`);
    console.log('[gears] build time\n  ' + rows.join('\n  '));
  });

  it('frees every Manifold it allocates', () => {
    const before = liveManifoldCount();
    fresh(part([gear(0, 0, 0, 'axleHole', 2, 2.5), cl(1, 0, 0, 'pinHole', 2), cl(1, 0, 1, 'pinHole', 2), gear(0, 0, 1, 'pinHole', 2, 0.5)]));
    expect(liveManifoldCount()).toBe(before);
  });
});

describe('hub, axial neighbours and web cells', () => {
  /** Configurations (in gear-plane coordinates du, dv, dw) built for every axis. */
  type Spec = [string, (a: Axis) => Cell[], number?];
  const specs: Spec[] = [];
  for (const r of GEAR_RADII)
    for (const k of HOLES) {
      const hubC = (a: Axis) => cellAt(a, 0, 0, 0, k, r, true);
      specs.push([`r ${r} ${k} + coaxial pin hole on +axis`, (a) => [hubC(a), cellAt(a, 0, 0, 1, 'pinHole')], 1]);
      specs.push([`r ${r} ${k} in a 3-cell tube (axle hole − , pin hole +)`, (a) => [cellAt(a, 0, 0, -1, 'axleHole'), hubC(a), cellAt(a, 0, 0, 1, 'pinHole')], 1]);
      specs.push([`r ${r} ${k} + perpendicular hole on +axis (blind end)`, (a) => [hubC(a), { ...cellAt(a, 0, 0, 1, 'pinHole'), axis: gearPlaneBasis(a)[0] }]]);
      specs.push([
        `r ${r} ${k} + perpendicular hole on +axis carrying a 2-cell pin`,
        (a) => {
          const [u, v] = gearPlaneBasis(a);
          return [hubC(a), { ...cellAt(a, 0, 0, 1, 'pinHole'), axis: u }, { ...cellAt(a, 0, 1, 1, 'pin'), axis: v }, { ...cellAt(a, 0, 2, 1, 'pin'), axis: v }];
        },
      ]);
      specs.push([`r ${r} ${k} + beam in the next layer through the hub`, (a) => [hubC(a), cellAt(a, 0, 0, 1, 'pinHole'), cellAt(a, 1, 0, 1, 'pinHole'), cellAt(a, 2, 0, 1, 'pinHole'), cellAt(a, 3, 0, 1, 'pinHole')], 4]);
    }
  // Web cells.
  specs.push(['24 + crank holes (1,0) pin, (−1,0) axle, (0,1) pin', (a) => [cellAt(a, 0, 0, 0, 'axleHole', 1.5, true), cellAt(a, 1, 0, 0, 'pinHole'), cellAt(a, -1, 0, 0, 'axleHole'), cellAt(a, 0, 1, 0, 'pinHole')], 4]);
  specs.push(['24 + crank pin (1,0) running out of the slab (2 cells)', (a) => [cellAt(a, 0, 0, 0, 'pinHole', 1.5, true), cellAt(a, 1, 0, 0, 'pin'), cellAt(a, 1, 0, 1, 'pin')], 1]);
  specs.push(['24 + crank pin (0,−1), one cell (free both ends)', (a) => [cellAt(a, 0, 0, 0, 'pinHole', 1.5, true), cellAt(a, 0, -1, 0, 'pin')], 1]);
  specs.push(['40 + all 12 web holes', (a) => [cellAt(a, 0, 0, 0, 'axleHole', 2.5, true), ...webOffsets(2.5).map(([du, dv]) => cellAt(a, du, dv, 0, (du + dv) % 2 ? 'axleHole' : 'pinHole'))], 13]);
  specs.push(['40 + web holes (1,0), (1,1), (2,0) with a stacked beam behind (2,0) and the hub', (a) => [cellAt(a, 0, 0, 0, 'axleHole', 2.5, true), cellAt(a, 1, 0, 0, 'pinHole'), cellAt(a, 1, 1, 0, 'pinHole'), cellAt(a, 2, 0, 0, 'pinHole'), cellAt(a, 0, 0, 1, 'pinHole'), cellAt(a, 1, 0, 1, 'pinHole'), cellAt(a, 2, 0, 1, 'pinHole')], 6]); // 4 tunnels + 3 necks between the layers (2 handles)
  specs.push(['40 + crank pins (−2,0), (0,2) and crank hole (1,1)', (a) => [cellAt(a, 0, 0, 0, 'pinHole', 2.5, true), cellAt(a, -2, 0, 0, 'pin'), cellAt(a, 0, 2, 0, 'pin'), cellAt(a, 0, 2, 1, 'pin'), cellAt(a, 1, 1, 0, 'pinHole')], 2]);
  // Compound gears: two gears on one part in different layers.
  specs.push(['compound 40 (layer 0) + 8 (layer 1), coaxial axle holes', (a) => [cellAt(a, 0, 0, 0, 'axleHole', 2.5, true), cellAt(a, 0, 0, 1, 'axleHole', 0.5, true)], 1]);
  specs.push(['compound 8 + 8 stacked', (a) => [cellAt(a, 0, 0, 0, 'axleHole', 0.5, true), cellAt(a, 0, 0, 1, 'pinHole', 0.5, true)], 1]);
  specs.push(['compound 24 + 16 with a tube between (3 layers)', (a) => [cellAt(a, 0, 0, 0, 'axleHole', 1.5, true), cellAt(a, 0, 0, 1, 'pinHole'), cellAt(a, 0, 0, 2, 'axleHole', 1, true)], 1]);
  specs.push(['compound 40 + 24 with crank holes through both (web tube)', (a) => [cellAt(a, 0, 0, 0, 'axleHole', 2.5, true), cellAt(a, 0, 0, 1, 'axleHole', 1.5, true), cellAt(a, 1, 0, 0, 'pinHole'), cellAt(a, 1, 0, 1, 'pinHole')], 3]); // 2 tunnels + 2 necks (1 handle)
  specs.push(['gear 24 + plain wheel r 2 stacked on one part', (a) => [cellAt(a, 0, 0, 0, 'axleHole', 1.5, true), cellAt(a, 0, 0, 1, 'axleHole', 2)], 1]);

  it('every configuration is valid in the core and builds one closed shell, for X, Y and Z', () => {
    let n = 0;
    for (const [label, cells, genus] of specs)
      for (const a of AXES) {
        const cs = cells(a);
        expect(validateModel(valid([cs])), `${label} axis ${a}`).toEqual([]);
        const m = fresh(part(cs));
        const st = expectClosedOneShell(m, `${label} axis ${a}`);
        if (genus !== undefined) expect(st.genus, `${label} axis ${a}`).toBe(genus);
        // The 3D-only path agrees (volume) with the fast path.
        const slow = partSolidStats(part(cs), { fast: false });
        const fast = partSolidStats(part(cs));
        expect(slow.volume, `${label} axis ${a}`).toBeCloseTo(fast.volume, 7);
        expect(fast.genus, `${label} axis ${a}`).toBe(st.genus);
        n++;
      }
    expect(n).toBe(specs.length * 3);
  }, 240000);

  it('web cells add only their bores: volume = single gear − bores (no barrel or web pokes into the teeth)', () => {
    for (const a of AXES) {
      const base = meshVolume(fresh(part([cellAt(a, 0, 0, 0, 'axleHole', 2.5, true)])));
      const cells = [cellAt(a, 0, 0, 0, 'axleHole', 2.5, true), ...webOffsets(2.5).map(([du, dv]) => cellAt(a, du, dv, 0, 'pinHole'))];
      const m = fresh(part(cells));
      // Each pin bore removes its 48-gon area over the slab, except where the groove (along +u)
      // already removed material: the groove crosses the bores at (1,0) and (2,0).
      const poly = (48 / 2) * R_BORE ** 2 * Math.sin((2 * Math.PI) / 48);
      const want = base - 12 * poly * 2 * H;
      // The groove's share inside the two bores on its line is added back: at most
      // 2 bores × 2 faces × (2·R_BORE · MARK_W · MARK_D).
      expect(meshVolume(m)).toBeLessThanOrEqual(want + 2 * 2 * 2 * R_BORE * MARK_W * MARK_D + 1e-6);
      expect(meshVolume(m)).toBeGreaterThanOrEqual(want - 1e-6);
      // Nothing beyond the root circle but tooth band and faces: every vertex in the slab whose
      // radius exceeds root − 0.02 is a face vertex or on the soft tooth band.
      const g = gearIndexes(part(cells))[0]!;
      for (let i = 0; i < m.positions.length / 3; i++) {
        const [pu, pv, pw] = uvw(m, i, a, [0, 0, 0]);
        if (Math.abs(pw) > H + 1e-4 || Math.hypot(pu, pv) < g.root - 0.02) continue;
        const axial = Math.abs(m.normals[3 * i + a]!) > 0.99;
        expect(axial || m.patchHint![i] === 1, `vertex ${i} at (${pu}, ${pv}, ${pw})`).toBe(true);
      }
    }
  });

  it('rimBridges has nothing to do for a gear: every same-part cell the core allows in the layer is web or clear of the pitch disc', () => {
    for (const r of GEAR_RADII) {
      const T = gearTeeth(r);
      for (const a of AXES) {
        const hub = cellAt(a, 0, 0, 0, 'pinHole', r, true);
        const { model, partId } = addPart(emptyModel(), [hub]);
        let allowed = 0;
        let web = 0;
        for (let du = -4; du <= 4; du++)
          for (let dv = -4; dv <= 4; dv++) {
            if (!du && !dv) continue;
            for (const [kind, ax] of [['pinHole', a], ['pinHole', gearPlaneBasis(a)[0]], ['pin', a], ['axle', gearPlaneBasis(a)[1]]] as [Kind, Axis][]) {
              const c0 = cellAt(a, du, dv, 0, kind);
              const c = { ...c0, axis: ax };
              if (!canAddCell(model, partId, c).ok) continue;
              allowed++;
              const isWeb = isWebCell(hub, c);
              if (isWeb) web++;
              expect(isWeb || !discOverlapsCell([hub.x, hub.y, hub.z], a, r, [c.x, c.y, c.z]), `${T} teeth axis ${a} ${kind} at (${du},${dv})`).toBe(true);
            }
          }
        // Only cells joined to the hub (by the pitch disc) can be added to this one-cell part, and
        // the core lets exactly the web cells (pin hole ∥ and pin ∥ at each web offset) in.
        expect(web).toBe(2 * webOffsets(r).length);
        expect(allowed).toBe(web);
      }
    }
  });

  it('a male of another part mated in a web hole is a separate solid that does not intersect the gear', () => {
    for (const a of AXES) {
      const g = [cellAt(a, 0, 0, 0, 'axleHole', 2.5, true), cellAt(a, 1, 1, 0, 'pinHole'), cellAt(a, 2, 0, 0, 'axleHole')];
      const pinP = [cellAt(a, 1, 1, 0, 'pin'), cellAt(a, 1, 1, 1, 'pin')];
      const axleP = [cellAt(a, 2, 0, -1, 'axle'), cellAt(a, 2, 0, 0, 'axle'), cellAt(a, 2, 0, 1, 'axle')];
      const shaft = [cellAt(a, 0, 0, -1, 'axle'), cellAt(a, 0, 0, 0, 'axle'), cellAt(a, 0, 0, 1, 'axle')];
      expect(validateModel(valid([g, pinP, axleP, shaft]))).toEqual([]);
      const mg = fresh(part(g, 1));
      for (const other of [pinP, axleP, shaft]) {
        const mo = buildPartMesh(part(other, 2));
        expectClosedOneShell(mo, `axis ${a}`);
        expect(intersectionVolume(mg, mo), `axis ${a}`).toBeLessThan(1e-9);
      }
    }
  });
});

describe('meshing pairs (§2.7: 8+8, 8+24, 16+16, 8+40, 24+24, 24+40, 40+40 in line)', () => {
  const PAIRS: [number, number][] = [
    [0.5, 0.5],
    [0.5, 1.5],
    [1, 1],
    [0.5, 2.5],
    [1.5, 1.5],
    [1.5, 2.5],
    [2.5, 2.5],
  ];
  const STEPS = 48;

  it('as built the two solids do not intersect, and rolled together through a whole tooth cycle they stay ≥ 0.004 apart, on every axis, in line along u and v', () => {
    const rows: string[] = [];
    let worst = Infinity;
    for (const [rA, rB] of PAIRS)
      for (const a of AXES)
        for (const dir of ['u', 'v'] as const) {
          const d = rA + rB;
          const hubA: [number, number, number] = [0, 0, 0];
          const hubB = dir === 'u' ? at(a, d, 0) : at(a, 0, d);
          const A = [gear(...hubA, 'axleHole', a, rA)];
          const B = [gear(...hubB, 'axleHole', a, rB)];
          const m = valid([A, B]);
          expect(validateModel(m), `${rA}+${rB} axis ${a} ${dir}`).toEqual([]);
          const mA = buildPartMesh(part(A, 1));
          const mB = buildPartMesh(part(B, 2));
          expect(intersectionVolume(mA, mB), `${rA}+${rB} axis ${a} ${dir}`).toBeLessThan(1e-9);
          // Roll: A turns θ, B turns −θ·rA/rB about its own hub (mid-plane sections of the meshes).
          const sA = section(mA, a, hubA).filter((s) => Math.hypot(s[0]!, s[1]!) > gearRootRadius(rA) - 1e-3);
          const sB = section(mB, a, hubB).filter((s) => Math.hypot(s[0]!, s[1]!) > gearRootRadius(rB) - 1e-3);
          // Two triangles per wall quad, each cut once: 2 segments per outline edge (≤ 16 edges per
          // tooth; Manifold.simplify drops outline points that are collinear within 1e-5).
          expect(sA.length).toBeGreaterThanOrEqual(2 * 12 * gearTeeth(rA));
          expect(sB.length).toBeGreaterThanOrEqual(2 * 12 * gearTeeth(rB));
          const [bu, bv] = dir === 'u' ? [d, 0] : [0, d];
          const pu = (bu * rA) / d, pv = (bv * rA) / d; // pitch point
          const near = (s: number[]) => Math.hypot((s[0]! + s[2]!) / 2 - pu, (s[1]! + s[3]!) / 2 - pv) < 0.6;
          let min = Infinity;
          const pitchA = (2 * Math.PI) / gearTeeth(rA);
          for (let k = 0; k < STEPS; k++) {
            const th = (pitchA * k) / STEPS;
            const RA = sA.map((s) => rot(s, th, 0, 0)).filter(near);
            const RB = sB.map((s) => rot(s, (-th * rA) / rB, bu, bv)).filter(near);
            min = Math.min(min, clearance(RA, RB));
          }
          worst = Math.min(worst, min);
          if (a === 2 || min < 0.01) rows.push(`${gearTeeth(rA)}+${gearTeeth(rB)} axis ${a} along ${dir}: min clearance ${min.toFixed(4)}`);
          expect(min, `${rA}+${rB} axis ${a} along ${dir}`).toBeGreaterThanOrEqual(0.004);
        }
    console.log(`[gears] rolling clearance (${STEPS} steps per pitch of the first gear), worst ${worst.toFixed(4)}\n  ` + rows.join('\n  '));
  }, 240000);

  it('a gear beside a plain wheel at the closest allowed spacing: valid, separate, not intersecting', () => {
    for (const a of AXES) {
      // 24-tooth gear (tip 1.594) and wheel r 1 three apart along u: 3 > 1.594 + 1.
      const G = [gear(0, 0, 0, 'axleHole', a, 1.5)];
      const W = [cl(...at(a, 3, 0), 'axleHole', a, 1)];
      expect(validateModel(valid([G, W]))).toEqual([]);
      // One closer is refused by the core (tips into the wheel).
      const W2 = [cl(...at(a, 2, 0), 'axleHole', a, 1)];
      expect(() => valid([G, W2])).toThrow(/gear/);
      expect(intersectionVolume(buildPartMesh(part(G, 1)), buildPartMesh(part(W, 2)))).toBeLessThan(1e-9);
    }
  });
});

describe('index (§4.2, §6.1) and soft tooth patch', () => {
  it('rimMarks: a face groove for r ≥ 1 from ½ to root − 0.05 along +u, no tread; none on an 8; wheels unchanged', () => {
    for (const a of AXES) {
      expect(rimMarks(part([gear(0, 0, 0, 'axleHole', a, 0.5)]))).toEqual([]);
      for (const r of [1, 1.5, 2.5]) {
        const [mk] = rimMarks(part([gear(0, 0, 0, 'axleHole', a, r)]));
        const u: [number, number, number] = [0, 0, 0];
        u[gearPlaneBasis(a)[0]] = 1;
        expect(mk).toEqual({ cell: 0, center: [0, 0, 0], axis: a, dir: u, r0: MARK_R0, r1: gearRootRadius(r) - GEAR_MARK_END, width: MARK_W, depth: MARK_D, tread: false, gear: true });
      }
      expect(rimMarks(part([cl(0, 0, 0, 'axleHole', a, 1)]))[0]!.gear).toBeUndefined();
    }
  });

  it('the groove is cut in both faces and ends with a wall inside the root circle (not across the teeth)', () => {
    for (const a of AXES)
      for (const r of [1, 1.5, 2.5]) {
        const m = fresh(part([gear(0, 0, 0, 'pinHole', a, r)]));
        const end = gearRootRadius(r) - GEAR_MARK_END;
        for (const w of [H - MARK_D / 2, -(H - MARK_D / 2)]) {
          expect(insideMesh(m, at(a, (MARK_R0 + end) / 2, 0.001, w)), `r ${r} axis ${a}`).toBe(false); // in the groove
          expect(insideMesh(m, at(a, end + 0.02, 0.001, w)), `r ${r} axis ${a}`).toBe(true); // past its end wall
        }
        const off = partSolidStats(part([gear(0, 0, 0, 'pinHole', a, r)]), { marks: false }).volume;
        expect(off - meshVolume(m)).toBeCloseTo(grooveVol(r), 6);
      }
  });

  it('gearIndexes + indexToothWeights: tooth 0 flanks and tip land only, on every gear and axis', () => {
    for (const r of GEAR_RADII)
      for (const a of AXES) {
        const T = gearTeeth(r);
        const hub = at(a, -2, 1, 3);
        const p = part([gear(hub[0], hub[1], hub[2], 'pinHole', a, r)]);
        const [g] = gearIndexes(p);
        expect(g!.teeth).toBe(T);
        expect(g!.angle).toBeCloseTo(gearToothAngle(T, 0), 15);
        expect(g!.patch).toBe(1);
        const m = buildPartMesh(p);
        const wts = indexToothWeights(p, m.positions, m.normals);
        let n = 0;
        let tips = 0;
        for (let i = 0; i < wts.length; i++) {
          if (!wts[i]) continue;
          n++;
          const [pu, pv, pw] = uvw(m, i, a, hub);
          const rho = Math.hypot(pu, pv);
          expect(Math.abs(pw)).toBeLessThanOrEqual(H + 1e-5);
          expect(Math.abs(wrap(Math.atan2(pv, pu) - g!.angle))).toBeLessThan(Math.PI / T);
          expect(Math.abs(m.normals[3 * i + a]!)).toBeLessThan(0.5);
          if (rho > tipRadius(r) - 1e-4) tips++;
        }
        // Both flanks (2 × 6 points × 2 faces; 7 on the 8-tooth gear) and the tip land (3 points × 2 faces).
        expect(n, `r ${r} axis ${a}`).toBeGreaterThanOrEqual(2 * 6 * 2 + 3 * 2);
        expect(tips, `r ${r} axis ${a}`).toBeGreaterThanOrEqual(6);
      }
    expect(indexToothWeights(part([cl(0, 0, 0, 'pinHole', 2, 2)]), new Float32Array(9), new Float32Array(9)).every((x) => x === 0)).toBe(true);
  });

  it('patchHint marks exactly the tooth band of each gear; softPatches lists them; consistent per triangle', () => {
    const cases: [string, Cell[], number[]][] = [];
    for (const r of GEAR_RADII) for (const a of AXES) cases.push([`r ${r} axis ${a}`, [gear(0, 0, 0, 'axleHole', a, r)], [1]]);
    for (const a of AXES)
      cases.push([`compound 40 + 8 + beam, axis ${a}`, [cellAt(a, 0, 0, 0, 'axleHole', 2.5, true), cellAt(a, 0, 0, 1, 'axleHole', 0.5, true), cellAt(a, 0, 0, 2, 'pinHole'), cellAt(a, 1, 0, 2, 'pinHole'), cellAt(a, 2, 0, 0, 'pinHole'), cellAt(a, 2, 0, 1, 'pinHole'), cellAt(a, 2, 0, 2, 'pinHole')], [1, 2]]);
    for (const [label, cells, soft] of cases) {
      const p = part(cells);
      expect(validateModel(valid([cells])), label).toEqual([]);
      const m = fresh(p);
      const n = m.positions.length / 3;
      expect(m.patchHint, label).toBeInstanceOf(Uint16Array);
      expect(m.patchHint!.length, label).toBe(n);
      expect([...m.softPatches!], label).toEqual(soft);
      const I = m.indices;
      for (let t = 0; t < I.length; t += 3) {
        const h0 = m.patchHint![I[t]!]!;
        expect(m.patchHint![I[t + 1]!], label).toBe(h0);
        expect(m.patchHint![I[t + 2]!], label).toBe(h0);
      }
      const gears = gearIndexes(p);
      expect(gears.map((g) => g.patch)).toEqual(soft);
      // Vertices of surfaces that stand on a gear face (a barrel of the next layer touching it):
      // in the band region, but their triangles leave the slab.
      const standsOnFace = new Set<number>();
      for (let t = 0; t < I.length; t += 3)
        for (const g of gears) {
          const ws = [0, 1, 2].map((j) => uvw(m, I[t + j]!, g.axis, [g.center[0] + m.origin[0], g.center[1] + m.origin[1], g.center[2] + m.origin[2]])[2]);
          if (ws.some((w) => Math.abs(w) > H + 1e-3) && ws.some((w) => Math.abs(w) <= H + 1e-4)) for (let j = 0; j < 3; j++) standsOnFace.add(I[t + j]!);
        }
      const counts = soft.map(() => 0);
      for (let i = 0; i < n; i++) {
        const k = m.patchHint![i]!;
        for (const g of gears) {
          const [pu, pv, pw] = uvw(m, i, g.axis, [g.center[0] + m.origin[0], g.center[1] + m.origin[1], g.center[2] + m.origin[2]]);
          const rho = Math.hypot(pu, pv);
          const inBand = Math.abs(pw) <= H + 1e-4 && rho >= g.root - 1e-4 && Math.abs(m.normals[3 * i + g.axis]!) < 0.5;
          if (k === g.patch) {
            expect(inBand, `${label} vertex ${i}`).toBe(true);
            counts[g.patch - 1]!++;
          } else if (inBand && rho > g.root + 1e-3 && !standsOnFace.has(i)) {
            throw new Error(`${label}: band vertex ${i} of gear ${g.patch} not hinted (${k})`);
          }
        }
      }
      // Every band vertex: flank (7 × 2 split per face pair) etc. At least 16 vertices per tooth.
      gears.forEach((g, j) => expect(counts[j], label).toBeGreaterThanOrEqual(16 * g.teeth));
    }
  });
});
