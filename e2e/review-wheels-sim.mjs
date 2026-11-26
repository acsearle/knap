// Review (wheels UI): simulation through the UI — Cart and Crank wheel (Play/pause/step keys, speed,
// friction, Stop restores exactly), grab-and-drag the cart and a wheel with the mouse (stepSim between
// mouse moves), press a part into the floor, a cart that rolls out of view (can F / Home find it?), a
// fixed-root model with the ground on. Deterministic: stepSim(n) = n steps of 1/480 s.
import { frames, model, press, settle, state, status } from './app-lib.mjs';
import { reviewSetup, findings, canon } from './review-wheels-lib.mjs';
import { openModel } from './review-wheels-fixture.mjs';

const F = findings();
const R = await reviewSetup();
const { page, shot, errors } = await R.open('rw-sim');
const ev = (fn, a) => page.evaluate(fn, a);
async function loadExample(name) {
  await press(page, '[data-action=examples]');
  await press(page, `[data-example=${name}]`);
  await settle(page);
}
const T = () => ev(() => window.__knap.simTransforms());
const info = () => ev(() => window.__knap.simInfo());
/** Lowest world y over all hole cells' rims / cells of the model at the current sim pose (approx: cell centres − ½ or hub − r for axis ∥ horizontal). */
const lowest = () =>
  ev(() => {
    const m = window.__knap.getModel();
    const t = window.__knap.simTransforms();
    let lo = 1e9, who = null;
    const rot = (q, v) => {
      const [x, y, z, w] = q; const [vx, vy, vz] = v;
      const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
      return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
    };
    for (const p of m.parts) {
      const tr = t[p.id];
      if (!tr) continue;
      for (const c of p.cells) {
        const W = rot(tr.q, [c.x, c.y, c.z]);
        const y = W[1] + tr.p[1];
        if (c.rim) {
          const a = [0, 0, 0]; a[c.axis] = 1;
          const A = rot(tr.q, a);
          const low = y - c.rim * Math.sqrt(Math.max(0, 1 - A[1] * A[1])) - 0.5 * Math.abs(A[1]);
          if (low < lo) { lo = low; who = `part ${p.id} rim`; }
        } else if (y - 0.5 < lo) { lo = y - 0.5; who = `part ${p.id} cell`; }
      }
    }
    return { lo, who };
  });
const inView = (pid) =>
  ev((id) => {
    const p = window.__knap.partScreenPos(id);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return p && p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom ? p : null;
  }, pid);

