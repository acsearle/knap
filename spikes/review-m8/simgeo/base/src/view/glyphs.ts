// Joint glyphs (DESIGN.md §7.4): ring = revolute, ring + double arrow = cylindrical, double arrow =
// prismatic — as world-space polylines (drawn with FatLines, on top of everything). Pure.
import type { Axis } from '../core';
import type { KinematicGraph } from '../core/kinematics';
import { add, cross, len, scale } from './math';
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
