// Gear-mesh coupling spike: shared helpers. Plain ESM against @dimforge/rapier3d-compat 0.21.0.
// Settings lifted from src/physics/sim.ts: fixedDt 1/480, 240 solver iterations (substeps) for
// jointed bodies, 1 internal PGS iteration, hard CCD off, density 1, g = 9.81/0.008.
import R from '@dimforge/rapier3d-compat';
await R.init();
export { R };

export const G = 9.81 / 0.008; // 1226.25 units/s^2
export const DT = 1 / 480;
export const MODULE = 0.125; // 1 mm in units
export const PITCH = Math.PI * MODULE; // circular pitch, units of arc per tooth (0.3927)
export const LINX = 0; // RAPIER.JointAxis.LinX
export const ANGX = 3; // RAPIER.JointAxis.AngX
export const R_BORE = 0.31;

// ---------- vector / quaternion helpers (f64 arrays) ----------
export const v = (o) => [o.x, o.y, o.z];
export const q = (o) => [o.x, o.y, o.z, o.w];
export const xyz = (a) => ({ x: a[0], y: a[1], z: a[2] });
export const xyzw = (a) => ({ x: a[0], y: a[1], z: a[2], w: a[3] });
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => scl(a, 1 / len(a));
export const conj = (p) => [-p[0], -p[1], -p[2], p[3]];
export function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function rot(p, a) {
  const t = scl(cross(p, a), 2);
  return add(add(a, scl(t, p[3])), cross(p, t));
}
export const irot = (p, a) => rot(conj(p), a);
export function axisAngle(ax, ang) {
  const s = Math.sin(ang / 2);
  return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)];
}
/** Shortest-arc quaternion taking unit u to unit w. */
export function arc(u, w) {
  const d = dot(u, w);
  if (d < -1 + 1e-12) {
    let o = cross(u, [1, 0, 0]);
    if (len(o) < 1e-6) o = cross(u, [0, 1, 0]);
    return [...unit(o), 0];
  }
  const c = cross(u, w);
  const s = Math.sqrt((1 + d) * 2);
  return [c[0] / s, c[1] / s, c[2] / s, s / 2];
}
/** Quaternion of the rotation whose columns are the orthonormal basis X, Y, Z. */
export function basisQuat(X, Y, Z) {
  const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; w = 0.25 * S; x = (m21 - m12) / S; y = (m02 - m20) / S; z = (m10 - m01) / S; }
  else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / S; x = 0.25 * S; y = (m01 + m10) / S; z = (m02 + m20) / S; }
  else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / S; x = (m01 + m10) / S; y = 0.25 * S; z = (m12 + m21) / S; }
  else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / S; x = (m02 + m20) / S; y = (m12 + m21) / S; z = 0.25 * S; }
  return [x, y, z, w];
}
export const wrap = (x) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
export const AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
/** A unit vector perpendicular to a, and a × it: a reference basis of the plane normal to a. */
export function basis(a) {
  const e1 = unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));
  return [e1, cross(a, e1)];
}

// ---------- world ----------
export function makeWorld({ gravity = [0, -G, 0], iters = 240 } = {}) {
  const w = new R.World(xyz(gravity));
  w.timestep = DT;
  w.numSolverIterations = iters;
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = 0;
  const ground = w.createRigidBody(R.RigidBodyDesc.fixed());
  return { w, ground, gravity };
}

const NO_COLLIDE = (0x0001 << 16) | 0x0000; // member of group 0, filter none

/**
 * A gear body: a dynamic (or fixed) body whose origin is the gear centre, carrying a cylinder of
 * radius `colR` (default r) and thickness 1 along `axis`, density `density`. `extras` are
 * additional collider descs (positioned in body-local coordinates) e.g. an arm weight.
 * Returns a gear record {body, lc, la, r, T}.
 */
