// UX review 3: camera / view widget per DESIGN.md §6.2 inside the real app.
import { startUx, st, mk, cubePoint, parts } from './review-ux-lib.mjs';
import { frames, hover, clickAt, clickFace, facePos, model, settle, press, state, openApp, gridPos } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-camera');
await openApp(page, ux.url); // four-bar
const cam = () => page.evaluate(() => window.__knap.camera());
const expectFor = (d) => {
  const n = Math.hypot(...d);
  return { yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(d[1] / n) };
};
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const name = (d) => d.map((v) => (v > 0 ? '+' : v < 0 ? '-' : '0')).join('');

// --- cube regions from Home
const regions = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) regions.push([x, y, z]);
const reached = new Set();
const tryRegion = async (d, from) => {
  const p = await cubePoint(page, d);
  if (!p) return false;
  await hover(page, p);
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 1);
  await settle(page);
  const c = await cam();
  const e = expectFor(d);
  const pitchOk = Math.abs(c.pitch - e.pitch) < 1e-3;
  const yawOk = d[0] === 0 && d[2] === 0 ? true : angDiff(c.yaw, e.yaw) < 1e-3;
  ux.check(pitchOk && yawOk, `cube ${name(d)} (from ${from}) snaps to its view`, `yaw ${c.yaw.toFixed(3)} pitch ${c.pitch.toFixed(3)} expected yaw ${e.yaw.toFixed(3)} pitch ${e.pitch.toFixed(3)}`);
  reached.add(name(d));
  return true;
};
// from Home, then from each face view reach its neighbours
await page.keyboard.press('Home');
await settle(page);
const home = await cam();
console.log('home camera', home);
for (const d of regions) {
  await page.keyboard.press('Home');
  await settle(page);
  await tryRegion(d, 'home');
}
// from the bottom-ish: orbit down below the horizon, then try the remaining regions
for (const d of regions.filter((d) => !reached.has(name(d)))) {
  await page.keyboard.press('Home');
  await settle(page);
  // orbit: drag up = pitch more negative? find by trying
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(300 - d[0] * 0 + 300 * 0, 300 - 160, { steps: 8 });
  await page.mouse.move(300 + 370, 300 - 160, { steps: 8 });
  await page.mouse.up();
  await frames(page, 1);
  if (!(await tryRegion(d, 'orbited below'))) console.log(`region ${name(d)} not visible after orbit`, await cam());
}
console.log('regions reached:', reached.size, '/ 26');
// --- hover highlight
await page.keyboard.press('Home');
await settle(page);
await hover(page, await cubePoint(page, [1, 1, 1]));
await frames(page, 2);
await shot('review-ux-60-cube-hover-corner', { clip: { x: 1100, y: 40, width: 180, height: 140 } });
await hover(page, await cubePoint(page, [1, 0, 1]));
await frames(page, 2);
await shot('review-ux-61-cube-hover-edge', { clip: { x: 1100, y: 40, width: 180, height: 140 } });
await hover(page, await cubePoint(page, [0, 0, 1]));
await frames(page, 2);
await shot('review-ux-62-cube-hover-face', { clip: { x: 1100, y: 40, width: 180, height: 140 } });

// --- Fit with / without selection, Home button vs key
await page.keyboard.press('v');
await clickAt(page, await page.evaluate(() => window.__knap.partScreenPos(3)));
const sel = (await state(page)).selection;
await page.keyboard.press('f');
await settle(page);
const cFitSel = await cam();
const pSel = await page.evaluate((id) => window.__knap.partScreenPos(id), sel);
console.log('F with selection', sel, cFitSel, 'part centre on screen', pSel);
await shot('review-ux-63-fit-selection');
await page.keyboard.press('Escape');
await page.keyboard.press('f');
await settle(page);
const cFitAll = await cam();
console.log('F without selection', cFitAll);
ux.check(cFitSel.height < cFitAll.height, 'Fit with a selection frames tighter than Fit all', `${cFitSel.height} vs ${cFitAll.height}`);
await press(page, '[data-action=examples]').catch(() => {});
await page.keyboard.press('Escape');
const fitBtn = await page.evaluate(() => {
  const bs = [...document.querySelectorAll('[data-role=viewport] button')].map((b) => ({ t: b.title, l: b.getAttribute('aria-label'), r: b.getBoundingClientRect().toJSON() }));
  return bs;
});
console.log('viewport buttons', JSON.stringify(fitBtn));

