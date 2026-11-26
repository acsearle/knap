// Show kinematics on the Gear train (mesh glyphs), recolour, set root.
import { session, model, frames, K, status, state, scr } from './review-m8-ux-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('kin');
const log = (...a) => console.log(...a);
const settle = async () => { await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2); };
await K(page, () => window.__knap.loadExample('gear-train'));
await page.keyboard.press('Home'); await settle();
const p24 = await scr(page, [2.9, 3.6, 2.5]);
await page.mouse.move(p24.x, p24.y); await page.mouse.down(); await page.mouse.up(); await frames(page, 2);
log('sel', (await state(page)).selection);
const sws = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /swatch|colou?r/i.test(b.className + (b.title || '') + (b.getAttribute('aria-label') || ''))).map((b) => b.className + '|' + (b.title || b.getAttribute('aria-label'))));
log('swatches', JSON.stringify(sws.slice(0, 10)));
const insp = await page.evaluate(() => document.querySelector('[data-role=inspector]')?.innerText ?? document.querySelector('.inspector')?.innerText);
log('inspector text:', JSON.stringify(insp));
const btn = page.locator('button[title*="ed"]').first();
await page.mouse.move(5, 300);
await snap('kin-selected-24');
// Show kinematics
await page.keyboard.press('Escape');
await page.keyboard.press('k'); await frames(page, 3);
log('counts', (await status(page)).counts);
await snap('kin-home');
for (const v of ['front', 'back', 'top', 'front-right-top']) {
  await K(page, (v) => window.__knap.setView(v), v); await K(page, () => window.__knap.fit()); await frames(page, 3);
  await snap('kin-' + v);
}
log('errors', errors);
await s.close();