export function makeGear(W, { centre, axis, r, density = 1, fixed = false, colR, collide = false, extras = [], angDamp = 0 }) {
  const desc = fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setCanSleep(false).setAngularDamping(angDamp);
  desc.setTranslation(centre[0], centre[1], centre[2]);
  const body = W.w.createRigidBody(desc);
  const cq = arc([0, 1, 0], axis);
  const cd = R.ColliderDesc.cylinder(0.5, colR ?? r).setRotation(xyzw(cq)).setDensity(density).setFriction(0.4).setRestitution(0.1);
  if (!collide) cd.setCollisionGroups(NO_COLLIDE);
  W.w.createCollider(cd, body);
  for (const e of extras) {
    if (!collide) e.setCollisionGroups(NO_COLLIDE);
    W.w.createCollider(e, body);
  }
  return { body, lc: [0, 0, 0], la: [...axis], r, T: Math.round(16 * r) };
}

/** Ball collider desc of mass m at local position p (radius 0.25). */
export function weight(p, m, rad = 0.25) {
  const vol = (4 / 3) * Math.PI * rad ** 3;
  return R.ColliderDesc.ball(rad).setTranslation(p[0], p[1], p[2]).setDensity(m / vol);
}

/** Revolute joint between body A (anchor in A-local) and gear body (anchor at its origin). */
export function revolute(W, A, B, anchorA, anchorB, axis) {
  const j = W.w.createImpulseJoint(R.JointData.revolute(xyz(anchorA), xyz(anchorB), xyz(axis)), A, B, true);
  j.setContactsEnabled(false);
  return j;
}
/** Gear on a revolute to the ground at its centre. */
export function pinGear(W, g) {
  const c = v(g.body.translation());
  return revolute(W, W.ground, g.body, c, [0, 0, 0], g.la);
}

/** Velocity motor on a revolute (AngX), acceleration based. */
export function motor(W, j, target, gain = 1e9, maxForce = Infinity) {
  const raw = W.w.impulseJoints.raw;
  raw.jointConfigureMotorModel(j.handle, ANGX, 0);
  raw.jointConfigureMotorVelocity(j.handle, ANGX, target, gain);
  if (Number.isFinite(maxForce)) raw.jointSetMotorMaxForce(j.handle, ANGX, maxForce);
}

/** World centre and axis of a gear. */
export function gearFrame(g) {
  const qq = q(g.body.rotation());
  return { c: add(v(g.body.translation()), rot(qq, g.lc)), a: rot(qq, g.la), q: qq };
}

/** Unwrapped twist angle of a body about world axis a (tracked across calls in st). */
export function twist(qq, a, st) {
  const raw = 2 * Math.atan2(dot([qq[0], qq[1], qq[2]], a), qq[3]);
  if (st.prev === undefined) {
    st.prev = raw;
    st.acc = raw;
  } else {
    st.acc += wrap(raw - st.prev);
    st.prev = raw;
  }
  return st.acc;
}
export function angleIn(nv, a, st) {
  const [e1, e2] = basis(a);
  const raw = Math.atan2(dot(nv, e2), dot(nv, e1));
  if (st.prev === undefined) {
    st.prev = raw;
    st.acc = raw;
  } else {
    st.acc += wrap(raw - st.prev);
    st.prev = raw;
  }
  return st.acc;
}

/**
 * Mesh constraint between gears g1 and g2 (the proposed construction): one generic impulse joint
 * locking LinX only, re-anchored every step at the pitch point P with X = t; optional phase
 * feedback offsets anchor 2 along t by −k·e (e = accumulated phase error, units of pitch arc).
 * opts.frame: 'both' (default: both frames' X = t), 'one' (frame2 X = normal n, frame1 X = t),
 *   'two' (frame1 X = n, frame2 X = t)  — used to find which frame defines the row.
 * opts.reanchor: false → anchors and frames set once at creation and never updated.
 * opts.maxCorr: clamp of |offset| per step (units), default Infinity.
 * opts.snap: if true, φ0 is snapped to the nearest (k+½)·PITCH (tooth-compatible phase).
 * opts.sepTan: if > 0, apply a separating force F·tan20° along n using F estimated by caller.
 */
