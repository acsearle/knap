// Model operations (DESIGN.md §2.4–2.7). Pure functions: inputs are never mutated; unchanged
// parts/cells are shared structurally between the input and output models.
import { discCells, discOverlapsCell, discReach, discsOverlap, fineDiscCells, planeAxes } from './disc';
import {
  GEAR_GROUND_EXTRA,
  GEAR_RADII,
  gearContact,
  gearTeeth,
  isGearRadius,
  isWebCell,
  tipOverlapsCell,
  tipOverlapsRod,
  tipOverlapsWheel,
  tipRadius,
} from './gears';
import {
  AXES,
  DIRS,
  connects,
  isAxis,
  isHole,
  isKind,
  isMale,
  kindLabel,
  shareResult,
} from './rules';
import type {
  Axis,
  CanResult,
  Cell,
  Kind,
  Model,
  Part,
  ValidationError,
  Vec3i,
} from './types';

// ---------------------------------------------------------------------------------------------
// Small helpers

type XYZ = { readonly x: number; readonly y: number; readonly z: number };

/** Map key for a grid position. */
export function posKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** Map key for a cell's (or any {x,y,z}'s) position. */
export function cellKey(c: XYZ): string {
  return `${c.x},${c.y},${c.z}`;
}

export function cellPos(c: XYZ): Vec3i {
  return [c.x, c.y, c.z];
}

function fmtPos(p: XYZ | Vec3i): string {
  return 'x' in p ? `(${p.x}, ${p.y}, ${p.z})` : `(${p[0]}, ${p[1]}, ${p[2]})`;
}

/**
 * Copy of a cell with only the known fields. `rim` is kept when given (not undefined) and
 * `teeth: true` when `teeth` is true (§2.7); the keys are omitted otherwise, so cells without a
 * rim look exactly as before (serialisation, deep equality). Key order: x, y, z, kind, axis, rim, teeth.
 */
export function makeCell(x: number, y: number, z: number, kind: Kind, axis: Axis, rim?: number, teeth?: boolean): Cell {
  if (rim === undefined) return teeth === true ? { x, y, z, kind, axis, teeth: true } : { x, y, z, kind, axis };
  return teeth === true ? { x, y, z, kind, axis, rim, teeth: true } : { x, y, z, kind, axis, rim };
}

/** Copy of a cell with only the known fields (rim and teeth included). */
export function copyCell(c: Cell): Cell {
  return makeCell(c.x, c.y, c.z, c.kind, c.axis, c.rim, c.teeth);
}

export function emptyModel(): Model {
  return { version: 1, parts: [], rootPartId: null, nextPartId: 1 };
}

export function partById(m: Model, partId: number): Part | undefined {
  return m.parts.find((p) => p.id === partId);
}

function requirePart(m: Model, partId: number): Part {
  const p = partById(m, partId);
  if (!p) throw new Error(`no part with id ${partId}`);
  return p;
}

