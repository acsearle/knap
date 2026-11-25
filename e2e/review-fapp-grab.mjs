// Review fapp: grabbing with the real mouse at each level; release from 45° and 3°.
import { harness, check, ev, stepN, HZ } from './review-fapp-lib.mjs';
import { frames } from './app-lib.mjs';

const h = await harness();
// angle of the pendulum link (part 2) from straight down, degrees, signed (+ toward +x)
const linkAngle = (p) => ev(p, () => {
  const t = window.__knap.simTransforms()[2];
  // cell x=4 local is (4,0,1); pivot at (0,0,1)
  const [x, y, z, w] = t.q; const v = [4, 0, 1];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]);
  const px = v[0] + w * tx + (y * (2 * (x * v[1] - y * v[0])) - z * ty) + t.p[0];
  const py = v[1] + w * ty + (z * tx - x * (2 * (x * v[1] - y * v[0]))) + t.p[1];
  return Math.atan2(px, -py) * 180 / Math.PI;
});
try {
  const c = await h.open('fapp-grab', { width: 1280, height: 720 });
  const p = c.page;
  for (const lvl of ['off', 'low', 'realistic']) {
    for (const target of [45, 3, 1.5]) {
      await ev(p, () => window.__knap.setMode('edit'));
      await ev(p, () => window.__knap.loadExample('pendulum'));
      await ev(p, (l) => window.__knap.setFriction(l), lvl);
      await ev(p, () => { window.__knap.setView('front'); window.__knap.fit(); });
      await ev(p, () => window.__knap.stepSim(0));
      // let it come down: at off it never rests, so first grab and hold it hanging
      const a0 = await linkAngle(p);
      const R = 3;
      const grabAt = await ev(p, () => window.__knap.cellScreenPos(2, 3)); // cell x=3
      await p.mouse.move(grabAt.x, grabAt.y);
      await p.mouse.down();
      await frames(p, 1);
      const grabbed = (await ev(p, () => window.__knap.simInfo())).grabbed;
      // move cursor in steps toward the target pose (radius 3), stepping physics between moves
      const path = [];
      for (let k = 1; k <= 20; k++) {
        const ang = (a0 + (target - a0) * k / 20) * Math.PI / 180;
        path.push([R * Math.sin(ang), -R * Math.cos(ang), 1]);
      }
      let lag = 0;
      for (const w of path) {
        const s = await ev(p, (w) => window.__knap.screenPos(w), w);
        await p.mouse.move(s.x, s.y);
        await stepN(p, 24); // 0.05 s
      }
      await stepN(p, HZ); // hold 1 s
      const held = await linkAngle(p);
      const tipScr = await ev(p, () => window.__knap.cellScreenPos(2, 3));
      const last = await ev(p, (w) => window.__knap.screenPos(w), path[path.length - 1]);
      lag = Math.hypot(tipScr.x - last.x, tipScr.y - last.y);
      await p.mouse.up();
      await frames(p, 1);
      const relSamples = [];
      for (let k = 0; k < 40; k++) { await stepN(p, 60); relSamples.push(+(await linkAngle(p)).toFixed(2)); } // 5 s
      const fin = relSamples[relSamples.length - 1];
      const moved = Math.abs(fin - held) > 0.1 || relSamples.some((a) => Math.abs(a - held) > 0.5);
      console.log(`${lvl} target ${target}°: grabbed body ${grabbed}; held at ${held.toFixed(2)}° (cursor lag ${lag.toFixed(1)} px); after release 5 s: ${relSamples.filter((_, i) => i % 4 === 3).join(', ')}`);
      if (lvl === 'realistic') {
        if (target === 45) check('Real: released from 45° falls and settles near vertical', moved && Math.abs(fin) < 2, { held, fin });
        if (target === 3) check('Real: released from 3° moves (outside 1.78° dead zone)', moved, { held, fin });
      }
    }
  }
} finally {
  await h.done();
}
