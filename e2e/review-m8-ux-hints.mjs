// Gear tool hints over pairs of single-hole parts at various offsets (real mouse hover + clicks).
import { session, setModel, M, C, face, status, hover, clickAt, model, frames, overflow, K } from './review-m8-ux-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('hints');
const log = (...a) => console.log(...a);
async function stepGear(id, label, shift = false) {
  const p = await face(page, id, 0, 4);
  if (!p) { log(label, 'NO FACE'); return; }
  await hover(page, p);
  if (shift) { await page.keyboard.down('Shift'); await frames(page, 1); }
  const before = await status(page);
  const ov = (await overflow(page)).filter((o) => o.clipped);
  await page.mouse.down(); await page.mouse.up(); await frames(page, 1);
  if (shift) await page.keyboard.up('Shift');
  const after = await status(page);
  const c = (await model(page)).parts.find((q) => q.id === id).cells[0];
  log(`${label}: hint="${before.hint}" aux="${before.aux}" | after msg="${after.message}" err=${after.error} counts="${after.counts}" -> rim=${c.rim} teeth=${c.teeth}${ov.length ? ' CLIPPED:' + ov.map((o) => o.role + ' ' + o.sw + '>' + o.cw).join(',') : ''}`);
}
async function setup(posB) {
  await setModel(page, M([[C(0, 0, 0)], [C(...posB)]], { rootPartId: 1, version: 1 }));
  await page.keyboard.press('Home'); await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2);
  await page.keyboard.press('t');
}
for (const [posB, aSteps, bSteps] of [
  [[2, 0, 0], 2, 4], // A=16, B 8,16,24,40
  [[3, 0, 0], 2, 4], // A=16 at 3
  [[3, 0, 0], 3, 4], // A=24 at 3
  [[2, 1, 0], 3, 2], // A=24 diag (2,1)
  [[3, 4, 0], 4, 4], // A=40 diag (3,4)
  [[1, 0, 0], 1, 2], // A=8, B at 1
]) {
  log(`\n=== B at ${posB}`);
  await setup(posB);
  for (let i = 0; i < aSteps; i++) await stepGear(1, `A step ${i + 1}`);
  for (let i = 0; i < bSteps; i++) await stepGear(2, `B step ${i + 1}`);
  await page.mouse.move(5, 300);
  await snap(`hints-${posB.join('_')}`);
}
// Shift down chain on a 40 and undo
log('\n=== shift down chain');
await setup([9, 0, 0]);
for (let i = 0; i < 4; i++) await stepGear(1, `A up ${i + 1}`);
for (let i = 0; i < 5; i++) await stepGear(1, `A down ${i + 1}`, true);
log('errors', errors);
await s.close();
