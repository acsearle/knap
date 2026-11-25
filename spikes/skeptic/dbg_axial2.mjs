// Where does the 0.07 rad ratio residual come from in the axial-slide case (F=50, limits [−0.2,1.5])?
import { R, makeWorld, revolute, Mesh, twist, q, DT, fmt, motor, PITCH } from './sk.mjs';
import { gearBody, AXZ } from './sk.mjs';
for (const lim of [true, false]) {
  const W = makeWorld({ gravity: [0, 0, 0] });
  const g1 = gearBody(W, [0, 0, 0], 1);
  const j1 = revolute(W, W.ground, g1.body, [0, 0, 0], [0, 0, 0], AXZ);
  motor(W, j1, 10);
  const S = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(2, 0, 0));
  W.w.createCollider(R.ColliderDesc.ball(0.3).setDensity(1).setCollisionGroups(0x00010000), S);
  const jd = R.JointData.prismatic({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  if (lim) { jd.limitsEnabled = true; jd.limits = [-0.2, 1.5]; }
  W.w.createImpulseJoint(jd, W.ground, S, true).setContactsEnabled(false);
  const g2 = gearBody(W, [2, 0, 0], 1, { angDamp: 1 });
  revolute(W, S, g2.body, [0, 0, 0], [0, 0, 0], AXZ);
  const M = new Mesh(W, g1.g, g2.g, { lead: true });
  const s1 = {}, s2 = {}; const a1 = twist(q(g1.body.rotation()), AXZ, s1), a2 = twist(q(g2.body.rotation()), AXZ, s2);
  const tr = [];
  for (let i = 0; i < 480; i++) {
    S.resetForces(true); S.addForce({ x: 0, y: 0, z: 50 }, true);
    M.update(); W.w.step();
    const res = twist(q(g2.body.rotation()), AXZ, s2) - a2 + twist(q(g1.body.rotation()), AXZ, s1) - a1;
    if ((i + 1) % 24 === 0) tr.push(`${fmt(S.translation().z, 2)}:${fmt(res, 3)}:${fmt(M.e / PITCH, 3)}`);
  }
  console.log(`limits=${lim}: z:θ2+θ1:phase(teeth) every 0.05 s: ${tr.join(' ')}`);
}
process.exit(0);
