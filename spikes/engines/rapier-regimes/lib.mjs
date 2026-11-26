// Pure-Rapier harness for the unit-regime study. No project code.
// Every scene is described in REAL units (studs, real seconds, studs/s, rad/s) and converted to
// the regime's internal units here; every reading is converted back. See README.md.
import RAPIER from '@dimforge/rapier3d-compat';
export { RAPIER };
let ready = false;
export async function init() {
  if (!ready) { await RAPIER.init(); ready = true; }
}

export const G_REAL = 1226.25; // studs/s^2
const S = Math.sqrt(G_REAL / 9.81); // 11.180...
export const TIME_SCALE = S;

// L  : Rapier length per stud
// s  : simulated seconds per real second
// dt : Rapier world step (simulated seconds)
// sps: world steps per real second (= s / dt)
// lu : lengthUnit; rho: density (Rapier mass per Rapier volume)
// free / joint: solver iterations for free bodies / jointed mechanisms
// cnf: contact_natural_frequency (null = default 30)
const base = { L: 1, s: 1, dt: 1 / 480, g: G_REAL, lu: 1, rho: 1, free: 30, joint: 240, cnf: null };
export const REGIMES = {
  R0: { ...base },
  R1: { ...base, cnf: 335 },
  R2: { ...base, s: S, dt: S / 480, g: 9.81 },
  R2d: { ...base, s: S, dt: 1 / 60, g: 9.81, free: 4, joint: 4 },
  R2d240: { ...base, s: S, dt: 1 / 60, g: 9.81, free: 4, joint: 240 },
  R3: { ...base, L: 0.008, g: 9.81, lu: 0.008, rho: 586 }, // 0.3 g per stud cube = 586 kg/m^3
  R3n: { ...base, L: 0.008, g: 9.81, lu: 1, rho: 586 },
  Rm3: { ...base, rho: 1e-3 },
  Rp3: { ...base, rho: 1e3 },
};
for (const [k, r] of Object.entries(REGIMES)) { r.name = k; r.sps = r.s / r.dt; }

/**
 * Scale ladder "L<k>": R0 rescaled in length by k (lengthUnit k, g 1226.25 k, density 1/k^3 so
 * masses are unchanged). For k a power of two this is bit-for-bit the same arithmetic as R0 in f32
 * apart from absolute epsilons inside parry/Rapier; k = 0.008 is R3 with R0's masses.
 * "T<s>": R0 time-scaled by s (R2 is T11.18).
 */
export function regime(name) {
  if (REGIMES[name]) return REGIMES[name];
  let m = /^L([0-9.e-]+)$/.exec(name);
  if (m) { const k = +m[1]; const r = { ...base, L: k, lu: k, g: G_REAL * k, rho: 1 / k ** 3, name }; r.sps = r.s / r.dt; return r; }
  m = /^T([0-9.e-]+)$/.exec(name);
  if (m) { const s = +m[1]; const r = { ...base, s, dt: s / 480, g: G_REAL / s ** 2, name }; r.sps = r.s / r.dt; return r; }
  throw new Error('unknown regime ' + name);
}

export function steps(reg, Treal) { return Math.max(1, Math.round(Treal * reg.sps)); }

// ---------- quaternion helpers ----------
export const qmul = (a, b) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
export const qconj = (q) => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
export function qrot(q, v) {
  const p = qmul(qmul(q, { w: 0, x: v.x, y: v.y, z: v.z }), qconj(q));
  return { x: p.x, y: p.y, z: p.z };
}
export const qaxis = (ax, ay, az, ang) => {
  const n = Math.hypot(ax, ay, az), s = Math.sin(ang / 2) / n;
  return { w: Math.cos(ang / 2), x: ax * s, y: ay * s, z: az * s };
};
export const Q_ID = { w: 1, x: 0, y: 0, z: 0 };
export const Q_Y_TO_X = qaxis(0, 0, 1, -Math.PI / 2); // cylinder (axis Y) turned onto X
export const Q_Y_TO_Z = qaxis(1, 0, 0, Math.PI / 2); // cylinder axis onto Z
const len = (v) => Math.hypot(v.x, v.y, v.z);
export { len };

// ---------- world + bodies in real units ----------
export class W {
  constructor(reg, { gravity = true } = {}) {
    this.reg = reg;
    this.world = new RAPIER.World({ x: 0, y: gravity ? -reg.g : 0, z: 0 }); // reg.g is in Rapier units
    const w = this.world;
    w.timestep = reg.dt;
    w.numSolverIterations = reg.free;
    if (reg.lu !== 1) w.lengthUnit = reg.lu;
    if (reg.cnf != null) w.integrationParameters.contact_natural_frequency = reg.cnf;
    this.fixed = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.t = 0; // real seconds
    this.stepMs = 0;
  }
  // conversions real -> Rapier
  p(x) { return x * this.reg.L; }
  v(x) { return (x * this.reg.L) / this.reg.s; }
  w(x) { return x / this.reg.s; }
  P(o) { return { x: this.p(o.x), y: this.p(o.y), z: this.p(o.z) }; }
  // conversions Rapier -> real
  rp(x) { return x / this.reg.L; }
  rv(x) { return (x * this.reg.s) / this.reg.L; }
  rw(x) { return x * this.reg.s; }
  pos(b) { const t = b.translation(); return { x: this.rp(t.x), y: this.rp(t.y), z: this.rp(t.z) }; }
  vel(b) { const t = b.linvel(); return { x: this.rv(t.x), y: this.rv(t.y), z: this.rv(t.z) }; }
  angvel(b) { const t = b.angvel(); return { x: this.rw(t.x), y: this.rw(t.y), z: this.rw(t.z) }; }

