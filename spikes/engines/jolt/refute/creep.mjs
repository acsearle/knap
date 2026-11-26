// Long-run creep with the body-pair cache OFF (metre-nc, ../lib.mjs): wheel r1 on plane at 0 / 0.1 stud/s for 60 s,
// and B5c wheel r2.5 on a loose beam 9 for 30 s with the beam's tilt. node creep.mjs
import { World, qAxis, qRot, fmt } from '../lib.mjs';
const RZ = qAxis([1, 0, 0], Math.PI / 2);
for (const fl of ['plane', 'box']) for (const v0 of [0, 0.1]) {
  const w = new World('metre-nc');
  fl === 'plane' ? w.add(w.plane(), { dynamic: false }) : w.add(w.box(40, 0.5, 40), { dynamic: false, pos: [0, -0.5, 0] });
  const b = w.add(w.cylinder(1, 0.46), { pos: [-8, 1, 0], rot: RZ, linVel: [v0, 0, 0], angVel: [0, 0, -v0] });
  const r = []; for (let i = 1; i <= 60 * 480; i++) { w.step(); if (i % (15 * 480) === 0) r.push(fmt(w.v(b)[0], 5)); }
  console.log(`wheel r1 on ${fl} v0 ${v0}: vx at 15/30/45/60 s ${r.join(' ')}`); w.destroy();
}
for (const R of ['metre-nc', 'si-scaled']) {
  const w = new World(R, R === 'si-scaled' ? { settings: s => { s.mUseBodyPairContactCache = false; } } : {});
  w.add(w.plane(), { dynamic: false });
  const beam = w.add(w.box(4.5, 0.46, 0.46), { pos: [0, 0.46, 0] });
  const b = w.add(w.cylinder(2.5, 0.46), { pos: [0.7, 0.92 + 2.5, 0], rot: RZ });
  const r = []; for (let i = 1; i <= 30 * 480; i++) { w.step(); if (i % (10 * 480) === 0) { const ax = qRot(w.quat(beam), [1, 0, 0]); r.push(`t${i / 480} x ${fmt(w.pos(b)[0] - 0.7, 3)} vx ${fmt(w.v(b)[0])} beam tilt ${fmt(Math.asin(ax[1]))} rad beam x ${fmt(w.pos(beam)[0])}`); } }
  console.log(`${R} (cache off) B5c: ` + r.join(' | ')); w.destroy();
}
process.exit(0);
