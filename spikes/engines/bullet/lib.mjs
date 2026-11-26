// Shared helpers for the Bullet (ammo.js) battery. Everything the tests see is in REAL units:
// studs (8 mm), real seconds, grams. The engine runs in "sim units":
//   length_sim = S * studs        (S = sim length units per stud)
//   time_sim   = t_real / T       (T = real seconds per sim second)
//   mass_sim   = M * grams
// so  v_sim = v_real * S * T,  w_sim = w_real * T,  g_sim = 1226.25 * S * T^2,
//     force_sim = F_real * M * S * T^2,  torque_sim = tau_real * M * S^2 * T^2,
//     impulse_sim = J_real * M * S * T.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const G_REAL = 1226.25; // studs/s^2
export const RHO = 0.3; // g per stud^3
export const DT = 1 / 480; // real s
export const MU = Math.SQRT1_2; // Bullet multiplies frictions: sqrt(.5)^2 = 0.5 per pair

let A = null;
export let PKG = process.env.AMMO || 'ammojs3';
export async function ammo() {
  if (A) return A;
  const path = PKG === 'typed' ? 'ammojs-typed/wasm' : 'ammojs3/dist/ammo.wasm.js';
  A = await require(path)();
  return A;
}

// Regimes. `margin` is a collision margin in sim units, or null for Bullet's default (0.04 units).
export const REGIMES = {
  stud: { S: 1, T: 1, M: 1, note: '1 unit = 1 stud, real g = 1226 units/s^2, dt 1/480 s (what knap does with Rapier)' },
  si: { S: 0.008, T: 1, M: 1e-3, note: '1 unit = 1 m, kg, g = 9.81, dt 1/480 s; real 8 mm parts (owner regime 1)' },
  big: { S: 1, T: Math.sqrt(9.81 / G_REAL), M: 1e-3 * 125 ** 3, note: '1 stud drawn as 1 m, kg (a 0.92 m cube weighs ~234 kg), g = 9.81, dt_sim = 1/42.9 s (owner regime 2: same physics, time stretched by 11.2)' },
};
export function regime(name) {
  const r = REGIMES[name];
  if (!r) throw new Error('regime ' + name);
  return r;
}

