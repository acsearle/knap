// Shared helpers for the headless physics tests.
import { appendFileSync } from 'node:fs';
import { ModelBuilder } from '../../src/core/examples';
import type { Cell, Model } from '../../src/core/types';
import { G, Simulation } from '../../src/physics/sim';
import type { SimOptions, Transform } from '../../src/physics/sim';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';

export { G };

/** Model from parts in order (ids 1, 2, 3, …) with an explicit root part id. */
export function mk(parts: readonly (readonly Cell[])[], root: number): Model {
  const b = new ModelBuilder();
  for (const cells of parts) b.add(cells);
  return b.root(root).build();
}

export async function sim(model: Model, opts: SimOptions = {}): Promise<Simulation> {
  return Simulation.create(model, opts);
}

/** Where the edit-time world point x of body `bodyId` is now. */
export function where(s: Simulation, bodyId: number, x: Vec3): Vec3 {
  const t = s.bodyTransform(bodyId);
  if (!t) throw new Error(`body ${bodyId} removed`);
  return applyTransform(t, x);
}

/** Inverse-map a current world point into the edit-time frame of a body. */
export function toEditFrame(t: Transform, x: Vec3): Vec3 {
  return rotate(conj(t.q), sub(x, t.p));
}

/** Signed rotation angle of a transform about +Z (for planar mechanisms), radians in (−π, π]. */
export function angleZ(t: Transform): number {
  const v = rotate(t.q, [1, 0, 0]);
  return Math.atan2(v[1], v[0]);
}

/** Unwrap a sequence of angles (radians) so it is continuous. */
export function unwrap(prev: number, next: number): number {
  let d = next - prev;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return prev + d;
}

export function total(e: { kinetic: number; potential: number }): number {
  return e.kinetic + e.potential;
}

/** Max |v| (units/s) and |ω| (rad/s) over the live bodies. */
export function maxSpeeds(s: Simulation): { v: number; w: number } {
  let v = 0;
  let w = 0;
  for (const b of s.graph.bodies) {
    const bv = s.bodyVelocity(b.id);
    if (!bv) continue;
    v = Math.max(v, Math.hypot(...bv.v));
    w = Math.max(w, Math.hypot(...bv.w));
  }
  return { v, w };
}

export function isFiniteTransform(t: Transform | null): boolean {
  return t === null || [...t.p, ...t.q].every(Number.isFinite);
}

/**
 * Log a measurement (visible with `--reporter=verbose`/on failure); with PHYSICS_REPORT=<file>
 * also append it to that file.
 */
export function report(line: string): void {
  console.log(`[physics] ${line}`);
  if (process.env.PHYSICS_REPORT) appendFileSync(process.env.PHYSICS_REPORT, line + '\n');
}
