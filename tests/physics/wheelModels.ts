// Models and measurements shared by the wheel / ground / free-root tests (DESIGN §5.3 "Wheels,
// ground and free root").
import { ModelBuilder, beam, cell } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Axis, Model } from '../../src/core/types';
import { RIM_COLL_INSET } from '../../src/geometry/dims';
import type { Simulation } from '../../src/physics/sim';
import type { Vec3 } from '../../src/physics/math';

/** Contact radius of a rim of nominal radius r: the round collider's radius (r − 0.04) on a floor 0.04 above the nominal level. */
export function rollRadius(r: number): number {
  return r - RIM_COLL_INSET;
}

/** One loose wheel: a pin hole at the origin with rim r about `axis`; ground on, root free. */
export function looseWheel(r: number, axis: Axis = 2): Model {
  const b = new ModelBuilder();
  b.add([makeCell(0, 0, 0, 'pinHole', axis)]);
  return setFixRoot(setGround(setRim(b.build(), 1, [0, 0, 0], r), true), false);
}

export interface CartModel {
  model: Model;
  chassis: number;
  wheels: number[];
}

/**
 * The §5.3 cart: chassis = two 7-hole beams (z = 0 and z = 2, holes along Z) joined by a pin hole
 * at (3, 0, 1); front and rear axle lines at x = 0 and x = `len` − 1, each wheel on its own axle
 * (a friction pin welded in the chassis plus a smooth pin in the wheel's hub), wheels (single pin
 * holes with rim r) at z = −1 and z = 3. Ground on, root free. Wheels turn independently: four
 * revolute joints, each carrying a quarter of the chassis.
 */
export function cart(r = 1.5, len = 7): CartModel {
  const b = new ModelBuilder();
  const x1 = len - 1;
  const mid = Math.floor(x1 / 2);
  const chassis = b.add([...beam([0, 0, 0], [x1, 0, 0]), cell([mid, 0, 1], 'pinHole', 2), ...beam([0, 0, 2], [x1, 0, 2])]);
  const wheels: number[] = [];
  for (const x of [0, x1])
    for (const [zc, zw] of [[0, -1], [2, 3]] as const) {
      b.add([makeCell(x, 0, zc, 'frictionPin', 2), makeCell(x, 0, zw, 'pin', 2)]);
      wheels.push(b.add([makeCell(x, 0, zw, 'pinHole', 2)]));
    }
  let m = b.root(chassis).build();
  for (const id of wheels) {
    const c = m.parts.find((p) => p.id === id)!.cells[0]!;
    m = setRim(m, id, [c.x, c.y, c.z], r);
  }
  return { model: setFixRoot(setGround(m, true), false), chassis, wheels };
}

/** Total mass of the live dynamic bodies. */
export function totalMass(s: Simulation): number {
  let M = 0;
  for (const b of s.graph.bodies) if (!b.fixed && s.hasBody(b.id)) M += s.massInfo(b.id)!.mass;
  return M;
}

/** Moment of inertia of a body about its centre of mass and world axis `axis`. */
export function axialInertia(s: Simulation, bodyId: number, axis: Axis): number {
  return s.massInfo(bodyId)!.inertia[axis * 4]!;
}

/** Give every dynamic body of a rolling vehicle (wheels about Z) the velocity v along +X, wheels spinning to roll. */
export function pushVehicle(s: Simulation, v: number, wheelBodies: number[], R: number): void {
  for (const b of s.graph.bodies) {
    if (b.fixed) continue;
    const w: Vec3 = wheelBodies.includes(b.id) ? [0, 0, -v / R] : [0, 0, 0];
    s.setBodyVelocity(b.id, [v, 0, 0], w);
  }
}

/** FNV-style hash of every body's pose and velocity (determinism). */
export function poseHash(s: Simulation): string {
  let h = 0x811c9dc5;
  const f = new Float64Array(1);
  const u = new Uint8Array(f.buffer);
  for (const b of s.graph.bodies) {
    const t = s.bodyTransform(b.id);
    const v = s.bodyVelocity(b.id);
    if (!t || !v) continue;
    for (const x of [...t.p, ...t.q, ...v.v, ...v.w]) {
      f[0] = x;
      for (const byte of u) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
