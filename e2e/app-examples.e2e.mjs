// App e2e 2: every built-in example — load it from the Examples menu, screenshot it in edit mode,
// play it (deterministic stepSim + a short real-time run), screenshot it mid-motion, check the
// joints hold, stop and check the model is restored. Also the Show kinematics overlay.
import { applyT, deepEqual, dist, frames, model, openApp, press, settle, sleep, state, status, summary } from './app-lib.mjs';

// src/core/examples.ts EXAMPLES, with the expected analysis (DESIGN §8, tests/kinematics).
const EXAMPLES = [
  { name: 'pendulum', bodies: 2 },
  { name: 'triple-pendulum', bodies: 4 },
  { name: 'four-bar', bodies: 4 },
  { name: 'parallelogram', bodies: 4 },
  { name: 'sliding-axle', bodies: 3 },
  { name: 'weld-test', bodies: 2 },
  { name: 'collision', bodies: 4 },
  // §8 examples 8 and 9 (wheels): the cart has a free root, so no body is fixed.
  { name: 'crank-wheel', bodies: 3 },
  { name: 'cart', bodies: 6, fixed: 0 },
];

export default async function ({ page, url, shot, assert, step, errors }) {
  await step('load', () => openApp(page, url));
  const menuNames = await page.$$eval('[data-example]', (els) => els.map((e) => e.getAttribute('data-example')));
  assert(deepEqual(menuNames, EXAMPLES.map((e) => e.name)), `Examples menu lists every example: ${menuNames}`);

  for (const ex of EXAMPLES) {
    await step(`${ex.name}: load from the menu`, async () => {
      await press(page, '[data-action=examples]');
      assert(await page.locator('[data-role=examples-menu]').isVisible(), 'menu opens');
      // The menu scrolls when it is taller than the window (9 examples at 1280×720).
      await page.locator(`[data-example=${ex.name}]`).scrollIntoViewIfNeeded();
      await press(page, `[data-example=${ex.name}]`);
      assert(!(await page.locator('[data-role=examples-menu]').isVisible()), 'menu closes');
      const st = await state(page);
      assert(st.fileName === ex.name, `file name is the example (${st.fileName})`);
      const s = await summary(page);
      assert(s.bodies === ex.bodies && s.fixedBodies === (ex.fixed ?? 1), `${ex.name}: ${s.summary}`);
      // The view is fitted: every part is on screen.
      const m = await model(page);
      for (const p of m.parts) {
        const sp = await page.evaluate((id) => window.__knap.partScreenPos(id), p.id);
        assert(sp && sp.x > 58 && sp.x < 1280 && sp.y > 40 && sp.y < 694, `${ex.name}: part ${p.id} on screen (${JSON.stringify(sp)})`);
      }
      await page.mouse.move(1, 360);
      await frames(page, 2);
      await shot(`app-ex-${ex.name}-edit`);
    });

    await step(`${ex.name}: simulate`, async () => {
      const before = await model(page);
      await press(page, '[data-action=play]');
      await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
      await press(page, '[data-action=pause]');
      assert((await state(page)).paused, 'paused');
      const t0 = (await page.evaluate(() => window.__knap.simInfo())).time;
      // 0.5 s of simulated time, deterministic.
      const time = await page.evaluate(() => window.__knap.stepSim(240));
      assert(Math.abs(time - t0 - 0.5) < 1e-9, `stepSim advanced 0.5 s (${time - t0})`);
      const info = await page.evaluate(() => window.__knap.simInfo());
      console.log(`  [app-examples] ${ex.name}: t=${info.time.toFixed(3)} jointError=${info.jointError.toExponential(2)}`);
      assert(info.jointError < 0.02, `${ex.name}: joint error small (${info.jointError})`);
      const tr = await page.evaluate(() => window.__knap.simTransforms());
      const moved = Object.values(tr).some((t) => t && Math.hypot(...t.p) + Math.hypot(t.q[0], t.q[1], t.q[2]) > 1e-3);
      assert(moved, `${ex.name}: something moved`);
      await frames(page, 2);
      await shot(`app-ex-${ex.name}-sim`);
      // Short real-time run through the UI.
      await press(page, '[data-action=pause]');
      assert(!(await state(page)).paused, 'resumed');
      await sleep(800);
      const info2 = await page.evaluate(() => window.__knap.simInfo());
      assert(info2.time > info.time, `${ex.name}: real-time stepping advances (${info.time} → ${info2.time})`);
      assert(info2.jointError < 0.02, `${ex.name}: joint error small after the real-time run (${info2.jointError})`);
      await press(page, '[data-action=stop]');
      assert((await state(page)).mode === 'edit', 'stopped');
      assert(deepEqual(before, await model(page)), `${ex.name}: Stop restores the model`);
      assert(errors.length === 0, `no console errors: ${errors.join(' | ')}`);
    });
  }

  // §8 examples 8 and 9 in the real app at friction Realistic, stepped deterministically to 30
  // simulated seconds: the wheel (and its index mark) turns, the cart rolls back and forth over the
  // floor (the same floor as in edit mode: tint + contact shadow, no lines), and both are at rest
  // by 30 s.
  const angleZ = (q) => 2 * Math.atan2(q[2], q[3]); // rotation about Z (all these joints are ∥ Z)
  const unwrap = (prev, a) => prev + Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
  /** Load an example from the menu and start simulating it, paused, at friction Realistic. */
  const startExample = async (name) => {
    await press(page, '[data-action=examples]');
    await page.locator(`[data-example=${name}]`).scrollIntoViewIfNeeded();
    await press(page, `[data-example=${name}]`);
    await press(page, '[data-friction=realistic]');
    assert((await state(page)).friction === 'realistic', 'friction Realistic');
    // Enter simulate mode paused at t = 0 (the hook's stepSim plays paused), so the run is
    // deterministic; Play / Pause through the UI are covered by the loop above.
    assert((await page.evaluate(() => window.__knap.stepSim(0))) === 0, 'simulating from t = 0');
    assert((await state(page)).mode === 'simulate' && (await state(page)).paused, 'simulating, paused');
    await page.mouse.move(1, 360);
  };
  /** Step `n` fixed steps in chunks; returns the wall-clock ms spent stepping (diagnostic only). */
  const stepTimed = async (n, each, chunk = 240) => {
    let ms = 0;
    for (let done = 0; done < n; ) {
      const k = Math.min(chunk, n - done);
      const w0 = Date.now();
      const time = await page.evaluate((kk) => window.__knap.stepSim(kk), k);
      ms += Date.now() - w0;
      done += k;
      if (each) await each(time);
    }
    return ms;
  };
  const tr = () => page.evaluate(() => window.__knap.simTransforms());

  await step('crank-wheel: the wheel and its index mark turn; at rest by 30 s (Realistic)', async () => {
    await startExample('crank-wheel');
    const m = await model(page);
    const wheel = m.parts.find((p) => p.cells.some((c) => c.rim !== undefined));
    const hub = wheel.cells.find((c) => c.rim !== undefined);
    assert(wheel.id === 2 && hub.rim === 2.5 && hub.axis === 2, `the wheel is part 2, r 2.5 ∥ Z: ${JSON.stringify(hub)}`);
    // Screen direction of the index mark: part-local +X from the hub (DESIGN §4.2, axis Z → +X),
    // on the wheel's front face, under the wheel's simulated pose.
    const markScreenAngle = async () => {
      const t = (await tr())[2];
      const c = applyT(t, [hub.x, hub.y, hub.z + 0.5]);
      const e = applyT(t, [hub.x + 2, hub.y, hub.z + 0.5]);
      const [a, b] = await page.evaluate(([p, q]) => [window.__knap.screenPos(p), window.__knap.screenPos(q)], [c, e]);
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    await frames(page, 2);
    await shot('app-ex-crank-wheel-t0');
    const mark0 = await markScreenAngle();
    let a = 0;
    let lo = 0;
    let hi = 0;
    const angles = [];
    const ms = await stepTimed(480, async (time) => {
      a = unwrap(a, angleZ((await tr())[2].q));
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
      angles.push([time, a]);
    });
    await frames(page, 2);
    await shot('app-ex-crank-wheel-1s');
    const mark1 = await markScreenAngle();
    const markTurn = Math.abs(Math.atan2(Math.sin(mark1 - mark0), Math.cos(mark1 - mark0)));
    console.log(`  [app-examples] crank-wheel: wheel angle ${angles.map(([t, v]) => `${t.toFixed(1)} s ${((v * 180) / Math.PI).toFixed(0)}°`).join(', ')}; sweep ${(((hi - lo) * 180) / Math.PI).toFixed(0)}° in 1 s; index mark turned ${((markTurn * 180) / Math.PI).toFixed(0)}° on screen; stepping ${(ms / 1).toFixed(0)} ms wall per simulated second`);
    assert((hi - lo) > Math.PI / 2, `the wheel turns more than 90° in the first second (${(((hi - lo) * 180) / Math.PI).toFixed(1)}°)`);
    assert(markTurn > Math.PI / 4, `the index mark visibly turns on screen (${((markTurn * 180) / Math.PI).toFixed(1)}°)`);
    // to 25 s, then the last 5 s must be still
    await stepTimed(480 * 24);
    const t25 = await tr();
    const a25 = angleZ(t25[2].q);
    await stepTimed(480 * 5);
    const t30 = await tr();
    const info = await page.evaluate(() => window.__knap.simInfo());
    const da = Math.abs(angleZ(t30[2].q) - a25);
    const dl = Math.abs(angleZ(t30[3].q) - angleZ(t25[3].q));
    const restDeg = (angleZ(t30[2].q) * 180) / Math.PI;
    console.log(`  [app-examples] crank-wheel at ${info.time.toFixed(1)} s: wheel at ${restDeg.toFixed(1)}° (crank-down −135°), turned ${da.toExponential(1)} rad and link ${dl.toExponential(1)} rad in the last 5 s, joint error ${info.jointError.toExponential(1)}`);
    assert(Math.abs(info.time - 30) < 1e-9, `30 s simulated (${info.time})`);
    assert(da < 1e-3 && dl < 1e-3, `at rest by 30 s (wheel ${da}, link ${dl} rad in the last 5 s)`);
    assert(Math.abs(restDeg + 135) < 12, `rests crank-down (${restDeg.toFixed(1)}°)`);
    assert(info.jointError < 1e-3, `joints hold (${info.jointError})`);
    // the whole mechanism stays in the view fitted at load
    for (const p of m.parts) {
      const sp = await page.evaluate((id) => window.__knap.partScreenPos(id), p.id);
      assert(sp && sp.x > 58 && sp.x < 1280 && sp.y > 40 && sp.y < 694, `part ${p.id} still on screen at rest (${JSON.stringify(sp)})`);
    }
    await frames(page, 2);
    await shot('app-ex-crank-wheel-rest');
    await press(page, '[data-action=stop]');
    assert(errors.length === 0, `no console errors: ${errors.join(' | ')}`);
  });

  await step('cart: rolls back and forth over the floor; wheels turn; at rest by 30 s (Realistic)', async () => {
    await startExample('cart');
    const m = await model(page);
    const wheels = m.parts.filter((p) => p.cells.some((c) => c.rim !== undefined));
    assert(wheels.length === 4 && (await state(page)).ground && !(await state(page)).rootFixed, 'cart: four wheels, ground on, root free');
    let info = await page.evaluate(() => window.__knap.simInfo());
    const floor = await page.evaluate(() => window.__knap.floor());
    assert(floor && Object.keys(floor).join() === 'y' && Math.abs(floor.y - info.groundY) < 1e-9, `the floor is drawn at sim.groundY while simulating, as in edit mode (no lines): ${JSON.stringify(floor)} vs ${info.groundY}`);
    {
      // its contact shadow (§6.1): dark under each wheel's contact line, nothing 6 units away
      const under = [];
      for (const w of wheels) {
        const c = w.cells[0];
        under.push(await page.evaluate(([x, z]) => window.__knap.groundShadowAt(x, z), [c.x, c.z]));
      }
      const zs = wheels.map((w) => w.cells[0].z);
      const away = await page.evaluate(([x, z]) => window.__knap.groundShadowAt(x, z), [4, Math.max(...zs) + 6]);
      // (≥ 0.55 with the two-lobe shadow, DEVIATIONS §6 review fixes: a 1-wide wheel spends part of the
      // broad lobe; was ≥ 0.8 for the single contact lobe)
      assert(under.every((v) => v >= 0.55) && away === 0, `contact shadow under the wheels ${under.map((v) => v.toFixed(2))}, 6 units away ${away}`);
    }
    const lowest = Math.min(...wheels.map((p) => p.cells[0].y - p.cells[0].rim));
    assert(Math.abs(info.groundY - (lowest + 0.04)) < 1e-9, `groundY = lowest wheel point + 0.04 (${info.groundY})`);
    // the chassis (part 1) at its middle bottom hole (4, 0, 1 between the beams)
    const chassisAt = async () => applyT((await tr())[1], [4, 0, 1]);
    await frames(page, 2);
    await shot('app-ex-cart-t0');
    const x0 = (await chassisAt())[0];
    let lo = x0;
    let hi = x0;
    let path = 0;
    let last = x0;
    let wheelTurn = 0;
    let wa = 0;
    let maxSink = 0;
    const wheelId = wheels[0].id;
    const hub = wheels[0].cells[0];
    const ms = await stepTimed(960, async (time) => {
      const t = await tr();
      const x = applyT(t[1], [4, 0, 1])[0];
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      path += Math.abs(x - last);
      last = x;
      wa = unwrap(wa, angleZ(t[wheelId].q));
      wheelTurn = Math.max(wheelTurn, Math.abs(wa));
      for (const w of wheels) {
        const c = applyT(t[w.id], [w.cells[0].x, w.cells[0].y, w.cells[0].z]);
        maxSink = Math.max(maxSink, info.groundY + w.cells[0].rim - 0.04 - c[1]);
      }
      if (Math.abs(time - 1) < 1e-9) {
        await frames(page, 2);
        await shot('app-ex-cart-1s');
      }
    }, 48);
    console.log(`  [app-examples] cart, first 2 s: chassis x range ${(hi - lo).toFixed(2)} units, path ${path.toFixed(1)} units (sampled every 0.1 s), wheel ${wheelId} turned up to ${((wheelTurn * 180) / Math.PI).toFixed(0)}°, deepest wheel sink ${maxSink.toFixed(3)} units; stepping ${(ms / 2).toFixed(0)} ms wall per simulated second`);
    assert(hi - lo > 1, `the chassis rolls visibly (x range ${(hi - lo).toFixed(3)} units in 2 s)`);
    assert(path > 1.5 * (hi - lo), `back and forth, not one way (path ${path.toFixed(2)})`);
    assert(wheelTurn > (10 * Math.PI) / 180, `the wheels turn (${((wheelTurn * 180) / Math.PI).toFixed(1)}°)`);
    assert(maxSink < 0.05, `nothing sinks into the floor (${maxSink.toFixed(4)})`);
    await frames(page, 2);
    await shot('app-ex-cart-2s');
    await stepTimed(480 * 23);
    const t25 = await tr();
    await stepTimed(480 * 5);
    const t30 = await tr();
    info = await page.evaluate(() => window.__knap.simInfo());
    let moved = 0;
    for (const p of m.parts) {
      const c = p.cells[0];
      moved = Math.max(moved, dist(applyT(t25[p.id], [c.x, c.y, c.z]), applyT(t30[p.id], [c.x, c.y, c.z])));
    }
    const xEnd = applyT(t30[1], [4, 0, 1]);
    console.log(`  [app-examples] cart at ${info.time.toFixed(1)} s: chassis at x ${xEnd[0].toFixed(3)} (started ${x0.toFixed(3)}), every part moved ≤ ${moved.toExponential(1)} units in the last 5 s, joint error ${info.jointError.toExponential(1)}`);
    assert(moved < 5e-3, `at rest by 30 s (max part motion ${moved} units in the last 5 s)`);
    assert(Object.values(t30).every((t) => t !== null), 'no body removed');
    assert(info.jointError < 1e-3, `joints hold (${info.jointError})`);
    await frames(page, 2);
    await shot('app-ex-cart-rest');
    await press(page, '[data-action=stop]');
    assert(errors.length === 0, `no console errors: ${errors.join(' | ')}`);
  });

  await step('show kinematics', async () => {
    await press(page, '[data-action=examples]');
    await press(page, '[data-example=four-bar]');
    await page.keyboard.press('k');
    await frames(page, 2);
    assert((await state(page)).showKinematics, 'K turns Show kinematics on');
    assert(await page.locator('[data-action=kinematics]').isChecked(), 'checkbox follows');
    const st = await status(page);
    assert(st.counts === '8 parts · 4 bodies (1 fixed) · 4 joints: 4 revolute', `counts: ${st.counts}`);
    await page.mouse.move(1, 360);
    await frames(page, 2);
    await shot('app-ex-kinematics');
    // Live update: erase one pin (part 8, ground–rocker) → 3 joints.
    await page.keyboard.press('e');
    const m = await model(page);
    const pinPart = m.parts.find((p) => p.id === 8);
    const ci = pinPart.cells.findIndex((c) => c.z === 1);
    const p = await page.evaluate(([a, b]) => window.__knap.clientPosOfCellFace(a, b, 4), [8, ci]);
    assert(p, 'pin end clickable');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 2);
    const st2 = await status(page);
    assert(/3 joints/.test(st2.counts), `counts update live: ${st2.counts}`);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await page.click('[data-action=kinematics]');
    assert(!(await state(page)).showKinematics, 'checkbox turns it off');
    await settle(page);
  });
}
