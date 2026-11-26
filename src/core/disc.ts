// Exact overlap tests for wheel discs (DESIGN.md §2.6). Pure; no imports outside src/core.
//
// A wheel of radius r grown from a hub cell at integer centre c with axis a is the solid
//   D = { q : |q_a − c_a| ≤ ½  and  dist(q, axis line through c) ≤ r },   r a positive multiple of ½
// i.e. a disc one cell thick filling exactly the hub's layer. A grid cell is the closed unit cube
// [p − ½, p + ½]³. Two solids *overlap* iff their intersection has positive volume; sharing a face,
// an edge or a point is *touching*, which never counts (for two coplanar parallel discs it is
// exactly the distance at which gears will mesh).
//
// Exactness: every input is an integer or a multiple of ½, so all arithmetic below is done on
// *doubled* quantities (2·offset, 2·r), which are integers. Every comparison is then between
// integers well inside 2^53 (the far cases are rejected first by a bounding test), so there is no
// epsilon anywhere and equality (touching) is decided exactly.
//
// The formulas (spike `spikes/wheels/disc.ts`, derivation there):
//  - disc × cell: only in the same layer (|p_a − c_a| is an integer; ≥ 1 means the slabs at most
//    touch). With in-plane offsets (du, dv): overlap iff max(0,|du|−½)² + max(0,|dv|−½)² < r²;
//    the disc covers the cell iff (|du|+½)² + (|dv|+½)² ≤ r².
//  - disc × disc, parallel axes: overlap iff same layer and |c₁ − c₂| < r₁ + r₂.
//  - disc × disc, perpendicular axes a, b (third axis k), d = c₂ − c₁: with m_b = max(0,|d_b|−½)²
//    and m_a = max(0,|d_a|−½)²: overlap iff m_b < r₁², m_a < r₂² and
//    |d_k| < √(r₁² − m_b) + √(r₂² − m_a), compared squared.
import type { Axis, Vec3i } from './types';

/** How a disc meets a cell. */
export type DiscCellContact = 'none' | 'touch' | 'partial' | 'full';
/** How two discs meet. */
export type DiscDiscContact = 'none' | 'touch' | 'overlap';

/** The two in-plane axes of a disc about `axis`, in a fixed order: [(axis+1)%3, (axis+2)%3]. */
export function planeAxes(axis: Axis): [Axis, Axis] {
  return [((axis + 1) % 3) as Axis, ((axis + 2) % 3) as Axis];
}

function checkDisc(hub: Vec3i, axis: Axis, r: number): number {
  if (!(r > 0) || !Number.isInteger(r * 2)) throw new Error(`disc radius must be a positive multiple of ½ (got ${r})`);
  if (!(hub[0] !== undefined && Number.isSafeInteger(hub[0]) && Number.isSafeInteger(hub[1]) && Number.isSafeInteger(hub[2]))) {
    throw new Error(`disc hub must be an integer cell (got ${JSON.stringify(hub)})`);
  }
  if (axis !== 0 && axis !== 1 && axis !== 2) throw new Error(`disc axis must be 0, 1 or 2 (got ${JSON.stringify(axis)})`);
  return r * 2;
}

function checkPos(pos: Vec3i): void {
  if (!(Number.isSafeInteger(pos[0]) && Number.isSafeInteger(pos[1]) && Number.isSafeInteger(pos[2]))) {
    throw new Error(`cell position must be three integers (got ${JSON.stringify(pos)})`);
  }
}

/**
 * Exact relation between the disc (hub, axis, r) and the closed unit cube centred at `pos`:
 * - 'none'    — disjoint, or a different layer (at most face contact);
 * - 'touch'   — the disc's rim touches the cube's boundary (zero-volume contact);
 * - 'partial' — positive-volume overlap, the cube not entirely inside the disc;
 * - 'full'    — the whole cube lies inside the disc.
 * The hub cell itself is reported like any other cell ('full' for r ≥ 1, 'partial' for r = ½).
 * Throws on a non-integer hub/pos or a radius that is not a positive multiple of ½.
 */
export function discCellContact(hub: Vec3i, axis: Axis, r: number, pos: Vec3i): DiscCellContact {
  const R = checkDisc(hub, axis, r);
  checkPos(pos);
  if (pos[axis] !== hub[axis]) return 'none';
  const [u, v] = planeAxes(axis);
  const DU = 2 * Math.abs(pos[u] - hub[u]);
  const DV = 2 * Math.abs(pos[v] - hub[v]);
  if (DU > R + 1 || DV > R + 1) return 'none'; // bounding square (keeps the squares small)
  const nu = Math.max(0, DU - 1);
  const nv = Math.max(0, DV - 1);
  const near2 = nu * nu + nv * nv;
  const R2 = R * R;
  if (near2 > R2) return 'none';
  if (near2 === R2) return 'touch';
  const far2 = (DU + 1) * (DU + 1) + (DV + 1) * (DV + 1);
  return far2 <= R2 ? 'full' : 'partial';
}

