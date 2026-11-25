// Review (spec): README/§6.2/§7 controls not covered by the committed e2e flows.
//   KNAP_ROOT=<dir with dist/> node e2e/review-spec-controls.mjs
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { openApp, frames, settle, state, model, summary, clickAt, gridPos, facePos, cellIndexAt, status, press } from './app-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.KNAP_ROOT ?? join(HERE, '..'));
const OUT = join(HERE, 'out');
await mkdir(OUT, { recursive: true });
const port = 6000 + Math.floor(Math.random() * 2000);
const pv = await preview({ root: ROOT, logLevel: 'warn', preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
const R = {};
const cam = () => page.evaluate(() => window.__knap.camera());
const shot = (n) => page.screenshot({ path: join(OUT, `review-spec-${n}.png`) });

try {
  await openApp(page, `http://127.0.0.1:${port}/`);
  const view = await page.locator('[data-role=viewport]').boundingBox();
  const cube = { x: view.x + view.width - 10 - 112, y: view.y + 10, size: 112 };

  // --- defaults
  const s0 = await state(page);
  R.defaultSpeed = s0.speed;
  R.homeCam = await cam();

  // --- view cube: hover highlight then corner click
  await page.mouse.move(cube.x + cube.size * 0.5, cube.y + cube.size * 0.22);
  await frames(page, 2);
  await shot('cube-hover');
  // corner: the near top-front-right vertex sits roughly at the centre of the cube image
  const tries = [];
  const pts = [];
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) pts.push([i / 8, j / 8]);
  for (const [fx, fy] of pts) {
    await page.evaluate(() => window.__knap.home());
    await frames(page, 1);
    const before = await cam();
    await page.mouse.move(cube.x + cube.size * fx, cube.y + cube.size * fy);
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 1);
    await settle(page);
    const after = await cam();
    tries.push({ at: [fx, fy], yawDeg: +((after.yaw * 180) / Math.PI).toFixed(1), pitchDeg: +((after.pitch * 180) / Math.PI).toFixed(1), changed: before.yaw !== after.yaw || before.pitch !== after.pitch });
  }
  const seen = {};
  for (const t of tries) { const k = `yaw ${t.yawDeg} pitch ${t.pitchDeg}`; (seen[k] ??= []).push(t.at.map((v) => v.toFixed(2)).join(',')); }
  R.cubeClicksFromHome = seen;
  await shot('cube-after');

  // --- Home key & F key
  await page.mouse.move(view.x + 300, view.y + 300);
  await page.keyboard.press('Home');
  await settle(page);
  const h = await cam();
  R.homeKey = { yaw: h.yaw, pitch: h.pitch, sameAsStart: Math.abs(h.yaw - R.homeCam.yaw) < 1e-6 && Math.abs(h.pitch - R.homeCam.pitch) < 1e-6 };
  // zoom out with the wheel, then F
  await page.mouse.wheel(0, 600);
  await frames(page, 2);
  const zoomed = await cam();
  await page.keyboard.press('f');
  await settle(page);
  const fitted = await cam();
  R.wheelAndF = { heightHome: h.height, afterWheel: zoomed.height, afterF: fitted.height };
  // pinch (ctrl+wheel) zooms in
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await frames(page, 2);
  R.pinch = { before: fitted.height, after: (await cam()).height };
  // pitch clamp: drag down a lot
  await page.mouse.move(view.x + 400, view.y + 200);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(view.x + 400, view.y + 200 + i * 40);
  await page.mouse.up();
  await frames(page, 1);
  R.pitchAfterBigDrag = ((await cam()).pitch * 180) / Math.PI;
  await page.keyboard.press('Home');
  await settle(page);

  // --- Home/Fit buttons next to the cube
  R.homeFitButtons = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /home|fit/i.test((b.title || '') + (b.getAttribute('aria-label') || ''))).map((b) => b.title || b.getAttribute('aria-label')));

  // --- K, ?, N
  await page.keyboard.press('k');
  R.kToggle = (await state(page)).showKinematics;
  await page.keyboard.press('k');
  await page.keyboard.press('?');
  R.helpOpen = await page.evaluate(() => !!document.querySelector('[role=dialog]:not([hidden]), dialog[open], .dialog:not([hidden])'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  R.nToggle = (await state(page)).newPart;
  await page.keyboard.press('n');

  // --- Ctrl+Y redo & Shift+Ctrl+Z redo after an edit
  await page.keyboard.press('1');
  await page.evaluate(() => window.__knap.home());
  await frames(page, 1);
  const before = await model(page);
  const gp = await gridPos(page, 2, 4);
  await clickAt(page, gp);
  const afterAdd = await model(page);
  R.gridClickAdded = afterAdd.parts.length - before.parts.length;
  await page.keyboard.press('Control+z');
  R.ctrlZ = (await model(page)).parts.length === before.parts.length;
  await page.keyboard.press('Control+y');
  R.ctrlY = (await model(page)).parts.length === afterAdd.parts.length;
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+Shift+z');
  R.metaShiftZ = (await model(page)).parts.length === afterAdd.parts.length;

  // --- grid hidden while simulating, root marker visible in edit: screenshots
  await page.keyboard.press('v');
  await page.evaluate(() => window.__knap.loadExample('pendulum'));
  await settle(page);
  await shot('pendulum-edit');
  await page.evaluate(() => window.__knap.stepSim(1));
  await shot('pendulum-sim-paused');
  R.statusInSim = await status(page);
  // Esc stops; Esc in 'select' with a selection deselects
  await page.keyboard.press('Escape');
  R.afterEscMode = (await state(page)).mode;

  // --- Step button in edit mode starts paused
  await press(page, '[data-action=step]');
  const st = await state(page);
  R.stepFromEdit = { mode: st.mode, paused: st.paused, t: (await page.evaluate(() => window.__knap.simInfo()))?.time };
  await page.keyboard.press('Escape');

  // --- Erase: hovered cell red; New → empty → Play says nothing to simulate
  await press(page, '[data-action=new]');
  await page.keyboard.press('Space');
  await frames(page, 2);
  R.playEmpty = { mode: (await state(page)).mode, msg: (await status(page)).message };

  R.summary = await summary(page);
} catch (e) {
  R.error = String(e && e.stack ? e.stack : e);
  await shot('controls-FAILED').catch(() => {});
}
R.errors = errors;
console.log(JSON.stringify(R, null, 2));
await browser.close();
await new Promise((r) => pv.httpServer.close(r));
