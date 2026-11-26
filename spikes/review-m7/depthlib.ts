// Wheel-in-beam depth probe shared by limits.test.ts and upright.test.ts.
import type { Axis, Cell } from '../../src/core/types';
import type { Simulation } from '../../src/physics/sim';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';

const HC = 0.46;

/** Straight beam description: from/to cell centres (one axis differs), hole axis. */
export interface BeamRef { a: Vec3; b: Vec3; hole: Axis; part: number }

/** Deepest point of the wheel (hub cell w, collider radius r−0.04, ±HC) inside the beam's collision stadium (±HC thick, HC round). */
export function depth(s: Simulation, w: Cell, wPart: number, bm: BeamRef): number {
  const tw = s.partTransform(wPart);
  const tb = s.partTransform(bm.part);
  if (!tw || !tb) return NaN;
  const R = w.rim! - 0.04;
  const u = ((w.axis + 1) % 3) as Axis;
  const v = ((w.axis + 2) % 3) as Axis;
  let worst = -Infinity;
  const h = bm.hole;
  for (const k of [0.4, 0.7, 0.85, 1])
    for (let i = 0; i < 64; i++)
      for (const ax of [-HC, -HC / 2, 0, HC / 2, HC]) {
        const q: Vec3 = [w.x, w.y, w.z];
        q[u] += R * k * Math.cos((i / 64) * 2 * Math.PI);
        q[v] += R * k * Math.sin((i / 64) * 2 * Math.PI);
        q[w.axis] += ax;
        const e = rotate(conj(tb.q), sub(applyTransform(tw, q), tb.p)); // beam edit frame
        // distance from e to segment a–b in the plane ⟂ hole axis
        const ab = sub(bm.b, bm.a);
        const ae = sub(e, bm.a);
        ab[h] = 0;
        ae[h] = 0;
        const L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
        const t = L2 > 0 ? Math.max(0, Math.min(1, (ae[0] * ab[0] + ae[1] * ab[1] + ae[2] * ab[2]) / L2)) : 0;
        const dvec = [ae[0] - t * ab[0], ae[1] - t * ab[1], ae[2] - t * ab[2]];
        const dist = Math.hypot(dvec[0]!, dvec[1]!, dvec[2]!);
        worst = Math.max(worst, Math.min(HC - dist, HC - Math.abs(e[h] - bm.a[h])));
      }
  return worst;
}

