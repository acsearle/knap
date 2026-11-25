// Why does the axial slider stall near z≈1 when meshed? Controls: no mesh / mesh, motor on/off.
import { R, makeWorld, revolute, Mesh, twist, q, DT, fmt, motor } from './sk.mjs';
import { gearBody, AXZ } from './sk.mjs';
for (const [mesh, drive, lim] of [[false, true, true], [true, false, true], [true, true, true], [true, true, false]]) {
  const W = makeWorld({ gravity: [0, 0, 0] });
  const g1 = gearBody(W, [0, 0, 0], 1);
  const j1 = revolute(W, W.ground, g1.body, [0, 0, 0], [0, 0, 0], AXZ);
  if (drive) motor(W, j1, 10);
  const S = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(2, 0, 0));
  W.w.createCollider(R.ColliderDesc.ball(0.3).setDensity(1).setCollisionGroups(0x00010000), S);
  const jd = R.JointData.prismatic({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  if (lim) { jd.limitsEnabled = true; jd.limits = [-0.2, 1.5]; }
  W.w.createImpulseJoint(jd, W.ground, S, true).setContactsEnabled(false);
  const g2 = gearBody(W, [2, 0, 0], 1, { angDamp: 1 });
  revolute(W, S, g2.body, [0, 0, 0], [0, 0, 0], AXZ);
  const M = mesh ? new Mesh(W, g1.g, g2.g, { lead: true }) : null;
  const zs = [];
  for (let i = 0; i < 480; i++) {
    S.resetForces(true); S.addForce({ x: 0, y: 0, z: 500 }, true);
    M?.update(); W.w.step();
    if ((i + 1) % 24 === 0) zs.push(fmt(S.translation().z, 3) + (M ? '/' + fmt(M.lam ?? 0, 3) : ''));
  }
  console.log(`mesh=${mesh} drive=${drive} limits=${lim}: z every 0.05 s: ${zs.join(' ')}`);
}
process.exit(0);
