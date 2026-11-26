// Shared part-local frame and per-cell connection analysis used by both the render solid
// (solid.ts) and the collision compound (colliders.ts), so the two cannot disagree. Pure.
import { DIRS, connects, isHole, isMale, posKey } from '../core';
import type { Axis, Cell, Dir, Part } from '../core';
import { E_CONN, E_FREE } from './dims';

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
 * Translation-normalised signature of a part's cells (kind, axis and position relative to
 * partOrigin, sorted). Equal signatures ⇔ identical geometry in the part-local frame.
 * Colour and id are not part of it.
 */
export function partSignature(part: Part): string {
  const o = partOrigin(part);
  const items = part.cells.map(
    (c) => `${c.x - o[0]},${c.y - o[1]},${c.z - o[2]},${c.kind},${c.axis}`,
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
