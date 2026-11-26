// Render solid of a part (DESIGN.md §4.2): real CSG with manifold-3d,
//   solid(part) = ⋃ positives − ⋃ bores,
// output as an indexed triangle mesh in the part-local frame (topology.partOrigin) with
// creased smooth vertex normals.
import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import { DIRS, axisOfDir, cellKey, cellPos, discOverlapsCell, isHole, isMale } from '../core';
import type { Axis, Cell, Dir, Part } from '../core';
import {
  CHAMFER,
  CREASE_DEG,
  EPS,
  E_CONN,
  E_FREE,
  H,
  R_BORE,
  R_RIDGE,
  R_ROD,
  RIM_CHAMFER,
  RIM_INSET,
  SEGMENTS,
  rimSegments,
  W_BORE,
  W_RIDGE,
  W_ROD,
} from './dims';
import {
  PartGrid,
  analyzeCells,
  isHub,
  localCenter,
  minusDir,
  partOrigin,
  partSignature,
  plusDir,
  rimMarks,
  rodExtent,
} from './topology';
import type { CellTopo, RimMark, Vec3 } from './topology';

export interface MeshData {
  /** xyz per vertex, part-local frame (world = local + origin). */
  positions: Float32Array;
  /** Unit vertex normals, xyz per vertex. */
  normals: Float32Array;
  /** Triangle vertex indices, CCW seen from outside. */
  indices: Uint32Array;
  /** Integer world position of the part-local frame's origin (= partOrigin(part)). */
  origin: [number, number, number];
}

// ------------------------------------------------------------------------------------------
// WASM initialisation

let wasm: ManifoldToplevel | null = null;
let initPromise: Promise<void> | null = null;

