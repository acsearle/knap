// Independent B6a/B6b: beam-7 links (7 x .92 x .92 studs, 0.3 g/stud^3) in stud units, g 1226.25, dt 1/480/div.
// Rigid btHingeConstraint (or btPoint2PointConstraint, which is enough for a planar chain) to the world and between links.
// node r6.mjs <nLinks> <variant> [div]   variant: hinge | p2p | erp0 | erp08 (m_erp 0.8) | erp09 | erp1 (m_erp 1.0) | it100
// Reports energy change (% of the swing energy) and the max height reached by link 1's free end after release.
import load from './load.mjs';
const A = await load();
const V = (x, y, z) => new A.btVector3(x, y, z);
const n = +process.argv[2] || 1, variant = process.argv[3] || 'hinge', div = +process.argv[4] || 1;
const g = 1226.25, dt = 1 / 480 / div, m = 0.3 * 7 * 0.92 * 0.92;
const cfg = new A.btDefaultCollisionConfiguration();
const w = new A.btDiscreteDynamicsWorld(new A.btCollisionDispatcher(cfg), new A.btDbvtBroadphase(), new A.btSequentialImpulseConstraintSolver(), cfg);
w.setGravity(V(0, -g, 0));
const si = w.getSolverInfo();
if (variant === 'erp0') si.set_m_erp(0);
if (variant.startsWith('erp') && variant !== 'erp0') si.set_m_erp(+('0.' + variant.slice(4)) || 1);
if (variant === 'it100') si.set_m_numIterations(100);
const links = [];
for (let i = 0; i < n; i++) {
  const sh = new A.btBoxShape(V(3.5, 0.46, 0.46)); const I = V(0, 0, 0); sh.calculateLocalInertia(m, I);
  const tr = new A.btTransform(); tr.setIdentity(); tr.setOrigin(V(3 + 6 * i, 0, 0));
  const b = new A.btRigidBody(new A.btRigidBodyConstructionInfo(m, new A.btDefaultMotionState(tr), sh, I));
  b.setActivationState(4); b.setDamping(0, 0); w.addRigidBody(b, 1, 0); b.Iz = I.z(); links.push(b);
}
const fr = (x) => { const t = new A.btTransform(); t.setIdentity(); t.setOrigin(V(x, 0, 0)); return t; };
const cons = [];
if (variant === 'p2p') {
  cons.push(new A.btPoint2PointConstraint(links[0], V(-3, 0, 0)));
  for (let i = 1; i < n; i++) cons.push(new A.btPoint2PointConstraint(links[i - 1], links[i], V(3, 0, 0), V(-3, 0, 0)));
} else {
  cons.push(new A.btHingeConstraint(links[0], fr(-3), false));
  for (let i = 1; i < n; i++) cons.push(new A.btHingeConstraint(links[i - 1], links[i], fr(3), fr(-3), false));
}
if (variant === 'hingeERP1') for (const c of cons) { c.setParam(2 /*BT_CONSTRAINT_STOP_ERP? see below*/, 0, -1); }
for (const c of cons) w.addConstraint(c, true);
const E = () => links.reduce((s, b) => { const v = b.getLinearVelocity(), om = b.getAngularVelocity(); return s + 0.5 * m * (v.x() ** 2 + v.y() ** 2 + v.z() ** 2) + 0.5 * b.Iz * om.z() ** 2 + 0.5 * b.Iz * (om.x() ** 2 + om.y() ** 2) * 0 + m * g * b.getWorldTransform().getOrigin().y(); }, 0);
const swing = m * g * (n === 1 ? 3 : 3 + 9 + 15), E0 = E();
let maxEnd = -1e9, sep = 0; const t0 = process.cpuUsage();
const log = [];
for (let i = 1; i <= 10 * 480 * div; i++) {
  w.stepSimulation(dt, 0);
  const T = links[0].getWorldTransform(), o = T.getOrigin(), R = T.getBasis();
  // pivot of link 0 in world: o + R*(-3,0,0)
  const px = o.x() - 3 * R.getRow(0).x(), py = o.y() - 3 * R.getRow(1).x();
  sep = Math.max(sep, Math.hypot(px, py));
  if (n === 1) { const ey = o.y() + 3.5 * R.getRow(1).x(); if (i > 480 * div / 2) maxEnd = Math.max(maxEnd, ey); }
  if (i % (480 * div * 2) === 0) log.push(((100 * (E() - E0)) / swing).toFixed(2));
}
const u = process.cpuUsage(t0);
console.log(`n=${n} ${variant} dt=1/${480 * div}: dE% at 2,4,6,8,10 s [${log.join(', ')}]  root-pivot sep max ${sep.toFixed(4)} studs${n === 1 ? `  highest free-end y after 0.5 s ${maxEnd.toFixed(3)} (release height 0; tip reaches 0 if no loss)` : ''}  cpu ${((u.user + u.system) / 1000 / 10).toFixed(1)} ms/real s`);
process.exit(0);
