// B9 hinge extras, each checked on a beam-7 pendulum (pivot at end hole, axis Z, starts horizontal). node b9.mjs
import * as P from './lib.mjs';
const { PX, TL, physics } = P;
console.log('B9', P.settingsLine());
const qz = P.qAxisAngle([0, 1, 0], -Math.PI / 2);
const F = PX.PxRevoluteJointFlagEnum;
function pend() {
  const s = P.makeScene();
  const b = P.addDynamic(s, [{ geom: P.boxGeom(3.5, 0.46, 0.46) }], [3, 0, 0], undefined, P.bodyOpts());
  const j = TL.RevoluteJointCreate(physics, null, P.tf([0, 0, 0], qz), b, P.tf([-3 * P.L, 0, 0], qz));
  const tg = P.massG(b) * 1226.25 * 3; // gravity torque at horizontal, g*stud^2/s^2
  return { s, b, j, tg };
}
const scaleT = P.MASS * P.L * P.L;
// 1 friction via drive at 0 velocity with force limit
for (const k of [1.2, 0.8]) {
  const { s, b, j, tg } = pend();
  j.setRevoluteJointFlag(F.eDRIVE_ENABLED, true); j.setDriveVelocity(0); j.setDriveForceLimit(k * tg * scaleT);
  P.stepReal(s, 2);
  console.log(`friction (drive v=0, force limit ${k} x gravity torque): angle after 2 s ${P.f(j.getAngle(), 5)} rad, w ${P.f(P.av(b)[2], 5)} -> ${k > 1 ? 'should hold' : 'should slip'}`);
}
{ // 2 motor with max torque: target 50 rad/s, limit 2x gravity torque, no gravity -> constant accel until 50
  const { s, b, j, tg } = pend(); s.setGravity(P.v3(0, 0, 0));
  j.setRevoluteJointFlag(F.eDRIVE_ENABLED, true); j.setDriveVelocity(-50); j.setDriveForceLimit(tg * scaleT);
  const Ip = P.kinetic; const rec = [];
  P.stepReal(s, 1, (t, i) => { if (i % 96 === 0) rec.push(P.f(P.av(b)[2], 2)); });
  const m = P.massG(b), I = m * (7 * 7 + 0.92 * 0.92) / 12 + m * 9;
  console.log(`motor (target 50 rad/s, max torque = mgL): w every 0.2 s ${rec.join(' ')}; expected slope ${P.f(tg / I, 2)} rad/s^2 until 50 (sign: drive velocity is -w_z here)`);
}
{ // 3 angle limit: [-0.5, 0.5] rad, drops from horizontal (angle 0) -> must stop at the limit
  const { s, b, j } = pend();
  j.setLimit(new PX.PxJointAngularLimitPair(-0.5, 0.5)); j.setRevoluteJointFlag(F.eLIMIT_ENABLED, true);
  let mn = 9, mx = -9; P.stepReal(s, 3, () => { const a = j.getAngle(); mn = Math.min(mn, a); mx = Math.max(mx, a); });
  console.log(`limit [-0.5, 0.5]: angle range seen ${P.f(mn, 4)} .. ${P.f(mx, 4)}, end ${P.f(j.getAngle(), 4)}`);
}
{ // 4 one-way: limit [0, 3.1] is a stop on one side only (a ratchet would need re-anchoring the limit every step)
  const { s, b, j } = pend();
  j.setLimit(new PX.PxJointAngularLimitPair(0, 3.1)); j.setRevoluteJointFlag(F.eLIMIT_ENABLED, true);
  let mn = 9; P.stepReal(s, 2, () => { mn = Math.min(mn, j.getAngle()); });
  console.log(`one-sided limit [0, 3.1]: gravity pushes toward negative angle; min angle ${P.f(mn, 4)} (holds if ~0)`);
}
{ // 5 reaction force: hanging at rest straight down; PxConstraint.getForce should give m*g up on the body
  const s = P.makeScene();
  const b = P.addDynamic(s, [{ geom: P.boxGeom(3.5, 0.46, 0.46) }], [0, -3, 0], P.qAxisAngle([0, 0, 1], -Math.PI / 2), P.bodyOpts());
  const j = TL.RevoluteJointCreate(physics, null, P.tf([0, 0, 0], qz), b, P.tf([-3 * P.L, 0, 0], qz));
  P.stepReal(s, 0.5);
  const lin = P.v3(), ang = P.v3(); j.getConstraint().getForce(lin, ang);
  const fs = 1 / (P.MASS * P.L);
  console.log(`reaction force (hanging at rest): getForce linear (${P.f(lin.x * fs, 4)}, ${P.f(lin.y * fs, 4)}, ${P.f(lin.z * fs, 4)}) g*stud/s^2, weight m*g = ${P.f(P.massG(b) * 1226.25, 4)}; angular (${P.f(ang.x, 3)}, ${P.f(ang.y, 3)}, ${P.f(ang.z, 3)})`);
}
{ // 6 articulation joint friction (PxJointFrictionParams), static effort 1.2x and 0.8x gravity torque
  for (const k of [1.2, 0.8]) {
    const s = P.makeScene();
    const art = physics.createArticulationReducedCoordinate();
    art.setArticulationFlag(PX.PxArticulationFlagEnum.eFIX_BASE, true); art.setSolverIterationCounts(P.SET.pos, P.SET.vel);
    const root = art.createLink(null, P.tf()); root.attachShape(P.shapeOf(P.boxGeom(0.1, 0.1, 0.1))); PX.PxRigidBodyExt.prototype.updateMassAndInertia(root, P.DENS);
    const b = art.createLink(root, P.tf([3 * P.L, 0, 0])); b.attachShape(P.shapeOf(P.boxGeom(3.5, 0.46, 0.46))); PX.PxRigidBodyExt.prototype.updateMassAndInertia(b, P.DENS);
    b.setLinearDamping(0); b.setAngularDamping(0); b.setMaxAngularVelocity(1e4); b.setMaxLinearVelocity(1e7);
    const j = b.getInboundJoint(); const A = PX.PxArticulationAxisEnum.eTWIST;
    j.setJointType(PX.PxArticulationJointTypeEnum.eREVOLUTE); j.setMotion(A, PX.PxArticulationMotionEnum.eFREE);
    j.setParentPose(P.tf([0, 0, 0], qz)); j.setChildPose(P.tf([-3 * P.L, 0, 0], qz));
    const tg = P.massG(b) * 1226.25 * 3 * scaleT;
    j.setFrictionParams(A, new PX.PxJointFrictionParams(k * tg, k * tg, 0));
    art.setArticulationFlag(PX.PxArticulationFlagEnum.eDISABLE_SELF_COLLISION, true);
    s.addArticulation(art);
    P.stepReal(s, 2);
    console.log(`articulation joint friction (static=dynamic ${k} x gravity torque): angle after 2 s ${P.f(j.getJointPosition(A), 5)} rad, w ${P.f(j.getJointVelocity(A), 5)} -> ${k > 1 ? 'should hold' : 'should slip'}`);
  }
}
process.exit(0);