export class Mesh {
  constructor(W, g1, g2, opts = {}) {
    this.W = W;
    this.g1 = g1;
    this.g2 = g2;
    this.o = { feedback: true, k: 1, frame: 'both', reanchor: true, maxCorr: Infinity, snap: false, ...opts };
    this.s1 = {};
    this.s2 = {};
    this.sp = {};
    this.joint = null;
    this.phi0 = undefined;
    this.e = 0;
    this.maxAbsE = 0;
    this.update(true);
  }
  geom() {
    const f1 = gearFrame(this.g1);
    const f2 = gearFrame(this.g2);
    const a = f1.a;
    const d = sub(f2.c, f1.c);
    // project d into the plane normal to a (coplanar assumption; out-of-plane offset ignored)
    const dp = sub(d, scl(a, dot(d, a)));
    const D = len(dp);
    const n = scl(dp, 1 / D);
    const t = cross(a, n);
    const r1 = this.g1.r;
    const r2 = this.g2.r;
    const P = add(f1.c, scl(dp, r1 / (r1 + r2)));
    return { f1, f2, a, n, t, D, P, r1, r2 };
  }
  phase(G) {
    const th1 = twist(G.f1.q, G.a, this.s1);
    const th2 = twist(G.f2.q, G.a, this.s2);
    const psi = angleIn(G.n, G.a, this.sp);
    return G.r1 * th1 + G.r2 * th2 - (G.r1 + G.r2) * psi;
  }
  /** Call before every world.step(). */
  update(first = false) {
    if (this.dead) return;
    if (!first && this.joint && !this.joint.isValid()) {
      this.dead = true;
      this.joint = null;
      return;
    }
    const G = this.geom();
    const phi = this.phase(G);
    if (this.phi0 === undefined) {
      this.phi0 = this.o.snap ? (Math.round(phi / PITCH - 0.5) + 0.5) * PITCH : phi;
    }
    this.e = phi - this.phi0;
    if (!first) this.maxAbsE = Math.max(this.maxAbsE, Math.abs(this.e));
    this.lastG = G;
    let off = this.o.feedback ? -this.o.k * this.e : 0;
    off = Math.max(-this.o.maxCorr, Math.min(this.o.maxCorr, off));
    const b1 = this.g1.body;
    const b2 = this.g2.body;
    const q1 = q(b1.rotation());
    const q2 = q(b2.rotation());
    // Lead: with anchors fixed on the two gears' material and X fixed in gear 1's frame for the
    // whole step, the row holds gear 2's material point at constant X-coordinate in gear 1's
    // frame, which under true rolling drifts as D(1−k²)φ³/6 (epicycloid, k = D/r2, φ = gear 1's
    // rotation relative to the line of centres over the step). Moving both anchors by λ along t
    // adds −λk²φ²/2; λ = D(1−k²)φ/(2k²) makes the end-of-step velocity exact.
    let lam = 0;
    if (this.o.lead) {
      const D = G.r1 + G.r2;
      const k = D / G.r2;
      const vc = sub(v(b2.velocityAtPoint(xyz(G.f2.c))), v(b1.velocityAtPoint(xyz(G.f1.c))));
      const betaDot = dot(vc, G.t) / G.D;
      const phiStep = (dot(v(b1.angvel()), G.a) - betaDot) * (this.o.dt ?? 1 / 480);
      lam = (this.o.leadSign ?? 1) * ((D * (1 - k * k) * phiStep) / (2 * k * k));
    }
    this.lam = lam;
    // stop: anchors on the two pitch circles on the line of centres (c1 + r1·n, c2 − r2·n) and a
    // right-handed frame X = t, Y = n, Z = −a, so that LinY = D − r1 − r2 and a [0, ∞) limit on LinY keeps
    // the gears from closing in past the pitch distance (a one-sided row in the same joint).
    const P1 = this.o.stop ? add(G.f1.c, scl(G.n, G.r1)) : G.P;
    const P2 = this.o.stop ? sub(G.f2.c, scl(G.n, G.r2)) : G.P;
    const A1 = irot(q1, sub(add(P1, scl(G.t, lam)), v(b1.translation())));
    const A2 = irot(q2, sub(add(P2, scl(G.t, off + lam)), v(b2.translation())));
    const x1 = this.o.frame === 'two' ? G.n : G.t;
    const x2 = this.o.frame === 'one' ? G.n : G.t;
    const F1 = this.o.stop ? basisQuat(irot(q1, G.t), irot(q1, G.n), irot(q1, scl(G.a, -1))) : arc([1, 0, 0], irot(q1, x1));
    const F2 = this.o.stop ? basisQuat(irot(q2, G.t), irot(q2, G.n), irot(q2, scl(G.a, -1))) : arc([1, 0, 0], irot(q2, x2));
    if (this.o.recreate && this.joint) {
      this.W.w.removeImpulseJoint(this.joint, false);
      this.joint = null;
    }
    if (!this.joint) {
      // generic(): the same local axis is used for both frames at creation; overwrite below.
      const data = R.JointData.generic(xyz(A1), xyz(A2), { x: 1, y: 0, z: 0 }, R.JointAxesMask.LinX);
      this.joint = this.W.w.createImpulseJoint(data, b1, b2, true);
      this.joint.setContactsEnabled(true); // gears collide as cylinders where enabled by groups
      this.joint.setLocalFrame1(xyz(A1), xyzw(F1));
      this.joint.setLocalFrame2(xyz(A2), xyzw(F2));
      if (this.o.stop && this.o.stopMin !== 'none') this.W.w.impulseJoints.raw.jointSetLimits(this.joint.handle, 1 /* LinY */, this.o.stopMin ?? 0, 1e6);
      return;
    }
    if (!this.o.reanchor) return;
    this.joint.setLocalFrame1(xyz(A1), xyzw(F1));
    this.joint.setLocalFrame2(xyz(A2), xyzw(F2));
  }
  remove() {
    if (this.joint && this.joint.isValid()) this.W.w.removeImpulseJoint(this.joint, true);
    this.joint = null;
    this.dead = true;
  }
}

