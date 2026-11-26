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
  version: 1;
  parts: Part[];
  /** Part fixed in space during simulation; null/stale => lowest part id (see effectiveRootId). */
  rootPartId: number | null;
  /** Next id handed out to a new part: a safe integer >= 1, greater than every part id (ids are >= 0). */
  nextPartId: number;
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
  | 'overlap'; // invalid sharing of a position by cells of different parts (§2.3)

export interface ValidationError {
  code: ValidationCode;
  message: string;
  partId?: number;
  pos?: Vec3i;
}

export type CanResult = { ok: true } | { ok: false; reason: string };