/** Load the manifold-3d WASM once. Safe to call repeatedly; works in Node and in the browser. */
export function initGeometry(): Promise<void> {
  if (!initPromise) {
    const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    // In Node (vitest) the Emscripten loader finds manifold.wasm next to itself; in the Vite
    // bundle it must be told the emitted asset URL.
    const p = inBrowser ? Module({ locateFile: () => manifoldWasmUrl }) : Module();
    initPromise = p.then((w) => {
      w.setup();
      wasm = w;
    });
    initPromise.catch(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export function geometryReady(): boolean {
  return wasm !== null;
}

function getWasm(): ManifoldToplevel {
  if (!wasm) throw new Error('geometry not initialised: await initGeometry() first');
  return wasm;
}

// ------------------------------------------------------------------------------------------
// Allocation scope: every Manifold created while building a part is registered and freed.

let liveManifolds = 0;

/** Number of Manifold objects allocated by this module and not yet freed (leak tests). */
export function liveManifoldCount(): number {
  return liveManifolds;
}

class Scope {
  private readonly items: { delete(): void }[] = [];
  t<T extends { delete(): void }>(m: T): T {
    this.items.push(m);
    liveManifolds++;
    return m;
  }
  free(): void {
    for (const m of this.items) {
      m.delete();
      liveManifolds--;
    }
    this.items.length = 0;
  }
}

function withScope<T>(fn: (s: Scope) => T): T {
  const s = new Scope();
  try {
    return fn(s);
  } finally {
    s.free();
  }
}

// ------------------------------------------------------------------------------------------
// Primitives (cell-local helpers; everything is built along +Z then oriented onto the axis)

// manifold-3d 3.5.5's JS wrappers `CrossSection.prototype.extrude/revolve` (and the static
// `Manifold.extrude/revolve`, which go through them) never delete the polygon vector returned by
// `_ToPolygons()`, and the static `Manifold.revolve(polygons)` also leaks the temporary
// CrossSection it builds: a few KB of WASM heap per call that `liveManifoldCount` cannot see.
// So call the raw Embind bindings and free the vector ourselves.
interface PolygonsVec {
  delete(): void;
}
interface RawBindings {
  _Extrude(p: PolygonsVec, height: number, nDivisions: number, twistDegrees: number, scaleTop: { x: number; y: number }): Manifold;
  _Revolve(p: PolygonsVec, circularSegments: number, revolveDegrees: number): Manifold;
}
function toPolygonsVec(cs: CrossSection): PolygonsVec {
  return (cs as unknown as { _ToPolygons(): PolygonsVec })._ToPolygons();
}

/** Extrude a cross-section along +Z over [0, height] without leaking (see RawBindings). */
function extrudeCS(s: Scope, cs: CrossSection, height: number): Manifold {
  const raw = getWasm() as unknown as RawBindings;
  const p = toPolygonsVec(cs);
  try {
    return s.t(raw._Extrude(p, height, 0, 0, { x: 1, y: 1 }));
  } finally {
    p.delete();
  }
}

/** Revolve a profile (x = radius, y = height) a full turn about Z without leaking. */
function revolveProfile(s: Scope, prof: [number, number][], segments = SEGMENTS): Manifold {
  const w = getWasm();
  const cs = s.t(new w.CrossSection([prof]));
  const p = toPolygonsVec(cs);
  try {
    return s.t((w as unknown as RawBindings)._Revolve(p, segments, 360));
  } finally {
    p.delete();
  }
}

function circle2D(s: Scope, r: number): CrossSection {
  const CS = getWasm().CrossSection;
  return s.t(CS.circle(r, SEGMENTS));
}

/** Rotate a Z-aligned solid so that +Z maps onto +axis (exact quarter turns). */
function orient(s: Scope, m: Manifold, axis: Axis): Manifold {
  if (axis === 2) return m;
  if (axis === 0) return s.t(m.rotate([0, 90, 0])); // +Z → +X
  return s.t(m.rotate([-90, 0, 0])); // +Z → +Y
}

function place(s: Scope, m: Manifold, axis: Axis, ctr: Vec3): Manifold {
  return s.t(orient(s, m, axis).translate(ctr));
}

/** Axis-aligned box [lo, hi] (Z frame). */
function zbox(s: Scope, lo: Vec3, hi: Vec3): Manifold {
  const M = getWasm().Manifold;
  return s.t(s.t(M.cube([hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], false)).translate(lo));
}

/**
 * Frustum/cylinder along Z from z0 to z1, radius r0 at z0 and r1 at z1. Polygon vertices lie on
 * the X/Y axes (so a flat face at ±r is tangent to a vertex, as in a stadium), or, with
 * `offset`, are rotated half a segment so the polygon stays strictly inside ±r. Barrels built by
 * 3D CSG use the offset: a vertex line lying exactly on a web box face makes the boolean emit
 * pinched zero-length edges (found by the fuzz test); prism-run barrels are built in 2D, where
 * the exact tangency is harmless and gives a step-free stadium.
 */
function zcyl(s: Scope, r0: number, r1: number, z0: number, z1: number, offset = false): Manifold {
  const M = getWasm().Manifold;
  let c = s.t(M.cylinder(z1 - z0, r0, r1, SEGMENTS, false));
  if (offset) c = s.t(c.rotate([0, 0, 180 / SEGMENTS]));
  return s.t(c.translate([0, 0, z0]));
}

/** Cross prism along Z: (box ±w × ±r ∪ its 90° rotation) ∩ cylinder r, z ∈ [z0, z1]. */
function zcross(s: Scope, w: number, r: number, z0: number, z1: number): Manifold {
  // Built in 2D (cheap) and extruded.
  const CS = getWasm().CrossSection;
  const a = s.t(CS.square([2 * w, 2 * r], true));
  const b = s.t(CS.square([2 * r, 2 * w], true));
  const plus = s.t(a.add(b));
  const cross = s.t(plus.intersect(circle2D(s, r)));
  return s.t(extrudeCS(s, cross, z1 - z0).translate([0, 0, z0]));
}

/** Round rod along Z over [z0, z1]; free ends (flags) get a 45° chamfer. One revolved profile. */
function zrod(s: Scope, r: number, z0: number, z1: number, chamfer0: boolean, chamfer1: boolean): Manifold {
  const prof: [number, number][] = [[0, z0]];
  if (chamfer0) prof.push([r - CHAMFER, z0], [r, z0 + CHAMFER]);
  else prof.push([r, z0]);
  if (chamfer1) prof.push([r, z1 - CHAMFER], [r - CHAMFER, z1]);
  else prof.push([r, z1]);
  prof.push([0, z1]);
  return revolveProfile(s, prof);
}

// ------------------------------------------------------------------------------------------
// Part solid

/** Tolerance for Manifold.simplify on the finished solid (studs; 1e-5 = 0.08 µm). */
const SIMPLIFY_TOL = 1e-5;

/** Web boxes of a hole cell (relative to its centre), one per connected lateral face. */
function webBoxes(t: CellTopo, grid: PartGrid): [Vec3, Vec3][] {
  const c = t.cell;
  const h = c.axis;
  const out: [Vec3, Vec3][] = [];
  for (let d = 0 as Dir; d < 6; d = (d + 1) as Dir) {
    const n = axisOfDir(d);
    if (n === h || !t.faces[d]!.connected) continue;
    const lo: Vec3 = [-H, -H, -H];
    const hi: Vec3 = [H, H, H];
    if (DIRS[d]![n]! > 0) {
      lo[n] = 0;
      hi[n] = E_CONN;
    } else {
      lo[n] = -E_CONN;
      hi[n] = 0;
    }
    // Sliver fill: grow toward each transverse direction t where the four cells around that
    // cube edge (C, C+n, C+t, C+n+t) are all hole cells of this part.
    for (let td = 0 as Dir; td < 6; td = (td + 1) as Dir) {
      const ta = axisOfDir(td);
      if (ta === n) continue;
      if (grid.holeAt(c, d) && grid.holeAt(c, td) && grid.holeAt(c, d, td)) {
        if (DIRS[td]![ta]! > 0) hi[ta] = E_CONN;
        else lo[ta] = -E_CONN;
      }
      // Boss corner fill (deviation): when the neighbours on this face and on the adjacent
      // lateral face td are both connected males, the two square bosses would leave a
      // (½+EPS−H)² notch along their shared edge. Fill it by growing the lower-indexed web of the
      // pair. (With a hole neighbour on either side the region is a natural concave corner.)
      if (ta !== h && d < td && t.faces[td]!.connected) {
        const nb = t.faces[d]!.neighbour!;
        const nt = t.faces[td]!.neighbour!;
        if (isMale(nb.kind) && isMale(nt.kind)) {
          if (DIRS[td]![ta]! > 0) hi[ta] = E_CONN;
          else lo[ta] = -E_CONN;
        }
      }
    }
    out.push([lo, hi]);
  }
  return out;
}

/** Is the bore of hole cell t closed at its axial side d, i.e. is the in-part neighbour there a
 *  hole with a different axis (§4.2: a blind hole against that neighbour's wall)? */
function blindAt(t: CellTopo, d: Dir): boolean {
  const nb = t.faces[d]!.neighbour;
  return nb !== undefined && isHole(nb.kind) && nb.axis !== t.cell.axis;
}

/**
 * Bore extent along the hole axis: through with 2·EPS overshoot, or stopping at the face when
 * the in-part neighbour on that side is a hole with a different axis (blind end, §4.2).
 * Also stops at the face (deviation) when this is a pin hole and the neighbour there is a coaxial
 * axle hole: the round bore would otherwise cut a 2·EPS-deep round counterbore into the start of
 * the cross bore. The neighbour's cross bore still overshoots into this cell, inside the round
 * bore, so the two bores stay one cavity.
 */
function boreExtent(t: CellTopo): [number, number] {
  const h = t.cell.axis;
  const stop = (d: Dir): boolean => {
    if (blindAt(t, d)) return true;
    const nb = t.faces[d]!.neighbour;
    return t.cell.kind === 'pinHole' && nb !== undefined && nb.kind === 'axleHole' && nb.axis === h;
  };
  return [stop(minusDir(h)) ? -0.5 : -0.5 - 2 * EPS, stop(plusDir(h)) ? 0.5 : 0.5 + 2 * EPS];
}

/**
 * Is this run of coaxial same-axis hole cells (listed along +axis) a uniform prism, i.e. exactly
 * the extrusion of one 2D profile over [first − H, last + H]? True when the run has no axial
 * connection beyond its ends, all its cells are the same kind, and every cell has the same
 * in-plane webs, each grown along the axis across every internal gap (so webs, like the barrel,
 * are continuous). A single unconnected hole cell is the common case (any planar liftarm);
 * double-thick beams and tubes are the multi-cell cases.
 */
function isPrismRun(run: CellTopo[], grid: PartGrid): boolean {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const h = first.cell.axis;
  if (first.faces[minusDir(h)]!.connected || last.faces[plusDir(h)]!.connected) return false;
  if (run.length === 1) return true;
  const ref = webBoxes(first, grid);
  for (let i = 0; i < run.length; i++) {
    const t = run[i]!;
    if (t.cell.kind !== first.cell.kind) return false;
    const boxes = i === 0 ? ref : webBoxes(t, grid);
    if (boxes.length !== ref.length) return false;
    for (let j = 0; j < boxes.length; j++) {
      const [lo, hi] = boxes[j]!;
      const [rlo, rhi] = ref[j]!;
      for (let k = 0; k < 3; k++) if (k !== h && (lo[k] !== rlo[k] || hi[k] !== rhi[k])) return false;
      if (lo[h] !== (i > 0 ? -E_CONN : -H) || hi[h] !== (i < run.length - 1 ? E_CONN : H)) return false;
    }
  }
  return true;
}

/**
 * One barrel for a run of coaxial, same-axis hole cells (listed along +axis): ±H, extended to
 * ½+EPS where the run continues into an axially connected hole of a different axis. One
 * cylinder instead of per-cell cylinders overlapping by 2·EPS (coincident surfaces).
 * NB: the "sliver fill likewise the barrel" of §4.2 is subsumed by the web fill: the barrel's
 * quadrant toward a lateral side t would be filled exactly when C, C+h, C+t, C+h+t are all holes,
 * which is the condition under which the web toward t grows to ½ along h.
 */
function barrelRun(s: Scope, run: CellTopo[], ctr: Vec3): Manifold {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const h = first.cell.axis;
  const z0 = first.faces[minusDir(h)]!.connected ? -E_CONN : -H;
  const z1 = run.length - 1 + (last.faces[plusDir(h)]!.connected ? E_CONN : H);
  return place(s, zcyl(s, H, H, z0, z1, true), h, ctr);
}

/** Maximal runs of collinear connected cells accepted by `same` (listed along +axis). */
function axialRuns(topo: CellTopo[], accept: (t: CellTopo) => boolean, same: (a: CellTopo, b: Cell) => boolean): CellTopo[][] {
  const byPos = new Map<string, CellTopo>();
  for (const t of topo) if (accept(t)) byPos.set(cellKey(t.cell), t);
  const next = (t: CellTopo, d: Dir): CellTopo | undefined => {
    const f = t.faces[d]!;
    if (!f.connected || !f.neighbour || !same(t, f.neighbour)) return undefined;
    return byPos.get(cellKey(f.neighbour));
  };
  const seen = new Set<CellTopo>();
  const runs: CellTopo[][] = [];
  for (const t of byPos.values()) {
    if (seen.has(t)) continue;
    const a = t.cell.axis;
    let start = t;
    for (let p = next(start, minusDir(a)); p; p = next(start, minusDir(a))) start = p;
    const run: CellTopo[] = [];
    for (let q: CellTopo | undefined = start; q; q = next(q, plusDir(a))) {
      run.push(q);
      seen.add(q);
    }
    runs.push(run);
  }
  return runs;
}

function holeBore(s: Scope, t: CellTopo, ctr: Vec3): Manifold {
  const c = t.cell;
  const [z0, z1] = boreExtent(t);
  const z = c.kind === 'pinHole' ? zcyl(s, R_BORE, R_BORE, z0, z1) : zcross(s, W_BORE, R_BORE, z0, z1);
  return place(s, z, c.axis, ctr);
}

// ---- 2D fast path for slab cells -----------------------------------------------------------
// Coordinates (u, v) of the plane ⟂ axis h such that orient(h) maps (u, v, z) to the part-local
// point whose h-component is z (see orient()).
function to2D(h: Axis, p: Vec3): [number, number] {
  if (h === 0) return [-p[2], p[1]];
  if (h === 1) return [p[0], -p[2]];
  return [p[0], p[1]];
}

function cs2DCross(s: Scope, w: number, r: number): CrossSection {
  const CS = getWasm().CrossSection;
  const a = s.t(CS.square([2 * w, 2 * r], true));
  const b = s.t(CS.square([2 * r, 2 * w], true));
  return s.t(s.t(a.add(b)).intersect(circle2D(s, r)));
}

/** Prism runs of one axis spanning the same range [z0, z1] (cell-centre coordinates along it). */
interface Slab {
  axis: Axis;
  z0: number;
  z1: number;
  shapes: CrossSection[];
  bores: CrossSection[];
}

function addToSlab(s: Scope, slab: Slab, t: CellTopo, grid: PartGrid, ctr: Vec3): void {
  const CS = getWasm().CrossSection;
  const h = slab.axis;
  const [cu, cv] = to2D(h, ctr);
  slab.shapes.push(s.t(circle2D(s, H).translate([cu, cv])));
  for (const [lo, hi] of webBoxes(t, grid)) {
    const [u0, v0] = to2D(h, lo);
    const [u1, v1] = to2D(h, hi);
    const umin = Math.min(u0, u1), vmin = Math.min(v0, v1);
    const sq = s.t(CS.square([Math.abs(u1 - u0), Math.abs(v1 - v0)], false));
    slab.shapes.push(s.t(sq.translate([cu + umin, cv + vmin])));
  }
  const bore = t.cell.kind === 'pinHole' ? circle2D(s, R_BORE) : cs2DCross(s, W_BORE, R_BORE);
  slab.bores.push(s.t(bore.translate([cu, cv])));
}

function slabSolid(s: Scope, slab: Slab): Manifold {
  const CS = getWasm().CrossSection;
  const shape = slab.shapes.length === 1 ? slab.shapes[0]! : s.t(CS.union(slab.shapes));
  const holes = slab.bores.length === 1 ? slab.bores[0]! : s.t(CS.union(slab.bores));
  const prof = s.t(shape.subtract(holes));
  const z = s.t(extrudeCS(s, prof, slab.z1 - slab.z0 + 2 * H).translate([0, 0, slab.z0 - H]));
  return orient(s, z, slab.axis);
}

/**
 * One rod for a run of collinear, connected male cells of the same kind (listed along +axis),
 * so that consecutive cells do not produce coincident overlapping surfaces.
 */
function maleRod(s: Scope, run: CellTopo[], ctr: Vec3): Manifold {
  const M = getWasm().Manifold;
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const c = first.cell;
  const z0 = rodExtent(first)[0];
  const z1 = run.length - 1 + rodExtent(last)[1];
  const free0 = !first.faces[minusDir(c.axis)]!.connected;
  const free1 = !last.faces[plusDir(c.axis)]!.connected;
  let rod: Manifold;
  if (c.kind === 'axle') {
    rod = zcross(s, W_ROD, R_ROD, z0, z1);
  } else {
    rod = zrod(s, R_ROD, z0, z1, free0, free1);
    if (c.kind === 'frictionPin') {
      // Four shallow longitudinal ridges, stopping short of chamfered free ends (offset from the
      // chamfer ring so no ridge face is coplanar with a rod edge loop).
      const a = free0 ? z0 + CHAMFER + 0.015 : z0;
      const b = free1 ? z1 - CHAMFER - 0.015 : z1;
      const r0 = R_ROD - 0.02;
      const ridges = [
        zbox(s, [r0, -W_RIDGE, a], [R_RIDGE, W_RIDGE, b]),
        zbox(s, [-R_RIDGE, -W_RIDGE, a], [-r0, W_RIDGE, b]),
        zbox(s, [-W_RIDGE, r0, a], [W_RIDGE, R_RIDGE, b]),
        zbox(s, [-W_RIDGE, -R_RIDGE, a], [W_RIDGE, -r0, b]),
      ];
      rod = s.t(M.union([rod, ...ridges]));
    }
  }
  return place(s, rod, c.axis, ctr);
}

// ---- wheels (§4.2) ------------------------------------------------------------------------

/**
 * Rim positive (Z frame, centred on the hub): a disc of radius r − RIM_INSET over [−H, +H] with a
 * 45° chamfer of RIM_CHAMFER on both edges, revolved from the axis (it fills the hub; the hub's
 * and crank holes' bores are subtracted afterwards with all other bores).
 */
function zrim(s: Scope, r: number): Manifold {
  const R = r - RIM_INSET;
  const c = RIM_CHAMFER;
  return revolveProfile(
    s,
    [
      [0, -H],
      [R - c, -H],
      [R, -H + c],
      [R, H - c],
      [R - c, H],
      [0, H],
    ],
    rimSegments(r),
  );
}

/** Least depth (studs) by which the drawn rim must reach into a male cell's rod, in the wheel's
 *  plane, for the rod to count as joined to it without a web (below it the joint would be a sliver). */
const MALE_REACH = 0.1;

/**
 * Distance in the wheel's plane from the hub axis to the nearest point of a male cell's rod
 * footprint: a circle of radius R_ROD for a rod parallel to the hub axis, else the rectangle the rod
 * sweeps (±R_ROD across, ±(E_FREE − CHAMFER) along: the free-end extent less its chamfer, so a
 * chamfered tip is never counted as a joint; a connected end only reaches further, so this errs
 * toward bridging).
 */
function rodFootprintDist(h: Axis, c: Cell, du: number, dv: number): number {
  if (c.axis === h) return Math.hypot(du, dv) - R_ROD;
  // In-plane coordinates (u, v) of to2D(h): which of them runs along the rod?
  const [au, av] = to2D(h, [c.axis === 0 ? 1 : 0, c.axis === 1 ? 1 : 0, c.axis === 2 ? 1 : 0]);
  const along = E_FREE - CHAMFER;
  const eu = au !== 0 ? along : R_ROD;
  const ev = av !== 0 ? along : R_ROD;
  return Math.hypot(Math.max(0, Math.abs(du) - eu), Math.max(0, Math.abs(dv) - ev));
}

/**
 * Webs joining a rim to each cell of the part in its layer that rule 1 joins to it (the nominal
 * disc overlaps the cell) but that the drawn rim (radius r − RIM_INSET) does not reach: a hole whose
 * barrel the rim does not enter by 0.05, or a male (§4.2: a crank pin or axle built into the wheel's
 * part) whose rod it does not enter by MALE_REACH. The web is the 2-D hull of a circle at the cell's
 * centre (a boss round the bore or rod) and one inside the rim on the line to the hub, ±H thick,
 * clipped to the nominal disc ∪ the cell's own square, so it never reaches outside the cell and
 * the disc — space no other part may occupy (§2.6 rule 2). The hull and the clip region are convex
 * and their pieces in the disc and in the square share the corner of the square nearest the hub,
 * so the clipped web is still one piece joining the cell to the rim. A cell's bore is subtracted
 * afterwards like every bore; a male's rod is united with the web like every positive.
 */
function rimBridges(s: Scope, part: Part, w: Cell, origin: Vec3): Manifold[] {
  const h = w.axis;
  const r = w.rim!;
  const R = r - RIM_INSET;
  const out: Manifold[] = [];
  const hub: [number, number, number] = [w.x, w.y, w.z];
  const CS = getWasm().CrossSection;
  let disc: CrossSection | null = null;
  for (const c of part.cells) {
    if (c === w || c[axKey(h)] !== w[axKey(h)]) continue;
    if (!isHole(c.kind) && !isMale(c.kind)) continue;
    if (!discOverlapsCell(hub, h, r, [c.x, c.y, c.z])) continue;
    const [du, dv] = to2D(h, [c.x - w.x, c.y - w.y, c.z - w.z]);
    const d = Math.hypot(du, dv);
    if (isHole(c.kind) ? d - H < R - 0.05 : rodFootprintDist(h, c, du, dv) < R - MALE_REACH) continue; // the rim reaches it
    const BR = 0.36;
    const k = Math.max(0, R - 0.4) / d;
    const a = s.t(s.t(CS.circle(BR, SEGMENTS)).translate([du, dv]));
    const b = s.t(s.t(CS.circle(BR, SEGMENTS)).translate([du * k, dv * k]));
    const hull = s.t(CS.hull([a, b]));
    // Clip: the nominal disc (inscribed polygon, so never beyond r) ∪ the cell's square.
    disc ??= s.t(CS.circle(r, rimSegments(r)));
    const sq = s.t(s.t(CS.square([1, 1], true)).translate([du, dv]));
    const web = s.t(hull.intersect(s.t(disc.add(sq))));
    out.push(place(s, s.t(extrudeCS(s, web, 2 * H).translate([0, 0, -H])), h, localCenter(w, origin)));
  }
  return out;
}

/** The mark direction in the Z frame of orient(h) (a unit vector along ±x or ±y). */
function markDir2D(mk: RimMark): [number, number] {
  const [u, v] = to2D(mk.axis, mk.dir);
  return [u + 0, v + 0];
}

/** Overlap volume (cubic studs) above which a mark probe counts as covered by other material. */
const MARK_PROBE_VOL = 1e-6;

/**
 * Cutters of the index mark (Z frame, centred on the hub): a rectangular groove MARK_W wide and
 * MARK_D deep in both flat faces from MARK_R0 to just past the edge, and across the tread (unless
 * RimMark.tread says a cell of the part continues past the edge there). Rectangular so that its
 * walls are creases (separate smooth patches), which the outline pass always draws (§6.1).
 * Each cutter comes with a probe: the region just outside the surface it opens onto (the 0.06
 * gap above a face, the band just beyond the tread). If other material of the part fills the
 * probe, buildSolid leaves that cutter out (it would make a sealed cavity or a slot).
 */
function zmarkCutters(s: Scope, mk: RimMark): { cut: Manifold; probe: Manifold }[] {
  const [mx, my] = markDir2D(mk);
  const hw = mk.width / 2;
  const over = 0.02;
  const box = (r0: number, r1: number, z0: number, z1: number): Manifold => {
    // radial [r0, r1] along (mx, my), tangential ±hw
    const a: Vec3 = [mx * r0, my * r0, z0];
    const b: Vec3 = [mx * r1, my * r1, z1];
    const lo: Vec3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), z0];
    const hi: Vec3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), z1];
    if (mx === 0) {
      lo[0] = -hw;
      hi[0] = hw;
    } else {
      lo[1] = -hw;
      hi[1] = hw;
    }
    return zbox(s, lo, hi);
  };
  const gap = 2 * (0.5 - H);
  const out = [
    { cut: box(mk.r0, mk.r1 + over, H - mk.depth, H + over), probe: box(mk.r0, mk.r1 + over, H, H + gap) },
    { cut: box(mk.r0, mk.r1 + over, -H - over, -H + mk.depth), probe: box(mk.r0, mk.r1 + over, -H - gap, -H) },
  ];
  if (mk.tread) out.push({ cut: box(mk.r1 - mk.depth, mk.r1 + over, -H - over, H + over), probe: box(mk.r1, mk.r1 + gap, -H, H) });
  return out;
}

