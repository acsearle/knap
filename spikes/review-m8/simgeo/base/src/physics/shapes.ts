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
// - A wheel's rim (a 'disc' primitive) becomes a WheelShape: a native cylinder for the ground and
//   other wheels plus the 32-gon prism cut into 32 wedges × 2 slabs for every other part, and a
//   bevelled ground guard (DESIGN §5.1 "Wheels").
// - groundPlane: the floor tangent to the lowest of these colliders (DESIGN §5.1 "Ground").
// Pure: no Rapier import.
import { groundLevel } from '../core/model';
import type { Axis, Model, Part } from '../core/types';
import { HC, RIM_COLL_INSET } from '../geometry/dims';
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
  | { kind: 'box'; center: Vec3; halfExtents: Vec3 }
  | WheelShape;

/**
 * A wheel's rim (DESIGN §4.3 'disc', §5.1 "Wheels"), turned by sim.ts into two colliders on the
 * part's body:
 *  - round: a native cylinder (`center`, `axis`, `radius`, `halfLength`) carrying `mass` — the
 *    annulus between the hub barrel (`innerRadius`) and the rim at unit density (the hub's own
 *    prism already carries the barrel); it meets only the ground and other wheels' round colliders;
 *  - hull: `hull`, convex pieces (wheelHullPieces) whose union is the circumscribed
 *    WHEEL_SEGMENTS-gon prism over the same cylinder, density 0; they meet only ordinary part
 *    colliders.
 * World coordinates (edit time), like the other shapes.
 */
export interface WheelShape {
  kind: 'wheel';
  center: Vec3;
  axis: Axis;
  radius: number;
  halfLength: number;
  innerRadius: number;
  /** Nominal rim radius r (cell.rim). */
  rim: number;
  /** Unit-density annulus: volume, centre of mass (= center), inertia about it in world axes. */
  mass: PieceMass;
  /** The hull's convex pieces (wheelHullPieces), each a point list for one convex-hull collider. */
  hull: Vec3[][];
  /**
   * Ground guard: a WHEEL_SEGMENTS-gon prism inscribed in the round collider, GUARD_INSET_R smaller
   * in radius and GUARD_INSET_A in half-length (end-face bevel WHEEL_BEVEL·r), density 0, meeting only the
   * ground. It never touches the floor while the wheel stands, rolls upright or lies flat, and
   * catches a tilted wheel whose native cylinder Rapier lets sink into the half-space (measured: a
   * wobbling r = 4 wheel 1.04 units deep; DEVIATIONS §5 "Wheels, ground, free root").
   */
  guard: Vec3[];
}

/** Sides of a wheel's hull polygon and of its ground guard (DESIGN §5.1 "Wheels": a 32-gon). */
export const WHEEL_SEGMENTS = 32;
/**
 * The wheel hull's pieces (DESIGN §5.1 "Wheels", requirement added in review; DEVIATIONS §5): the
 * 32-gon prism is cut into WHEEL_SEGMENTS pie wedges about the axis (one rim side each: a triangle
 * prism, every face ≤ 4 vertices, no bevel needed) and WHEEL_SLABS slabs along it.
 *  - Wedges: one bevelled 32-gon prism gave a single contact point where a beam's edge crossed its
 *    end face (parry clips the two faces to one point there), so a wheel lying across a beam
 *    pivoted on it and sank through (0.37–0.46 of HC = 0.46). With wedges every piece the edge
 *    crosses adds its own manifold.
 *  - Slabs: Rapier's contacts between two dynamic bodies are soft, and the resting depth grows with
 *    the load per contact point; a wheel standing on a loose beam rests on one or two rim facets
 *    (4 points each), which sank 0.02–0.06. Two slabs double the points.
 * Measured (spikes in the report): 32 wedges × 2 slabs; 16 × 1, 32 × 1 and 16 × 2 were rejected.
 */
export const WHEEL_SLABS = 2;
/**
 * End-face bevel of the wheel's ground guard per unit of rim radius (0.02·r; Rapier's hull builder
 * merges facets flatter than ≈ r/80…r/100 back into one face, and parry keeps only 4 vertices of a
 * face — spikes/wheels/REPORT.md §1). (The first hull, a single prism, had the same bevel.)
 */
