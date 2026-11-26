// spike-teeth2: shared helpers. Headless Rapier 0.21 with knap's settings (src/physics/sim.ts):
// fixed step 1/480, world 30 iterations + 210 additional for jointed bodies (= 240), 1 PGS
// iteration, hard CCD off, lengthUnit 1, part friction 0.4, restitution 0.1. Pawls are built from
// knap's own collider shapes (src/physics/shapes.ts partShapes, 16 segments). Not product code.
import RAPIER from '@dimforge/rapier3d-compat';
import { partShapes, prismShape } from '../../src/physics/shapes';
import type { Part, Cell } from '../../src/core/types';

export { RAPIER };
export const G = 1226.25;
export const DT = 1 / 480;
export const ITER = 240;
export const BASE_ITER = 30;
export const HC = 0.46;
export const R_BORE = 0.31;
const ANG_X = 3;

// ---- collision groups (membership << 16 | filter) ----
export const BIT = { GROUND: 1, TOOTH: 2, SMOOTH: 4, PART: 8, PAWL: 16, NONE: 0 };
export const grp = (m: number, f: number) => ((m & 0xffff) << 16) | (f & 0xffff);
/** default rule under test: teeth meet only nominated pawl bodies */
export const G_TOOTH = grp(BIT.TOOTH, BIT.PAWL);
/** the gear's smooth tip-radius disc: meets ground and ordinary parts (not pawls, not other gears) */
export const G_SMOOTH = grp(BIT.SMOOTH, BIT.GROUND | BIT.PART);
export const G_PART = grp(BIT.PART, BIT.GROUND | BIT.PART | BIT.SMOOTH | BIT.PAWL);
export const G_PAWL = grp(BIT.PAWL, BIT.GROUND | BIT.PART | BIT.TOOTH | BIT.PAWL);
export const G_GROUND = grp(BIT.GROUND, BIT.PART | BIT.SMOOTH | BIT.PAWL);
export const G_NONE = grp(0, 0);

// ---- gear geometry (gear frame: axis +Z) ----
export const MOD = 0.125;
export interface Gear {
  r: number;
  T: number;
  tip: number;
  root: number;
  D: number; // angular pitch
}
export function gear(r: number, T = Math.round(16 * r)): Gear {
  return { r, T, tip: r + MOD, root: r - 1.25 * MOD, D: (2 * Math.PI) / T };
}
type P2 = [number, number];
const PA = (20 * Math.PI) / 180;
/** tooth k: symmetric trapezoid with 20° flanks, width p/2 at the pitch circle, centred at (k+½)Δ;
 *  base sunk 0.03 into the root polygon. CCW. */
export function toothPoly(g: Gear, k: number): P2[] {
  const p = MOD * Math.PI;
  const w = (rho: number) => p / 4 - (rho - g.r) * Math.tan(PA);
  const rb = g.root - 0.03;
  const c = (k + 0.5) * g.D;
  const loc: P2[] = [
    [rb, -w(rb)],
    [g.tip, -w(g.tip)],
    [g.tip, w(g.tip)],
    [rb, w(rb)],
  ];
  return loc.map(([x, y]) => [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]);
}
const prismPts = (poly: P2[], hz: number) => {
  const a = new Float32Array(poly.length * 6);
  poly.forEach(([x, y], i) => {
    a.set([x, y, -hz], i * 6);
    a.set([x, y, hz], i * 6 + 3);
  });
  return a;
};
const hullPts = (sh: any) => new Float32Array(sh.points.flat());
export const rootHull = (g: Gear) => hullPts(prismShape([0, 0, 0], 2, g.root, HC, g.T, 0));
export const smoothHull = (R: number) => hullPts(prismShape([0, 0, 0], 2, R, HC, 32, 0, 0, 0.02 * R));

/** Outline of the toothed gear (CCW), for trimesh/polyline. */
export function outline(g: Gear): P2[] {
  const out: P2[] = [];
  const Rr = g.root / Math.cos(Math.PI / g.T);
  for (let k = 0; k < g.T; k++) {
    const a0 = k * g.D;
    out.push([g.root * Math.cos(a0), g.root * Math.sin(a0)]);
    const t = toothPoly(g, k);
    // the tooth's base corners are below the root polygon; use the flank/root intersection approx
    const lift = (pt: P2, toward: P2): P2 => {
      // move along the flank from base toward tip until radius >= root polygon radius at that angle
      for (let s = 0; s <= 1; s += 0.02) {
        const q: P2 = [pt[0] + (toward[0] - pt[0]) * s, pt[1] + (toward[1] - pt[1]) * s];
        if (Math.hypot(q[0], q[1]) >= g.root + 0.01) return q;
      }
      return toward;
    };
    out.push(lift(t[0]!, t[1]!), t[1]!, t[2]!, lift(t[3]!, t[2]!));
  }
  void Rr;
  return out;
}

