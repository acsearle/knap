// Determinism: the B6b triple pendulum + a 20-cube pile, run twice in one process and once per process; prints final pose hash.
import * as P from './lib.mjs';
const { TL, physics } = P;
const qz = P.qAxisAngle([0, 1, 0], -Math.PI / 2);
function run() {
  const s = P.makeScene(); P.addPlane(s, -20); let prev = null; const all = [];
  for (let i = 0; i < 3; i++) { const b = P.addDynamic(s, [{ geom: P.boxGeom(3.5, 0.46, 0.46) }], [3 + 6 * i, 0, 0], undefined, P.bodyOpts()); P.setGroup(b, 2); TL.RevoluteJointCreate(physics, prev, P.tf((prev ? [3, 0, 0] : [0, 0, 0]), qz), b, P.tf([-3, 0, 0], qz)); prev = b; all.push(b); }
  for (let i = 0; i < 20; i++) all.push(P.addDynamic(s, [{ geom: P.boxGeom(0.46, 0.46, 0.46) }], [-30 + (i % 4) * 0.93, -19.5 + Math.floor(i / 4) * 0.93, 0], undefined, P.bodyOpts()));
  P.stepReal(s, 3);
  return all.map((b) => [...P.pos(b), ...P.quat(b)].map((x) => x.toPrecision(9)).join(',')).join(';');
}
const a = run(), b = run();
import { createHash } from 'node:crypto';
console.log('same in-process:', a === b, 'hash', createHash('sha1').update(a).digest('hex').slice(0, 12));
process.exit(0);
