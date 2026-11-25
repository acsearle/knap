// UX review 1(c) perpendicular connector + beam on a friction pin; 1(d) liftarm with a side pin.
import { startUx, st, freshEmpty, parts, cubePoint, mk } from './review-ux-lib.mjs';
import { frames, gridPos, hover, clickAt, clickFace, facePos, model, summary, cellIndexAt, settle } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-parts');
await freshEmpty(page, ux.url);
const { log, idOf } = mk(page);
const hoverFace = async (pid, pos, dir) => {
  const m = await model(page);
  const p = await facePos(page, pid, cellIndexAt(m, pid, pos), dir);
  await hover(page, p);
  return p;
};

// (c) connector: Z hole at origin, X hole on top
await page.keyboard.press('1');
await hover(page, await gridPos(page, 0, 0));
await page.keyboard.press('r');
await clickAt(page, await gridPos(page, 0, 0));
await hoverFace(1, [0, 0, 0], 2);
let s = await log('pin-hole tool on +Y face of a Z hole');
await page.keyboard.press('r');
await frames(page, 1);
s = await log('after R');
ux.check(/∥ X/.test(s.hint), 'R gives ∥ X', s.hint);
await clickFace(page, 1, [0, 0, 0], 2);
await shot('review-ux-30-connector');
// axisPref persists: now hover the grid elsewhere
await hover(page, await gridPos(page, 4, 0));
s = await log('same tool, hover grid after choosing X with R');
// friction pin through the X hole
await page.keyboard.press('5');
await hoverFace(1, [0, 1, 0], 0);
s = await log('friction-pin tool on +X mouth of the X hole');
await clickFace(page, 1, [0, 1, 0], 0);
const fp = await idOf([0, 1, 0], /^frictionPin$/);
await clickFace(page, fp, [0, 1, 0], 0);
await page.keyboard.press('1');
await hoverFace(fp, [1, 1, 0], 0);
s = await log('pin-hole tool on +X end of the friction pin');
await clickFace(page, fp, [1, 1, 0], 0, { shift: true });
const beam = await idOf([1, 1, 0], /^pinHole$/);
s = await log(`sleeved beam ${beam}`);
await hoverFace(beam, [1, 1, 0], 2);
s = await log('pin-hole tool on +Y of the sleeved beam');
ux.check(/pin hole ∥ X/.test(s.hint), 'beam extends with its own axis (X)', s.hint);
await clickFace(page, beam, [1, 1, 0], 2);
await clickFace(page, beam, [1, 2, 0], 2);
let sum = await summary(page);
console.log(parts(await model(page)));
console.log(sum.summary);
ux.check(sum.bodies === 1 && sum.joints === 0, 'connector + friction pin + beam = 1 body', sum.summary);
await page.mouse.move(300, 600);
await frames(page, 2);
await shot('review-ux-31-connector-beam');

// (d) liftarm with a side pin, away from the rest
await page.keyboard.press('1');
await hover(page, await gridPos(page, 0, 4));
s = await log('pin-hole tool on grid (0,4) (axisPref X from before?)');
await clickAt(page, await gridPos(page, 0, 4));
const la = await idOf([0, 0, 4], /^pinHole$/);
await clickFace(page, la, [0, 0, 4], 0);
await clickFace(page, la, [1, 0, 4], 0);
console.log(parts(await model(page)));
await page.keyboard.press('4');
await hoverFace(la, [1, 0, 4], 4);
s = await log('pin tool on +Z (side wall) of the middle liftarm hole');
await clickFace(page, la, [1, 0, 4], 4);
let m = await model(page);
console.log(parts(m));
const laPart = m.parts.find((p) => p.id === la);
ux.check(laPart.cells.some((c) => c.kind === 'pin' && c.z === 5), 'side pin became part of the liftarm', parts(m));
await page.mouse.move(300, 600);
await frames(page, 2);
await shot('review-ux-32-liftarm-sidepin');
await ux.close();
