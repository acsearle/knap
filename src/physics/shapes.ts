// Collision shapes for Rapier, derived from partColliders (DESIGN.md §4.3): the same solid (up to
// the 0.01 cap bevel described below), built from pieces that Rapier's contact generation handles
// correctly and cheaply.
//
// - No native cylinders. Rapier's exact cylinder–cylinder narrow phase is very slow (≈ 0.6 ms per
//   pair per step) for the rotated, coaxial, nested pairs that every pin in a hole produces; a
//   cylinder of radius r becomes the circumscribed regular `segments`-gon prism (faces tangent to
//   the circle, four of them axis-aligned, so parts rest at exactly the cylinder distance).
// - A straight run of plain hole cells (a liftarm: same axis, side by side, barrel not extended
//   axially) is ONE prism over the stadium polygon of its two end barrels — exactly the union of
//   those barrels and the webs between them — so two resting beams make one contact manifold
//   instead of dozens (contacts are solved in every substep; their count dominates the cost).
// - No face may have more than 4 vertices. Rapier's convex–convex manifolds come from parry's
//   polygonal features, and parry 0.31 (ConvexPolyhedron::local_support_feature) keeps only the
//   FIRST FOUR vertices of a face (`face.num_vertices_or_edges.min(4)`). A flat 16-gon cap or the
//   stadium face of a liftarm lying flat therefore produced contact points on one small corner of
//   the face: flat-lying parts tipped, sank and fell through each other. So each end face (cap)
//   of a prism is bevelled: four rim vertices (a rectangle) stay at the full half-length and the
//   other rim vertices are pulled in axially by BEVEL. The cap is then a flat 4-vertex rectangle
//   surrounded by 3–4-vertex facets sloping away; the side faces are 4-vertex rectangles or
//   trapezoids.
//   - Run: the kept rectangle is the full-width top of the straight part, reaching R·sin(π/n)
//     (0.09) past each end barrel's centre; the rounded ends slope away by 1.5–3.5°.
//   - Single cylinder: the kept rectangle is ±R·cos 56.25° × ±R·sin 56.25° (0.52 × 0.78 for a
//     hole barrel); the facets slope away by 3–8°.
//   A part lying flat rests on the rectangle; only if its centre of mass is outside it does it
//   settle a few degrees tilted onto a facet. BEVEL is 0.01 because Rapier's hull builder merges
//   facets that are this close to coplanar back into one face (measured: 0.005 merged and fell
//   through, 0.006 held; 0.01 holds for a 31-hole beam on a 41-hole beam).
// - Mass properties are those of the un-bevelled prism, computed analytically and set on the
//   collider, so the bevel changes the contact geometry only.
// Pure: no Rapier import.
import type { Axis, Part } from '../core/types';
import { HC } from '../geometry/dims';
import { partColliders } from '../geometry/colliders';
import { partOrigin } from '../geometry/topology';
import type { ColliderPrim } from '../geometry/colliders';
import type { Vec3 } from './math';

/** Unit-density mass properties of a piece: volume, centre of mass and the diagonal inertia
 *  about the centre of mass in world axes (the pieces are axis-aligned and mirror-symmetric, so
 *  the world axes are principal). */
export interface PieceMass {
  volume: number;
  com: Vec3;
  inertia: Vec3;
}

export type Shape =
  | { kind: 'hull'; points: Vec3[]; mass: PieceMass } // world coordinates (edit time)
  | { kind: 'box'; center: Vec3; halfExtents: Vec3 };

/** Axial pull-in of the non-kept cap vertices, units. */
export const BEVEL = 0.01;
/** Single cylinders keep the cap vertices nearest ±KEEP_DEG and 180° ± KEEP_DEG from +u. */
const KEEP_DEG = 56.25;

const EPS = 1e-9;

