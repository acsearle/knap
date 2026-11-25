// App e2e 5 + 6: simulate-mode interaction through the real mouse — grab and drag the four-bar's
// coupler, dragging empty space or the fixed ground orbits, editing input does nothing while
// simulating; speed / pause / step controls; and a view-cube click snaps the camera while a build
// tool is active without placing anything.
import { deepEqual, dist, frames, model, openApp, press, settle, sleep, state, status } from './app-lib.mjs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const cam = (page) => page.evaluate(() => window.__knap.camera());

export default async function ({ page, url, shot, assert, step }) {
  await step('load the four-bar', () => openApp(page, url));
  const edited = await model(page);

  await step('view cube click snaps the camera with a build tool active, placing nothing', async () => {
    await page.keyboard.press('1');
    await page.mouse.move(640, 400);
    await frames(page, 1);
    const h0 = (await state(page)).historySize;
    // The cube is top-right of the viewport (112 px, 10 px margin): its TOP face shows near the
    // top of the cube in the default iso view.
    const view = await page.locator('[data-role=viewport]').boundingBox();
    const cube = { x: view.x + view.width - 10 - 112, y: view.y + 10, size: 112 };
    await page.mouse.move(cube.x + cube.size * 0.5, cube.y + cube.size * 0.22);
    await frames(page, 1);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page);
    const c = await cam(page);
    assert(Math.abs(c.pitch - Math.PI / 2) < 1e-6, `snapped to TOP (pitch ${c.pitch})`);
    assert(deepEqual(await model(page), edited) && (await state(page)).historySize === h0, 'nothing was placed');
    await shot('app-sim-cube-top');
    await page.keyboard.press('Home');
    await settle(page);
    await page.keyboard.press('v');
  });

  await step('play at 1×', async () => {
    await press(page, '[data-speed="1"]');
    assert((await state(page)).speed === 1, 'speed 1×');
    await press(page, '[data-action=play]');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    assert((await page.evaluate(() => window.__knap.simInfo())).speed === 1, 'simulation runs at 1×');
    for (const sel of ['[data-tool=pinHole]', '[data-tool=select]', '[data-action=new]', '[data-action=open]', '[data-action=examples]', '[data-action=undo]', '[data-role=palette] .swatch']) {
      assert(await page.locator(sel).first().isDisabled(), `${sel} disabled while simulating`);
    }
  });

  await step('editing input does nothing while simulating', async () => {
    const tool0 = (await state(page)).tool;
    await page.keyboard.press('1');
    assert((await state(page)).tool === tool0, 'tool keys ignored');
    assert(/Stop the simulation to edit/.test((await status(page)).message), 'status explains why');
    await page.keyboard.press(`${MOD}+z`);
    await page.keyboard.press('Delete');
    // A click on a part / the grid edits nothing.
    const p = await page.evaluate(() => window.__knap.partScreenPos(1));
    await page.mouse.click(p.x, p.y);
    await page.mouse.click(200, 600);
    assert(deepEqual(await model(page), edited), 'model unchanged');
    assert((await state(page)).mode === 'simulate', 'still simulating');
  });

  await step('drag on empty space orbits; drag on the fixed ground orbits', async () => {
    const c0 = await cam(page);
    await page.mouse.move(250, 600);
    await page.mouse.down();
    await page.mouse.move(330, 590, { steps: 4 });
    await page.mouse.up();
    const c1 = await cam(page);
    assert(Math.abs(c1.yaw - c0.yaw) > 0.05, `empty-space drag orbits (yaw ${c0.yaw} → ${c1.yaw})`);
    assert((await page.evaluate(() => window.__knap.simInfo())).grabbed === null, 'nothing grabbed');
    await page.keyboard.press('Home');
    await settle(page);
    // ground beam: part 1, a cell with no pin in it (x = 3)
    const g = await page.evaluate(() => window.__knap.cellScreenPos(1, 3));
    const c2 = await cam(page);
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x + 60, g.y + 10, { steps: 4 });
    const grabbedOnGround = (await page.evaluate(() => window.__knap.simInfo())).grabbed;
    await page.mouse.up();
    const c3 = await cam(page);
    assert(grabbedOnGround === null && Math.abs(c3.yaw - c2.yaw) > 0.05, `drag on the fixed body orbits (grabbed ${grabbedOnGround})`);
    await page.keyboard.press('Home');
    await settle(page);
    console.log('  [app-sim] camera after Home', JSON.stringify(await cam(page)));
    await shot('app-sim-home');
  });

  await step('grab the coupler and hold / drag it', async () => {
    // Coupler = part 3, holes (0..4, 2, 2); its middle hole is cell 2.
    const cellWorld = () =>
      page.evaluate(() => {
        const t = window.__knap.simTransforms()[3];
        const [x, y, z, w] = t.q;
        const v = [2, 2, 2];
        const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
        return [v[0] + w * tx + (y * tz - z * ty) + t.p[0], v[1] + w * ty + (z * tx - x * tz) + t.p[1], v[2] + w * tz + (x * ty - y * tx) + t.p[2]];
      });
    /** Stop, Play, Pause with the keyboard: the linkage is back near its initial pose. */
    const restartPaused = async () => {
      await page.keyboard.press('Escape');
      await page.keyboard.press(' ');
      await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
      await page.keyboard.press(' ');
      await frames(page, 2);
      assert((await state(page)).paused, 'paused');
    };

    // Baseline: 1 s of simulated time without grabbing — the linkage falls.
    await restartPaused();
    /** Largest displacement of the coupler's middle over 1 s (8 × 1/8 s of fixed steps). */
    const maxMove = async (p0) => {
      let m = 0;
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.__knap.stepSim(60));
        m = Math.max(m, dist(p0, await cellWorld()));
      }
      return m;
    };
    const freeMax = await maxMove(await cellWorld());

    // Grab the same point with the mouse and hold it in place for 1 s.
    await restartPaused();
    const held0 = await cellWorld();
    const start = await page.evaluate(() => window.__knap.cellScreenPos(3, 2));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, start.y, { steps: 3 }); // past the 4 px click slop: a drag
    await page.mouse.move(start.x, start.y, { steps: 3 });
    const g = await page.evaluate(() => window.__knap.analyze().bodyOfPart[3]);
    assert((await page.evaluate(() => window.__knap.simInfo())).grabbed === g, "the coupler's body is grabbed");
    const heldMax = await maxMove(held0);
    console.log(`  [app-sim] over 1 s the coupler moves at most ${freeMax.toFixed(2)} units free, ${heldMax.toFixed(3)} units held`);
    assert(freeMax > 0.5, `without a grab the coupler moves (${freeMax})`);
    assert(heldMax < 0.2 && heldMax < freeMax / 5, `held by the mouse it stays at the cursor (${heldMax})`);

    // Drag: move the cursor 60 px left and let it follow for 0.5 s.
    const target = { x: start.x - 60, y: start.y };
    await page.mouse.move(target.x, target.y, { steps: 6 });
    const before = await page.evaluate(() => window.__knap.cellScreenPos(3, 2));
    await page.evaluate(() => window.__knap.stepSim(240));
    const after = await page.evaluate(() => window.__knap.cellScreenPos(3, 2));
    const d0 = Math.hypot(before.x - target.x, before.y - target.y);
    const d1 = Math.hypot(after.x - target.x, after.y - target.y);
    console.log(`  [app-sim] drag: ${d0.toFixed(1)} px → ${d1.toFixed(1)} px from the cursor`);
    assert(d1 < d0 - 15, `the coupler follows the cursor (${d0.toFixed(1)} → ${d1.toFixed(1)} px)`);
    await shot('app-sim-grab');
    // And in real time: resume while still holding, then release.
    await page.keyboard.press(' ');
    await sleep(800);
    assert((await page.evaluate(() => window.__knap.simInfo())).grabbed === g, 'still held while running');
    await page.mouse.up();
    assert((await page.evaluate(() => window.__knap.simInfo())).grabbed === null, 'released on pointer up');
    const je = (await page.evaluate(() => window.__knap.simInfo())).jointError;
    assert(je < 0.05, `joints held while dragging (${je})`);
  });

  await step('pause / step / speed', async () => {
    await page.keyboard.press(' ');
    await frames(page, 1);
    assert((await state(page)).paused, 'Space pauses');
    const t0 = (await page.evaluate(() => window.__knap.simInfo())).time;
    await press(page, '[data-action=step]');
    const t1 = (await page.evaluate(() => window.__knap.simInfo())).time;
    assert(Math.abs(t1 - t0 - 1 / 60) < 1e-9, `Step advances 1/60 s (${t1 - t0})`);
    await sleep(300);
    assert((await page.evaluate(() => window.__knap.simInfo())).time === t1, 'paused: time stands still');
    const readout = await page.textContent('[data-role=sim-time]');
    assert(readout === `t = ${t1.toFixed(2)} s`, `readout "${readout}"`);
    await press(page, '[data-speed="0.1"]');
    assert((await page.evaluate(() => window.__knap.simInfo())).speed === 0.1, 'speed ⅒× applied to the running simulation');
    await shot('app-sim-paused');
  });

  await step('Esc stops and restores the model; camera untouched', async () => {
    const c0 = await cam(page);
    await page.keyboard.press('Escape');
    await frames(page, 1);
    assert((await state(page)).mode === 'edit', 'Esc stops');
    assert(deepEqual(await model(page), edited), 'model exactly as before Play');
    assert(deepEqual(await cam(page), c0), 'camera untouched');
    assert(!(await page.locator('[data-tool=pinHole]').isDisabled()), 'tools enabled');
    await shot('app-sim-stopped');
  });

  await step('a failing simulation stops cleanly with a message', async () => {
    // Make the next simulation throw inside its first step (stand-in for a NaN / solver failure).
    await press(page, '[data-action=play]');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    await page.evaluate(() => window.__knap.injectSimFault());
    await page.waitForFunction(() => window.__knap.getState().mode === 'edit', null, { timeout: 20000 });
    const st = await state(page);
    assert(/^Simulation stopped: /.test(st.banner), `banner: "${st.banner}"`);
    assert(deepEqual(await model(page), edited), 'model restored');
    await press(page, '[data-role=banner] button');
  });
}
