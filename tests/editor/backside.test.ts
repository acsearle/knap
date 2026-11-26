// Back side (DESIGN §7.3): pickBack (the back face under the cursor) against an independent
// reference, resolveBuild on a back-face pick (= the same face hovered from behind), buildPick, and
// withModifiers / setBackSide.
//
// The reference (refBack) is written independently of src/editor/picking.ts: per part it lists every
// parameter where the ray crosses a cube face plane or a disc boundary, tests point membership
// (strictly inside any cube or disc of the part) at the midpoints between them, and takes the first
// candidate where "inside" turns into "outside". The exit element is the one containing a point just
// before the exit whose boundary the exit point lies on.
import { describe, expect, it } from 'vitest';
import {
  AXES,
  DIRS,
  KINDS,
  addCell,
  addPart,
  canAddCell,
  canSetRim,
  cellsAt,
  emptyModel,
  isHole,
  isMale,
  makeCell,
  partById,
  setRim,
  validateModel,
} from '../../src/core';
import type { Axis, Cell, Dir, Kind, Model, Part, Vec3i } from '../../src/core';
import { exampleByName } from '../../src/core/examples';
import { R_ROD } from '../../src/geometry/dims';
import {
  DIR_LABELS,
  buildPick,
  cycleOrientation,
  initialToolState,
  pickBack,
  pickCell,
  pickColor,
  resolveBuild,
  resolveErase,
  resolveSelect,
  selectTool,
  setBackSide,
  setNewPart,
  withModifiers,
  withShift,
} from '../../src/editor';
import type { CellPick, PartTransform, PickHit, Proposal, Ray, ToolState } from '../../src/editor';
import { c, modelOf } from './helpers';

type V3 = [number, number, number];

function st(tool: Kind | 'select' | 'erase', opts: { newPart?: boolean; backSide?: boolean; axisPref?: Axis | null } = {}): ToolState {
  let s = setBackSide(setNewPart(selectTool(initialToolState('#3b74c4'), tool), !!opts.newPart), !!opts.backSide);
  if (opts.axisPref !== undefined) s = { ...s, axisPref: opts.axisPref };
  return s;
}

const idx = (m: Model, partId: number, x: number, y: number, z: number): number =>
  partById(m, partId)!.cells.findIndex((q) => q.x === x && q.y === y && q.z === z);

const norm = (v: readonly number[]): V3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};

/** A ray through `target` along `dir`, starting `back` before it. */
const rayThrough = (target: readonly number[], dir: readonly number[], back = 30): Ray => {
  const d = norm(dir);
  return { origin: [target[0]! - d[0] * back, target[1]! - d[1] * back, target[2]! - d[2] * back], dir: d };
};

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Independent reference

/** Rotation of v by the unit quaternion q = [x, y, z, w] via its rotation matrix. */
function qmat(q: readonly number[]): number[][] {
  const [x, y, z, w] = q as [number, number, number, number];
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
/** Mᵀ v (inverse rotation). */
const mulT = (M: number[][], v: readonly number[]): V3 => [0, 1, 2].map((j) => M[0]![j]! * v[0]! + M[1]![j]! * v[1]! + M[2]![j]! * v[2]!) as V3;

const rimR = (q: Cell): number | null => (q.rim !== undefined && isHole(q.kind) ? q.rim : null);

interface RefExit {
  partId: number;
  t: number;
  cellIndex: number;
  dir: Dir;
  virtual?: Vec3i;
  tread?: boolean;
}

function insidePart(part: Part, p: readonly number[]): boolean {
  for (const q of part.cells) {
    const h = [q.x, q.y, q.z];
    if (Math.abs(p[0]! - h[0]!) < 0.5 && Math.abs(p[1]! - h[1]!) < 0.5 && Math.abs(p[2]! - h[2]!) < 0.5) return true;
    const r = rimR(q);
    if (r !== null) {
      const a = q.axis;
      let s = 0;
      for (let k = 0; k < 3; k++) if (k !== a) s += (p[k]! - h[k]!) ** 2;
      if (Math.abs(p[a]! - h[a]!) < 0.5 && s < r * r) return true;
    }
  }
  return false;
}

/**
 * A host of a male part (a part whose hole holds one of its male cells), or a rod standing in one
 * of a part's holes (`cubes`: only those cells' cubes), with the ray in its frame.
 */
interface RefHost {
  part: Part;
  o: V3;
  d: V3;
  cubes?: readonly Cell[];
}

/** Strictly inside the given cells' cubes. */
function insideCubes(cells: readonly Cell[], p: readonly number[]): boolean {
  return cells.some((q) => Math.abs(p[0]! - q.x) < 0.5 && Math.abs(p[1]! - q.y) < 0.5 && Math.abs(p[2]! - q.z) < 0.5);
}

/**
 * Fixer's ruling after review (DEVIATIONS §7): a male inside another part's hole is buried in that
 * part — the host's solid extends the male's for finding its first exit, and an interval that ends
 * in host material is no crossing of the male (null; the host has its own exit there).
 */
function refPartExit(part: Part, o: V3, d: V3, hosts: readonly RefHost[] = []): RefExit | null {
  const cand: number[] = [];
  for (const hh of hosts)
    for (const q of hh.cubes ?? hh.part.cells) {
      const h = [q.x, q.y, q.z];
      for (let a = 0; a < 3; a++) if (hh.d[a] !== 0) for (const s of [-0.5, 0.5]) cand.push((h[a]! + s - hh.o[a]!) / hh.d[a]!);
      const r = hh.cubes ? null : rimR(q);
      if (r !== null) {
        const a = q.axis;
        const [u, v] = [0, 1, 2].filter((k) => k !== a) as [number, number];
        const A = hh.d[u]! ** 2 + hh.d[v]! ** 2;
        const B = 2 * ((hh.o[u]! - h[u]!) * hh.d[u]! + (hh.o[v]! - h[v]!) * hh.d[v]!);
        const C = (hh.o[u]! - h[u]!) ** 2 + (hh.o[v]! - h[v]!) ** 2 - r * r;
        const D = B * B - 4 * A * C;
        if (A > 0 && D > 0) cand.push((-B - Math.sqrt(D)) / (2 * A), (-B + Math.sqrt(D)) / (2 * A));
      }
    }
  const inHost = (t: number): boolean =>
    hosts.some((hh) => {
      const p = [hh.o[0] + t * hh.d[0], hh.o[1] + t * hh.d[1], hh.o[2] + t * hh.d[2]];
      return hh.cubes ? insideCubes(hh.cubes, p) : insidePart(hh.part, p);
    });
  for (const q of part.cells) {
    const h = [q.x, q.y, q.z];
    for (let a = 0; a < 3; a++) if (d[a] !== 0) for (const s of [-0.5, 0.5]) cand.push((h[a]! + s - o[a]!) / d[a]!);
    const r = rimR(q);
    if (r !== null) {
      const a = q.axis;
      const [u, v] = [0, 1, 2].filter((k) => k !== a) as [number, number];
      const A = d[u]! ** 2 + d[v]! ** 2;
      const B = 2 * ((o[u]! - h[u]!) * d[u]! + (o[v]! - h[v]!) * d[v]!);
      const C = (o[u]! - h[u]!) ** 2 + (o[v]! - h[v]!) ** 2 - r * r;
      const D = B * B - 4 * A * C;
      if (A > 0 && D > 0) cand.push((-B - Math.sqrt(D)) / (2 * A), (-B + Math.sqrt(D)) / (2 * A));
    }
  }
  const ts = cand.filter((t) => t > 1e-12).sort((x, y) => x - y);
  const at = (t: number): V3 => [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  let prev = 0;
  let ownSeen = false;
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k]!;
    if (t - prev < 1e-10 && k > 0) continue;
    const next = ts.slice(k + 1).find((x) => x - t > 1e-10) ?? t + 1;
    const ownBefore = insidePart(part, at((prev + t) / 2));
    if (ownBefore) ownSeen = true;
    const inBefore = ownBefore || inHost((prev + t) / 2);
    const inAfter = insidePart(part, at((t + next) / 2)) || inHost((t + next) / 2);
    prev = t;
    if (!inBefore || inAfter) continue;
    if (!ownSeen) continue; // only host material crossed so far: look further
    if (!ownBefore) return null; // the interval ends in the host: no crossing of this part
    // the exit element
    const pm = at(t - 1e-7);
    const pe = at(t);
    for (let i = 0; i < part.cells.length; i++) {
      const q = part.cells[i]!;
      const h = [q.x, q.y, q.z];
      if (!(Math.abs(pm[0] - h[0]!) < 0.5 && Math.abs(pm[1] - h[1]!) < 0.5 && Math.abs(pm[2] - h[2]!) < 0.5)) continue;
      const off = [0, 1, 2].map((a) => pe[a]! - h[a]!);
      const a = [0, 1, 2].reduce((bst, k) => (Math.abs(off[k]!) > Math.abs(off[bst]!) ? k : bst), 0);
      if (Math.abs(Math.abs(off[a]!) - 0.5) > 1e-7) continue;
      return { partId: part.id, t, cellIndex: i, dir: (2 * a + (off[a]! > 0 ? 0 : 1)) as Dir };
    }
    for (let i = 0; i < part.cells.length; i++) {
      const q = part.cells[i]!;
      const r = rimR(q);
      if (r === null) continue;
      const h = [q.x, q.y, q.z];
      const a = q.axis;
      const [u, v] = [0, 1, 2].filter((k) => k !== a) as [number, number];
      if (!(Math.abs(pm[a]! - h[a]!) < 0.5 && (pm[u]! - h[u]!) ** 2 + (pm[v]! - h[v]!) ** 2 < r * r)) continue;
      if (Math.abs(Math.abs(pe[a]! - h[a]!) - 0.5) < 1e-7) {
        const g: [number, number, number] = [q.x, q.y, q.z];
        g[u] = Math.round(pe[u]!) + 0;
        g[v] = Math.round(pe[v]!) + 0;
        return { partId: part.id, t, cellIndex: i, dir: (2 * a + (pe[a]! - h[a]! > 0 ? 0 : 1)) as Dir, virtual: g };
      }
      const ru = pe[u]! - h[u]!;
      const rv = pe[v]! - h[v]!;
      const k = Math.abs(rv) > Math.abs(ru) ? v : u;
      const comp = k === u ? ru : rv;
      return { partId: part.id, t, cellIndex: i, dir: (2 * k + (comp < 0 ? 1 : 0)) as Dir, tread: true };
    }
    throw new Error('reference: no exit element');
  }
  return null;
}