/** 2D polygon (CCW) area, centroid and second moments ∫v² dA, ∫u² dA about the centroid. */
function polyMoments(P: [number, number][]): { A: number; cu: number; cv: number; Iuu: number; Ivv: number } {
  let A = 0;
  let cu = 0;
  let cv = 0;
  let Su2 = 0;
  let Sv2 = 0;
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i]!;
    const [x1, y1] = P[(i + 1) % P.length]!;
    const c = x0 * y1 - x1 * y0;
    A += c / 2;
    cu += ((x0 + x1) * c) / 6;
    cv += ((y0 + y1) * c) / 6;
    Su2 += ((x0 * x0 + x0 * x1 + x1 * x1) * c) / 12;
    Sv2 += ((y0 * y0 + y0 * y1 + y1 * y1) * c) / 12;
  }
  cu /= A;
  cv /= A;
  return { A, cu, cv, Iuu: Sv2 - A * cv * cv, Ivv: Su2 - A * cu * cu };
}

/**
 * A prism along `axis` over a convex CCW polygon given in (u, v) offsets from `center`
 * (v = the third axis), with bevelled end faces: vertices flagged `keep` stay at ±halfLength,
 * the others at ±(halfLength − BEVEL).
 */
function bevelledPrism(center: Vec3, axis: Axis, u: Axis, halfLength: number, poly: { u: number; v: number; keep: boolean }[]): Shape {
  const v = (3 - axis - u) as Axis;
  const points: Vec3[] = [];
  for (const q of poly)
    for (const s of [-1, 1]) {
      const p: Vec3 = [center[0], center[1], center[2]];
      p[u] += q.u;
      p[v] += q.v;
      p[axis] += s * (q.keep ? halfLength : halfLength - BEVEL);
      points.push(p);
    }
  const m = polyMoments(poly.map((q) => [q.u, q.v]));
  const L = 2 * halfLength;
  const volume = m.A * L;
  const com: Vec3 = [center[0], center[1], center[2]];
  com[u] += m.cu;
  com[v] += m.cv;
  const inertia: Vec3 = [0, 0, 0];
  inertia[axis] = (m.Iuu + m.Ivv) * L;
  inertia[u] = m.Iuu * L + (volume * L * L) / 12;
  inertia[v] = m.Ivv * L + (volume * L * L) / 12;
  return { kind: 'hull', points, mass: { volume, com, inertia } };
}

/** Rim vertices of the circumscribed `segments`-gon, CCW from +u: angles (i + ½)·360°/n. */
function gonVertex(R: number, segments: number, i: number): { u: number; v: number; a: number } {
  const a = ((i + 0.5) / segments) * 2 * Math.PI;
  return { u: R * Math.cos(a), v: R * Math.sin(a), a };
}

/** The vertex index (0 ≤ i < n/4) whose angle is nearest KEEP_DEG. */
function keepIndex(segments: number): number {
  let best = 0;
  for (let i = 0; i < segments / 4; i++)
    if (Math.abs(((i + 0.5) / segments) * 360 - KEEP_DEG) < Math.abs(((best + 0.5) / segments) * 360 - KEEP_DEG)) best = i;
  return best;
}

function checkSegments(segments: number): void {
  if (!Number.isInteger(segments) || segments < 4 || segments % 4 !== 0)
    throw new Error(`cylinderSegments must be a multiple of 4 (got ${segments})`);
}

/**
 * The prism standing in for a cylinder along `axis` (world centre), or — with `runLength` n > 0 —
 * for a straight run of n + 1 such cylinders whose centres are `center` + k·e_u, k = 0..n (the
 * stadium of the two end barrels). Rim vertices kept at full length: for a single cylinder the
 * four nearest ±KEEP_DEG from ±u; for a run the four bounding its straight part (nearest ±90°).
 */
