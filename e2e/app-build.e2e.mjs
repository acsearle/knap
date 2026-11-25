// App e2e 1: build a pendulum from an empty model purely with mouse clicks and keys, check the
// model and its kinematic analysis, simulate it (the link swings and stays on its pivot), stop
// and check the model is exactly what it was.
import { applyT, clickAt, clickFace, deepEqual, dist, frames, gridPos, hover, model, openApp, press, sleep, state, status, summary } from './app-lib.mjs';

export default async function ({ page, url, shot, assert, step }) {
  await step('load', () => openApp(page, url));

  await step('New', async () => {
    await press(page, '[data-action=new]');
    const m = await model(page);
    assert(m.parts.length === 0, `New gives an empty model (${m.parts.length} parts)`);
  });

  await step('first pin hole on the grid, [R] to lie it along Z', async () => {
    await page.keyboard.press('1');
    assert((await state(page)).tool === 'pinHole', 'key 1 selects the pin-hole tool');
    await hover(page, await gridPos(page, 0, 0));
    let st = await status(page);
    assert(/New part on grid · pin hole ∥ Y/.test(st.hint), `grid hover offers a new pin hole ∥ Y: "${st.hint}"`);
    await page.keyboard.press('r');
    await frames(page, 1);
    st = await status(page);
    assert(/pin hole ∥ Z/.test(st.hint), `[R] cycles to ∥ Z: "${st.hint}"`);
    await shot('app-build-ghost');
    await clickAt(page, await gridPos(page, 0, 0));
    const m = await model(page);
    assert(m.parts.length === 1 && deepEqual(m.parts[0].cells, [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2 }]), `one pin hole ∥ Z at the origin: ${JSON.stringify(m.parts)}`);
  });

  await step('extend into a 3-hole beam', async () => {
    await clickFace(page, 1, [0, 0, 0], 0);
    await clickFace(page, 1, [1, 0, 0], 0);
    const m = await model(page);
    assert(m.parts.length === 1 && m.parts[0].cells.length === 3, `3-hole beam (${JSON.stringify(m.parts)})`);
    assert(m.parts[0].cells.every((c) => c.kind === 'pinHole' && c.axis === 2 && c.y === 0 && c.z === 0), 'beam cells are pin holes ∥ Z along X');
  });

  await step('insert a smooth pin into the end hole and lengthen it', async () => {
    await page.keyboard.press('4');
    await clickFace(page, 1, [2, 0, 0], 4);
    let m = await model(page);
    const pin = m.parts.find((p) => p.id === 2);
    assert(pin && deepEqual(pin.cells, [{ x: 2, y: 0, z: 0, kind: 'pin', axis: 2 }]), `pin inserted at (2,0,0) ∥ Z: ${JSON.stringify(m.parts)}`);
    assert(/insert pin/.test((await status(page)).message), 'status says it inserted a pin');
    await clickFace(page, 2, [2, 0, 0], 4); // on-axis: picks the pin inside the hole
    m = await model(page);
    assert(m.parts.find((p) => p.id === 2).cells.length === 2, 'pin lengthened to 2 cells');
  });

  await step('sleeve a new beam onto the protruding pin (Shift = new part)', async () => {
    await page.keyboard.press('1');
    // Without Shift the click would extend the pin part with a hole; the hint says what Shift does.
    const m0 = await model(page);
    const ci = m0.parts.find((p) => p.id === 2).cells.findIndex((c) => c.z === 1);
    const p = await page.evaluate(([a, b]) => window.__knap.clientPosOfCellFace(a, b, 4), [2, ci]);
    await hover(page, p);
    const st = await status(page);
    assert(/Shift: New part · sleeve pin hole ∥ Z onto part 2/.test(st.aux), `Shift hint offers the sleeve: "${st.aux}"`);
    await clickAt(page, p, { shift: true });
    const m = await model(page);
    const link = m.parts.find((q) => q.id === 3);
    assert(link && deepEqual(link.cells, [{ x: 2, y: 0, z: 1, kind: 'pinHole', axis: 2 }]), `new part 3 sleeved at (2,0,1): ${JSON.stringify(m.parts)}`);
  });

  await step('extend the new beam to 5 holes', async () => {
    for (let x = 2; x < 6; x++) await clickFace(page, 3, [x, 0, 1], 0);
    const m = await model(page);
    const link = m.parts.find((q) => q.id === 3);
    assert(link.cells.length === 5 && link.cells.every((c) => c.kind === 'pinHole' && c.axis === 2 && c.z === 1), `5-hole link: ${JSON.stringify(link.cells)}`);
    assert(m.parts.length === 3, '3 parts');
    const s = await summary(page);
    assert(s.bodies === 2 && s.fixedBodies === 1 && s.joints === 1 && s.revolute === 1, `2 bodies, 1 revolute: ${s.summary}`);
    const st = await status(page);
    assert(st.counts === '3 parts · 2 bodies (1 fixed) · 1 joint: 1 revolute', `status counts: "${st.counts}"`);
    await page.mouse.move(5, 300);
    await frames(page, 2);
    await shot('app-build-pendulum');
  });

  const before = await model(page);
  await step('play: the link swings and stays on its pivot', async () => {
    await press(page, '[data-action=play]');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    const st = await state(page);
    assert(st.mode === 'simulate', 'simulating');
    assert(await page.locator('[data-tool=pinHole]').isDisabled(), 'tools are disabled while simulating');
    await sleep(1500);
    const t = (await page.evaluate(() => window.__knap.simTransforms()))[3];
    assert(t, 'link has a transform');
    const pivot = applyT(t, [2, 0, 1]);
    const tip = applyT(t, [6, 0, 1]);
    console.log(`  [app-build] pivot moved ${dist(pivot, [2, 0, 1]).toFixed(4)}, tip moved ${dist(tip, [6, 0, 1]).toFixed(3)}`);
    assert(dist(tip, [6, 0, 1]) > 0.5, `the link swings (tip moved ${dist(tip, [6, 0, 1])})`);
    assert(dist(pivot, [2, 0, 1]) < 0.05, `the link stays on its pivot (${dist(pivot, [2, 0, 1])})`);
    const root = (await page.evaluate(() => window.__knap.simTransforms()))[1];
    assert(dist(root.p, [0, 0, 0]) < 1e-9, 'the root does not move');
    const info = await page.evaluate(() => window.__knap.simInfo());
    assert(info.time > 0.02, `simulated time advances (${info.time})`);
    await shot('app-build-swinging');
  });

  await step('stop restores the model exactly', async () => {
    const cam0 = await page.evaluate(() => window.__knap.camera());
    await press(page, '[data-action=stop]');
    const st = await state(page);
    assert(st.mode === 'edit', 'back in edit mode');
    const after = await model(page);
    assert(deepEqual(before, after), 'model deep-equal to before Play');
    const cam1 = await page.evaluate(() => window.__knap.camera());
    assert(deepEqual(cam0, cam1), 'camera untouched by Stop');
    const tr = await page.evaluate(() => window.__knap.simTransforms());
    assert(Object.values(tr).every((t) => t && dist(t.p, [0, 0, 0]) === 0), 'parts back at their edited pose');
    assert(!(await page.locator('[data-tool=pinHole]').isDisabled()), 'tools enabled again');
  });
}
