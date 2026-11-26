// Review (wheels UI): frame time with the ground on vs off (Cart, Home view, 1280×720 DPR 1), measured
// as continuous-render frame rate (window.__knap.frameRate) alternating on/off 4× (shared machine:
// interleaving cancels drift in load). Also per-frame lastRenderMs.
import { frames, settle } from './app-lib.mjs';
import { reviewSetup } from './review-wheels-lib.mjs';
import { cpus, loadavg } from 'node:os';

const R = await reviewSetup();
const { page } = await R.open('rw-perf');
const ev = (fn, a) => page.evaluate(fn, a);
try {
  const b = await page.locator('[data-action=examples]').boundingBox();
  await page.mouse.click(b.x + 5, b.y + 5);
  await frames(page, 1);
  const c = await page.locator('[data-example=cart]').boundingBox();
  await page.mouse.click(c.x + 5, c.y + 5);
  await settle(page);
  await page.mouse.move(5, 700);
  const res = { on: [], off: [], onMs: [], offMs: [] };
  console.log(`load ${loadavg().map((x) => x.toFixed(1)).join(' ')} on ${cpus().length} cpus`);
  for (let k = 0; k < 4; k++) {
    for (const g of ['on', 'off']) {
      const want = g === 'on';
      if ((await ev(() => window.__knap.getState().ground)) !== want) { await page.keyboard.press('g'); await frames(page, 2); }
      const r = await ev(() => window.__knap.frameRate(2500));
      res[g].push(r.ms / r.frames);
      res[`${g}Ms`].push(await ev(() => window.__knap.getState().viewport.lastRenderMs));
    }
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(1);
  console.log(`ms/frame (wall, continuous): ground on ${res.on.map((x) => x.toFixed(1)).join(' ')} (median ${med(res.on)}); off ${res.off.map((x) => x.toFixed(1)).join(' ')} (median ${med(res.off)})`);
  console.log(`lastRenderMs (CPU side of render()): on ${res.onMs.map((x) => x.toFixed(1)).join(' ')}; off ${res.offMs.map((x) => x.toFixed(1)).join(' ')}`);
  console.log(`load ${loadavg().map((x) => x.toFixed(1)).join(' ')}`);
} finally {
  await R.close();
}
