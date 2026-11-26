// Ray picking against cell bounding cubes, wheel discs and the reference grid (DESIGN.md §7.3). Pure.
//
// See the header of ./index.ts for the contract. Summary:
//   pickCell(model, ray, opts?) -> nearest cell cube or wheel disc hit (part, cell, face entered) or null
//   pickBack(model, ray, opts?) -> nearest point where the ray LEAVES a part (Back side): part, cell, face left
//   pickGrid(ray)               -> grid cell [x, 0, z] under the ray on the plane y = −½, or null
import { DIRS, axisOfDir, cellsAt, discOverlapsCell, isHole, isMale, isValidRim, worldIndex } from '../core';
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
  /** The ray origin was inside (or on the boundary of) this cube (or wheel disc). */
  inside: boolean;
  /**
   * Wheels (§7.3): the ray hit the flat face of a rim's disc (radius r, the hub's layer) outside
   * the part's own cell cubes. `virtual` is the grid cell G under the hit point in the hub's layer
   * (a *virtual cell* of the wheel, never a cell of the part); `cellIndex` / `cell` / `pos` are the
   * hub, `dir` the flat face entered (normal ∥ the hub axis).
   */
  virtual?: Vec3i;
  /**
   * Wheels (§7.3): the ray hit the tread (the round outer surface) of a rim's disc. `cellIndex` /
   * `cell` / `pos` are the hub and `dir` is the hub's lateral face whose normal is nearest the
   * radial direction of the hit point, so the hit resolves as that face of the hub being hovered.
   */
  tread?: boolean;
  /**
   * Set by pickBack (Back side, §7.3): a back-face hit. `dir` / `normal` are then the face the ray
   * LEAVES the part's solid through (outward normal, pointing away from the ray origin: the ray
   * goes on into pos + DIRS[dir]); `t` / `point` / `localPoint` are the exit point; `virtual` is the
   * grid cell under the exit point on a disc's far flat face; `tread` an exit through the tread
   * (dir = the hub's lateral face nearest the radial direction of the exit point); `inside` = the
   * ray origin is inside the part's solid.
   */
  back?: true;
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
/** Exit parameter, its slab (same tie rule as the entry) and the tied exit slabs (back-face pick). */
let hitFar = 0;
let hitFarAxis = 0;
let hitFarTies = 0;

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
  let fax = -1;
  let fadMax = 0;
  let fties = 0;
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
    if (t2 < tf) {
      tf = t2;
      fax = a;
      fadMax = ad;
      fties = 1 << a;
    } else if (t2 === tf) {
      fties |= 1 << a;
      if (ad > fadMax) {
        fax = a;
        fadMax = ad;
      }
    }
  }
  if (ax < 0) return false;
  if (!(tf - tn > MIN_SPAN) || !(tf > MIN_SPAN)) return false;
  hitNear = tn;
  hitT = tn > 0 ? tn : 0;
  hitAxis = ax;
  hitTies = ties;
  hitFar = tf;
  hitFarAxis = fax;
  hitFarTies = fties;
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
    // A wheel disc reaches r from its hub in the two in-plane axes (½ along its own axis).
    const e = rimOf(c) ?? 0.5;
    const ex = c.axis === 0 ? 0.5 : e;
    const ey = c.axis === 1 ? 0.5 : e;
    const ez = c.axis === 2 ? 0.5 : e;
    if (c.x - ex < lx) lx = c.x - ex;
    if (c.y - ey < ly) ly = c.y - ey;
    if (c.z - ez < lz) lz = c.z - ez;
    if (c.x + ex > hx) hx = c.x + ex;
    if (c.y + ey > hy) hy = c.y + ey;
    if (c.z + ez > hz) hz = c.z + ez;
  }
  b = [lx, ly, lz, hx, hy, hz];
  boxCache.set(p, b);
  return b;
}

/** The rim radius of a wheel hub cell (a hole cell with a valid rim), else undefined. */
function rimOf(c: Cell): number | undefined {
  return c.rim !== undefined && isHole(c.kind) && isValidRim(c.rim) ? c.rim : undefined;
}

