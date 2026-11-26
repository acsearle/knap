// Wheel / Erase / build tools on gears in a mesh; ghost vs result screenshots.
import { session, setModel, M, C, face, virt, status, hover, model, frames, K, canon, scr } from './review-m8-ux-lib.mjs';
const s = await session();
const { page, errors, snap } = await s.open('tools');
const log = (...a) => console.log(...a);
const settle = async () => { await page.waitForFunction(() => !window.__knap.getState().animating); await frames(page, 2); };
async function at(label, p, { click = true, shift = false, alt = false } = {}) {
  if (!p) return log(label, 'NO POINT');
  await hover(page, p);
  if (shift) await page.keyboard.down('Shift');
  if (alt) await page.keyboard.down('Alt');
  await frames(page, 1);
  const st = await status(page);
  const b = canon(await model(page));
  if (click) { await page.mouse.down(); await page.mouse.up(); await frames(page, 1); }
  if (shift) await page.keyboard.up('Shift');
  if (alt) await page.keyboard.up('Alt');
  const a = await model(page);
  const st2 = await status(page);
  log(`${label}: hover="${st.hover}" hint="${st.hint}" -> ${click ? (canon(a) === b ? 'no change' : 'CHANGED') : '-'}${st2.error ? ' ERR "' + st2.message + '"' : ''}`);
  return a;
}
// part 1: a 40 at (0,0,0) with a beam behind at z=-1; part 2: an 8 at (3,0,0) with its own hole at (3,0,1) (pinion style); part 3: 16+16 pair
const P1 = [C(0, 0, 0, 'pinHole', 2, 2.5, true), C(0, 0, -1), C(-1, 0, -1), C(1, 0, -1)];
const P2 = [C(3, 0, 0, 'pinHole', 2, 0.5, true), C(3, 0, 1)];
const P3 = [C(0, 6, 0, 'pinHole', 2, 1, true)];
const P4 = [C(2, 6, 0, 'pinHole', 2, 1, true)];
await setModel(page, M([P1, P2, P3, P4], { version: 3 }));
await page.keyboard.press('Home'); await settle();
log('counts', (await status(page)).counts);
await page.mouse.move(5, 300); await snap('tools-0');
// Wheel tool on gears
await page.keyboard.press('w');
await at('W on the 8 (meshing a 40)', await face(page, 2, 0, 4));
await at('W on the 16 (meshing a 16)', await face(page, 3, 0, 4));
await at('W on the 40 via its face', await virt(page, 1, 0, [1, 1, 0], 4), { click: false });
await at('Shift+W on the 40', await virt(page, 1, 0, [1, 1, 0], 4), { click: false, shift: true });
// Erase tool on gears
await page.keyboard.press('e');
await at('E on the 8 hub (8 -> bare)', await face(page, 2, 0, 4), { click: false });
await at('E on the 16 face', await face(page, 3, 0, 4), { click: false });
await at('E on the 40 web virtual cell (1,1)', await virt(page, 1, 0, [1, 1, 0], 4), { click: false });
await at('E on the 40 near teeth (2,1)', await virt(page, 1, 0, [2, 1, 0], 4), { click: false });
// Build tools on the 40: hole on web, pin on web, axle in web, hole near teeth
await page.keyboard.press('1');
await at('pin hole on web (1,0)', await virt(page, 1, 0, [1, 0, 0], 4));
let m = await model(page);
const wi = m.parts[0].cells.findIndex((c) => c.x === 1 && c.y === 0 && c.z === 0);
log('web cell index', wi);
await page.keyboard.press('4');
await at('pin tool on the new web hole (insert crank pin)', wi >= 0 ? await face(page, 1, wi, 4) : null);
m = await model(page);
log('parts after crank pin', m.parts.length, JSON.stringify(m.parts.at(-1)));
await at('pin tool on 40 web (-1,1) (crank pin of its own part)', await virt(page, 1, 0, [-1, 1, 0], 4));
await page.keyboard.press('3');
await at('axle tool into the 40 hub', await face(page, 1, 0, 4));
m = await model(page);
log('parts', m.parts.length, JSON.stringify(m.parts.at(-1)));
await page.keyboard.press('2');
await at('axle hole tool on 40 web (0,-1)', await virt(page, 1, 0, [0, -1, 0], 4));
await at('axle hole tool on 40 (0,-2) near teeth', await virt(page, 1, 0, [0, -2, 0], 4), { click: false });
await at('axle hole tool on 40 teeth (edge-on)', await scr(page, [-2.55, -0.3, 0]), { click: false });
// Back side on the 40 (Alt) from Home: picks the far face
await page.keyboard.press('1');
await at('Alt + pin hole over the 40 face', await virt(page, 1, 0, [-1, -1, 0], 4), { click: false, alt: true });
// Gear tool on a web hole of the 40 (own part, its tip reaches): acts on the 40
await page.keyboard.press('t');
await at('T on the web hole (1,0,0)', wi >= 0 ? await face(page, 1, wi, 4) : null, { click: false });
// ghost vs result: the 16 (part 4) -> 24? blocked. Use part 2's own hole (3,0,1)
await page.keyboard.press('t');
const gp = await face(page, 2, 1, 4);
await hover(page, gp); await frames(page, 2);
log('ghost hint', (await status(page)).hint);
await snap('tools-ghost-before');
await page.mouse.down(); await page.mouse.up(); await frames(page, 2);
await page.mouse.move(5, 300); await frames(page, 2);
await snap('tools-ghost-after');
log('errors', errors);
await s.close();
