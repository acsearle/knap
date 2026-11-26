// Can a documented setting stop the B5c roll-off (cache off, metre)? Try smaller penetration slop / more position steps.
import { World, qAxis, qRot, fmt } from '../lib.mjs';
const RZ = qAxis([1, 0, 0], Math.PI / 2);
for (const [label, set, ps] of [['default slop 0.02', null, 2], ['slop 1e-3', s => { s.mPenetrationSlop = 1e-3; }, 2], ['slop 1e-4', s => { s.mPenetrationSlop = 1e-4; }, 2], ['slop 1e-4, psteps 8', s => { s.mPenetrationSlop = 1e-4; }, 8]]) {
  const w = new World('metre-nc', { settings: set, positionSteps: ps });
  w.add(w.plane(), { dynamic: false });
  const beam = w.add(w.box(4.5, 0.46, 0.46), { pos: [0, 0.46, 0] });
  const b = w.add(w.cylinder(2.5, 0.46), { pos: [0.7, 0.92 + 2.5, 0], rot: RZ });
  const t0 = performance.now();
  for (let i = 1; i <= 30 * 480; i++) w.step();
  const ax = qRot(w.quat(beam), [1, 0, 0]);
  console.log(`${label.padEnd(22)} after 30 s: wheel moved ${fmt(w.pos(b)[0] - 0.7, 4)} studs, vx ${fmt(w.v(b)[0])}, beam tilt ${fmt(Math.asin(ax[1]))} rad, beam sink ${fmt(0.46 - w.pos(beam)[1])}; ${fmt((performance.now() - t0) / 30, 2)} ms/s`);
  w.destroy();
}
process.exit(0);
