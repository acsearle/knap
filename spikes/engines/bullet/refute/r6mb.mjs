// Independent B6 on btMultiBody (Featherstone): n beam-7 links, stud units, g 1226.25, dt 1/480/div.
// Energy from the engine's own link frames (localPosToWorld) and a finite-difference velocity, not from joint angles.
// node r6mb.mjs <nLinks> [div] [colliders 0|1] [gyro 0|1] [rk4 0|1]
import load from './load.mjs';
const A = await load();
const V = (x, y, z) => new A.btVector3(x, y, z);
const n = +process.argv[2] || 3, div = +process.argv[3] || 1, cols = +(process.argv[4] ?? 0), gyro = +(process.argv[5] ?? 1);
const g = 1226.25, dt = 1 / 480 / div, m = 0.3 * 7 * 0.92 * 0.92;
const Ix = (m * 2 * 0.92 ** 2) / 12, Iy = (m * (49 + 0.92 ** 2)) / 12, Iz = Iy;
const cfg = new A.btDefaultCollisionConfiguration();
const w = new A.btMultiBodyDynamicsWorld(new A.btCollisionDispatcher(cfg), new A.btDbvtBroadphase(), new A.btMultiBodyConstraintSolver(), cfg);
w.setGravity(V(0, -g, 0));
const mb = new A.btMultiBody(n, 0, V(0, 0, 0), true, false);
for (let i = 0; i < n; i++) mb.setupRevolute(i, m, V(Ix, Iy, Iz), i - 1, new A.btQuaternion(0, 0, 0, 1), V(0, 0, 1), V(i === 0 ? 0 : 3, 0, 0), V(3, 0, 0), true);
mb.finalizeMultiDof();
mb.setLinearDamping(0); mb.setAngularDamping(0); mb.setCanSleep(false); mb.setMaxCoordinateVelocity(1e30); mb.setUseGyroTerm(!!gyro); if (+(process.argv[6] ?? 0)) mb.useRK4Integration(true);
w.addMultiBody(mb, 1, 0);
if (cols) for (let i = 0; i < n; i++) { const c = new A.btMultiBodyLinkCollider(mb, i); c.setCollisionShape(new A.btBoxShape(V(3.5, 0.46, 0.46))); const t = new A.btTransform(); t.setIdentity(); t.setOrigin(V(3 + 6 * i, 0, 0)); c.setWorldTransform(t); w.addCollisionObject(c, 2, 0); mb.getLink(i).set_m_collider(c); }
const com = () => { const r = []; for (let i = 0; i < n; i++) { const p = mb.localPosToWorld(i, V(0, 0, 0)); r.push([p.x(), p.y()]); } return r; };
const ang = () => { let s = 0; const r = []; for (let i = 0; i < n; i++) { s += mb.getJointPos(i); r.push(s); } return r; };
let pc = com(), pa = ang();
const E = (c0, c1, a0, a1) => { let e = 0; for (let i = 0; i < n; i++) { const vx = (c1[i][0] - c0[i][0]) / dt, vy = (c1[i][1] - c0[i][1]) / dt, om = (a1[i] - a0[i]) / dt; e += 0.5 * m * (vx * vx + vy * vy) + 0.5 * Iz * om * om + m * g * 0.5 * (c0[i][1] + c1[i][1]); } return e; };
const swing = m * g * (n === 1 ? 3 : 27), E0 = n === 1 ? 0 : 0; // released from rest, horizontal: E0 = 0
const log = []; const t0 = process.cpuUsage();
console.log(`start com y ${pc.map((c) => c[1].toFixed(3)).join(',')} x ${pc.map((c) => c[0].toFixed(3)).join(',')}`);
for (let i = 1; i <= 10 * 480 * div; i++) {
  w.stepSimulation(dt, 0);
  const c = com(), a = ang();
  if (i % (480 * div * 2) === 0) log.push(((100 * (E(pc, c, pa, a) - E0)) / swing).toFixed(2));
  pc = c; pa = a;
}
const u = process.cpuUsage(t0);
console.log(`multibody n=${n} dt=1/${480 * div} colliders=${cols} gyro=${gyro} rk4=${process.argv[6] ?? 0}: dE% at 2..10 s [${log.join(', ')}]  cpu ${((u.user + u.system) / 10000).toFixed(1)} ms/real s`);
process.exit(0);
