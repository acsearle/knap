// Final fresh-eyes check (not part of `npm run e2e`): node e2e/final-check.mjs  (uses existing dist/)
// Builds a two-link pendulum and a four-bar from an empty model by real mouse clicks, simulates,
// undo/redo walk, save/open round trip, view cube snaps, every example simulated 5 s with
// plausibility checks, screenshots at 1280×720 and 1920×1080@2x into e2e/out/final-*.png.
import { readFile } from 'node:fs/promises';
import { launchBrowser, openPage, startServer } from './lib.mjs';
import { applyT, cellIndexAt, clickAt, clickFace, deepEqual, facePos, frames, gridPos, hover, model, openApp, press, settle, state, status, summary } from './app-lib.mjs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const angDeg = (q) => (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const server = await startServer();
const browser = await launchBrowser();
try {
  const ctx = await openPage(browser, server.url, 'final');
  const { page, shot, errors } = ctx;
  await openApp(page, server.url);
  await shot('final-ui-1280-startup');

  const idOf = async (pos, kindRe) => {
    const m = await model(page);
    return m.parts.find((q) => q.cells.some((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2] && kindRe.test(c.kind)))?.id;
  };
  const snaps = [];
  const snap = async () => snaps.push(await model(page));

  // ---------------------------------------------------------------- two-link pendulum
  await press(page, '[data-action=new]');
  await settle(page);
  check('New gives empty model', (await model(page)).parts.length === 0);
  await snap();
  await page.keyboard.press('1');
  await clickAt(page, await gridPos(page, 0, 0)); await snap();
  await clickFace(page, 1, [0, 0, 0], 0); await snap();
  await clickFace(page, 1, [1, 0, 0], 0); await snap();
  // pin into end hole, lengthen, sleeve link 1
  await page.keyboard.press('4');
  await clickFace(page, 1, [2, 0, 0], 4); await snap();
  let pin1 = await idOf([2, 0, 0], /^pin$/);
  await clickFace(page, pin1, [2, 0, 0], 4); await snap();
  await page.keyboard.press('1');
  await clickFace(page, pin1, [2, 0, 1], 4); await snap();
  const link1 = await idOf([2, 0, 1], /^pinHole$/);
  check('link 1 sleeved by default on pin end', link1 && link1 !== 1, `link1=${link1}`);
  for (let x = 2; x < 5; x++) { await clickFace(page, link1, [x, 0, 1], 0); await snap(); }
  // second pin + link
  await page.keyboard.press('4');
  await clickFace(page, link1, [5, 0, 1], 4); await snap();
  const pin2 = await idOf([5, 0, 1], /^pin$/);
  await clickFace(page, pin2, [5, 0, 1], 4); await snap();
  await page.keyboard.press('1');
  await clickFace(page, pin2, [5, 0, 2], 4); await snap();
  const link2 = await idOf([5, 0, 2], /^pinHole$/);
  for (let x = 5; x < 8; x++) { await clickFace(page, link2, [x, 0, 2], 0); await snap(); }
  let s = await summary(page);
  check('two-link pendulum analysis: 3 bodies, 2 revolute', s.bodies === 3 && s.revolute === 2 && s.joints === 2, s.summary);
  await page.mouse.move(5, 300);
  await page.keyboard.press('k'); await frames(page, 2);
  await shot('final-pendulum2-kinematics');
  await page.keyboard.press('k');
  const builtPend = await model(page);

  // undo / redo walk
  {
    let ok = true; let bad = -1;
    for (let i = snaps.length - 2; i >= 0; i--) {
      await page.keyboard.press(`${MOD}+z`); await frames(page, 1);
      if (!deepEqual(await model(page), snaps[i])) { ok = false; bad = i; break; }
    }
    check('undo walks back through every build step to the empty model', ok, ok ? `${snaps.length - 1} undos` : `mismatch at snapshot ${bad}`);
    let ok2 = true; let bad2 = -1;
    for (let i = 1; i < snaps.length; i++) {
      await page.keyboard.press(`${MOD}+Shift+z`); await frames(page, 1);
      if (!deepEqual(await model(page), snaps[i])) { ok2 = false; bad2 = i; break; }
    }
    check('redo walks forward to the built model', ok2, ok2 ? '' : `mismatch at snapshot ${bad2}`);
    check('after redo, model equals built pendulum', deepEqual(await model(page), builtPend));
  }

  // simulate it
  {
    await press(page, '[data-action=play]');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.evaluate(() => window.__knap.setPaused(true));
    const speedShown = await page.evaluate(() => window.__knap.getState().speed);
    let maxErr = 0, minTip2 = Infinity, maxTip2 = -Infinity, pivotDrift = 0;
    for (let k = 0; k < 20; k++) {
      await page.evaluate(() => window.__knap.stepSim(120));
      const t = await page.evaluate(() => window.__knap.simTransforms());
      const info = await page.evaluate(() => window.__knap.simInfo());
      maxErr = Math.max(maxErr, info.jointError);
      const tip = applyT(t[link2], [8, 0, 2]);
      minTip2 = Math.min(minTip2, tip[1]); maxTip2 = Math.max(maxTip2, tip[1]);
      pivotDrift = Math.max(pivotDrift, dist(applyT(t[link1], [2, 0, 1]), [2, 0, 1]));
    }
    check('two-link pendulum swings (tip goes well below pivot)', minTip2 < -3, `min tip y ${minTip2.toFixed(2)}`);
    check('two-link pendulum: tip never rises noticeably above release height', maxTip2 < 0.15, `max tip y ${maxTip2.toFixed(3)}`);
    check('two-link pendulum: joint error small over 5 s', maxErr < 0.05, `max ${maxErr.toExponential(2)}`);
    check('two-link pendulum: pivot stays put', pivotDrift < 0.05, `${pivotDrift.toExponential(2)}`);
    await page.mouse.move(5, 300);
    await shot('final-pendulum2-sim');
    console.log('  speed shown', speedShown);
    await press(page, '[data-action=stop]');
    check('Stop restores the built model', deepEqual(await model(page), builtPend));
    check('Stop message', /Stopped/.test((await status(page)).message), (await status(page)).message);
  }

  // save / open round trip
  {
    const before = await model(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
    const text = await readFile(await dl.path(), 'utf8');
    check('Save produces the model', canon(JSON.parse(text)) === canon(before), dl.suggestedFilename());
    await press(page, '[data-action=new]');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
    await chooser.setFiles({ name: 'two-link.knap.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.waitForFunction(() => window.__knap.getModel().parts.length > 0);
    check('Open restores the saved model exactly', canon(await model(page)) === canon(before));
    const s2 = await summary(page);
    check('reopened analysis same', s2.summary === s.summary, s2.summary);
  }

  // ---------------------------------------------------------------- four-bar from scratch
  // ground (0..3,0,0) ∥Z; L-shaped crank (0,0..2,1)+(1,2,1); rocker (3,0..3,1); coupler sleeved
  // at (1,2,2) on a pin from the crank end, (1..2,2,2),(2,3,2),(3,3,2) in front of the rocker top
  // hole (3,3,1); one deep-inserted pin closes the loop.
  {
    await press(page, '[data-action=new]');
    await settle(page);
    await page.keyboard.press('1');
    await clickAt(page, await gridPos(page, 0, 0));
    for (let x = 0; x < 3; x++) await clickFace(page, 1, [x, 0, 0], 0);
    const pinSleeve = async (onPart, pos) => {
      await page.keyboard.press('4');
      await clickFace(page, onPart, pos, 4);
      const p = await idOf(pos, /^pin$/);
      await clickFace(page, p, pos, 4);
      await page.keyboard.press('1');
      const next = [pos[0], pos[1], pos[2] + 1];
      await clickFace(page, p, next, 4);
      return idOf(next, /^pinHole$/);
    };
    const crank = await pinSleeve(1, [0, 0, 0]);
    await clickFace(page, crank, [0, 0, 1], 2);
    await clickFace(page, crank, [0, 1, 1], 2);
    await clickFace(page, crank, [0, 2, 1], 0); // L: end hole at (1,2,1), so the crank leans
    const rocker = await pinSleeve(1, [3, 0, 0]);
    for (let y = 0; y < 3; y++) await clickFace(page, rocker, [3, y, 1], 2);
    const coupler = await pinSleeve(crank, [1, 2, 1]);
    await clickFace(page, coupler, [1, 2, 2], 0);
    await clickFace(page, coupler, [2, 2, 2], 2);
    await clickFace(page, coupler, [2, 3, 2], 0);
    s = await summary(page);
    check('four-bar before closing: 4 bodies, 3 revolute', s.bodies === 4 && s.revolute === 3, s.summary);
    await page.keyboard.press('4');
    const m = await model(page);
    await hover(page, await facePos(page, coupler, cellIndexAt(m, coupler, [3, 3, 2]), 4));
    const hint = (await status(page)).hint;
    check('deep insert hint offered', /2 long, through part/.test(hint), hint);
    await clickFace(page, coupler, [3, 3, 2], 4);
    s = await summary(page);
    check('four-bar closed: 4 bodies (1 fixed), 4 revolute', s.bodies === 4 && s.fixedBodies === 1 && s.revolute === 4 && s.joints === 4, s.summary);
    await page.mouse.move(5, 300);
    await page.keyboard.press('k'); await frames(page, 2);
    await shot('final-fourbar-built');
    await page.keyboard.press('k');
    const built = await model(page);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.evaluate(() => window.__knap.setPaused(true));
    let maxErr = 0, maxAng = 0;
    for (let k = 0; k < 10; k++) {
      await page.evaluate(() => window.__knap.stepSim(240));
      const info = await page.evaluate(() => window.__knap.simInfo());
      maxErr = Math.max(maxErr, info.jointError);
      const t = await page.evaluate(() => window.__knap.simTransforms());
      maxAng = Math.max(maxAng, angDeg(t[crank].q));
    }
    check('own four-bar moves', maxAng > 5, `crank max ${maxAng.toFixed(1)}°`);
    check('own four-bar loop stays closed', maxErr < 0.05, `max joint error ${maxErr.toExponential(2)}`);
    await shot('final-fourbar-sim');
    await page.keyboard.press('Escape'); await frames(page, 2);
    check('Esc stops; model unchanged', (await state(page)).mode === 'edit' && deepEqual(await model(page), built));
  }

  // ---------------------------------------------------------------- view cube
  {
    await page.keyboard.press('Home'); await settle(page);
    const basis = (yaw, pitch) => {
      const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      const back = [cp * sy, sp, cp * cy];
      const right = [cy, 0, -sy];
      const up = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
      return { back, right, up };
    };
    const cubePoint = async (dir) => {
      const cam = await page.evaluate(() => window.__knap.camera());
      const rect = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
      const { right, up, back } = basis(cam.yaw, cam.pitch);
      let best = null, bestF = 0.05;
      for (let k = 0; k < 3; k++) {
        if (!dir[k]) continue;
        const p = [0, 1, 2].map((j) => (j === k ? dir[j] : (dir[j] * 1.6) / 2));
        const f = dir[k] * back[k];
        if (f <= bestF) continue;
        const sx = (p[0] * right[0] + p[1] * right[1] + p[2] * right[2]) / 1.9;
        const sy = (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) / 1.9;
        const x0 = rect.w - 10 - 112, y0 = 10;
        best = { x: rect.x + x0 + ((sx + 1) / 2) * 112, y: rect.y + y0 + ((1 - sy) / 2) * 112 };
        bestF = f;
      }
      return best;
    };
    for (const [name, dir] of [['top', [0, 1, 0]], ['front', [0, 0, 1]], ['right', [1, 0, 0]], ['top-front-right', [1, 1, 1]]]) {
      await page.keyboard.press('Home'); await settle(page);
      const p = await cubePoint(dir);
      if (!p) { check(`cube ${name} reachable from Home`, false); continue; }
      await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up();
      await frames(page, 1); await settle(page);
      const cam = await page.evaluate(() => window.__knap.camera());
      const { back } = basis(cam.yaw, cam.pitch);
      const n = Math.hypot(...dir); const want = dir.map((v) => v / n);
      const err = Math.max(...back.map((v, i) => Math.abs(v - want[i])));
      check(`cube click ${name} snaps view`, err < 1e-3, `err ${err.toExponential(2)} yaw ${cam.yaw.toFixed(3)} pitch ${cam.pitch.toFixed(3)}`);
      if (name === 'top') await shot('final-cube-top');
    }
    await page.keyboard.press('Home'); await settle(page);
  }

  // ---------------------------------------------------------------- examples
  const exNames = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision'];
  for (const name of exNames) {
    await press(page, '[data-action=examples]');
    await press(page, `[data-example=${name}]`);
    await settle(page);
    const m = await model(page);
    const an = await summary(page);
    await page.mouse.move(5, 300); await frames(page, 2);
    await shot(`final-ex-${name}-edit`);
    await press(page, '[data-action=play]');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.evaluate(() => window.__knap.setPaused(true));
    const traj = [];
    let maxErr = 0;
    const t0 = Date.now();
    for (let k = 0; k < 20; k++) {
      await page.evaluate(() => window.__knap.stepSim(120));
      const info = await page.evaluate(() => window.__knap.simInfo());
      maxErr = Math.max(maxErr, info.jointError);
      traj.push(await page.evaluate(() => window.__knap.simTransforms()));
      if (k === 7) await shot(`final-ex-${name}-sim`);
    }
    const info = await page.evaluate(() => window.__knap.simInfo());
    const wall = Date.now() - t0;
    const fixed = new Set(Object.entries(an.bodyOfPart).filter(([, b]) => b === 0).map(([p]) => +p));
    const moved = {};
    for (const part of m.parts) {
      const c = part.cells[part.cells.length - 1];
      let maxD = 0;
      for (const t of traj) if (t[part.id]) maxD = Math.max(maxD, dist(applyT(t[part.id], [c.x, c.y, c.z]), [c.x, c.y, c.z]));
      moved[part.id] = +maxD.toFixed(2);
    }
    const P = (id, pos, k = traj.length - 1) => applyT(traj[k][id], pos);
    let extra = '';
    let ok = true;
    const anyMoved = Object.entries(moved).some(([id, d]) => !fixed.has(+id) && d > 0.5);
    const fixedStill = [...fixed].every((id) => moved[id] < 1e-6);
    if (name === 'pendulum' || name === 'weld-test') {
      const tipX = name === 'pendulum' ? 4 : 4;
      const ys = traj.map((t, k) => P(2, [tipX, 0, 1], k)[1]);
      extra = `tip y min ${Math.min(...ys).toFixed(2)} max ${Math.max(...ys).toFixed(3)}`;
      ok = Math.min(...ys) < -3 && Math.max(...ys) < 0.1;
      if (name === 'weld-test') {
        const dq = traj.map((t) => Math.max(...t[2].q.map((v, i) => Math.abs(Math.abs(v) - Math.abs(t[3].q[i])))));
        extra += ` red/yellow quat diff max ${Math.max(...dq).toExponential(1)}`;
        ok = ok && Math.max(...dq) < 1e-3;
      }
    } else if (name === 'triple-pendulum') {
      const ys = traj.map((t, k) => P(4, [9, 0, 3], k)[1]);
      extra = `blue tip y min ${Math.min(...ys).toFixed(2)} max ${Math.max(...ys).toFixed(2)}`;
      ok = Math.min(...ys) < -3; // tip may rise above 0: energy is shared between links
    } else if (name === 'parallelogram') {
      const cAng = traj.map((t) => angDeg(t[4].q));
      const kAng = traj.map((t) => angDeg(t[2].q));
      extra = `coupler rot max ${Math.max(...cAng).toFixed(2)}°, crank rot max ${Math.max(...kAng).toFixed(1)}°`;
      ok = Math.max(...cAng) < 1 && Math.max(...kAng) > 30 && Math.max(...kAng) < 92;
    } else if (name === 'four-bar') {
      const a = traj.map((t) => angDeg(t[2].q));
      extra = `crank rot max ${Math.max(...a).toFixed(1)}°`;
      ok = Math.max(...a) > 5;
    } else if (name === 'sliding-axle') {
      const dy = P(3, [0, 3, 0])[1] - 3;
      const blueAng = traj.map((t) => angDeg(t[5].q));
      const blueSlide = Math.max(...traj.map((t) => Math.abs(t[5].p[2] + 0) ));
      const axleSlide = Math.max(...traj.map((t, k) => Math.abs(P(4, [4, 1, 0], k)[2])));
      extra = `red arm dy ${dy.toFixed(3)} (expect ≈ −2), blue arm rot max ${Math.max(...blueAng).toFixed(1)}°, horizontal axle z-slide max ${axleSlide.toFixed(3)}`;
      ok = Math.abs(dy + 2) < 0.15 && Math.max(...blueAng) > 30 && axleSlide < 0.1;
      void blueSlide;
    } else if (name === 'collision') {
      const green = m.parts.find((p) => p.color && p.cells.length === 3 && p.cells[0].y === 3);
      const gy = green ? P(green.id, [-1, 3, 0])[1] : NaN;
      // min distance (XY) from peg centre (0,-5) to the yellow link's segment, over samples
      let minD = Infinity;
      for (let k = 0; k < traj.length; k++) {
        const a = P(3, [3, 0, 2], k), b = P(3, [6, 0, 2], k);
        const abx = b[0] - a[0], aby = b[1] - a[1];
        const tt = Math.max(0, Math.min(1, ((0 - a[0]) * abx + (-5 - a[1]) * aby) / (abx * abx + aby * aby)));
        minD = Math.min(minD, Math.hypot(a[0] + tt * abx - 0, a[1] + tt * aby + 5));
      }
      extra = `loose beam y ${gy.toFixed(3)} (rests on top beam ≈ 1), yellow link min dist to peg ${minD.toFixed(3)} (sampled 0.25 s)`;
      ok = Math.abs(gy - 1) < 0.15;
    }
    check(`example ${name}: ${an.summary}; joint error`, maxErr < 0.05, `max ${maxErr.toExponential(2)}`);
    check(`example ${name}: plausible motion`, ok && anyMoved && fixedStill, `${extra}; moved ${JSON.stringify(moved)}; t=${info.time.toFixed(3)} wall ${wall} ms`);
    await press(page, '[data-action=stop]');
    check(`example ${name}: Stop restores model`, deepEqual(await model(page), m));
  }

  // UI shots
  await press(page, '[data-action=examples]');
  await press(page, '[data-example=four-bar]');
  await settle(page);
  await page.keyboard.press('Escape');
  const st = await state(page);
  await hover(page, await facePos(page, 2, 0, 0));
  await page.mouse.down(); await page.mouse.up(); await frames(page, 2);
  await shot('final-ui-1280-selected');
  await page.keyboard.press('?'); await frames(page, 2);
  await shot('final-ui-1280-help');
  await page.keyboard.press('Escape'); await frames(page, 1);
  check('no page errors in main session', errors.length === 0, errors.join(' | '));
  void st;
  await ctx.close();

  const big = await openPage(browser, server.url, 'final-big', { width: 1920, height: 1080, deviceScaleFactor: 2 });
  await openApp(big.page, server.url);
  await big.shot('final-ui-1920x2-startup');
  await big.page.keyboard.press('1');
  const gp = await gridPos(big.page, 2, 2).catch(() => null);
  if (gp) await hover(big.page, gp);
  await big.shot('final-ui-1920x2-ghost');
  await press(big.page, '[data-action=play]');
  await big.page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
  await big.page.evaluate(() => window.__knap.setPaused(true));
  await big.page.evaluate(() => window.__knap.stepSim(240));
  await big.shot('final-ui-1920x2-sim');
  check('no page errors at 1920@2x', big.errors.length === 0, big.errors.join(' | '));
  await big.close();
} catch (e) {
  check('script ran to completion', false, e.stack ?? String(e));
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nfinal-check: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
