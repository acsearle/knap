// Spike "teeth": shared geometry, world construction and measurement helpers.
// Headless, directly against @dimforge/rapier3d-compat 0.21.0, with the settings of
// src/physics/sim.ts (fixedDt 1/480, 240 solver iterations for jointed bodies, 30 for the world,
// 1 PGS iteration, hard CCD off, lengthUnit 1, friction 0.4, restitution 0.1, density 1,
// joint friction motor μ = 0.2 on pivots). Not product code.
import RAPIER from '@dimforge/rapier3d-compat';
import { prismShape } from '../../src/physics/shapes';

export { RAPIER };
export const G = 1226.25;
export const DT = 1 / 480;
export const ITER = 240;
export const BASE_ITER = 30;
export const FRICTION = 0.4;
export const RESTITUTION = 0.1;
export const HC = 0.46; // hole collider radius / half-thickness
export const ROD = 0.29; // male collider radius
export const R_BORE = 0.31;
export const PIVOT_MU = 0.2; // project default joint friction ("realistic")
export const FRICTION_GAIN = 1e9;
const ANG_X = 3; // raw JointAxis.AngX (sim.ts)

// ---------------------------------------------------------------------------------------------
// Collision groups (proposed layout). InteractionGroups = (membership << 16) | filter.
export const GRP = {
  TOOTH: 1 << 0, // gear teeth + root hub: seen by ordinary parts only
  GEARCYL: 1 << 1, // gear-vs-gear smooth cylinder just under pitch radius: seen by other gears only
  PART: 1 << 2, // every ordinary part collider
};
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const G_TOOTH = groups(GRP.TOOTH, GRP.PART);
export const G_GEARCYL = groups(GRP.GEARCYL, GRP.GEARCYL);
export const G_PART = groups(GRP.PART, GRP.PART | GRP.TOOTH);

// ---------------------------------------------------------------------------------------------
// Gear geometry (2D, gear frame: axis +Z, angle from +X)

export type Profile = 'trap' | 'saw';
export interface GearSpec {
  r: number; // pitch radius (units)
  T: number; // teeth
  m: number; // module (units)
  add: number; // addendum
  ded: number; // dedendum
  profile: Profile;
  name: string;
}
/** Fine: module 1 mm = 0.125 u, T = 16 r. Coarse: module 0.25 u, T = 8 r (same ratios). */
export function gearSpec(r: number, set: 'fine' | 'coarse', profile: Profile = 'trap'): GearSpec {
  const m = set === 'fine' ? 0.125 : 0.25;
  const T = Math.round((2 * r) / m);
  return { r, T, m, add: m, ded: 1.25 * m, profile, name: `${set}-${profile} r${r} T${T}` };
}
export const tipR = (g: GearSpec) => g.r + g.add;
export const rootR = (g: GearSpec) => g.r - g.ded;
export const pitchAngle = (g: GearSpec) => (2 * Math.PI) / g.T;

export type P2 = [number, number];
const PA = (20 * Math.PI) / 180;

/** Root polygon: circumscribed T-gon (faces tangent to the root circle at the gap centres k·Δ). */
export function rootPoly(g: GearSpec): P2[] {
  const n = Math.max(g.T, 4);
  const R = rootR(g) / Math.cos(Math.PI / n);
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * 2 * Math.PI;
    out.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return out;
}

/** Tooth k as a CCW convex quad (2D). trap: symmetric 20° flanks centred at (k+½)Δ. saw: base on
 *  the root polygon edge [(k+½)Δ, (k+1½)Δ], radial flank at its +θ end, sloping flank at −θ. */
export function toothPoly(g: GearSpec, k: number): P2[] {
  const D = pitchAngle(g);
  const rt = tipR(g);
  const rr = rootR(g);
  if (g.profile === 'trap') {
    const p = g.m * Math.PI;
    const w = (rho: number) => p / 4 - (rho - g.r) * Math.tan(PA);
    const rb = rr - 0.03; // sink the base into the root polygon
    const c = (k + 0.5) * D;
    const loc: P2[] = [
      [rb, -w(rb)],
      [rt, -w(rt)],
      [rt, w(rt)],
      [rb, w(rb)],
    ];
    return loc.map(([x, y]) => [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]);
  }
  const Rv = rr / Math.cos(Math.PI / g.T) - 0.02;
  const A = (k + 0.5) * D;
  const B = (k + 1.5) * D;
  const land = 0.04 / rt;
  const pol = (rho: number, a: number): P2 => [rho * Math.cos(a), rho * Math.sin(a)];
  return [pol(Rv, B), pol(Rv, A), pol(rt, B - land), pol(rt, B)];
}

