// B8 gears via btMultiBodyGearConstraint (the only gear constraint either JS build exposes):
// node b8.mjs <regime> [--erp=x] [--maxv=sim rad/s (Bullet default 100)] [--dtdiv=k]
import { ammo, World, RHO, f, regimeArg, flag } from './lib.mjs';
const A = await ammo();
const reg = regimeArg(), erp = flag('erp', 0), maxv = flag('maxv', null), dtdiv = flag('dtdiv', 1);
const w = new World({ regime: reg, multibody: true, dt: 1 / 480 / dtdiv });
const { S, M, T } = w;
const cyl = (r) => { const m = RHO * Math.PI * r * r * 0.92; return { m, Iz: 0.5 * m * r * r, Ix: (m * (3 * r * r + 0.92 * 0.92)) / 12 }; };
const s = cyl(1), b = cyl(2.5), RATIO = 2.5;
const mb = new A.btMultiBody(2, 0, new A.btVector3(0, 0, 0), true, false);
const q0 = new A.btQuaternion(0, 0, 0, 1), axis = new A.btVector3(0, 0, 1), I = (c) => new A.btVector3(c.Ix * M * S * S, c.Ix * M * S * S, c.Iz * M * S * S);
mb.setupRevolute(0, s.m * M, I(s), -1, q0, axis, w.L(0, 0, 0), w.L(0, 0, 0), true);
mb.setupRevolute(1, b.m * M, I(b), -1, q0, axis, w.L(3.5, 0, 0), w.L(0, 0, 0), true);
mb.finalizeMultiDof();
mb.setLinearDamping(0); mb.setAngularDamping(0); mb.setCanSleep(false);
if (maxv !== null) mb.setMaxCoordinateVelocity(maxv);
const defaultMaxV = mb.getMaxCoordinateVelocity();
w.w.addMultiBody(mb, 1, 0);
// link colliders (no contacts: mask 0) so the links take part in simulation islands
if (!flag('nocol', 0)) for (const [i, r] of [[0, 1], [1, 2.5]]) {
  const col = new A.btMultiBodyLinkCollider(mb, i);
  col.setCollisionShape(w.cylShape(r, 0.46, 'z'));
  col.setWorldTransform(w.transform([i === 0 ? 0 : 3.5, 0, 0]));
  w.w.addCollisionObject(col, 2, 0);
  mb.getLink(i).set_m_collider(col);
}
const idT = new A.btTransform(); idT.setIdentity(); const id = idT.getBasis(), z = new A.btVector3(0, 0, 0);
const gear = new A.btMultiBodyGearConstraint(mb, 0, mb, 1, z, z, id, id);
gear.setGearRatio(RATIO); gear.setMaxAppliedImpulse(1e30); if (erp) gear.setErp(erp);
w.w.addMultiBodyConstraint(gear);
const Ieff = s.Iz + b.Iz / (RATIO * RATIO);
const tau = Ieff * 100; // reaches 100 rad/s in ~1 s (real g*stud^2/s^2)
const tauSim = tau * M * S * S * T * T;
const KE = () => 0.5 * s.Iz * (mb.getJointVel(0) / T) ** 2 + 0.5 * b.Iz * (mb.getJointVel(1) / T) ** 2;
const phase = () => mb.getJointPos(0) + RATIO * mb.getJointPos(1); // rad of the small gear
const teeth = (e) => (e * 16) / (2 * Math.PI);
let work = 0, t = 0, maxPh = 0;
const dt = 1 / 480 / dtdiv;
function run(target, coastS) {
  let driving = true, tRel = null;
  const log = [];
  for (let i = 0; t < 30; i++) {
    const w0 = mb.getJointVel(0) / T;
    if (driving && w0 >= target) { driving = false; tRel = t; log.push(`reached ${target} at t ${f(t, 3)} s: KE/work ${f(KE() / work, 5)}, phase err ${f(teeth(phase()), 4)} teeth, w_big/w_small ${f(mb.getJointVel(1) / mb.getJointVel(0), 6)}`); }
    if (driving) mb.addJointTorque(0, tauSim);
    w.step(); t += dt;
    const w1 = mb.getJointVel(0) / T;
    if (driving) work += tau * 0.5 * (w0 + w1) * dt;
    maxPh = Math.max(maxPh, Math.abs(teeth(phase())));
    if (!driving && t - tRel >= coastS) break;
    if (t > 25) { log.push(`never reached ${target}: w_small ${f(w1, 3)} rad/s at t ${f(t, 2)}`); break; }
  }
  log.push(`after ${coastS} s coast: w_small ${f(mb.getJointVel(0) / T, 3)} w_big ${f(mb.getJointVel(1) / T, 3)} rad/s, KE/work ${f(KE() / work, 5)}, phase err ${f(teeth(phase()), 4)} teeth (max so far ${f(maxPh, 4)})`);
  return log;
}
console.log(`B8 regime=${reg} dt=1/${480 * dtdiv} erp=${erp} maxCoordinateVelocity=${maxv ?? 'default ' + defaultMaxV} (sim rad/s; = ${f(defaultMaxV / T, 1)} real rad/s)`);
for (const l of run(100, 2)) console.log('  ' + l);
for (const l of run(300, 2)) console.log('  ' + l);
process.exit(0);
