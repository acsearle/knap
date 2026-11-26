// Review (wheels UI): legibility and the ground — wheels of each radius in each palette colour at Home
// (DPR 1 and 2), outline under small orbit steps, a wheel touching a beam (0.06 gap), the ground from
// Home / FRONT / TOP / BOTTOM and extreme zooms, floor following a wheel that grows below the old level,
// idle = no redraws, frame time with the ground on vs off (renderTiming, median of 15).
import { frames, model, settle, state, status } from './app-lib.mjs';
import { reviewSetup, findings } from './review-wheels-lib.mjs';
import { openModel } from './review-wheels-fixture.mjs';

const F = findings();
const R = await reviewSetup();
const COLS = ['#e0b43c', '#e07b2e', '#c8433a', '#4c9a57', '#3b74c4', '#e8e8e4', '#a8adb2', '#5f6468'];
const RADII = [1, 1.5, 2.5, 4];
const XS = [0, 3, 8, 15];
let nextId = 1;
const wheelRows = (cols) => {
  const parts = [];
  cols.forEach((col, row) =>
    RADII.forEach((r, i) => parts.push({ id: nextId++, color: col, cells: [{ x: XS[i], y: -row * 9, z: 0, kind: i % 2 ? 'axleHole' : 'pinHole', axis: 2, rim: r }] })),
  );
  return { version: 2, parts, rootPartId: parts[0].id, nextPartId: nextId };
};
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