/** Indices of a part's wheel hubs (cached). */
const hubCache = new WeakMap<Part, number[]>();
function hubsOf(p: Part): number[] {
  let h = hubCache.get(p);
  if (h) return h;
  h = [];
  for (let i = 0; i < p.cells.length; i++) if (rimOf(p.cells[i]!) !== undefined) h.push(i);
  hubCache.set(p, h);
  return h;
}

// ---------------------------------------------------------------------------------------------
// Ray / disc

let discT = 0;
let discNear = 0;
/** The entry is through the tread (round surface), not a flat face. */
let discTread = false;
/** Exit parameter and whether the exit is through the tread (back-face pick). */
let discFar = 0;
let discFarTread = false;

/**
 * The ray against the nominal disc of a rim (§2.6): the points of the hub's layer
 * [h_a − ½, h_a + ½] within distance r of the hub axis. Same conventions as rayBox: sets discNear,
 * discT = max(discNear, 0) and discTread; misses when the overlap is shorter than MIN_SPAN or lies
 * behind the origin. On an exact tie between the slab and the cylinder entry the flat face wins.
 * The slab parameters are computed exactly like rayBox's, so a flat face coplanar with a cube face
 * gives the identical t (and the cube wins the tie in pickCell).
 */
function rayDisc(o: Vec3, d: Vec3, h: Cell, r: number): boolean {
  const a = h.axis;
  const u = (a + 1) % 3;
  const v = (a + 2) % 3;
  const hc = [h.x, h.y, h.z] as const;
  let tn = -Infinity;
  let tf = Infinity;
  let tread = false;
  let farTread = false;
  const lo = hc[a]! - 0.5;
  const hi = hc[a]! + 0.5;
  const oa = o[a]!;
  const da = d[a]!;
  if (da === 0) {
    if (oa < lo || oa > hi) return false;
  } else {
    let t1 = (lo - oa) / da;
    let t2 = (hi - oa) / da;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    tn = t1;
    tf = t2;
  }
  const ou = o[u]! - hc[u]!;
  const ov = o[v]! - hc[v]!;
  const du = d[u]!;
  const dv = d[v]!;
  const A = du * du + dv * dv;
  if (A < 1e-18) {
    if (ou * ou + ov * ov > r * r) return false;
  } else {
    const B = ou * du + ov * dv;
    const C = ou * ou + ov * ov - r * r;
    const disc = B * B - A * C;
    if (!(disc > 0)) return false;
    const sq = Math.sqrt(disc);
    const c1 = (-B - sq) / A;
    const c2 = (-B + sq) / A;
    if (c1 > tn) {
      tn = c1;
      tread = true;
    }
    if (c2 < tf) {
      tf = c2;
      farTread = true;
    }
  }
  if (tn === -Infinity) return false;
  if (!(tf - tn > MIN_SPAN) || !(tf > MIN_SPAN)) return false;
  discNear = tn;
  discT = tn > 0 ? tn : 0;
  discTread = tread;
  discFar = tf;
  discFarTread = farTread;
  return true;
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
 * Wheels (§7.3): each rim is also pickable as its nominal disc (radius r, the hub's layer). A
 * disc hit wins only when it is strictly nearer than every cube hit (so inside one of the part's
 * own cubes, e.g. a crank hole in the disc, the real cell wins, ties included); between discs,
 * ties go to the lower part id. A flat-face hit reports the hub as cellIndex / cell / pos and the
 * virtual cell G (the grid cell under the hit point in the hub's layer) as `virtual`; a tread hit
 * reports the hub with `tread: true` and `dir` = the hub's lateral face nearest the radial
 * direction of the hit. Works with `opts.transform` like the cubes (grabbing a wheel by its disc).
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

  let best: {
    part: Part;
    tf: PartTransform | null;
    o: Vec3;
    d: Vec3;
    cellIndex: number;
    t: number;
    axis: number;
    ties: number;
    near: number;
    /** A wheel disc hit (cellIndex = the hub); `tread` = through the round surface. */
    disc: boolean;
    tread: boolean;
  } | null = null;

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
    if (best && hitT > best.t + 1e-12) continue;
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
        // tie: a cube beats a disc (the real cell wins inside its cube); else lower part id, then
        // lower cell index
        if (hitT >= best.t - 1e-12 && !best.disc) {
          if (part.id > best.part.id || (part.id === best.part.id && i > best.cellIndex)) continue;
        }
      }
      best = { part, tf, o, d, cellIndex: i, t: hitT, axis: hitAxis, ties: hitTies, near: hitNear, disc: false, tread: false };
    }
    // Wheels (§7.3): each rim is pickable as its nominal disc. A disc hit counts only when it is
    // strictly nearer than every cube hit (a disc point inside one of the part's own cubes lies
    // behind that cube's entry, so the real cell wins there, ties included).
    for (const i of hubsOf(part)) {
      const c = cells[i]!;
      if (!rayDisc(o, d, c, rimOf(c)!)) continue;
      if (best) {
        if (discT >= best.t - 1e-12 && !best.disc) continue;
        if (best.disc) {
          if (discT > best.t + 1e-12) continue;
          if (discT >= best.t - 1e-12 && (part.id > best.part.id || (part.id === best.part.id && i > best.cellIndex))) continue;
        }
      }
      best = { part, tf, o, d, cellIndex: i, t: discT, axis: c.axis, ties: 0, near: discNear, disc: true, tread: discTread };
    }
  }
  if (!best) return null;

  const { part, tf, o, d, t } = best;
  let partId = part.id;
  let cellIndex = best.cellIndex;
  let cell = part.cells[cellIndex]!;
  const dirOf = (a: number): Dir => (2 * a + (d[a]! > 0 ? 1 : 0)) as Dir;
  const localPoint: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  const point: Vec3 = [ray.origin[0] + t * D[0], ray.origin[1] + t * D[1], ray.origin[2] + t * D[2]];

  if (best.disc) {
    const hub = cell;
    const a = hub.axis;
    const hp = [hub.x, hub.y, hub.z] as const;
    const pos: Vec3i = [hub.x, hub.y, hub.z];
    const r = rimOf(hub)!;
    const radialHit = (): PickHit => {
      // Tread: the hub's lateral face nearest the radial direction of the hit point.
      const u = (a + 1) % 3;
      const v = (a + 2) % 3;
      const ru = localPoint[u]! - hp[u]!;
      const rv = localPoint[v]! - hp[v]!;
      const k = Math.abs(rv) > Math.abs(ru) ? v : u;
      const comp = k === u ? ru : rv;
      const dir = (2 * k + (comp < 0 ? 1 : 0)) as Dir;
      const len = Math.hypot(ru, rv) || 1;
      const nl: [number, number, number] = [0, 0, 0];
      nl[u] = ru / len;
      nl[v] = rv / len;
      return { partId, cellIndex, cell, pos, dir, t, point, localPoint, normal: tf ? rotate(tf.q, nl) : nl, inside: best!.near <= 0, tread: true };
    };
    if (best.tread) return radialHit();
    const dir = dirOf(a);
    const g: [number, number, number] = [hub.x, hub.y, hub.z];
    for (const k of [0, 1, 2]) if (k !== a) g[k] = Math.floor(localPoint[k]! + 0.5) + 0;
    // Only a cell the disc really overlaps is a virtual cell (guards float noise at the rim).
    if (!discOverlapsCell(pos, a, r, g)) return radialHit();
    const own = part.cells.findIndex((q) => q.x === g[0] && q.y === g[1] && q.z === g[2]);
    const n = DIR_NORMALS[dir]!;
    const normal = tf ? rotate(tf.q, n) : n;
    if (own >= 0) {
      // Float noise put the hit just in front of one of the part's own cubes: that cell wins.
      cellIndex = own;
      cell = part.cells[own]!;
      return { partId, cellIndex, cell, pos: [cell.x, cell.y, cell.z], dir, t, point, localPoint, normal, inside: best.near <= 0 };
    }
    return { partId, cellIndex, cell, pos, dir, t, point, localPoint, normal, inside: best.near <= 0, virtual: g };
  }

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
// pickBack