/**
 * Is the end cap of hole cell t's bore on side d (a disc of radius R_BORE at the bore's end,
 * ½ + 2·EPS from the centre) entirely inside the material of a rim of the part? Only a hole whose
 * axis lies in a wheel's plane, in the wheel's layer, can be capped that way; a bore capped at both
 * ends would be a sealed cavity (see buildSolid).
 */
function capInRim(t: CellTopo, d: Dir, hubs: readonly Cell[]): boolean {
  const c = t.cell;
  const a = c.axis;
  const sgn = DIRS[d]![a]!;
  for (const w of hubs) {
    const h = w.axis;
    if (h === a || c[axKey(h)] !== w[axKey(h)]) continue;
    const other = (3 - a - h) as Axis;
    const u0 = c[axKey(a)] - w[axKey(a)] + sgn * (0.5 + 2 * EPS);
    const v0 = Math.abs(c[axKey(other)] - w[axKey(other)]) + R_BORE;
    const R = w.rim! - RIM_INSET - RIM_CHAMFER;
    if (u0 * u0 + v0 * v0 < R * R) return true;
  }
  return false;
}

function axKey(a: Axis): 'x' | 'y' | 'z' {
  return a === 0 ? 'x' : a === 1 ? 'y' : 'z';
}

/**
 * Build the part's solid inside scope s (the result is owned by s).
 *
 * Hole cells in prism runs (see isPrismRun: any hole without an axial in-part connection, plus
 * uniform tubes/double-thick stacks) take a 2D path: their barrel ∪ webs are exactly an extrusion
 * of one profile, and their (through) bores only ever cut their own cells' material, so per axis
 * and range the profile (⋃ shapes − ⋃ bores) is computed with robust 2D booleans and extruded.
 * Everything else goes through the general 3D CSG. `fast = false` forces the 3D path everywhere
 * (tests check that the two agree).
 */