/** Does the disc (hub, axis, r) overlap the cell at `pos` with positive volume? (§2.6) */
export function discOverlapsCell(hub: Vec3i, axis: Axis, r: number, pos: Vec3i): boolean {
  const c = discCellContact(hub, axis, r, pos);
  return c === 'partial' || c === 'full';
}

/** Does the disc (hub, axis, r) contain the whole cell at `pos`? (§2.6) */
export function discCoversCell(hub: Vec3i, axis: Axis, r: number, pos: Vec3i): boolean {
  return discCellContact(hub, axis, r, pos) === 'full';
}

/** Exact relation between two discs (symmetric in its arguments). */
export function discDiscContact(hubA: Vec3i, axisA: Axis, rA: number, hubB: Vec3i, axisB: Axis, rB: number): DiscDiscContact {
  const R1 = checkDisc(hubA, axisA, rA);
  const R2 = checkDisc(hubB, axisB, rB);
  // Doubled offsets.
  const D = [2 * (hubB[0] - hubA[0]), 2 * (hubB[1] - hubA[1]), 2 * (hubB[2] - hubA[2])] as const;
  // Bounding boxes: disc A spans ±rA in its plane and ±½ along axisA (likewise B). Beyond the sum of
  // the extents on any axis the solids are disjoint; this also bounds every product below.
  for (let i = 0; i < 3; i++) {
    const ea = i === axisA ? 1 : R1;
    const eb = i === axisB ? 1 : R2;
    if (Math.abs(D[i]!) > ea + eb) return 'none';
  }
  if (axisA === axisB) {
    if (D[axisA] !== 0) return 'none'; // different layers (an integer ≥ 1 apart): at most face contact
    const [u, v] = planeAxes(axisA);
    const dist2 = D[u]! * D[u]! + D[v]! * D[v]!;
    const s2 = (R1 + R2) * (R1 + R2);
    return dist2 < s2 ? 'overlap' : dist2 === s2 ? 'touch' : 'none';
  }
  // Perpendicular: a = axisA, b = axisB, k = the third axis.
  const a = axisA;
  const b = axisB;
  const k = (3 - a - b) as Axis;
  const nb = Math.max(0, Math.abs(D[b]!) - 1);
  const na = Math.max(0, Math.abs(D[a]!) - 1);
  const A2 = R1 * R1 - nb * nb; // (2α)²
  const B2 = R2 * R2 - na * na; // (2β)²
  if (A2 < 0 || B2 < 0) return 'none';
  const dk2 = D[k]! * D[k]!;
  if (A2 === 0 || B2 === 0) {
    // One interval has zero width: at most touching. |d_k| ≤ α + β with one root zero is
    // dk² ≤ (the other)², exact on integers.
    return dk2 <= A2 + B2 ? 'touch' : 'none';
  }
  // |d_k| vs α + β, squared without roots: dk² ? α² + β² + 2αβ (all doubled).
  const e = dk2 - A2 - B2;
  if (e < 0) return 'overlap';
  const lhs = e * e;
  const rhs = 4 * A2 * B2;
  return lhs < rhs ? 'overlap' : lhs === rhs ? 'touch' : 'none';
}

/** Do two discs overlap with positive volume? (§2.6; touching, e.g. at mesh distance, is not overlap.) */
export function discsOverlap(hubA: Vec3i, axisA: Axis, rA: number, hubB: Vec3i, axisB: Axis, rB: number): boolean {
  return discDiscContact(hubA, axisA, rA, hubB, axisB, rB) === 'overlap';
}

/**
 * Half-width, in cells, of the square of the hub's layer that holds every cell a disc of radius r
 * overlaps: an overlapped cell has |du| − ½ < r, so |du|, |dv| ≤ ⌈r + ½⌉ − 1 (1 for r = 1 and 1.5,
 * 4 for r = 4).
 */
export function discReach(r: number): number {
  return Math.ceil(r + 0.5) - 1;
}

/**
 * Every cell (hub included) that the disc overlaps with positive volume, in a fixed order
 * (row-major over the two plane axes). Intended for rule checks, picking and tests.
 */
export function discCells(hub: Vec3i, axis: Axis, r: number): Vec3i[] {
  checkDisc(hub, axis, r);
  const [u, v] = planeAxes(axis);
  const n = discReach(r);
  const out: Vec3i[] = [];
  for (let du = -n; du <= n; du++) {
    for (let dv = -n; dv <= n; dv++) {
      const p: [number, number, number] = [hub[0], hub[1], hub[2]];
      p[u] += du;
      p[v] += dv;
      if (discOverlapsCell(hub, axis, r, p)) out.push(p);
    }
  }
  return out;
}
