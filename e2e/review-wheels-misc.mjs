// Review (wheels UI): odds and ends — R / N / B with the Wheel tool, the inspector with a free root
// ("fixed root" badge, Set as fixed root), the edit grid through wheels on the Cart (FRONT zoom).
import { frames, model, press, settle, state, status } from './app-lib.mjs';
import { reviewSetup, findings } from './review-wheels-lib.mjs';

const F = findings();
const R = await reviewSetup();
const { page, shot, errors } = await R.open('rw-misc');
const ev = (fn, a) => page.evaluate(fn, a);
try {
  await press(page, '[data-action=examples]');
  await press(page, '[data-example=cart]');
  await page.keyboard.press('w');
  const wheel = (await model(page)).parts.find((p) => p.cells.some((c) => c.rim));
  const wp = await ev((id) => window.__knap.partScreenPos(id), wheel.id);
  await page.mouse.move(wp.x, wp.y, { steps: 2 });
  await frames(page, 1);
  F.note(`W hover: "${(await status(page)).hint}"`);
  for (const k of ['r', 'n', 'b']) {
    await page.keyboard.press(k);
    await frames(page, 1);
    F.note(`W + ${k.toUpperCase()}: msg "${(await status(page)).message}"`);
  }
  // inspector with a free root
  await page.keyboard.press('v');
  const cp = await ev(() => window.__knap.cellScreenPos(1, 3));
  await page.mouse.click(cp.x, cp.y);
  await frames(page, 2);
  const sel = (await state(page)).selection;
  const insp = await page.locator('.inspector, [data-role=inspector]').first().innerText();
  F.note(`selected part ${sel} with Fix root off; inspector text: ${JSON.stringify(insp.slice(0, 120))}`);
  F.check(!/fixed root/i.test(insp.split('\n').slice(0, 2).join(' ')), 'inspector does not call a part "fixed root" when nothing is fixed');
  await shot('rw-misc-inspector-free');
  // select a wheel and press Set as fixed root
  const wp2 = await ev((id) => window.__knap.partScreenPos(id), wheel.id);
  await page.mouse.click(wp2.x, wp2.y);
  await frames(page, 2);
  const btn = page.locator('[data-action=set-root]');
  F.note(`wheel part ${(await state(page)).selection}: button "${await btn.innerText()}" disabled=${await btn.isDisabled()}`);
  if (!(await btn.isDisabled())) {
    const b = await btn.boundingBox();
    await page.mouse.click(b.x + 5, b.y + 5);
    await frames(page, 2);
    F.note(`after Set as fixed root: msg "${(await status(page)).message}" counts "${(await status(page)).counts}" fixRoot=${(await state(page)).fixRoot} marker=${!!(await ev(() => window.__knap.rootMarker(false)))}`);
    await shot('rw-misc-set-root-free');
    await page.keyboard.press('Meta+z');
  }
  await page.keyboard.press('Escape');
  // edit grid through the wheels: FRONT, zoom on a wheel
  await ev(() => { window.__knap.setView('front'); window.__knap.fit(); });
  const cam = await ev(() => window.__knap.camera());
  await ev((c) => window.__knap.setCamera({ ...c, pitch: 0.12 }), cam);
  await page.mouse.move(5, 700);
  await frames(page, 2);
  await shot('rw-misc-grid-through-wheels');
  F.check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} catch (e) {
  F.bad(`script error: ${e.stack}`);
} finally {
  await R.close();
  console.log(`\n${F.list.length} BAD`);
}
