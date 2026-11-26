// B9 hinge extras (ammojs3): reaction force, motor with max torque, friction-as-motor, limits, one-way limit.
//   node b9.mjs [regime]
import { ammo, World, RHO, G_REAL, f, regimeArg } from './lib.mjs';
const A = await ammo();
const reg = regimeArg();
const m = RHO * 7 * 0.92 * 0.92;
const mk = () => { const w = new World({ regime: reg }); const b = w.body(w.boxShape(3.5, 0.46, 0.46), m, [3, 0, 0], [0, 0, 0, 1], { mask: 0 }); const h = new A.btHingeConstraint(b, w.transform([-3, 0, 0]), false); w.w.addConstraint(h, true); return { w, b, h }; };
const forceK = (w) => 1 / (w.M * w.S * w.T * w.T); // sim force -> g*stud/s^2
{ // reaction force: hang it straight down first (rotate -90 deg about z)
  const w = new World({ regime: reg }); const s = Math.SQRT1_2;
  const b = w.body(w.boxShape(3.5, 0.46, 0.46), m, [0, -3, 0], [0, 0, -s, s], { mask: 0 });
  const h = new A.btHingeConstraint(b, w.transform([-3, 0, 0]), false); w.w.addConstraint(h, true);
  // btJointFeedback has no JS constructor: allocate its 4 x btVector3 (64 bytes) on the wasm heap and wrap it
  const ptr = A._malloc(64); A.HEAPU8.fill(0, ptr, ptr + 64); const fb = A.wrapPointer(ptr, A.btJointFeedback); h.setJointFeedback(fb); h.enableFeedback(true);
  w.step(480);
  const F = fb.get_m_appliedForceBodyA(); const k = forceK(w);
  console.log(`reaction (btJointFeedback.m_appliedForceBodyA) on hanging beam: (${f(F.x() * k)}, ${f(F.y() * k)}, ${f(F.z() * k)}) g*stud/s^2; expected (0, ${f(m * G_REAL)}, 0). getAppliedImpulse ${f(h.getAppliedImpulse())} (sim)`);
}
{ // motor with max torque: hold horizontal against gravity needs tau = m g 3
  for (const frac of [0.9, 1.1]) {
    const { w, b, h } = mk(); const tau = m * G_REAL * 3 * frac;
    h.enableAngularMotor(true, 0, tau * w.dtSim * w.M * w.S * w.S * w.T * w.T); // max IMPULSE per step
    w.step(480);
    console.log(`motor target 0, max impulse = ${frac} x (m g L) * dt: angle after 1 s ${f(h.getHingeAngle())} rad (${frac < 1 ? 'should fall' : 'should hold'})`);
  }
}
{ // limits
  const { w, b, h } = mk(); h.setLimit(-0.5, 0.5, 0.9, 0.3, 1.0); let mn = 0;
  for (let i = 0; i < 960; i++) { w.step(); mn = Math.min(mn, h.getHingeAngle()); }
  console.log(`hinge setLimit(-0.5, 0.5): min angle ${f(mn)} rad, end ${f(h.getHingeAngle())}`);
}
{ // one-way via multibody joint limit [lower, +inf)
  const w = new World({ regime: reg, multibody: true }); const { S, M, T } = w;
  const mb = new A.btMultiBody(1, 0, new A.btVector3(0, 0, 0), true, false);
  const Iz = (m * (49 + 0.85)) / 12;
  mb.setupRevolute(0, m * M, new A.btVector3(Iz * M * S * S, Iz * M * S * S, Iz * M * S * S), -1, new A.btQuaternion(0, 0, 0, 1), new A.btVector3(0, 0, 1), w.L(0, 0, 0), w.L(3, 0, 0), true);
  mb.finalizeMultiDof(); mb.setLinearDamping(0); mb.setAngularDamping(0); mb.setCanSleep(false); mb.setMaxCoordinateVelocity(1e30);
  w.w.addMultiBody(mb, 1, 0);
  const col = new A.btMultiBodyLinkCollider(mb, 0); col.setCollisionShape(w.boxShape(3.5, 0.46, 0.46)); col.setWorldTransform(w.transform([3, 0, 0])); w.w.addCollisionObject(col, 2, 0); mb.getLink(0).set_m_collider(col);
  const lim = new A.btMultiBodyJointLimitConstraint(mb, 0, 0, 1e9); lim.setMaxAppliedImpulse(1e30); w.w.addMultiBodyConstraint(lim);
  let mn = 0; for (let i = 0; i < 960; i++) { w.step(); mn = Math.min(mn, mb.getJointPos(0)); }
  const q1 = mb.getJointPos(0);
  // now push it the allowed way with a torque for 2 s
  const tq = 5 * m * G_REAL * 3 * M * S * S * T * T;
  for (let i = 0; i < 960; i++) { mb.addJointTorque(0, tq); w.step(); }
  console.log(`multibody one-way limit [0, 1e9]: gravity side min q ${f(mn)} rad (held at ${f(q1)}); driven the free way it turned to q ${f(mb.getJointPos(0))} rad (${f(mb.getJointPos(0) / (2 * Math.PI), 2)} turns)`);
}
process.exit(0);
