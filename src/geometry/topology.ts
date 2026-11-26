// Shared part-local frame and per-cell connection analysis used by both the render solid
// (solid.ts) and the collision compound (colliders.ts), so the two cannot disagree. Pure.
import { DIRS, connects, gearPlaneBasis, gearTeeth, gearToothAngle, isGear, isHole, isMale, posKey, tipRadius } from '../core';
import type { Axis, Cell, Dir, Part } from '../core';
import { E_CONN, E_FREE, H, MARK_D, MARK_R0, MARK_W, RIM_INSET } from './dims';

export type Vec3 = [number, number, number];

/**
 * Part-local frame convention: local = world − origin, where origin is the component-wise
 * minimum of the part's cell positions (an integer point; the min corner cell's centre).
 */
export function partOrigin(part: Part): Vec3 {
  let x = Infinity;
  let y = Infinity;
  let z = Infinity;
  for (const c of part.cells) {
    if (c.x < x) x = c.x;
    if (c.y < y) y = c.y;
    if (c.z < z) z = c.z;
  }
  if (part.cells.length === 0) return [0, 0, 0];
  return [x, y, z];
}

/** Cell centre in the part-local frame. */
export function localCenter(c: Cell, origin: Vec3): Vec3 {
  return [c.x - origin[0], c.y - origin[1], c.z - origin[2]];
}

/**
 * Translation-normalised signature of a part's cells (kind, axis, rim and position relative to
 * partOrigin, sorted). Equal signatures ⇔ identical geometry in the part-local frame.
 * Colour and id are not part of it. A cell without a rim has exactly the pre-wheels signature, and
 * a cell without teeth exactly the pre-gears one (a gear appends `,t`).
 */
export function partSignature(part: Part): string {
  const o = partOrigin(part);
  const items = part.cells.map(
    (c) =>
      `${c.x - o[0]},${c.y - o[1]},${c.z - o[2]},${c.kind},${c.axis}${c.rim !== undefined ? `,r${c.rim}` : ''}${c.teeth === true ? ',t' : ''}`,
  );
  items.sort();
  return items.join(';');
}

/** What lies on one face of a cell, within the same part. */
export interface FaceInfo {
  /** The in-part cell at the adjacent position, if any. */
  readonly neighbour: Cell | undefined;
  /** In-part connection across this face (§2.2). */
  readonly connected: boolean;
}

export interface CellTopo {
  readonly cell: Cell;
  readonly index: number;
  /** Indexed by Dir (+X, −X, +Y, −Y, +Z, −Z). */
  readonly faces: readonly FaceInfo[];
}

/** Lookup of a part's cells by position. */
export class PartGrid {
  private readonly map = new Map<string, Cell>();
  constructor(readonly part: Part) {
    for (const c of part.cells) this.map.set(posKey(c.x, c.y, c.z), c);
  }
  at(x: number, y: number, z: number): Cell | undefined {
    return this.map.get(posKey(x, y, z));
  }
  /** Is there a hole cell of this part at c + d1 + d2 (d2 optional)? */
  holeAt(c: Cell, d1: Dir | null, d2: Dir | null = null): boolean {
    let x = c.x;
    let y = c.y;
    let z = c.z;
    for (const d of [d1, d2]) {
      if (d === null) continue;
      const v = DIRS[d]!;
      x += v[0];
      y += v[1];
      z += v[2];
    }
    const n = this.at(x, y, z);
    return n !== undefined && isHole(n.kind);
  }
}

export function analyzeCells(part: Part, grid: PartGrid = new PartGrid(part)): CellTopo[] {
  return part.cells.map((cell, index) => {
    const faces: FaceInfo[] = [];
    for (let d = 0; d < 6; d++) {
      const v = DIRS[d]!;
      const nb = grid.at(cell.x + v[0], cell.y + v[1], cell.z + v[2]);
      faces.push({ neighbour: nb, connected: nb !== undefined && connects(cell, nb) });
    }
    return { cell, index, faces };
  });
}

/** Dir of +axis / −axis. */
export function plusDir(axis: Axis): Dir {
  return (axis * 2) as Dir;
}
export function minusDir(axis: Axis): Dir {
  return (axis * 2 + 1) as Dir;
}

/**
 * Extent [lo, hi] (relative to the cell centre, along the male's axis) of a male cell's rod:
 * ±E_FREE, extended to ±(½+EPS) on connected ends. Shared by the solid and the colliders.
 */
