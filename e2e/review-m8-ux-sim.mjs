// Simulate the Gear train with the real UI: Play, step, speeds, friction, grab-drag a gear, Stop.
import { session, model, frames, K, canon, status, state, scr } from './review-m8-ux-lib.mjs';
import { press } from './app-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('sim');
const log = (...a) => console.log(...a);
const settle = async () => { await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2); };
await page.click('[data-action=examples]');
await frames(page, 2);
const items = await page.evaluate(() => [...document.querySelectorAll('[data-example], .menu button, [role=menuitem]')].map((e) => e.textContent.trim()).filter(Boolean));
log('examples menu', JSON.stringify(items));
const gt = page.getByText('Gear train', { exact: false }).first();
await gt.click();
await settle();
const ed = await model(page);
const cam0 = await K(page, () => window.__knap.camera());
log('loaded', ed.parts.length, 'parts; counts', (await status(page)).counts, 'hint', (await status(page)).hint);
await page.mouse.move(5, 300);
await snap('sim-0-edit');
const ang = (q) => 2 * Math.atan2(q[2], q[3]);
const angles = async () => { const t = await K(page, () => window.__knap.simTransforms()); return { arm: ang(t[3].q), pin: ang(t[2].q), out: ang(t[4].q) }; };
// Play with the button; let it run 4 s wall time at default speed
await press(page, '[data-action=play]');
const t0 = Date.now();
let prev = await angles(), track = { arm: 0, pin: 0, out: 0 };
const wrap = (d) => d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(200);
  const a = await angles();
  for (const k of ['arm', 'pin', 'out']) track[k] += wrap(a[k] - prev[k]);
  prev = a;
}
const info = await K(page, () => { const i = window.__knap.simInfo(); return { t: i.time, k: i.substeps, je: i.jointError, meshes: i.meshes, speed: i.speed, fr: i.jointFriction, dropped: i.droppedSteps }; });
log('after ~4 s wall', JSON.stringify(info), 'turned', JSON.stringify(track), 'ratio pin/arm', (track.pin / track.arm).toFixed(3), 'out/arm', (track.out / track.arm).toFixed(3));
await snap('sim-1-running');
// speed 1x and friction off via buttons
await press(page, '[data-speed="1"]').catch((e) => log('speed btn', e.message));
await press(page, '[data-friction=off]').catch((e) => log('friction btn', e.message));
await page.waitForTimeout(1500);
log('speed/friction', JSON.stringify(await K(page, () => { const i = window.__knap.simInfo(); return { speed: i.speed, fr: i.jointFriction, k: i.substeps, meshes: i.meshes }; })));
// pause, step
await press(page, '[data-action=pause]');
const tp = (await K(page, () => window.__knap.simInfo())).time;
await press(page, '[data-action=step]');
const ts = (await K(page, () => window.__knap.simInfo())).time;
log('step advanced', (ts - tp).toFixed(5));
await press(page, '[data-action=pause]');
// grab the 40 at a point on its face near the rim and drag it around
await page.waitForTimeout(500);
const t = await K(page, () => window.__knap.simTransforms());
const q3 = t[3].q; const rot = (v) => { const [x, y, z, w] = q3; const [vx, vy, vz] = v; const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx); return [vx + w * tx + (y * tz - z * ty) + t[3].p[0], vy + w * ty + (z * tx - x * tz) + t[3].p[1], vz + w * tz + (x * ty - y * tx) + t[3].p[2]]; };
const grabW = rot([0, 2, 1.5]);
const g = await scr(page, grabW);
log('grab point', JSON.stringify(g), 'hover', (await status(page)).hover);
prev = await angles(); track = { arm: 0, pin: 0, out: 0 };
await page.mouse.move(g.x, g.y); await frames(page, 1);
log('hover before grab', JSON.stringify(await status(page)));
await page.mouse.down();
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(g.x + 8 * i, g.y + 6 * i, { steps: 1 });
  await page.waitForTimeout(80);
  const a = await angles();
  for (const k of ['arm', 'pin', 'out']) track[k] += wrap(a[k] - prev[k]);
  prev = a;
}
const gi = await K(page, () => { const i = window.__knap.simInfo(); return { grabbed: i.grabbed, je: i.jointError, meshes: i.meshes, k: i.substeps }; });
log('while dragging', JSON.stringify(gi), 'turned', JSON.stringify(track), 'pin/arm', (track.pin / track.arm).toFixed(3));
await snap('sim-2-drag');
await page.mouse.up();
// fast fling: drag quickly
await page.mouse.move(g.x, g.y); await page.mouse.down();
for (let i = 0; i < 10; i++) { await page.mouse.move(g.x + (i % 2 ? 300 : -300), g.y + (i % 2 ? -200 : 200), { steps: 1 }); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(1500);
const fi = await K(page, () => { const i = window.__knap.simInfo(); return { je: i.jointError, meshes: i.meshes, k: i.substeps, dropped: i.droppedSteps }; });
log('after fling', JSON.stringify(fi));
// Stop
await press(page, '[data-action=stop]');
await settle();
const after = await model(page);
const cam1 = await K(page, () => window.__knap.camera());
log('mode', (await state(page)).mode, 'model restored exactly', canon(after) === canon(ed), 'camera same', JSON.stringify(cam0) === JSON.stringify(cam1), 'counts', (await status(page)).counts);
await snap('sim-3-stopped');
log('errors', errors);
await s.close();