export function gearPolys2D(g: GearSpec): P2[][] {
  const out = [rootPoly(g)];
  for (let k = 0; k < g.T; k++) out.push(toothPoly(g, k));
  return out;
}

const prism2D = (poly: P2[], hz: number) => {
  const pts = new Float32Array(poly.length * 6);
  poly.forEach(([x, y], i) => {
    pts.set([x, y, -hz], i * 6);
    pts.set([x, y, hz], i * 6 + 3);
  });
  return pts;
};

/** Hull points of the bevelled root prism (shapes.ts prismShape with T segments). */
function rootHull(g: GearSpec): Float32Array {
  const n = Math.max(g.T, 4);
  const sh = prismShape([0, 0, 0], 2, rootR(g), HC, n, 0);
  if (sh.kind !== 'hull') throw new Error('hull');
  const pts = new Float32Array(sh.points.length * 3);
  sh.points.forEach((q, i) => pts.set(q, i * 3));
  return pts;
}

export type GearColliders = 'teeth' | 'compound' | 'cylinder' | 'root';

/**
 * Collider descriptors of a gear (body frame = gear centre, axis +Z).
 * teeth: bevelled root T-gon prism + T tooth prisms (8 vertices each, all faces ≤ 4 vertices), one
 *        collider each, group TOOTH; plus the smooth gear-vs-gear cylinder (group GEARCYL).
 * compound: the same convex pieces as ONE compound collider.
 * cylinder: a single bevelled 16-gon prism at the tip radius (a plain wheel), group PART.
 */
export function gearColliderDescs(g: GearSpec, kind: GearColliders, withGearCyl = true): any[] {
  const out: any[] = [];
  if (kind === 'cylinder' || kind === 'root') {
    const R = kind === 'cylinder' ? tipR(g) : rootR(g);
    const sh = prismShape([0, 0, 0], 2, R, HC, 16, 0);
    const pts = new Float32Array((sh as any).points.flat());
    out.push(RAPIER.ColliderDesc.convexHull(pts)!.setCollisionGroups(G_PART).setDensity(1));
    return out.map(fin);
  }
  const hulls: Float32Array[] = [rootHull(g)];
  for (let k = 0; k < g.T; k++) hulls.push(prism2D(toothPoly(g, k), HC));
  if (kind === 'teeth') {
    for (const h of hulls) {
      const d = RAPIER.ColliderDesc.convexHull(h);
      if (!d) throw new Error('hull failed');
      out.push(d.setCollisionGroups(G_TOOTH).setDensity(1));
    }
  } else {
    const shapes = hulls.map((h) => new RAPIER.ConvexPolyhedron(h, null));
    const id = { x: 0, y: 0, z: 0, w: 1 };
    out.push(RAPIER.ColliderDesc.compound(shapes, shapes.map(() => ({ x: 0, y: 0, z: 0 })), shapes.map(() => id)).setCollisionGroups(G_TOOTH).setDensity(1));
  }
  if (withGearCyl) {
    const sh = prismShape([0, 0, 0], 2, g.r - 0.02, HC, 16, 0);
    out.push(RAPIER.ColliderDesc.convexHull(new Float32Array((sh as any).points.flat()))!.setCollisionGroups(G_GEARCYL).setDensity(0));
  }
  return out.map(fin);
}
function fin(d: any) {
  return d.setFriction(FRICTION).setRestitution(RESTITUTION);
}

// ---------------------------------------------------------------------------------------------
// Pawls (body frame at the pivot, arm along local +X, rotated by α about Z)

export type PawlKind = 'end' | 'rod' | 'corner' | 'side';
/** a 'end': liftarm of ℓ+1 holes, pivot at hole 0, round end (radius HC) touches the gear.
 *  b 'rod': liftarm one layer up (z = +1), carrying a pin/axle rod (radius ROD) at hole ℓ that
 *           reaches down through the gear's layer.
 *  c 'corner': liftarm whose last cell (hole ℓ) is a hole with its axis along the arm: square end.
 *  'side': same as 'end' (the straight flank is what touches, decided by geometry). */