/**
 * The reference back pick. Ties between parts leaving the same shared cell (male in a hole): as for
 * the front pick, the male iff the exit face is axial and the exit point is strictly within R_ROD of
 * the axis, else the hole's part; other ties: the lower part id.
 */
function refBack(m: Model, ray: Ray, tf?: (id: number) => PartTransform | null): RefExit | null {
  let best: RefExit | null = null;
  for (const part of m.parts) {
    let o = ray.origin as V3;
    let d = ray.dir as V3;
    if (tf) {
      const T = tf(part.id);
      if (!T) continue;
      const M = qmat(T.q);
      o = mulT(M, [ray.origin[0] - T.p[0], ray.origin[1] - T.p[1], ray.origin[2] - T.p[2]]);
      d = mulT(M, ray.dir);
    }
    const hosts: RefHost[] = [];
    for (const hp of m.parts) {
      if (hp === part) continue;
      const holds = part.cells.some((q) => isMale(q.kind) && hp.cells.some((h) => isHole(h.kind) && h.x === q.x && h.y === q.y && h.z === q.z));
      if (!holds) continue;
      let ho = ray.origin as V3;
      let hd = ray.dir as V3;
      if (tf) {
        const T = tf(hp.id);
        if (!T) continue;
        const M = qmat(T.q);
        ho = mulT(M, [ray.origin[0] - T.p[0], ray.origin[1] - T.p[1], ray.origin[2] - T.p[2]]);
        hd = mulT(M, ray.dir);
      }
      hosts.push({ part: hp, o: ho, d: hd });
    }
    // §7.3 "one solid both ways": the rods standing in this part's holes (another part's male cell
    // in the hole and that part's male cells in line with it along its axis) extend this part too.
    for (const mp of m.parts) {
      if (mp === part) continue;
      const rod: Cell[] = [];
      for (const h of part.cells) {
        if (!isHole(h.kind)) continue;
        const male = mp.cells.find((q) => isMale(q.kind) && q.x === h.x && q.y === h.y && q.z === h.z);
        if (!male) continue;
        const a = male.axis;
        for (const sgn of [1, -1])
          for (let k = sgn === 1 ? 0 : -1; ; k += sgn) {
            const pos = [male.x, male.y, male.z];
            pos[a] = pos[a]! + k;
            const q = mp.cells.find((r) => r.x === pos[0] && r.y === pos[1] && r.z === pos[2]);
            if (!q || !isMale(q.kind) || q.axis !== a) break;
            if (!rod.includes(q)) rod.push(q);
          }
      }
      if (!rod.length) continue;
      let ro = ray.origin as V3;
      let rd = ray.dir as V3;
      if (tf) {
        const T = tf(mp.id);
        if (!T) continue;
        const M = qmat(T.q);
        ro = mulT(M, [ray.origin[0] - T.p[0], ray.origin[1] - T.p[1], ray.origin[2] - T.p[2]]);
        rd = mulT(M, ray.dir);
      }
      hosts.push({ part: mp, o: ro, d: rd, cubes: rod });
    }
    const e = refPartExit(part, o, d, hosts);
    if (!e) continue;
    if (!best || e.t < best.t - 1e-9) {
      best = e;
      continue;
    }
    if (e.t > best.t + 1e-9) continue;
    const a = part.cells[e.cellIndex]!;
    const b = partById(m, best.partId)!.cells[best.cellIndex]!;
    const shared = !e.virtual && !e.tread && !best.virtual && !best.tread && a.x === b.x && a.y === b.y && a.z === b.z;
    if (shared && isHole(a.kind) !== isHole(b.kind)) {
      const hole = isHole(a.kind) ? a : b;
      const ex = isHole(a.kind) ? e : best;
      const pt = [o[0] + e.t * d[0], o[1] + e.t * d[1], o[2] + e.t * d[2]];
      const h = [hole.x, hole.y, hole.z];
      const rad = Math.hypot(...[0, 1, 2].filter((k) => k !== hole.axis).map((k) => pt[k]! - h[k]!));
      const maleWins = ex.dir >> 1 === hole.axis && rad < R_ROD;
      if (maleWins !== isHole(a.kind)) best = e;
    } else if (part.id < best.partId) best = e;
  }
  return best;
}

/** pickBack's result agrees with the reference (t, part, cell, face, virtual cell / tread). */
function expectAgree(h: PickHit | null, r: RefExit | null, what: string): void {
  if (!r) {
    expect(h, what).toBeNull();
    return;
  }
  expect(h, what).not.toBeNull();
  expect(h!.back).toBe(true);
  expect(Math.abs(h!.t - r.t), what).toBeLessThan(1e-7);
  expect({ partId: h!.partId, cellIndex: h!.cellIndex, dir: h!.dir, virtual: h!.virtual, tread: h!.tread }, what).toEqual({
    partId: r.partId,
    cellIndex: r.cellIndex,
    dir: r.dir,
    virtual: r.virtual,
    tread: r.tread,
  });
}

