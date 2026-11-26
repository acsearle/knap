// Tool switching mid-hover over a gear; T while simulating.
import { session, setModel, M, C, face, virt, status, hover, model, frames, K, state } from './review-m8-ux-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('switch');
const log = (...a) => console.log(...a);
const settle = async () => { await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2); };
await setModel(page, M([[C(0, 0, 0, 'pinHole', 2, 1.5, true), C(0, 0, -1)], [C(3, 0, 0, 'pinHole', 2, 1.5, true), C(3, 0, -1)]], { version: 3 }));
await page.keyboard.press('Home'); await settle();
const p = await virt(page, 1, 0, [1, 0, 0], 4);
await hover(page, p);
for (const k of ['t', 'w', 'e', '1', '4', 'v', 't']) {
  await page.keyboard.press(k); await frames(page, 2);
  const st = await status(page);
  log(`key ${k}: tool=${(await state(page)).tool} hover="${st.hover}" hint="${st.hint}"`);
  if (k === 'e') await snap('switch-erase');
  if (k === 't') await snap('switch-gear-' + Math.random().toString(36).slice(2, 5));
}
// Shift held mid-hover with the Gear tool
await page.keyboard.down('Shift'); await frames(page, 2);
log('shift:', (await status(page)).hint); await snap('switch-gear-shift');
await page.keyboard.up('Shift'); await frames(page, 2);
log('shift up:', (await status(page)).hint);
// simulate: T and clicks do nothing
await page.keyboard.press('Space'); await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
const before = JSON.stringify(await model(page));
await page.keyboard.press('t'); await frames(page, 2);
log('sim: tool', (await state(page)).tool, 'gear button disabled', await page.locator('[data-tool=gear]').isDisabled());
await hover(page, p); await page.mouse.down(); await page.mouse.up(); await frames(page, 2);
log('sim: hint', (await status(page)).hint);
await page.keyboard.press('Escape'); await frames(page, 2);
log('after Esc mode', (await state(page)).mode, 'model same', JSON.stringify(await model(page)) === before);
log('errors', errors);
await s.close();
