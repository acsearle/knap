// B10 cost: B6b triple pendulum (revolute joints) + 20-cube pile on a plane, 5 s; no per-step readout. node b10.mjs
import * as P from './lib.mjs';
const { TL, physics } = P;
const qz = P.qAxisAngle([0, 1, 0], -Math.PI / 2);
const s = P.makeScene();
P.addPlane(s, -20);
let prev = null;
for (let i = 0; i < 3; i++) {
  const b = P.addDynamic(s, [{ geom: P.boxGeom(3.5, 0.46, 0.46) }], [3 + 6 * i, 0, 0], undefined, P.bodyOpts());
  P.setGroup(b, 2);
  TL.RevoluteJointCreate(physics, prev, P.tf((prev ? [3, 0, 0] : [0, 0, 0]).map((x) => x * P.L), qz), b, P.tf([-3 * P.L, 0, 0], qz));
  prev = b;
}
const cubes = [];
for (let i = 0; i < 20; i++) cubes.push(P.addDynamic(s, [{ geom: P.boxGeom(0.46, 0.46, 0.46) }], [-30 + (i % 4) * 0.93 + (Math.floor(i / 4) % 2) * 0.3, -20 + 0.46 + Math.floor(i / 4) * 0.93, (i % 2) * 0.2], undefined, P.bodyOpts()));
P.stepReal(s, 0.5); // warm-up (JIT, pile settles)
const t0 = P.ms(); P.stepReal(s, 5); const ms = (P.ms() - t0) / 5;
console.log(`B10 ${P.settingsLine()}: ${P.f(ms, 1)} ms CPU per real second simulated (${P.f(ms / (480 * P.SET.sub) * P.SET.sub, 4)} ms per 1/480 s); pile top y ${P.f(Math.max(...cubes.map((c) => P.pos(c)[1])) + 20, 3)}`);
process.exit(0);