export function rodExtent(t: CellTopo): [number, number] {
  if (!isMale(t.cell.kind)) throw new Error('rodExtent: not a male cell');
  const a = t.cell.axis;
  const hi = t.faces[plusDir(a)]!.connected ? E_CONN : E_FREE;
  const lo = t.faces[minusDir(a)]!.connected ? -E_CONN : -E_FREE;
  return [lo, hi];
}

// ---- wheels (§4.2 rim + index mark, §4.3 disc) ----------------------------------------------

/** Is this cell a wheel hub (a hole cell with a rim)? */
export function isHub(c: Cell): c is Cell & { rim: number } {
  return c.rim !== undefined && isHole(c.kind);
}

/**
 * The index mark of a rim (§4.2), in the part-local frame. The mark is cut into the render mesh
 * by solid.ts as a rectangular groove (so its walls are creases, which the outline pass draws as
 * lines); this record lets the view/picking code know where it is without reading the mesh (e.g.
 * to paint it, or to test that it turns while simulating). Its direction is the hub axis's first
 * transverse axis, (axis + 1) % 3, positive side: in the part's edit-time placement it points
 * along +X for a wheel about Z, +Y for a wheel about X, +Z for a wheel about Y; during simulation
 * it turns with the part's body.
 */
export interface RimMark {
  /** Index of the hub cell in part.cells. */
  cell: number;
  /** Hub centre, part-local. */
  center: Vec3;
  /** Wheel axis. */
  axis: Axis;
  /** Unit direction of the mark from the centre (part-local = world at edit time). */
  dir: Vec3;
  /** Radial extent of the flat-face grooves: from r0 to r1 (r1 = the rim's visual radius r − RIM_INSET). */
  r0: number;
  r1: number;
  /** Tangential width of the groove. */
  width: number;
  /** Depth of the groove into each flat face and into the tread. */
  depth: number;
  /** Is the groove continued across the tread? false when a cell of the part continues past the rim edge along the mark. */
  tread: boolean;
  /**
   * Present (true) only on the face groove of a gear (§4.2 "Index"): the groove ends at r1 =
   * root − GEAR_MARK_END with an end wall (it does not run out across the teeth), and tread is
   * false. Gears of r ½ (8 teeth) have no RimMark at all: their only index is the painted tooth
   * (see gearIndexes).
   */
  gear?: true;
}

/** Index marks of every rim of a part (in cell order). */
export function rimMarks(part: Part, grid: PartGrid = new PartGrid(part)): RimMark[] {
  const origin = partOrigin(part);
  const out: RimMark[] = [];
  part.cells.forEach((c, index) => {
    if (!isHub(c)) return;
    const t = ((c.axis + 1) % 3) as Axis;
    const dir: Vec3 = [0, 0, 0];
    dir[t] = 1;
    if (isGear(c)) {
      // The wheel's face groove along +u (= dir: gearPlaneBasis(axis)[0] is (axis + 1) % 3), from
      // MARK_R0 to GEAR_MARK_END inside the root circle, faces only (§4.2). None on an 8.
      if (c.rim < 1) return;
      const r1 = gearRootRadius(c.rim) - GEAR_MARK_END;
      out.push({ cell: index, center: localCenter(c, origin), axis: c.axis, dir, r0: MARK_R0, r1, width: MARK_W, depth: MARK_D, tread: false, gear: true });
      return;
    }
    const r1 = c.rim - RIM_INSET;
    // Cells on the mark line, in the hub's layer, whose cube reaches the tread groove's radial band.
    let tread = true;
    for (let k = Math.ceil(r1 - MARK_D - 0.5); k <= Math.floor(r1 + 0.02 + 0.5); k++) {
      if (grid.at(c.x + dir[0] * k, c.y + dir[1] * k, c.z + dir[2] * k)) tread = false;
    }
    out.push({ cell: index, center: localCenter(c, origin), axis: c.axis, dir, r0: MARK_R0, r1, width: MARK_W, depth: MARK_D, tread });
  });
  return out;
}

// ---- gears (§2.7, §4.2 "Per gear") ----------------------------------------------------------