export function pawlColliderDescs(kind: PawlKind, l: number): any[] {
  const out: any[] = [];
  const hull = (sh: any) => RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat()))!;
  if (kind === 'end' || kind === 'side') {
    out.push(hull(prismShape([0, 0, 0], 2, HC, HC, 16, 0, l)));
  } else if (kind === 'rod') {
    out.push(hull(prismShape([0, 0, 1], 2, HC, HC, 16, 0, l)));
    // rod: world z from −0.48 to 1.5 (one cell in the arm's hole, one free cell in the gear layer)
    out.push(hull(prismShape([l, 0, 0.51], 2, ROD, 0.99, 16, 0)));
  } else {
    if (l - 1 > 0) out.push(hull(prismShape([0, 0, 0], 2, HC, HC, 16, 0, l - 1)));
    else out.push(hull(prismShape([0, 0, 0], 2, HC, HC, 16, 0)));
    out.push(RAPIER.ColliderDesc.cuboid(0.25, HC, HC).setTranslation(l - 1 + 0.25, 0, 0));
    out.push(hull(prismShape([l - 0.02, 0, 0], 0, HC, 0.48, 16, 1)));
  }
  return out.map((d) => d.setCollisionGroups(G_PART).setDensity(1).setFriction(FRICTION).setRestitution(RESTITUTION));
}

// ---------------------------------------------------------------------------------------------
// World

export interface WorldOpts {
  ccd?: 'off' | 'hard' | 'soft';
}
export function makeWorld(o: WorldOpts = {}): any {
  const w = new RAPIER.World({ x: 0, y: -G, z: 0 });
  w.timestep = DT;
  w.numSolverIterations = BASE_ITER;
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = o.ccd === 'hard' ? 1 : 0;
  // Rapier's contact softness (default 30 Hz, which sim.ts keeps). NF=<Hz> in the environment overrides it.
  if (process.env.NF) w.integrationParameters.contact_natural_frequency = Number(process.env.NF);
  return w;
}

export function fixedBody(w: any): any {
  return w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
}

/** Dynamic body at p (rotation α about Z), jointed (extra solver iterations), with colliders. */
export function jointedBody(w: any, p: [number, number, number], alpha: number, descs: any[]): any {
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      .setTranslation(p[0], p[1], p[2])
      .setRotation({ x: 0, y: 0, z: Math.sin(alpha / 2), w: Math.cos(alpha / 2) })
      .setAdditionalSolverIterations(ITER - BASE_ITER),
  );
  for (const d of descs) w.createCollider(d, rb);
  decoupleZ(rb);
  return rb;
}

/** Revolute about world Z through `at` between fixed body f and body b. */
export function revoluteZ(w: any, f: any, b: any, at: [number, number, number]): any {
  const ft = f.translation();
  const bt = b.translation();
  const bq = b.rotation();
  // anchor in b's local frame: R(b)^-1 (at − bt)
  const d = { x: at[0] - bt.x, y: at[1] - bt.y, z: at[2] - bt.z };
  const ang = 2 * Math.atan2(bq.z, bq.w);
  const c = Math.cos(-ang);
  const s = Math.sin(-ang);
  const loc = { x: c * d.x - s * d.y, y: s * d.x + c * d.y, z: d.z };
  const data = RAPIER.JointData.revolute({ x: at[0] - ft.x, y: at[1] - ft.y, z: at[2] - ft.z }, loc, { x: 0, y: 0, z: 1 });
  const j = w.createImpulseJoint(data, f, b, true);
  j.setContactsEnabled(false);
  return j;
}

/** Joint friction as in sim.ts (velocity motor, target 0, torque limit), without its stiction logic. */
export function frictionMotor(w: any, j: any, torque: number): void {
  const raw = w.impulseJoints.raw;
  raw.jointConfigureMotorModel(j.handle, ANG_X, 0);
  raw.jointConfigureMotorVelocity(j.handle, ANG_X, 0, FRICTION_GAIN);
  raw.jointSetMotorMaxForce(j.handle, ANG_X, torque);
}
/** Velocity drive on a revolute (a motor with a torque limit). */
export function velocityMotor(w: any, j: any, omega: number, maxTorque: number): void {
  const raw = w.impulseJoints.raw;
  raw.jointConfigureMotorModel(j.handle, ANG_X, 0);
  raw.jointConfigureMotorVelocity(j.handle, ANG_X, omega, FRICTION_GAIN);
  raw.jointSetMotorMaxForce(j.handle, ANG_X, maxTorque);
}

