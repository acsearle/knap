// Ray picking against cell bounding cubes and the reference grid (DESIGN.md §7.3). Pure.
//
// See the header of ./index.ts for the contract. Summary:
//   pickCell(model, ray, opts?) -> nearest cell cube hit (part, cell, face entered) or null
//   pickGrid(ray)               -> grid cell [x, 0, z] under the ray on the plane y = −½, or null
import { DIRS, axisOfDir, cellsAt, isHole, isMale, worldIndex } from '../core';
import type { Axis, Cell, Dir, Model, Part, Vec3i } from '../core';
import { R_ROD } from '../geometry/dims';

/** A point or direction in world units. Plain tuples (compatible with src/physics/math.ts). */
export type Vec3 = readonly [number, number, number];
/** Unit quaternion [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

/**
 * A ray: points origin + t·dir for t >= 0. `dir` need not be normalised (it must be non-zero);
 * `t` in results is in units of |dir| (= world distance when dir is a unit vector).
 */
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/**
 * Rigid transform applied to a part's edit-time world placement (as Simulation.partTransform):
 * world = rotate(q, editPoint) + p.
 */
export interface PartTransform {
  p: Vec3;
  q: Quat;
}

/** Per-part transform. Returning null makes the part unpickable (e.g. removed from the sim). */
export type TransformLookup = (partId: number) => PartTransform | null;

export interface PickOptions {
  /** Omitted: every part at its edit-time placement (edit mode). */
  transform?: TransformLookup;
  /** Only parts for which this returns true are considered. */
  filter?: (part: Part) => boolean;
}

export interface PickHit {
  partId: number;
  /** Index into the part's `cells`. */
  cellIndex: number;
  cell: Cell;
  /** Grid position of the cell (edit-time frame). */
  pos: Vec3i;
  /**
   * Face of the cell's cube through which the ray entered, in the edit-time frame
   * (outward normal DIRS[dir]; the ray came from the neighbour cell pos + DIRS[dir]).
   * For a ray starting inside the cube: the face it would have entered through (the face whose
   * slab bounds the line's entry), so behaviour is continuous as the origin moves into the cube.
   */
  dir: Dir;
  /** Ray parameter of the entry point (0 when the ray starts inside the cube). */
  t: number;
  /** Entry point in world space (= origin + t·dir). */
  point: Vec3;
  /** Entry point in the edit-time model frame (equals `point` without transforms). */
  localPoint: Vec3;
  /** Outward normal of the entered face, world space. */
  normal: Vec3;
  /** The ray origin was inside (or on the boundary of) this cube. */
  inside: boolean;
}

export interface GridHit {
  /** Grid cell above the plane: [x, 0, z]. */
  pos: Vec3i;
  /** Intersection with the plane y = −½, world. */
  point: Vec3;
  t: number;
  /** Side of the plane the ray came from: 2 (+Y, from above) or 3 (−Y, from below). */
  dir: Dir;
}

/** The reference grid plane (cell boundaries below the y = 0 layer). */
export const GRID_Y = -0.5;

// ---------------------------------------------------------------------------------------------
// Quaternion helpers (local; the editor may not import src/physics)

function rotate(q: Quat, v: Vec3): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

function conj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

function sameTransform(a: PartTransform, b: PartTransform): boolean {
  if (a === b) return true;
  const dp = Math.abs(a.p[0] - b.p[0]) + Math.abs(a.p[1] - b.p[1]) + Math.abs(a.p[2] - b.p[2]);
  const dq = Math.abs(a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3]);
  return dp < 1e-9 && dq > 1 - 1e-12;
}

// ---------------------------------------------------------------------------------------------
// Ray / box

/** Result scratch of rayBox (module-level to avoid allocation in the inner loop). */
let hitT = 0;
let hitNear = 0;
let hitAxis = 0;
/** Bit mask of the slabs whose entry parameter ties exactly with the entry (incl. hitAxis). */
let hitTies = 0;

/** Minimum positive length of the ray inside a box for it to count (edge/corner grazes miss). */
const MIN_SPAN = 1e-9;

/**
 * Slab test of the ray against the box [lo, hi] (closed). On a hit sets hitNear (entry parameter,
 * may be negative when the origin is inside), hitT = max(hitNear, 0) and hitAxis (the slab of the
 * entry; on an exact tie between slabs, the one with the larger |dir| component, then the lower
 * axis; all tied slabs are reported in hitTies). A ray lying in a face plane counts as inside that slab. Misses when the overlap is
 * shorter than MIN_SPAN (touching an edge or a corner) or lies entirely behind the origin.
 */