function buildSolid(s: Scope, part: Part, fast = true, marks = true): Manifold | null {
  if (part.cells.length === 0) return null;
  const M = getWasm().Manifold;
  const origin = partOrigin(part);
  const grid = new PartGrid(part);
  const topo = analyzeCells(part, grid);
  const positives: Manifold[] = [];
  const bores: Manifold[] = [];
  const slabs = new Map<string, Slab>();
  const sameKind = (a: CellTopo, b: Cell): boolean => b.kind === a.cell.kind;
  const sameHoleAxis = (a: CellTopo, b: Cell): boolean => isHole(b.kind) && b.axis === a.cell.axis;
  // Wheels (§4.2): hole cells under a rim's disc (the hub included) take the 3D path, so that
  // their bores are cut after the rim is united (the 2D path subtracts bores before that).
  const hubs = part.cells.filter(isHub);
  const underRim = new Set<CellTopo>();
  if (hubs.length) {
    for (const t of topo) {
      if (!isHole(t.cell.kind)) continue;
      const p = cellPos(t.cell);
      if (hubs.some((w) => discOverlapsCell(cellPos(w), w.axis, w.rim, p))) underRim.add(t);
    }
  }
  const prism = new Set<CellTopo>();
  if (fast) {
    for (const run of axialRuns(topo, (t) => isHole(t.cell.kind), sameHoleAxis)) {
      if (!isPrismRun(run, grid) || run.some((t) => underRim.has(t))) continue;
      for (const t of run) prism.add(t);
      const h = run[0]!.cell.axis;
      const z0 = localCenter(run[0]!.cell, origin)[h];
      const z1 = z0 + run.length - 1;
      const key = `${h},${z0},${z1}`;
      let slab = slabs.get(key);
      if (!slab) slabs.set(key, (slab = { axis: h, z0, z1, shapes: [], bores: [] }));
      addToSlab(s, slab, run[0]!, grid, localCenter(run[0]!.cell, origin));
    }
  }
  const inSlab = (t: CellTopo): boolean => prism.has(t);
  // Coaxial runs of the remaining (3D-path) holes: one barrel each. A run whose bore is blind at
  // both ends (each end's axial neighbour is a hole with a different axis) would be a sealed
  // internal cavity, unreachable and invisible: such cells get no bore (deviation, see
  // docs/DEVIATIONS.md). Prism runs are never sealed (they have no axial connection at their ends).
  const holeRuns = axialRuns(topo, (t) => isHole(t.cell.kind) && !inSlab(t), sameHoleAxis);
  const sealed = new Set<CellTopo>();
  for (const run of holeRuns) {
    const h = run[0]!.cell.axis;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const closed0 = blindAt(first, minusDir(h)) || capInRim(first, minusDir(h), hubs);
    const closed1 = blindAt(last, plusDir(h)) || capInRim(last, plusDir(h), hubs);
    if (closed0 && closed1) for (const t of run) sealed.add(t);
  }
  for (const t of topo) {
    const ctr = localCenter(t.cell, origin);
    if (isMale(t.cell.kind) || inSlab(t)) continue;
    for (const [lo, hi] of webBoxes(t, grid)) positives.push(s.t(zbox(s, lo, hi).translate(ctr)));
    if (!sealed.has(t)) bores.push(holeBore(s, t, ctr));
  }
  for (const run of axialRuns(topo, (t) => isMale(t.cell.kind), sameKind))
    positives.push(maleRod(s, run, localCenter(run[0]!.cell, origin)));
  for (const run of holeRuns) positives.push(barrelRun(s, run, localCenter(run[0]!.cell, origin)));
  for (const slab of slabs.values()) positives.push(slabSolid(s, slab));
  let pos: Manifold;
  if (hubs.length === 0) {
    pos = positives.length === 1 ? positives[0]! : s.t(M.union(positives));
  } else {
    const rimSolids = hubs.map((w) => place(s, zrim(s, w.rim), w.axis, localCenter(w, origin)));
    // Rule 1 (§2.6) joins every cell the *nominal* disc overlaps; the drawn rim is RIM_INSET smaller,
    // so a hole or a male near the rim's edge (e.g. (2, 3) of an r 3 wheel, a crank pin at (2, 2) of
    // an r 2.5 one) would float beside it as a separate shell. Bridge each such cell to its rim with a
    // short web (review findings; DEVIATIONS §4).
    for (const w of hubs) rimSolids.push(...rimBridges(s, part, w, origin));
    const base = positives.length === 0 ? null : positives.length === 1 ? positives[0]! : s.t(M.union(positives));
    pos = s.t(M.union(base ? [base, ...rimSolids] : rimSolids));
    if (marks) {
      rimMarks(part, grid).forEach((mk, i) => {
        // Everything of the part except this rim: a groove (or its opening) covered by such
        // material would be a sealed cavity or a slot through it, so that piece of the mark is
        // left out (see zmarkCutters).
        const rest = [...(base ? [base] : []), ...rimSolids.filter((_, j) => j !== i)];
        const others = rest.length === 0 ? null : rest.length === 1 ? rest[0]! : s.t(M.union(rest));
        for (const { cut, probe } of zmarkCutters(s, mk)) {
          if (others) {
            const hit = s.t(others.intersect(place(s, probe, mk.axis, mk.center)));
            if (hit.volume() > MARK_PROBE_VOL) continue;
          }
          bores.push(place(s, cut, mk.axis, mk.center));
        }
      });
    }
  }
  let solid = pos;
  if (bores.length > 0) {
    const cut = bores.length === 1 ? bores[0]! : s.t(M.union(bores));
    solid = s.t(pos.subtract(cut));
  }
  // Collapse the sub-micron sliver edges boolean ops can leave (they would become degenerate
  // triangles once positions are rounded to float32).
  solid = s.t(solid.simplify(SIMPLIFY_TOL));
  const status = solid.status();
  if (status !== 'NoError') throw new Error(`geometry: CSG failed (${status})`);
  return solid;
}

