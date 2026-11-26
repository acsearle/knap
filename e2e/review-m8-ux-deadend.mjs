// (a) "40 teeth would fit" on a beam's middle hole: can the Gear tool get there? (b) an 8 on an axle meshing a 40.
import { session, setModel, M, C, face, status, hover, model, frames, K } from './review-m8-ux-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('deadend');
const log = (...a) => console.log(...a);
const settle = async () => { await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2); };
async function click(id, ci, dir, label, shift = false) {
  const p = await face(page, id, ci, dir);
  if (!p) return log(label, 'NO FACE');
  await hover(page, p);
  if (shift) { await page.keyboard.down('Shift'); await frames(page, 1); }
  const h = (await status(page)).hint;
  await page.mouse.down(); await page.mouse.up(); await frames(page, 1);
  if (shift) await page.keyboard.up('Shift');
  const c = (await model(page)).parts.find((q) => q.id === id)?.cells[ci];
  log(`${label}: "${h}" -> ${JSON.stringify(c)}`);
}
// (a)
await setModel(page, M([[0, 1, 2, 3, 4].map((x) => C(x, 0, 0))], { version: 1 }));
await page.keyboard.press('Home'); await settle();
await page.keyboard.press('t');
for (let i = 0; i < 3; i++) await click(1, 2, 4, `T on middle hole #${i}`);
await click(1, 2, 4, 'Shift+T on middle hole', true);
await page.keyboard.press('w');
for (let i = 0; i < 5; i++) await click(1, 2, 4, `W on middle hole #${i}`);
await page.keyboard.press('t');
await click(1, 2, 4, 'T on the wheel');
await page.keyboard.press('f'); await settle(); await page.mouse.move(5, 300); await snap('deadend-40-on-beam');
// (b) frame with a hole, an axle through an 8 at (3,0,1), then grow a 40 at (0,0,1) on its own pin
const frame = [0, 1, 2, 3].map((x) => C(x, 0, 0));
const axle = [C(3, 0, 0, 'axle'), C(3, 0, 1, 'axle'), C(3, 0, 2, 'axle')];
const g8 = [C(3, 0, 1, 'axleHole', 2, 0.5, true)];
const pin40 = [C(0, 0, 0, 'pin'), C(0, 0, 1, 'pin')];
const hub40 = [C(0, 0, 1, 'pinHole')];
await setModel(page, M([frame, axle, g8, pin40, hub40], { version: 3 }));
log('setModel (b) ok?', JSON.stringify((await model(page)).parts.length), (await status(page)).message);
await page.keyboard.press('Home'); await settle();
await page.keyboard.press('t');
for (let i = 0; i < 4; i++) await click(5, 0, 4, `T on the 40-to-be #${i}`);
// same with a pin (not axle) in the 8 and the 8's own part carrying a second hole in layer 2
await setModel(page, M([frame, [C(3, 0, 0, 'pin'), C(3, 0, 1, 'pin')], [C(3, 0, 1, 'pinHole', 2, 0.5, true)], pin40, hub40], { version: 3 }));
await page.keyboard.press('Home'); await settle();
for (let i = 0; i < 4; i++) await click(5, 0, 4, `pin variant: T on the 40-to-be #${i}`);
log('errors', errors);
await s.close();
