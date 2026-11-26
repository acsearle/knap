// Joint glyphs (DESIGN.md §7.4): ring = revolute, ring + double arrow = cylindrical, double arrow =
// prismatic — as world-space polylines (drawn with FatLines, on top of everything). Gear meshes get
// their own small glyph at the pitch point: two short interlocking ticks (meshGlyphSegments). Pure.
import { gearMeshes } from '../core';
import type { Axis, Model } from '../core';
import type { KinematicGraph } from '../core/kinematics';
import { add, cross, len, scale, sub } from './math';
import type { Vec3 } from './math';

export type Quat = readonly [number, number, number, number];

export interface JointGlyph {
  type: 'revolute' | 'cylindrical' | 'prismatic';
  /** A point on the joint axis (world, edit time). */
  origin: readonly [number, number, number];
  axis: Axis;
  /**
   * If set, the glyph follows this part's simulation transform (Viewport.setPartTransform);
   * jointGlyphsFromGraph uses the lowest part id of body B.
   */
  followPartId?: number;
}

/** One glyph per joint of a kinematic graph, following body B. */
export function jointGlyphsFromGraph(graph: KinematicGraph): JointGlyph[] {
  return graph.joints.map((j) => {
    const body = graph.bodies[j.bodyB];
    const g: JointGlyph = { type: j.type, origin: [j.origin[0], j.origin[1], j.origin[2]], axis: j.axis };
    if (body && body.partIds.length) g.followPartId = body.partIds[0]!;
    return g;
  });
}

export const RING_RADIUS = 0.66;
export const ARROW_HALF = 1.05;
export const ARROW_HEAD = 0.22;
const RING_SEGMENTS = 40;

/** Rotate v by unit quaternion q = [x, y, z, w]. */
export function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // t = 2·(q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

export interface RigidTransform {
  p: Vec3;
  q: Quat;
}

/**
 * Line segments [a, b] for the glyphs. `back` is the camera's back vector (arrowheads are drawn in
 * the plane facing the viewer). `transformOf(partId)` gives a part's simulation transform, if any.
 */
export function glyphSegments(glyphs: readonly JointGlyph[], back: Vec3, transformOf: (partId: number) => RigidTransform | null): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  for (const g of glyphs) {
    let o: Vec3 = [g.origin[0], g.origin[1], g.origin[2]];
    let a: Vec3 = [0, 0, 0];
    a[g.axis] = 1;
    // two unit vectors spanning the ring plane
    let u: Vec3 = [0, 0, 0];
    let v: Vec3 = [0, 0, 0];
    u[(g.axis + 1) % 3] = 1;
    v[(g.axis + 2) % 3] = 1;
    const t = g.followPartId !== undefined ? transformOf(g.followPartId) : null;
    if (t) {
      o = add(rotateByQuat(t.q, o), t.p);
      a = rotateByQuat(t.q, a);
      u = rotateByQuat(t.q, u);
      v = rotateByQuat(t.q, v);
    }
    if (g.type !== 'prismatic') {
      let prev: Vec3 | null = null;
      for (let i = 0; i <= RING_SEGMENTS; i++) {
        const th = (i / RING_SEGMENTS) * Math.PI * 2;
        const p = add(o, add(scale(u, RING_RADIUS * Math.cos(th)), scale(v, RING_RADIUS * Math.sin(th))));
        if (prev) out.push([prev, p]);
        prev = p;
      }
    }
    if (g.type !== 'revolute') {
      const tip1 = add(o, scale(a, ARROW_HALF));
      const tip2 = add(o, scale(a, -ARROW_HALF));
      out.push([tip2, tip1]);
      let perp = cross(a, back);
      const l = len(perp);
      perp = l > 1e-3 ? scale(perp, 1 / l) : u;
      for (const [tip, s] of [[tip1, 1], [tip2, -1]] as const) {
        const baseP = add(tip, scale(a, -s * ARROW_HEAD));
        out.push([tip, add(baseP, scale(perp, ARROW_HEAD * 0.6))]);
        out.push([tip, add(baseP, scale(perp, -ARROW_HEAD * 0.6))]);
      }
    }
  }
  return out;
}