/** Volume of the part's render solid (cubic studs). */
export function partVolume(part: Part): number {
  return withScope((s) => buildSolid(s, part)?.volume() ?? 0);
}

export interface SolidStats {
  volume: number;
  genus: number;
  status: string;
  numTri: number;
  numVert: number;
}

/** Diagnostics of the raw CSG result (tests). */
export function partSolidStats(part: Part, opts: { fast?: boolean; marks?: boolean } = {}): SolidStats {
  return withScope((s) => {
    const m = buildSolid(s, part, opts.fast ?? true, opts.marks ?? true);
    if (!m) return { volume: 0, genus: 0, status: 'NoError', numTri: 0, numVert: 0 };
    return { volume: m.volume(), genus: m.genus(), status: m.status(), numTri: m.numTri(), numVert: m.numVert() };
  });
}

// ------------------------------------------------------------------------------------------
// Mesh output with creased normals

interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * Weld vertices whose float32 positions are identical and drop the triangles that become
 * degenerate. Boolean ops resolve exactly coincident input geometry by symbolic perturbation,
 * which can leave topologically distinct vertices at the same point joined by zero-length
 * edges; welding them is an edge collapse (topology and volume unchanged).
 */
function collapseCoincident(pos: Float32Array, tri: Uint32Array): { pos: Float32Array; tri: Uint32Array } {
  const nV = pos.length / 3;
  const ids = new Map<string, number>();
  const remap = new Uint32Array(nV);
  const out: number[] = [];
  for (let i = 0; i < nV; i++) {
    const key = `${pos[3 * i]},${pos[3 * i + 1]},${pos[3 * i + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = out.length / 3;
      ids.set(key, id);
      out.push(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!);
    }
    remap[i] = id;
  }
  if (out.length === pos.length) return { pos, tri };
  const t2: number[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    const a = remap[tri[t]!]!, b = remap[tri[t + 1]!]!, c = remap[tri[t + 2]!]!;
    if (a !== b && b !== c && a !== c) t2.push(a, b, c);
  }
  return { pos: new Float32Array(out), tri: new Uint32Array(t2) };
}

/**
 * Split vertices at creases. Corners (triangle, vertex) are unioned across every edge whose
 * dihedral angle is below the crease angle; each class becomes one output vertex whose normal is
 * the angle-weighted mean of its triangles' face normals.
 */
export function creasedMesh(rawPos: Float32Array, rawTri: Uint32Array, creaseDeg = CREASE_DEG): MeshArrays {
  const { pos, tri } = collapseCoincident(rawPos, rawTri);
  const nT = tri.length / 3;
  const nV = pos.length / 3;
  const fn = new Float64Array(nT * 3);
  const ok = new Uint8Array(nT);
  const w = new Float64Array(nT * 3);
  const v = (i: number, k: number): number => pos[3 * i + k]!;
  for (let t = 0; t < nT; t++) {
    const ia = tri[3 * t]!;
    const ib = tri[3 * t + 1]!;
    const ic = tri[3 * t + 2]!;
    const abx = v(ib, 0) - v(ia, 0), aby = v(ib, 1) - v(ia, 1), abz = v(ib, 2) - v(ia, 2);
    const acx = v(ic, 0) - v(ia, 0), acy = v(ic, 1) - v(ia, 1), acz = v(ic, 2) - v(ia, 2);
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-14)) continue;
    ok[t] = 1;
    fn[3 * t] = nx / len;
    fn[3 * t + 1] = ny / len;
    fn[3 * t + 2] = nz / len;
    const ids = [ia, ib, ic];
    for (let k = 0; k < 3; k++) {
      const p = ids[k]!, q = ids[(k + 1) % 3]!, r = ids[(k + 2) % 3]!;
      const ux = v(q, 0) - v(p, 0), uy = v(q, 1) - v(p, 1), uz = v(q, 2) - v(p, 2);
      const wx = v(r, 0) - v(p, 0), wy = v(r, 1) - v(p, 1), wz = v(r, 2) - v(p, 2);
      const d = Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz);
      w[3 * t + k] = d > 0 ? Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy + uz * wz) / d))) : 0;
    }
  }
  // Halfedge (a→b) → corner index 3t+k with tri[3t+k] = a. A duplicated halfedge (never
  // expected) is treated as a crease.
  const half = new Map<number, number>();
  for (let t = 0; t < nT; t++)
    for (let k = 0; k < 3; k++) {
      const key = tri[3 * t + k]! * nV + tri[3 * t + ((k + 1) % 3)]!;
      half.set(key, half.has(key) ? -1 : 3 * t + k);
    }
  const parent = new Int32Array(nT * 3);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const cosC = Math.cos((creaseDeg * Math.PI) / 180);
  for (let t = 0; t < nT; t++) {
    if (!ok[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = tri[3 * t + k]!, b = tri[3 * t + ((k + 1) % 3)]!;
      const o = half.get(b * nV + a);
      if (o === undefined || o < 0 || half.get(a * nV + b)! < 0) continue;
      const t2 = Math.floor(o / 3);
      if (t2 <= t || !ok[t2]) continue;
      const dot = fn[3 * t]! * fn[3 * t2]! + fn[3 * t + 1]! * fn[3 * t2 + 1]! + fn[3 * t + 2]! * fn[3 * t2 + 2]!;
      if (dot < cosC) continue;
      const k2 = o % 3; // corner of t2 at b; its next corner is at a
      union(3 * t + k, 3 * t2 + ((k2 + 1) % 3));
      union(3 * t + ((k + 1) % 3), 3 * t2 + k2);
    }
  }
  // One output vertex per class.
  const outIndex = new Int32Array(nT * 3).fill(-1);
  const classOf = new Int32Array(nT * 3);
  let n = 0;
  for (let c = 0; c < nT * 3; c++) {
    const r = find(c);
    if (outIndex[r] === -1) outIndex[r] = n++;
    classOf[c] = outIndex[r]!;
  }
  const positions = new Float32Array(n * 3);
  const acc = new Float64Array(n * 3);
  const vertOf = new Int32Array(n);
  for (let c = 0; c < nT * 3; c++) {
    const o = classOf[c]!;
    const vi = tri[c]!;
    vertOf[o] = vi;
    positions[3 * o] = pos[3 * vi]!;
    positions[3 * o + 1] = pos[3 * vi + 1]!;
    positions[3 * o + 2] = pos[3 * vi + 2]!;
    const t = Math.floor(c / 3);
    if (!ok[t]) continue;
    acc[3 * o] = acc[3 * o]! + fn[3 * t]! * w[c]!;
    acc[3 * o + 1] = acc[3 * o + 1]! + fn[3 * t + 1]! * w[c]!;
    acc[3 * o + 2] = acc[3 * o + 2]! + fn[3 * t + 2]! * w[c]!;
  }
  // Classes made only of degenerate corners borrow the normal of another class at the vertex.
  const goodAtVert = new Int32Array(nV).fill(-1);
  const lens = new Float64Array(n);
  for (let o = 0; o < n; o++) {
    lens[o] = Math.hypot(acc[3 * o]!, acc[3 * o + 1]!, acc[3 * o + 2]!);
    if (lens[o]! > 1e-12) goodAtVert[vertOf[o]!] = o;
  }
  const normals = new Float32Array(n * 3);
  for (let o = 0; o < n; o++) {
    let src = o;
    if (!(lens[o]! > 1e-12)) src = goodAtVert[vertOf[o]!]!;
    if (src < 0) {
      normals[3 * o + 2] = 1;
      continue;
    }
    const l = lens[src]!;
    normals[3 * o] = acc[3 * src]! / l;
    normals[3 * o + 1] = acc[3 * src + 1]! / l;
    normals[3 * o + 2] = acc[3 * src + 2]! / l;
  }
  const indices = new Uint32Array(nT * 3);
  for (let c = 0; c < nT * 3; c++) indices[c] = classOf[c]!;
  return { positions, normals, indices };
}

// ------------------------------------------------------------------------------------------
// Cache + public builder

const CACHE_LIMIT = 1024;

const cache = new Map<string, MeshArrays>();
let cacheHits = 0;
let cacheMisses = 0;

export function meshCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits: cacheHits, misses: cacheMisses };
}

export function clearMeshCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

function buildArrays(part: Part): MeshArrays {
  return withScope((s) => {
    const m = buildSolid(s, part);
    if (!m) return { positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint32Array(0) };
    const mesh = m.getMesh();
    return creasedMesh(mesh.vertProperties, mesh.triVerts);
  });
}

/**
 * Render mesh of a part in its part-local frame. Cached by the translation-normalised cell
 * signature (LRU, 1024 entries): translated copies share the *same* typed arrays, so callers
 * must treat positions/normals/indices as read-only.
 */
export function buildPartMesh(part: Part): MeshData {
  const origin = partOrigin(part);
  const key = partSignature(part);
  let arrays = cache.get(key);
  if (arrays) {
    cacheHits++;
    cache.delete(key);
    cache.set(key, arrays);
  } else {
    cacheMisses++;
    arrays = buildArrays(part);
    cache.set(key, arrays);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return { positions: arrays.positions, normals: arrays.normals, indices: arrays.indices, origin };
}