export const WHEEL_BEVEL = 0.02;
/**
 * Radial and axial inset of a wheel's ground guard from its round collider, units. Radial: above
 * the round collider's sink while rolling upright, which grows with speed (measured on a half-space:
 * 0.006 at rest, 0.015 at 120 units/s, 0.063 at 330 units/s, ≈ 0.08 at the 400 units/s cap), so the
 * guard's polygon never touches a rolling wheel's floor. Axial: small, so a wheel tipping toward
 * lying flat is caught after sinking ≈ 0.29·GUARD_INSET_R + 0.96·GUARD_INSET_A (17° from flat).
 */
export const GUARD_INSET_R = 0.12;
export const GUARD_INSET_A = 0.02;

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
function bevelledPrism(
  center: Vec3,
  axis: Axis,
  u: Axis,
  halfLength: number,
  poly: { u: number; v: number; keep: boolean }[],
  bevel = BEVEL,
): Extract<Shape, { kind: 'hull' }> {
  const v = (3 - axis - u) as Axis;
  const points: Vec3[] = [];
  for (const q of poly)
    for (const s of [-1, 1]) {
      const p: Vec3 = [center[0], center[1], center[2]];
      p[u] += q.u;
      p[v] += q.v;
      p[axis] += s * (q.keep ? halfLength : halfLength - bevel);
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
export function prismShape(
  center: Vec3,
  axis: Axis,
  radius: number,
  halfLength: number,
  segments: number,
  u: Axis,
  runLength = 0,
  bevel = BEVEL,
): Extract<Shape, { kind: 'hull' }> {
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
  return bevelledPrism(center, axis, u, halfLength, poly, bevel);
}

/**
 * Convex pieces of a wheel's hull (see WHEEL_SLABS): the circumscribed WHEEL_SEGMENTS-gon prism over
 * the cylinder of `radius` and ±`halfLength` about `axis` through `center` (rim vertices at angles
 * (i + ½)·360°/n from u = axis + 1, so four sides are axis-aligned and the polygon rests at exactly
 * `radius`, like prismShape), cut into one wedge per side — the triangle (axis, vertex i, vertex
 * i + 1) — and WHEEL_SLABS equal slabs along the axis. Each piece is 6 points. A function of
 * (radius, halfLength) only, so gears can use it at their tip radius.
 */
export function wheelHullPieces(center: Vec3, axis: Axis, radius: number, halfLength: number): Vec3[][] {
  const n = WHEEL_SEGMENTS;
  const R = radius / Math.cos(Math.PI / n);
  const u = ((axis + 1) % 3) as Axis;
  const v = ((axis + 2) % 3) as Axis;
  const at = (pu: number, pv: number, h: number): Vec3 => {
    const p: Vec3 = [center[0], center[1], center[2]];
    p[u] += pu;
    p[v] += pv;
    p[axis] += h;
    return p;
  };
  const out: Vec3[][] = [];
  for (let k = 0; k < WHEEL_SLABS; k++) {
    const lo = -halfLength + (2 * halfLength * k) / WHEEL_SLABS;
    const hi = -halfLength + (2 * halfLength * (k + 1)) / WHEEL_SLABS;
    for (let i = 0; i < n; i++) {
      const a = gonVertex(R, n, i);
      const b = gonVertex(R, n, (i + 1) % n);
      const piece: Vec3[] = [];
      for (const h of [lo, hi]) piece.push(at(0, 0, h), at(a.u, a.v, h), at(b.u, b.v, h));
      out.push(piece);
    }
  }
  return out;
}

/** The wheel shape of a disc primitive at world centre `center` (see WheelShape). */
export function wheelShape(center: Vec3, axis: Axis, radius: number, halfLength: number, innerRadius: number, rim: number): WheelShape {
  const L = 2 * halfLength;
  const volume = Math.PI * (radius * radius - innerRadius * innerRadius) * L;
  const r2 = radius * radius + innerRadius * innerRadius;
  const inertia: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) inertia[k] = k === axis ? (volume * r2) / 2 : (volume * (3 * r2 + L * L)) / 12;
  const u = ((axis + 1) % 3) as Axis;
  const hull = wheelHullPieces(center, axis, radius, halfLength);
  const inR = (radius - GUARD_INSET_R) * Math.cos(Math.PI / WHEEL_SEGMENTS); // vertices at radius − GUARD_INSET_R
  const guard = prismShape(center, axis, inR, halfLength - GUARD_INSET_A, WHEEL_SEGMENTS, u, 0, WHEEL_BEVEL * rim).points;
  return { kind: 'wheel', center: [...center], axis, radius, halfLength, innerRadius, rim, mass: { volume, com: [...center], inertia }, hull, guard };
}

/** Default sides of the prisms standing in for collider cylinders (SimOptions.cylinderSegments). */
export const DEFAULT_CYLINDER_SEGMENTS = 16;

/**
 * Lowest point along −n of every collider that meets the ground, as min n·x (n a unit vector, edit-
 * time world coordinates): the prisms' vertices and the boxes' corners exactly as partShapes builds
 * them (so a rod's circumscribed polygon and the caps' bevel count), and each wheel's round collider
 * (a native cylinder, exact support). A wheel's hull pieces never meet the ground and its guard lies
 * inside the round collider, so neither counts. Infinity for a model without cells. Pure.
 *
 * Only parts whose nominal geometry (unit cubes, rim discs) reaches within 1 unit of the lowest
 * nominal point are built: every collider point of a cell lies no higher than the cell centre, which
 * is at most 0.87 above that cell's nominal low, so a part beyond the margin cannot hold the minimum.
 */
export function lowestGroundPoint(parts: readonly Part[], n: Vec3, segments = DEFAULT_CYLINDER_SEGMENTS): number {
  const dot = (q: Vec3) => q[0] * n[0] + q[1] * n[1] + q[2] * n[2];
  const half = 0.5 * (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]));
  const nominal = parts.map((p) => {
    let lo = Infinity;
    for (const c of p.cells) {
      const h = c.x * n[0] + c.y * n[1] + c.z * n[2];
      lo = Math.min(lo, h - half);
      if (c.rim !== undefined) lo = Math.min(lo, h - c.rim * Math.sqrt(Math.max(0, 1 - n[c.axis]! ** 2)) - 0.5 * Math.abs(n[c.axis]!));
    }
    return lo;
  });
  let floor = Infinity;
  for (const lo of nominal) floor = Math.min(floor, lo);
  let low = Infinity;
  parts.forEach((p, i) => {
    if (!(nominal[i]! <= floor + 1)) return;
    for (const sh of partShapes(p, segments)) {
      if (sh.kind === 'hull') for (const q of sh.points) low = Math.min(low, dot(q));
      else if (sh.kind === 'box') {
        const e = sh.halfExtents;
        low = Math.min(low, dot(sh.center) - Math.abs(n[0]) * e[0] - Math.abs(n[1]) * e[1] - Math.abs(n[2]) * e[2]);
      } else {
        const na = Math.abs(n[sh.axis]!);
        low = Math.min(low, dot(sh.center) - sh.radius * Math.sqrt(Math.max(0, 1 - na * na)) - sh.halfLength * na);
      }
    }
  });
  return low;
}

