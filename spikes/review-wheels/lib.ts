// Shared helpers for the review sweeps (adversarial review "sim" of wheels, ground, free root).
import { appendFileSync } from 'node:fs';
import type { Model, Part, Axis } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import type { SimOptions } from '../../src/physics/sim';
import { applyTransform } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { partShapes } from '../../src/physics/shapes';

export const LOGDIR = 'e2e/out/review-sim';
export function logger(name: string) {
  return (...a: unknown[]) => {
    const line = a.map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? fmt(x) : JSON.stringify(x))).join(' ');
    appendFileSync(`${LOGDIR}/${name}.log`, line + '\n');
  };
}
export function fmt(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const a = Math.abs(x);
  return a >= 1e4 || a < 1e-3 ? x.toExponential(2) : x.toFixed(4);
}

/** Collider points (edit-time world) of a part: hull vertices, box corners and the round collider of a wheel sampled at 64 angles. */
export function shapePoints(part: Part): Vec3[] {
  const out: Vec3[] = [];
  for (const sh of partShapes(part, 16)) {
    if (sh.kind === 'hull') out.push(...sh.points);
    else if (sh.kind === 'wheel') {
      const a = sh.axis;
      const u = ((a + 1) % 3) as Axis;
      const v = ((a + 2) % 3) as Axis;
      for (let i = 0; i < 64; i++)
        for (const s of [-1, 1]) {
          const p: Vec3 = [...sh.center];
          p[u] += sh.radius * Math.cos((i / 64) * 2 * Math.PI);
          p[v] += sh.radius * Math.sin((i / 64) * 2 * Math.PI);
          p[a] += s * sh.halfLength;
          out.push(p);
        }
    } else
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1])
            out.push([sh.center[0] + sx * sh.halfExtents[0], sh.center[1] + sy * sh.halfExtents[1], sh.center[2] + sz * sh.halfExtents[2]]);
  }
  return out;
}

export class Probe {
  pts = new Map<number, Vec3[]>(); // body id -> points
  constructor(public s: Simulation, m: Model) {
    for (const p of m.parts) {
      const b = s.bodyOf(p.id)!;
      const l = this.pts.get(b) ?? [];
      l.push(...shapePoints(p));
      this.pts.set(b, l);
    }
  }
  /** Lowest point of a body now (y), Infinity if removed. */
  low(b: number): number {
    const t = this.s.bodyTransform(b);
    if (!t) return Infinity;
    let lo = Infinity;
    for (const q of this.pts.get(b)!) lo = Math.min(lo, applyTransform(t, q)[1]);
    return lo;
  }
  /** Lowest point over all dynamic bodies. */
  lowAll(): number {
    let lo = Infinity;
    for (const b of this.s.graph.bodies) if (!b.fixed) lo = Math.min(lo, this.low(b.id));
    return lo;
  }
}

export async function make(m: Model, o: SimOptions = {}) {
  return Simulation.create(m, o);
}

export function com(s: Simulation, b: number): Vec3 {
  return s.massInfo(b)!.com;
}
export const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function kinetic(s: Simulation): number {
  return s.energy().kinetic;
}
export function totalE(s: Simulation): number {
  const e = s.energy();
  return e.kinetic + e.potential;
}
export function removedCount(s: Simulation): number {
  return s.graph.bodies.filter((b) => !b.fixed && !s.hasBody(b.id)).length;
}
export function maxSpeed(s: Simulation): { v: number; w: number } {
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
