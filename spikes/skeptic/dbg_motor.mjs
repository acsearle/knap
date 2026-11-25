// Calibrate the AngX velocity motor (accel model 0, gain 1e9) max force on a pendulum arm body.
import { R, makeWorld, revolute, twist, omega, q, DT, G, fmt, weight, motor, arc, xyzw } from './sk.mjs';
import { NO, AXZ } from './sk.mjs';
for (const disc of [false, true]) for (const f of [0.9, 1.1, 2]) {
  const W = makeWorld();
  const body = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false));
  if (disc) W.w.createCollider(R.ColliderDesc.cylinder(0.5, 0.5).setRotation(xyzw(arc([0,1,0],AXZ))).setCollisionGroups(NO), body);
  W.w.createCollider(weight([10, 0, 0], 20).setCollisionGroups(NO), body);
  const j = revolute(W, W.ground, body, [0, 0, 0], [0, 0, 0], AXZ);
  motor(W, j, 1, 1e9, f * 20 * G * 10);
  const s = {}; twist(q(body.rotation()), AXZ, s);
  const tr = [];
  for (let i = 0; i < 480; i++) { W.w.step(); const t = twist(q(body.rotation()), AXZ, s); if ((i+1) % 48 === 0) tr.push(fmt(t, 3)); }
  console.log(`disc=${disc} f=${f}: θ every 0.1 s: ${tr.join(' ')}`);
}
process.exit(0);
