// Review "sim" 5: energy gain made visible. Sliding-axle example in the FRONT view: the captured
// arm (part 5) starts horizontal; screenshot it at its highest point in the first 2 s and around
// t = 30 s and t = 60 s (deterministic stepping). e2e/out/review-sim-energy-*.png
import { frames, settle } from './app-lib.mjs';
import { harness, montage, viewShot } from './review-sim-lib.mjs';

const h = await harness();
const c = await h.open('review-sim-energy');
const { page } = c;
const k = (fn, arg) => page.evaluate(fn, arg);
try {
  await k(() => window.__knap.loadExample('sliding-axle'));
  await k(() => window.__knap.setView('front'));
  await k(() => window.__knap.fit());
  await settle(page);
  await k(() => window.__knap.stepSim(0));
  /** Arm tip (part 5 cell 1 = pin hole at (5,1,1)) height above the axle (y = 1), units. */
  const tipY = () => k(() => {
    const t = window.__knap.simTransforms()[5];
    const v = [5, 1, 1];
    const [x, y, z, w] = t.q;
    const ty = 2 * (z * v[0] - x * v[2]);
    const tx = 2 * (y * v[2] - z * v[1]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return v[1] + w * ty + (z * tx - x * tz) + t.p[1] - 1;
  });
  const shots = [];
  const labels = [];
  const t0Shot = await viewShot(page);
  shots.push(t0Shot);
  labels.push('t=0: arm horizontal (released)');
  for (const [from, to] of [[0, 2], [28, 30], [58, 60]]) {
    await k((n) => window.__knap.stepSim(n), Math.round(from * 480) - (await k(() => window.__knap.simInfo().stepCount)));
    // find the step of max height in [from, to]
    let best = -1e9;
    let bestStep = 0;
    for (let s = Math.round(from * 480); s < Math.round(to * 480); s += 4) {
      await k(() => window.__knap.stepSim(4));
      const y = await tipY();
      if (y > best) {
        best = y;
        bestStep = s + 4;
      }
    }
    // replay to the peak: restart and step there (deterministic)
    await k(() => window.__knap.setMode('edit'));
    await k((n) => window.__knap.stepSim(n), bestStep);
    await frames(page, 2);
    const y = await tipY();
    shots.push(await viewShot(page, `review-sim-energy-peak-${to}s`));
    labels.push(`highest in ${from}–${to} s: t=${(bestStep / 480).toFixed(2)} tip ${y.toFixed(2)} above axle (${((Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI).toFixed(0)}°)`);
    console.log(labels[labels.length - 1]);
  }
  await montage(page, shots, labels, 'review-sim-energy-montage', { cols: 2 });
} finally {
  await h.done();
}
