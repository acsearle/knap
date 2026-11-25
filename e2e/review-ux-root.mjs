// UX review: does "Set as fixed root" change what is fixed in the simulation?
import { startUx, st, mk } from './review-ux-lib.mjs';
import { frames, clickAt, clickFace, model, summary, settle, press, state, openApp } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-root');
await openApp(page, ux.url);
await press(page, '[data-action=examples]');
await press(page, '[data-example=pendulum]');
await settle(page);
const run = async (label) => {
  await page.evaluate(() => window.__knap.stepSim(240));
  const tr = await page.evaluate(() => window.__knap.simTransforms());
  const info = await page.evaluate(() => window.__knap.simInfo());
  const fmt = (t) => (t ? t.p.map((v) => v.toFixed(3)).join(',') + ' q.w=' + t.q[3].toFixed(4) : 'null');
  console.log(`${label}: t=${info.time.toFixed(3)} frame ${fmt(tr[1])} | link ${fmt(tr[2])} | pin ${fmt(tr[3])}`);
  await page.keyboard.press('Escape');
  await frames(page, 2);
  return tr;
};
const a = await run('root = frame (example default)');
await page.keyboard.press('v');
await clickFace(page, 2, [3, 0, 1], 4);
await press(page, '[data-action=set-root]');
const m = await model(page);
const s = await summary(page);
console.log('rootPartId', m.rootPartId, s.summary, JSON.stringify(s.bodyOfPart));
const g = await page.evaluate(() => window.__knap.analyze());
console.log(JSON.stringify(g.jointList));
const b = await run('root = link (part 2)');
ux.check(Math.abs(b[1].q[3]) < 0.9999, 'with the link as root, the frame swings', `frame q.w=${b[1].q[3]}`);
// also kinematics view
await page.keyboard.press('k');
await page.mouse.move(300, 650);
await frames(page, 2);
await shot('review-ux-54-root-link-kin');
await ux.close();