/**
 * The ground plane of a model (DESIGN §5.1 "Ground"; null unless model.ground): normal
 * (sin θ, cos θ, 0) for a floor tilted by `slopeDeg` about +Z, and d with the plane n·x = d tangent
 * to the model's lowest ground-touching collider (lowestGroundPoint). On a level floor d is the
 * plane's height; when it agrees with groundLevel + (½ − HC) to 1e-9 (a hole or a rim is lowest) it
 * is exactly that value, so those floors are bit-identical to the first construction. The edit-mode
 * view floor and the Simulation both use this, so the drawn floor does not move at Play.
 */
export function groundPlane(model: Model, slopeDeg = 0, segments = DEFAULT_CYLINDER_SEGMENTS): { normal: Vec3; d: number } | null {
  const level = groundLevel(model);
  if (level === null) return null;
  const th = (slopeDeg * Math.PI) / 180;
  const normal: Vec3 = [Math.sin(th), Math.cos(th), 0];
  let d = lowestGroundPoint(model.parts, normal, segments);
  if (th === 0) {
    const conventional = level + (0.5 - HC);
    if (Math.abs(d - conventional) <= 1e-9) d = conventional;
  }
  return { normal, d };
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
    if (p.shape === 'disc') {
      out.push(wheelShape(w(p.center), p.axis, p.radius, p.halfLength, p.innerRadius, p.radius + RIM_COLL_INSET));
      continue;
    }
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
