// Reviewer verify-ui: focused probes with screenshots.
//  (i) Cart, pin tool: one face whose overlay switches red ↔ orange as the cursor moves a few px;
//  (ii) Alt + pin over a wheel's flat face: valid highlight but red hint?;
//  (iii) the axle far end from the FRONT view: full hint.
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-probe.mjs
import { frames, status } from './app-lib.mjs';
import { C, K, M, session, setModel } from './review-m7-lib.mjs';

const S = await session();
const log = (...a) => console.log(...a);
try {
  const ctx = await S.open('probe', { width: 1280, height: 720 });
  const { page } = ctx;
  const read = async () => {
    const st = await K(page, () => window.__knap.getState());
    const sb = await status(page);
    const red = await page.locator('.st-hint.invalid').count();
    return `hover "${sb.hover}" hint "${sb.hint}" aux "${sb.aux}" hintRed ${red > 0} msg "${sb.message}" msgRed ${sb.error} hl ${JSON.stringify(st.buildHighlight)}`;
  };
  // (i)
  await K(page, () => window.__knap.loadExample('cart'));
  await K(page, () => window.__knap.home());
  await page.keyboard.press('4');
  await frames(page, 2);
  for (const [x, y] of [[308, 400], [314, 400], [320, 400], [326, 400]]) {
    await page.mouse.move(x, y, { steps: 2 });
    await frames(page, 2);
    log(`(i) (${x},${y}) ${await read()}`);
    await ctx.shot(`review-m7-probe-cart-pin-${x}`);
  }
  // (ii)
  await setModel(page, M([{ color: '#3b74c4', cells: [C(8, 0, 0, 'pinHole', 2, 2)] }], { ground: false }));
  await K(page, () => window.__knap.setCamera({ target: [5, 0, 0], yaw: Math.PI / 4, pitch: 0.55, height: 14 }));
  await frames(page, 2);
  const p0 = await K(page, () => window.__knap.partScreenPos(1));
  const p = { x: p0.x + 25, y: p0.y - 25 };
  await page.mouse.move(p.x - 3, p.y);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await frames(page, 2);
  log(`(ii) no Alt: ${await read()}`);
  await page.keyboard.down('Alt');
  await page.mouse.move(p.x + 1, p.y);
  await frames(page, 2);
  log(`(ii) Alt: ${await read()}`);
  await ctx.shot('review-m7-probe-alt-pin-wheel');
  await page.keyboard.up('Alt');
  // fresh: Alt pressed before ever hovering an invalid face
  await page.mouse.move(30, 690);
  await page.keyboard.press('1');
  await page.keyboard.press('4');
  await page.keyboard.down('Alt');
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await frames(page, 2);
  log(`(ii) Alt from scratch: ${await read()}`);
  await page.keyboard.up('Alt');
  // (iii)
  await setModel(page, M([
    { color: '#a8adb2', cells: Array.from({ length: 5 }, (_, i) => C(i, 0, 0)) },
    { color: '#e0b43c', cells: [C(2, 0, -1, 'axle', 2), C(2, 0, 0, 'axle', 2), C(2, 0, 1, 'axle', 2)] },
  ], { ground: false }));
  await K(page, () => { window.__knap.setView('front'); window.__knap.fit(); });
  await page.keyboard.press('3');
  await frames(page, 2);
  const a = await K(page, () => window.__knap.screenPos([2, 0, 1.5]));
  for (const dx of [0, 6, 14]) {
    await page.mouse.move(a.x + dx - 2, a.y);
    await page.keyboard.down('Alt');
    await page.mouse.move(a.x + dx, a.y, { steps: 2 });
    await frames(page, 2);
    log(`(iii) front view, axle end +${dx}px, Alt: ${await read()}`);
    if (dx === 0) {
      await ctx.shot('review-m7-probe-axle-front-alt');
      // (fixer) and the click: extends the axle at its far end, (2, 0, −2)
      await page.mouse.down();
      await page.mouse.up();
      await frames(page, 2);
      const ax = (await K(page, () => window.__knap.getModel())).parts.find((p) => p.id === 2);
      log(`(iii) after Alt+click: part 2 cells ${ax.cells.map((c) => `${c.x},${c.y},${c.z}`).join(' | ')}`);
      await page.keyboard.up('Alt');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
      await frames(page, 1);
      await page.keyboard.down('Alt');
    }
    await page.keyboard.up('Alt');
  }
  // and from a view slightly off front (yaw 15°, pitch 10°)
  await K(page, () => { const c = window.__knap.camera(); window.__knap.setCamera({ ...c, yaw: 0.26, pitch: 0.17 }); });
  await frames(page, 2);
  const b = await K(page, () => window.__knap.screenPos([2, 0, 1.5]));
  await page.mouse.move(b.x - 2, b.y);
  await page.keyboard.down('Alt');
  await page.mouse.move(b.x, b.y, { steps: 2 });
  await frames(page, 2);
  log(`(iii) yaw 15° pitch 10°, axle end, Alt: ${await read()}`);
  await ctx.shot('review-m7-probe-axle-off-alt');
  await page.keyboard.up('Alt');
} finally {
  await S.close();
}
process.exit(0);
