// B5a cause check: si-def rolling wheel (1 stud/s) with single PhysicsSettings switches. node b5var.mjs
import { World, qAxis, fmt } from './lib.mjs';
const cases = [['si-def', null], ['si-def, body pair cache off', s => { s.mUseBodyPairContactCache = false; }],
  ['si-def, cache dist scaled only', s => { s.mBodyPairCacheMaxDeltaPositionSq *= 0.008 ** 2; }],
  ['si-def, cache off + max ang 2000', s => { s.mUseBodyPairContactCache = false; }, 2000],
  ['metre, body pair cache dist x125^2', s => { s.mBodyPairCacheMaxDeltaPositionSq *= 125 ** 2; }, 0, 'metre']];
for (const [label, f, maxAng, R] of cases) {
  const w = new World(R ?? 'si-def', { settings: f ?? undefined });
  w.add(w.box(20, 0.5, 20), { dynamic: false, pos: [0, -0.5, 0] });
  const b = w.add(w.cylinder(1, 0.46), { pos: [-8, 1, 0], rot: qAxis([1, 0, 0], Math.PI / 2), linVel: [1, 0, 0], angVel: [0, 0, -1], maxAngInt: maxAng || undefined });
  const sp = []; for (let i = 1; i <= 5 * 480; i++) { w.step(); if (i % 480 === 0) sp.push(fmt(w.v(b)[0], 3)); }
  console.log(label.padEnd(36), 'vx at 1..5 s', sp.join(' '));
  w.destroy();
}
process.exit(0);
