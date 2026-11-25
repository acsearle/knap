// UX review: rotation rejection, inspector buttons, Esc with menu, undo of example load, build from below.
import { startUx, st, mk, parts, cubePoint } from './review-ux-lib.mjs';
import { frames, hover, clickAt, clickFace, facePos, model, summary, cellIndexAt, settle, press, state, openApp, gridPos } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-misc');
await openApp(page, ux.url);
const { log } = mk(page);
const loadExample = async (name) => {
  await press(page, '[data-action=examples]');
  await press(page, `[data-example=${name}]`);
  await settle(page);
};

console.log('\n===== rotation rejection');
await loadExample('pendulum');
await page.keyboard.press('v');
await clickFace(page, 1, [-1, 0, 0], 4); // select the frame (holds the pin at (0,0,0))
for (const k of [']', ']', '[']) {
  const m0 = JSON.stringify(await model(page));
  await page.keyboard.press(k);
  await frames(page, 1);
  const m1 = JSON.stringify(await model(page));
  const s = await st(page);
  console.log(`${k}: ${m0 === m1 ? 'REJECTED' : 'rotated'} — "${s.message}"${s.error ? ' [error]' : ''}`);
}
await shot('review-ux-90-rotate');

console.log('\n===== inspector buttons + Esc with the menu');
await loadExample('pendulum');
await page.keyboard.press('v');
await clickFace(page, 2, [3, 0, 1], 4);
await press(page, '[data-action=duplicate]');
let s = await log('Duplicate button');
await press(page, '[data-action=delete]');
s = await log('Delete button');
console.log('selection after delete', (await state(page)).selection);
await clickFace(page, 2, [3, 0, 1], 4);
await press(page, '[data-action=examples]');
await page.keyboard.press('Escape');
let stt = await state(page);
console.log('Esc with the menu open → menu', await page.locator('[data-role=examples-menu]').isVisible(), 'selection', stt.selection);
await page.keyboard.press('Escape');
stt = await state(page);
console.log('second Esc → selection', stt.selection);

console.log('\n===== undo after loading an example');
const before = JSON.stringify(await model(page));
await loadExample('collision');
await page.keyboard.press('Meta+z');
await frames(page, 2);
console.log('undo restores previous model:', JSON.stringify(await model(page)) === before, '; message', (await st(page)).message);

console.log('\n===== building on the grid from below');
await page.locator('[data-action=new]').click();
await frames(page, 2);
await settle(page);
const bp = await cubePoint(page, [1, -1, 1]);
console.log('cube corner below', bp);
// orbit below: drag upward
await page.mouse.move(300, 300);
await page.mouse.down();
await page.mouse.move(300, 120, { steps: 6 });
await page.mouse.up();
await frames(page, 2);
console.log('camera', await page.evaluate(() => window.__knap.camera()));
await page.keyboard.press('1');
const g = await page.evaluate(() => window.__knap.clientPosOfGrid(0, 0));
console.log('grid (0,0) from below:', g);
if (g) {
  await hover(page, g);
  s = await log('hover grid from below');
  await shot('review-ux-91-grid-from-below');
  await clickAt(page, g);
  console.log(parts(await model(page)));
}
await ux.close();