try {
  // ---------- colours × radii at Home, DPR 1 and 2
  for (const dpr of [1, 2]) {
    const { page, shot, errors } = await R.open(`rw-look-dpr${dpr}`, { deviceScaleFactor: dpr });
    for (const [k, cols] of [[0, COLS.slice(0, 4)], [1, COLS.slice(4)]]) {
      nextId = 1;
      await openModel(page, wheelRows(cols), `rw-colours-${k}.knap.json`);
      await page.keyboard.press('Home');
      await settle(page);
      await page.mouse.move(5, 700);
      await frames(page, 2);
      await shot(`rw-look-colours${k}-dpr${dpr}`);
    }
    F.check(errors.length === 0, `dpr ${dpr}: no console errors`);
    await page.context().close();
  }

  const { page, shot, errors } = await R.open('rw-look');
  const ev = (fn, a) => page.evaluate(fn, a);
  // ---------- a wheel touching a beam in its layer (gap 0.06), crank wheel, iso + zoom
  const touching = {
    version: 2,
    parts: [
      { id: 1, color: '#e0b43c', cells: [2, 3, 4, 5].map((x) => ({ x, y: 0, z: 0, kind: 'pinHole', axis: 2 })) },
      { id: 2, color: '#3b74c4', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2, rim: 1.5 }] },
      { id: 3, color: '#c8433a', cells: [{ x: 0, y: 3, z: 0, kind: 'pinHole', axis: 2, rim: 1.5 }] },
    ],
    rootPartId: 1,
    nextPartId: 4,
  };
  await openModel(page, touching, 'rw-touching.knap.json');
  await page.keyboard.press('Home');
  await settle(page);
  await page.mouse.move(5, 700);
  await shot('rw-look-touching');
  await ev(() => { window.__knap.setView('front'); window.__knap.fit(); });
  await frames(page, 2);
  await shot('rw-look-touching-front');
  // orbit shimmer: three 0.3° yaw steps, ink diff
  await ev(() => window.__knap.home());
  const cam = await ev(() => window.__knap.camera());
  F.note(`camera ${JSON.stringify(cam)}`);
  const shots = [];
  for (let k = 0; k < 3; k++) {
    await ev(([c, k]) => window.__knap.setCamera({ ...c, yaw: c.yaw + (k * 0.3 * Math.PI) / 180 }), [cam, k]);
    await frames(page, 2);
    shots.push(await page.screenshot({ clip: { x: 300, y: 150, width: 600, height: 450 } }));
  }
  const { PNG } = await import('pngjs').catch(() => ({ PNG: null }));
  if (PNG) {
    const imgs = shots.map((b) => PNG.sync.read(b));
    const ink = (im) => { let n = 0; for (let i = 0; i < im.data.length; i += 4) if (im.data[i] + im.data[i + 1] + im.data[i + 2] < 150) n++; return n; };
    F.note(`ink pixels under 0.3° yaw steps: ${imgs.map(ink).join(', ')}`);
  } else F.note('pngjs not available: ink count skipped');
  await page.mouse.move(5, 700);
  await ev((c) => window.__knap.setCamera({ ...c, height: c.height / 4 }), cam);
  await frames(page, 2);
  await shot('rw-look-touching-zoom');

  // ---------- ground on the Cart: Home / FRONT / TOP / BOTTOM, zooms
  await page.keyboard.press('Escape');
  const ex = async (name) => {
    const b = await page.locator('[data-action=examples]').boundingBox();
    await page.mouse.click(b.x + 5, b.y + 5);
    await frames(page, 1);
    const c = await page.locator(`[data-example=${name}]`).boundingBox();
    await page.mouse.click(c.x + 5, c.y + 5);
    await frames(page, 2);
    await settle(page);
  };
  await ex('cart');
  for (const v of ['front', 'top', 'bottom', 'left']) {
    await ev((v) => { window.__knap.setView(v); window.__knap.fit(); }, v);
    await page.mouse.move(5, 700);
    await frames(page, 2);
    await shot(`rw-look-cart-${v}`);
  }
  await ev(() => window.__knap.home());
  const c0 = await ev(() => window.__knap.camera());
  for (const [lbl, f] of [['far', 12], ['near', 0.08]]) {
    await ev(([c, f]) => window.__knap.setCamera({ ...c, height: c.height * f }), [c0, f]);
    await frames(page, 2);
    await shot(`rw-look-cart-zoom-${lbl}`);
  }
  // pan far away: tint reaches the edges?
  await ev((c) => window.__knap.setCamera({ ...c, target: [c.target[0] + 60, c.target[1], c.target[2] - 60] }), c0);
  await frames(page, 2);
  await shot('rw-look-cart-panned');
  await ev(() => window.__knap.home());
  await frames(page, 2);
  // idle: no redraws
  const r0 = (await state(page)).viewport.renders;
  const sh0 = (await ev(() => window.__knap.shadowInfo())).renders;
  await frames(page, 20);
  const r1 = (await state(page)).viewport.renders;
  F.check(r1 === r0, `idle with ground on: ${r1 - r0} renders over 20 rAF frames`);
  // orbit does not re-render the shadow
  await page.mouse.move(600, 600);
  await page.mouse.down();
  await page.mouse.move(640, 590, { steps: 4 });
  await page.mouse.up();
  await frames(page, 2);
  F.check((await ev(() => window.__knap.shadowInfo())).renders === sh0, `orbit: shadow renders ${sh0} → ${(await ev(() => window.__knap.shadowInfo())).renders}`);
  await ev(() => window.__knap.home());
  await frames(page, 2);
  // frame time: ground on vs off, same model and view (Cart; toggle with G)
  const timing = async () => median(await ev(() => window.__knap.renderTiming(15)));
  const on1 = await timing();
  await page.keyboard.press('g');
  await frames(page, 2);
  const off1 = await timing();
  await page.keyboard.press('g');
  await frames(page, 2);
  const on2 = await timing();
  await page.keyboard.press('g');
  await frames(page, 2);
  const off2 = await timing();
  F.note(`frame time (median of 15 synchronous renders, SwiftShader): ground on ${on1.toFixed(1)} / ${on2.toFixed(1)} ms, off ${off1.toFixed(1)} / ${off2.toFixed(1)} ms`);
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Meta+z');
  await frames(page, 2);
  F.note(`after undo ×3: ground ${(await state(page)).ground}`);
  // simulated frame cost: shadow lastMs while stepping
  await ev(() => window.__knap.stepSim(0));
  await ev(() => window.__knap.stepSim(240));
  await frames(page, 2);
  F.note(`shadow info while simulating: ${JSON.stringify(await ev(() => window.__knap.shadowInfo()))}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');

  // ---------- floor follows a wheel that grows below the old level
  await openModel(page, { version: 1, parts: [{ id: 1, color: '#e0b43c', cells: [0, 1, 2].map((x) => ({ x, y: 0, z: 0, kind: 'pinHole', axis: 2 })) }], rootPartId: 1, nextPartId: 2 }, 'rw-beam.knap.json');
  await page.keyboard.press('g');
  await frames(page, 1);
  const fy0 = (await ev(() => window.__knap.floor())).y;
  await page.keyboard.press('w');
  const p = await ev(() => window.__knap.clientPosOfCellFace(1, 1, 4));
  for (let k = 0; k < 4; k++) { await page.mouse.click(p.x, p.y); await frames(page, 1); }
  const fy1 = (await ev(() => window.__knap.floor())).y;
  F.check(fy1 < fy0 && Math.abs(fy1 - (-2.5 + 0.04)) < 1e-9, `floor follows the grown wheel: ${fy0} → ${fy1}`);
  await page.mouse.move(5, 700);
  await frames(page, 2);
  await shot('rw-look-beam-wheel-ground');
  await ev(() => { window.__knap.setView('front'); window.__knap.fit(); });
  await frames(page, 2);
  await shot('rw-look-beam-wheel-ground-front');
  F.check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} catch (e) {
  F.bad(`script error: ${e.stack}`);
} finally {
  await R.close();
  console.log(`\n${F.list.length} BAD`);
}
