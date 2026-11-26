// Core data types (DESIGN.md §1, §2). Pure TypeScript; no imports outside src/core.

/** 0 = X, 1 = Y, 2 = Z. Axes are undirected. */
export type Axis = 0 | 1 | 2;

/** Face / direction index: 0..5 = +X, −X, +Y, −Y, +Z, −Z. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5;

/** Integer grid position or vector. */
export type Vec3i = readonly [number, number, number];

export type HoleKind = 'pinHole' | 'axleHole';
export type MaleKind = 'axle' | 'pin' | 'frictionPin';
export type Kind = HoleKind | MaleKind;

/** One sub-part occupying one grid cell. */
export interface Cell {
  x: number;
  y: number;
  z: number;
  kind: Kind;
  axis: Axis;
  /**
   * Wheel radius (§2.6), hole cells only: a solid disc of radius `rim` about the cell's axis, one
   * cell thick (the cell's own layer). A multiple of RIM_STEP (½) with RIM_MIN ≤ rim ≤ RIM_MAX
   * (1…4). Absent = a bare cell. The cell is the wheel's *hub*. Never present with value
   * `undefined` in models built by core operations (the key is omitted instead).
   */
  rim?: number;
  /**
   * The rim is a gear (§2.7): only `true`, only on a hole cell with `rim` ∈ GEAR_RADII
   * (½, 1, 1½, 2½ → 8, 16, 24, 40 teeth). `rim` is then the pitch radius. Absent = a plain wheel
   * (or a bare cell). Never present with any other value in models built by core operations.
   */
  teeth?: true;
}

/** One solid moulded piece: a connected set of cells. */
export interface Part {
  id: number;
  /** '#rrggbb' */
  color: string;
  cells: Cell[];
}

/**
 * Treated as immutable: core operations return new models and cache derived data by identity,
 * so never mutate a model (or its parts/cells) in place once core functions have seen it.
 */
export interface Model {
  /**
   * File format version. 2 as soon as the model uses a rim, `ground` or `fixRoot` (the operations
   * that set them set it; validateModel rejects version 1 with any of them); otherwise left alone,
   * so a model that uses none of them stays version 1 and serialises exactly as before.
   * 3 as soon as any cell has `teeth` (§2.7; setGear, addCell/addPart with a gear set it;
   * validateModel rejects version 1 or 2 with teeth). Never lowered by an operation.
   */
  version: 1 | 2 | 3;
  parts: Part[];
  /** Part fixed in space during simulation; null/stale => lowest part id (see effectiveRootId). */
  rootPartId: number | null;
  /** Next id handed out to a new part: a safe integer >= 1, greater than every part id (ids are >= 0). */
  nextPartId: number;
  /** §2.6: a horizontal floor under the model at groundLevel(m). Absent = false. */
  ground?: boolean;
  /**
   * §2.6: false = no part is fixed in space (a vehicle). Absent = true. Only effective while the
   * ground is on: use rootIsFixed(m), never this field directly.
   */
  fixRoot?: boolean;
}

/** How a male cell and a coaxial hole cell of another part sharing a position interact. */
export type MateType = 'weld' | 'revolute' | 'cylindrical';

export type ValidationCode =
  | 'structure' // malformed field (wrong type, non-integer, unknown kind, bad colour, …)
  | 'duplicatePartId'
  | 'nextPartId' // nextPartId not greater than every part id
  | 'emptyPart'
  | 'duplicateCell' // two cells of one part at one position
  | 'disconnected' // part not connected under the in-part connection rule
  | 'overlap' // invalid sharing of a position by cells of different parts (§2.3), or a wheel disc
  //            overlapping another part's cell or disc (§2.6 rule 2)
  //            — and, for gears (§2.7), a tip disc over another part's cell, a gear tip over a
  //            wheel of another part, two gears of different parts that overlap, clash, cross or
  //            touch diagonally
  | 'rim' // a rim on a male cell, a rim value that is not a multiple of ½ in [RIM_MIN, RIM_MAX],
  //         or bad teeth (not true, on a male, without a rim, or on a radius not in GEAR_RADII)
  | 'gear'; // §2.7 within one part: a cell cutting into its gear (rule 5), its gear tip over its
  //           own wheel, or two of its gears that touch or clash

export interface ValidationError {
  code: ValidationCode;
  message: string;
  partId?: number;
  pos?: Vec3i;
}

export type CanResult = { ok: true } | { ok: false; reason: string };