export type Rep = 'hull' | 'compound' | 'box' | 'capsule' | 'trimesh' | 'polyline' | 'half' | 'smooth' | 'none';
export interface GearOpts {
  rep: Rep;
  toothGroup?: number; // default G_TOOTH
  smooth?: boolean; // add the smooth tip-radius disc (G_SMOOTH) for ground/ordinary parts; default false
  smoothGroup?: number;
  friction?: number;
}
/** Collider descs of a gear in its body frame, plus an invisible mass cylinder (radius r, density 1). */
export function gearDescs(g: Gear, o: GearOpts): any[] {
  const out: any[] = [];
  const tg = o.toothGroup ?? G_TOOTH;
  const fin = (d: any) => d.setFriction(o.friction ?? 0.4).setRestitution(0.1).setDensity(0).setCollisionGroups(tg);
  const hulls = () => {
    const hs: Float32Array[] = [rootHull(g)];
    for (let k = 0; k < g.T; k += o.rep === 'half' ? 2 : 1) hs.push(prismPts(toothPoly(g, k), HC));
    return hs;
  };
  switch (o.rep) {
    case 'hull':
    case 'half':
      for (const h of hulls()) out.push(fin(RAPIER.ColliderDesc.convexHull(h)!));
      break;
    case 'compound': {
      const shapes = hulls().map((h) => new RAPIER.ConvexPolyhedron(h, null));
      out.push(fin(RAPIER.ColliderDesc.compound(shapes, shapes.map(() => ({ x: 0, y: 0, z: 0 })), shapes.map(() => ({ x: 0, y: 0, z: 0, w: 1 })))));
      break;
    }
    case 'box':
    case 'capsule': {
      out.push(fin(RAPIER.ColliderDesc.convexHull(rootHull(g))!));
      const p = MOD * Math.PI;
      const rb = g.root - 0.03;
      for (let k = 0; k < g.T; k++) {
        const c = (k + 0.5) * g.D;
        const q = { x: 0, y: 0, z: Math.sin(c / 2), w: Math.cos(c / 2) };
        if (o.rep === 'box') {
          const hw = p / 4 - ((g.tip + rb) / 2 - g.r) * Math.tan(PA); // mean half width
          const hr = (g.tip - rb) / 2;
          const m = (g.tip + rb) / 2;
          out.push(fin(RAPIER.ColliderDesc.cuboid(hr, hw, HC).setTranslation(m * Math.cos(c), m * Math.sin(c), 0).setRotation(q)));
        } else {
          const rad = p / 4 - (g.tip - 0.06 - g.r) * Math.tan(PA) + 0.01; // ~ half width near the tip
          const m = g.tip - rad;
          const qz = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // capsule Y -> Z
          out.push(fin(RAPIER.ColliderDesc.capsule(HC - rad, rad).setTranslation(m * Math.cos(c), m * Math.sin(c), 0).setRotation(qz)));
        }
      }
      break;
    }
    case 'trimesh': {
      const ol = outline(g);
      const n = ol.length;
      const v: number[] = [];
      for (const [x, y] of ol) v.push(x, y, -HC);
      for (const [x, y] of ol) v.push(x, y, HC);
      v.push(0, 0, -HC, 0, 0, HC);
      const cb = 2 * n, ct = 2 * n + 1;
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        idx.push(i, j, n + j, i, n + j, n + i); // side (outward for CCW)
        idx.push(cb, j, i); // bottom (−Z)
        idx.push(ct, n + i, n + j); // top
      }
      out.push(fin(RAPIER.ColliderDesc.trimesh(new Float32Array(v), new Uint32Array(idx))));
      break;
    }
    case 'polyline': {
      const ol = outline(g);
      const v: number[] = [];
      for (const [x, y] of ol) v.push(x, y, 0);
      v.push(ol[0]![0], ol[0]![1], 0);
      out.push(fin(RAPIER.ColliderDesc.polyline(new Float32Array(v))));
      break;
    }
    case 'smooth':
      out.push(fin(RAPIER.ColliderDesc.convexHull(smoothHull(g.tip))!));
      break;
    case 'none':
      break;
  }
  if (o.smooth) out.push(RAPIER.ColliderDesc.convexHull(smoothHull(g.tip - 0.02))!.setDensity(0).setFriction(0.4).setRestitution(0.1).setCollisionGroups(o.smoothGroup ?? G_SMOOTH));
  // mass: solid disc radius r, thickness 2·HC, density 1 (collides with nothing)
  const qz = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  out.push(RAPIER.ColliderDesc.cylinder(HC, Math.max(g.r, 0.47)).setRotation(qz).setDensity(1).setCollisionGroups(G_NONE));
  return out;
}

