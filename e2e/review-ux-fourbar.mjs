// UX review 1(a): build my own four-bar from an empty model, through the real UI.
// Ground (0..4,0,0) ∥Z holes, crank (0,0..2,1), rocker (4,0..3,1), coupler (0..4,2,2)+(4,3,2).
import { startUx, st, freshEmpty, parts } from './review-ux-lib.mjs';
import { frames, gridPos, hover, clickAt, clickFace, facePos, model, summary, cellIndexAt, settle } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-fourbar');
await freshEmpty(page, ux.url);
const log = async (label) => {
  const s = await st(page);
  console.log(`-- ${label}\n   hint: ${s.hint} ${s.aux ? `| aux: ${s.aux}` : ''}${s.invalid ? ' [INVALID]' : ''}\n   msg: ${s.message}${s.error ? ' [ERROR]' : ''}\n   counts: ${s.counts}`);
  return s;
};
const hoverFace = async (pid, pos, dir) => {
  const m = await model(page);
  const p = await facePos(page, pid, cellIndexAt(m, pid, pos), dir);
  await hover(page, p);
  return p;
};
const idOf = async (pos, kindRe) => {
  const m = await model(page);
  const p = m.parts.find((q) => q.cells.some((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2] && kindRe.test(c.kind)));
  return p?.id;
};

// ground
await page.keyboard.press('1');
await hover(page, await gridPos(page, 0, 0));
let s = await log('pin hole tool over grid (0,0)');
ux.check(/∥ Z/.test(s.hint), 'New on grid defaults to ∥ Z (vertical beam for a vertical mechanism)', s.hint);
await clickAt(page, await gridPos(page, 0, 0));
for (let x = 0; x < 4; x++) await clickFace(page, 1, [x, 0, 0], 0);
console.log(parts(await model(page)));
// crank pin
await page.keyboard.press('4');
await hoverFace(1, [0, 0, 0], 4);
await log('pin tool on +Z mouth of ground hole (0,0,0)');
await clickFace(page, 1, [0, 0, 0], 4);
let pinA = await idOf([0, 0, 0], /^pin$/);
await hoverFace(pinA, [0, 0, 0], 4);
await log('pin tool on the inserted pin end');
await clickFace(page, pinA, [0, 0, 0], 4);
// crank: hole tool on pin (0,0,1)
await page.keyboard.press('1');
await hoverFace(pinA, [0, 0, 1], 4);
s = await log('hole tool on +Z end of pin (0,0,1) (no Shift)');
await page.keyboard.down('Shift');
await frames(page, 1);
s = await log('… with Shift held (no mouse move)');
ux.check(/sleeve/i.test(s.hint), 'Shift pressed while hovering re-resolves to sleeve', s.hint);
await page.keyboard.up('Shift');
await frames(page, 1);
s = await log('… Shift released');
// (Since the fix, the sleeve is also the default without Shift on a rod's end: DEVIATIONS §7.)
ux.check(/^New part · sleeve/.test(s.hint), 'Shift released: still the sleeve (the default on a rod end)', s.hint);
await clickFace(page, pinA, [0, 0, 1], 4, { shift: true });
const crank = await idOf([0, 0, 1], /^pinHole$/);
await log(`sleeved crank part ${crank}`);
await hoverFace(crank, [0, 0, 1], 2);
await log('hole tool on +Y face of crank hole');
await clickFace(page, crank, [0, 0, 1], 2);
await clickFace(page, crank, [0, 1, 1], 2);
// rocker pin + rocker
await page.keyboard.press('4');
await clickFace(page, 1, [4, 0, 0], 4);
const pinB = await idOf([4, 0, 0], /^pin$/);
await clickFace(page, pinB, [4, 0, 0], 4);
await page.keyboard.press('1');
await clickFace(page, pinB, [4, 0, 1], 4, { shift: true });
const rocker = await idOf([4, 0, 1], /^pinHole$/);
for (let y = 0; y < 3; y++) await clickFace(page, rocker, [4, y, 1], 2);
// the -X face is hidden in the iso view: orbit by dragging empty space, build, then Home
await page.mouse.move(300, 600); await page.mouse.down(); await page.mouse.move(420, 600, { steps: 6 }); await page.mouse.up(); await frames(page, 2);
await shot('review-ux-10a-orbited');
await clickFace(page, rocker, [4, 3, 1], 1); // L-shaped rocker: (3,3,1)
await page.keyboard.press('Home'); await settle(page);
// crank-top pin
await page.keyboard.press('4');
await clickFace(page, crank, [0, 2, 1], 4);
const pinC = await idOf([0, 2, 1], /^pin$/);
await clickFace(page, pinC, [0, 2, 1], 4);
// rocker-top pin (1 long, planning ahead for the join)
await clickFace(page, rocker, [3, 3, 1], 4);
const pinD = await idOf([3, 3, 1], /^pin$/);
// coupler
await page.keyboard.press('1');
await clickFace(page, pinC, [0, 2, 2], 4, { shift: true });
const coupler = await idOf([0, 2, 2], /^pinHole$/);
for (let x = 0; x < 3; x++) await clickFace(page, coupler, [x, 2, 2], 0);
await clickFace(page, coupler, [3, 2, 2], 2);
await shot('review-ux-10-fourbar-before-last-pin');
// last pin: join
await page.keyboard.press('4');
await hoverFace(coupler, [3, 3, 2], 4);
s = await log('pin tool on coupler hole (3,3,2) +Z: pin behind in rocker');
ux.check(/insert pin/.test(s.hint) && /into part/.test(s.hint), 'join is offered', s.hint);
await clickFace(page, coupler, [3, 3, 2], 4);
let m = await model(page);
console.log(parts(m));
let sum = await summary(page);
console.log(sum.summary);
ux.check(sum.bodies === 4 && sum.revolute === 4 && sum.fixedBodies === 1, 'my four-bar: 4 bodies / 4 revolute / 1 fixed', sum.summary);
await page.mouse.move(5, 300);
await page.keyboard.press('k');
await frames(page, 2);
await shot('review-ux-11-fourbar-kinematics');
await page.keyboard.press('k');
// Play
const t0 = await page.evaluate(() => window.__knap.simTransforms());
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
await page.evaluate(() => window.__knap.setPaused(true));
await page.evaluate(() => window.__knap.stepSim(480));
await frames(page, 2);
const t1 = await page.evaluate(() => window.__knap.simTransforms());
const ang = (q) => (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
console.log('crank rotation after 1 s:', ang(t1[crank].q).toFixed(1), 'deg; rocker', ang(t1[rocker].q).toFixed(1));
ux.check(ang(t1[crank].q) > 5, 'four-bar moves after Play', `crank ${ang(t1[crank].q).toFixed(1)}°`);
await shot('review-ux-12-fourbar-sim');
const info = await page.evaluate(() => window.__knap.simInfo());
console.log('simInfo', info);
ux.check(info.jointError < 0.05, 'joint error small', String(info.jointError));
await page.keyboard.press('Escape');
await frames(page, 2);
const st1 = await page.evaluate(() => window.__knap.getState());
console.log('after Esc stop: mode', st1.mode, 'tool', st1.tool);
await ux.close();