function rayBox(
  o: Vec3,
  d: Vec3,
  lx: number, ly: number, lz: number,
  hx: number, hy: number, hz: number,
): boolean {
  let tn = -Infinity;
  let tf = Infinity;
  let ax = -1;
  let adMax = 0;
  let ties = 0;
  for (let a = 0; a < 3; a++) {
    const oa = o[a]!;
    const da = d[a]!;
    const lo = a === 0 ? lx : a === 1 ? ly : lz;
    const hi = a === 0 ? hx : a === 1 ? hy : hz;
    if (da === 0) {
      if (oa < lo || oa > hi) return false;
      continue;
    }
    let t1 = (lo - oa) / da;
    let t2 = (hi - oa) / da;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    const ad = Math.abs(da);
    if (t1 > tn) {
      tn = t1;
      ax = a;
      adMax = ad;
      ties = 1 << a;
    } else if (t1 === tn) {
      ties |= 1 << a;
      if (ad > adMax) {
        ax = a;
        adMax = ad;
      }
    }
    if (t2 < tf) tf = t2;
  }
  if (ax < 0) return false;
  if (!(tf - tn > MIN_SPAN) || !(tf > MIN_SPAN)) return false;
  hitNear = tn;
  hitT = tn > 0 ? tn : 0;
  hitAxis = ax;
  hitTies = ties;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Per-model / per-part caches (models are immutable; see core worldIndex)

interface SharedInfo {
  /** Male cells sharing a position with a hole of another part: tested through the hole's cube. */
  maleOfHole: Map<Cell, { partId: number; cellIndex: number; cell: Cell }>;
  skipMale: Set<Cell>;
  /** Part id of each skipped male's hole partner. */
  holePartOfMale: Map<Cell, number>;
}

const sharedCache = new WeakMap<Model, SharedInfo>();

function sharedInfo(m: Model): SharedInfo {
  let s = sharedCache.get(m);
  if (s) return s;
  s = { maleOfHole: new Map(), skipMale: new Set(), holePartOfMale: new Map() };
  for (const entries of worldIndex(m).map.values()) {
    if (entries.length < 2) continue;
    const hole = entries.find((e) => isHole(e.cell.kind));
    const male = entries.find((e) => isMale(e.cell.kind) && hole && e.partId !== hole.partId);
    if (!hole || !male) continue;
    s.maleOfHole.set(hole.cell, { partId: male.partId, cellIndex: male.index, cell: male.cell });
    s.skipMale.add(male.cell);
    s.holePartOfMale.set(male.cell, hole.partId);
  }
  sharedCache.set(m, s);
  return s;
}

type Box = readonly [number, number, number, number, number, number];
const boxCache = new WeakMap<Part, Box>();

function partBox(p: Part): Box {
  let b = boxCache.get(p);
  if (b) return b;
  let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
  for (const c of p.cells) {
    if (c.x < lx) lx = c.x;
    if (c.y < ly) ly = c.y;
    if (c.z < lz) lz = c.z;
    if (c.x > hx) hx = c.x;
    if (c.y > hy) hy = c.y;
    if (c.z > hz) hz = c.z;
  }
  b = [lx - 0.5, ly - 0.5, lz - 0.5, hx + 0.5, hy + 0.5, hz + 0.5];
  boxCache.set(p, b);
  return b;
}

// ---------------------------------------------------------------------------------------------
// pickCell

const DIR_NORMALS: readonly Vec3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Distance of p from the axis line of the cell at c along `axis`. */
function radial(p: Vec3, c: Cell, axis: Axis): number {
  const dx = p[0] - c.x;
  const dy = p[1] - c.y;
  const dz = p[2] - c.z;
  if (axis === 0) return Math.hypot(dy, dz);
  if (axis === 1) return Math.hypot(dx, dz);
  return Math.hypot(dx, dy);
}

/**
 * Nearest hit of `ray` with the unit cubes of all cells (§7.3: picking is against cell bounding
 * cubes). Shared cells (a male of one part inside a coaxial hole of another): the cube is tested
 * once; the hit goes to the **male** iff the ray enters through an axial face (normal ∥ the
 * axis) at a point strictly within R_ROD of the axis, otherwise to the **hole**. With
 * `opts.transform` this applies only while both parts have the same transform; otherwise both
 * cubes are tested independently. `opts.filter` applies to both partners: if the hole's part is
 * rejected, the male is picked through its own cube; if the male's part is rejected, the hole
 * always wins. Ties in t (edge-on rays between cubes): lower part id, then lower cell index. A
 * ray entering exactly through an edge or corner reports, among the tied faces, the first whose
 * neighbour cell (edit-time frame) is empty. Returns null for a zero `dir` or when nothing is hit.
 *
 * Cost: one box test per part plus one per cell of parts whose box the ray crosses, no
 * allocation per cell — well under a millisecond for a few thousand cells.
 */
export function pickCell(model: Model, ray: Ray, opts: PickOptions = {}): PickHit | null {
  const D = ray.dir;
  if (!(D[0] !== 0 || D[1] !== 0 || D[2] !== 0)) return null;
  if (![...ray.origin, ...D].every(Number.isFinite)) return null;
  const shared = sharedInfo(model);
  const lookup = opts.transform;
  const filter = opts.filter;
  const filterCache = new Map<number, boolean>();
  /** Part `id` passes opts.filter (true without a filter). */
  const allowed = (id: number): boolean => {
    if (!filter) return true;
    let ok = filterCache.get(id);
    if (ok === undefined) {
      const p = model.parts.find((q) => q.id === id);
      ok = !!p && filter(p);
      filterCache.set(id, ok);
    }
    return ok;
  };
  const tfCache = new Map<number, PartTransform | null>();
  const tfOf = (id: number): PartTransform | null => {
    if (!lookup) return null;
    let t = tfCache.get(id);
    if (t === undefined) {
      t = lookup(id) ?? null;
      tfCache.set(id, t);
    }
    return t;
  };

  let best: { part: Part; tf: PartTransform | null; o: Vec3; d: Vec3; cellIndex: number; t: number; axis: number; ties: number; near: number } | null = null;

  for (const part of model.parts) {
    if (!allowed(part.id)) continue;
    let o: Vec3 = ray.origin;
    let d: Vec3 = D;
    let tf: PartTransform | null = null;
    if (lookup) {
      tf = tfOf(part.id);
      if (!tf) continue;
      const qi = conj(tf.q);
      o = rotate(qi, [ray.origin[0] - tf.p[0], ray.origin[1] - tf.p[1], ray.origin[2] - tf.p[2]]);
      d = rotate(qi, D);
    }
    const b = partBox(part);
    if (!rayBox(o, d, b[0], b[1], b[2], b[3], b[4], b[5])) continue;
    if (best && hitT > best.t) continue;
    const cells = part.cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      if (shared.skipMale.has(c)) {
        // Normally represented by its hole partner's cube. Tested on its own when the hole's part
        // is filtered out, or when the two parts are displaced relative to each other (simulation).
        const holePart = shared.holePartOfMale.get(c)!;
        if (allowed(holePart)) {
          if (!lookup) continue;
          const ht = tfOf(holePart);
          if (ht && tf && sameTransform(ht, tf)) continue;
        }
      }
      if (!rayBox(o, d, c.x - 0.5, c.y - 0.5, c.z - 0.5, c.x + 0.5, c.y + 0.5, c.z + 0.5)) continue;
      if (best) {
        if (hitT > best.t + 1e-12) continue;
        if (hitT >= best.t - 1e-12) {
          // tie: lower part id, then lower cell index
          if (part.id > best.part.id || (part.id === best.part.id && i > best.cellIndex)) continue;
        }
      }
      best = { part, tf, o, d, cellIndex: i, t: hitT, axis: hitAxis, ties: hitTies, near: hitNear };
    }
  }
  if (!best) return null;

  const { part, tf, o, d, t } = best;
  let partId = part.id;
  let cellIndex = best.cellIndex;
  let cell = part.cells[cellIndex]!;
  const dirOf = (a: number): Dir => (2 * a + (d[a]! > 0 ? 1 : 0)) as Dir;
  let dir = dirOf(best.axis);
  if (best.ties & ~(1 << best.axis)) {
    // Exact tie (the ray enters through an edge or corner of the cube): it came from the diagonal
    // neighbour, so any tied face is geometrically right. Prefer one whose neighbour cell is empty
    // (edit-time frame), so the face never points into a cube the ray only grazed.
    const free = (dd: Dir): boolean => {
      const n = DIRS[dd]!;
      return cellsAt(model, [cell.x + n[0], cell.y + n[1], cell.z + n[2]]).length === 0;
    };
    if (!free(dir)) {
      for (const a of [0, 1, 2]) {
        if (a === best.axis || !(best.ties & (1 << a))) continue;
        if (free(dirOf(a))) {
          dir = dirOf(a);
          break;
        }
      }
    }
  }
  const localPoint: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  const point: Vec3 = [ray.origin[0] + t * D[0], ray.origin[1] + t * D[1], ray.origin[2] + t * D[2]];

  const male = shared.maleOfHole.get(cell);
  if (male && allowed(male.partId) && axisOfDir(dir) === cell.axis && radial(localPoint, cell, cell.axis) < R_ROD) {
    const maleTf = tfOf(male.partId);
    if (!lookup || (maleTf && tf && sameTransform(maleTf, tf))) {
      partId = male.partId;
      cellIndex = male.cellIndex;
      cell = male.cell;
    }
  }
  const n = DIR_NORMALS[dir]!;
  return {
    partId,
    cellIndex,
    cell,
    pos: [cell.x, cell.y, cell.z],
    dir,
    t,
    point,
    localPoint,
    normal: tf ? rotate(tf.q, n) : n,
    inside: best.near <= 0,
  };
}

// ---------------------------------------------------------------------------------------------
// pickGrid

/**
 * Intersection of the ray with the reference plane y = −½ (§6.1). The grid cell is the one whose
 * footprint contains the point: [round(x), 0, round(z)] (halves round up). Null when the ray is
 * parallel to the plane, points away from it, or is malformed. The plane is unbounded here; the
 * caller may clamp to the drawn grid.
 */
export function pickGrid(ray: Ray): GridHit | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.dir;
  if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return null;
  if (Math.abs(dy) < 1e-12) return null;
  const t = (GRID_Y - oy) / dy;
  if (t < 0) return null;
  const x = ox + t * dx;
  const z = oz + t * dz;
  return {
    pos: [Math.floor(x + 0.5) + 0, 0, Math.floor(z + 0.5) + 0],
    point: [x, GRID_Y, z],
    t,
    dir: dy < 0 ? 2 : 3,
  };
}
