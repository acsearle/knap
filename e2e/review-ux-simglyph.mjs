// UX review: in simulate mode with Show kinematics on, do parts and joint glyphs stay together?
import { startUx } from './review-ux-lib.mjs';
import { frames, settle, openApp } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-simglyph');
await openApp(page, ux.url); // four-bar
const m = await page.evaluate(() => window.__knap.getModel());
console.log(m.parts.map((p) => `${p.id}:${p.cells.map((c) => `${c.kind[0]}${c.x},${c.y},${c.z}`).join(' ')}`).join('\n'));
await page.keyboard.press('k');
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
await page.evaluate(() => window.__knap.setPaused(true));
await page.evaluate(() => window.__knap.stepSim(480));
await page.mouse.move(300, 650);
await frames(page, 3);
// screen positions of each joint's mate cell for both parts
const out = await page.evaluate(() => {
  const m = window.__knap.getModel();
  const res = [];
  const tr = window.__knap.simTransforms();
  for (const p of m.parts) {
    const pos = p.cells.map((c, i) => ({ c: [c.x, c.y, c.z], s: window.__knap.cellScreenPos(p.id, i) }));
    res.push({ id: p.id, q: tr[p.id]?.q, pos });
  }
  return res;
});
for (const p of out) console.log(p.id, 'q', p.q?.map((v) => v.toFixed(3)).join(','), p.pos.map((x) => `${x.c.join(',')}→(${x.s.x.toFixed(0)},${x.s.y.toFixed(0)})`).join(' '));
const g = await page.evaluate(() => window.__knap.analyze());
for (const j of g.jointList) {
  const s = await page.evaluate((p) => window.__knap.screenPos(p), j.origin);
  console.log('joint', j.type, 'origin', j.origin.join(','), 'edit-time screen pos', s.x.toFixed(0), s.y.toFixed(0));
}
await shot('review-ux-55-simulate-kinematics-1s');
await ux.close();
