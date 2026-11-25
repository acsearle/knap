// UX review 2 (follow-ups): move rejection message, root marker, Esc while starting, checkbox focus,
// stale status after Stop, Delete key, tool buttons in simulate mode.
import { startUx, st, mk, parts } from './review-ux-lib.mjs';
import { frames, hover, clickAt, clickFace, facePos, model, summary, cellIndexAt, settle, press, state, openApp } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-edit2');
await openApp(page, ux.url);
const { log } = mk(page);
const loadExample = async (name) => {
  await press(page, '[data-action=examples]');
  await press(page, `[data-example=${name}]`);
  await settle(page);
};
const T = async (label, fn) => {
  console.log(`\n===== ${label}`);
  try {
    await fn();
  } catch (e) {
    ux.check(false, `${label}: threw`, e.message.split('\n')[0]);
  }
};

await T('move rejection', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('v');
  await clickFace(page, 2, [3, 0, 1], 4);
  const m0 = await model(page);
  await page.keyboard.press('PageDown'); // link z=1 → z=0: overlaps the frame hole (0,0,0)
  await frames(page, 1);
  const m1 = await model(page);
  const s = await log('PageDown into the frame');
  ux.check(JSON.stringify(m0) === JSON.stringify(m1) && s.error, 'invalid move rejected with an error message', s.message);
  await shot('review-ux-50-move-rejected');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await frames(page, 1);
  await log('ArrowLeft ×2 (onto the frame row at z=1? no — frame is z=0)');
  await page.keyboard.press('Delete');
  await frames(page, 1);
  const s2 = await log('Delete');
  console.log(parts(await model(page)));
});

await T('root marker follows Set as fixed root', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('v');
  await page.keyboard.press('Home');
  await settle(page);
  await page.mouse.move(300, 650);
  await frames(page, 2);
  await shot('review-ux-51-root-before');
  await clickFace(page, 2, [3, 0, 1], 4);
  const before = await summary(page);
  await press(page, '[data-action=set-root]');
  const after = await summary(page);
  console.log('bodyOfPart before', JSON.stringify(before.bodyOfPart), 'after', JSON.stringify(after.bodyOfPart));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Home');
  await settle(page);
  await page.mouse.move(300, 650);
  await frames(page, 2);
  await shot('review-ux-52-root-after');
  // play: the frame should now fall/swing, the link stay put
  await page.evaluate(() => window.__knap.stepSim(240));
  const tr = await page.evaluate(() => window.__knap.simTransforms());
  console.log('after 0.5 s with link as root: link p', tr[2]?.p, ' frame p', tr[1]?.p);
  // (The frame turns about the pin axis through the origin, so its translation stays ~0: compare
  // rotations, not positions.)
  const turned = (t) => 2 * Math.acos(Math.min(1, Math.abs(t.q[3])));
  ux.check(tr[2] && Math.hypot(...tr[2].p) < 1e-9 && turned(tr[2]) < 1e-9 && tr[1] && turned(tr[1]) > 0.05, 'new root is fixed in the simulation, old root moves', `frame turned ${tr[1] && turned(tr[1])} rad`);
  await page.keyboard.press('Escape');
  await frames(page, 2);
  const s = await st(page);
  console.log('status after Stop:', JSON.stringify(s));
  ux.check(!/Simulat|Paused|ready/.test(s.message), 'status message is not stale after Stop', s.message);
});

await T('Esc while Starting…', async () => {
  await loadExample('collision');
  await page.mouse.move(300, 650);
  await page.keyboard.press('Space');
  const m1 = (await state(page)).mode;
  await page.keyboard.press('Escape');
  const m2 = (await state(page)).mode;
  await page.waitForFunction(() => window.__knap.getState().mode !== 'starting', null, { timeout: 60000 });
  const m3 = (await state(page)).mode;
  console.log('modes: after Space', m1, 'after Esc', m2, 'settled', m3);
  ux.check(!(m2 === 'starting' && m3 === 'simulate'), 'Esc pressed during "Starting…" is not ignored', `${m1} → Esc → ${m2} → ${m3}`);
  if (m3 === 'simulate') await page.keyboard.press('Escape');
  await frames(page, 2);
});

await T('Show kinematics checkbox focus', async () => {
  await loadExample('pendulum');
  // pan with the keyboard-free route: use the cube? No — use Fit after a wheel zoom.
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -400);
  await frames(page, 2);
  const camZoomed = await page.evaluate(() => window.__knap.camera());
  const box = await page.locator('[data-action=kinematics]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await frames(page, 2);
  console.log('focused after clicking the checkbox:', await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.type ?? ''}`));
  await page.keyboard.press('Home');
  await frames(page, 2);
  await settle(page);
  const camHome = await page.evaluate(() => window.__knap.camera());
  ux.check(camHome.height !== camZoomed.height, 'Home key works right after clicking Show kinematics', `height ${camZoomed.height} → ${camHome.height}`);
  await page.keyboard.press('f');
  await frames(page, 2);
  const kin0 = (await state(page)).showKinematics;
  await page.keyboard.press('Space');
  await frames(page, 3);
  const st1 = await state(page);
  console.log('Space after clicking the checkbox → mode', st1.mode, 'kinematics', kin0, '→', st1.showKinematics);
  ux.check(st1.showKinematics === kin0, 'Space does not also toggle the focused checkbox', `${kin0} → ${st1.showKinematics}`);
  if (st1.mode !== 'edit') {
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.keyboard.press('Escape');
    await frames(page, 2);
  }
});

await T('simulate-mode chrome', async () => {
  await loadExample('four-bar');
  await page.keyboard.press('v');
  await clickAt(page, await page.evaluate(() => window.__knap.partScreenPos(2)));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
  await page.evaluate(() => window.__knap.setPaused(true));
  await frames(page, 2);
  await page.mouse.move(28, 170); // hover the axle-hole tool (disabled)
  await page.waitForTimeout(1200);
  await shot('review-ux-53-simulate-chrome');
  const dis = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.disabled).map((b) => b.getAttribute('aria-label') || b.dataset.action || b.dataset.tool || b.textContent.trim()).join(', '));
  console.log('disabled in simulate:', dis);
  for (const k of ['1', 'Delete', 'd', 'Meta+z', 'n']) {
    await page.keyboard.press(k);
    const s = await st(page);
    console.log(`key ${k} in simulate → "${s.message}"`);
  }
  await page.keyboard.press('Escape');
  await frames(page, 2);
});

await ux.close();
