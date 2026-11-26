// Select / move / rotate / duplicate / delete / recolour / root / kinematics on the Gear train; out-of-view hint.
import { session, model, frames, K, canon, status, state, scr, setModel, M, C, face, virt } from './review-m8-ux-lib.mjs';
import { press } from './app-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('edit');
const log = (...a) => console.log(...a);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const settle = async () => { await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2); };
await K(page, () => window.__knap.loadExample('gear-train'));
await page.keyboard.press('Home'); await settle();
const ed = await model(page);
// Select the 24 (part 4) by clicking on its face (hub (2,3,2), front face z=2.5) at a web point
const p24 = await scr(page, [2.9, 3.6, 2.5]);
await page.mouse.move(p24.x, p24.y); await frames(page, 1);
log('hover 24:', JSON.stringify((await status(page)).hover));
await page.mouse.down(); await page.mouse.up(); await frames(page, 2);
log('selection', (await state(page)).selection, 'inspector:', JSON.stringify(await page.textContent('[data-role=inspector-gears]').catch(() => null)), '| sub:', await page.textContent('[data-role=inspector-sub]').catch(() => null));
await page.mouse.move(5, 300);
await snap('edit-select-24');
// select the 40 by clicking its tooth ring
const p40 = await scr(page, [-1.6, -1.9, 1.5]);
await page.mouse.move(p40.x, p40.y); await frames(page, 1);
log('hover 40 teeth area:', JSON.stringify((await status(page)).hover));
await page.mouse.down(); await page.mouse.up(); await frames(page, 2);
log('selection', (await state(page)).selection, 'inspector:', JSON.stringify(await page.textContent('[data-role=inspector-gears]').catch(() => null)));
// pinion (part 2): its inspector should list both gears and meshes
await K(page, () => window.__knap.setModel(window.__knap.getModel()));
const pp = await scr(page, [0, 3.35, 2.5]);
await page.mouse.move(pp.x, pp.y); await frames(page, 1);
log('hover pinion front 8:', JSON.stringify((await status(page)).hover));
await page.mouse.down(); await page.mouse.up(); await frames(page, 2);
log('selection', (await state(page)).selection, 'inspector:', JSON.stringify(await page.textContent('[data-role=inspector-gears]').catch(() => null)));
await snap('edit-select-pinion');
// select part 4 again and try every arrow / PgUp / rotate / duplicate
await page.mouse.move(p24.x, p24.y); await page.mouse.down(); await page.mouse.up(); await frames(page, 2);
for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', '[', ']', 'd']) {
  const before = await model(page);
  await page.keyboard.press(key); await frames(page, 2);
  const after = await model(page);
  const st = await status(page);
  log(`key ${key}: ${canon(before) === canon(after) ? 'no change' : 'CHANGED'} msg="${st.message}" err=${st.error} counts="${st.counts}"`);
  if (canon(before) !== canon(after)) { await page.keyboard.press(`${MOD}+z`); await frames(page, 1); log('   undo restores', canon(await model(page)) === canon(before)); }
}
// move the whole output assembly: select the pin (part 7)? Instead move part 3 (arm+40) up one: meshes?
// delete the 24, undo
await page.keyboard.press('Delete'); await frames(page, 2);
log('delete part 4: parts', (await model(page)).parts.length, 'counts', (await status(page)).counts);
await page.keyboard.press(`${MOD}+z`); await frames(page, 1);
log('undo delete equal', canon(await model(page)) === canon(ed));
// recolour selected (part 4) via palette swatch #3 (red)
const sw = page.locator('.swatch, [data-color]').nth(4);
const before = await model(page);
await sw.click().catch((e) => log('swatch', e.message)); await frames(page, 2);
const after = await model(page);
log('recolour part 4:', before.parts.find((q) => q.id === 4).color, '->', after.parts.find((q) => q.id === 4).color);
await page.mouse.move(5, 300);
await snap('edit-recolour');
await page.keyboard.press(`${MOD}+z`);
// set root on the pinion
await press(page, '[data-action=set-root]').catch((e) => log('set-root', e.message));
log('root', (await model(page)).rootPartId, 'counts', (await status(page)).counts);
await page.keyboard.press(`${MOD}+z`);
await page.keyboard.press('Escape');
// Show kinematics
await page.keyboard.press('k'); await frames(page, 3);
log('kinematics on', (await state(page)).showKinematics, 'counts', (await status(page)).counts);
await page.mouse.move(5, 300);
await snap('edit-kinematics-home');
await K(page, () => window.__knap.setView('front')); await K(page, () => window.__knap.fit()); await frames(page, 3);
await snap('edit-kinematics-front');
await K(page, () => window.__knap.setView('top-front-left')); await K(page, () => window.__knap.fit()); await frames(page, 3);
await snap('edit-kinematics-tfl');
await page.keyboard.press('k');
// stale out-of-view hint: a lone 40 rolling on the ground
await setModel(page, { version: 3, rootPartId: null, nextPartId: 2, ground: true, fixRoot: false, parts: [{ id: 1, color: '#c8433a', cells: [C(0, 3, 0, 'pinHole', 0, 2.5, true), C(1, 3, 0, 'pinHole', 0), C(-1, 3, 0, 'pinHole', 0)] }] });
log('setModel lone gear msg', (await status(page)).message);
await page.keyboard.press('Home'); await settle();
await K(page, () => window.__knap.stepSim(1));
await K(page, () => window.__knap.setPaused(false));
await K(page, () => window.__knap.pushBody(1, [0, 0, 40], [40, 0, 0]));
for (let i = 0; i < 40; i++) { await page.waitForTimeout(250); const h = (await state(page)).hint; if (/out of view/.test(h)) { log('went out of view after', i * 0.25, 's'); break; } }
await page.mouse.move(600, 650);
log('hint now', (await state(page)).hint);
await page.keyboard.press('Space'); await frames(page, 2); // pause
log('paused', (await state(page)).paused);
await page.keyboard.press('f'); await settle(); await frames(page, 3);
await page.mouse.move(5, 300); await frames(page, 2);
log('after F while paused: hint', JSON.stringify((await state(page)).hint), 'status hint', (await status(page)).hint);
await snap('edit-outofview-paused-F');
await page.keyboard.press('Space'); await page.waitForTimeout(800);
log('after resume: hint', (await status(page)).hint);
log('errors', errors);
await s.close();