/** Drop products of inertia with Z (as sim.ts decoupleInertia for single-axis mechanisms). */
export function decoupleZ(rb: any): void {
  const qf = rb.principalInertiaLocalFrame();
  const d = rb.principalInertia();
  const q = [qf.x, qf.y, qf.z, qf.w];
  const rot = (v: number[]) => {
    const [x, y, z, ww] = q as [number, number, number, number];
    const tx = 2 * (y * v[2]! - z * v[1]!);
    const ty = 2 * (z * v[0]! - x * v[2]!);
    const tz = 2 * (x * v[1]! - y * v[0]!);
    return [v[0]! + ww * tx + (y * tz - z * ty), v[1]! + ww * ty + (z * tx - x * tz), v[2]! + ww * tz + (x * ty - y * tx)];
  };
  const cols = [rot([1, 0, 0]), rot([0, 1, 0]), rot([0, 0, 1])];
  const dv = [d.x, d.y, d.z];
  const I: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I.push(cols.reduce((s, e, k) => s + dv[k]! * e[r]! * e[c]!, 0));
  const tol = 1e-6 * (I[0]! + I[4]! + I[8]!);
  if (Math.abs(I[2]!) < tol && Math.abs(I[5]!) < tol) return;
  const m = rb.mass();
  const com = rb.localCom();
  const Ibb = I[0]!;
  const Icc = I[4]!;
  const Ibc = I[1]!;
  const th = 0.5 * Math.atan2(2 * Ibc, Ibb - Icc);
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const lu = Ibb * cs * cs + 2 * Ibc * sn * cs + Icc * sn * sn;
  for (let i = 0; i < rb.numColliders(); i++) rb.collider(i).setDensity(0);
  rb.setAdditionalMassProperties(m, com, { x: lu, y: Ibb + Icc - lu, z: I[8]! }, { x: 0, y: 0, z: Math.sin(th / 2), w: Math.cos(th / 2) }, true);
  rb.recomputeMassPropertiesFromColliders();
}

/** Z-angle of a body rotating about Z. */
export const angleZ = (rb: any) => {
  const q = rb.rotation();
  return 2 * Math.atan2(q.z, q.w);
};
/** Unwraps successive angles. */
export class Unwrap {
  v: number;
  private last: number;
  constructor(a0: number) {
    this.v = a0;
    this.last = a0;
  }
  push(a: number): number {
    let d = a - this.last;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.last = a;
    this.v += d;
    return this.v;
  }
}

/** Kinetic + potential energy of dynamic bodies (bodies rotate about Z only here, Z principal). */
export function energy(bodies: any[]): { K: number; U: number } {
  let K = 0;
  let U = 0;
  for (const rb of bodies) {
    const m = rb.mass();
    const v = rb.linvel();
    const wv = rb.angvel();
    const inv = rb.effectiveWorldInvInertia(); // SdpMatrix3 (elements m11 m12 m13 m22 m23 m33)
    const e = inv.elements;
    // invert the symmetric 3×3
    const a = [
      [e[0], e[1], e[2]],
      [e[1], e[3], e[4]],
      [e[2], e[4], e[5]],
    ];
    const Iw = inv3(a);
    const w = [wv.x, wv.y, wv.z];
    let rot = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rot += w[i]! * Iw[i]![j]! * w[j]!;
    K += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z) + 0.5 * rot;
    U += m * G * rb.worldCom().y;
  }
  return { K, U };
}
function inv3(a: number[][]): number[][] {
  const [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] = a as [[number, number, number], [number, number, number], [number, number, number]];
  const det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  if (Math.abs(det) < 1e-30) return [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const id = 1 / det;
  return [
    [(b1 * c2 - b2 * c1) * id, (a2 * c1 - a1 * c2) * id, (a1 * b2 - a2 * b1) * id],
    [(b2 * c0 - b0 * c2) * id, (a0 * c2 - a2 * c0) * id, (a2 * b0 - a0 * b2) * id],
    [(b0 * c1 - b1 * c0) * id, (a1 * c0 - a0 * c1) * id, (a0 * b1 - a1 * b0) * id],
  ];
}

export const now = () => performance.now();
export const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};
export const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toPrecision(d) : String(x));
