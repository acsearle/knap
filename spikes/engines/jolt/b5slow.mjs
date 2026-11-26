// Slow rolling and B5c with/without the body-pair cache, metre and si-scaled. node b5slow.mjs
import { World, qAxis, fmt } from './lib.mjs';
const RZ = qAxis([1, 0, 0], Math.PI / 2);
for (const R of ['metre', 'si-scaled']) for (const cache of [true, false]) {
  const set = s => { s.mUseBodyPairContactCache = cache; };
  for (const v0 of [0.1, 0.3]) {
    const w = new World(R, { settings: set });
    w.add(w.box(20, 0.5, 20), { dynamic: false, pos: [0, -0.5, 0] });
    const b = w.add(w.cylinder(1, 0.46), { pos: [-8, 1, 0], rot: RZ, linVel: [v0, 0, 0], angVel: [0, 0, -v0] });
    const sp = []; for (let i = 1; i <= 5 * 480; i++) { w.step(); if (i % 480 === 0) sp.push(fmt(w.v(b)[0], 3)); }
    console.log(`${R} cache ${cache} B5a box floor v0=${v0}: vx 1..5 s ${sp.join(' ')}`); w.destroy();
  }
  const w = new World(R, { settings: set });
  w.add(w.plane(), { dynamic: false });
  const beam = w.add(w.box(4.5, 0.46, 0.46), { pos: [0, 0.46, 0] });
  const b = w.add(w.cylinder(2.5, 0.46), { pos: [0.7, 0.92 + 2.5, 0], rot: RZ });
  const sp = []; for (let i = 1; i <= 4 * 480; i++) { w.step(); if (i % 480 === 0) sp.push(fmt(w.v(b)[0], 3) + '@x' + fmt(w.pos(b)[0], 2)); }
  console.log(`${R} cache ${cache} B5c: wheel vx 1..4 s ${sp.join(' ')}; beam vx ${fmt(w.v(beam)[0])}`); w.destroy();
}
process.exit(0);
