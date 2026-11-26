// Cache OFF (metre-nc): does the position-step count / slop bring back self-acceleration?
// B5c wheel r2.5 on loose beam 9, and wheel r1 on a plane at 0.1 stud/s. 30 s each. node psteps.mjs
import { World, qAxis, fmt } from '../lib.mjs';
const RZ = qAxis([1, 0, 0], Math.PI / 2);
const rows = [];
for (const slop of [0.02, 1e-4]) for (const ps of [1, 2, 4, 8]) {
  const set = s => { s.mPenetrationSlop = slop; };
  let w = new World('metre-nc', { settings: set, positionSteps: ps });
  w.add(w.plane(), { dynamic: false });
  w.add(w.box(4.5, 0.46, 0.46), { pos: [0, 0.46, 0] });
  let b = w.add(w.cylinder(2.5, 0.46), { pos: [0.7, 0.92 + 2.5, 0], rot: RZ });
  let tr = []; for (let i = 1; i <= 30 * 480; i++) { w.step(); if (i % 4800 === 0) tr.push(fmt(w.v(b)[0], 4)); }
  const c = `B5c vx 10/20/30 s ${tr.join(' ')}`; w.destroy();
  w = new World('metre-nc', { settings: set, positionSteps: ps });
  w.add(w.plane(), { dynamic: false });
  b = w.add(w.cylinder(1, 0.46), { pos: [0, 1, 0], rot: RZ, linVel: [0.1, 0, 0], angVel: [0, 0, -0.1] });
  tr = []; for (let i = 1; i <= 30 * 480; i++) { w.step(); if (i % 4800 === 0) tr.push(fmt(w.v(b)[0], 4)); }
  console.log(`slop ${slop} psteps ${ps}: ${c} | r1 plane v0 0.1: vx ${tr.join(' ')}`); w.destroy();
}
process.exit(0);