try {
  // ---------------- Cart: keys and Stop
  await loadExample('cart');
  const m0 = await model(page);
  const cam0 = await ev(() => window.__knap.camera());
  await shot('rw-sim-cart-edit');
  await page.keyboard.press('.'); // starts paused, one step of 1/60 s
  await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
  let i0 = await info();
  F.note(`'.' → mode simulate paused=${i0.paused} t=${i0.time.toFixed(4)} groundY=${i0.groundY}`);
  const lo0 = await lowest();
  F.note(`lowest point at t0: ${lo0.lo.toFixed(4)} (${lo0.who}); floor ${i0.groundY}`);
  const chassisId = 1;
  const t0 = (await T())[chassisId];
  await ev(() => window.__knap.stepSim(960)); // 2 s
  const t2 = (await T())[chassisId];
  F.note(`cart chassis after 2 s: dx=${(t2.p[0] - t0.p[0]).toFixed(3)} dy=${(t2.p[1] - t0.p[1]).toFixed(4)} dz=${(t2.p[2] - t0.p[2]).toFixed(4)}`);
  await shot('rw-sim-cart-2s');
  // friction buttons during sim
  for (const lvl of ['Off', 'Low', 'Real']) {
    const sel = `[data-role=friction] button:has-text("${lvl}")`;
    await press(page, sel).catch((e) => F.bad(`friction ${lvl}: ${e.message}`));
    F.note(`friction ${lvl}: state ${(await state(page)).friction} sim μ ${(await info()).jointFriction}`);
  }
  // speed buttons
  const speeds = await page.locator('.speed button, [data-role=speed] button').count().catch(() => 0);
  F.note(`speed buttons: ${speeds}`);
  // Stop restores exactly; camera stays put
  const camSim = await ev(() => window.__knap.camera());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');
  await frames(page, 2);
  F.check(canon(await model(page)) === canon(m0), 'Stop: model exactly as before');
  F.check(canon(await ev(() => window.__knap.camera())) === canon(camSim), 'Stop: camera stays put');
  F.check((await ev(() => window.__knap.floor()))?.y === i0.groundY, `edit floor ${JSON.stringify(await ev(() => window.__knap.floor()))} == sim groundY ${i0.groundY}`);

  // ---------------- Cart: grab the chassis and drag (FRONT view), paused, stepping between moves
  await ev(() => { window.__knap.setView('front'); window.__knap.fit(); });
  await frames(page, 2);
  await ev(() => window.__knap.stepSim(0));
  await ev(() => window.__knap.stepSim(480)); // settle 1 s
  const cs = await ev(() => window.__knap.cellScreenPos(1, 0));
  const startT = (await T())[1];
  await page.mouse.move(cs.x, cs.y);
  await frames(page, 1);
  const hov = await status(page);
  F.note(`sim hover on chassis: "${hov.hover}" / "${hov.hint}"`);
  await page.mouse.down();
  let minLo = 1e9;
  for (let k = 1; k <= 20; k++) {
    await page.mouse.move(cs.x + k * 12, cs.y);
    await ev(() => window.__knap.stepSim(24));
    minLo = Math.min(minLo, (await lowest()).lo);
  }
  await shot('rw-sim-cart-drag-front');
  await page.mouse.up();
  await ev(() => window.__knap.stepSim(480));
  const endT = (await T())[1];
  F.note(`FRONT drag 240 px: chassis dx=${(endT.p[0] - startT.p[0]).toFixed(2)} dz=${(endT.p[2] - startT.p[2]).toFixed(3)}; deepest point ${(minLo - i0.groundY).toFixed(3)} vs floor`);
  // press the cart down into the floor
  const cs2 = await ev(() => window.__knap.cellScreenPos(1, 0));
  await page.mouse.move(cs2.x, cs2.y);
  await page.mouse.down();
  minLo = 1e9;
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(cs2.x, cs2.y + k * 30);
    await ev(() => window.__knap.stepSim(48));
    minLo = Math.min(minLo, (await lowest()).lo);
  }
  await shot('rw-sim-cart-press');
  await page.mouse.up();
  F.note(`pressing the chassis 300 px down: deepest point ${(minLo - i0.groundY).toFixed(3)} units vs floor`);
  // grab a wheel and drag it up: lifts the cart?
  const wheelPart = m0.parts.find((p) => p.cells.some((c) => c.rim))?.id;
  const wp = await ev((id) => window.__knap.partScreenPos(id), wheelPart);
  await page.mouse.move(wp.x, wp.y);
  await frames(page, 1);
  F.note(`hover on wheel part ${wheelPart}: "${(await status(page)).hint}"`);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) {
    await page.mouse.move(wp.x, wp.y - k * 15);
    await ev(() => window.__knap.stepSim(24));
  }
  await shot('rw-sim-cart-lift-wheel');
  await page.mouse.up();
  await ev(() => window.__knap.stepSim(960));
  await shot('rw-sim-cart-after-lift');
  F.note(`after lift: removed parts? ${JSON.stringify(Object.entries(await T()).filter(([, v]) => v === null).map(([k]) => k))} jointError ${(await info()).jointError}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');

  // ---------------- Cart rolls out of view
  await ev(() => window.__knap.home());
  await frames(page, 1);
  await ev(() => window.__knap.stepSim(0));
  await page.evaluate(() => { for (const p of window.__knap.getModel().parts) window.__knap.pushBody(p.id, [60, 0, 0]); });
  await ev(() => window.__knap.stepSim(1920)); // 4 s
  F.note(`after push 60 u/s 4 s: chassis at x=${(await T())[1].p[0].toFixed(1)}, in view: ${!!(await inView(1))}`);
  await shot('rw-sim-cart-gone');
  await page.keyboard.press('f');
  await settle(page);
  F.check(!!(await inView(1)), `F (Fit) while simulating brings the rolled-away cart back into view`);
  await shot('rw-sim-cart-fit');
  await page.keyboard.press('Home');
  await settle(page);
  F.note(`Home: cart in view ${!!(await inView(1))}`);
  await shot('rw-sim-cart-home');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');

  // ---------------- Crank wheel: Play, step, index mark frames
  await loadExample('crank-wheel');
  const cm0 = await model(page);
  await ev(() => window.__knap.stepSim(0));
  await shot('rw-sim-crank-t0');
  for (const t of [0.25, 0.5, 1, 2]) {
    const now = (await info()).time;
    await ev((n) => window.__knap.stepSim(n), Math.round((t - now) * 480));
    await shot(`rw-sim-crank-${t}s`);
  }
  // single step key and pause key
  const tb = (await info()).time;
  await page.keyboard.press('.');
  await frames(page, 1);
  F.note(`'.' while paused: t ${tb.toFixed(4)} → ${(await info()).time.toFixed(4)}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');
  F.check(canon(await model(page)) === canon(cm0), 'Crank wheel: Stop restores exactly');

  // ---------------- fixed root + ground: triple pendulum with G
  await loadExample('triple-pendulum');
  await page.keyboard.press('g');
  await frames(page, 1);
  await ev(() => window.__knap.stepSim(0));
  const gy = (await info()).groundY;
  await ev(() => window.__knap.stepSim(1440));
  const lo = await lowest();
  F.note(`triple pendulum + ground: floor ${gy}, lowest after 3 s ${lo.lo.toFixed(3)} (${lo.who}), removed ${JSON.stringify(Object.entries(await T()).filter(([, v]) => v === null).map(([k]) => k))}`);
  await shot('rw-sim-triple-ground');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');

  // ---------------- a hand-made cart (file), G + Fix root off by clicks, roll it with a drag in FRONT
  const C = (x, y, z, kind, rim) => (rim ? { x, y, z, kind, axis: 2, rim } : { x, y, z, kind, axis: 2 });
  const mine = {
    version: 1,
    parts: [
      { id: 1, color: '#5d6166', cells: [0, 1, 2, 3, 4].map((x) => C(x, 0, 0, 'pinHole')) },
      { id: 2, color: '#a3a6a9', cells: [C(0, 0, -1, 'axle'), C(0, 0, 0, 'axle'), C(0, 0, 1, 'axle')] },
      { id: 3, color: '#a3a6a9', cells: [C(4, 0, -1, 'axle'), C(4, 0, 0, 'axle'), C(4, 0, 1, 'axle')] },
      { id: 4, color: '#3a73c8', cells: [C(0, 0, 1, 'axleHole', 1.5)] },
      { id: 5, color: '#3a73c8', cells: [C(0, 0, -1, 'axleHole', 1.5)] },
      { id: 6, color: '#3a73c8', cells: [C(4, 0, 1, 'axleHole', 1.5)] },
      { id: 7, color: '#3a73c8', cells: [C(4, 0, -1, 'axleHole', 1.5)] },
    ],
    rootPartId: 1,
    nextPartId: 8,
  };
  mine.version = 2;
  await openModel(page, mine, 'rw-mycart.knap.json');
  F.note(`my cart opened: "${(await status(page)).message}" counts "${(await status(page)).counts}"`);
  const gb = await page.locator('[data-action=ground]').boundingBox();
  await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2);
  const fb = await page.locator('[data-action=fix-root]').boundingBox();
  await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await frames(page, 1);
  F.note(`after clicks: ground=${(await state(page)).ground} fixRoot=${(await state(page)).fixRoot} counts "${(await status(page)).counts}"`);
  await shot('rw-sim-mycart-edit');
  await ev(() => { window.__knap.setView('front'); window.__knap.fit(); });
  await ev(() => window.__knap.stepSim(0));
  await ev(() => window.__knap.stepSim(240));
  const mc = await ev(() => window.__knap.cellScreenPos(1, 2));
  const mt0 = (await T())[1];
  await page.mouse.move(mc.x, mc.y);
  await page.mouse.down();
  for (let k = 1; k <= 15; k++) {
    await page.mouse.move(mc.x - k * 15, mc.y);
    await ev(() => window.__knap.stepSim(24));
  }
  await page.mouse.up();
  await ev(() => window.__knap.stepSim(480));
  const mt1 = (await T())[1];
  const wq = (await T())[4].q;
  F.note(`my cart dragged 225 px left: dx=${(mt1.p[0] - mt0.p[0]).toFixed(2)} dy=${(mt1.p[1] - mt0.p[1]).toFixed(4)}; wheel 4 quaternion ${wq.map((v) => v.toFixed(3))}`);
  await shot('rw-sim-mycart-after');
  await page.keyboard.press('Escape');
  F.check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} catch (e) {
  F.bad(`script error: ${e.stack}`);
  await shot('rw-sim-error').catch(() => {});
} finally {
  await R.close();
  console.log(`\n${F.list.length} BAD`);
}