  floorBox(hx = 20, hy = 0.5, hz = 20, friction = 0.5) {
    const c = RAPIER.ColliderDesc.cuboid(this.p(hx), this.p(hy), this.p(hz)).setTranslation(0, this.p(-hy), 0)
      .setFriction(friction).setRestitution(0);
    return this.world.createCollider(c, this.fixed);
  }
  floorPlane(friction = 0.5) {
    const c = new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setFriction(friction).setRestitution(0);
    return this.world.createCollider(c, this.fixed);
  }
  /** dynamic body; o: {pos, rot, linvel, angvel} in real units */
  body(o = {}, jointed = false) {
    const d = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false);
    const p = o.pos ?? { x: 0, y: 0, z: 0 };
    d.setTranslation(this.p(p.x), this.p(p.y), this.p(p.z));
    if (o.rot) d.setRotation(o.rot);
    if (o.linvel) d.setLinvel(this.v(o.linvel.x), this.v(o.linvel.y), this.v(o.linvel.z));
    if (o.angvel) d.setAngvel({ x: this.w(o.angvel.x), y: this.w(o.angvel.y), z: this.w(o.angvel.z) });
    if (jointed && this.reg.joint > this.reg.free) d.setAdditionalSolverIterations(this.reg.joint - this.reg.free);
    return this.world.createRigidBody(d);
  }
  /** attach a collider; shape built from real dims; dens = multiplier of the material density */
  add(body, desc, { at, rot, dens = 1, friction = 0.5, groups } = {}) {
    desc.setDensity(this.reg.rho * dens).setFriction(friction).setRestitution(0);
    if (at) desc.setTranslation(this.p(at.x), this.p(at.y), this.p(at.z));
    if (rot) desc.setRotation(rot);
    if (groups !== undefined) desc.setCollisionGroups(groups);
    return this.world.createCollider(desc, body);
  }
  cuboid(hx, hy, hz) { return RAPIER.ColliderDesc.cuboid(this.p(hx), this.p(hy), this.p(hz)); }
  cylinder(hh, r) { return RAPIER.ColliderDesc.cylinder(this.p(hh), this.p(r)); }
  /** regular n-gon prism (axis Y), radius r, half height hh, offset y0 */
  prism(n, r, hh, y0 = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * (i + 0.5)) / n;
      for (const y of [y0 - hh, y0 + hh]) pts.push(this.p(r * Math.cos(a)), this.p(y), this.p(r * Math.sin(a)));
    }
    return RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
  }
  step(n = 1) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.world.step();
    this.stepMs += performance.now() - t0;
    this.t += n / this.reg.sps;
  }
  /** number of solver contact points between two colliders */
  contacts(c1, c2) {
    let n = 0;
    this.world.contactPair(c1, c2, (m) => { n += m.numSolverContacts(); });
    return n;
  }
  /** rotational state of a body in Rapier units: {E, Lmag} about its COM (real-unit independent ratios) */
  rot(b) {
    const q = qmul(b.rotation(), b.principalInertiaLocalFrame());
    const I = b.principalInertia();
    const wv = qrot(qconj(q), b.angvel());
    return {
      E: 0.5 * (I.x * wv.x * wv.x + I.y * wv.y * wv.y + I.z * wv.z * wv.z),
      L: Math.hypot(I.x * wv.x, I.y * wv.y, I.z * wv.z),
    };
  }
  /** total mechanical energy of bodies in Rapier units (gravity along -Y) */
  energy(bodies, gravity = true) {
    let E = 0;
    for (const b of bodies) {
      const m = b.mass();
      const v = b.linvel();
      const c = b.worldCom ? b.worldCom() : b.translation();
      E += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z) + this.rot(b).E;
      if (gravity) E += m * this.reg.g * c.y;
    }
    return E;
  }
  free() { this.world.free(); }
}

export function upTilt(b, axis = { x: 0, y: 1, z: 0 }) {
  const u = qrot(b.rotation(), axis);
  return Math.acos(Math.min(1, Math.abs(u.y) / len(u)));
}
export const deg = (r) => (r * 180) / Math.PI;
export const f = (x, d = 3) => (x === undefined || x === null || Number.isNaN(x) ? 'n/a' : Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d));
