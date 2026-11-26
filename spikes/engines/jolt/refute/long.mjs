// Longer runs of two PASSes (uses ../lib.mjs, metre-nc): B1c heavy-top stack for 20 s, B5c wheel on loose beam for 20 s.
import { World, tiltDeg, qAxis, fmt, DENSITY } from '../lib.mjs';
for (const R of ['metre', 'metre-nc']) {
  const w = new World(R); w.add(w.plane(), { dynamic: false });
  const cs = []; for (let i = 0; i < 5; i++) cs.push(w.add(w.box(0.46, 0.46, 0.46, i === 4 ? DENSITY * 10 : DENSITY), { pos: [0, 0.46 + 0.92 * i, 0] }));
  const r = []; for (let i = 1; i <= 20 * 480; i++) { w.step(); if (i % 2400 === 0) r.push(`t${i / 480}: tilt ${fmt(Math.max(...cs.map(c => tiltDeg(w.quat(c)))), 2)} off ${fmt(Math.hypot(w.pos(cs[4])[0], w.pos(cs[4])[2]), 3)}`); }
  console.log(R, 'B1c x10:', r.join(' | ')); w.destroy();
  const w2 = new World(R); w2.add(w2.plane(), { dynamic: false });
  const beam = w2.add(w2.box(4.5, 0.46, 0.46), { pos: [0, 0.46, 0] });
  const b = w2.add(w2.cylinder(2.5, 0.46), { pos: [0.7, 0.92 + 2.5, 0], rot: qAxis([1, 0, 0], Math.PI / 2) });
  const r2 = []; for (let i = 1; i <= 20 * 480; i++) { w2.step(); if (i % 2400 === 0) r2.push(`t${i / 480}: x ${fmt(w2.pos(b)[0] - 0.7)} vx ${fmt(w2.v(b)[0])}`); }
  console.log(R, 'B5c:', r2.join(' | ')); w2.destroy();
}
process.exit(0);
