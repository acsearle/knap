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
    // ground beam: part 1, a cell with no pin in it whose point on screen is not covered by a
    // moving link. Which cells are covered depends on the pose (with joint friction the linkage
    // soon hangs at rest, in front of the middle of the ground beam), so pause (a link swinging
    // past between the check and the press made this racy) and ask the hover readout.
    await page.keyboard.press(' ');
    await frames(page, 1);
    assert((await state(page)).paused, 'paused for the ground drag');
    let g = null;
    for (const i of [3, 2, 4, 1, 5]) {
      const p = await page.evaluate((i) => window.__knap.cellScreenPos(1, i), i);
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await frames(page, 1);
      if (/^Part 1 /.test((await status(page)).hover)) {
        g = p;
        break;
      }
    }
    assert(g, 'a ground-beam cell is visible');
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
    /**
     * Stop with the keyboard, then start again paused at t = 0 (stepSim(0) from edit mode), so both
     * runs below start from exactly the initial pose. (Play + Pause by keys let a wall-clock
     * dependent number of frames run in between, which made the drag check below flaky.)
     */
    const restartPaused = async () => {
      await page.keyboard.press('Escape');
      await frames(page, 1);
      await page.evaluate(() => window.__knap.stepSim(0));
      await frames(page, 2);
      assert((await state(page)).paused && (await page.evaluate(() => window.__knap.simInfo())).time === 0, 'paused at t = 0');
    };

    // The follow bound below (≥ 15 px closer in 0.5 s) was set with frictionless joints; joint
    // friction (default Realistic) slows the follow to ≈ 16 px, too close to the bound, so this
    // step runs at friction Off explicitly (picked in the top bar; restored at the end).
    await press(page, '[data-friction=off]');
    // Baseline: 1 s of simulated time without grabbing — the linkage falls.
    await restartPaused();
    assert((await page.evaluate(() => window.__knap.simInfo())).jointFriction === 0, 'friction Off for the grab checks');
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
    await press(page, '[data-friction=realistic]');
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

  await step('input while the simulation is starting is not lost', async () => {
    const key = (k) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }));`;
    const waitNotStarting = () => page.waitForFunction(() => window.__knap.getState().mode !== 'starting', null, { timeout: 60000 });
    // Esc right after Space cancels the start: back to edit, model untouched.
    const atEsc = await page.evaluate(`(() => { ${key(' ')} const a = window.__knap.getState().mode; ${key('Escape')} return a; })()`);
    await waitNotStarting();
    assert(atEsc === 'starting', `Space then Esc in the same task: Esc arrived while starting (${atEsc})`);
    assert((await state(page)).mode === 'edit', `Esc while starting cancels the simulation (${(await state(page)).mode})`);
    assert(deepEqual(await model(page), edited), 'model untouched');
    // A speed picked while starting is the speed the simulation runs at.
    const sp0 = (await state(page)).speed;
    await page.evaluate(`(() => { ${key(' ')} document.querySelector('[data-speed="1"]').click(); })()`);
    await waitNotStarting();
    const info = await page.evaluate(() => window.__knap.simInfo());
    assert((await state(page)).mode === 'simulate' && info.speed === 1 && (await state(page)).speed === 1, `speed set while starting applies (sim ${info.speed}, app ${(await state(page)).speed})`);
    await page.keyboard.press('Escape');
    await frames(page, 1);
    await press(page, `[data-speed="${sp0}"]`);
    // Two Steps from edit mode step twice.
    await page.evaluate(`(() => { ${key('.')} ${key('.')} })()`);
    await waitNotStarting();
    await page.waitForFunction(() => (window.__knap.simInfo()?.time ?? 0) > 0.03, null, { timeout: 20000 });
    const t2 = (await page.evaluate(() => window.__knap.simInfo())).time;
    assert(Math.abs(t2 - 2 / 60) < 1e-9 && (await state(page)).paused, `two Steps from edit = 2/60 s, paused (${t2})`);
    await page.keyboard.press('Escape');
    await frames(page, 1);
    assert((await state(page)).mode === 'edit', 'stopped');
  });

  await step('Play on a mechanism whose joints are all vertical says why nothing moves', async () => {
    const flat = {
      version: 1, rootPartId: 1, nextPartId: 4,
      parts: [
        { id: 1, color: '#5f6468', cells: [0, 1, 2].map((x) => ({ x, y: 0, z: 0, kind: 'pinHole', axis: 1 })) },
        { id: 2, color: '#d9c9a3', cells: [0, 1].map((y) => ({ x: 2, y, z: 0, kind: 'pin', axis: 1 })) },
        { id: 3, color: '#3b74c4', cells: [2, 3, 4, 5, 6].map((x) => ({ x, y: 1, z: 0, kind: 'pinHole', axis: 1 })) },
      ],
    };
    await page.evaluate((m) => window.__knap.setModel(m), flat);
    await page.keyboard.press(' ');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    const msg = (await status(page)).message;
    assert(/every joint axis is vertical/.test(msg), `status explains the vertical joint axes: "${msg}"`);
    await page.keyboard.press('Escape');
    await frames(page, 1);
    await page.evaluate((m) => window.__knap.setModel(m), edited);
    assert(deepEqual(await model(page), edited), 'four-bar back');
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
