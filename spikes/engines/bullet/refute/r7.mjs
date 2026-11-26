// Independent B7: free body, zero g, principal inertias (0.3381, 3.5977, 3.7237) g*stud^2 (the L-body), body frame =
// world frame at t 0, w0 = 20 rad/s along (1,.3,.2)/|.|, 30 s at dt 1/480. Stud units.
// node r7.mjs rigid <flags>      btRigidBody with setFlags(flags): 0 none, 2 explicit, 4 implicit world, 8 implicit body
// node r7.mjs mb <rk4 0|1>       floating-base btMultiBody with no links (gyro term on)
import load from './load.mjs';
const A = await load();
const V = (x, y, z) => new A.btVector3(x, y, z);
const kind = process.argv[2] || 'rigid', opt = +(process.argv[3] ?? 8), dt = 1 / 480;
const I = [0.3381, 3.5977, 3.7237], m = 1.9, n = Math.hypot(1, 0.3, 0.2), w0 = [1, 0.3, 0.2].map((x) => (20 * x) / n);
const cfg = new A.btDefaultCollisionConfiguration();
let getW, getQ, step, w;
const rot = (q, v) => { // rotate v by quaternion q=[x,y,z,w]
  const [x, y, z, s] = q, [a, b, c] = v; const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + s * tx + (y * tz - z * ty), b + s * ty + (z * tx - x * tz), c + s * tz + (x * ty - y * tx)]; };
const conj = ([x, y, z, s]) => [-x, -y, -z, s];
if (kind === 'rigid') {
  w = new A.btDiscreteDynamicsWorld(new A.btCollisionDispatcher(cfg), new A.btDbvtBroadphase(), new A.btSequentialImpulseConstraintSolver(), cfg);
  w.setGravity(V(0, 0, 0));
  const tr = new A.btTransform(); tr.setIdentity();
  const b = new A.btRigidBody(new A.btRigidBodyConstructionInfo(m, new A.btDefaultMotionState(tr), new A.btSphereShape(0.5), V(...I)));
  b.setActivationState(4); b.setDamping(0, 0); b.setFlags(opt); w.addRigidBody(b, 1, 0);
  b.setAngularVelocity(V(...w0));
  getW = () => { const v = b.getAngularVelocity(); return [v.x(), v.y(), v.z()]; };
  getQ = () => { const q = b.getWorldTransform().getRotation(); return [q.x(), q.y(), q.z(), q.w()]; };
} else {
  w = new A.btMultiBodyDynamicsWorld(new A.btCollisionDispatcher(cfg), new A.btDbvtBroadphase(), new A.btMultiBodyConstraintSolver(), cfg);
  w.setGravity(V(0, 0, 0));
  const mb = new A.btMultiBody(0, m, V(...I), false, false);
  mb.finalizeMultiDof(); mb.setLinearDamping(0); mb.setAngularDamping(0); mb.setCanSleep(false); mb.setMaxCoordinateVelocity(1e30); mb.setUseGyroTerm(true);
  if (opt) mb.useRK4Integration(true);
  w.addMultiBody(mb, 1, 0);
  mb.setBaseOmega(V(...w0));
  getW = () => { const v = mb.getBaseOmega(); return [v.x(), v.y(), v.z()]; };
  getQ = () => { const q = mb.getWorldToBaseRot(); return conj([q.x(), q.y(), q.z(), q.w()]); }; // base-to-world
}
const state = () => { const q = getQ(), wW = getW(), wb = rot(conj(q), wW); const Lb = wb.map((x, k) => I[k] * x); const LW = rot(q, Lb);
  return { E: 0.5 * wb.reduce((s, x, k) => s + I[k] * x * x, 0), L: LW }; };
const s0 = state(), L0 = Math.hypot(...s0.L), out = [];
for (let i = 1; i <= 30 * 480; i++) { w.stepSimulation(dt, 0); if (i % (480 * 10) === 0) { const s = state(); out.push(`${i / 480}s E ${((100 * (s.E - s0.E)) / s0.E).toFixed(3)}% |L| ${((100 * (Math.hypot(...s.L) - L0)) / L0).toFixed(3)}% |L-L0| ${((100 * Math.hypot(...s.L.map((x, k) => x - s0.L[k]))) / L0).toFixed(2)}%`); } }
console.log(`${kind} opt=${opt}: ${out.join(' | ')}`);
process.exit(0);