/** Angular velocity of a body about world axis a. */
export const omega = (b, a) => dot(v(b.angvel()), a);

/** Kinetic energy of a body (from engine mass properties). */
export function kinetic(b) {
  const m = b.mass();
  const I = v(b.principalInertia());
  const fr = q(b.principalInertiaLocalFrame());
  const lv = v(b.linvel());
  const wl = irot(qmul(q(b.rotation()), fr), v(b.angvel()));
  return 0.5 * m * dot(lv, lv) + 0.5 * (I[0] * wl[0] ** 2 + I[1] * wl[1] ** 2 + I[2] * wl[2] ** 2);
}
export function potential(b, gravity) {
  return -b.mass() * dot(gravity, v(b.worldCom()));
}

/** Simplified copy of sim.ts guardEnergy for one group of bodies. */
export class Guard {
  constructor(bodies, gravity, band = 0.01) {
    Object.assign(this, { bodies, gravity, band, init: false, removed: 0 });
  }
  after() {
    let e = 0;
    let k = 0;
    let noise = 0;
    for (const b of this.bodies) {
      if (!b.isValid?.() && b.isValid) continue;
      const kk = kinetic(b);
      k += kk;
      e += kk + potential(b, this.gravity);
      noise += 1e-5 * b.mass() * len(this.gravity) * (1 + len(v(b.worldCom())));
    }
    if (!this.init) {
      Object.assign(this, { init: true, eRef: e, kPeak: k, floor: noise });
      return;
    }
    if (k > this.kPeak) this.kPeak = k;
    if (this.work) {
      this.eRef -= this.work;
      this.work = 0;
    }
    if (e < this.eRef) {
      this.eRef = e;
      return;
    }
    const ex = e - (this.eRef + Math.max(this.band * this.kPeak, this.floor));
    if (!(ex > 0) || !(k > 0)) return;
    const f = Math.sqrt(Math.max(0, 1 - ex / k));
    for (const b of this.bodies) {
      b.setLinvel(xyz(scl(v(b.linvel()), f)), true);
      b.setAngvel(xyz(scl(v(b.angvel()), f)), true);
    }
    this.removed += k * (1 - f * f);
  }
}

