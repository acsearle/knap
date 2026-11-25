// UX review: what the defaults give a new user, and how helpful the invalid-placement reasons are.
import { startUx, st, freshEmpty, parts, mk } from './review-ux-lib.mjs';
import { frames, gridPos, hover, clickAt, clickFace, facePos, model, summary, cellIndexAt, settle, state } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-defaults');
await freshEmpty(page, ux.url);
const { log, idOf } = mk(page);
const hoverFace = async (pid, pos, dir) => {
  const m = await model(page);
  const p = await facePos(page, pid, cellIndexAt(m, pid, pos), dir);
  await hover(page, p);
  return p;
};

// --- 1. the "obvious" pendulum with every default (no R)
console.log('\n===== pendulum with defaults only');
await page.keyboard.press('Space');
await frames(page, 2);
let s = await log('Space on an empty model');
await page.keyboard.press('1');
await clickAt(page, await gridPos(page, 0, 0));
await clickFace(page, 1, [0, 0, 0], 0);
await clickFace(page, 1, [1, 0, 0], 0);
// (After the fix New on grid defaults to ∥ Z — the beam stands upright — and a hole tool on the
// pin's end sleeves without Shift. The flat ∥ Y build of the original finding is in
// tests/review/ux.review.test.ts.)
const m0 = await model(page);
const a = m0.parts[0].cells[0].axis;
const mouth = 2 * a; // + face along the hole axis
const up = [0, 0, 0];
up[a] = 1;
await page.keyboard.press('4');
await clickFace(page, 1, [2, 0, 0], mouth); // mouth of the last hole → insert
const pin = await idOf([2, 0, 0], /^pin$/);
await clickFace(page, pin, [2, 0, 0], mouth);
await page.keyboard.press('1');
const top = [2 + up[0], up[1], up[2]];
await clickFace(page, pin, top, mouth); // sleeve onto the pin's end (the default there)
const link = await idOf(top, /^pinHole$/);
for (let x = 2; x < 6; x++) await clickFace(page, link, [x, top[1], top[2]], 0);
console.log(parts(await model(page)));
const sum = await summary(page);
console.log(sum.summary);
await page.mouse.move(300, 650);
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
await page.evaluate(() => window.__knap.setPaused(true));
await page.evaluate(() => window.__knap.stepSim(960));
const tr = await page.evaluate(() => window.__knap.simTransforms());
const ang = (q) => (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
console.log('link rotation after 2 s:', ang(tr[link].q).toFixed(3), '°');
s = await log('simulating the flat pendulum');
ux.check(ang(tr[link].q) > 1, 'a pendulum built with the default orientations moves (or the UI says why not)', `${ang(tr[link].q).toFixed(4)}°; status: ${s.message}`);
await frames(page, 2);
await shot('review-ux-80-flat-pendulum-sim');
await page.keyboard.press('Escape');
await frames(page, 2);

// --- 2. invalid placements and their reasons
console.log('\n===== invalid placement reasons');
await page.locator('[data-action=new]').click();
await frames(page, 2);
await settle(page);
await page.keyboard.press('1');
await hover(page, await gridPos(page, 0, 0)); // ∥ Z by default
await clickAt(page, await gridPos(page, 0, 0));
await clickFace(page, 1, [0, 0, 0], 0);
await clickFace(page, 1, [1, 0, 0], 0); // beam (0..2,0,0) ∥Z
// pin into an axle hole
await page.keyboard.press('2');
await clickFace(page, 1, [2, 0, 0], 4, { shift: true }); // new adjacent axle hole at (2,0,1)
const ah = await idOf([2, 0, 1], /^axleHole$/);
await page.keyboard.press('4');
await hoverFace(ah, [2, 0, 1], 4);
s = await log('pin tool on an axle hole mouth');
await shot('review-ux-81-invalid-pin-in-axle-hole');
await clickFace(page, ah, [2, 0, 1], 4);
s = await log('… clicked');
// male end on a coaxial ring of its own part: extend beam with a pin along Z
await hoverFace(1, [0, 0, 0], 4);
s = await log('pin tool on +Z mouth of the beam (insert)');
await page.keyboard.down('Shift');
await frames(page, 1);
s = await log('… with Shift');
await page.keyboard.up('Shift');
// male side: pin standing on the beam's top (+Y wall) — valid (end on wall)
await hoverFace(1, [1, 0, 0], 2);
s = await log('pin tool on the +Y wall of the beam');
// axle tool on the side of a pin (male side): extend the pin sideways
await page.keyboard.press('4');
await clickFace(page, 1, [0, 0, 0], 4);
const p2 = await idOf([0, 0, 0], /^pin$/);
await clickFace(page, p2, [0, 0, 0], 4);
await page.keyboard.press('3');
await hoverFace(p2, [0, 0, 1], 2);
s = await log('axle tool on the side (+Y) of a protruding pin');
await page.keyboard.press('r');
s = await log('… R');
await page.keyboard.press('1');
await hoverFace(p2, [0, 0, 1], 2);
s = await log('pin-hole tool on the side (+Y) of a protruding pin');
// two stacked beams: a 1-cell pin only fills the front one
console.log('\n===== stacked holes: insert depth');
await page.keyboard.press('1');
await clickFace(page, 1, [1, 0, 0], 4, { shift: true }); // new part at (1,0,1)
const b2 = await idOf([1, 0, 1], /^pinHole$/);
await page.keyboard.press('4');
await hoverFace(b2, [1, 0, 1], 4);
s = await log('pin tool on the front hole of two stacked holes (1,0,1)/(1,0,0)');
await clickFace(page, b2, [1, 0, 1], 4);
const p3 = await idOf([1, 0, 1], /^pin$/);
let m = await model(page);
console.log('inserted pin', JSON.stringify(m.parts.find((p) => p.id === p3).cells));
await hoverFace(p3, [1, 0, 1], 4);
s = await log('pin tool on that pin end: can it go deeper?');
const sm = await summary(page);
console.log(sm.summary);
ux.check(m.parts.find((p) => p.id === p3).cells.length === 2 || /\(1, 0, 0\)/.test(s.hint), 'pushing a pin into two stacked holes from the front reaches the back hole (or offers to)', `pin cells ${JSON.stringify(m.parts.find((p) => p.id === p3).cells)}; hint "${s.hint}"`);
await page.mouse.move(300, 650);
await frames(page, 2);
await shot('review-ux-82-stacked-insert');
await ux.close();
