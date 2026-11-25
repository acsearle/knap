// App e2e 2: every built-in example — load it from the Examples menu, screenshot it in edit mode,
// play it (deterministic stepSim + a short real-time run), screenshot it mid-motion, check the
// joints hold, stop and check the model is restored. Also the Show kinematics overlay.
import { deepEqual, frames, model, openApp, press, settle, sleep, state, status, summary } from './app-lib.mjs';

// src/core/examples.ts EXAMPLES, with the expected analysis (DESIGN §8, tests/kinematics).
const EXAMPLES = [
  { name: 'pendulum', bodies: 2 },
  { name: 'triple-pendulum', bodies: 4 },
  { name: 'four-bar', bodies: 4 },
  { name: 'parallelogram', bodies: 4 },
  { name: 'sliding-axle', bodies: 3 },
  { name: 'weld-test', bodies: 2 },
  { name: 'collision', bodies: 4 },
];

export default async function ({ page, url, shot, assert, step, errors }) {
  await step('load', () => openApp(page, url));
  const menuNames = await page.$$eval('[data-example]', (els) => els.map((e) => e.getAttribute('data-example')));
  assert(deepEqual(menuNames, EXAMPLES.map((e) => e.name)), `Examples menu lists every example: ${menuNames}`);

  for (const ex of EXAMPLES) {
    await step(`${ex.name}: load from the menu`, async () => {
      await press(page, '[data-action=examples]');
      assert(await page.locator('[data-role=examples-menu]').isVisible(), 'menu opens');
      await press(page, `[data-example=${ex.name}]`);
      assert(!(await page.locator('[data-role=examples-menu]').isVisible()), 'menu closes');
      const st = await state(page);
      assert(st.fileName === ex.name, `file name is the example (${st.fileName})`);
      const s = await summary(page);
      assert(s.bodies === ex.bodies && s.fixedBodies === 1, `${ex.name}: ${s.summary}`);
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
