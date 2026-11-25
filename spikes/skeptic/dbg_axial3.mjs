// Axial-slide breakdown: vary lead / motor strength; print gear-2 tilt, joint anchor separation.
import { R, makeWorld, revolute, Mesh, twist, q, v, DT, fmt, motor, PITCH, rot, len, sub, add, dot } from './sk.mjs';
import { gearBody, AXZ } from './sk.mjs';
for (const [lead, maxF, fb] of [[true, Infinity, true], [false, Infinity, true], [true, 1e4, true], [true, Infinity, false]]) {
  const W = makeWorld({ gravity: [0, 0, 0] });
  const g1 = gearBody(W, [0, 0, 0], 1);
  const j1 = revolute(W, W.ground, g1.body, [0, 0, 0], [0, 0, 0], AXZ);
  motor(W, j1, 10, 1e9, maxF);
  const S = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(2, 0, 0));
  W.w.createCollider(R.ColliderDesc.ball(0.3).setDensity(1).setCollisionGroups(0x00010000), S);
  const jd = R.JointData.prismatic({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  W.w.createImpulseJoint(jd, W.ground, S, true).setContactsEnabled(false);
  const g2 = gearBody(W, [2, 0, 0], 1, { angDamp: 1 });
  revolute(W, S, g2.body, [0, 0, 0], [0, 0, 0], AXZ);
  const M = new Mesh(W, g1.g, g2.g, { lead, feedback: fb });
  const tr = [];
  for (let i = 0; i < 480; i++) {
    S.resetForces(true); S.addForce({ x: 0, y: 0, z: 50 }, true);
    M.update(); W.w.step();
    if ((i + 1) % 24 === 0 && i > 200) {
      const ax = rot([...Object.values(g2.body.rotation())], [0, 0, 1]);
      const tilt = Math.acos(Math.min(1, ax[2]));
      const j = M.joint;
      const p1 = add(v(g1.body.translation()), rot(Object.values(g1.body.rotation()), v(j.anchor1())));
      const p2 = add(v(g2.body.translation()), rot(Object.values(g2.body.rotation()), v(j.anchor2())));
      tr.push(`z${fmt(S.translation().z, 2)} vz${fmt(S.linvel().z, 2)} tilt${fmt(tilt, 3)} sep${fmt(len(sub(p2, p1)), 3)} e${fmt(M.e / PITCH, 3)}`);
    }
  }
  console.log(`lead=${lead} motorMax=${maxF} fb=${fb}: ${tr.join(' | ')}`);
}
process.exit(0);