// ---- knap parts -> collider descs (real shapes) ----
/** Collider descs (body frame = origin `o`) for knap parts, via partShapes(part, 16). */
export function partDescs(parts: Part[], o: [number, number, number], group = G_PAWL, friction = 0.4): any[] {
  const out: any[] = [];
  for (const part of parts)
    for (const sh of partShapes(part, 16) as any[]) {
      if (sh.kind === 'hull') {
        const pts = new Float32Array(sh.points.flatMap((p: number[]) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]));
        out.push(RAPIER.ColliderDesc.convexHull(pts)!);
      } else if (sh.kind === 'box') {
        out.push(RAPIER.ColliderDesc.cuboid(sh.halfExtents[0], sh.halfExtents[1], sh.halfExtents[2]).setTranslation(sh.center[0] - o[0], sh.center[1] - o[1], sh.center[2] - o[2]));
      } else throw new Error('wheel shape not expected');
    }
  return out.map((d) => d.setDensity(1).setFriction(friction).setRestitution(0.1).setCollisionGroups(group));
}
let pid = 1;
export const mkPart = (cells: Cell[]): Part => ({ id: pid++, color: '#888888', cells } as Part);
const hole = (x: number, y: number, z: number, axis: 0 | 1 | 2 = 2, kind: Cell['kind'] = 'pinHole'): Cell => ({ x, y, z, kind, axis } as Cell);

/** Pawl kinds (edit-time layout: pivot hole at the origin, arm along +X; gear axis = Z):
 *  end:    liftarm of l+1 holes in the gear layer (z=0); its round end (r 0.46) touches.
 *  rod:    liftarm of l+1 holes one layer up (z=1), axle hole at hole l, a 2-long axle through it
 *          reaching down into the gear layer (z=0): the axle's side (r 0.29) touches.
 *  corner: l plain holes + a last hole at x=l with its axis along the arm (a perpendicular
 *          connector end): a square end (0.92 wide, 90° corners) in the gear plane.
 *  pinx:   liftarm of l holes (0..l-1) with a pin growing out of the end wall along the arm at x=l
 *          ("liftarm with pin"): a 0.58-wide flat-ended finger with 90° corners. */
export type PawlKind = 'end' | 'rod' | 'corner' | 'pinx';
export function pawlParts(kind: PawlKind, l: number): { parts: Part[]; pivotZ: number } {
  const cells: Cell[] = [];
  if (kind === 'end') {
    for (let k = 0; k <= l; k++) cells.push(hole(k, 0, 0));
    return { parts: [mkPart(cells)], pivotZ: 0 };
  }
  if (kind === 'rod') {
    for (let k = 0; k <= l; k++) cells.push(hole(k, 0, 1, 2, k === l ? 'axleHole' : 'pinHole'));
    const axle = mkPart([{ x: l, y: 0, z: 1, kind: 'axle', axis: 2 } as Cell, { x: l, y: 0, z: 0, kind: 'axle', axis: 2 } as Cell]);
    return { parts: [mkPart(cells), axle], pivotZ: 1 };
  }
  if (kind === 'corner') {
    for (let k = 0; k < l; k++) cells.push(hole(k, 0, 0));
    cells.push(hole(l, 0, 0, 0));
    return { parts: [mkPart(cells)], pivotZ: 0 };
  }
  for (let k = 0; k < l; k++) cells.push(hole(k, 0, 0));
  cells.push({ x: l, y: 0, z: 0, kind: 'pin', axis: 0 } as Cell);
  return { parts: [mkPart(cells)], pivotZ: 0 };
}
/** Farthest reach of the pawl's touching feature from the pivot (for the candidate filter). */
export const pawlReach = (kind: PawlKind, l: number) => (kind === 'end' ? l + 0.47 : kind === 'rod' ? l + 0.3 : kind === 'corner' ? l + 0.66 : l + 0.6);

