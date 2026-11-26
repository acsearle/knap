// Reviewer "look" (m9): selection on a beam, small wheels / zoom sweep, beam end close-up (0.46 vs
// 0.47 half-cell), gear close-up (teeth vs disc), root marker.
//   E2E_DIST=e2e/out/review-m9-look-dist node e2e/review-m9-look-detail.mjs
import { K, cell, gear, model, session, setCam, setModel, frames, axisCam } from './review-m8-look-lib.mjs';

const S = await session();
try {
  const { page, shot } = await S.open('m9look-detail', { width: 1280, height: 720, deviceScaleFactor: 2 });
  const away = async () => { await page.mouse.move(640, 714); await frames(page, 3); };
  // selection of a beam in the cart
  await K(page, () => window.__knap.loadExample('cart'));
  await K(page, () => window.__knap.home());
  await K(page, () => window.__knap.setShowColliders(true));
  const m = await K(page, () => window.__knap.getModel());
  const beam = m.parts.filter((p) => !p.cells.some((c) => c.rim)).sort((a, b) => b.cells.length - a.cells.length)[0];
  const bp = await K(page, (id) => window.__knap.partScreenPos(id), beam.id);
  await page.mouse.click(bp.x, bp.y);
  await page.mouse.move(bp.x + 200, bp.y - 150); // hover something else
  await frames(page, 3);
  console.log('selected', (await K(page, () => window.__knap.getState())).selection, 'beam', beam.id);
  await shot('review-m9-look-select-beam');
  await page.keyboard.press('Escape');

  // small wheels r0.5 .. 2.5 in a row, blue & yellow, zoom sweep
  const parts = [0.5, 1, 1.5, 2.5].map((r, i) => ({ color: i % 2 ? '#3b74c4' : '#e0b43c', cells: [cell([0, 3, 7, 13][i], 0, 0, 'axleHole', 2, r)] }));
  parts.push({ color: '#a8adb2', cells: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((x) => cell(x, -3, 0, 'pinHole', 2)) });
  await setModel(page, model(parts, { ground: { y: -4 } }));
  for (const hgt of [12, 30, 80]) {
    await setCam(page, { target: [6.5, -1, 0], height: hgt, yaw: 0.6, pitch: 0.5 });
    await away();
    await shot(`review-m9-look-wheels-h${hgt}`);
  }
  // beam end close-up: 0.46 vs 0.47 — face-on the beam's end and from above
  await setCam(page, { ...axisCam(1, [0, -3, 0], 2.2) });
  await away();
  await shot('review-m9-look-beamend-top');
  await setCam(page, { target: [0, -3, 0], height: 2.2, yaw: 0.5, pitch: 0.4 });
  await away();
  await shot('review-m9-look-beamend-iso');
  // gear close-up
  await setModel(page, model([{ color: '#c8433a', cells: [gear(0, 0, 0, 2, 2.5)] }, { color: '#e0b43c', cells: [gear(4, 0, 0, 2, 1.5)] }]));
  await setCam(page, { target: [2, 0, 0], height: 7, yaw: 0.35, pitch: 0.3 });
  await away();
  await shot('review-m9-look-gears-on');
  await K(page, () => window.__knap.setShowColliders(false));
  await away();
  await shot('review-m9-look-gears-off');
} finally {
  await S.close();
}
