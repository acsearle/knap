// Spike "wheels": shared helpers. Plain Rapier world with the settings of src/physics/sim.ts
// (fixedDt 1/480, 1 PGS iteration, hard CCD off, lengthUnit 1, friction 0.4, restitution 0.1,
// density 1, no damping, no sleeping). Wheels have their axis along world Z and roll along X; the
// ground's top surface is y = 0 unless stated. Inclines are modelled by tilting gravity by θ about
// Z (down-slope = +X), which is exactly equivalent to tilting the ground.
import RAPIER from '@dimforge/rapier3d-compat';
import type { ColliderDesc, RigidBody, World } from '@dimforge/rapier3d-compat';
import { prismShape, partShapes } from '../../src/physics/shapes';
import { beam } from '../../src/core/examples';
import type { Part } from '../../src/core/types';

export { RAPIER };
export const G = 1226.25;
export const DT = 1 / 480;
export const SPEED_CAP = 400;
export const FRICTION = 0.4;
export const RESTITUTION = 0.1;

export async function init(): Promise<void> {
  await RAPIER.init();
}

export function makeWorld(iterations: number, thetaDeg = 0): World {
  const th = (thetaDeg * Math.PI) / 180;
  const w = new RAPIER.World({ x: G * Math.sin(th), y: -G * Math.cos(th), z: 0 });
  w.timestep = DT;
  w.numSolverIterations = iterations;
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = 0;
  return w;
}

/** Quaternion rotating local +Y onto world +Z (cylinder colliders are built along Y). */
export const Y_TO_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

export type WheelKind = 'cyl' | 'rcyl' | 'p16' | 'p32' | 'p48' | 'p64' | 'rp16' | 'rp32' | 'rp64' | 'b16' | 'b32' | 'b64' | 'hyb';

/**
 * Collision groups for the hybrid wheel (Rapier InteractionGroups = membership << 16 | filter; a
 * pair interacts iff each one's membership meets the other's filter):
 *   GROUND (bit 0)  — the ground half-space / cuboid: meets ROUND and PARTS
 *   ROUND  (bit 1)  — a wheel's native cylinder: meets GROUND and other ROUND (wheel–wheel drives)
 *   HULL   (bit 2)  — a wheel's convex prism: meets PARTS only
 *   PARTS  (bit 3)  — every other collider (liftarms, pins, …): meets GROUND, HULL, PARTS
 */
export const GRP = {
  GROUND: (0x1 << 16) | (0x2 | 0x8),
  ROUND: (0x2 << 16) | (0x1 | 0x2),
  HULL: (0x4 << 16) | 0x8,
  PARTS: (0x8 << 16) | (0x1 | 0x4 | 0x8),
};
/** Axial pull-in of the non-kept cap vertices of the bN prisms (env WHEEL_BEVEL, default 0.05). */
export const HULL_ORIGIN = process.env.HULL_ORIGIN ?? 'centre';
export const WHEEL_BEVEL = Number(process.env.WHEEL_BEVEL ?? 0.05);

/**
 * Circumscribed n-gon prism along Z (inradius r, half-length h), as shapes.ts builds cylinders but
 * with a configurable bevel: four rim vertices nearest ±56.25° / 180° ± 56.25° stay at ±h, the rest
 * at ±(h − bevel). Returns hull points and the un-bevelled prism's mass properties (density 1).
 */
export function bevelPrism(r: number, h: number, n: number, bevel: number): { pts: Float32Array; volume: number; inertia: [number, number, number] } {
  const R = r / Math.cos(Math.PI / n);
  let best = 0;
  for (let i = 0; i < n / 4; i++) if (Math.abs(((i + 0.5) / n) * 360 - 56.25) < Math.abs(((best + 0.5) / n) * 360 - 56.25)) best = i;
  const keep = new Set([best, n / 2 - 1 - best, n / 2 + best, n - 1 - best]);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * 2 * Math.PI;
    for (const s of [-1, 1]) pts.push(R * Math.cos(a), R * Math.sin(a), s * (keep.has(i) ? h : h - bevel));
  }
  // regular n-gon of circumradius R: area A = ½ n R² sin(2π/n); polar second moment J = A R² (2 + cos(2π/n)) / 6
  const A = 0.5 * n * R * R * Math.sin((2 * Math.PI) / n);
  const L = 2 * h;
  const J = (A * R * R * (2 + Math.cos((2 * Math.PI) / n))) / 6;
  const volume = A * L;
  const Ixx = (J / 2) * L + (volume * L * L) / 12;
  return { pts: new Float32Array(pts), volume, inertia: [Ixx, Ixx, J * L] };
}
export const ROUND_BORDER = 0.05;

