// The root part's "fixed" marker (DESIGN.md §6.1): where it is anchored. Pure (no three.js).
//
// The anchor is a cell of the root part chosen from the model alone — never from the camera, other
// parts or the simulation — so the mark cannot jump between cells while orbiting or simulating.

/** A cell position (the part's edit-time cells). */
export interface AnchorCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Index of the anchor cell: among the cells with the lowest y, the one nearest (in x/z) to the
 * centroid of that bottom row; ties go to the lower x, then the lower z (then the earlier index,
 * which only a malformed part with duplicate cells could reach). -1 for no cells.
 */
export function rootAnchorIndex(cells: readonly AnchorCell[]): number {
  if (!cells.length) return -1;
  let minY = Infinity;
  for (const c of cells) minY = Math.min(minY, c.y);
  const row = cells.map((c, i) => ({ c, i })).filter((e) => e.c.y === minY);
  const cx = row.reduce((s, e) => s + e.c.x, 0) / row.length;
  const cz = row.reduce((s, e) => s + e.c.z, 0) / row.length;
  let best = row[0]!;
  let bestD = Infinity;
  for (const e of row) {
    const d = (e.c.x - cx) ** 2 + (e.c.z - cz) ** 2;
    const better =
      d < bestD - 1e-9 ||
      (Math.abs(d - bestD) <= 1e-9 && (e.c.x < best.c.x || (e.c.x === best.c.x && (e.c.z < best.c.z || (e.c.z === best.c.z && e.i < best.i)))));
    if (better) {
      best = e;
      bestD = d;
    }
  }
  return best.i;
}

/** Device-pixel offsets of the mark (a ground hatch) from its anchor point on screen, x right, y down. */
export const MARK = {
  /** CSS px from the projected anchor-cell centre down to the hatch's base line, plus `dropWorld`. */
  dropPx: 4,
  /** World units below the anchor-cell centre (screen-down) before `dropPx`. */
  dropWorld: 0.72,
  /** Half-width of the base line (CSS px). */
  halfWidth: 12,
  /** Depth of the hatch strokes below the base line (CSS px). */
  hatch: 4,
  /**
   * Alpha factor of the strokes where another part is in front of the mark. The strokes stay
   * nearly opaque: the covered state is carried by the halo (below), which is what separates the
   * dark strokes from a dark or saturated part; fading the strokes too (0.7 strokes / 0.3 halo,
   * earlier) left a smudge on red, blue and dark-grey parts at 1:1.
   */
  faint: 0.85,
  /** The same for the white halo: half strength, so the covering part's colour shows through. */
  haloFaint: 0.5,
  /**
   * World units: another part counts as "in front" (covering the root) when it is nearer than the
   * anchor-cell centre by more than this — i.e. in front of the root's own surface (half a cell),
   * not merely alongside it in the same layer (a neighbour's face is ≈ 0.5 nearer).
   */
  frontEps: 0.55,
  /** CSS px kept between the mark (base line ± halfWidth, down to `hatch`) and the view's edge. */
  edge: 4,
} as const;

/** Where the mark's base-line centre is drawn (CSS px, x right, y down). */
export interface MarkPlacement {
  readonly x: number;
  readonly y: number;
  /** Pushed in from the anchor's own position to keep it inside the view (root on screen). */
  readonly clamped: boolean;
}

/**
 * "Always visible" (§6.1) when the anchor cell is off-screen but the root is not: the mark at the
 * anchor's own position `at` when it fits in the `w`×`h` view; otherwise, if any root cell (centre
 * `cells`, half-size `cellPx` CSS px) reaches into the view, the same position clamped into the
 * view (inset by MARK.edge). Clamping is the identity while the mark fits, so the mark moves
 * continuously with the camera and never hops; it depends on the camera only through where the
 * fixed anchor projects. With the root entirely off-screen the mark stays at `at` (off-screen).
 */
export function placeMark(at: readonly [number, number], cells: readonly (readonly [number, number])[], cellPx: number, w: number, h: number): MarkPlacement {
  const e = MARK.edge;
  const x0 = MARK.halfWidth + e;
  const x1 = w - MARK.halfWidth - e;
  const y0 = e;
  const y1 = h - MARK.hatch - e;
  const [x, y] = at;
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { x, y, clamped: false };
  const rootOnScreen = cells.some(([cx, cy]) => cx + cellPx > 0 && cx - cellPx < w && cy + cellPx > 0 && cy - cellPx < h);
  if (!rootOnScreen) return { x, y, clamped: false };
  const clamp = (v: number, lo: number, hi: number): number => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return { x: clamp(x, x0, x1), y: clamp(y, y0, y1), clamped: true };
}
