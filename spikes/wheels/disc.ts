// Edit-time overlap rule for wheels (spike "wheels", pure TS, no imports).
//
// A wheel is grown from a hole cell (the hub) at integer centre c with axis a: it is the solid
//   D = { q : |q_a − c_a| ≤ ½  and  dist(q, axis line through c) ≤ r },   r ∈ {0.5, 1, 1.5, …}
// i.e. a disc of radius r, one unit thick, filling exactly the hub's layer along a. r = 0.5 is the
// bare hub cell's inscribed cylinder. Other parts are judged on the grid: a cell is the closed cube
// [p − ½, p + ½]³ (DESIGN §1). Two solids "overlap" iff their intersection has positive volume
// (sharing a face, edge or point is touching, which is allowed — and for two coplanar parallel
// discs it is exactly gear mesh / friction-drive contact).
//
// Exact tests (all inputs on the integer grid, so every comparison is between numbers of the form
// (k/2)², exact in f64):
//  - disc vs cell: the cube shares the disc's slab with positive thickness only if p_a = c_a
//    (|p_a − c_a| is an integer; ≥ 1 means the slabs at most touch). In the disc's plane the cube
//    is the square [du ± ½] × [dv ± ½] (du, dv = in-plane offsets of p from c); the open disc meets
//    the open square iff the square's nearest point is closer than r:
//        near² = max(0, |du| − ½)² + max(0, |dv| − ½)² < r²,
//    and the square lies inside the closed disc iff its farthest corner does:
//        far² = (|du| + ½)² + (|dv| + ½)² ≤ r².
//  - disc vs disc, parallel axes: positive-volume overlap iff the slabs coincide (c1_a = c2_a) and
//    |c1 − c2| < r1 + r2; = r1 + r2 is "touch" (mesh distance).
//  - disc vs disc, perpendicular axes a ≠ b, third axis k, d = c2 − c1: a point q (relative to c1)
//    must satisfy |q_a| < ½, |q_b − d_b| < ½ (the two slabs), q_b² + q_k² < r1² (disc 1, whose
//    plane coordinates are b, k) and (q_a − d_a)² + (q_k − d_k)² < r2² (disc 2: a, k). q_b appears
//    only in disc 1's inequality and is limited only by slab 2, so the best choice gives
//    m_b = max(0, |d_b| − ½)²; likewise q_a gives m_a = max(0, |d_a| − ½)². What remains is one
//    variable q_k in two open intervals of half-widths α = √(r1² − m_b), β = √(r2² − m_a) centred
//    at 0 and d_k: they overlap iff m_b < r1², m_a < r2² and |d_k| < α + β. To stay exact,
//    |d_k| < α + β is tested squared: d_k² < α² + β² + 2αβ  ⇔  (d_k² − α² − β²) < 0 or
//    (d_k² − α² − β²)² < 4α²β²; touch iff equality (measure-zero contact).
export type Axis = 0 | 1 | 2;
export type P3 = readonly [number, number, number];

export interface Disc {
  /** Hub cell centre (integers). */
  c: P3;
  /** Wheel axis = the hub hole's axis. */
  axis: Axis;
  /** Outer radius in units, a positive multiple of 0.5 (0.5 = bare hole cell). */
  r: number;
}

export type Contact = 'none' | 'touch' | 'overlap';
export type Cover = 'none' | 'touch' | 'partial' | 'full';

function checkDisc(d: Disc): void {
  if (!(d.r > 0) || !Number.isInteger(d.r * 2)) throw new Error(`disc radius must be a positive multiple of 0.5 (got ${d.r})`);
  if (!d.c.every(Number.isInteger)) throw new Error('disc hub must be an integer cell');
}

/** In-plane axes of a disc with axis a, in a fixed order. */
export function planeAxes(a: Axis): [Axis, Axis] {
  return [((a + 1) % 3) as Axis, ((a + 2) % 3) as Axis];
}

/**
 * How the disc covers the cell (cube) centred at p:
 *  'none'    — disjoint, or a different layer (at most face contact),
 *  'touch'   — the disc's rim touches the cube's boundary (zero-volume contact),
 *  'partial' — positive-volume overlap, cube not inside the disc,
 *  'full'    — the whole cube is inside the disc.
 * The hub cell itself is reported like any other (it is 'full' for r ≥ √2/2, i.e. r ≥ 1).
 */