/** Collider desc(s) of a wheel of radius r, 1 unit thick, axis +Z in body frame, centred at the origin. */
export function wheelColliders(kind: WheelKind, r: number, at: [number, number, number] = [0, 0, 0]): ColliderDesc[] {
  let cd: ColliderDesc;
  if (kind === 'hyb') {
    // Hybrid: native cylinder for the ground and other wheels (rolls exactly), bevelled 32-gon prism
    // for every other part (robust against hulls). Mass from the cylinder only.
    const c = RAPIER.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z).setDensity(1).setCollisionGroups(GRP.ROUND);
    const p = bevelPrism(r, 0.5, 32, WHEEL_BEVEL);
    const h = RAPIER.ColliderDesc.convexHull(p.pts)!.setDensity(0).setCollisionGroups(GRP.HULL);
    for (const d of [c, h]) d.setTranslation(at[0], at[1], at[2]).setFriction(FRICTION).setRestitution(RESTITUTION);
    return [c, h];
  }
  if (kind.startsWith('b')) {
    const p = bevelPrism(r, 0.5, Number(kind.slice(1)), WHEEL_BEVEL);
    cd = RAPIER.ColliderDesc.convexHull(p.pts)!;
    cd.setMassProperties(p.volume, { x: 0, y: 0, z: 0 }, { x: p.inertia[0], y: p.inertia[1], z: p.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
  } else if (kind === 'cyl') cd = RAPIER.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z);
  else if (kind === 'rcyl') cd = RAPIER.ColliderDesc.roundCylinder(0.5 - ROUND_BORDER, r - ROUND_BORDER, ROUND_BORDER).setRotation(Y_TO_Z);
  else {
    // pN: bevelled circumscribed N-gon prism exactly as shapes.ts builds cylinders.
    // rpN: the same prism shrunk by ROUND_BORDER and rounded by it (Rapier roundConvexHull), so its
    //      flat faces are still tangent to the radius-r circle and its corners are arcs of radius b.
    const round = kind.startsWith('r');
    const n = Number(kind.slice(round ? 2 : 1));
    const b = round ? ROUND_BORDER : 0;
    const sh = prismShape([0, 0, 0], 2, r - b, 0.5 - b, n, 0);
    const full = prismShape([0, 0, 0], 2, r, 0.5, n, 0);
    if (full.kind !== 'hull') throw new Error('hull expected');
    if (sh.kind !== 'hull') throw new Error('hull expected');
    const pts = new Float32Array(sh.points.length * 3);
    sh.points.forEach((q, i) => pts.set(q, i * 3));
    const d = round ? RAPIER.ColliderDesc.roundConvexHull(pts, b) : RAPIER.ColliderDesc.convexHull(pts);
    if (!d) throw new Error('hull failed');
    const mp = full.mass;
    d.setMassProperties(mp.volume, { x: mp.com[0], y: mp.com[1], z: mp.com[2] }, { x: mp.inertia[0], y: mp.inertia[1], z: mp.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
    cd = d;
  }
  cd.setTranslation(at[0], at[1], at[2]);
  cd.setFriction(FRICTION).setRestitution(RESTITUTION);
  if (kind === 'cyl' || kind === 'rcyl') cd.setDensity(1);
  return [cd];
}

export function addWheel(w: World, kind: WheelKind, r: number, pos: [number, number, number], opts: { rot?: { x: number; y: number; z: number; w: number }; extraIters?: number; softCcd?: boolean } = {}): RigidBody {
  const desc = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(pos[0], pos[1], pos[2]);
  if (opts.rot) desc.setRotation(opts.rot);
  if (opts.extraIters) desc.setAdditionalSolverIterations(opts.extraIters);
  const rb = w.createRigidBody(desc);
  for (const cd of wheelColliders(kind, r)) w.createCollider(cd, rb);
  // soft CCD as sim.ts gives unjointed bodies (env CCD=0 turns it off for comparison)
  if (opts.softCcd ?? process.env.CCD !== '0') rb.setSoftCcdPrediction(SPEED_CAP * DT * 1.25);
  return rb;
}

export type GroundKind = 'half' | 'box' | 'armFlat' | 'armEdge';

/**
 * Fixed ground whose top is y = top over x ∈ [x0, x0 + length]:
 *  half    — half-space (infinite)
 *  box     — one cuboid, half-height 1
 *  armFlat — liftarms of `seg` holes lying flat (holes along Y) end to end along X: separate parts,
 *            so there is a seam (the two rounded ends) every `seg` units
 *  armEdge — liftarms on edge (holes along Z), top = their flat web side, seams likewise
 */
export function addGround(w: World, kind: GroundKind, x0 = -20, length = 400, top = 0, seg = 15): void {
  const rb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const grp = kind === 'half' || kind === 'box' ? GRP.GROUND : GRP.PARTS;
  const fin = (cd: ColliderDesc) => w.createCollider(cd.setFriction(FRICTION).setRestitution(RESTITUTION).setCollisionGroups(grp), rb);
  if (kind === 'half') {
    fin(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, top, 0));
  } else if (kind === 'box') {
    fin(RAPIER.ColliderDesc.cuboid(length / 2, 1, 50).setTranslation(x0 + length / 2, top - 1, 0));
  } else {
    const HC = 0.46;
    // ARM_ROWS rows side by side in z (default 5: z = −2 … 2, a floor 5 units wide; 1 = a single
    // 0.92-wide rail, off which a bouncing or tipping wheel simply falls)
    const rows = Number(process.env.ARM_ROWS ?? 5);
    for (let zr = -Math.floor(rows / 2); zr <= Math.floor((rows - 1) / 2); zr++)
    for (let x = Math.ceil(x0), id = 1; x < x0 + length; x += seg, id++) {
      const holeAxis = kind === 'armFlat' ? 1 : 2;
      const part: Part = { id, color: '#888888', cells: beam([x, 0, zr], [x + seg - 1, 0, zr], holeAxis) };
      for (const sh of partShapes(part, 16)) {
        if (sh.kind !== 'hull') throw new Error('unexpected box');
        // HULL_ORIGIN=world: points in the ground body's frame (origin at x = 0, far outside most
        // beams); default 'centre': each hull's points relative to its own centroid, collider
        // translated there (as sim.ts does relative to the body's mean cell centre).
        const ctr = [0, 0, 0];
        if (HULL_ORIGIN !== 'world') {
          for (const q of sh.points) for (let k = 0; k < 3; k++) ctr[k]! += q[k]! / sh.points.length;
        }
        const pts = new Float32Array(sh.points.length * 3);
        sh.points.forEach((q, i) => pts.set([q[0] - ctr[0]!, q[1] - ctr[1]!, q[2] - ctr[2]!], i * 3));
        fin(RAPIER.ColliderDesc.convexHull(pts)!.setTranslation(ctr[0]!, ctr[1]! + top - HC, ctr[2]!));
      }
    }
  }
}

/** World inertia tensor (row-major) of a body. */
export function worldInertia(rb: RigidBody): number[] {
  const q = rb.rotation();
  const f = rb.principalInertiaLocalFrame();
  const qf = qmul([q.x, q.y, q.z, q.w], [f.x, f.y, f.z, f.w]);
  const d = rb.principalInertia();
  const D = [d.x, d.y, d.z];
  const cols = [rot(qf, [1, 0, 0]), rot(qf, [0, 1, 0]), rot(qf, [0, 0, 1])];
  const I: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I.push(cols.reduce((s, e, k) => s + D[k]! * e[r]! * e[c]!, 0));
  return I;
}

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export function qmul(a: Q4, b: Q4): Q4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function rot(q: Q4, v: V3): V3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
/** Body's local +Z (the wheel axis) in world coordinates. */
export function axisOf(rb: RigidBody, local: V3 = [0, 0, 1]): V3 {
  const q = rb.rotation();
  return rot([q.x, q.y, q.z, q.w], local);
}

export function stats(a: number[]): { mean: number; std: number; min: number; max: number } {
  const n = a.length;
  const mean = a.reduce((s, x) => s + x, 0) / n;
  const std = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  return { mean, std, min: Math.min(...a), max: Math.max(...a) };
}

/** Least-squares slope of y over x. */
export function slope(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  return sxy / sxx;
}

export function fmt(x: number, d = 3): string {
  if (!Number.isFinite(x)) return String(x);
  if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5)) return x.toExponential(2);
  return x.toFixed(d);
}

export function now(): number {
  return performance.now();
}

/** FNV-1a over the f32 bits of a body's pose and velocities (determinism check). */
export function poseHash(bodies: RigidBody[]): string {
  const f = new Float32Array(13 * bodies.length);
  bodies.forEach((b, i) => {
    const t = b.translation();
    const q = b.rotation();
    const v = b.linvel();
    const a = b.angvel();
    f.set([t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, a.x, a.y, a.z], i * 13);
  });
  const u = new Uint8Array(f.buffer);
  let h = 0x811c9dc5;
  for (const b of u) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16);
}