/** Intervals of one part closer than this in t are merged (they touch: a face, edge or corner). */
const MERGE_EPS = 1e-9;

/** One cube or disc the ray crosses, in the part's frame (scratch of pickBack). */
interface Span {
  tIn: number;
  tOut: number;
  /** Cell index (the hub for a disc). */
  index: number;
  disc: boolean;
  /** Cube: the exit slab and the tied exit slabs. Disc: exit through the tread. */
  axis: number;
  ties: number;
  tread: boolean;
  /**
   * A cube or disc of a part whose hole holds one of this part's male cells (its "host"): the male
   * is buried in the host there, so the host's solid extends this part's for merging, but a merged
   * interval that ends on a filler is no crossing of this part (the host leaves there itself).
   */
  filler?: boolean;
}

/** `a` ends the merged interval in preference to `b` on a tie: own before filler, a cube before a disc, lower index. */
function spanBefore(a: Span, b: Span): boolean {
  if (!!a.filler !== !!b.filler) return !a.filler;
  if (a.disc !== b.disc) return !a.disc;
  return a.index < b.index;
}

/** Parts whose hole holds one of `part`'s male cells (a male's "hosts"; see Span.filler). */
function hostsOf(model: Model, part: Part): number[] {
  const sh = sharedInfo(model);
  const out: number[] = [];
  for (const c of part.cells) {
    if (!isMale(c.kind)) continue;
    const h = sh.holePartOfMale.get(c);
    if (h !== undefined && h !== part.id && !out.includes(h)) out.push(h);
  }
  return out;
}