/** A random valid model: ~`n` attempted cells in a 5×3×5 box, some hole cells grown into wheels. */
function randomModel(R: () => number, n = 40, rims = true): Model {
  let m = emptyModel();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)]!;
  for (let k = 0; k < n; k++) {
    const cell = makeCell(Math.floor(R() * 5) - 2, Math.floor(R() * 3) - 1, Math.floor(R() * 5) - 2, pick(KINDS), pick(AXES));
    const target = m.parts.length && R() < 0.66 ? pick(m.parts).id : null;
    if (!canAddCell(m, target, cell).ok) continue;
    m = target === null ? addPart(m, [cell]).model : addCell(m, target, cell);
  }
  if (rims)
    for (const part of m.parts)
      for (const q of part.cells) {
        if (!isHole(q.kind) || R() > 0.25) continue;
        const r = pick([1, 1.5, 2, 2.5]);
        if (canSetRim(m, part.id, [q.x, q.y, q.z], r).ok) m = setRim(m, part.id, [q.x, q.y, q.z], r);
      }
  expect(validateModel(m)).toEqual([]);
  return m;
}

/** A random ray aimed at a point near the model (from 30 units away). */
function randomRay(R: () => number, spread = 3.5, centre: readonly number[] = [0, 0, 0]): Ray {
  const target = centre.map((v) => v + (R() * 2 - 1) * spread);
  let d: V3;
  do d = [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1];
  while (Math.hypot(...d) < 0.2);
  return rayThrough(target, d);
}

// ---------------------------------------------------------------------------------------------
// pickBack: specific cases