/** Pressure angle of the involute teeth (radians): 20°. */
export const GEAR_PRESSURE_ANGLE = (20 * Math.PI) / 180;
/** Dedendum (pitch radius − root radius), units: 5/32. (The addendum is the core's GEAR_TIP, 3/32.) */
export const GEAR_DEDENDUM = 5 / 32;
/** Backlash per meshed pair at the pitch circle (units): each tooth is BACKLASH/2 thinner than π/16. */
export const GEAR_BACKLASH = 0.05;
/** Points per involute flank (from the base circle to the tip). */
export const GEAR_FLANK_POINTS = 5;
/** Segments across each tip land and each root land. */
export const GEAR_LAND_SEGMENTS = 2;
/** The gear's face groove (r ≥ 1) ends this far inside the root circle. */
export const GEAR_MARK_END = 0.05;

/** Is this cell a gear hub (a hole cell with a gear: teeth on a rim in GEAR_RADII)? */
export function isGearHub(c: Cell): c is Cell & { rim: number; teeth: true } {
  return isGear(c) && isHole(c.kind);
}
/** Root radius r − 5/32 of a gear of pitch radius r. */
export function gearRootRadius(r: number): number {
  return r - GEAR_DEDENDUM;
}
/** Base circle radius r·cos 20° of a gear of pitch radius r. */
export function gearBaseRadius(r: number): number {
  return r * Math.cos(GEAR_PRESSURE_ANGLE);
}

function involuteFn(a: number): number {
  return Math.tan(a) - a;
}

/**
 * Closed outline of a gear of pitch radius r (§4.2), as points (pu, pv) about the hub in the
 * gear's plane basis (u, v) = gearPlaneBasis(axis) — world axes — counter-clockwise from +u toward
 * +v. Tooth k is centred at gearToothAngle(T, k). Per tooth, in order: right flank from the root to
 * the tip (2 points of the parallel flank below the base circle, then GEAR_FLANK_POINTS involute
 * points from the base circle to the tip), the middle of the tip land, the left flank from the tip
 * to the root, the middle of the root land: 16 points per tooth, 2 segments on each land.
 * Ported from spikes/gearlook/gear.ts (gearProfile, 'involute', underBase 'parallel').
 */
export function gearOutline(r: number): [number, number][] {
  const T = gearTeeth(r);
  const alpha = GEAR_PRESSURE_ANGLE;
  const ra = tipRadius(r);
  const rf = gearRootRadius(r);
  const rb = gearBaseRadius(r);
  const pitchAng = (2 * Math.PI) / T;
  // Half the tooth's angular thickness on the pitch circle: (π/16 − backlash/2) / (2r).
  const halfP = ((Math.PI * r) / T - GEAR_BACKLASH / 2) / (2 * r);
  const flankAng = (rho: number): number => halfP + involuteFn(alpha) - involuteFn(Math.acos(rb / Math.max(rho, rb)));
  const tipHalf = flankAng(ra);
  // Below the base circle the flank keeps the base circle's linear half-width (parallel flank).
  const hw = flankAng(rb) * rb;
  const flank: [number, number][] = []; // (radius, half-angle), root → tip
  for (const t of [0, 0.5]) {
    const rho = rf + (rb - rf) * t;
    flank.push([rho, Math.min(hw / rho, pitchAng / 2 - 0.02)]);
  }
  for (let i = 0; i < GEAR_FLANK_POINTS; i++) {
    const rho = rb + ((ra - rb) * i) / (GEAR_FLANK_POINTS - 1);
    flank.push([rho, flankAng(rho)]);
  }
  const pts: [number, number][] = [];
  const P = (rho: number, ang: number): void => {
    pts.push([rho * Math.cos(ang), rho * Math.sin(ang)]);
  };
  for (let k = 0; k < T; k++) {
    const c = gearToothAngle(T, k);
    for (const [rho, h] of flank) P(rho, c - h);
    for (let i = 1; i < GEAR_LAND_SEGMENTS; i++) P(ra, c - tipHalf + (2 * tipHalf * i) / GEAR_LAND_SEGMENTS);
    for (let i = flank.length - 1; i >= 0; i--) P(flank[i]![0], c + flank[i]![1]);
    const a0 = c + flank[0]![1];
    const a1 = c + pitchAng - flank[0]![1];
    for (let i = 1; i < GEAR_LAND_SEGMENTS; i++) P(rf, a0 + ((a1 - a0) * i) / GEAR_LAND_SEGMENTS);
  }
  return pts;
}