/** The cell of `part` at `pos`, if any. */
export function cellAt(part: Part, pos: Vec3i): Cell | undefined {
  return part.cells.find((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
}

/** The part fixed during simulation: rootPartId if it names an existing part, else the lowest id. */
export function effectiveRootId(m: Model): number | null {
  if (m.rootPartId !== null && m.parts.some((p) => p.id === m.rootPartId)) return m.rootPartId;
  let best: number | null = null;
  for (const p of m.parts) if (best === null || p.id < best) best = p.id;
  return best;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Default colours (§6.1) used when a new part is created without an explicit colour. */
export const DEFAULT_COLORS: Readonly<Record<Kind, string>> = {
  pinHole: '#e0b43c', // the UI normally passes its current palette colour for holes
  axleHole: '#e0b43c',
  axle: '#a8adb2', // light grey
  pin: '#d9c9a3', // tan
  frictionPin: '#2f63c4', // blue
};

export function defaultColorFor(kind: Kind): string {
  return DEFAULT_COLORS[kind];
}

// ---------------------------------------------------------------------------------------------
// Wheels: constants and small predicates (§2.6)

/** Smallest wheel radius (units). A bare hole cell is the "radius ½" wheel and carries no rim. */
export const RIM_MIN = 1;
/** Largest wheel radius (units). */
export const RIM_MAX = 4;
/** Rim radii are multiples of this (units). */
export const RIM_STEP = 0.5;

/** Is `r` an allowed rim value: a multiple of RIM_STEP with RIM_MIN ≤ r ≤ RIM_MAX? */
export function isValidRim(r: unknown): r is number {
  return typeof r === 'number' && Number.isInteger(r / RIM_STEP) && r >= RIM_MIN && r <= RIM_MAX;
}

/** Does the cell carry a rim (is it a wheel hub)? */
export function hasRim(c: Cell): c is Cell & { rim: number } {
  return c.rim !== undefined;
}

/** "radius 1.5 (24 mm across)" style text is the UI's; this is the plain "radius 1.5". */
function fmtRim(r: number): string {
  return `radius ${r}`;
}

/** Is the cell a gear (§2.7): `teeth: true` on a rim in GEAR_RADII? (Hole-ness is validateModel's business.) */
export function isGear(c: Cell): c is Cell & { rim: number; teeth: true } {
  return c.teeth === true && isGearRadius(c.rim);
}

/**
 * The radius of the cell's disc if it carries a well-formed one — a plain rim (isValidRim, no
 * teeth) or a gear (isGear) — else null. Says nothing about the cell's kind.
 */
export function discRadiusOf(c: Cell): number | null {
  if (c.rim === undefined) return null;
  if (c.teeth === undefined) return isValidRim(c.rim) ? c.rim : null;
  return isGear(c) ? c.rim : null;
}

/** Does the model use a version-3 feature (a gear, i.e. a cell with `teeth`)? */
export function usesGears(m: Model): boolean {
  for (const p of m.parts) for (const c of p.cells) if (c.teeth !== undefined) return true;
  return false;
}

/** Does the model use a version-2 feature (a rim, `ground` or `fixRoot`)? */
export function usesV2Features(m: Model): boolean {
  if (m.ground !== undefined || m.fixRoot !== undefined) return true;
  for (const p of m.parts) for (const c of p.cells) if (c.rim !== undefined) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// World index

export interface WorldEntry {
  readonly partId: number;
  readonly cell: Cell;
  /** Index of the cell within its part's `cells`. */
  readonly index: number;
}

/**
 * A disc for the rule checks (§2.6, §2.7): its hub cell, position, radius (pitch radius for a
 * gear) and whether it is a gear.
 */
export interface DiscSpec {
  readonly cell: Cell;
  readonly hub: Vec3i;
  readonly r: number;
  readonly gear: boolean;
}

/** A wheel or gear hub in the world: a hole cell with a well-formed rim (and maybe teeth). */
export interface RimEntry extends WorldEntry, DiscSpec {
  readonly cell: Cell & { rim: number };
  /** The rim radius (= cell.rim; the pitch radius for a gear). */
  readonly r: number;
  /** Hub position. */
  readonly hub: Vec3i;
  /** True for a gear (§2.7). */
  readonly gear: boolean;
}

const EMPTY: readonly WorldEntry[] = Object.freeze([]);

/** Bucket size (cells) of the rim spatial hash; ≥ the largest possible reach between two discs. */
const RIM_BUCKET = 2 * RIM_MAX;
/** Below this many rims, rim queries scan the list instead of the spatial hash. */
const RIM_LINEAR = 32;

/**
 * Position -> cells (with part ids) occupying it, plus the model's wheel hubs (§2.6) with a
 * spatial hash so that the wheel rules stay linear in practice. Build with `worldIndex(m)` (cached).
 */
export class WorldIndex {
  readonly map = new Map<string, WorldEntry[]>();
  /** Every hub cell (hole cell with a valid rim or gear, discRadiusOf) in the model, in part order then cell order. */
  readonly rims: RimEntry[] = [];
  private readonly rimBuckets = new Map<string, RimEntry[]>();

  constructor(m: Model) {
    for (const part of m.parts) {
      part.cells.forEach((cell, index) => {
        const k = cellKey(cell);
        const list = this.map.get(k);
        const e: WorldEntry = { partId: part.id, cell, index };
        if (list) list.push(e);
        else this.map.set(k, [e]);
        const r = discRadiusOf(cell);
        if (r !== null && isHole(cell.kind)) {
          const re: RimEntry = { partId: part.id, cell: cell as Cell & { rim: number }, index, r, hub: cellPos(cell), gear: cell.teeth === true };
          this.rims.push(re);
          const bk = bucketKey(cell.x, cell.y, cell.z);
          const b = this.rimBuckets.get(bk);
          if (b) b.push(re);
          else this.rimBuckets.set(bk, [re]);
        }
      });
    }
  }

  at(pos: Vec3i): readonly WorldEntry[] {
    return this.map.get(posKey(pos[0], pos[1], pos[2])) ?? EMPTY;
  }

  atXYZ(p: XYZ): readonly WorldEntry[] {
    return this.map.get(cellKey(p)) ?? EMPTY;
  }

  /** Does part `partId` have a hole cell at `p`? */
  holeOfPartAt(partId: number, p: XYZ | Vec3i): boolean {
    const list = 'x' in p ? this.atXYZ(p) : this.at(p);
    return list.some((e) => e.partId === partId && isHole(e.cell.kind));
  }

  /**
   * Hubs whose position is within `reach` cells of `pos` on every axis (a superset filter; callers
   * apply the exact disc tests). reach ≤ 2·RIM_MAX.
   */
  rimsNear(pos: Vec3i, reach: number = RIM_BUCKET): readonly RimEntry[] {
    if (this.rims.length === 0) return [];
    const near = (e: RimEntry) =>
      Math.abs(e.hub[0] - pos[0]) <= reach && Math.abs(e.hub[1] - pos[1]) <= reach && Math.abs(e.hub[2] - pos[2]) <= reach;
    if (this.rims.length <= RIM_LINEAR || reach > RIM_BUCKET) return this.rims.filter(near);
    const out: RimEntry[] = [];
    const bx = Math.floor(pos[0] / RIM_BUCKET);
    const by = Math.floor(pos[1] / RIM_BUCKET);
    const bz = Math.floor(pos[2] / RIM_BUCKET);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const b = this.rimBuckets.get(`${bx + i},${by + j},${bz + k}`);
          if (b) for (const e of b) if (near(e)) out.push(e);
        }
    return out;
  }

  /**
   * Is the world entry a cell in the web of a gear of its own part (§2.7 rule 5, isWebCell)? Such
   * a cell is part of that gear's body (see discCellIssue).
   */
  inOwnGearWeb(e: WorldEntry): boolean {
    if (this.rims.length === 0) return false;
    const pos = cellPos(e.cell);
    return this.rimsNear(pos, BLOCK_REACH).some((r) => r.partId === e.partId && r.gear && isWebCell(r.cell, e.cell));
  }

  /**
   * Hubs (of any part) whose disc overlaps the cell at `pos` with positive volume (§2.6). For a
   * gear this is its pitch disc (what the gear is made of), not the tip disc that blocks.
   */
  discsOverlapping(pos: Vec3i): RimEntry[] {
    const out: RimEntry[] = [];
    for (const e of this.rimsNear(pos, discReach(RIM_MAX))) if (discOverlapsCell(e.hub, e.cell.axis, e.r, pos)) out.push(e);
    return out;
  }
}

function bucketKey(x: number, y: number, z: number): string {
  return `${Math.floor(x / RIM_BUCKET)},${Math.floor(y / RIM_BUCKET)},${Math.floor(z / RIM_BUCKET)}`;
}

const indexCache = new WeakMap<Model, WorldIndex>();

/**
 * World index for a model, cached by model identity. Models MUST NOT be mutated after they have
 * been passed to any core function (canAddCell, addPart, movePart, rotatePart, cellsAt, …):
 * build a new model instead (all core operations do). validateModel does not use this cache.
 */
export function worldIndex(m: Model): WorldIndex {
  let w = indexCache.get(m);
  if (!w) {
    w = new WorldIndex(m);
    indexCache.set(m, w);
  }
  return w;
}

/** All cells (of any part) at a position. */
export function cellsAt(m: Model, pos: Vec3i): readonly WorldEntry[] {
  return worldIndex(m).at(pos);
}

/**
 * Wheels and gears (hub cells with a rim, of any part) whose disc overlaps the cell at `pos` with
 * positive volume — the pitch disc for a gear. For picking "virtual cells" of a wheel (§7.3) and
 * for status texts.
 */
export function wheelsAt(m: Model, pos: Vec3i): readonly RimEntry[] {
  return worldIndex(m).discsOverlapping(pos);
}

// ---------------------------------------------------------------------------------------------
// Part-internal structure

/**
 * Connected components of a cell list under the in-part connection rule (§2.2) extended by
 * wheels (§2.6 rule 1): a rim connects its hub to every cell of the list that its disc overlaps
 * (for a gear, its pitch disc: the web cells, §2.7),
 * and two rims whose discs overlap connect their hubs (they are fused material; see
 * docs/DEVIATIONS.md "Wheels"). Each component is a list of indices into `cells`, ascending;
 * components are ordered by their lowest index. Cells at duplicate positions are treated as
 * separate (the first one at a position wins the lookup), so callers should check duplicates
 * first. Rims with an invalid value are ignored here (validateModel reports them).
 */
export function components(cells: readonly Cell[]): number[][] {
  const at = new Map<string, number>();
  cells.forEach((c, i) => {
    const k = cellKey(c);
    if (!at.has(k)) at.set(k, i);
  });
  const parent = new Int32Array(cells.length);
  for (let i = 0; i < cells.length; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const hubs: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    // Face connections: looking in the three + directions finds every adjacent pair once.
    for (let d = 0; d < 6; d += 2) {
      const v = DIRS[d]!;
      const j = at.get(posKey(c.x + v[0], c.y + v[1], c.z + v[2]));
      if (j !== undefined && connects(c, cells[j]!)) union(i, j);
    }
    if (discRadiusOf(c) !== null && isAxis(c.axis) && Number.isSafeInteger(c.x) && Number.isSafeInteger(c.y) && Number.isSafeInteger(c.z)) {
      hubs.push(i);
      for (const q of discCells(cellPos(c), c.axis, c.rim!)) {
        const j = at.get(posKey(q[0], q[1], q[2]));
        if (j !== undefined) union(i, j);
      }
    }
  }
  for (let a = 0; a < hubs.length; a++)
    for (let b = a + 1; b < hubs.length; b++) {
      const ca = cells[hubs[a]!]!;
      const cb = cells[hubs[b]!]!;
      if (discsOverlap(cellPos(ca), ca.axis, ca.rim!, cellPos(cb), cb.axis, cb.rim!)) union(hubs[a]!, hubs[b]!);
    }
  const byRoot = new Map<number, number[]>();
  const out: number[][] = [];
  for (let i = 0; i < cells.length; i++) {
    const r = find(i);
    let list = byRoot.get(r);
    if (!list) {
      list = [];
      byRoot.set(r, list);
      out.push(list);
    }
    list.push(i);
  }
  return out;
}

function cellStructureError(c: unknown): string | null {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return 'expected an object {x,y,z,kind,axis}';
  const o = c as Record<string, unknown>;
  for (const f of ['x', 'y', 'z'] as const) {
    if (typeof o[f] !== 'number' || !Number.isSafeInteger(o[f])) return `${f} must be an integer (got ${JSON.stringify(o[f])})`;
  }
  if (!isKind(o.kind)) return `kind must be one of pinHole, axleHole, axle, pin, frictionPin (got ${JSON.stringify(o.kind)})`;
  if (!isAxis(o.axis)) return `axis must be 0, 1 or 2 (got ${JSON.stringify(o.axis)})`;
  return null;
}

const GEAR_RADII_TEXT = '½, 1, 1½ or 2½ (8, 16, 24 or 40 teeth)';

/**
 * Problem with a well-formed cell's rim (§2.6) or teeth (§2.7), or null. A plain rim must be a
 * multiple of ½ from RIM_MIN to RIM_MAX and sit on a hole cell; `teeth` must be `true`, on a hole
 * cell, with a rim in GEAR_RADII. `undefined` is "no rim" / "no teeth" (fine).
 */
function rimError(c: Cell): string | null {
  const r = (c as { rim?: unknown }).rim;
  const t = (c as { teeth?: unknown }).teeth;
  const show = (v: unknown) => (typeof v === 'number' ? String(v) : JSON.stringify(v));
  if (t !== undefined) {
    if (t !== true) return `teeth must be true when present (got ${JSON.stringify(t)})`;
    if (!isHole(c.kind)) return `a ${kindLabel(c.kind)} cannot carry teeth: gears grow from pin holes and axle holes`;
    if (r === undefined) return `teeth without a rim: a gear is a toothed rim of radius ${GEAR_RADII_TEXT}`;
    if (!isGearRadius(r)) return `a gear's radius must be ${GEAR_RADII_TEXT} (got rim ${show(r)} with teeth)`;
    return null;
  }
  if (r === undefined) return null;
  if (!isValidRim(r)) {
    const half = r === 0.5 ? ': radius ½ exists only as a gear (teeth: true)' : '';
    return `rim must be a multiple of ½ from ${RIM_MIN} to ${RIM_MAX} (got ${show(r)})${half}`;
  }
  if (!isHole(c.kind)) return `a ${kindLabel(c.kind)} cannot carry a rim: wheels grow from pin holes and axle holes`;
  return null;
}

/** Problems with a candidate part's cell list (structure, duplicates, connectivity). */
function partCellErrors(cells: readonly Cell[], partId: number | undefined): ValidationError[] {
  const errs: ValidationError[] = [];
  const label = partId === undefined ? 'part' : `part ${partId}`;
  if (cells.length === 0) {
    errs.push({ code: 'emptyPart', message: `${label} has no cells`, ...(partId !== undefined && { partId }) });
    return errs;
  }
  const seen = new Set<string>();
  for (const c of cells) {
    const k = cellKey(c);
    if (seen.has(k)) {
      errs.push({
        code: 'duplicateCell',
        message: `${label} has two cells at ${fmtPos(c)}`,
        pos: cellPos(c),
        ...(partId !== undefined && { partId }),
      });
    }
    seen.add(k);
  }
  if (errs.length) return errs;
  const comps = components(cells);
  if (comps.length > 1) {
    const sizes = comps.map((cc) => cc.length).join(' + ');
    errs.push({
      code: 'disconnected',
      message: `${label} is not connected: it falls into ${comps.length} pieces (${sizes} cells)`,
      ...(partId !== undefined && { partId }),
    });
  }
  return errs;
}

/**
 * Can `cell` be placed at its position given the other parts' cells there?
 * `ignorePartId`'s cells are disregarded (the part being edited/moved).
 */
function occupancyCheck(world: WorldIndex, cell: Cell, ignorePartId: number | null): CanResult {
  const others = world.atXYZ(cell).filter((e) => e.partId !== ignorePartId);
  if (others.length === 0) return { ok: true };
  const distinct = new Set(others.map((e) => e.partId));
  if (distinct.size >= 2 || others.length >= 2) {
    return { ok: false, reason: `${fmtPos(cell)} is already shared by two parts` };
  }
  const other = others[0]!;
  const r = shareResult(cell, other.cell);
  if (r.ok) return { ok: true };
  return { ok: false, reason: `${fmtPos(cell)}: ${r.reason} (part ${other.partId} has a ${kindLabel(other.cell.kind)} there)` };
}

// ---- wheel and gear blocking (§2.6 rule 2, §2.7 rules 1–5) --------------------------------
//
// Two pairwise predicates decide everything; validateModel and every canX/op use them, so they
// agree exactly. "Blocking disc" = the tip disc (r + GEAR_TIP) for a gear, the disc for a wheel.

/** The disc carried by a cell with a well-formed rim/gear (discRadiusOf), else null. */
function discSpecOf(c: Cell): DiscSpec | null {
  const r = discRadiusOf(c);
  return r === null ? null : { cell: c, hub: cellPos(c), r, gear: c.teeth === true };
}

/** Is the cell the hub of a (well-formed) gear? */
function isGearHub(c: Cell): boolean {
  return isGear(c) && isHole(c.kind);
}

/** Does the blocking disc of d overlap the cell at `pos`? */
function blocksCell(d: DiscSpec, pos: Vec3i): boolean {
  return d.gear ? tipOverlapsCell(d.hub, d.cell.axis, d.r, pos) : discOverlapsCell(d.hub, d.cell.axis, d.r, pos);
}

/** Cells (positions) the blocking disc of d overlaps, row-major over the plane axes. */
function blockedCells(d: DiscSpec): Vec3i[] {
  return d.gear ? fineDiscCells(d.hub, d.cell.axis, tipRadius(d.r)) : discCells(d.hub, d.cell.axis, d.r);
}

/** Largest reach (cells, per axis) from a hub to a cell its blocking disc overlaps: 4 (a radius-4 wheel; a 40-tooth gear's tips reach 3). */
const BLOCK_REACH = discReach(RIM_MAX);

type CellIssue = null | 'inside' | 'cuts';

/**
 * Disc d against a cell (§2.6 rule 2, §2.7 rules 1 and 5). `samePart`: the cell belongs to d's
 * part. `hubHoleAt(q)`: does d's part have a hole cell at q (the mate exception)? `ownWeb`: the
 * cell lies in the web of a gear of its own part (isWebCell; only read when !samePart).
 * - other part: 'inside' if the blocking disc overlaps the cell, unless it is a male in a hole of d's part;
 *   a cell in the web of its own part's gear counts not at all, and for a gear's tip disc a male
 *   (pin, axle) counts by its rod (tipOverlapsRod), not its cube (review m8; DEVIATIONS "Gears"):
 *   like the hub, the web is its gear's body, which other discs meet only through rules 2–4 (the
 *   web cubes lie strictly inside the tip disc, so any disc reaching one is judged there);
 * - same part: 'cuts' if d is a gear, the cell is in its layer, not the hub, not in the web
 *   (isWebCell), and the tip disc overlaps it. A wheel and its own part's cells fuse (null).
 * The hub cell of a gear is that gear: other discs meet it only through discPairIssue (§2.7
 * rules 2–4), never as a cube — otherwise an 8-tooth gear (whose hub cube pokes out of its
 * pitch circle) could never mesh (see docs/DEVIATIONS.md "Gears").
 */
function discCellIssue(d: DiscSpec, samePart: boolean, cell: Cell, hubHoleAt: (q: Vec3i) => boolean, ownWeb = false): CellIssue {
  if (isGearHub(cell)) return null;
  const pos = cellPos(cell);
  if (samePart) {
    if (!d.gear) return null;
    const a = d.cell.axis;
    if (pos[a] !== d.hub[a]) return null;
    if (pos[0] === d.hub[0] && pos[1] === d.hub[1] && pos[2] === d.hub[2]) return null;
    if (isWebCell(d.cell, cell)) return null;
    return tipOverlapsCell(d.hub, a, d.r, pos) ? 'cuts' : null;
  }
  if (!blocksCell(d, pos)) return null;
  if (isMale(cell.kind) && hubHoleAt(pos)) return null;
  if (ownWeb) return null;
  if (d.gear && isMale(cell.kind) && !tipOverlapsRod(d.hub, d.cell.axis, d.r, pos, cell.axis)) return null;
  return 'inside';
}

/** Is `cell` in the web of one of `gears` (gear hubs of the cell's own part)? */
function inWebOf(gears: readonly Cell[], cell: Cell): boolean {
  return gears.some((g) => g !== cell && isWebCell(g, cell));
}

/** Why two discs may not coexist, or null. 'own…' are pairs of one part. */
type PairIssue = null | 'wheels' | 'gearWheel' | 'overlap' | 'clash' | 'diagonal' | 'crossed' | 'ownMesh' | 'ownClash' | 'ownWheel';

/**
 * Two discs (§2.6 rule 2, §2.7 rules 2–4): wheel × wheel overlap only matters between parts (one
 * part's wheels fuse); a gear's tip disc must not overlap any wheel disc (any part); two gears
 * must be 'clear' (gearContact), or 'mesh' when they belong to different parts.
 */
function discPairIssue(a: DiscSpec, b: DiscSpec, samePart: boolean): PairIssue {
  if (!a.gear && !b.gear) {
    if (samePart) return null;
    return discsOverlap(a.hub, a.cell.axis, a.r, b.hub, b.cell.axis, b.r) ? 'wheels' : null;
  }
  if (a.gear !== b.gear) {
    const g = a.gear ? a : b;
    const w = a.gear ? b : a;
    if (!tipOverlapsWheel(g.hub, g.cell.axis, g.r, w.hub, w.cell.axis, w.r)) return null;
    return samePart ? 'ownWheel' : 'gearWheel';
  }
  const c = gearContact(a.hub, a.cell.axis, a.r, b.hub, b.cell.axis, b.r);
  if (c === 'clear') return null;
  if (samePart) return c === 'mesh' || c === 'diagonal' ? 'ownMesh' : 'ownClash';
  return c === 'mesh' ? null : c;
}

function discLabel(d: DiscSpec): string {
  return d.gear ? `${gearTeeth(d.r)} teeth` : fmtRim(d.r);
}

/**
 * Reason for a pair issue between the disc `d` being placed (on part `self`'s hub) and an existing
 * disc `e` of part `other`.
 */
function pairReason(issue: Exclude<PairIssue, null>, d: DiscSpec, e: DiscSpec, other: number): string {
  const at = `hub ${fmtPos(e.hub)}`;
  switch (issue) {
    case 'wheels':
      return `wheels would overlap: the wheel of part ${other} (${at})`;
    case 'gearWheel':
      return d.gear ? `gear teeth would hit part ${other}: its wheel (${at}, ${fmtRim(e.r)})` : `the wheel would hit the gear teeth of part ${other} (${at})`;
    case 'overlap':
      return `gears would overlap: the gear of part ${other} (${at})`;
    case 'clash':
      return `the teeth would clash with the gear of part ${other} (${at})`;
    case 'crossed':
      return `the teeth would clash with the gear of part ${other} (${at}; crossed axes — there are no bevel gears)`;
    case 'diagonal':
      return `these gears can only mesh in a straight line along the grid (the gear of part ${other}, ${at})`;
    case 'ownMesh':
      return `two gears of one part cannot mesh (the gear at ${at})`;
    case 'ownClash':
    case 'ownWheel': {
      const g = issue === 'ownClash' || e.gear ? e : d; // the gear whose teeth are cut: the existing one, or the only gear
      const x = g === d ? e : d;
      return `the ${x.gear ? 'gear' : 'wheel'} at hub ${fmtPos(x.hub)} would cut into the teeth of this part's gear (hub ${fmtPos(g.hub)})`;
    }
  }
}

/**
 * Is `cell` (of part `cellPart`, null = a new part) blocked by a disc in `world` (§2.6 rule 2,
 * §2.7 rules 1, 5)? Discs of part `stale` (whose world entries are out of date) are skipped.
 */
function cellAgainstDiscs(world: WorldIndex, cell: Cell, cellPart: number | null, stale: number | null, ownWeb = false): CanResult {
  if (world.rims.length === 0) return { ok: true };
  const pos = cellPos(cell);
  for (const e of world.rimsNear(pos, BLOCK_REACH)) {
    if (e.partId === stale) continue;
    const issue = discCellIssue(e, e.partId === cellPart, cell, (q) => world.holeOfPartAt(e.partId, q), ownWeb);
    if (issue === 'inside') return { ok: false, reason: `${fmtPos(cell)} is inside the ${e.gear ? 'gear' : 'wheel'} of part ${e.partId}` };
    if (issue === 'cuts') return { ok: false, reason: `${fmtPos(cell)} would cut into the teeth of this part's gear (hub ${fmtPos(e.hub)})` };
  }
  return { ok: true };
}

/**
 * Would the disc `d` on a hub of part `self` (null = a new part) be blocked by anything in
 * `world`: a cell (another part's, except a male in a hole of d's part — `ownHoleAt` says where
 * those are; or, for a gear, its own part's cell outside the web) or a disc (discPairIssue)?
 * World entries of part `stale` are skipped (out of date), and so is the entry `replacing`
 * (the hub's own current cell, when its rim is being changed).
 */
function discAgainstWorld(
  world: WorldIndex,
  d: DiscSpec,
  self: number | null,
  stale: number | null,
  replacing: { partId: number; index: number } | null,
  ownHoleAt: (q: Vec3i) => boolean,
  splitOff: ReadonlySet<Cell> | null = null,
): CanResult {
  const isReplaced = (e: WorldEntry) => replacing !== null && e.partId === replacing.partId && e.index === replacing.index;
  for (const q of blockedCells(d)) {
    for (const e of world.at(q)) {
      if (e.partId === stale || isReplaced(e)) continue;
      // A cell of d's part that the change splits off (splitOff) is another part's cell for d.
      const split = splitOff?.has(e.cell) === true;
      const same = e.partId === self && !split;
      const ownWeb = split ? inWebOf([...splitOff!].filter(isGearHub), e.cell) : !same && world.inOwnGearWeb(e);
      const issue = discCellIssue(d, same, e.cell, ownHoleAt, ownWeb);
      if (issue === 'inside') return { ok: false, reason: `${d.gear ? 'gear teeth' : 'wheel'} would hit part ${e.partId} at ${fmtPos(q)}` };
      if (issue === 'cuts') return { ok: false, reason: `${fmtPos(q)} would cut into the teeth of this part's gear (hub ${fmtPos(d.hub)})` };
    }
  }
  for (const e of world.rimsNear(d.hub)) {
    if (e.partId === stale || isReplaced(e)) continue;
    const issue = discPairIssue(d, e, e.partId === self);
    if (issue) return { ok: false, reason: pairReason(issue, d, e, e.partId) };
  }
  return { ok: true };
}

/**
 * The gear rules inside one part's (proposed) cell list (§2.7 rules 2–5 for pairs of one part):
 * a gear's own cells outside its web, and its own wheels and gears. Cells must have distinct
 * positions. ok when the part has no gear.
 */
function ownGearCheck(cells: readonly Cell[]): CanResult {
  const discs: DiscSpec[] = [];
  for (const c of cells) {
    const d = discSpecOf(c);
    if (d) discs.push(d);
  }
  if (!discs.some((d) => d.gear)) return { ok: true };
  const at = new Map<string, Cell>();
  for (const c of cells) at.set(cellKey(c), c);
  for (const d of discs) {
    if (!d.gear) continue;
    for (const q of blockedCells(d)) {
      const c = at.get(posKey(q[0], q[1], q[2]));
      if (c && discCellIssue(d, true, c, () => false) === 'cuts') {
        return { ok: false, reason: `${fmtPos(q)} would cut into the teeth of this part's gear (hub ${fmtPos(d.hub)})` };
      }
    }
  }
  for (let i = 0; i < discs.length; i++)
    for (let j = i + 1; j < discs.length; j++) {
      const issue = discPairIssue(discs[i]!, discs[j]!, true);
      if (issue) return { ok: false, reason: pairReason(issue, discs[j]!, discs[i]!, -1) };
    }
  return { ok: true };
}

/**
 * Check a whole (proposed) part against every other part: §2.3 occupancy, other parts' discs over
 * its cells, and its discs against other parts' cells and discs. `self` = the part's id, whose own
 * (stale) entries in `world` are ignored; null for a new part. The rules between the part's own
 * cells and discs are not checked here (ownGearCheck; they are invariant under move/rotate).
 */
function partAgainstWorld(world: WorldIndex, cells: readonly Cell[], self: number | null): CanResult {
  for (const c of cells) {
    const r = occupancyCheck(world, c, self);
    if (!r.ok) return r;
  }
  if (world.rims.length > 0) {
    const gears = cells.filter(isGearHub);
    for (const c of cells) {
      const r = cellAgainstDiscs(world, c, self, self, inWebOf(gears, c));
      if (!r.ok) return r;
    }
  }
  if (cells.some(hasRim)) {
    const holes = new Set<string>();
    for (const c of cells) if (isHole(c.kind)) holes.add(cellKey(c));
    const ownHoleAt = (q: Vec3i) => holes.has(posKey(q[0], q[1], q[2]));
    for (const c of cells) {
      const d = discSpecOf(c);
      if (!d) continue;
      const r = discAgainstWorld(world, d, self, self, null, ownHoleAt);
      if (!r.ok) return r;
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Validation

/**
 * Validate a model against §2.2, §2.3, §2.6 and §2.7 (plus basic structure). [] when valid.
 * Accepts arbitrary input (e.g. freshly parsed JSON) without throwing.
 */
export function validateModel(m: Model): ValidationError[] {
  const errs: ValidationError[] = [];
  const s = (message: string) => errs.push({ code: 'structure', message });
  const o = m as unknown as Record<string, unknown>;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) {
    s('model must be a JSON object');
    return errs;
  }
  if (o.version !== 1 && o.version !== 2 && o.version !== 3) s(`version: expected 1, 2 or 3 (got ${JSON.stringify(o.version)})`);
  if (!Array.isArray(o.parts)) {
    s('parts: expected an array');
    return errs;
  }
  if (o.rootPartId !== null && !(typeof o.rootPartId === 'number' && Number.isSafeInteger(o.rootPartId))) {
    s(`rootPartId: expected an integer or null (got ${JSON.stringify(o.rootPartId)})`);
  }
  if (!(typeof o.nextPartId === 'number' && Number.isSafeInteger(o.nextPartId) && o.nextPartId >= 1)) {
    s(`nextPartId: expected a positive integer (got ${JSON.stringify(o.nextPartId)})`);
  }
  for (const f of ['ground', 'fixRoot'] as const) {
    if (o[f] !== undefined && typeof o[f] !== 'boolean') s(`${f}: expected true or false (got ${JSON.stringify(o[f])})`);
  }
  let usesRim = false;
  let usesTeeth = false;
  (o.parts as unknown[]).forEach((p, i) => {
    const path = `parts[${i}]`;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      s(`${path}: expected an object {id,color,cells}`);
      return;
    }
    const po = p as Record<string, unknown>;
    if (!(typeof po.id === 'number' && Number.isSafeInteger(po.id) && po.id >= 0)) {
      s(`${path}.id: expected a non-negative integer (got ${JSON.stringify(po.id)})`);
    }
    if (typeof po.color !== 'string' || !HEX_COLOR.test(po.color)) {
      s(`${path}.color: expected '#rrggbb' (got ${JSON.stringify(po.color)})`);
    }
    if (!Array.isArray(po.cells)) {
      s(`${path}.cells: expected an array`);
      return;
    }
    (po.cells as unknown[]).forEach((c, j) => {
      const e = cellStructureError(c);
      if (e) {
        s(`${path}.cells[${j}]: ${e}`);
        return;
      }
      const cell = c as Cell;
      if (cell.rim === undefined && cell.teeth === undefined) return;
      if (cell.rim !== undefined) usesRim = true;
      if (cell.teeth !== undefined) usesTeeth = true;
      const re = rimError(cell);
      if (re) {
        errs.push({
          code: 'rim',
          message: `${path}.cells[${j}] at ${fmtPos(cell)}: ${re}`,
          pos: cellPos(cell),
          ...(typeof po.id === 'number' && { partId: po.id }),
        });
      }
    });
  });
  if (usesTeeth && o.version !== 3) {
    s(`version: a model with gears (teeth) must be version 3 (got ${JSON.stringify(o.version)})`);
  } else if (o.version === 1 && (usesRim || o.ground !== undefined || o.fixRoot !== undefined)) {
    s('version: a model with wheels (rim), ground or fixRoot must be version 2');
  }
  if (errs.length) return errs; // later checks assume well-formed data

  // Part ids
  const ids = new Set<number>();
  let maxId = -Infinity;
  for (const p of m.parts) {
    if (ids.has(p.id)) errs.push({ code: 'duplicatePartId', message: `part id ${p.id} is used more than once`, partId: p.id });
    ids.add(p.id);
    maxId = Math.max(maxId, p.id);
  }
  if (m.parts.length && m.nextPartId <= maxId) {
    errs.push({ code: 'nextPartId', message: `nextPartId ${m.nextPartId} must be greater than every part id (max ${maxId})` });
  }

  // Per part (§2.2, §2.6 rule 1)
  for (const p of m.parts) errs.push(...partCellErrors(p.cells, p.id));

  // Sharing between parts (§2.3). A fresh index, not the identity cache: validateModel is the
  // function most likely to see hand-built or mutated objects.
  const world = new WorldIndex(m);
  for (const entries of world.map.values()) {
    const parts = new Map<number, WorldEntry>();
    for (const e of entries) if (!parts.has(e.partId)) parts.set(e.partId, e);
    if (parts.size < 2) continue;
    const [a, b] = [...parts.values()] as [WorldEntry, WorldEntry];
    const pos = cellPos(a.cell);
    if (parts.size > 2) {
      errs.push({
        code: 'overlap',
        message: `${fmtPos(a.cell)} is occupied by ${parts.size} parts (${[...parts.keys()].join(', ')}); at most two may share a cell`,
        pos,
      });
      continue;
    }
    const r = shareResult(a.cell, b.cell);
    if (!r.ok) {
      errs.push({
        code: 'overlap',
        message: `${fmtPos(a.cell)}: parts ${a.partId} and ${b.partId} overlap invalidly: ${r.reason}`,
        pos,
      });
    }
  }

  // Wheels and gears (§2.6 rule 2, §2.7 rules 1–5): each disc against the cells and discs of
  // other parts, and a gear against its own part's cells and discs.
  const rimIndex = new Map<RimEntry, number>(world.rims.map((e, i) => [e, i]));
  world.rims.forEach((w, wi) => {
    if (!w.gear) {
      for (const q of discCells(w.hub, w.cell.axis, w.r)) {
        for (const e of world.at(q)) {
          if (e.partId === w.partId) continue;
          if (isMale(e.cell.kind) && world.holeOfPartAt(w.partId, q)) continue; // the mate exception
          if (isGearHub(e.cell) || world.inOwnGearWeb(e)) continue; // a gear (hub and web) meets a wheel disc as a gear (§2.7 rule 2)
          errs.push({
            code: 'overlap',
            message: `${fmtPos(q)}: the ${kindLabel(e.cell.kind)} of part ${e.partId} is inside the wheel of part ${w.partId} (hub ${fmtPos(w.hub)}, ${fmtRim(w.r)})`,
            pos: q,
            partId: e.partId,
          });
        }
      }
    } else {
      const hubHoleAt = (q: Vec3i) => world.holeOfPartAt(w.partId, q);
      for (const q of blockedCells(w)) {
        for (const e of world.at(q)) {
          const issue = discCellIssue(w, e.partId === w.partId, e.cell, hubHoleAt, e.partId !== w.partId && world.inOwnGearWeb(e));
          if (issue === 'inside') {
            errs.push({
              code: 'overlap',
              message: `${fmtPos(q)}: the ${kindLabel(e.cell.kind)} of part ${e.partId} is inside the gear of part ${w.partId} (hub ${fmtPos(w.hub)}, ${discLabel(w)})`,
              pos: q,
              partId: e.partId,
            });
          } else if (issue === 'cuts') {
            errs.push({
              code: 'gear',
              message: `${fmtPos(q)}: the ${kindLabel(e.cell.kind)} of part ${e.partId} would cut into the teeth of this part's gear (hub ${fmtPos(w.hub)}, ${discLabel(w)}); only cells of the web (centre within r − ½, axis ∥ the hub) may share its layer`,
              pos: q,
              partId: e.partId,
            });
          }
        }
      }
    }
    for (const v of world.rimsNear(w.hub)) {
      if (rimIndex.get(v)! <= wi) continue; // each pair once
      const same = v.partId === w.partId;
      if (!w.gear && !v.gear) {
        if (same) continue;
        if (discsOverlap(w.hub, w.cell.axis, w.r, v.hub, v.cell.axis, v.r)) {
          errs.push({
            code: 'overlap',
            message: `wheels would overlap: part ${w.partId} (hub ${fmtPos(w.hub)}, ${fmtRim(w.r)}) and part ${v.partId} (hub ${fmtPos(v.hub)}, ${fmtRim(v.r)})`,
            pos: w.hub,
            partId: w.partId,
          });
        }
        continue;
      }
      const issue = discPairIssue(w, v, same);
      if (!issue) continue;
      const what = (x: RimEntry) => `${x.gear ? 'gear' : 'wheel'} of part ${x.partId} (hub ${fmtPos(x.hub)}, ${discLabel(x)})`;
      const text: Record<Exclude<PairIssue, null | 'wheels'>, string> = {
        gearWheel: 'gear teeth would hit a wheel',
        overlap: 'gears would overlap',
        clash: 'the teeth would clash',
        crossed: 'the teeth would clash (crossed axes — there are no bevel gears)',
        diagonal: 'these gears can only mesh in a straight line along the grid',
        ownMesh: 'two gears of one part cannot mesh',
        ownClash: "would cut into the teeth of this part's gear",
        ownWheel: "would cut into the teeth of this part's gear",
      };
      errs.push({
        code: same ? 'gear' : 'overlap',
        message: `${text[issue as Exclude<PairIssue, null | 'wheels'>]}: the ${what(w)} and the ${what(v)}`,
        pos: w.hub,
        partId: w.partId,
      });
    }
  });
  return errs;
}

// ---------------------------------------------------------------------------------------------
// Editing

/** Why two adjacent cells of one part do not connect (§2.2), as a short clause for messages. */
function whyNoConnection(a: Cell, b: Cell): string {
  const along = a.x !== b.x ? 0 : a.y !== b.y ? 1 : 2;
  if ((isMale(a.kind) && a.axis !== along) || (isMale(b.kind) && b.axis !== along)) return 'a rod’s side holds nothing';
  return 'a rod’s end on the mouth of a coaxial hole does not hold';
}

/** Would `cell` (not yet in the part) be connected to some cell of `part` through a wheel (§2.6 rule 1)? */
function wheelConnects(part: Part, cell: Cell): boolean {
  const pos = cellPos(cell);
  const own = hasRim(cell);
  for (const c of part.cells) {
    if (hasRim(c)) {
      if (discOverlapsCell(cellPos(c), c.axis, c.rim, pos)) return true;
      if (own && discsOverlap(cellPos(c), c.axis, c.rim, pos, cell.axis, cell.rim!)) return true;
    }
    if (own && discOverlapsCell(pos, cell.axis, cell.rim!, cellPos(c))) return true;
  }
  return false;
}

/**
 * Could `cell` be added to part `partId` (or, with partId null, start a new part)?
 * Checks: well-formed cell (and rim/teeth, if it carries them); position free within the part; >= 1
 * in-part connection (a face connection, or through a wheel disc, §2.6 rule 1); world occupancy
 * compatible per §2.3; not inside another part's wheel or gear (§2.6 rule 2, §2.7 rule 1, mate
 * exception) and not cutting into its own part's gear (§2.7 rule 5); and, if the cell carries a
 * rim or gear, its disc hits nothing it must not (§2.6 rule 2, §2.7 rules 1–5).
 */
export function canAddCell(m: Model, partId: number | null, cell: Cell): CanResult {
  const se = cellStructureError(cell);
  if (se) return { ok: false, reason: `invalid cell: ${se}` };
  const re = rimError(cell);
  if (re) return { ok: false, reason: re };
  let part: Part | undefined;
  if (partId !== null) {
    part = partById(m, partId);
    if (!part) return { ok: false, reason: `no part with id ${partId}` };
    if (part.cells.some((c) => c.x === cell.x && c.y === cell.y && c.z === cell.z)) {
      return { ok: false, reason: `part ${partId} already has a cell at ${fmtPos(cell)}` };
    }
    let neighbour: Cell | null = null;
    let connected = false;
    for (const c of part.cells) {
      if (Math.abs(c.x - cell.x) + Math.abs(c.y - cell.y) + Math.abs(c.z - cell.z) !== 1) continue;
      neighbour ??= c;
      if (connects(c, cell)) {
        connected = true;
        break;
      }
    }
    if (!connected && wheelConnects(part, cell)) connected = true;
    if (!connected && !neighbour) return { ok: false, reason: `${fmtPos(cell)} is not adjacent to part ${partId}` };
    if (!connected) {
      return {
        ok: false,
        reason: `${/^[aeiou]/.test(kindLabel(cell.kind)) ? 'an' : 'a'} ${kindLabel(cell.kind)} along ${'XYZ'[cell.axis]} at ${fmtPos(cell)} would not attach to part ${partId} (${whyNoConnection(neighbour!, cell)})`,
      };
    }
  }
  const world = worldIndex(m);
  const occ = occupancyCheck(world, cell, partId);
  if (!occ.ok) return occ;
  // Other parts' discs over the cell, and this part's gears against it (§2.7 rule 5).
  const inside = cellAgainstDiscs(world, cell, partId, null, part ? inWebOf(part.cells.filter(isGearHub), cell) : false);
  if (!inside.ok) return inside;
  const d = discSpecOf(cell);
  if (d) {
    const holes = new Set<string>();
    if (part) for (const c of part.cells) if (isHole(c.kind)) holes.add(cellKey(c));
    holes.add(cellKey(cell)); // the hub itself (rimError guarantees a hole)
    return discAgainstWorld(world, d, partId, null, null, (q) => holes.has(posKey(q[0], q[1], q[2])));
  }
  return { ok: true };
}

/**
 * First of `count` fresh part ids. nextPartId is normally >= 1 and > every id (validateModel);
 * this also guards models that were never validated, so allocation never yields a negative,
 * duplicate or unsafe id. Throws if the id space is exhausted.
 */
function allocIds(m: Model, count: number): number {
  let first = Number.isSafeInteger(m.nextPartId) ? Math.max(m.nextPartId, 1) : 1;
  for (const p of m.parts) if (p.id >= first) first = p.id + 1;
  if (!Number.isSafeInteger(first + count)) throw new Error('no part ids left (nextPartId too large)');
  return first;
}

function replacePart(m: Model, partId: number, parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of m.parts) {
    if (p.id === partId) out.push(...parts);
    else out.push(p);
  }
  return out;
}

/** `m` with its version raised to `need` (2: a rim/ground/fixRoot is introduced, 3: a gear), never lowered. */
function bumpVersion(m: Model, need: 0 | 2 | 3): Model {
  return need > m.version ? { ...m, version: need as 2 | 3 } : m;
}

/** The version a cell list needs: 3 with a gear (teeth), 2 with a rim, else 0 (nothing). */
function versionNeeded(cells: readonly Cell[]): 0 | 2 | 3 {
  let v: 0 | 2 | 3 = 0;
  for (const c of cells) {
    if (c.teeth !== undefined) return 3;
    if (c.rim !== undefined) v = 2;
  }
  return v;
}

/** Add a cell (with its rim, if any) to an existing part. Throws if !canAddCell(m, partId, cell). */
export function addCell(m: Model, partId: number, cell: Cell): Model {
  const r = canAddCell(m, partId, cell);
  if (!r.ok) throw new Error(r.reason);
  const part = requirePart(m, partId);
  const np: Part = { ...part, cells: [...part.cells, copyCell(cell)] };
  return bumpVersion({ ...m, parts: replacePart(m, partId, [np]) }, versionNeeded([cell]));
}

/**
 * Create a new part from `cells` (copied, rims included — so duplicating a wheel keeps it). Colour
 * defaults to DEFAULT_COLORS of the first cell's kind. Throws with a reason if the part would be
 * invalid or conflict with existing parts (§2.3, §2.6).
 */
export function addPart(m: Model, cells: readonly Cell[], color?: string): { model: Model; partId: number } {
  for (let i = 0; i < cells.length; i++) {
    const e = cellStructureError(cells[i]);
    if (e) throw new Error(`invalid cell ${i}: ${e}`);
    const re = rimError(cells[i]!);
    if (re) throw new Error(`invalid cell ${i} at ${fmtPos(cells[i]!)}: ${re}`);
  }
  const copy = cells.map(copyCell);
  const errs = partCellErrors(copy, undefined);
  if (errs.length) throw new Error(errs[0]!.message);
  const own = ownGearCheck(copy);
  if (!own.ok) throw new Error(own.reason);
  const r = partAgainstWorld(worldIndex(m), copy, null);
  if (!r.ok) throw new Error(r.reason);
  const col = color ?? defaultColorFor(copy[0]!.kind);
  if (!HEX_COLOR.test(col)) throw new Error(`invalid colour ${JSON.stringify(col)} (expected '#rrggbb')`);
  const partId = allocIds(m, 1);
  const part: Part = { id: partId, color: col.toLowerCase(), cells: copy };
  const model = bumpVersion({ ...m, parts: [...m.parts, part], nextPartId: partId + 1 }, versionNeeded(copy));
  return { model, partId };
}

/**
 * Replace part `part` by the pieces of `rest` (its new cell list): one part if `rest` is
 * connected, else split — the largest piece keeps the id (ties: the piece containing the earliest
 * remaining cell), the others get fresh ids in order of size (desc) then earliest cell, inserted
 * right after it, with the same colour. The root designation follows the piece that keeps the id.
 * An empty `rest` removes the part.
 */
function replaceWithPieces(m: Model, part: Part, rest: Cell[]): Model {
  if (rest.length === 0) return removePart(m, part.id);
  const comps = components(rest);
  if (comps.length === 1) return { ...m, parts: replacePart(m, part.id, [{ ...part, cells: rest }]) };
  // Stable sort keeps "earliest cell first" order among equal sizes.
  const ordered = [...comps].sort((a, b) => b.length - a.length);
  let next = allocIds(m, ordered.length - 1);
  const pieces: Part[] = ordered.map((comp, k) => ({
    id: k === 0 ? part.id : next++,
    color: part.color,
    cells: comp.map((i) => rest[i]!),
  }));
  return { ...m, parts: replacePart(m, part.id, pieces), nextPartId: next };
}

/**
 * Can the cell of part `partId` at `pos` be removed? Always, except (§2.6, §2.7) when it is a hole
 * cell holding a male of another part and a remaining wheel (disc) or gear (tip disc) of the same
 * part overlaps that position:
 * removing the hole would leave the pin/axle inside the wheel's material. Removing a hub removes
 * its rim with it, which is always allowed.
 */
export function canRemoveCell(m: Model, partId: number, pos: Vec3i): CanResult {
  const part = partById(m, partId);
  if (!part) return { ok: false, reason: `no part with id ${partId}` };
  const cell = cellAt(part, pos);
  if (!cell) return { ok: false, reason: `part ${partId} has no cell at ${fmtPos(pos)}` };
  if (!isHole(cell.kind)) return { ok: true };
  if (isGearHub(cell)) {
    // Its web cells stop being the gear's body (exposedWebCheck); its guest, if any, goes with it
    // into the open like any cell of another part (tipOverlapsRod is already what judged it).
    const exposed = exposedWebCheck(m, part, cell, null);
    if (!exposed.ok) return exposed;
  }
  const guest = worldIndex(m).at(pos).find((e) => e.partId !== partId && isMale(e.cell.kind));
  if (!guest) return { ok: true };
  for (const c of part.cells) {
    if (c === cell || !hasRim(c)) continue;
    const gear = isGear(c);
    if (gear ? tipOverlapsRod(cellPos(c), c.axis, c.rim, pos, guest.cell.axis) : discOverlapsCell(cellPos(c), c.axis, c.rim, pos)) {
      return {
        ok: false,
        reason: `the ${kindLabel(guest.cell.kind)} of part ${guest.partId} at ${fmtPos(pos)} would be inside the ${gear ? 'gear' : 'wheel'} of part ${partId}`,
      };
    }
  }
  return { ok: true };
}

/**
 * Remove the cell of part `partId` at `pos` (and its rim, if it is a hub). If the rest falls
 * apart (§2.2 with §2.6 rule 1) it is split into several parts: the largest piece keeps the id
 * (ties: the piece containing the earliest remaining cell), the others get fresh ids in order of
 * size (desc) then earliest cell, inserted right after it, with the same colour. The root
 * designation follows the piece that keeps the id. Removing a part's last cell removes the part.
 * Throws if there is no such part/cell, or if !canRemoveCell (check it first).
 */
export function removeCell(m: Model, partId: number, pos: Vec3i): Model {
  const part = requirePart(m, partId);
  const idx = part.cells.findIndex((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
  if (idx < 0) throw new Error(`part ${partId} has no cell at ${fmtPos(pos)}`);
  const ok = canRemoveCell(m, partId, pos);
  if (!ok.ok) throw new Error(ok.reason);
  return replaceWithPieces(m, part, part.cells.filter((_, i) => i !== idx));
}

/** Remove a whole part. If it was the designated root, rootPartId becomes null. Throws if missing. */
export function removePart(m: Model, partId: number): Model {
  requirePart(m, partId);
  return {
    ...m,
    parts: m.parts.filter((p) => p.id !== partId),
    rootPartId: m.rootPartId === partId ? null : m.rootPartId,
  };
}

/** Replace a part's cells if the result is valid w.r.t. the other parts; else null. */
function withPartCells(m: Model, part: Part, cells: Cell[]): Model | null {
  if (!partAgainstWorld(worldIndex(m), cells, part.id).ok) return null;
  return { ...m, parts: replacePart(m, part.id, [{ ...part, cells }]) };
}

function isIntVec(v: readonly number[]): boolean {
  return v.length === 3 && v.every((n) => Number.isSafeInteger(n));
}

/** Translate a part (rims and gears included) by an integer delta. null if the result would be invalid. Throws if missing. */
export function movePart(m: Model, partId: number, delta: Vec3i): Model | null {
  const part = requirePart(m, partId);
  if (!isIntVec(delta)) throw new Error(`movePart: delta must be three integers (got ${JSON.stringify(delta)})`);
  const [dx, dy, dz] = delta;
  if (dx === 0 && dy === 0 && dz === 0) return m;
  return withPartCells(
    m,
    part,
    part.cells.map((c) => makeCell(c.x + dx, c.y + dy, c.z + dz, c.kind, c.axis, c.rim, c.teeth)),
  );
}

/**
 * Rotate an integer vector by quarterTurns × 90° about a coordinate axis (right-hand rule:
 * positive turns are counter-clockwise looking from +axis towards the origin).
 */
export function rotateVec(v: Vec3i, axis: Axis, quarterTurns: number): Vec3i {
  let [x, y, z] = v;
  const k = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < k; i++) {
    if (axis === 0) [y, z] = [-z, y];
    else if (axis === 1) [z, x] = [-x, z];
    else [x, y] = [-y, x];
  }
  // normalise -0
  return [x + 0, y + 0, z + 0];
}

/** The cell axis after a rotation: odd quarter-turns swap the two axes ⟂ the rotation axis. */
export function rotateAxis(cellAxis: Axis, axis: Axis, quarterTurns: number): Axis {
  const k = ((quarterTurns % 4) + 4) % 4;
  if (cellAxis === axis || k % 2 === 0) return cellAxis;
  return AXES.find((a) => a !== axis && a !== cellAxis)!;
}

/**
 * Rotate a part by quarterTurns × 90° about the line through integer point `pivot` parallel to
 * `axis` (right-hand rule). Cell axes rotate too, and with them their wheel discs (§2.6 rule 3);
 * a cell at the pivot stays in place. null if the result would be invalid. Throws if the part is
 * missing or the pivot is not integral.
 */
export function rotatePart(m: Model, partId: number, axis: Axis, quarterTurns: number, pivot: Vec3i): Model | null {
  const part = requirePart(m, partId);
  if (!isAxis(axis)) throw new Error(`rotatePart: bad axis ${JSON.stringify(axis)}`);
  if (!Number.isSafeInteger(quarterTurns)) throw new Error(`rotatePart: quarterTurns must be an integer`);
  if (!isIntVec(pivot)) throw new Error(`rotatePart: pivot must be three integers (got ${JSON.stringify(pivot)})`);
  const k = ((quarterTurns % 4) + 4) % 4;
  if (k === 0) return m;
  const [px, py, pz] = pivot;
  const cells = part.cells.map((c) => {
    const [x, y, z] = rotateVec([c.x - px, c.y - py, c.z - pz], axis, k);
    return makeCell(x + px, y + py, z + pz, c.kind, rotateAxis(c.axis, axis, k), c.rim, c.teeth);
  });
  return withPartCells(m, part, cells);
}

/** Set a part's colour ('#rrggbb', stored lower-case). Throws on a bad colour or missing part. */
export function setPartColor(m: Model, partId: number, color: string): Model {
  const part = requirePart(m, partId);
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
    throw new Error(`invalid colour ${JSON.stringify(color)} (expected '#rrggbb')`);
  }
  const c = color.toLowerCase();
  if (c === part.color) return m;
  return { ...m, parts: replacePart(m, partId, [{ ...part, color: c }]) };
}

/** Designate the root (fixed) part; null clears it (lowest id is then the root). Throws if missing. */
export function setRoot(m: Model, partId: number | null): Model {
  if (partId !== null) requirePart(m, partId);
  if (m.rootPartId === partId) return m;
  return { ...m, rootPartId: partId };
}

// ---------------------------------------------------------------------------------------------
// Wheels, ground and a free root (§2.6)

/**
 * Could the cell of part `partId` at `pos` carry rim `rim` (undefined = no rim)? Reasons:
 * "wheels grow from pin holes and axle holes", "largest wheel is radius 4", "smallest wheel is
 * radius 1", "wheel radius goes in steps of ½", "wheel would hit part N at (x, y, z)",
 * "wheels would overlap: …", and the gear reasons of §2.7. Shrinking or removing a plain rim is
 * always allowed (it can only free space; it may split the part, see setRim). Removing a gear is
 * allowed unless its bare hub cell would then be inside another gear's tips (an 8 meshing with an
 * adjacent 8). On a gear cell any radius makes it a plain wheel (teeth cleared), which is checked like
 * a new wheel (a gear in mesh cannot become a plain wheel of the same radius). Setting the current
 * value of a plain wheel is ok (a no-op).
 */
export function canSetRim(m: Model, partId: number, pos: Vec3i, rim: number | undefined): CanResult {
  const part = partById(m, partId);
  if (!part) return { ok: false, reason: `no part with id ${partId}` };
  const cell = cellAt(part, pos);
  if (!cell) return { ok: false, reason: `part ${partId} has no cell at ${fmtPos(pos)}` };
  if (rim === undefined) return ungearCheck(m, part, cell);
  if (!isHole(cell.kind)) return { ok: false, reason: 'wheels grow from pin holes and axle holes' };
  if (typeof rim !== 'number' || Number.isNaN(rim)) return { ok: false, reason: `invalid wheel radius ${JSON.stringify(rim)}` };
  if (rim > RIM_MAX) return { ok: false, reason: `largest wheel is radius ${RIM_MAX}` };
  if (rim < RIM_MIN) return { ok: false, reason: `smallest wheel is radius ${RIM_MIN}` };
  if (!isValidRim(rim)) return { ok: false, reason: `wheel radius goes in steps of ${RIM_STEP}` };
  if (cell.rim !== undefined && cell.teeth === undefined && rim <= cell.rim) return { ok: true };
  return rimChangeCheck(m, part, cell, makeCell(cell.x, cell.y, cell.z, cell.kind, cell.axis, rim));
}

/**
 * Removing a rim or gear from `cell`: always fine for a plain wheel; for a gear, its hub becomes an
 * ordinary cell, which other gears' tips (and its own part's gears, rule 5) no longer treat as a
 * gear — e.g. an 8 meshing with an 8 next to it cannot lose its teeth.
 */
function ungearCheck(m: Model, part: Part, cell: Cell): CanResult {
  if (!isGearHub(cell)) return { ok: true };
  const r = cellAgainstDiscs(worldIndex(m), makeCell(cell.x, cell.y, cell.z, cell.kind, cell.axis), part.id, null);
  return r.ok ? exposedWebCheck(m, part, cell, null) : r;
}

/**
 * The gear on `hub` of `part` becomes `next` (a smaller gear, a plain wheel, or nothing: null): the
 * cells of its web that are not in the web of `next` stop being the gear's body (discCellIssue)
 * and meet the other parts' discs as cells again (review m8: a crank hole facing a meshing gear is
 * only allowed while its gear is there).
 */
function exposedWebCheck(m: Model, part: Part, hub: Cell, next: Cell | null): CanResult {
  if (!isGearHub(hub)) return { ok: true };
  const world = worldIndex(m);
  for (const c of part.cells) {
    if (c === hub || !isWebCell(hub, c)) continue;
    if (next && isGearHub(next) && isWebCell(next, c)) continue;
    const r = cellAgainstDiscs(world, c, part.id, null);
    if (!r.ok) return { ok: false, reason: `without this gear, ${r.reason}` };
  }
  return { ok: true };
}

/** Check the hub `cell` of `part` turned into `next` (a new plain rim or gear) against everything. */
function rimChangeCheck(m: Model, part: Part, cell: Cell, next: Cell): CanResult {
  const d = discSpecOf(next)!;
  const world = worldIndex(m);
  if (isGearHub(cell) && !isGearHub(next)) {
    // the hub stops being a gear: it is now a cell like any other for the other discs
    const asCell = cellAgainstDiscs(world, next, part.id, null);
    if (!asCell.ok) return asCell;
  }
  const index = part.cells.indexOf(cell);
  // A gear that shrinks may split cells off its part (setGear → replaceWithPieces); those meet the
  // new gear as another part's cells (for a male that is its rod, not its cube: review m8).
  let splitOff: Set<Cell> | null = null;
  if (cell.rim !== undefined && next.rim! < cell.rim) {
    const cells = part.cells.map((q) => (q === cell ? next : q));
    const comps = components(cells);
    if (comps.length > 1) {
      const mine = new Set(comps.find((c) => c.includes(index))!);
      splitOff = new Set(part.cells.filter((_, i) => !mine.has(i)));
    }
  }
  const r = discAgainstWorld(world, d, part.id, null, { partId: part.id, index }, (q) => world.holeOfPartAt(part.id, q), splitOff);
  return r.ok ? exposedWebCheck(m, part, cell, next) : r;
}

/**
 * Set (or, with undefined, remove) the rim of the hole cell of part `partId` at `pos`. Throws if
 * !canSetRim. Setting a rim makes the model version 2. Shrinking or removing a rim can disconnect
 * cells that were joined only through the disc (§2.6 rule 1): the part is then split exactly as
 * removeCell splits it (largest piece keeps the id; the root follows it). Returns `m` itself when
 * nothing changes.
 */
export function setRim(m: Model, partId: number, pos: Vec3i, rim: number | undefined): Model {
  const r = canSetRim(m, partId, pos, rim);
  if (!r.ok) throw new Error(r.reason);
  const part = requirePart(m, partId);
  const idx = part.cells.findIndex((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
  const old = part.cells[idx]!;
  if (old.rim === rim && old.teeth === undefined) return m;
  const cells = part.cells.slice();
  cells[idx] = makeCell(old.x, old.y, old.z, old.kind, old.axis, rim);
  const shrink = rim === undefined || (old.rim !== undefined && rim < old.rim);
  const out = shrink ? replaceWithPieces(m, part, cells) : { ...m, parts: replacePart(m, partId, [{ ...part, cells }]) };
  return bumpVersion(out, rim !== undefined ? 2 : 0);
}

/**
 * Could the hole cell of part `partId` at `pos` become a gear of pitch radius `r` (§2.7;
 * undefined = a bare cell, removing any rim or gear — allowed as in canSetRim(undefined))? Reasons: "gears grow from
 * pin holes and axle holes", "a gear's radius is ½, 1, 1½ or 2½ …", and the blocking reasons of
 * §2.7 ("gear teeth would hit part N at …", "the teeth would clash with the gear of part N …",
 * "these gears can only mesh in a straight line along the grid …", "… would cut into the teeth
 * of this part's gear …", "two gears of one part cannot mesh …"). Works on a bare cell, a plain
 * wheel (which becomes a gear) or a gear (resized). Setting the current gear is ok (a no-op).
 */
export function canSetGear(m: Model, partId: number, pos: Vec3i, r: number | undefined): CanResult {
  const part = partById(m, partId);
  if (!part) return { ok: false, reason: `no part with id ${partId}` };
  const cell = cellAt(part, pos);
  if (!cell) return { ok: false, reason: `part ${partId} has no cell at ${fmtPos(pos)}` };
  if (r === undefined) return ungearCheck(m, part, cell);
  if (!isHole(cell.kind)) return { ok: false, reason: 'gears grow from pin holes and axle holes' };
  if (!isGearRadius(r)) return { ok: false, reason: `a gear's radius is ${GEAR_RADII_TEXT} (got ${JSON.stringify(r)})` };
  if (isGear(cell) && cell.rim === r) return { ok: true };
  return rimChangeCheck(m, part, cell, makeCell(cell.x, cell.y, cell.z, cell.kind, cell.axis, r, true));
}

/**
 * Make the hole cell of part `partId` at `pos` a gear of pitch radius r (rim = r, teeth: true), or
 * with undefined a bare cell (rim and teeth removed). Throws if !canSetGear. Setting a gear makes
 * the model version 3. Shrinking or removing the disc can split the part exactly as removeCell
 * does (e.g. web cells joined only through the disc). Returns `m` itself when nothing changes.
 */
export function setGear(m: Model, partId: number, pos: Vec3i, r: number | undefined): Model {
  const ok = canSetGear(m, partId, pos, r);
  if (!ok.ok) throw new Error(ok.reason);
  const part = requirePart(m, partId);
  const idx = part.cells.findIndex((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
  const old = part.cells[idx]!;
  if (r === undefined ? old.rim === undefined && old.teeth === undefined : old.teeth === true && old.rim === r) return m;
  const cells = part.cells.slice();
  cells[idx] = makeCell(old.x, old.y, old.z, old.kind, old.axis, r, r !== undefined);
  const shrink = old.rim !== undefined && (r === undefined || r < old.rim);
  const out = shrink ? replaceWithPieces(m, part, cells) : { ...m, parts: replacePart(m, partId, [{ ...part, cells }]) };
  return bumpVersion(out, r !== undefined ? 3 : 0);
}

/**
 * Turn the ground (§2.6) on or off. Turning it on makes the model version 2; off removes the field
 * (absent = off). Returns `m` itself when nothing changes.
 */
export function setGround(m: Model, on: boolean): Model {
  if (typeof on !== 'boolean') throw new Error(`setGround: expected a boolean (got ${JSON.stringify(on)})`);
  if ((m.ground === true) === on) return m;
  if (on) return { ...bumpVersion(m, 2), ground: true };
  const { ground: _g, ...rest } = m;
  return rest;
}

/**
 * Fix the root part in space (true, the default) or leave every part free (false; a vehicle).
 * Only effective while the ground is on (rootIsFixed). Setting false makes the model version 2;
 * true removes the field (absent = true). Returns `m` itself when nothing changes.
 */
export function setFixRoot(m: Model, on: boolean): Model {
  if (typeof on !== 'boolean') throw new Error(`setFixRoot: expected a boolean (got ${JSON.stringify(on)})`);
  if ((m.fixRoot !== false) === on) return m;
  if (!on) return { ...bumpVersion(m, 2), fixRoot: false };
  const { fixRoot: _f, ...rest } = m;
  return rest;
}

/**
 * Is the root part fixed in space during simulation? `fixRoot !== false || !ground`: without a
 * floor a model with nothing fixed would just fall away, so the root stays fixed then (§2.6).
 */
export function rootIsFixed(m: Model): boolean {
  return m.fixRoot !== false || m.ground !== true;
}

/**
 * Lowest point of the model at edit time (§2.6), i.e. the nominal ground level: the minimum over
 * all cells of y − ½ and over all rims with a horizontal axis (X or Z) of y_hub − r, and for a gear
 * with a horizontal axis y_hub − r − ⅛ (GEAR_GROUND_EXTRA, §2.7). (A rim about
 * Y lies in its hub's layer, whose bottom is already y − ½.) null when the ground is off or the
 * model has no cells. Nominal level: the view draws the floor here; the physics half-space sits at
 * groundLevel + (½ − HC) so the lowest collider starts in exact contact (§5.1).
 */
export function groundLevel(m: Model): number | null {
  if (m.ground !== true) return null;
  let lo = Infinity;
  for (const p of m.parts)
    for (const c of p.cells) {
      lo = Math.min(lo, c.y - 0.5);
      if (c.rim !== undefined && c.axis !== 1) lo = Math.min(lo, c.y - c.rim - (c.teeth === true ? GEAR_GROUND_EXTRA : 0));
    }
  return lo === Infinity ? null : lo;
}

// ---------------------------------------------------------------------------------------------
// Serialisation (.knap.json)

/**
 * Deterministic JSON: one cell per line. A model that uses no rim, ground or fixRoot serialises
 * byte-for-byte as before (version 1 format); `ground` / `fixRoot` lines and a cell's `"rim"` and
 * `"teeth":true` are written only when present.
 */
export function serialize(m: Model): string {
  const cell = (c: Cell) =>
    `{"x":${c.x},"y":${c.y},"z":${c.z},"kind":${JSON.stringify(c.kind)},"axis":${c.axis}${c.rim !== undefined ? `,"rim":${c.rim}` : ''}${c.teeth === true ? ',"teeth":true' : ''}}`;
  const part = (p: Part) =>
    [
      '    {',
      `      "id": ${p.id},`,
      `      "color": ${JSON.stringify(p.color)},`,
      p.cells.length
        ? `      "cells": [\n${p.cells.map((c) => `        ${cell(c)}`).join(',\n')}\n      ]`
        : '      "cells": []',
      '    }',
    ].join('\n');
  return [
    '{',
    `  "version": ${m.version},`,
    `  "rootPartId": ${m.rootPartId === null ? 'null' : m.rootPartId},`,
    `  "nextPartId": ${m.nextPartId},`,
    ...(m.ground !== undefined ? [`  "ground": ${m.ground},`] : []),
    ...(m.fixRoot !== undefined ? [`  "fixRoot": ${m.fixRoot},`] : []),
    m.parts.length ? `  "parts": [\n${m.parts.map(part).join(',\n')}\n  ]` : '  "parts": []',
    '}',
    '',
  ].join('\n');
}

/** Error thrown by deserialize; `errors` lists every problem found. */
export class ModelFormatError extends Error {
  readonly errors: ValidationError[];
  constructor(message: string, errors: ValidationError[]) {
    super(message);
    this.name = 'ModelFormatError';
    this.errors = errors;
  }
}

const MAX_LISTED = 10;

/**
 * Parse and validate a .knap.json string (version 1, 2 or 3). Unknown fields are dropped; a missing
 * rootPartId is treated as null and a missing nextPartId as (max part id + 1). Known fields must
 * be valid: a malformed `rim`, `teeth`, `ground` or `fixRoot` value, a rim or teeth on a male
 * cell, teeth on a radius not in GEAR_RADII, a plain rim ½, a version-1 file using a rim, ground
 * or fixRoot, or a version-1/2 file using teeth is an error, never silently dropped. Throws ModelFormatError with a
 * readable message listing the problems.
 */
export function deserialize(json: string): Model {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ModelFormatError(`Not a knap model: invalid JSON (${msg})`, [{ code: 'structure', message: `invalid JSON: ${msg}` }]);
  }
  const fail = (errs: ValidationError[]): never => {
    const lines = errs.slice(0, MAX_LISTED).map((e) => `  - ${e.message}`);
    if (errs.length > MAX_LISTED) lines.push(`  … and ${errs.length - MAX_LISTED} more`);
    throw new ModelFormatError(`Invalid knap model (${errs.length} problem${errs.length === 1 ? '' : 's'}):\n${lines.join('\n')}`, errs);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail([{ code: 'structure', message: 'expected a JSON object with version, parts, rootPartId, nextPartId' }]);
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2 && o.version !== 3) {
    return fail([{ code: 'structure', message: `unsupported version ${JSON.stringify(o.version)} (expected 1, 2 or 3)` }]);
  }
  const candidate = {
    version: o.version,
    parts: o.parts,
    rootPartId: o.rootPartId === undefined ? null : o.rootPartId,
    nextPartId: o.nextPartId,
    ...('ground' in o && { ground: o.ground }),
    ...('fixRoot' in o && { fixRoot: o.fixRoot }),
  } as unknown as Model;
  if (o.nextPartId === undefined && Array.isArray(o.parts)) {
    const ids = (o.parts as unknown[])
      .map((p) => (typeof p === 'object' && p !== null ? (p as Record<string, unknown>).id : undefined))
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id));
    // A loop, not Math.max(...ids): spreading 150 000 ids overflows the call stack.
    let max = -Infinity;
    for (const id of ids) if (id > max) max = id;
    (candidate as { nextPartId: number }).nextPartId = ids.length ? max + 1 : 1;
  }
  // validateModel sees every present rim / ground / fixRoot value (JSON null included) and
  // rejects anything that is not valid.
  const errs = validateModel(candidate);
  if (errs.length) return fail(errs);
  // Rebuild with known fields only.
  const model: Model = {
    version: candidate.version,
    rootPartId: candidate.rootPartId,
    nextPartId: candidate.nextPartId,
    ...(candidate.ground !== undefined && { ground: candidate.ground }),
    ...(candidate.fixRoot !== undefined && { fixRoot: candidate.fixRoot }),
    parts: candidate.parts.map((p) => ({
      id: p.id,
      color: p.color.toLowerCase(),
      cells: p.cells.map(copyCell),
    })),
  };
  return model;
}

// ---------------------------------------------------------------------------------------------
// Gears (§2.7): listings for geometry, physics and the editor

/** A gear in a model: the hub cell of part `partId` (cell index `index`) with its geometry. */
export interface GearInfo {
  readonly partId: number;
  readonly index: number;
  readonly cell: Cell & { rim: number; teeth: true };
  readonly hub: Vec3i;
  readonly axis: Axis;
  /** Pitch radius (= cell.rim). */
  readonly r: number;
  /** Number of teeth, 16·r. */
  readonly teeth: number;
}

/** Every gear of the model (hole cells with isGear), in part order then cell order. */
export function gearsOf(m: Model): GearInfo[] {
  const out: GearInfo[] = [];
  for (const p of m.parts)
    p.cells.forEach((c, index) => {
      if (isGear(c) && isHole(c.kind)) out.push({ partId: p.id, index, cell: c, hub: cellPos(c), axis: c.axis, r: c.rim, teeth: gearTeeth(c.rim) });
    });
  return out;
}

/** One side of a mesh: the gear's part, its cell index in that part, and the hub cell. */
export interface GearRef {
  readonly partId: number;
  readonly index: number;
  readonly cell: Cell;
}

/** An edit-time mesh between two gears of different parts (§2.7 "Meshing"). */
export interface GearMesh {
  readonly a: GearRef;
  readonly b: GearRef;
  readonly teethA: number;
  readonly teethB: number;
  /** The common axis. */
  readonly axis: Axis;
}

/**
 * The edit-time meshes of a model: pairs of gears of different parts with parallel axes, in the
 * same layer, hubs in line along a grid axis at distance exactly r₁ + r₂ (gearContact 'mesh').
 * Deterministic: within a pair `a` is the gear with the smaller (partId, index); pairs are sorted
 * by (a.partId, a.index, b.partId, b.index). Pure geometry: does not validate the model.
 */
export function gearMeshes(m: Model): GearMesh[] {
  const gears = gearsOf(m);
  if (gears.length < 2) return [];
  const at = new Map<string, GearInfo[]>();
  for (const g of gears) {
    const k = posKey(g.hub[0], g.hub[1], g.hub[2]);
    const l = at.get(k);
    if (l) l.push(g);
    else at.set(k, [g]);
  }
  const before = (x: GearInfo, y: GearInfo) => x.partId < y.partId || (x.partId === y.partId && x.index < y.index);
  const out: { a: GearInfo; b: GearInfo }[] = [];
  for (const g of gears) {
    const [u, v] = planeAxes(g.axis);
    for (const r2 of GEAR_RADII) {
      const s = g.r + r2;
      if (!Number.isInteger(s)) continue;
      for (const [w, sign] of [[u, 1], [u, -1], [v, 1], [v, -1]] as const) {
        const q: [number, number, number] = [g.hub[0], g.hub[1], g.hub[2]];
        q[w] += sign * s;
        for (const h of at.get(posKey(q[0], q[1], q[2])) ?? []) {
          if (h.r !== r2 || h.axis !== g.axis || h.partId === g.partId || !before(g, h)) continue;
          out.push({ a: g, b: h });
        }
      }
    }
  }
  out.sort((p, q) => p.a.partId - q.a.partId || p.a.index - q.a.index || p.b.partId - q.b.partId || p.b.index - q.b.index);
  const ref = (g: GearInfo): GearRef => ({ partId: g.partId, index: g.index, cell: g.cell });
  return out.map(({ a, b }) => ({ a: ref(a), b: ref(b), teethA: a.teeth, teethB: b.teeth, axis: a.axis }));
}