/**
 * Back side (§7.3): the nearest point where `ray` LEAVES a part's solid — the face it would hit if
 * every part's front faces were culled and only its back faces drawn. Each part's solid is the
 * union of all its cell cubes (a male inside another part's hole included) and its rim discs; a
 * crossing is where the ray passes out of that union (into empty space or another part), so faces
 * between two cells of the same part, or between a disc and the part's own cubes, never count.
 * Per part (in its own frame, so `opts.transform` works as for pickCell) the [tIn, tOut] spans of
 * every cube and disc the ray crosses are merged where they touch or overlap; the end of the first
 * merged span is the part's first exit and the span ending there gives the cell and face (a cube
 * before a disc, then the lower cell index, on a tie). The result is the nearest exit over all parts
 * (`opts.filter` as for pickCell). A male cell inside another part's hole is buried in that part
 * (fixer's ruling after review, DEVIATIONS §7): the host's cubes and discs extend the male part's
 * solid for merging, and an interval that ends in the host is no crossing of the male, so a pin's
 * side faces inside a beam never hide the beam's far face. Ties between parts: when both leave the same shared cell (a male
 * in another part's hole), as for the front pick — the male iff the ray leaves through an axial face
 * (normal ∥ the axis) strictly within R_ROD of the axis, otherwise the hole's part; else the lower
 * part id. A cube left exactly through an edge or corner
 * reports, among the tied faces, the first (larger |dir| component, then lower axis, then the other
 * tied axes in order) whose neighbour cell is not one of the part's own. A disc left through its far
 * flat face gives the hub plus `virtual` = the grid cell under the exit point (one of the part's own
 * cells there wins, as in pickCell); through its tread, the hub with `tread: true`.
 *
 * Returns a PickHit with `back: true` (see its doc), or null when the ray crosses no part (then
 * pickCell is null too) or `dir` is zero. Cost: as pickCell (one box test per part and per cell of
 * the parts whose box the ray crosses), plus sorting the few spans of each crossed part; parts whose
 * box the ray enters after the best exit so far are skipped.
 */
