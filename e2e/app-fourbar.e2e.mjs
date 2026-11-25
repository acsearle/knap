// App e2e: build a four-bar linkage (the closed-loop test case of the requirements) from an empty
// model with real mouse clicks and keys, closing the loop the documented way: the last two links'
// end holes are stacked and one pin pushed into the front hole goes on through the hole behind
// (deep insert, DEVIATIONS §7). Then check the analysis (4 bodies, 4 revolute joints) and that it
// moves when simulated.
// Ground (0..4,0,0) ∥Z holes; crank (0,0..2,1) and rocker (4,0..3,1)+(3,3,1) on pins in the
// ground's end holes; coupler (0..3,2,2)+(3,3,2) on a pin from the crank top, and pinned to the
// rocker's (3,3,1) by one deep-inserted pin.
import { cellIndexAt, clickAt, clickFace, facePos, frames, gridPos, hover, model, openApp, press, settle, state, status, summary } from './app-lib.mjs';

export default async function ({ page, url, shot, assert, step }) {
  await step('load an empty model', async () => {
    await openApp(page, url);
    await press(page, '[data-action=new]');
    await frames(page, 2);
    await settle(page);
  });

  const idOf = async (pos, kindRe) => {
    const m = await model(page);
    return m.parts.find((q) => q.cells.some((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2] && kindRe.test(c.kind)))?.id;
  };
  const hoverFace = async (pid, pos, dir) => {
    const m = await model(page);
    await hover(page, await facePos(page, pid, cellIndexAt(m, pid, pos), dir));
  };
  /** Pin into ground hole `x`, lengthened by one, then a beam sleeved onto its top. */
  const pinAndSleeve = async (x) => {
    await page.keyboard.press('4');
    await clickFace(page, 1, [x, 0, 0], 4);
    const pin = await idOf([x, 0, 0], /^pin$/);
    await clickFace(page, pin, [x, 0, 0], 4);
    await page.keyboard.press('1');
    await clickFace(page, pin, [x, 0, 1], 4);
    return idOf([x, 0, 1], /^pinHole$/);
  };

  let crank, rocker, coupler;
  await step('ground, crank and rocker', async () => {
    await page.keyboard.press('1');
    await clickAt(page, await gridPos(page, 0, 0));
    for (let x = 0; x < 4; x++) await clickFace(page, 1, [x, 0, 0], 0);
    crank = await pinAndSleeve(0);
    assert(crank, 'crank sleeved onto the first pin');
    await clickFace(page, crank, [0, 0, 1], 2);
    await clickFace(page, crank, [0, 1, 1], 2);
    rocker = await pinAndSleeve(4);
    assert(rocker && rocker !== crank, 'rocker sleeved onto the second pin');
    for (let y = 0; y < 3; y++) await clickFace(page, rocker, [4, y, 1], 2);
    // (3,3,1) hangs off the rocker's -X face, hidden in the iso view: orbit, build, Home.
    await page.mouse.move(300, 600);
    await page.mouse.down();
    await page.mouse.move(420, 600, { steps: 6 });
    await page.mouse.up();
    await frames(page, 2);
    await clickFace(page, rocker, [4, 3, 1], 1);
    await page.keyboard.press('Home');
    await settle(page);
    const m = await model(page);
    assert(m.parts.find((p) => p.id === rocker).cells.length === 5, `L-shaped rocker of 5 holes: ${JSON.stringify(m.parts.find((p) => p.id === rocker).cells)}`);
  });

  await step('coupler on a pin from the crank top, its end hole stacked on the rocker’s', async () => {
    await page.keyboard.press('4');
    await clickFace(page, crank, [0, 2, 1], 4);
    const pin = await idOf([0, 2, 1], /^pin$/);
    await clickFace(page, pin, [0, 2, 1], 4);
    await page.keyboard.press('1');
    await clickFace(page, pin, [0, 2, 2], 4);
    coupler = await idOf([0, 2, 2], /^pinHole$/);
    assert(coupler && ![crank, rocker].includes(coupler), 'coupler is a new part');
    for (let x = 0; x < 3; x++) await clickFace(page, coupler, [x, 2, 2], 0);
    await clickFace(page, coupler, [3, 2, 2], 2);
    const c = (await model(page)).parts.find((p) => p.id === coupler).cells;
    assert(c.some((q) => q.x === 3 && q.y === 3 && q.z === 2), `coupler reaches (3,3,2), in front of the rocker hole (3,3,1): ${JSON.stringify(c)}`);
    const s = await summary(page);
    assert(s.bodies === 4 && s.revolute === 3, `before the last pin: 4 bodies, 3 revolute (${s.summary})`);
    await shot('app-fourbar-before-last-pin');
  });

  await step('one pin into the front hole closes the loop', async () => {
    await page.keyboard.press('4');
    await hoverFace(coupler, [3, 3, 2], 4);
    const st = await status(page);
    assert(/^New part · insert pin ∥ Z into part \d+ · 2 long, through part \d+/.test(st.hint), `the hint offers a deep insert: "${st.hint}"`);
    await clickFace(page, coupler, [3, 3, 2], 4);
    const pin = await idOf([3, 3, 1], /^pin$/);
    const cells = (await model(page)).parts.find((p) => p.id === pin)?.cells ?? [];
    assert(cells.length === 2 && cells.some((c) => c.z === 2) && cells.some((c) => c.z === 1), `a 2-long pin through both holes: ${JSON.stringify(cells)}`);
    const s = await summary(page);
    assert(s.bodies === 4 && s.fixedBodies === 1 && s.joints === 4 && s.revolute === 4, `a four-bar: 4 bodies (1 fixed), 4 revolute (${s.summary})`);
    await page.mouse.move(5, 300);
    await page.keyboard.press('k');
    await frames(page, 2);
    await shot('app-fourbar-kinematics');
    await page.keyboard.press('k');
  });

  await step('it moves when simulated and stays closed', async () => {
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.evaluate(() => window.__knap.setPaused(true));
    await page.evaluate(() => window.__knap.stepSim(480));
    const t = await page.evaluate(() => window.__knap.simTransforms());
    const ang = (q) => (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
    assert(ang(t[crank].q) > 5, `the crank turns (${ang(t[crank].q).toFixed(1)}°)`);
    const info = await page.evaluate(() => window.__knap.simInfo());
    assert(info.jointError < 0.05, `the loop stays closed (joint error ${info.jointError})`);
    await page.keyboard.press('Escape');
    await frames(page, 1);
    assert((await state(page)).mode === 'edit', 'Esc stops');
  });
}