// ---- world / bodies ----
export interface WorldOpts {
  dt?: number;
  iters?: number;
}
export function makeWorld(o: WorldOpts = {}): any {
  const w = new RAPIER.World({ x: 0, y: -G, z: 0 });
  w.timestep = o.dt ?? DT;
  w.numSolverIterations = Math.min(BASE_ITER, o.iters ?? ITER);
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = 0;
  // NF=<Hz> overrides Rapier's contact natural frequency (default 30 Hz, kept by sim.ts; the JS
  // setter affects dynamic–dynamic contacts only, DEVIATIONS §5)
  if (process.env.NF) w.integrationParameters.contact_natural_frequency = Number(process.env.NF);
  return w;
}
export const fixed = (w: any) => w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
export function body(w: any, p: [number, number, number], alpha: number, descs: any[], iters = ITER): any {
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      .setTranslation(p[0], p[1], p[2])
      .setRotation({ x: 0, y: 0, z: Math.sin(alpha / 2), w: Math.cos(alpha / 2) })
      .setAdditionalSolverIterations(Math.max(0, iters - BASE_ITER)),
  );
  for (const d of descs) w.createCollider(d, rb);
  return rb;
}
/** Revolute about world Z through `at`, between fixed f (at origin) and b. */
export function revZ(w: any, f: any, b: any, at: [number, number, number]): any {
  const bt = b.translation();
  const ang = angleZ(b);
  const d = [at[0] - bt.x, at[1] - bt.y, at[2] - bt.z];
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const loc = { x: c * d[0]! - s * d[1]!, y: s * d[0]! + c * d[1]!, z: d[2]! };
  const j = w.createImpulseJoint(RAPIER.JointData.revolute({ x: at[0], y: at[1], z: at[2] }, loc, { x: 0, y: 0, z: 1 }), f, b, true);
  j.setContactsEnabled(false);
  return j;
}
/** Velocity motor on a revolute (target ω, torque limit). Also used as joint friction (ω = 0). */
export function vmotor(w: any, j: any, omega: number, maxTorque: number): void {
  const raw = w.impulseJoints.raw;
  raw.jointConfigureMotorModel(j.handle, ANG_X, 0);
  raw.jointConfigureMotorVelocity(j.handle, ANG_X, omega, 1e9);
  raw.jointSetMotorMaxForce(j.handle, ANG_X, maxTorque);
}
export const angleZ = (rb: any) => {
  const q = rb.rotation();
  return 2 * Math.atan2(q.z, q.w);
};
export class Unwrap {
  v: number;
  private last: number;
  constructor(a0: number) {
    this.v = a0;
    this.last = a0;
  }
  push(a: number): number {
    let d = a - this.last;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    this.last = a;
    this.v += d;
    return this.v;
  }
}
/** Rotational KE about Z + linear KE + PE (bodies rotating about Z). */
export function energy(bodies: any[]): number {
  let e = 0;
  for (const b of bodies) {
    const v = b.linvel(), wv = b.angvel();
    const inv = b.effectiveWorldInvInertia().elements; // m11 m12 m13 m22 m23 m33
    const Izz = inv[5] > 0 ? 1 / inv[5] : 0; // adequate for Z-axis rotation with principal Z
    e += 0.5 * b.mass() * (v.x * v.x + v.y * v.y + v.z * v.z) + 0.5 * Izz * wv.z * wv.z + b.mass() * G * b.worldCom().y;
  }
  return e;
}
/** Total contact points (manifold points with dist < 0) across the world, and active pairs. */
export function contactStats(w: any): { pairs: number; points: number } {
  let pairs = 0, points = 0;
  w.colliders.forEach((c1: any) => {
    w.contactPairsWith(c1, (c2: any) => {
      if (c1.handle >= c2.handle) return;
      w.contactPair(c1, c2, (m: any) => {
        const n = m.numContacts();
        if (n > 0) pairs++;
        points += n;
      });
    });
  });
  return { pairs, points };
}
export const now = () => performance.now();
/** CPU time of this process in ms (user + system): far less sensitive to other processes than wall time. */
export const cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
export const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};
export const fmt = (x: number, d = 3) => (x === undefined || Number.isNaN(x) ? '-' : Number.isFinite(x) ? (+x).toPrecision(d) : x > 0 ? 'inf' : '-inf');
