// A new user builds a geared pendulum from an empty model with mouse and keys only.
import { session, face, virt, status, hover, model, frames, overflow, K, scr } from './review-m8-ux-lib.mjs';
import { gridPos } from './app-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('newuser');
const log = (...a) => console.log(...a);
const settle = async () => { await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2); };
const idx = (m, id, pos) => m.parts.find((p) => p.id === id).cells.findIndex((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
let n = 0;
async function act(label, getPoint, { shift = false, click = true } = {}) {
  const p = await getPoint();
  if (!p) { log(`[${label}] NO POINT`); return null; }
  await hover(page, p);
  if (shift) { await page.keyboard.down('Shift'); await frames(page, 1); }
  const st = await status(page);
  const clipped = (await overflow(page)).filter((o) => o.clipped && o.role !== 'status-message').map((o) => o.role);
  const before = JSON.stringify(await model(page));
  if (click) { await page.mouse.down(); await page.mouse.up(); await frames(page, 1); }
  if (shift) await page.keyboard.up('Shift');
  const after = await model(page);
  const st2 = await status(page);
  log(`[${label}] hover="${st.hover}" hint="${st.hint}"${clipped.length ? ' CLIPPED ' + clipped : ''} -> ${click ? (JSON.stringify(after) === before ? 'NO CHANGE' : 'changed') : 'hover only'}${st2.error ? ' ERR "' + st2.message + '"' : ''}`);
  if (++n % 1 === 0) await snap(`newuser-${String(n).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '_')}`);
  return after;
}
const m = () => model(page);
await page.click('[data-action=new]').catch(() => {});
await settle();
log('initial hint:', (await status(page)).hint);
// 1. a frame beam along X: 4 pin holes
await page.keyboard.press('1');
await act('grid (0,0)', () => gridPos(page, 0, 0));
for (let i = 0; i < 4; i++) { const mm = await m(); await act(`extend +X ${i}`, () => face(page, 1, idx(mm, 1, [i, 0, 0]), 0)); }
await page.keyboard.press('f'); await settle();
// 2. naive: Gear tool on a beam hole
await page.keyboard.press('t');
let mm = await m();
await act('gear on beam hole (0,0,0)', () => face(page, 1, idx(mm, 1, [0, 0, 0]), 4));
await act('gear on beam hole (2,0,0)', () => face(page, 1, idx(mm, 1, [2, 0, 0]), 4));
// 3. insert a pin into (0,0,0) from the front: pin tool 4
await page.keyboard.press('4');
await act('insert pin (0,0,0)', () => face(page, 1, idx(mm, 1, [0, 0, 0]), 4));
mm = await m();
log('parts', JSON.stringify(mm.parts.map((p) => [p.id, p.cells.map((c) => [c.x, c.y, c.z, c.kind])])));
const pinId = mm.parts[mm.parts.length - 1].id;
// the pin sticks out? extend it +Z
await act('extend pin +Z', async () => { const q = await m(); const p = q.parts.find((x) => x.id === pinId); return face(page, pinId, p.cells.length - 1, 4); });
mm = await m();
log('pin cells', JSON.stringify(mm.parts.find((x) => x.id === pinId).cells));
// 4. hole tool on the pin's end: sleeve
await page.keyboard.press('1');
await act('sleeve hole on pin end', async () => { const q = await m(); const p = q.parts.find((x) => x.id === pinId); return face(page, pinId, p.cells.length - 1, 4); });
mm = await m();
const gId = mm.parts[mm.parts.length - 1].id;
log('gear part', gId, JSON.stringify(mm.parts.find((x) => x.id === gId).cells));
// 5. Gear tool up to 40
await page.keyboard.press('t');
for (let i = 0; i < 4; i++) await act(`gear up ${i}`, () => face(page, gId, 0, 4));
await page.keyboard.press('f'); await settle();
// 6. same for an 8 at (3,0,1)
await page.keyboard.press('4');
mm = await m();
await act('insert pin (3,0,0)', () => face(page, 1, idx(mm, 1, [3, 0, 0]), 4));
mm = await m();
const pin2 = mm.parts[mm.parts.length - 1].id;
log('pin2 cells', JSON.stringify(mm.parts.find((x) => x.id === pin2).cells));
await act('extend pin2 +Z', async () => { const q = await m(); const p = q.parts.find((x) => x.id === pin2); return face(page, pin2, p.cells.length - 1, 4); });
mm = await m();
log('pin2 cells', JSON.stringify(mm.parts.find((x) => x.id === pin2).cells));
await page.keyboard.press('1');
await act('sleeve hole on pin2 end', async () => { const q = await m(); const p = q.parts.find((x) => x.id === pin2); return face(page, pin2, p.cells.length - 1, 4); });
mm = await m();
const g2 = mm.parts[mm.parts.length - 1].id;
log('gear2 part', g2, JSON.stringify(mm.parts.find((x) => x.id === g2).cells));
await page.keyboard.press('t');
await act('gear2 up 0', () => face(page, g2, 0, 4));
await act('gear2 up 1 (16, refused?)', () => face(page, g2, 0, 4));
// 7. an arm on the 40: extend +Z from the hub, then -X
await page.keyboard.press('1');
await act('extend gear +Z', () => face(page, gId, 0, 4));
mm = await m();
for (const x of [0, -1, -2]) { const q = await m(); await act(`arm -X from ${x}`, () => face(page, gId, idx(q, gId, [x, 0, 2]), 1)); }
await page.keyboard.press('f'); await settle();
await page.mouse.move(5, 300);
await snap('newuser-final');
mm = await m();
log('final model', JSON.stringify(mm));
log('analyze', JSON.stringify(await K(page, () => { const a = window.__knap.analyze(); return { s: a.summary, meshes: a.meshes }; })));
log('counts', (await status(page)).counts);
// Play for 2 s of sim
await K(page, () => window.__knap.stepSim(240));
const tr = await K(page, () => window.__knap.simTransforms());
log('after 240 steps', JSON.stringify(tr));
log('simInfo', JSON.stringify(await K(page, () => { const i = window.__knap.simInfo(); return { meshes: i.meshes, k: i.substeps, je: i.jointError }; })));
await snap('newuser-sim');
log('errors', errors);
await s.close();