export function prismShape(center: Vec3, axis: Axis, radius: number, halfLength: number, segments: number, u: Axis, runLength = 0): Shape {
  checkSegments(segments);
  if (u === axis) throw new Error('u must be transverse to the axis');
  const R = radius / Math.cos(Math.PI / segments);
  const n = segments;
  const j = runLength > 0 ? n / 4 - 1 : keepIndex(n);
  const keepSet = new Set([j, n / 2 - 1 - j, n / 2 + j, n - 1 - j]);
  const poly: { u: number; v: number; keep: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const g = gonVertex(R, n, i);
    const plusU = g.u > 0;
    // Run: the +u half of the polygon sits on the last barrel (offset runLength), the −u half on the first.
    poly.push({ u: g.u + (plusU ? runLength : 0), v: g.v, keep: keepSet.has(i) });
  }
  return bevelledPrism(center, axis, u, halfLength, poly);
}

type Cyl = Extract<ColliderPrim, { shape: 'cylinder' }>;

/** Shapes of one part, in edit-time world coordinates. */
export function partShapes(part: Part, segments: number): Shape[] {
  checkSegments(segments);
  const origin = partOrigin(part);
  const w = (c: Vec3): Vec3 => [c[0] + origin[0], c[1] + origin[1], c[2] + origin[2]];
  const prims = partColliders(part);
  const cells = part.cells;

  // Plain hole barrels: centred on their cell, not extended axially.
  const plain = new Map<number, Cyl>(); // cell index → barrel
  for (const p of prims) {
    if (p.shape !== 'cylinder' || p.male) continue;
    const c = cells[p.cell]!;
    const ctr = w(p.center);
    if (Math.abs(p.halfLength - HC) < EPS && Math.abs(ctr[0] - c.x) + Math.abs(ctr[1] - c.y) + Math.abs(ctr[2] - c.z) < EPS)
      plain.set(p.cell, p);
  }
  const byPos = new Map<string, number>();
  cells.forEach((c, i) => byPos.set(`${c.x},${c.y},${c.z}`, i));
  const plainAt = (x: number, y: number, z: number, axis: Axis): number | undefined => {
    const i = byPos.get(`${x},${y},${z}`);
    return i !== undefined && plain.has(i) && cells[i]!.axis === axis ? i : undefined;
  };

  const out: Shape[] = [];
  const coveredBarrel = new Set<number>();
  const coveredWeb = new Set<string>(); // `${cell}:${dir axis}:${sign}`
  for (const [i] of plain) {
    const c = cells[i]!;
    for (let d = 0 as Axis; d < 3; d = (d + 1) as Axis) {
      if (d === c.axis) continue;
      const step = (k: number): [number, number, number] => {
        const p: [number, number, number] = [c.x, c.y, c.z];
        p[d] += k;
        return p;
      };
      // Only start a run at its first cell along +d.
      if (plainAt(...step(-1), c.axis) !== undefined) continue;
      let n = 0;
      while (plainAt(...step(n + 1), c.axis) !== undefined) n++;
      if (n === 0) continue;
      const run: number[] = [];
      for (let k = 0; k <= n; k++) run.push(plainAt(...step(k), c.axis)!);
      run.forEach((ci, k) => {
        coveredBarrel.add(ci);
        if (k > 0) coveredWeb.add(`${ci}:${d}:-1`);
        if (k < n) coveredWeb.add(`${ci}:${d}:1`);
      });
      const first = plain.get(run[0]!)!;
      out.push(prismShape(w(first.center), c.axis, first.radius, first.halfLength, segments, d, n));
    }
  }

  for (const p of prims) {
    if (p.shape === 'cylinder') {
      if (!p.male && coveredBarrel.has(p.cell)) continue;
      out.push(prismShape(w(p.center), p.axis, p.radius, p.halfLength, segments, ((p.axis + 1) % 3) as Axis));
      continue;
    }
    const c = cells[p.cell]!;
    const ctr = w(p.center);
    const off = [ctr[0] - c.x, ctr[1] - c.y, ctr[2] - c.z];
    const d = off.findIndex((x) => Math.abs(x) > EPS);
    if (d >= 0 && coveredWeb.has(`${p.cell}:${d}:${Math.sign(off[d]!)}`)) continue;
    out.push({ kind: 'box', center: ctr, halfExtents: [...p.halfExtents] });
  }
  return out;
}
