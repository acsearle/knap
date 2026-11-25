// Attribute the angular-momentum error of the free-floating 0.5:2.5 gearbox: lead / feedback / iterations.
import { R, makeWorld, revolute, Mesh, omega, fmt, len } from './sk.mjs';
import { gearBody, AXZ, angMom, inertiaAbout } from './sk.mjs';
for (const [lead, fb, iters] of [[true, true, 240], [false, true, 240], [false, false, 240], [true, true, 60], [true, true, 960]]) {
  const W = makeWorld({ gravity: [0, 0, 0], iters });
  const F = W.w.createRigidBody(R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(1, 0, -1));
  W.w.createCollider(R.ColliderDesc.cuboid(2, 0.5, 0.5).setDensity(1).setCollisionGroups(0x00010000), F);
  const A = gearBody(W, [0, 0, 0], 0.5), B = gearBody(W, [3, 0, 0], 2.5);
  revolute(W, F, A.body, [-1, 0, 1], [0, 0, 0], AXZ);
  revolute(W, F, B.body, [2, 0, 1], [0, 0, 0], AXZ);
  const M = new Mesh(W, A.g, B.g, { lead, feedback: fb });
  let maxL = 0, scale = 0, Lhalf = 0;
  for (let i = 0; i < 480 * 2; i++) {
    A.body.resetTorques(true); F.resetTorques(true);
    if (i < 240) { A.body.addTorque({ x: 0, y: 0, z: 50 }, true); F.addTorque({ x: 0, y: 0, z: -50 }, true); }
    M.update(); W.w.step();
    const L = len(angMom([F, A.body, B.body]));
    maxL = Math.max(maxL, L);
    if (i === 239) Lhalf = L;
    scale = Math.max(scale, Math.abs(inertiaAbout(A.body, AXZ) * omega(A.body, AXZ)));
  }
  console.log(`lead=${lead} fb=${fb} iters=${iters}: |L| at end of torque ${fmt(Lhalf, 3)}, max ${fmt(maxL, 3)}, at 2 s ${fmt(len(angMom([F, A.body, B.body])), 3)}; scale I_A·ω_A ${fmt(scale, 2)}; ω_F ${fmt(omega(F, AXZ), 3)} ω_A ${fmt(omega(A.body, AXZ), 2)}`);
}
process.exit(0);