export function discCell(d: Disc, p: P3): Cover {
  checkDisc(d);
  if (p[d.axis] !== d.c[d.axis]) return 'none';
  const [u, v] = planeAxes(d.axis);
  const du = Math.abs(p[u] - d.c[u]);
  const dv = Math.abs(p[v] - d.c[v]);
  const r2 = d.r * d.r;
  const near2 = Math.max(0, du - 0.5) ** 2 + Math.max(0, dv - 0.5) ** 2;
  if (near2 > r2) return 'none';
  if (near2 === r2) return 'touch';
  const far2 = (du + 0.5) ** 2 + (dv + 0.5) ** 2;
  return far2 <= r2 ? 'full' : 'partial';
}

/** Exact positive-volume overlap test between two discs (axes on the grid). */
export function discDisc(d1: Disc, d2: Disc): Contact {
  checkDisc(d1);
  checkDisc(d2);
  const d = [d2.c[0] - d1.c[0], d2.c[1] - d1.c[1], d2.c[2] - d1.c[2]];
  if (d1.axis === d2.axis) {
    if (d[d1.axis] !== 0) return 'none';
    const [u, v] = planeAxes(d1.axis);
    const dist2 = d[u]! ** 2 + d[v]! ** 2;
    const s2 = (d1.r + d2.r) ** 2;
    return dist2 < s2 ? 'overlap' : dist2 === s2 ? 'touch' : 'none';
  }
  const a = d1.axis;
  const b = d2.axis;
  const k = (3 - a - b) as Axis;
  const mb = Math.max(0, Math.abs(d[b]!) - 0.5) ** 2;
  const ma = Math.max(0, Math.abs(d[a]!) - 0.5) ** 2;
  const A2 = d1.r * d1.r - mb;
  const B2 = d2.r * d2.r - ma;
  if (A2 < 0 || B2 < 0) return 'none';
  if (A2 === 0 || B2 === 0) return Math.abs(d[k]!) <= Math.sqrt(A2) + Math.sqrt(B2) ? 'touch' : 'none';
  // |d_k| vs α + β, squared without roots: d_k² ? α² + β² + 2αβ
  const e = d[k]! ** 2 - A2 - B2;
  if (e < 0) return 'overlap';
  const lhs = e * e;
  const rhs = 4 * A2 * B2;
  return lhs < rhs ? 'overlap' : lhs === rhs ? 'touch' : 'none';
}

/** Cells (in-plane offsets from the hub, hub excluded) that a disc of radius r fully or partly covers. */
export function coveredOffsets(r: number): { full: [number, number][]; partial: [number, number][] } {
  const full: [number, number][] = [];
  const partial: [number, number][] = [];
  const n = Math.ceil(r + 0.5);
  for (let du = -n; du <= n; du++)
    for (let dv = -n; dv <= n; dv++) {
      if (du === 0 && dv === 0) continue;
      const c = discCell({ c: [0, 0, 0], axis: 2, r }, [du, dv, 0]);
      if (c === 'full') full.push([du, dv]);
      else if (c === 'partial') partial.push([du, dv]);
    }
  return { full, partial };
}

/**
 * Editor rule sketch: can a wheel of radius r live on hub `d.c` given the other parts' cells?
 * Returns the offending cells. `own` are the cells of the wheel's own part (they fuse with the
 * disc where it covers them and are not offenders); every other part's cell that the disc
 * overlaps with positive volume is an offender, except a male cell in the hub itself (the axle or
 * pin it turns on, a normal mate).
 */
export function wheelBlockers(d: Disc, others: readonly { x: number; y: number; z: number; male: boolean }[]): P3[] {
  const out: P3[] = [];
  for (const c of others) {
    const p: P3 = [c.x, c.y, c.z];
    if (c.male && p[0] === d.c[0] && p[1] === d.c[1] && p[2] === d.c[2]) continue;
    const k = discCell(d, p);
    if (k === 'partial' || k === 'full') out.push(p);
  }
  return out;
}
