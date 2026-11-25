// Nits review: root on screen, its marker anchor off screen → no marker at all.
import { reviewSetup, markDiff } from './review-nits-lib.mjs';
const S = await reviewSetup();
const { page, shot, errors } = await S.open('rn-off');
for (const [ex, k] of [['four-bar', 0.25], ['collision', 0.3], ['sliding-axle', 0.3]]) {
  await page.evaluate((ex) => { window.__knap.loadExample(ex); window.__knap.home(); }, ex);
  const c = await page.evaluate(() => window.__knap.camera());
  await page.evaluate(([c, k]) => window.__knap.setCamera({ ...c, height: c.height * k }), [c, k]);
  const d = await markDiff(page);
  const m = await page.evaluate(() => window.__knap.getModel());
  const root = m.rootPartId;
  // how much of the root is on screen: cells whose centre projects inside the canvas
  const onScreen = await page.evaluate((root) => {
    const m = window.__knap.getModel();
    const p = m.parts.find((q) => q.id === root);
    const r = document.querySelector('.kv-canvas').getBoundingClientRect();
    return p.cells.filter((c) => { const s = window.__knap.screenPos([c.x, c.y, c.z]); return s.x > r.left && s.x < r.right && s.y > r.top && s.y < r.bottom; }).length + '/' + p.cells.length;
  }, root);
  await shot(`review-nits-offscreen-${ex}`);
  console.log(ex, `zoom ×${1 / k}`, JSON.stringify({ rootCellsOnScreen: onScreen, hook: d.hook, drawnPx: d.n }));
}
console.log('errors', errors);
await S.close();