export class World {
  constructor(o = {}) {
    this.A = A;
    const r = typeof o.regime === 'string' ? regime(o.regime) : (o.regime || regime('stud'));
    Object.assign(this, { S: r.S, T: r.T, M: r.M });
    this.marginStud = o.marginStud ?? null; // null = Bullet default 0.04 sim units
    this.dtSim = (o.dt ?? DT) / this.T;
    this.cfg = new A.btDefaultCollisionConfiguration();
    this.disp = new A.btCollisionDispatcher(this.cfg);
    this.bp = new A.btDbvtBroadphase();
    this.multibody = !!o.multibody;
    if (this.multibody) {
      this.solver = new A.btMultiBodyConstraintSolver();
      this.w = new A.btMultiBodyDynamicsWorld(this.disp, this.bp, this.solver, this.cfg);
    } else {
      this.solver = (o.solver ?? (flag('mlcp', 0) ? 'mlcp' : 'si')) === 'mlcp' ? new A.btMLCPSolver(new A.btDantzigSolver()) : new A.btSequentialImpulseConstraintSolver();
      this.w = new A.btDiscreteDynamicsWorld(this.disp, this.bp, this.solver, this.cfg);
    }
    const g = o.gravity ?? G_REAL;
    this.gReal = g;
    this.w.setGravity(this.v(0, -g * this.S * this.T * this.T, 0));
    const si = this.w.getSolverInfo();
    const it = o.iterations ?? flag('iters', null), sp = o.splitImpulse ?? flag('split', null);
    if (it) si.set_m_numIterations(it);
    if (sp !== null && sp !== undefined) si.set_m_splitImpulse(!!sp);
    this.iterations = si.get_m_numIterations(); this.split = si.get_m_splitImpulse();
    if (flag('sat', 0)) this.w.getDispatchInfo().set_m_enableSatConvex(true);
    this.bodies = [];
    this.tmpV = new A.btVector3(0, 0, 0);
  }
  v(x, y, z) { return new A.btVector3(x, y, z); }
  // studs -> sim vector
  L(x, y, z) { return new A.btVector3(x * this.S, y * this.S, z * this.S); }
  applyMargin(shape) {
    if (this.marginStud !== null) shape.setMargin(this.marginStud * this.S);
    return shape;
  }
  boxShape(hx, hy, hz) { return this.applyMargin(new A.btBoxShape(this.L(hx, hy, hz))); }
  // axis 'x'|'y'|'z'
  cylShape(r, halfLen, axis = 'z') {
    const C = axis === 'x' ? A.btCylinderShapeX : axis === 'y' ? A.btCylinderShape : A.btCylinderShapeZ;
    const he = axis === 'x' ? this.L(halfLen, r, r) : axis === 'y' ? this.L(r, halfLen, r) : this.L(r, r, halfLen);
    return this.applyMargin(new C(he));
  }
  // regular n-gon prism, axis along `axis`, points in studs. poly: call initializePolyhedralFeatures
  prismShape(n, r, halfLen, axis = 'y', poly = false, phase = 0) {
    const s = new A.btConvexHullShape();
    for (let i = 0; i < n; i++) {
      const a = phase + (2 * Math.PI * i) / n;
      const c = r * Math.cos(a), d = r * Math.sin(a);
      for (const h of [-halfLen, halfLen]) {
        const p = axis === 'y' ? [c, h, d] : axis === 'z' ? [c, d, h] : [h, c, d];
        s.addPoint(this.L(...p), i === n - 1 && h === halfLen);
      }
    }
    this.applyMargin(s);
    if (poly) s.initializePolyhedralFeatures(0);
    return s;
  }
  // box as a convex hull of its 8 corners (so it can carry polyhedral features)
  boxHull(hx, hy, hz, poly = true) {
    const s = new A.btConvexHullShape();
    for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) s.addPoint(this.L(x, y, z), x > 0 && y > 0 && z > 0);
    this.applyMargin(s);
    if (poly) s.initializePolyhedralFeatures(0);
    return s;
  }
  planeShape() { return new A.btStaticPlaneShape(this.v(0, 1, 0), 0); }
  // mass in grams (0 = fixed). pos in studs. q = [x,y,z,w]. inertiaReal optional [Ix,Iy,Iz] g*stud^2
  body(shape, massG, pos, q = [0, 0, 0, 1], o = {}) {
    const tr = new A.btTransform();
    tr.setIdentity();
    tr.setOrigin(this.L(...pos));
    tr.setRotation(new A.btQuaternion(...q));
    const m = massG * this.M;
    const inertia = new A.btVector3(0, 0, 0);
    if (m > 0) {
      if (o.inertia) inertia.setValue(...o.inertia.map((x) => x * this.M * this.S * this.S));
      else shape.calculateLocalInertia(m, inertia);
    }
    const ms = new A.btDefaultMotionState(tr);
    const info = new A.btRigidBodyConstructionInfo(m, ms, shape, inertia);
    const b = new A.btRigidBody(info);
    b.setFriction(o.friction ?? MU);
    b.setRestitution(o.restitution ?? 0);
    b.setActivationState(4); // DISABLE_DEACTIVATION
    if (o.ccd) { b.setCcdMotionThreshold(o.ccd * this.S); b.setCcdSweptSphereRadius(o.ccd * 0.5 * this.S); }
    if (o.mask !== undefined) this.w.addRigidBody(b, o.group ?? 1, o.mask); else this.w.addRigidBody(b);
    b._massG = massG;
    b._inertiaSim = [inertia.x(), inertia.y(), inertia.z()];
    this.bodies.push(b);
    return b;
  }
  step(n = 1) { for (let i = 0; i < n; i++) this.w.stepSimulation(this.dtSim, 0); }
  // --- readback in real units
  pos(b) { const o = b.getWorldTransform().getOrigin(); return [o.x() / this.S, o.y() / this.S, o.z() / this.S]; }
  quat(b) { const q = b.getWorldTransform().getRotation(); return [q.x(), q.y(), q.z(), q.w()]; }
  vel(b) { const v = b.getLinearVelocity(); const k = 1 / (this.S * this.T); return [v.x() * k, v.y() * k, v.z() * k]; }
  angvel(b) { const v = b.getAngularVelocity(); const k = 1 / this.T; return [v.x() * k, v.y() * k, v.z() * k]; }
  setVel(b, v) { b.setLinearVelocity(this.v(...v.map((x) => x * this.S * this.T))); }
  setAngvel(b, w) { b.setAngularVelocity(this.v(...w.map((x) => x * this.T))); }
  // world-frame inertia (real g*stud^2) and energy (real g*stud^2/s^2)
  worldInertia(b) {
    const R = quatToMat(this.quat(b));
    const d = b._inertiaSim.map((x) => x / (this.M * this.S * this.S));
    const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) I[i][j] += R[i][k] * d[k] * R[j][k];
    return I;
  }
  kinetic(b) {
    const v = this.vel(b), w = this.angvel(b), I = this.worldInertia(b);
    const Iw = matVec(I, w);
    return 0.5 * b._massG * dot(v, v) + 0.5 * dot(w, Iw);
  }
  rotKE(b) { const w = this.angvel(b); return 0.5 * dot(w, matVec(this.worldInertia(b), w)); }
  angMom(b) { return matVec(this.worldInertia(b), this.angvel(b)); }
  potential(b) { return b._massG * this.gReal * this.pos(b)[1]; }
  energy(list = this.bodies.filter((b) => b._massG > 0)) { return list.reduce((s, b) => s + this.kinetic(b) + this.potential(b), 0); }
  // local point (studs, body frame) -> world (studs)
  toWorld(b, p) { const R = quatToMat(this.quat(b)); const c = this.pos(b); const r = matVec(R, p); return [c[0] + r[0], c[1] + r[1], c[2] + r[2]]; }
  contacts(b1, b2) {
    const d = this.w.getDispatcher();
    let n = 0;
    for (let i = 0; i < d.getNumManifolds(); i++) {
      const m = d.getManifoldByIndexInternal(i);
      const a = A.getPointer(b1), b = b2 ? A.getPointer(b2) : null;
      if ((A.getPointer(m.getBody0()) === a && (b === null || A.getPointer(m.getBody1()) === b)) || (A.getPointer(m.getBody1()) === a && (b === null || A.getPointer(m.getBody0()) === b))) {
        n += m.getNumContacts();
      }
    }
    return n;
  }
  transform(pos, q = [0, 0, 0, 1]) {
    const tr = new A.btTransform(); tr.setIdentity(); tr.setOrigin(this.L(...pos)); tr.setRotation(new A.btQuaternion(...q)); return tr;
  }
}

export function quatToMat([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => Math.sqrt(dot(a, a));
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export function matVec(M, v) { return M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]); }
// tilt angle (rad) of body's local up (0,1,0) from world up
export function tilt(q) { const R = quatToMat(q); return Math.acos(Math.min(1, Math.abs(R[1][1]))); }
export const f = (x, d = 4) => (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d));
export function cpuTimer() { const t0 = process.cpuUsage(); return () => { const u = process.cpuUsage(t0); return (u.user + u.system) / 1000; }; }
export const regimeArg = () => (process.argv.slice(2).find((a) => !a.startsWith('-')) || 'stud');
export function flag(name, def) {
  const a = process.argv.find((x) => x.startsWith('--' + name + '='));
  return a ? Number(a.split('=')[1]) : def;
}