// --- gestures with each tool: no placement after a drag, tiny jitter click still places
const gesture = async (tool, kind) => {
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press(tool);
  const m0 = JSON.stringify(await model(page));
  const c0 = await cam();
  const p = await facePos(page, 3, 2, 4); // a face of the coupler
  await page.mouse.move(p.x, p.y);
  if (kind === 'left') {
    await page.mouse.down();
    await page.mouse.move(p.x + 60, p.y + 20, { steps: 6 });
    await page.mouse.up();
  } else if (kind === 'right' || kind === 'middle') {
    await page.mouse.down({ button: kind });
    await page.mouse.move(p.x + 60, p.y + 20, { steps: 6 });
    await page.mouse.up({ button: kind });
  } else if (kind === 'shift') {
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(p.x + 60, p.y + 20, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
  } else if (kind === 'rclick') {
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
  } else if (kind === 'mclick') {
    await page.mouse.down({ button: 'middle' });
    await page.mouse.up({ button: 'middle' });
  } else if (kind === 'jitter') {
    await page.mouse.down();
    await page.mouse.move(p.x + 2, p.y + 1, { steps: 2 });
    await page.mouse.up();
  } else if (kind === 'wheel') {
    await page.mouse.wheel(0, -200);
  }
  await frames(page, 2);
  const m1 = JSON.stringify(await model(page));
  const c1 = await cam();
  const changed = m0 !== m1;
  const moved = JSON.stringify(c0) !== JSON.stringify(c1);
  const stt = await state(page);
  console.log(`tool ${tool} ${kind}: model ${changed ? 'CHANGED' : 'same'}, camera ${moved ? 'moved' : 'same'}, selection ${stt.selection}`);
  if (kind === 'jitter') ux.check(tool === 'v' || tool === 'f' ? true : changed, `tool ${tool}: a click with 2 px jitter still acts`, changed ? '' : 'no edit');
  else ux.check(!changed, `tool ${tool}: ${kind} never edits`, changed ? 'model changed' : '');
  if (changed) {
    await page.keyboard.press('Meta+z');
    await frames(page, 1);
  }
};
for (const tool of ['v', '1', '4', 'e']) for (const kind of ['left', 'right', 'middle', 'shift', 'rclick', 'mclick', 'wheel', 'jitter']) await gesture(tool, kind);

// right-click with Select on empty space: does it deselect?
await page.keyboard.press('v');
await clickAt(page, await page.evaluate(() => window.__knap.partScreenPos(3)));
await page.mouse.move(250, 620);
await page.mouse.down({ button: 'right' });
await page.mouse.up({ button: 'right' });
await frames(page, 1);
console.log('right-click empty space with selection → selection', (await state(page)).selection);

// --- zoom toward the cursor
await page.keyboard.press('Home');
await settle(page);
const wp = [6, 0, 0];
const s0 = await page.evaluate((p) => window.__knap.screenPos(p), wp);
await page.mouse.move(s0.x, s0.y);
await page.mouse.wheel(0, -300);
await frames(page, 2);
const s1 = await page.evaluate((p) => window.__knap.screenPos(p), wp);
ux.check(Math.hypot(s1.x - s0.x, s1.y - s0.y) < 1.5, 'wheel zooms toward the cursor (point under cursor stays)', `${JSON.stringify(s0)} → ${JSON.stringify(s1)}`);
// wheel over the cube
const c0 = await cam();
const cp = await cubePoint(page, [0, 0, 1]);
await page.mouse.move(cp.x, cp.y);
await page.mouse.wheel(0, -200);
await frames(page, 2);
const c1 = await cam();
console.log('wheel over the cube: camera height', c0.height, '→', c1.height);
// wheel over the inspector
await page.keyboard.press('v');
await clickAt(page, await page.evaluate(() => window.__knap.partScreenPos(3)));
const ib = await page.locator('[data-role=inspector]').boundingBox();
const c2 = await cam();
await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
await page.mouse.wheel(0, -200);
await frames(page, 2);
const c3 = await cam();
console.log('wheel over the inspector: camera height', c2.height, '→', c3.height, '; page scrollY', await page.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]));
// wheel over toolbar / top bar
const c4 = await cam();
await page.mouse.move(28, 400);
await page.mouse.wheel(0, -200);
await page.mouse.move(640, 20);
await page.mouse.wheel(0, -200);
await frames(page, 2);
console.log('wheel over toolbar/topbar: camera height', c4.height, '→', (await cam()).height);
// pitch clamp: drag a long way down
await page.keyboard.press('Home');
await settle(page);
await page.mouse.move(400, 200);
await page.mouse.down();
await page.mouse.move(400, 680, { steps: 10 });
await page.mouse.up();
console.log('pitch after a long downward drag', (await cam()).pitch);
await page.mouse.move(400, 680);
await page.mouse.down();
await page.mouse.move(400, 60, { steps: 10 });
await page.mouse.move(400, 60, { steps: 1 });
await page.mouse.up();
console.log('pitch after a long upward drag', (await cam()).pitch);
await frames(page, 2);
await shot('review-ux-64-pitch-extreme');
await ux.close();
