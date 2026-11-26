// Independent B8: two wheels (r 1 and r 2.5, length .92, 0.3 g/stud^3) on revolute joints of ONE fixed-base multibody,
// 3.5 studs apart, btMultiBodyGearConstraint ratio 2.5. Stud units, dt 1/480. Constant torque on the small wheel
// up to the target speed, then released for 2 s. Gravity on (axes are horizontal along Z, so gravity does no work).
// node r8.mjs [maxv sim rad/s, default = Bullet's] [erp] [colliders 0|1] [target rad/s]
import load from './load.mjs';
const A = await load();
const V = (x, y, z) => new A.btVector3(x, y, z);
const maxv = process.argv[2] && process.argv[2] !== '-' ? +process.argv[2] : null, erp = +(process.argv[3] ?? 0), cols = +(process.argv[4] ?? 1), target = +(process.argv[5] ?? 100);
const dt = 1 / 480, R = 2.5;
const wheel = (r) => { const m = 0.3 * Math.PI * r * r * 0.92; return { m, Iz: 0.5 * m * r * r, Ix: (m * (3 * r * r + 0.92 ** 2)) / 12 }; };
const s = wheel(1), b = wheel(2.5);
const cfg = new A.btDefaultCollisionConfiguration();
const w = new A.btMultiBodyDynamicsWorld(new A.btCollisionDispatcher(cfg), new A.btDbvtBroadphase(), new A.btMultiBodyConstraintSolver(), cfg);
w.setGravity(V(0, -1226.25, 0));
const mb = new A.btMultiBody(2, 0, V(0, 0, 0), true, false);
const q = new A.btQuaternion(0, 0, 0, 1);
mb.setupRevolute(0, s.m, V(s.Ix, s.Ix, s.Iz), -1, q, V(0, 0, 1), V(0, 0, 0), V(0, 0, 0), true);
mb.setupRevolute(1, b.m, V(b.Ix, b.Ix, b.Iz), -1, q, V(0, 0, 1), V(3.5, 0, 0), V(0, 0, 0), true);
mb.finalizeMultiDof(); mb.setLinearDamping(0); mb.setAngularDamping(0); mb.setCanSleep(false);
if (maxv !== null) mb.setMaxCoordinateVelocity(maxv);
w.addMultiBody(mb, 1, 0);
if (cols) [[0, 1, 0], [1, 2.5, 3.5]].forEach(([i, r, x]) => { const c = new A.btMultiBodyLinkCollider(mb, i); c.setCollisionShape(new A.btCylinderShapeZ(V(r, r, 0.46))); const t = new A.btTransform(); t.setIdentity(); t.setOrigin(V(x, 0, 0)); c.setWorldTransform(t); w.addCollisionObject(c, 2, 0); mb.getLink(i).set_m_collider(c); });
const id = new A.btTransform(); id.setIdentity();
const gc = new A.btMultiBodyGearConstraint(mb, 0, mb, 1, V(0, 0, 0), V(0, 0, 0), id.getBasis(), id.getBasis());
gc.setGearRatio(R); gc.setMaxAppliedImpulse(1e30); if (erp) gc.setErp(erp);
w.addMultiBodyConstraint(gc);
const tau = (s.Iz + b.Iz / (R * R)) * 100; // 100 rad/s per second ideal
let work = 0, t = 0, maxErr = 0, released = null;
const KE = () => 0.5 * s.Iz * mb.getJointVel(0) ** 2 + 0.5 * b.Iz * mb.getJointVel(1) ** 2;
const errTeeth = () => ((mb.getJointPos(0) + R * mb.getJointPos(1)) * 16) / (2 * Math.PI);
for (let i = 0; i < 480 * 30; i++) {
  const w0 = mb.getJointVel(0);
  const drive = released === null;
  if (drive) mb.addJointTorque(0, tau);
  w.stepSimulation(dt, 0); t += dt;
  if (drive) work += tau * (mb.getJointPos(0) - (mb._q ?? 0));
  mb._q = mb.getJointPos(0);
  maxErr = Math.max(maxErr, Math.abs(errTeeth()));
  if (drive && mb.getJointVel(0) >= target) { released = t; console.log(`reached ${target} rad/s at ${t.toFixed(3)} s (ideal ${(target / 100).toFixed(3)}), ratio ${(mb.getJointVel(1) / mb.getJointVel(0)).toFixed(6)}, KE/work ${(KE() / work).toFixed(5)}`); }
  if (released !== null && t - released >= 2) break;
}
console.log(`maxv=${maxv ?? 'default ' + mb.getMaxCoordinateVelocity()} erp=${erp} colliders=${cols}: end t ${t.toFixed(2)} w_small ${mb.getJointVel(0).toFixed(3)} w_big ${mb.getJointVel(1).toFixed(3)} KE/work ${(KE() / work).toFixed(5)} err ${errTeeth().toExponential(2)} teeth (max ${maxErr.toExponential(2)})`);
process.exit(0);
