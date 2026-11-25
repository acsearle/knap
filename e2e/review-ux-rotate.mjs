// UX review: a rejected rotation and its message.
import { startUx, st } from './review-ux-lib.mjs';
import { frames, clickFace, model, settle, press, openApp } from './app-lib.mjs';
const ux = await startUx();
const { page, shot } = await ux.page('ux-rotate');
await openApp(page, ux.url);
await press(page, '[data-action=examples]');
await press(page, '[data-example=pendulum]');
await settle(page);
await page.keyboard.press('v');
await clickFace(page, 2, [3, 0, 1], 4); // link, first cell (0,0,1) holds the pin
for (const k of [']', '[', '[']) {
  const m0 = JSON.stringify(await model(page));
  await page.keyboard.press(k);
  await frames(page, 1);
  const s = await st(page);
  const same = m0 === JSON.stringify(await model(page));
  console.log(`${k}: ${same ? 'REJECTED' : 'rotated'} — "${s.message}"${s.error ? ' [error]' : ''}`);
  if (!same) { await page.keyboard.press('Meta+z'); await frames(page, 1); }
}
await page.mouse.move(640, 705);
await frames(page, 1);
console.log('idle hint with a selection and the pointer off the view:', JSON.stringify(await st(page)));
await shot('review-ux-92-rotate-rejected');
await ux.close();