describe('pickBack (§7.3): the back face under the cursor', () => {
  it('a single cell: the face the ray leaves through, every kind, from all 26 directions', () => {
    for (const kind of KINDS) {
      const m = modelOf([c(3, 1, -2, kind, 1)]);
      for (let sx = -1; sx <= 1; sx++)
        for (let sy = -1; sy <= 1; sy++)
          for (let sz = -1; sz <= 1; sz++) {
            if (!sx && !sy && !sz) continue;
            // slightly off-centre so the exit is generic
            const r = rayThrough([3.11, 1.07, -2.13], [sx + 0.01, sy + 0.02, sz + 0.03]);
            expectAgree(pickBack(m, r), refBack(m, r), `${kind} ${sx},${sy},${sz}`);
          }
      // straight in through +Z: out through −Z
      const h = pickBack(m, { origin: [3.2, 1.1, 5], dir: [0, 0, -1] })!;
      expect(h).toMatchObject({ partId: 1, cellIndex: 0, pos: [3, 1, -2], dir: 5, back: true, inside: false });
      expect(h.point[2]).toBeCloseTo(-2.5, 12);
      expect(h.normal).toEqual([0, 0, -1]);
    }
  });

  it('a 1×7 beam seen from all 8 octants: random rays agree with the reference', () => {
    const m = modelOf([0, 1, 2, 3, 4, 5, 6].map((x) => c(x, 0, 0, 'pinHole', 2)));
    const R = lcg(7);
    let hits = 0;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const view = norm([-sx * (0.8 + R() * 0.4), -sy * (0.5 + R() * 0.4), -sz * (1 + R() * 0.4)]);
          for (let k = 0; k < 60; k++) {
            const r = rayThrough([3 + (R() * 2 - 1) * 4, (R() * 2 - 1) * 1, (R() * 2 - 1) * 1], view);
            const h = pickBack(m, r);
            expectAgree(h, refBack(m, r), `octant ${sx},${sy},${sz} #${k}`);
            // the back face never faces the viewer
            if (h) {
              hits++;
              const n = DIRS[h.dir]!;
              expect(n[0] * view[0] + n[1] * view[1] + n[2] * view[2]).toBeGreaterThan(0);
            }
          }
        }
    expect(hits).toBeGreaterThan(150);
  });

  it('the back face is where the ray leaves, not the face opposite the front face', () => {
    // 1×7 beam along X, holes ∥ Z; seen from the default iso-like view (−1, −1, −1)
    const m = modelOf([0, 1, 2, 3, 4, 5, 6].map((x) => c(x, 0, 0, 'pinHole', 2)));
    const r = rayThrough([3.2, 0.5, 0.1], [-1, -1, -1]);
    expect(pickCell(m, r)).toMatchObject({ cellIndex: 3, dir: 2 }); // enters the top of cell 3
    expect(pickBack(m, r)).toMatchObject({ cellIndex: 3, dir: 5 }); // leaves its back (−Z), not its bottom
    // steeply down and along +X: in at the top of cell 2, out of the bottom of cell 3
    const s = rayThrough([2.3, 0.5, 0], [1, -1, 0.001]);
    expect(pickCell(m, s)).toMatchObject({ cellIndex: 2, dir: 2 });
    expect(pickBack(m, s)).toMatchObject({ cellIndex: 3, dir: 3 });
    // along the beam from its −X end: out of the far end
    expect(pickBack(m, { origin: [-5, 0.1, 0.2], dir: [1, 0, 0] })).toMatchObject({ cellIndex: 6, dir: 0 });
    // a ray that misses: null (as pickCell)
    const miss = { origin: [0, 5, 5] as V3, dir: [0, 0, -1] as V3 };
    expect(pickBack(m, miss)).toBeNull();
    expect(pickCell(m, miss)).toBeNull();
  });

  it('L and U shapes: the first exit, not the last', () => {
    // U in the XY plane: bottom (0..2, 0), arms (0, 1..2) and (2, 1..2)
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pinHole', 2), c(0, 2, 0, 'pinHole', 2), c(2, 1, 0, 'pinHole', 2), c(2, 2, 0, 'pinHole', 2)]);
    // horizontally through both arms: leaves the left arm (+X) first
    expect(pickBack(m, { origin: [-5, 2.1, 0.1], dir: [1, 0, 0] })).toMatchObject({ cellIndex: idx(m, 1, 0, 2, 0), dir: 0 });
    // the other way: leaves the right arm (−X)
    expect(pickBack(m, { origin: [7, 1.2, 0.1], dir: [-1, 0, 0] })).toMatchObject({ cellIndex: idx(m, 1, 2, 1, 0), dir: 1 });
    // down an arm: through the bottom row's corner cell, out of its bottom
    expect(pickBack(m, { origin: [0.1, 7, 0.2], dir: [0, -1, 0] })).toMatchObject({ cellIndex: idx(m, 1, 0, 0, 0), dir: 3 });
    // down the gap: into the bottom middle cell only
    expect(pickBack(m, { origin: [1.1, 7, 0.2], dir: [0, -1, 0] })).toMatchObject({ cellIndex: idx(m, 1, 1, 0, 0), dir: 3 });
    // obliquely: in through the top of the left arm, out into the gap (+X of (0,2,0))
    expect(pickBack(m, rayThrough([0.2, 2.5, 0], [1, -0.6, 0.05]))).toMatchObject({ cellIndex: idx(m, 1, 0, 2, 0), dir: 0 });
    const R = lcg(11);
    for (let k = 0; k < 400; k++) {
      const r = randomRay(R, 2.5, [1, 1, 0]);
      expectAgree(pickBack(m, r), refBack(m, r), `U #${k}`);
    }
  });

  it('two parts in a row: the nearer part’s exit, even where it abuts the next part', () => {
    // A (part 1) at z = 0 and B (part 2) at z = −1, right behind it
    const m = modelOf([0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)), [0, 1, 2].map((x) => c(x, 0, -1, 'pinHole', 2)));
    expect(pickBack(m, { origin: [1.1, 0.2, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 1, cellIndex: 1, dir: 5 });
    // from behind: B's front face (+Z, which abuts A)
    expect(pickBack(m, { origin: [1.1, 0.2, -5], dir: [0, 0, 1] })).toMatchObject({ partId: 2, cellIndex: 1, dir: 4 });
    // two beams with a gap between them
    const g = modelOf([0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)), [0, 1, 2].map((x) => c(x, 0, -3, 'pinHole', 2)));
    expect(pickBack(g, { origin: [1.1, 0.2, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 1, dir: 5 });
    const R = lcg(13);
    for (let k = 0; k < 300; k++) {
      const r = randomRay(R, 2.5, [1, 0, -1]);
      expectAgree(pickBack(m, r), refBack(m, r), `row #${k}`);
      expectAgree(pickBack(g, r), refBack(g, r), `gap #${k}`);
    }
  });

  it('a pin through a hole, sticking out in front and behind', () => {
    // beam (part 1) along X; a 3-long pin (part 2) ∥ Z through its middle hole
    const m = modelOf([0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)), [c(1, 0, -1, 'pin', 2), c(1, 0, 0, 'pin', 2), c(1, 0, 1, 'pin', 2)]);
    expect(validateModel(m)).toEqual([]);
    // along the pin's axis from the front: the beam's back face at z = −½ is still inside the pin
    // (one solid both ways, DESIGN §7.3 as updated after the M7 review; was: the beam's back face
    // around the pin), so the pin's far end is picked
    expect(pickBack(m, { origin: [1.05, 0.03, 9], dir: [0, 0, -1] })).toMatchObject({ partId: 2, cellIndex: idx(m, 2, 1, 0, -1), dir: 5 });
    // along the axis but outside the pin's cell square: the beam's own back face
    expect(pickBack(m, { origin: [0.3, 0.03, 9], dir: [0, 0, -1] })).toMatchObject({ partId: 1, cellIndex: 0, dir: 5 });
    // with the beam filtered out: the pin's far end
    expect(pickBack(m, { origin: [1.05, 0.03, 9], dir: [0, 0, -1] }, { filter: (p) => p.id === 2 })).toMatchObject({ partId: 2, cellIndex: idx(m, 2, 1, 0, -1), dir: 5 });
    // across the beam through the shared cell (both leave it at once): the hole's part wins the tie
    expect(pickBack(m, { origin: [1.1, 5, 0.05], dir: [0, -1, 0] })).toMatchObject({ partId: 1, cellIndex: 1, dir: 3 });
    // across the pin where it sticks out: the pin
    expect(pickBack(m, { origin: [1.1, 5, 1.05], dir: [0, -1, 0] })).toMatchObject({ partId: 2, cellIndex: idx(m, 2, 1, 0, 1), dir: 3 });
    // along the beam through the pin: the pin is buried in the beam (fixer's ruling after review,
    // DEVIATIONS §7; was: the pin's cube is left first, at x = 1.5), so the beam's far end is picked
    expect(pickBack(m, { origin: [-5, 0.1, 0.1], dir: [1, 0, 0] })).toMatchObject({ partId: 1, cellIndex: 2, dir: 0 });
    // with the beam filtered out the pin is no longer buried: its cube is left at x = 1.5
    expect(pickBack(m, { origin: [-5, 0.1, 0.1], dir: [1, 0, 0] }, { filter: (p) => p.id === 2 })).toMatchObject({ partId: 2, cellIndex: idx(m, 2, 1, 0, 0), dir: 0 });
    // and with the pin filtered out, the beam's far end
    expect(pickBack(m, { origin: [-5, 0.1, 0.1], dir: [1, 0, 0] }, { filter: (p) => p.id === 1 })).toMatchObject({ partId: 1, cellIndex: 2, dir: 0 });
    // a 1-cell pin wholly inside the hole: both leave the shared cube at once. As for the front pick
    // the pin wins through an axial face within R_ROD of the axis, the hole everywhere else.
    const one = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2)]);
    expect(pickBack(one, { origin: [0.01, 0.02, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 2, dir: 5 });
    expect(pickBack(one, { origin: [R_ROD + 0.02, 0.02, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 1, dir: 5 });
    expect(pickBack(one, { origin: [0.01, 5, 0.02], dir: [0, -1, 0] })).toMatchObject({ partId: 1, dir: 3 });
    expect(pickBack(one, { origin: [0.01, 0.02, 5], dir: [0, 0, -1] }, { filter: (p) => p.id === 1 })).toMatchObject({ partId: 1, dir: 5 });
    // a pin flush with the back of the beam, sticking out in front: seen along it, its far end
    const flush = modelOf([0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)), [c(1, 0, 0, 'pin', 2), c(1, 0, 1, 'pin', 2)]);
    expect(pickBack(flush, { origin: [1.05, 0.03, 9], dir: [0, 0, -1] })).toMatchObject({ partId: 2, cellIndex: idx(flush, 2, 1, 0, 0), dir: 5 });
    for (let k = 0; k < 300; k++) {
      const r = randomRay(lcg(31 + k), 2, [1, 0, 0]);
      expectAgree(pickBack(flush, r), refBack(flush, r), `flush #${k}`);
      expectAgree(pickBack(one, r), refBack(one, r), `one #${k}`);
    }
    const R = lcg(17);
    for (let k = 0; k < 400; k++) {
      const r = randomRay(R, 2, [1, 0, 0]);
      expectAgree(pickBack(m, r), refBack(m, r), `pin #${k}`);
    }
  });

  it('wheels: far flat face → virtual cell, tread → hub lateral face, crank hole and hub cubes merge with the disc', () => {
    const w = (more: Cell[] = []) => addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 2, 2.5), ...more]).model;
    const m = w();
    // straight down through the disc outside the hub: the far flat face, virtual cell under it
    expect(pickBack(m, { origin: [1.2, 0.9, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 1, cellIndex: 0, dir: 5, virtual: [1, 1, 0] });
    // through the hub: the hub's −Z face (cube before disc on the tie)
    const hub = pickBack(m, { origin: [0.2, -0.3, 5], dir: [0, 0, -1] })!;
    expect(hub).toMatchObject({ cellIndex: 0, dir: 5 });
    expect(hub.virtual).toBeUndefined();
    // edgewise through the disc (and the hub inside it): out through the tread on the far side
    const tr = pickBack(m, { origin: [6, 0.3, 0.1], dir: [-1, 0, 0] })!;
    expect(tr).toMatchObject({ cellIndex: 0, dir: 1, tread: true });
    expect(tr.point[0]).toBeCloseTo(-Math.sqrt(2.5 ** 2 - 0.09), 9);
    // in through the flat face, out through the tread: the hub's face nearest the exit's radial direction
    expect(pickBack(m, rayThrough([1.5, 1.2, 0.5], [1, 0.2, -0.3]))).toMatchObject({ cellIndex: 0, tread: true, dir: 0 });
    // a crank hole in the disc: its own cube ends with the disc's face, so the crank hole is the cell
    const k = w([makeCell(1, 1, 0, 'pinHole', 2)]);
    expect(validateModel(k)).toEqual([]);
    const kh = pickBack(k, { origin: [1.1, 1.05, 5], dir: [0, 0, -1] })!;
    expect(kh).toMatchObject({ cellIndex: 1, pos: [1, 1, 0], dir: 5 });
    expect(kh.virtual).toBeUndefined();
    // across the disc through the crank hole's cube: no crossing where the disc and the cube meet
    const across = pickBack(k, { origin: [-6, 1.1, 0.05], dir: [1, 0, 0] })!;
    expect(across.tread).toBe(true);
    expect(across.point[0]).toBeCloseTo(Math.sqrt(2.5 ** 2 - 1.21), 9);
    // a 3-long axle through the hub sticking out both sides: down the axle the hub's far face is
    // still inside the axle (§7.3 both ways, as updated after the M7 review; was: the wheel's far
    // face), so the axle's far end; through the disc beside the hub, the wheel's far face
    const ax = addPart(m, [makeCell(0, 0, -1, 'axle', 2), makeCell(0, 0, 0, 'axle', 2), makeCell(0, 0, 1, 'axle', 2)]).model;
    expect(validateModel(ax)).toEqual([]);
    expect(pickBack(ax, { origin: [0.05, 0.02, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 2, cellIndex: 0, pos: [0, 0, -1], dir: 5 });
    expect(pickBack(ax, { origin: [1.2, 0.02, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 1, cellIndex: 0, dir: 5, virtual: [1, 0, 0] });
    const R = lcg(19);
    for (const model of [m, k, ax]) {
      for (let i = 0; i < 400; i++) {
        const r = randomRay(R, 3);
        expectAgree(pickBack(model, r), refBack(model, r), `wheel #${i}`);
      }
    }
  });

  it('edges and corners: tied faces report one whose neighbour is not the part’s own; own-cube edges are no crossing', () => {
    const one = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    // out exactly through the corner (½, ½, ½): all three tied, |dir| equal → +X
    expect(pickBack(one, { origin: [-2, -2, -2], dir: [1, 1, 1] })).toMatchObject({ dir: 0 });
    // with (1, 0, 0) in the same part, +X would face the part's own cell: +Y instead
    const two = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)]);
    expect(pickBack(two, { origin: [-2, -2, -2], dir: [1, 1, 1] })).toMatchObject({ cellIndex: 0, dir: 2 });
    // through an edge into a diagonal cell of the same part: no crossing there
    const L = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(1, 1, 0, 'pinHole', 2)]);
    const h = pickBack(L, { origin: [-2, -2, 0.1], dir: [1, 1, 0] })!;
    expect(h.cellIndex).toBe(idx(L, 1, 1, 1, 0));
    expect(h.point[0]).toBeCloseTo(1.5, 12);
    // in a face plane between two cells of the same part, leaving through their common back plane
    const p = pickBack(two, { origin: [0.5, 0.1, 5], dir: [0, 0, -1] })!;
    expect(p).toMatchObject({ cellIndex: 0, dir: 5 });
    // along an outer edge of the beam (grazes count as inside the slab)
    expect(pickBack(two, { origin: [-5, 0.5, 0.5], dir: [1, 0, 0] })).toMatchObject({ cellIndex: 1, dir: 0 });
    // a ray that only touches an edge: nothing
    expect(pickBack(one, { origin: [0.5, 0.5, 5], dir: [0, -1, -1] })).toBeNull();
  });

  it('transforms (simulate mode) and filters: as pickCell; null transform skips the part', () => {
    const m = modelOf([0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)), [c(1, 0, -1, 'pin', 2), c(1, 0, 0, 'pin', 2), c(1, 0, 1, 'pin', 2)]);
    const R = lcg(23);
    for (let k = 0; k < 300; k++) {
      const q = norm([R() - 0.5, R() - 0.5, R() - 0.5]);
      const ang = R() * Math.PI;
      const tfs = new Map<number, PartTransform>([
        [1, { p: [R() - 0.5, R() - 0.5, R() - 0.5], q: [q[0] * Math.sin(ang / 2), q[1] * Math.sin(ang / 2), q[2] * Math.sin(ang / 2), Math.cos(ang / 2)] }],
        [2, k % 3 === 0 ? { p: [0, 0, 0], q: [0, 0, 0, 1] } : { p: [R() - 0.5, 0, 0], q: [0, 0, Math.sin(0.1), Math.cos(0.1)] }],
      ]);
      const tf = (id: number) => tfs.get(id) ?? null;
      const r = randomRay(R, 2.5, [1, 0, 0]);
      const h = pickBack(m, r, { transform: tf });
      expectAgree(h, refBack(m, r, tf), `tf #${k}`);
      if (h) {
        // point is world space; normal is the world exit normal (points along the ray)
        const T = tfs.get(h.partId)!;
        expect(h.point[0]).toBeCloseTo(r.origin[0] + h.t * r.dir[0], 9);
        expect(h.normal[0] * r.dir[0] + h.normal[1] * r.dir[1] + h.normal[2] * r.dir[2]).toBeGreaterThan(0);
        const back = mulT(qmat(T.q), [h.point[0] - T.p[0], h.point[1] - T.p[1], h.point[2] - T.p[2]]);
        for (let a = 0; a < 3; a++) expect(back[a]).toBeCloseTo(h.localPoint[a]!, 9);
      }
    }
    const skip = (id: number) => (id === 1 ? null : { p: [0, 0, 0] as V3, q: [0, 0, 0, 1] as const });
    expect(pickBack(m, { origin: [0.1, 5, 0.1], dir: [0, -1, 0] }, { transform: skip })).toBeNull();
    expect(pickBack(m, { origin: [1.1, 5, 0.1], dir: [0, -1, 0] }, { transform: skip })).toMatchObject({ partId: 2 });
    expect(pickBack(m, { origin: [0.1, 5, 0.1], dir: [0, -1, 0] }, { filter: (p) => p.id !== 1 })).toBeNull();
    expect(pickBack(m, { origin: [0, 0, 0], dir: [0, 0, 0] })).toBeNull();
    expect(pickBack(m, { origin: [NaN, 0, 0], dir: [1, 0, 0] })).toBeNull();
  });

  it('a ray starting inside a part: inside = true, the exit ahead', () => {
    const m = modelOf([0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)));
    const h = pickBack(m, { origin: [0.2, 0.1, 0.1], dir: [1, 0, 0] })!;
    expect(h).toMatchObject({ cellIndex: 2, dir: 0, inside: true });
    expect(h.t).toBeCloseTo(2.3, 12);
  });

  it('fuzz: random models (wheels included) and random rays agree with the reference', () => {
    const R = lcg(4242);
    let hits = 0;
    let virt = 0;
    let tread = 0;
    let rays = 0;
    for (let trial = 0; trial < 50; trial++) {
      const m = randomModel(R);
      for (let k = 0; k < 120; k++) {
        const r = randomRay(R);
        const h = pickBack(m, r);
        expectAgree(h, refBack(m, r), `trial ${trial} ray ${k}`);
        // null exactly when the front pick is null
        expect(h === null).toBe(pickCell(m, r) === null);
        rays++;
        if (h) {
          hits++;
          if (h.virtual) virt++;
          if (h.tread) tread++;
        }
      }
    }
    expect(rays).toBe(6000);
    expect(hits).toBeGreaterThan(1500);
    expect(virt).toBeGreaterThan(50);
    expect(tread).toBeGreaterThan(50);
  });

  it('the examples (four-bar, Cart, …) agree with the reference', () => {
    const R = lcg(99);
    for (const name of ['four-bar', 'cart', 'crank-wheel', 'triple-pendulum', 'collision']) {
      const m = exampleByName(name)!.build();
      const cells = m.parts.flatMap((p) => p.cells);
      const lo = [0, 1, 2].map((a) => Math.min(...cells.map((q) => [q.x, q.y, q.z][a]!)));
      const hi = [0, 1, 2].map((a) => Math.max(...cells.map((q) => [q.x, q.y, q.z][a]!)));
      const centre = lo.map((v, a) => (v + hi[a]!) / 2);
      const spread = Math.max(...hi.map((v, a) => v - lo[a]!)) / 2 + 1;
      for (let k = 0; k < 300; k++) {
        const r = randomRay(R, spread, centre);
        expectAgree(pickBack(m, r), refBack(m, r), `${name} #${k}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// resolveBuild on a back-face pick

/** Everything but description / shiftHint / backSide / apply must equal the front hover's. */
function comparable(p: Proposal): Record<string, unknown> {
  const { description: _d, shiftHint: _h, backSide: _b, apply: _a, ...rest } = p;
  return rest;
}

/** The back-side description: the front one with " · back side (dir)" before " — reason". */
function expectedDescription(q: Proposal, dir: Dir): string {
  const tail = q.valid ? '' : ` — ${q.reason}`;
  return `${q.description.slice(0, q.description.length - tail.length)} · back side (${DIR_LABELS[dir]})${tail}`;
}

/** resolveBuild on the back pick equals resolveBuild on `front` (the same face hovered from behind). */
function checkEquivalent(m: Model, back: CellPick, front: CellPick, s: ToolState): Proposal {
  const p = resolveBuild(m, back, null, s);
  const q = resolveBuild(m, front, null, s);
  expect(comparable(p)).toEqual(comparable(q));
  if (q.action === 'none' && q.reason) {
    // a refusal with a reason (a wheel's tread, fixer's ruling): the same, said for Back side
    const tail = ` — ${q.reason}`;
    expect(p.description).toBe(`${q.description.slice(0, q.description.length - tail.length)} · back side (${DIR_LABELS[back.dir]})${tail}`);
    expect(p.backSide).toBe(true);
  } else if (q.action === 'none') {
    expect(p.description).toBe(q.description);
    expect(p.backSide).toBe(false);
  } else {
    expect(p.description).toBe(expectedDescription(q, back.dir));
    expect(p.shiftHint).toBe(q.shiftHint ? `${q.shiftHint} · back side (${DIR_LABELS[back.dir]})` : '');
    expect(p.backSide).toBe(true);
    expect(q.backSide).toBe(false);
  }
  if (q.valid) expect(JSON.stringify(p.apply(m))).toBe(JSON.stringify(q.apply(m)));
  else expect(() => p.apply(m)).toThrow();
  return p;
}

const samePick = (a: PickHit | null, b: PickHit): boolean =>
  !!a && a.partId === b.partId && a.cellIndex === b.cellIndex && a.dir === b.dir && JSON.stringify(a.virtual) === JSON.stringify(b.virtual) && !!a.tread === !!b.tread;

/** The cell beyond the picked back face (where Extend / New adjacent would go). */
function beyond(m: Model, h: PickHit): Vec3i {
  const n = DIRS[h.dir]!;
  const base = h.virtual ?? h.pos;
  return [base[0] + n[0], base[1] + n[1], base[2] + n[2]];
}

/**
 * For a back pick h along `ray`: the front pick of the same face from behind. Tries, in order, the
 * reversed ray from far behind ('visible'), the same with only h's part pickable ('otherPart': another
 * part is in the way from behind — e.g. it abuts the face, or a male in a hole wins the front pick),
 * and the reversed ray from just behind the face with only h's part ('selfOccluded': a concave part
 * hides its own face from far behind). Returns the category and the front pick.
 */
function fromBehind(m: Model, ray: Ray, h: PickHit): { cat: string; front: PickHit } {
  const d = norm(ray.dir);
  const far: Ray = { origin: [h.point[0] + d[0] * 40, h.point[1] + d[1] * 40, h.point[2] + d[2] * 40], dir: [-d[0], -d[1], -d[2]] };
  const f1 = pickCell(m, far);
  if (samePick(f1, h)) return { cat: 'visible', front: f1! };
  const only = { filter: (p: Part) => p.id === h.partId };
  const f2 = pickCell(m, far, only);
  const abuts = cellsAt(m, beyond(m, h)).some((e) => e.partId !== h.partId);
  if (samePick(f2, h)) return { cat: abuts ? 'abuts' : 'otherPart', front: f2! };
  const near: Ray = { origin: [h.point[0] + d[0] * 1e-3, h.point[1] + d[1] * 1e-3, h.point[2] + d[2] * 1e-3], dir: far.dir };
  const f3 = pickCell(m, near, only);
  if (samePick(f3, h)) return { cat: abuts ? 'abuts' : 'selfOccluded', front: f3! };
  throw new Error(`back pick ${JSON.stringify({ p: h.partId, c: h.cellIndex, d: h.dir, v: h.virtual, t: h.tread })} not seen from behind: ${JSON.stringify(f3 && { p: f3.partId, c: f3.cellIndex, d: f3.dir, v: f3.virtual })}`);
}

describe('resolveBuild on a back-face pick (§7.3)', () => {
  it('a beam: Extend on the face the ray leaves, " · back side (−Z)"', () => {
    const m = modelOf([0, 1, 2, 3, 4].map((x) => c(x, 0, 0, 'pinHole', 2)));
    // along the beam: Extend at x = 5
    const r1: Ray = { origin: [-5, 0.1, 0.1], dir: [1, 0, 0] };
    const p = resolveBuild(m, buildPick(m, r1, st('pinHole', { backSide: true })), null, st('pinHole', { backSide: true }));
    expect(p).toMatchObject({ action: 'extend', backSide: true, highlight: { pos: [4, 0, 0], dir: 0 } });
    expect(p.cell).toMatchObject({ x: 5, y: 0, z: 0 });
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Z · back side (+X)');
    // from the front (+Z) of the middle: its back face (−Z)
    const r2: Ray = { origin: [2.1, 0.1, 5], dir: [0, 0, -1] };
    const q = resolveBuild(m, buildPick(m, r2, st('pinHole', { backSide: true })), null, st('pinHole'));
    expect(q.cell).toMatchObject({ x: 2, y: 0, z: -1 });
    expect(q.description).toBe('Extend part 1 · pin hole ∥ Z · back side (−Z)');
    // a back pick decides, not state.backSide; a front pick with backSide on resolves as the front
    const fp = pickCell(m, r2)!;
    expect(resolveBuild(m, fp, null, st('pinHole', { backSide: true })).description).toBe('Extend part 1 · pin hole ∥ Z');
  });

  it('buildPick: back pick only for a build tool with Back side; the front hit is reused otherwise', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    const r: Ray = { origin: [0.1, 0.1, 5], dir: [0, 0, -1] };
    const front = pickCell(m, r);
    expect(buildPick(m, r, st('pin', { backSide: true }))).toMatchObject({ dir: 5, back: true });
    expect(buildPick(m, r, withModifiers(st('pin'), { alt: true }))).toMatchObject({ dir: 5, back: true });
    expect(buildPick(m, r, st('pin'), front)).toBe(front);
    expect(buildPick(m, r, st('pin'))).toMatchObject({ dir: 4 });
    expect(buildPick(m, r, st('select', { backSide: true }), front)).toBe(front);
    expect(buildPick(m, r, st('erase', { backSide: true }), front)).toBe(front);
    expect(buildPick(m, { origin: [5, 5, 5], dir: [0, 0, -1] }, st('pin', { backSide: true }))).toBeNull();
  });

  it('a back face that abuts another part: picked, and the usual rules decide', () => {
    // A (part 1) at z = 0 and B (part 2) right behind it at z = −1
    const m = modelOf([0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)), [0, 1, 2].map((x) => c(x, 0, -1, 'pinHole', 2)));
    const r: Ray = { origin: [0.1, 0.1, 5], dir: [0, 0, -1] };
    const h = pickBack(m, r)!;
    expect(h).toMatchObject({ partId: 1, cellIndex: 0, dir: 5 });
    // not visible from far behind (B is there): equivalent to hovering it from just behind, B filtered out
    const { cat, front } = fromBehind(m, r, h);
    expect(cat).toBe('abuts');
    // pin: Extend into B's hole is invalid, so the pin is inserted into A's hole from behind
    const p = checkEquivalent(m, h, front, st('pin'));
    expect(p.action).toBe('insert');
    expect(p.highlight).toEqual({ pos: [0, 0, 0], dir: 5 });
    expect(p.description).toMatch(/· back side \(−Z\)$/);
    // a hole tool: Extend part 1 at (0, 0, −1) collides with B → invalid, with the reason
    const q = checkEquivalent(m, h, front, st('pinHole'));
    expect(q.valid).toBe(false);
    expect(q.description).toMatch(/^Extend part 1 · pin hole ∥ Z · back side \(−Z\) — /);
    expect(q.reason).toBeTruthy();
    // B seen from behind A? No: with Back side the ray leaves A first. From behind B: B's +Z face, abutting A
    const hb = pickBack(m, { origin: [1.1, 0.1, -5], dir: [0, 0, 1] })!;
    expect(hb).toMatchObject({ partId: 2, dir: 4 });
  });

  it('a concave part hiding its own back face from far behind: equivalent to hovering it from just behind', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pinHole', 2), c(0, 2, 0, 'pinHole', 2), c(2, 1, 0, 'pinHole', 2), c(2, 2, 0, 'pinHole', 2)]);
    const r: Ray = { origin: [-5, 2.1, 0.1], dir: [1, 0, 0] };
    const h = pickBack(m, r)!;
    expect(h).toMatchObject({ cellIndex: idx(m, 1, 0, 2, 0), dir: 0 });
    const { cat, front } = fromBehind(m, r, h);
    expect(cat).toBe('selfOccluded');
    for (const kind of KINDS) {
      const p = checkEquivalent(m, h, front, st(kind));
      expect(p.highlight).toEqual({ pos: [0, 2, 0], dir: 0 });
    }
    // a hole tool fills the gap of the U from the inside of the left arm
    const p = resolveBuild(m, h, null, st('pinHole'));
    expect(p).toMatchObject({ action: 'extend', valid: true, cell: { x: 1, y: 2, z: 0 } });
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Z · back side (+X)');
  });

  it('sleeve from behind: a hole tool on a pin, seen along its length', () => {
    const m = modelOf([c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);
    const r: Ray = { origin: [0.05, 0.02, 5], dir: [0, 0, -1] };
    const h = pickBack(m, r)!;
    expect(h).toMatchObject({ cellIndex: 0, dir: 5 });
    const p = checkEquivalent(m, h, fromBehind(m, r, h).front, st('pinHole'));
    expect(p.highlight).toEqual({ pos: [0, 0, 0], dir: 5 });
    expect(p.action).toBe('sleeve');
    expect(p.cell).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('wheels: a crank hole on the far flat face; a tread exit is refused (fixer’s ruling)', () => {
    const m = addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 2, 2.5)]).model;
    const r: Ray = { origin: [1.2, 1.1, 5], dir: [0, 0, -1] };
    const h = pickBack(m, r)!;
    const p = resolveBuild(m, h, null, st('pinHole'));
    expect(p.backSide).toBe(true);
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Z in the wheel · back side (−Z)');
    expect(p.highlight).toEqual({ pos: [1, 1, 0], dir: 5 });
    expect(p.cell).toMatchObject({ x: 1, y: 1, z: 0 });
    expect(resolveBuild(m, h, null, st('pinHole', { newPart: true })).cell).toMatchObject({ x: 1, y: 1, z: -1 });
    checkEquivalent(m, h, fromBehind(m, r, h).front, st('pinHole'));
    const rt: Ray = { origin: [6, 0.3, 0.1], dir: [-1, 0, 0] };
    const ht = pickBack(m, rt)!;
    expect(ht.tread).toBe(true);
    // Was: resolved as the hub's lateral face (a highlight not under the cursor, a cell buried in
    // the disc). Now refused with the way to do it, like a front tread hover.
    const pt = resolveBuild(m, ht, null, st('pinHole'));
    expect(pt.action).toBe('none');
    expect(pt.backSide).toBe(true);
    expect(pt.description).toBe("Part 1 · wheel tread · back side (−X) — point at the wheel's flat face or at a hole to build on a wheel");
  });

  it('Shift, New part and [R] combine with Back side', () => {
    const m = modelOf([0, 1, 2, 3, 4].map((x) => c(x, 0, 0, 'pinHole', 2)));
    const r: Ray = { origin: [-5, 0.1, 0.1], dir: [1, 0, 0] };
    const sa = withModifiers(st('pinHole'), { shift: true, alt: true });
    expect(sa).toMatchObject({ newPart: true, backSide: true, shiftHeld: true, altHeld: true });
    const h = buildPick(m, r, sa)!;
    const front = fromBehind(m, r, h).front;
    const p = checkEquivalent(m, h, front, sa);
    expect(p.action).toBe('newAdjacent');
    expect(p.cell).toMatchObject({ x: 5 });
    expect(p.description).toBe('New part · pin hole ∥ Z · back side (+X)');
    expect(comparable(resolveBuild(m, h, null, st('pinHole', { newPart: true, backSide: true })))).toEqual(comparable(p));
    // [R]: cycles within the back face's options and persists
    const s0 = st('pinHole', { backSide: true });
    const q0 = checkEquivalent(m, h, front, s0);
    expect(q0.options.length).toBeGreaterThan(1);
    const s1 = cycleOrientation(s0, q0);
    expect(s1.backSide).toBe(true);
    expect(checkEquivalent(m, h, front, s1).cell!.axis).toBe(q0.options[1]);
    // the Shift hint is said as a back-side click and is what Shift + Back side does
    const q = resolveBuild(m, h, null, s0);
    expect(q.shiftHint).toBe(`Shift: ${resolveBuild(m, h, null, withModifiers(s0, { shift: true })).description}`);
  });

  it('grid hover with Back side on (nothing under the cursor) is unchanged; Select and Erase ignore it', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    for (const kind of KINDS) {
      const a = resolveBuild(m, null, { pos: [3, 0, 2] }, st(kind, { backSide: true }));
      const b = resolveBuild(m, null, { pos: [3, 0, 2] }, st(kind));
      expect(comparable(a)).toEqual(comparable(b));
      expect(a.description).toBe(b.description);
      expect(a.backSide).toBe(false);
    }
    const r: Ray = { origin: [0.1, 0.1, 5], dir: [0, 0, -1] };
    const front = pickCell(m, r);
    expect(resolveBuild(m, front, null, st('select', { backSide: true })).action).toBe('none');
    expect(resolveBuild(m, front, null, st('erase', { backSide: true })).action).toBe('none');
    expect(resolveSelect(m, front).partId).toBe(1);
    expect(resolveErase(m, front).valid).toBe(true);
  });

  it('a stale back pick gives no proposal', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    expect(resolveBuild(m, { partId: 9, cellIndex: 0, dir: 0, back: true }, null, st('pin')).action).toBe('none');
    expect(resolveBuild(m, { partId: 1, cellIndex: 3, dir: 0, back: true }, null, st('pin')).action).toBe('none');
  });

  it('fuzz: the back pick resolves exactly as the same face front-picked from behind', () => {
    const R = lcg(777);
    const cats = { visible: 0, otherPart: 0, abuts: 0, selfOccluded: 0 } as Record<"visible" | "otherPart" | "abuts" | "selfOccluded", number>;
    let checked = 0;
    for (let trial = 0; trial < 40; trial++) {
      const m = randomModel(R);
      for (let k = 0; k < 40; k++) {
        const r = randomRay(R);
        const h = pickBack(m, r);
        if (!h) continue;
        const { cat, front } = fromBehind(m, r, h);
        cats[cat as keyof typeof cats]++;
        const kind = KINDS[Math.floor(R() * 5)]!;
        const s = st(kind, { newPart: R() < 0.3, axisPref: R() < 0.5 ? null : AXES[Math.floor(R() * 3)]! });
        checkEquivalent(m, h, front, s);
        // and with Shift held through withModifiers (the app's path)
        checkEquivalent(m, h, front, withModifiers(st(kind), { shift: R() < 0.5, alt: true }));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    // every category occurs (the counts are reported, not tuned)
    expect(cats.visible).toBeGreaterThan(100);
    expect(cats.abuts).toBeGreaterThan(10);
    expect(cats.selfOccluded + cats.otherPart).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------------------------
// State

describe('Back side: a male and its hole are one solid both ways (§7.3, M7 review)', () => {
  // beam (part 1) (0..4, 0, 0) ∥ Z holes; an axle (part 2) (2, 0, −1..1) through its middle hole
  const beam = () => [0, 1, 2, 3, 4].map((x) => c(x, 0, 0, 'pinHole', 2));
  const axleBeam = () => modelOf(beam(), [c(2, 0, -1, 'axle', 2), c(2, 0, 0, 'axle', 2), c(2, 0, 1, 'axle', 2)]);
  const pinBeam = () => modelOf(beam(), [c(2, 0, 0, 'pin', 2), c(2, 0, 1, 'pin', 2)]);

  it('axle through a beam, along the rod: the axle’s far end, and the click extends the axle', () => {
    const m = axleBeam();
    expect(validateModel(m)).toEqual([]);
    // FRONT view straight down the axle (review: the beam's −Z face at z = −½, buried in the axle)
    for (const [x, y] of [[2, 0], [2.05, 0.03], [1.7, -0.4], [2.45, 0.45]] as const) {
      const r: Ray = { origin: [x, y, 20], dir: [0, 0, -1] };
      const h = pickBack(m, r)!;
      expect(h, `${x},${y}`).toMatchObject({ partId: 2, pos: [2, 0, -1], dir: 5, back: true });
      expect(h.point[2]).toBeCloseTo(-1.5, 12);
      expectAgree(h, refBack(m, r), `axle ${x},${y}`);
    }
    // and the axle tool with Alt there extends the axle to (2, 0, −2)
    const s = withModifiers(st('axle'), { alt: true });
    const r: Ray = { origin: [2.05, 0.03, 20], dir: [0, 0, -1] };
    const p = resolveBuild(m, buildPick(m, r, s), null, s);
    expect(p).toMatchObject({ valid: true, action: 'extend', backSide: true });
    expect([p.cell!.x, p.cell!.y, p.cell!.z]).toEqual([2, 0, -2]);
    expect(p.description).toMatch(/back side \(−Z\)/);
    const res = p.apply(m);
    expect(res.partId).toBe(2);
    expect(partById(res.model, 2)!.cells.map((q) => q.z).sort()).toEqual([-1, -2, 0, 1].sort());
    // from behind (+Z travel) symmetrically: the axle's far end at z = +1.5
    expect(pickBack(m, { origin: [2.1, 0.1, -20], dir: [0, 0, 1] })).toMatchObject({ partId: 2, pos: [2, 0, 1], dir: 4 });
    // beside the axle (another hole's square): the beam's own back face
    expect(pickBack(m, { origin: [1.1, 0.1, 20], dir: [0, 0, -1] })).toMatchObject({ partId: 1, pos: [1, 0, 0], dir: 5 });
  });

  it('axle through a beam, across the rod: unchanged (the beam leaves where the axle does, or the axle where it sticks out)', () => {
    const m = axleBeam();
    // down −Y through the shared cell: both leave it at y = −½, the hole's part wins (as before)
    expect(pickBack(m, { origin: [2.1, 20, 0.05], dir: [0, -1, 0] })).toMatchObject({ partId: 1, pos: [2, 0, 0], dir: 3 });
    // down −Y through the axle where it sticks out behind the beam: the axle
    expect(pickBack(m, { origin: [2.1, 20, -1.05], dir: [0, -1, 0] })).toMatchObject({ partId: 2, pos: [2, 0, -1], dir: 3 });
    // along the beam (+X) through the axle: the axle is buried in the beam, the beam's far end
    expect(pickBack(m, { origin: [-20, 0.1, 0.1], dir: [1, 0, 0] })).toMatchObject({ partId: 1, pos: [4, 0, 0], dir: 0 });
    // along the beam just behind it (z −1): only the axle's stub is crossed
    expect(pickBack(m, { origin: [-20, 0.1, -1.1], dir: [1, 0, 0] })).toMatchObject({ partId: 2, pos: [2, 0, -1], dir: 0 });
    const R = lcg(4242);
    for (let k = 0; k < 600; k++) {
      const r = randomRay(R, 3, [2, 0, 0]);
      expectAgree(pickBack(m, r), refBack(m, r), `axleBeam #${k}`);
    }
  });

  it('pin in a beam (flush behind, proud in front), along and across the rod', () => {
    const m = pinBeam();
    expect(validateModel(m)).toEqual([]);
    // along the rod from the front: the beam's face at z = −½ and the pin's end coincide; the pin
    // wins within R_ROD of the axis (as for the front pick), the hole outside it
    expect(pickBack(m, { origin: [2.02, 0.01, 20], dir: [0, 0, -1] })).toMatchObject({ partId: 2, pos: [2, 0, 0], dir: 5 });
    expect(pickBack(m, { origin: [2 + R_ROD + 0.05, 0.01, 20], dir: [0, 0, -1] })).toMatchObject({ partId: 1, pos: [2, 0, 0], dir: 5 });
    // along the rod from behind: in through the beam, still inside the pin at the beam's front face
    // z = +½ (was: that face, buried in the pin), so the pin's front end at z = 1.5
    expect(pickBack(m, { origin: [2.3, 0.3, -20], dir: [0, 0, 1] })).toMatchObject({ partId: 2, pos: [2, 0, 1], dir: 4 });
    // across: down −Y through the shared cell, the hole's part; through the proud end, the pin
    expect(pickBack(m, { origin: [2.1, 20, 0.05], dir: [0, -1, 0] })).toMatchObject({ partId: 1, pos: [2, 0, 0], dir: 3 });
    expect(pickBack(m, { origin: [2.1, 20, 1.05], dir: [0, -1, 0] })).toMatchObject({ partId: 2, pos: [2, 0, 1], dir: 3 });
    // along the beam: the pin is buried, the beam's far end
    expect(pickBack(m, { origin: [20, 0.1, 0.1], dir: [-1, 0, 0] })).toMatchObject({ partId: 1, pos: [0, 0, 0], dir: 1 });
    const R = lcg(777);
    for (let k = 0; k < 600; k++) {
      const r = randomRay(R, 3, [2, 0, 0]);
      expectAgree(pickBack(m, r), refBack(m, r), `pinBeam #${k}`);
    }
  });

  it('an axle through two stacked beams: no beam face inside it is picked', () => {
    const m = modelOf(beam(), [0, 1, 2, 3, 4].map((x) => c(x, 0, 1, 'pinHole', 2)), [-1, 0, 1, 2].map((z) => c(2, 0, z, 'axle', 2)));
    expect(validateModel(m)).toEqual([]);
    expect(pickBack(m, { origin: [2.1, 0.1, 20], dir: [0, 0, -1] })).toMatchObject({ partId: 3, pos: [2, 0, -1], dir: 5 });
    expect(pickBack(m, { origin: [2.1, 0.1, -20], dir: [0, 0, 1] })).toMatchObject({ partId: 3, pos: [2, 0, 2], dir: 4 });
    // the rod is the axle's cells in line through the hole; a hole part filtered out changes nothing
    expect(pickBack(m, { origin: [2.1, 0.1, 20], dir: [0, 0, -1] }, { filter: (p) => p.id !== 1 })).toMatchObject({ partId: 3, pos: [2, 0, -1] });
    // with the axle filtered out the beams are no longer extended by it: the front beam's back face
    expect(pickBack(m, { origin: [2.1, 0.1, 20], dir: [0, 0, -1] }, { filter: (p) => p.id !== 3 })).toMatchObject({ partId: 2, pos: [2, 0, 1], dir: 5 });
  });
});

