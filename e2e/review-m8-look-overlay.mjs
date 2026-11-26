// Reviewer "look" (m8): Gear tool ghost (valid / refused), hover / erase on a gear in each colour,
// selection, Show kinematics tint + mesh glyphs, contact shadow under gears.
//   E2E_DIST=e2e/out/review-m8-look-dist node e2e/review-m8-look-overlay.mjs [dpr]
import { ISO, K, PAL, PAL_NAMES, cell, gear, model, pointClip, save, session, setCam, setModel, sheet, snap } from './review-m8-look-lib.mjs';
import { frames, hover } from './app-lib.mjs';

const S = await session();
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
const dprs = process.argv[2] ? [Number(process.argv[2])] : [1, 2];
const face = (page, id, ci, dir) => K(page, ([a, b, d]) => window.__knap.clientPosOfCellFace(a, b, d), [id, ci, dir]);
const st = (page) => K(page, () => window.__knap.getState());
try {
  for (const dpr of dprs) {
    const ctx = await S.open(`look-ov-${dpr}`, { width: 1280, height: 800, deviceScaleFactor: dpr });
    const { page } = ctx;
    const tiles = [];
    for (let k = 0; k < 8; k++) {
      const c = PAL[k];
      // part 1: 24 gear (hub axleHole) + an axial pin hole behind; part 2: a 2-hole beam at x 4..5
      // (8 on its end hole is refused: own cell inside the tips); part 3: a lone pin hole at (4, 0, 3)
      await setModel(page, model([
        { color: c, cells: [gear(0, 0, 0, 2, 1.5), cell(0, 0, -1, 'pinHole', 2)] },
        { color: c, cells: [cell(4, 0, 0, 'pinHole', 2), cell(5, 0, 0, 'pinHole', 2)] },
        { color: c, cells: [cell(4, 0, 3, 'pinHole', 2)] },
      ]));
      await setCam(page, { target: [2, 0, 1], height: 7.5, yaw: Math.PI / 4, pitch: ISO });
      await frames(page, 2);
      const clip = await pointClip(page, [2, 0, 1], dpr === 1 ? 190 : 190);
      await page.keyboard.press('t');
      // valid ghost: 8 on the lone hole
      let p = await face(page, 3, 0, 4);
      await hover(page, p);
      const h1 = (await st(page)).hint;
      tiles.push({ label: `${PAL_NAMES[k]} ghost valid: ${h1}`.slice(0, 60), buf: await snap(page, clip) });
      // refused ghost: 8 on the beam's end hole
      p = await face(page, 2, 0, 4);
      await hover(page, p);
      const h2 = (await st(page)).hint;
      tiles.push({ label: `${PAL_NAMES[k]} refused: ${h2}`.slice(0, 60), buf: await snap(page, clip) });
      // gear step-up ghost: hover the 24 (-> 40)
      p = await face(page, 1, 0, 4);
      if (!p) log(`${PAL_NAMES[k]}: no clickable face on the gear hub`);
      else {
        await hover(page, p);
        const h3 = (await st(page)).hint;
        tiles.push({ label: `${PAL_NAMES[k]} gear 24->: ${h3}`.slice(0, 60), buf: await snap(page, clip) });
      }
      // erase hover on the gear
      await page.keyboard.press('e');
      if (p) {
        await hover(page, p);
        tiles.push({ label: `${PAL_NAMES[k]} erase: ${(await st(page)).hint}`.slice(0, 60), buf: await snap(page, clip) });
      }
      // select: click the gear
      await page.keyboard.press('v');
      if (p) {
        await page.mouse.click(p.x, p.y);
        await page.mouse.move(5, 400);
        await frames(page, 2);
        tiles.push({ label: `${PAL_NAMES[k]} selected: ${JSON.stringify((await st(page)).selection)}`.slice(0, 60), buf: await snap(page, clip) });
        await page.keyboard.press('Escape');
      }
      log(`${PAL_NAMES[k]}: valid "${h1}" | refused "${h2}"`);
    }
    console.log('sheet', await sheet(S.browser, `review-m8-look-overlays-dpr${dpr}.png`, tiles, { cols: 5, title: `Gear tool ghost valid / refused / step-up, erase hover, selection; DPR ${dpr}` }));

    // Show kinematics on the gear train + a pair
    const kt = [];
    await K(page, () => window.__knap.loadExample('gear-train'));
    await page.keyboard.press('k');
    await K(page, () => window.__knap.home());
    await frames(page, 3);
    log(`kinematics on: ${(await st(page)).showKinematics}`);
    kt.push({ label: 'gear-train kinematics Home', buf: await page.screenshot({ clip: { x: 150, y: 50, width: 900, height: 720 } }) });
    const home = await K(page, () => window.__knap.camera());
    await setCam(page, { ...home, target: [0.4, 2.6, 1], height: 4 });
    kt.push({ label: 'kinematics close at pinion', buf: await snap(page, await pointClip(page, [0.4, 2.7, 1.5], 200)) });
    await setCam(page, { target: [0.4, 2.6, 1], height: 4, yaw: 0, pitch: 0 });
    kt.push({ label: 'kinematics front at pinion', buf: await snap(page, await pointClip(page, [0.4, 2.7, 1.5], 200)) });
    await K(page, () => window.__knap.stepSim(240));
    await setCam(page, { ...home, target: [0.4, 2.6, 1], height: 4 });
    kt.push({ label: 'kinematics while sim (t=0.5)', buf: await snap(page, await pointClip(page, [0.4, 2.7, 1.5], 200)) });
    await K(page, () => window.__knap.setMode('edit'));
    // a plain pair X axis + Y axis with kinematics
    await setModel(page, model([
      { color: '#e0b43c', cells: [gear(0, 0, 0, 0, 1.5)] }, { color: '#3b74c4', cells: [gear(0, 0, 2, 0, 0.5)] },
      { color: '#4c9a57', cells: [gear(6, 0, 0, 1, 1)] }, { color: '#c8433a', cells: [gear(8, 0, 0, 1, 1)] },
    ]));
    await K(page, () => window.__knap.home());
    await frames(page, 3);
    kt.push({ label: 'kinematics X and Y pairs Home', buf: await page.screenshot({ clip: { x: 150, y: 50, width: 900, height: 720 } }) });
    await page.keyboard.press('k');
    console.log('sheet', await sheet(S.browser, `review-m8-look-kinematics-dpr${dpr}.png`, kt, { cols: 3, title: `Show kinematics on gears, DPR ${dpr}` }));

    // contact shadow: 24 standing (axis X) on the ground, 40 lying (axis Y), and a plain r1.5 wheel standing
    const sh = [];
    await setModel(page, model([
      { color: '#4c9a57', cells: [gear(0, 0, 0, 0, 1.5)] },
      { color: '#4c9a57', cells: [cell(0, 0, 5, 'axleHole', 0, 1.5)] },
      { color: '#e0b43c', cells: [gear(7, 0, 0, 1, 2.5)] },
      { color: '#e0b43c', cells: [cell(7, 0, 7, 'axleHole', 1, 2.5)] },
    ], { ground: true }));
    log(`floor ${JSON.stringify(await K(page, () => window.__knap.floor()))}`);
    const sv = await K(page, () => [[0, 0], [0, 1], [0, 2], [0, 5], [0, 6], [7, 0], [7, 7], [7, 3.6], [7, 10.6]].map(([x, z]) => [x, z, window.__knap.groundShadowAt(x, z)]));
    log(`shadow strength (x, z, s): ${JSON.stringify(sv.map((a) => [a[0], a[1], +a[2].toFixed(3)]))}`);
    await K(page, () => window.__knap.home());
    sh.push({ label: 'Home: gear24 standing, wheel standing, 40 lying, wheel lying', buf: await page.screenshot({ clip: { x: 150, y: 50, width: 900, height: 720 } }) });
    await K(page, () => window.__knap.setView('top'));
    await frames(page, 3);
    sh.push({ label: 'TOP', buf: await page.screenshot({ clip: { x: 150, y: 50, width: 900, height: 720 } }) });
    const h = await K(page, () => window.__knap.camera());
    await K(page, () => window.__knap.home());
    const hh = await K(page, () => window.__knap.camera());
    await setCam(page, { ...hh, pitch: (8 * Math.PI) / 180 });
    sh.push({ label: 'grazing 8 deg', buf: await page.screenshot({ clip: { x: 150, y: 50, width: 900, height: 720 } }) });
    void h;
    console.log('sheet', await sheet(S.browser, `review-m8-look-shadow-dpr${dpr}.png`, sh, { cols: 3, title: `contact shadow, gears vs plain wheels, DPR ${dpr}` }));
  }
} finally {
  await save(`review-m8-look-overlay${process.argv[2] ? '-' + process.argv[2] : ''}.txt`, lines.join('\n'));
  await S.close();
}