export function pickBack(model: Model, ray: Ray, opts: PickOptions = {}): PickHit | null {
  const D = ray.dir;
  if (!(D[0] !== 0 || D[1] !== 0 || D[2] !== 0)) return null;
  if (![...ray.origin, ...D].every(Number.isFinite)) return null;
  const lookup = opts.transform;
  const filter = opts.filter;

  let best: {
    part: Part;
    tf: PartTransform | null;
    o: Vec3;
    d: Vec3;
    span: Span;
    t: number;
    start: number;
  } | null = null;

  const spans: Span[] = [];
  for (const part of model.parts) {
    if (filter && !filter(part)) continue;
    let o: Vec3 = ray.origin;
    let d: Vec3 = D;
    let tf: PartTransform | null = null;
    if (lookup) {
      tf = lookup(part.id) ?? null;
      if (!tf) continue;
      const qi = conj(tf.q);
      o = rotate(qi, [ray.origin[0] - tf.p[0], ray.origin[1] - tf.p[1], ray.origin[2] - tf.p[2]]);
      d = rotate(qi, D);
    }
    const b = partBox(part);
    if (!rayBox(o, d, b[0], b[1], b[2], b[3], b[4], b[5])) continue;
    // The part's first exit is not before its box entry.
    if (best && hitNear > best.t + 1e-12) continue;
    spans.length = 0;
    const cells = part.cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      if (!rayBox(o, d, c.x - 0.5, c.y - 0.5, c.z - 0.5, c.x + 0.5, c.y + 0.5, c.z + 0.5)) continue;
      spans.push({ tIn: hitNear, tOut: hitFar, index: i, disc: false, axis: hitFarAxis, ties: hitFarTies, tread: false });
    }
    for (const i of hubsOf(part)) {
      const c = cells[i]!;
      if (!rayDisc(o, d, c, rimOf(c)!)) continue;
      spans.push({ tIn: discNear, tOut: discFar, index: i, disc: true, axis: c.axis, ties: 0, tread: discFarTread });
    }
    if (!spans.length) continue;
    // A male inside another part's hole is buried in that part (its "host", §7.3 as ruled after
    // review): the host's cubes and discs extend this part's solid, so a pin's side faces inside a
    // beam are no back faces and the beam's far face is picked through them.
    for (const hostId of hostsOf(model, part)) {
      const host = model.parts.find((q) => q.id === hostId);
      if (!host || (filter && !filter(host))) continue;
      let ho: Vec3 = ray.origin;
      let hd: Vec3 = D;
      if (lookup) {
        const htf = lookup(host.id);
        if (!htf) continue;
        const qi = conj(htf.q);
        ho = rotate(qi, [ray.origin[0] - htf.p[0], ray.origin[1] - htf.p[1], ray.origin[2] - htf.p[2]]);
        hd = rotate(qi, D);
      }
      for (const c of host.cells) {
        if (!rayBox(ho, hd, c.x - 0.5, c.y - 0.5, c.z - 0.5, c.x + 0.5, c.y + 0.5, c.z + 0.5)) continue;
        spans.push({ tIn: hitNear, tOut: hitFar, index: -1, disc: false, axis: 0, ties: 0, tread: false, filler: true });
      }
      for (const i of hubsOf(host)) {
        const c = host.cells[i]!;
        if (!rayDisc(ho, hd, c, rimOf(c)!)) continue;
        spans.push({ tIn: discNear, tOut: discFar, index: -1, disc: true, axis: 0, ties: 0, tread: false, filler: true });
      }
    }
    spans.sort((x, y) => x.tIn - y.tIn || x.tOut - y.tOut);
    // The first merged interval (spans that start before, or where, the current end lies) that holds
    // one of the part's own spans.
    let k0 = 0;
    let start = 0;
    let endSpan = spans[0]!;
    let end = 0;
    let own = false;
    while (k0 < spans.length) {
      start = spans[k0]!.tIn;
      endSpan = spans[k0]!;
      end = endSpan.tOut;
      own = !endSpan.filler;
      let k = k0 + 1;
      for (; k < spans.length; k++) {
        const sp = spans[k]!;
        if (sp.tIn > end + MERGE_EPS) break;
        if (!sp.filler) own = true;
        if (sp.tOut > end + MERGE_EPS) {
          end = sp.tOut;
          endSpan = sp;
        } else if (sp.tOut >= end - MERGE_EPS && spanBefore(sp, endSpan)) {
          endSpan = sp;
        }
      }
      if (own) break;
      k0 = k;
    }
    // No own span (only the host was crossed), or the interval ends in the host: no crossing here.
    if (!own || endSpan.filler) continue;
    if (best) {
      if (end > best.t + 1e-12) continue;
      if (end >= best.t - 1e-12) {
        // Tie between parts. Both leave the same shared cell (a male in another part's hole): as for
        // the front pick, the male iff the ray leaves through an axial face strictly within R_ROD of
        // the axis, else the hole. Otherwise the lower part id.
        const a = part.cells[endSpan.index]!;
        const q = best.part.cells[best.span.index]!;
        const samePos = !endSpan.disc && !best.span.disc && a.x === q.x && a.y === q.y && a.z === q.z;
        if (samePos && isHole(a.kind) !== isHole(q.kind)) {
          const hole = isHole(a.kind) ? a : q;
          const hs = isHole(a.kind) ? endSpan : best.span;
          const ho = isHole(a.kind) ? o : best.o;
          const hd = isHole(a.kind) ? d : best.d;
          const pt: Vec3 = [ho[0] + end * hd[0], ho[1] + end * hd[1], ho[2] + end * hd[2]];
          const maleWins = hs.axis === hole.axis && radial(pt, hole, hole.axis) < R_ROD;
          if (maleWins === isHole(a.kind)) continue;
        } else if (part.id > best.part.id) continue;
      }
    }
    best = { part, tf, o, d, span: endSpan, t: end, start };
  }
  if (!best) return null;

  const { part, tf, o, d, span, t } = best;
  const partId = part.id;
  const inside = best.start <= 0;
  let cellIndex = span.index;
  let cell = part.cells[cellIndex]!;
  /** The face of axis a the ray leaves through (outward normal along the travel). */
  const exitDir = (a: number): Dir => (2 * a + (d[a]! > 0 ? 0 : 1)) as Dir;
  const localPoint: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  const point: Vec3 = [ray.origin[0] + t * D[0], ray.origin[1] + t * D[1], ray.origin[2] + t * D[2]];
  const toWorld = (n: Vec3): Vec3 => (tf ? rotate(tf.q, n) : n);
  const own = (q: readonly number[]): number => part.cells.findIndex((c) => c.x === q[0] && c.y === q[1] && c.z === q[2]);

  if (span.disc) {
    const hub = cell;
    const a = hub.axis;
    const hp = [hub.x, hub.y, hub.z] as const;
    const pos: Vec3i = [hub.x, hub.y, hub.z];
    const r = rimOf(hub)!;
    const treadHit = (): PickHit => {
      const u = (a + 1) % 3;
      const v = (a + 2) % 3;
      const ru = localPoint[u]! - hp[u]!;
      const rv = localPoint[v]! - hp[v]!;
      const k = Math.abs(rv) > Math.abs(ru) ? v : u;
      const comp = k === u ? ru : rv;
      const dir = (2 * k + (comp < 0 ? 1 : 0)) as Dir;
      const len = Math.hypot(ru, rv) || 1;
      const nl: [number, number, number] = [0, 0, 0];
      nl[u] = ru / len;
      nl[v] = rv / len;
      return { partId, cellIndex, cell, pos, dir, t, point, localPoint, normal: toWorld(nl), inside, tread: true, back: true };
    };
    if (span.tread) return treadHit();
    const dir = exitDir(a);
    const g: [number, number, number] = [hub.x, hub.y, hub.z];
    for (const k of [0, 1, 2]) if (k !== a) g[k] = Math.floor(localPoint[k]! + 0.5) + 0;
    if (!discOverlapsCell(pos, a, r, g)) return treadHit();
    const normal = toWorld(DIR_NORMALS[dir]!);
    const j = own(g);
    if (j >= 0) {
      // Float noise ended the merged span on the disc just short of one of the part's own cubes.
      cellIndex = j;
      cell = part.cells[j]!;
      return { partId, cellIndex, cell, pos: [cell.x, cell.y, cell.z], dir, t, point, localPoint, normal, inside, back: true };
    }
    return { partId, cellIndex, cell, pos, dir, t, point, localPoint, normal, inside, virtual: g, back: true };
  }

  let dir = exitDir(span.axis);
  if (span.ties & ~(1 << span.axis)) {
    // Left exactly through an edge or corner: report a tied face whose neighbour is not the part's.
    const free = (dd: Dir): boolean => {
      const n = DIRS[dd]!;
      return own([cell.x + n[0], cell.y + n[1], cell.z + n[2]]) < 0;
    };
    if (!free(dir)) {
      for (const a of [0, 1, 2]) {
        if (a === span.axis || !(span.ties & (1 << a))) continue;
        if (free(exitDir(a))) {
          dir = exitDir(a);
          break;
        }
      }
    }
  }
  return {
    partId,
    cellIndex,
    cell,
    pos: [cell.x, cell.y, cell.z],
    dir,
    t,
    point,
    localPoint,
    normal: toWorld(DIR_NORMALS[dir]!),
    inside,
    back: true,
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