// ---- gear meshes (§7.4: "Each gear mesh gets a small glyph at its pitch point") -----------------

/**
 * One gear mesh (§2.7) to mark: the two hubs (world, edit time), their pitch radii and the common
 * axis. The glyph sits at the pitch point hubA + (hubB − hubA)·rA/(rA + rB), in the gears' plane.
 * With followA / followB it follows those parts' simulation transforms (both hubs are carried, so
 * the point stays between them as the gears turn; the axis turns with part A).
 */
export interface MeshGlyph {
  hubA: readonly [number, number, number];
  hubB: readonly [number, number, number];
  rA: number;
  rB: number;
  axis: Axis;
  followA?: number;
  followB?: number;
}

/** One glyph per edit-time gear mesh of the model (core gearMeshes), following the two gears' parts. */
export function meshGlyphsFromModel(m: Model): MeshGlyph[] {
  return gearMeshes(m).map((g) => ({
    hubA: [g.a.cell.x, g.a.cell.y, g.a.cell.z],
    hubB: [g.b.cell.x, g.b.cell.y, g.b.cell.z],
    rA: g.a.cell.rim!,
    rB: g.b.cell.rim!,
    axis: g.axis,
    followA: g.a.partId,
    followB: g.b.partId,
  }));
}

/** How far each tick reaches back toward its own hub from the pitch point (units). */
export const MESH_TICK_BACK = 0.36;
/** How far each tick reaches past the pitch point toward the other gear (units). */
export const MESH_TICK_OVER = 0.14;
/** Half the spacing of the two ticks, along the pitch-circle tangent (units). */
export const MESH_TICK_GAP = 0.1;

/** World pitch point and frame (c: unit hub A → hub B, t: tangent, a: axis) of a mesh glyph; null if degenerate. */
export function meshGlyphFrame(g: MeshGlyph, transformOf: (partId: number) => RigidTransform | null): { p: Vec3; c: Vec3; t: Vec3; a: Vec3 } | null {
  let A: Vec3 = [g.hubA[0], g.hubA[1], g.hubA[2]];
  let B: Vec3 = [g.hubB[0], g.hubB[1], g.hubB[2]];
  let a: Vec3 = [0, 0, 0];
  a[g.axis] = 1;
  const ta = g.followA !== undefined ? transformOf(g.followA) : null;
  const tb = g.followB !== undefined ? transformOf(g.followB) : null;
  if (ta) {
    A = add(rotateByQuat(ta.q, A), ta.p);
    a = rotateByQuat(ta.q, a);
  }
  if (tb) B = add(rotateByQuat(tb.q, B), tb.p);
  const d = sub(B, A);
  // in the plane of the gears
  const along = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  const dp = sub(d, scale(a, along));
  const L = len(dp);
  if (!(L > 1e-6) || !(g.rA + g.rB > 0)) return null;
  const c = scale(dp, 1 / L);
  const p = add(A, add(scale(c, (L * g.rA) / (g.rA + g.rB)), scale(a, along * (g.rA / (g.rA + g.rB)))));
  return { p, c, t: cross(a, c), a };
}

/**
 * Segments of the mesh glyphs: at each pitch point two short parallel ticks along the line of
 * centres, a tangential gap apart, one reaching from gear A's side past the pitch point and one from
 * gear B's side (they overlap like two meshing teeth). Same world-size idiom as the joint glyphs.
 */
export function meshGlyphSegments(glyphs: readonly MeshGlyph[], transformOf: (partId: number) => RigidTransform | null): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  for (const g of glyphs) {
    const f = meshGlyphFrame(g, transformOf);
    if (!f) continue;
    const { p, c, t } = f;
    for (const s of [1, -1]) {
      // s = 1: gear A's tick (from A's side, offset +t); s = −1: gear B's (from B's side, offset −t)
      const o = add(p, scale(t, s * MESH_TICK_GAP));
      out.push([add(o, scale(c, -s * MESH_TICK_BACK)), add(o, scale(c, s * MESH_TICK_OVER))]);
    }
  }
  return out;
}
