// App e2e: gears end to end in the real page (DESIGN §2.7, §5.1 "Gears", §7.4, §7.5, §8 example 10).
// 1. The Gear train example from the Examples menu: analyze().meshes, the Show kinematics mesh
//    glyphs; Play (friction Realistic, stepped deterministically): the pinion turns at −5× the arm
//    and the output at 5/3× within 1e-3, both meshes stay engaged with phase error < 0.005 teeth, and
//    the train comes to rest. Screenshots (full view and a front close-up of the meshes) at t = 0,
//    1 s and at rest.
// 2. A gear pair built with the Gear tool (mouse, key T) on a prepared frame, then simulated: 8 : 24
//    turns at −3 : 1 and stays engaged.
// 3. A loose 24-tooth gear standing on the ground with Fix root off: pushed, it rolls and does not
//    sink into the floor.
// Screenshots: e2e/out/app-geartrain-*.png.
import { clickAt, frames, hover, model, openApp, press, settle, state, status, summary } from './app-lib.mjs';

const angleZ = (q) => 2 * Math.atan2(q[2], q[3]);
const unwrap = (prev, a) => prev + Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
const cellAt = (m, id, pos) => m.parts.find((p) => p.id === id)?.cells.find((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);

export default async function ({ page, url, shot, assert, step, errors }) {
  const tr = () => page.evaluate(() => window.__knap.simTransforms());
  const info = () => page.evaluate(() => window.__knap.simInfo());
  const stepSim = (n) => page.evaluate((k) => window.__knap.stepSim(k), n);
  /** Screenshot the whole page and a front close-up of the region around `target` (then restore the camera). */
  const shots = async (name, target, height) => {
    await frames(page, 2);
    await shot(`app-geartrain-${name}`);
    const cam = await page.evaluate(() => window.__knap.camera());
    await page.evaluate(([t, h]) => window.__knap.setCamera({ target: t, yaw: 0, pitch: 0, height: h }), [target, height]);
    await frames(page, 3);
    await shot(`app-geartrain-${name}-close`);
    await page.evaluate((c) => window.__knap.setCamera(c), cam);
    await frames(page, 2);
  };

  await step('load the Gear train example from the menu', async () => {
    await openApp(page, url);
    await press(page, '[data-action=examples]');
    await page.locator('[data-example=gear-train]').scrollIntoViewIfNeeded();
    await press(page, '[data-example=gear-train]');
    const s = await summary(page);
    assert(s.bodies === 4 && s.fixedBodies === 1 && s.joints === 3 && s.meshes === 2, `analysis: ${s.summary}, meshes ${s.meshes}`);
    const counts = (await status(page)).counts;
    assert(/ · 2 meshes$/.test(counts), `status counts name the meshes: "${counts}"`);
    await page.mouse.move(1, 360);
    await page.keyboard.press('k');
    assert((await state(page)).showKinematics, 'Show kinematics on');
    await frames(page, 2);
    await shot('app-geartrain-kinematics');
    await page.keyboard.press('k');
    assert(!(await state(page)).showKinematics, 'Show kinematics off');
  });

  await step('Play: ratios, meshes engaged, at rest (friction Realistic)', async () => {
    await press(page, '[data-friction=realistic]');
    assert((await stepSim(0)) === 0, 'simulating from t = 0');
    let st = await state(page);
    assert(st.mode === 'simulate' && st.paused, 'simulating, paused');
    await page.mouse.move(1, 360);
    let i0 = await info();
    assert(i0.substeps === 1, `k = 1 at rest (${i0.substeps})`);
    // Meshes engage before the first world step (§5.1), so none is reported at t = 0.
    assert(i0.meshes.length === 0, `no mesh engaged before the first step: ${JSON.stringify(i0.meshes)}`);
    await shots('t0', [0.5, 2.5, 1.5], 7);
    // Arm = part 3 (40), pinion = part 2 (two 8s), output = part 4 (24).
    let a = 0, p = 0, q = 0;
    let last = await tr();
    let errP = 0, errQ = 0, phase = 0, kMax = 1, notEngaged = 0, aMax = 0;
    const sample = async () => {
      const t = await tr();
      a = unwrap(a, angleZ(t[3].q) - angleZ(last[3].q) + a) ;
      p = unwrap(p, angleZ(t[2].q) - angleZ(last[2].q) + p);
      q = unwrap(q, angleZ(t[4].q) - angleZ(last[4].q) + q);
      last = t;
      aMax = Math.max(aMax, Math.abs(a));
      if (Math.abs(a) > 0.05) {
        errP = Math.max(errP, Math.abs(p / a + 5));
        errQ = Math.max(errQ, Math.abs(q / a - 5 / 3));
      }
      const inf = await info();
      kMax = Math.max(kMax, inf.substeps);
      if (inf.meshes.length !== 2) notEngaged++;
      for (const m of inf.meshes) phase = Math.max(phase, Math.abs(m.phaseErrorTeeth));
      return inf;
    };
    // 1 s in steps of 4 fixed steps (the pinion turns < 1 rad per sample, so unwrapping is safe).
    for (let n = 0; n < 480; n += 4) {
      await stepSim(4);
      const inf = await sample();
      if (n === 0) assert(inf.meshes.length === 2 && inf.meshes.every((m) => Math.abs(m.phaseErrorTeeth) < 1e-3), `both meshes engaged from the first step, snap 0: ${JSON.stringify(inf.meshes)}`);
    }
    const i1 = await info();
    console.log(`  [app-geartrain] 1 s: arm ${((a * 180) / Math.PI).toFixed(1)}° (max ${((aMax * 180) / Math.PI).toFixed(1)}°), pinion/arm ${(p / a).toFixed(6)}, output/arm ${(q / a).toFixed(6)}, max ratio errors ${errP.toExponential(2)} / ${errQ.toExponential(2)}, phase ≤ ${phase.toExponential(2)} teeth, k ≤ ${kMax}, joint error ${i1.jointError.toExponential(2)}`);
    await shots('1s', [0.5, 2.5, 1.5], 7);
    // to 6 s, still sampling (the motion is over by ≈ 3 s at Realistic)
    for (let n = 480; n < 6 * 480; n += 4) {
      await stepSim(4);
      await sample();
    }
    const t6 = await tr();
    await stepSim(4 * 480);
    const t10 = await tr();
    const i10 = await info();
    const still = Math.max(...[2, 3, 4].map((id) => Math.abs(unwrap(0, angleZ(t10[id].q) - angleZ(t6[id].q)))));
    console.log(`  [app-geartrain] at ${i10.time.toFixed(1)} s: arm ${((a * 180) / Math.PI).toFixed(1)}°, pinion/arm ${(p / a).toFixed(6)}, output/arm ${(q / a).toFixed(6)}; max ratio errors ${errP.toExponential(2)} / ${errQ.toExponential(2)}; phase ≤ ${phase.toExponential(2)} teeth; samples not both engaged ${notEngaged}; k ≤ ${kMax}, now ${i10.substeps}; moved ${still.toExponential(1)} rad from 6 s to 10 s; joint error ${i10.jointError.toExponential(2)}`);
    assert(aMax > (120 * Math.PI) / 180, `the arm falls and swings past the bottom (${((aMax * 180) / Math.PI).toFixed(1)}°)`);
    assert(errP < 5e-3 && errQ < (5 / 3) * 1e-3, `ratios within 1e-3 relative: pinion ${errP}, output ${errQ}`);
    assert(notEngaged === 0 && i10.meshes.length === 2, `meshes stay engaged (${notEngaged} samples not)`);
    assert(phase < 0.005, `phase error < 0.005 teeth (${phase})`);
    assert(kMax > 1 && i10.substeps === 1, `k rose above 1 (${kMax}) and is back to 1 at rest (${i10.substeps})`);
    assert(still < 1e-3, `at rest by 6 s (${still} rad in 4 s)`);
    assert(i10.jointError < 1e-3, `joints hold (${i10.jointError})`);
    await shots('rest', [0.5, 2.5, 1.5], 7);
    await press(page, '[data-action=stop]');
    assert((await state(page)).mode === 'edit', 'stopped');
    assert(errors.length === 0, `no console errors: ${errors.join(' | ')}`);
  });

  await step('a gear pair built with the Gear tool, then simulated', async () => {
    // Frame (fixed): a vertical beam in layer −1. A: an arm in layer 0 along −X from (0, 0, 0) and a
    // hole (0, 0, 1); B: a hole (0, 2, 0) and a hole (0, 2, 1). Each on a smooth pin from the frame.
    const C = '#5f6468';
    const cell = (x, y, z, kind = 'pinHole') => ({ x, y, z, kind, axis: 2 });
    const base = {
      version: 1,
      rootPartId: 1,
      nextPartId: 6,
      parts: [
        { id: 1, color: C, cells: [cell(0, 0, -1), cell(0, 1, -1), cell(0, 2, -1)] },
        { id: 2, color: '#c8433a', cells: [cell(0, 0, 0), cell(-1, 0, 0), cell(-2, 0, 0), cell(-3, 0, 0), cell(0, 0, 1)] },
        { id: 3, color: '#3b74c4', cells: [cell(0, 2, 0), cell(0, 2, 1)] },
        { id: 4, color: '#e0b43c', cells: [cell(0, 0, -1, 'frictionPin'), cell(0, 0, 0, 'pin')] },
        { id: 5, color: '#e0b43c', cells: [cell(0, 2, -1, 'frictionPin'), cell(0, 2, 0, 'pin')] },
      ],
    };
    await page.evaluate((m) => window.__knap.setModel(m), base);
    await page.evaluate(() => window.__knap.fit());
    await settle(page);
    await page.keyboard.press('t');
    assert((await state(page)).tool === 'gear', 'T selects the Gear tool');
    const face = async (id, ci) => {
      const pt = await page.evaluate(([a, b]) => window.__knap.clientPosOfCellFace(a, b, 4), [id, ci]);
      assert(pt, `the +Z face of cell ${ci} of part ${id} is clickable`);
      return pt;
    };
    // The 8 first (B's top hole), then A's top hole 8 → 16 → 24, which meshes with it (distance 2).
    let pt = await face(3, 1);
    await hover(page, pt);
    await clickAt(page, pt);
    for (let k = 0; k < 3; k++) {
      pt = await face(2, 4);
      await hover(page, pt);
      if (k === 2) {
        const h = (await status(page)).hint;
        assert(h === 'Gear · part 2 · 24 teeth (radius 1.5) · meshes with part 3 (8 teeth, 3:1)', `hint before the 24: "${h}"`);
      }
      await clickAt(page, pt);
    }
    const m = await model(page);
    assert(cellAt(m, 3, [0, 2, 1])?.teeth === true && cellAt(m, 3, [0, 2, 1]).rim === 0.5, `B has an 8: ${JSON.stringify(cellAt(m, 3, [0, 2, 1]))}`);
    assert(cellAt(m, 2, [0, 0, 1])?.teeth === true && cellAt(m, 2, [0, 0, 1]).rim === 1.5, `A has a 24: ${JSON.stringify(cellAt(m, 2, [0, 0, 1]))}`);
    assert((await summary(page)).meshes === 1, 'one mesh');
    await page.keyboard.press('v'); // back to Select so hovering does not ghost
    await page.mouse.move(1, 360);
    await frames(page, 2);
    await shot('app-geartrain-built');
    assert((await stepSim(0)) === 0, 'simulating from t = 0');
    let a = 0, b = 0, err = 0, engaged = true;
    let last = await tr();
    for (let n = 0; n < 480; n += 4) {
      await stepSim(4);
      const t = await tr();
      a += unwrap(0, angleZ(t[2].q) - angleZ(last[2].q));
      b += unwrap(0, angleZ(t[3].q) - angleZ(last[3].q));
      last = t;
      if (Math.abs(a) > 0.05) err = Math.max(err, Math.abs(b / a + 3));
      if ((await info()).meshes.length !== 1) engaged = false;
    }
    const i = await info();
    console.log(`  [app-geartrain] built pair after 1 s: arm ${((a * 180) / Math.PI).toFixed(1)}°, 8/24 ${(b / a).toFixed(6)} (max error ${err.toExponential(2)}), phase ${i.meshes[0]?.phaseErrorTeeth.toExponential(2)} teeth, joint error ${i.jointError.toExponential(2)}`);
    assert(Math.abs(a) > 1, `the arm turns the 24 (${a} rad)`);
    assert(err < 3e-3, `the 8 turns at −3× the 24 within 1e-3 relative (${err})`);
    assert(engaged, 'the mesh stays engaged');
    await shot('app-geartrain-built-sim');
    await press(page, '[data-action=stop]');
  });

  await step('a gear on the ground with Fix root off rolls and does not sink', async () => {
    const g = {
      version: 3,
      rootPartId: 1,
      nextPartId: 2,
      ground: true,
      fixRoot: false,
      parts: [{ id: 1, color: '#4c9a57', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2, rim: 1.5, teeth: true }] }],
    };
    await page.evaluate((m) => window.__knap.setModel(m), g);
    await page.evaluate(() => window.__knap.fit());
    await settle(page);
    assert((await state(page)).rootFixed === false, 'nothing fixed');
    assert((await stepSim(0)) === 0, 'simulating from t = 0');
    const i0 = await info();
    // Rolling without slip on the collider's tip radius r + 0.085 (§5.1): ω = −v / R.
    const v = 20;
    assert(await page.evaluate(([vv, w]) => window.__knap.pushBody(1, [vv, 0, 0], [0, 0, w]), [v, -v / 1.585]), 'pushed');
    let minY = Infinity, maxY = -Infinity;
    for (let n = 0; n < 960; n += 48) {
      await stepSim(48);
      const t = (await tr())[1];
      minY = Math.min(minY, t.p[1]);
      maxY = Math.max(maxY, t.p[1]);
    }
    const t = (await tr())[1];
    const i = await info();
    console.log(`  [app-geartrain] rolling gear after ${i.time.toFixed(1)} s: x ${t.p[0].toFixed(3)} (rolled ${(t.p[0] / (2 * Math.PI * 1.585)).toFixed(2)} turns), hub y ${minY.toFixed(4)}…${maxY.toFixed(4)}, turned ${((angleZ(t.q) * 180) / Math.PI).toFixed(0)}°, floor y ${i0.groundY}`);
    assert(t.p[0] > 30, `it rolls (${t.p[0]} units in 2 s)`);
    assert(minY > -0.03 && maxY < 0.03, `it does not sink or hop (hub y ${minY}…${maxY})`);
    await page.evaluate(() => window.__knap.fit());
    await frames(page, 3);
    await shot('app-geartrain-rolling');
    await press(page, '[data-action=stop]');
    assert(errors.length === 0, `no console errors: ${errors.join(' | ')}`);
  });
}