/**
 * Joint friction as in sim.ts: AngX velocity motor (accel-based, gain 1e9, target 0) limited to
 * τ_f = μ·m_j·|g|·R_BORE, with the stiction hold (STICK_SPEED 1e-2, SLIP 2e-4, HOLD_DEADBAND 1e-5).
 * `rel` gives {theta, omega} of the joint (B relative to A about the axis).
 */
export class Friction {
  constructor(W, j, mj, mu, rel) {
    this.W = W;
    this.j = j;
    this.tf = mu * mj * G * R_BORE;
    this.rel = rel;
    const raw = W.w.impulseJoints.raw;
    raw.jointConfigureMotorModel(j.handle, ANGX, 0);
    raw.jointConfigureMotorVelocity(j.handle, ANGX, 0, 1e9);
    raw.jointSetMotorMaxForce(j.handle, ANGX, this.tf);
    this.st = { x: rel().theta, stuck: false, at: 0, target: 0 };
    this.work = 0;
  }
  after() {
    const c = this.rel();
    const st = this.st;
    this.work = this.tf * Math.abs(c.theta - st.x);
    st.x = c.theta;
    if (!st.stuck && Math.abs(c.omega) < 1e-2) {
      st.stuck = true;
      st.at = c.theta;
    }
    let target = 0;
    if (st.stuck) {
      const off = c.theta - st.at;
      if (Math.abs(off) > 2e-4) st.stuck = false;
      else if (Math.abs(off) > 1e-5) target = -off / DT;
    }
    if (target !== st.target) {
      this.W.w.impulseJoints.raw.jointConfigureMotorVelocity(this.j.handle, ANGX, target, 1e9);
      st.target = target;
    }
  }
}

/** Relative angle/ω of gear body about its axis vs a fixed ground (for Friction). */
export function groundRel(g) {
  const st = {};
  return () => {
    const f = gearFrame(g);
    return { theta: twist(f.q, g.la, st), omega: omega(g.body, g.la) };
  };
}
/** Relative angle/ω of body B vs body A about world axis a (both rotating about a). */
export function bodyRel(A, B, a) {
  const sa = {};
  const sb = {};
  return () => ({
    theta: twist(q(B.rotation()), a, sb) - twist(q(A.rotation()), a, sa),
    omega: omega(B, a) - omega(A, a),
  });
}

/** Revolute joint error: world distance between the two anchors, and axis misalignment (rad). */
export function revError(j) {
  const b1 = j.body1();
  const b2 = j.body2();
  const p1 = add(v(b1.translation()), rot(q(b1.rotation()), v(j.anchor1())));
  const p2 = add(v(b2.translation()), rot(q(b2.rotation()), v(j.anchor2())));
  const ax1 = rot(qmul(q(b1.rotation()), q(j.frameX1())), [1, 0, 0]);
  const ax2 = rot(qmul(q(b2.rotation()), q(j.frameX2())), [1, 0, 0]);
  return { lin: len(sub(p2, p1)), ang: Math.acos(Math.min(1, Math.abs(dot(ax1, ax2)))) };
}

export const now = () => performance.now();
export const fmt = (x, d = 3) => (Math.abs(x) >= 1e-3 && Math.abs(x) < 1e5) || x === 0 ? x.toFixed(d) : x.toExponential(2);