describe('Back side state', () => {
  it('Alt never latches backSide; the [B] toggle survives tool changes and modifiers', () => {
    const base = st('pin');
    const alt = withModifiers(base, { alt: true });
    expect(alt.backSide).toBe(true);
    expect(withModifiers(alt, {})).toEqual(base);
    expect(withShift(alt, false)).toEqual(base);
    expect(selectTool(alt, 'axle').backSide).toBe(false);
    expect(pickColor(alt, '#112233').backSide).toBe(false);
    expect(setNewPart(alt, true)).toMatchObject({ newPart: true, backSide: false });
    expect(setBackSide(alt, true).altHeld).toBeUndefined();
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    const p = resolveBuild(m, pickBack(m, { origin: [5, 0.1, 0.1], dir: [-1, 0, 0] }), null, alt);
    expect(p.backSide).toBe(true);
    expect(cycleOrientation(alt, p).backSide).toBe(false);
    const on = st('pin', { backSide: true });
    expect(withModifiers(on, { alt: true })).toBe(on);
    expect(withModifiers(on, { alt: false })).toBe(on);
    expect(selectTool(on, 'erase').backSide).toBe(true);
    expect(selectTool(selectTool(on, 'erase'), 'pin').backSide).toBe(true);
    const both = withModifiers(base, { shift: true, alt: true });
    expect(withModifiers(both, { alt: true })).toMatchObject({ newPart: false, backSide: true });
    expect(initialToolState().backSide).toBe(false);
  });
});
