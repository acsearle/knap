// UX review 1(b): crank — beam with an axle hole, axle through it and a pin hole of the fixed
// beam, bushes on both sides → revolute; remove one bush → one-sided slide.
import { startUx, st, freshEmpty, parts, cubePoint, mk } from './review-ux-lib.mjs';
import { frames, gridPos, hover, clickAt, clickFace, facePos, model, summary, cellIndexAt, settle } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-crank');
await freshEmpty(page, ux.url);
const { log, idOf } = mk(page);
const hoverFace = async (pid, pos, dir) => {
  const m = await model(page);
  const p = await facePos(page, pid, cellIndexAt(m, pid, pos), dir);
  await hover(page, p);
  return p;
};

await page.keyboard.press('1');
await hover(page, await gridPos(page, 0, 0)); // ∥ Z by default (was: R from ∥ Y)
await clickAt(page, await gridPos(page, 0, 0));
await clickFace(page, 1, [0, 0, 0], 0);
await clickFace(page, 1, [1, 0, 0], 0);
// axle into the ground's first hole
await page.keyboard.press('3');
await hoverFace(1, [0, 0, 0], 4);
await log('axle tool on +Z mouth of ground hole');
await clickFace(page, 1, [0, 0, 0], 4);
const axle = await idOf([0, 0, 0], /^axle$/);
await hoverFace(axle, [0, 0, 0], 4);
await log('axle tool on the axle end');
await clickFace(page, axle, [0, 0, 0], 4);
// crank: axle hole sleeved on the axle
await page.keyboard.press('2');
await hoverFace(axle, [0, 0, 1], 4);
let s = await log('axle-hole tool on +Z end of axle (0,0,1), no Shift');
ux.check(!/Extend part \d+ · axle hole ∥ [XY]/.test(s.hint), 'default for a hole tool on an axle end is not "weld a perpendicular hole onto the axle"', s.hint);
await shot('review-ux-20-crank-default-on-axle-end');
await clickFace(page, axle, [0, 0, 1], 4, { shift: true });
const crank = await idOf([0, 0, 1], /^axleHole$/);
await log(`crank started (part ${crank})`);
await page.keyboard.press('1');
await hoverFace(crank, [0, 0, 1], 0);
s = await log('pin-hole tool on +X face of the crank axle hole');
await clickFace(page, crank, [0, 0, 1], 0);
await clickFace(page, crank, [1, 0, 1], 0);
// axle out the front + bush
await page.keyboard.press('3');
await hoverFace(axle, [0, 0, 1], 4);
await log('axle tool on axle end inside the crank hole');
await clickFace(page, axle, [0, 0, 1], 4);
await page.keyboard.press('2');
await clickFace(page, axle, [0, 0, 2], 4, { shift: true });
const bush1 = await idOf([0, 0, 2], /^axleHole$/);
let sum = await summary(page);
console.log('front bush only:', sum.summary, JSON.stringify(sum.jointList));
// back side: snap to BACK with the cube
const bp = await cubePoint(page, [0, 0, -1]);
console.log('cube point for BACK:', bp);
ux.check(!!bp, 'BACK face of the cube is clickable from the iso view? (it is hidden; use corner instead)');
const corner = await cubePoint(page, [1, 1, -1]);
console.log('cube corner (+X,+Y,-Z):', corner);
await hover(page, corner);
await shot('review-ux-21-cube-hover-corner');
await clickAt(page, corner);
await settle(page);
console.log('camera after corner click', await page.evaluate(() => window.__knap.camera()));
await shot('review-ux-22-back-corner-view');
await page.keyboard.press('3');
await hoverFace(1, [0, 0, 0], 5).catch(() => null);
s = await log('axle tool on -Z face of the ground hole (0,0,0) (axle inside)');
await hoverFace(axle, [0, 0, 0], 5);
s = await log('axle tool on -Z end of the axle (0,0,0)');
await clickFace(page, axle, [0, 0, 0], 5);
await page.keyboard.press('2');
await clickFace(page, axle, [0, 0, -1], 5, { shift: true });
const bush2 = await idOf([0, 0, -1], /^axleHole$/);
sum = await summary(page);
console.log(parts(await model(page)));
console.log('two bushes:', sum.summary, JSON.stringify(sum.jointList));
ux.check(sum.revolute === 1 && sum.joints === 1, 'bushes on both sides → revolute', sum.summary);
await page.mouse.move(400, 600);
await page.keyboard.press('k');
await frames(page, 2);
await shot('review-ux-23-crank-revolute-kin');
// erase the back bush
await page.keyboard.press('e');
await hoverFace(axle, [0, 0, -1], 5);
s = await log('erase hover at the centre of the back bush (axle end)');
const pb = await hoverFace(bush2, [0, 0, -1], 5);
s = await log('erase hover on the bush ring');
await shot('review-ux-24-erase-bush-hover');
await clickAt(page, pb);
sum = await summary(page);
console.log('after erasing the back bush:', sum.summary, JSON.stringify(sum.jointList));
ux.check(sum.cylindrical === 1 && sum.jointList[0].limits && (sum.jointList[0].limits[0] === 0 || sum.jointList[0].limits[1] === 0), 'one bush → one-sided slide', JSON.stringify(sum.jointList));
await page.mouse.move(400, 600);
await frames(page, 2);
await shot('review-ux-25-crank-cylindrical-kin');
// erase a male inside a hole: centre of the axle end
await hoverFace(axle, [0, 0, -1], 5);
s = await log('erase hover axle end (0,0,-1)');
await page.keyboard.press('k');
await ux.close();