/**
 * Where a gear is and where its index tooth is (§4.2 "Index", §6.1 "Gears"), in the part-local
 * frame (= world axes at edit time; while simulating it turns with the part's body). The view
 * paints tooth 0's flanks and tip land in the mark colour on every gear (indexToothWeights), on top
 * of the face groove that rimMarks describes for gears with r ≥ 1.
 */
export interface GearIndex {
  /** Index of the hub cell in part.cells. */
  cell: number;
  /** Hub centre, part-local. */
  center: Vec3;
  /** Gear axis. */
  axis: Axis;
  /** The plane basis gearPlaneBasis(axis) as unit vectors (u × v = +axis). */
  u: Vec3;
  v: Vec3;
  /** Number of teeth T = 16·r. */
  teeth: number;
  /** Pitch, tip and root radius. */
  pitch: number;
  tip: number;
  root: number;
  /** Angle of the centre of tooth 0 (the index tooth) from +u toward +v: gearToothAngle(T, 0) = π/(2T). */
  angle: number;
  /** Patch id of this gear's tooth band in MeshData.patchHint (1-based, in cell order of the gear hubs). */
  patch: number;
}

/** Every gear of a part, in cell order. */
export function gearIndexes(part: Part): GearIndex[] {
  const origin = partOrigin(part);
  const out: GearIndex[] = [];
  part.cells.forEach((c, index) => {
    if (!isGearHub(c)) return;
    const [ua, va] = gearPlaneBasis(c.axis);
    const u: Vec3 = [0, 0, 0];
    const v: Vec3 = [0, 0, 0];
    u[ua] = 1;
    v[va] = 1;
    const T = gearTeeth(c.rim);
    out.push({
      cell: index,
      center: localCenter(c, origin),
      axis: c.axis,
      u,
      v,
      teeth: T,
      pitch: c.rim,
      tip: tipRadius(c.rim),
      root: gearRootRadius(c.rim),
      angle: gearToothAngle(T, 0),
      patch: out.length + 1,
    });
  });
  return out;
}

const GEAR_TOL = 2e-3;

/**
 * Is the mesh vertex at part-local p with unit normal n on the gear's tooth band (flanks, tip
 * lands, root lands, within the gear's slab ±H)? The flat faces (normal ∥ axis), bores, the
 * groove and everything outside the slab are not.
 */
export function onToothBand(g: GearIndex, p: ArrayLike<number>, n: ArrayLike<number>): boolean {
  const a = g.axis;
  const q0 = p[0]! - g.center[0], q1 = p[1]! - g.center[1], q2 = p[2]! - g.center[2];
  const q = [q0, q1, q2];
  if (Math.abs(q[a]!) > H + GEAR_TOL || Math.abs(n[a]!) >= 0.5) return false;
  const rho = Math.hypot(q[(a + 1) % 3]!, q[(a + 2) % 3]!);
  return rho >= g.root - GEAR_TOL && rho <= g.tip + GEAR_TOL;
}

/** Is the mesh vertex (p, n) on the index tooth (tooth 0's flanks and tip land, not its root lands)? */
export function onIndexTooth(g: GearIndex, p: ArrayLike<number>, n: ArrayLike<number>): boolean {
  if (!onToothBand(g, p, n)) return false;
  const ua = (g.axis + 1) % 3;
  const va = (g.axis + 2) % 3;
  const qu = p[ua]! - g.center[ua]!;
  const qv = p[va]! - g.center[va]!;
  const rho = Math.hypot(qu, qv);
  // Root land: radial normal below the tip (the flank's normal is at most ~34° from tangential).
  const nr = (n[ua]! * qu + n[va]! * qv) / rho;
  if (nr > 0.9 && rho < g.tip - GEAR_TOL) return false;
  let d = Math.atan2(qv, qu) - g.angle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) < Math.PI / g.teeth;
}

/**
 * Per-vertex weights (1 = on an index tooth, 0 = elsewhere) for a part's mesh, like the view's
 * markWeights for the wheel groove: positions/normals as in MeshData. All zero without gears.
 */
export function indexToothWeights(part: Part, positions: Float32Array, normals: Float32Array): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n);
  const gears = gearIndexes(part);
  if (!gears.length) return out;
  for (let i = 0; i < n; i++) {
    const p = positions.subarray(3 * i, 3 * i + 3);
    const q = normals.subarray(3 * i, 3 * i + 3);
    for (const g of gears) if (onIndexTooth(g, p, q)) out[i] = 1;
  }
  return out;
}
