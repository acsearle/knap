// Control: does a revolute angle limit hold a directly-motored gear (no mesh)?
import { R, makeWorld, twist, q, fmt, motor } from './sk.mjs';
import { gearBody, AXZ } from './sk.mjs';
for (const how of ['jointdata', 'raw']) {
  const W = makeWorld({ gravity: [0, 0, 0] });
  const g = gearBody(W, [0, 0, 0], 1);
  const jd = R.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  if (how === 'jointdata') { jd.limitsEnabled = true; jd.limits = [-0.5, 0.5]; }
  const j = W.w.createImpulseJoint(jd, W.ground, g.body, true);
  if (how === 'raw') j.setLimits(-0.5, 0.5);
  motor(W, j, 2, 1e9, 1e3);
  const s = {}; twist(q(g.body.rotation()), AXZ, s);
  for (let i = 0; i < 480; i++) { W.w.step(); twist(q(g.body.rotation()), AXZ, s); }
  console.log(`${how}: θ after 1 s with motor 2 rad/s and limit ±0.5: ${fmt(s.acc, 4)}`);
}
process.exit(0);
