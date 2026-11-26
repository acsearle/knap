// Reviewer "ux2": the ground's contact shadow (DESIGN §6.1). Run:
//   E2E_DIST=e2e/out/review-ux2-dist node e2e/review-ux2-shadow.mjs
// Writes e2e/out/review-ux2-shadow.json (poses + groundShadowAt samples, read by the CPU truth check
// in tests/review/ux2.review.test.ts) and screenshots e2e/out/review-ux2-sh-*.png.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR, launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp, press } from './app-lib.mjs';

const C = (x, y, z, kind = 'pinHole', axis = 2, rim) => ({ x, y, z, kind, axis, ...(rim ? { rim } : {}) });
const beamX = (n, y = 0, z = 0, x0 = 0) => Array.from({ length: n }, (_, i) => C(x0 + i, y, z));
const M = (parts, extra = {}) => ({ version: 1, rootPartId: null, nextPartId: parts.length + 1, ground: true, fixRoot: false, ...extra, parts: parts.map((p, i) => ({ id: i + 1, color: p.color ?? '#a8adb2', cells: p.cells ?? p })) });
const PAL = ['#e0b43c', '#e07b2e', '#c8433a', '#4c9a57', '#3b74c4', '#e8e8e4', '#a8adb2', '#5f6468'];
const qAxis = (ax, deg) => { const h = (deg * Math.PI) / 360; const s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };

const K = (page, fn, arg) => page.evaluate(fn, arg);
const shadowAt = (page, x, z) => K(page, ([x, z]) => window.__knap.groundShadowAt(x, z), [x, z]);
const info = (page) => K(page, () => window.__knap.shadowInfo());
const renders = (page) => K(page, () => window.__knap.getState().viewport.shadowRenders);
const log = (...a) => console.log(...a);
const out = { poses: [], checks: [] };
const check = (label, ok, extra = '') => { out.checks.push({ label, ok, extra }); log(`${ok ? 'ok  ' : 'FAIL'} ${label} ${extra}`); };

const server = await startServer();
const browser = await launchBrowser();
try {
  const ctx = await openPage(browser, server.url, 'ux2-shadow');
  const { page } = ctx;
  await openApp(page, server.url);
  const shot = (n) => ctx.shot(`review-ux2-sh-${n}`);

  /** Record a pose: model, transforms (view-only or simulated), floor, frame and samples on a grid. */
  async function record(label, xs, zs, transforms = null) {
    const m = await K(page, () => window.__knap.getModel());
    const floor = await K(page, () => window.__knap.floor());
    const samples = [];
    for (const x of xs) for (const z of zs) samples.push([x, z, await shadowAt(page, x, z)]);
    const inf = await info(page);
    out.poses.push({ label, model: m, transforms, floorY: floor?.y ?? null, frame: inf.frame, samples });
    return samples;
  }
  const range = (a, b, s) => { const r = []; for (let v = a; v <= b + 1e-9; v += s) r.push(+v.toFixed(4)); return r; };

  // ---- 1. poses for the CPU truth check (≥ 20)
  const beamFloor = M([beamX(7)]);
  await K(page, (m) => window.__knap.setModel(m), beamFloor);
  await K(page, () => window.__knap.home());
  for (const h of [0, 0.5, 1, 1.5, 2.25]) {
    await K(page, (h) => window.__knap.setPartTransform(1, [0, h, 0]), h);
    await record(`beam lifted ${h}`, range(-1.5, 7.5, 0.75), range(-1.5, 1.5, 0.5), { 1: { p: [0, h, 0], q: [0, 0, 0, 1] } });
  }
  for (const [ax, deg, p] of [[[0, 1, 0], 30, [1, 0, 0.5]], [[0, 0, 1], 12, [0, 0.3, 0]], [[1, 0, 0], 40, [0, 0.4, 0]], [[0.6, 0.8, 0], 25, [0.3, 0.6, -0.2]]]) {
    const q = qAxis(ax, deg);
    await K(page, ([q, p]) => window.__knap.setPartTransform(1, p, q), [q, p]);
    await record(`beam rot ${ax}/${deg}`, range(-2, 8, 0.8), range(-3, 4, 0.7), { 1: { p, q } });
  }
  await K(page, () => window.__knap.clearTransforms());
  // single wheel, beam-on-floor next to a lifted loose beam
  await K(page, (m) => window.__knap.setModel(m), M([[C(0, 0, 0, 'pinHole', 2, 2.5)]]));
  await record('wheel r2.5 edit', range(-3.5, 3.5, 0.5), range(-1.5, 1.5, 0.5));
  // examples (edit and simulated)
  for (const ex of ['cart', 'crank-wheel', 'pendulum', 'four-bar', 'collision', 'triple-pendulum']) {
    await K(page, (n) => window.__knap.loadExample(n), ex);
    await K(page, () => window.__knap.setGround(true));
    const fl = await K(page, () => window.__knap.floor());
    const inf = await info(page);
    const f = inf.frame;
    const xs = f ? range(f.x0 + 1, f.x0 + f.w - 1, Math.max(0.5, (f.w - 2) / 14)) : [0];
    const zs = f ? range(f.z0 + 1, f.z0 + f.d - 1, Math.max(0.5, (f.d - 2) / 8)) : [0];
    await record(`${ex} edit`, xs, zs);
    await K(page, () => window.__knap.stepSim(0));
    if (ex === 'cart') await K(page, () => { for (const p of window.__knap.getModel().parts) window.__knap.pushBody(p.id, [20, 0, 0]); });
    if (ex === 'collision' || ex === 'pendulum') await K(page, () => { for (const p of window.__knap.getModel().parts) window.__knap.pushBody(p.id, [5, 6, 3], [3, 1, 2]); });
    for (const n of [120, 360]) {
      await K(page, (n) => window.__knap.stepSim(n), n);
      const tr = await K(page, () => window.__knap.simTransforms());
      const inf2 = await info(page);
      const f2 = inf2.frame;
      const xs2 = f2 ? range(f2.x0 + 1, f2.x0 + f2.w - 1, Math.max(0.5, (f2.w - 2) / 14)) : [0];
      const zs2 = f2 ? range(f2.z0 + 1, f2.z0 + f2.d - 1, Math.max(0.5, (f2.d - 2) / 8)) : [0];
      await record(`${ex} sim +${n}`, xs2, zs2, tr);
    }
    log(`pose ${ex}: floor ${fl?.y}`);
    await K(page, () => window.__knap.setMode('edit'));
  }
  log(`recorded ${out.poses.length} poses, ${out.poses.reduce((a, p) => a + p.samples.length, 0)} samples`);

  // ---- 2. monotone fade and frame-size independence
  await K(page, (m) => window.__knap.setModel(m), beamFloor);
  const fade = [];
  for (let h = 0; h <= 3.3; h += 0.125) {
    await K(page, (h) => window.__knap.setPartTransform(1, [0, h, 0]), h);
    fade.push([+h.toFixed(3), await shadowAt(page, 3, 0)]);
  }
  check('fade is monotone with height and 0 at ≥ SHADOW_H', fade.every((v, i) => i === 0 || v[1] <= fade[i - 1][1] + 1e-3) && fade.filter((v) => v[0] >= 3.05).every((v) => v[1] < 0.005), JSON.stringify(fade.map((v) => v[1].toFixed(3))));
  await K(page, () => window.__knap.clearTransforms());
  const ref8 = [];
  for (const x of [-0.75, -0.5, 0, 3, 6.5, 6.9]) ref8.push(await shadowAt(page, x, 0.6));
  const fr8 = (await info(page)).frame;
  const sizes = [];
  for (const far of [12, 30, 60, 110]) {
    await K(page, ([m, far]) => window.__knap.setModel({ ...m, parts: [...m.parts, { id: 2, color: '#a8adb2', cells: [{ x: far, y: 0, z: 0, kind: 'pinHole', axis: 2 }] }], nextPartId: 3 }), [beamFloor, far]);
    const v = [];
    for (const x of [-0.75, -0.5, 0, 3, 6.5, 6.9]) v.push(await shadowAt(page, x, 0.6));
    const fr = (await info(page)).frame;
    sizes.push({ far, frame: fr, maxDiff: Math.max(...v.map((q, i) => Math.abs(q - ref8[i]))) });
  }
  check('shadow independent of frame size (8 → 128)', sizes.every((s) => s.maxDiff < 0.01), JSON.stringify({ fr8, sizes }));
  // camera independence: same value at different zooms
  const z1 = await shadowAt(page, 3, 0.6);
  await K(page, () => { const c = window.__knap.camera(); window.__knap.setCamera({ ...c, height: c.height * 6 }); });
  const z2 = await shadowAt(page, 3, 0.6);
  check('zoom does not change the shadow', Math.abs(z1 - z2) < 1e-6, `${z1} ${z2}`);

  // ---- 3. two models far apart (beyond SHADOW_MAX_EXTENT)
  for (const far of [100, 130, 200]) {
    await K(page, (far) => window.__knap.setModel({ version: 1, rootPartId: null, nextPartId: 3, ground: true, fixRoot: false, parts: [
      { id: 1, color: '#a8adb2', cells: Array.from({ length: 5 }, (_, i) => ({ x: i, y: 0, z: 0, kind: 'pinHole', axis: 2 })) },
      { id: 2, color: '#a8adb2', cells: Array.from({ length: 5 }, (_, i) => ({ x: far + i, y: 0, z: 0, kind: 'pinHole', axis: 2 })) }] }), far);
    const a = await shadowAt(page, 2, 0);
    const b = await shadowAt(page, far + 2, 0);
    const f = (await info(page)).frame;
    check(`two beams ${far} apart: both shadowed`, a > 0.5 && b > 0.5, `near ${a.toFixed(3)} far ${b.toFixed(3)} frame ${JSON.stringify(f)}`);
  }

  // ---- 4. hidden part
  await K(page, (m) => window.__knap.setModel(m), beamFloor);
  const vis = await shadowAt(page, 3, 0);
  await K(page, () => window.__knap.setPartVisible(1, false));
  const hid = await shadowAt(page, 3, 0);
  await K(page, () => window.__knap.setPartVisible(1, true));
  const back = await shadowAt(page, 3, 0);
  check('hidden part casts none', hid < 0.005 && Math.abs(back - vis) < 1e-6, `${vis} ${hid} ${back}`);

  // ---- 5. rolling the Cart 300 units (view-only translation, 0.37 per step) with the camera fixed
  await K(page, () => window.__knap.loadExample('cart'));
  await K(page, () => window.__knap.setGround(true));
  await K(page, () => window.__knap.home());
  const cm = await K(page, () => window.__knap.getModel());
  const ids = cm.parts.map((p) => p.id);
  const wheelHubs = cm.parts.flatMap((p) => p.cells.filter((c) => c.rim).map((c) => [c.x, c.z, c.rim]));
  const fl = (await K(page, () => window.__knap.floor())).y;
  // points fixed to the cart: under each wheel's contact line + chassis centre
  const pts = [...wheelHubs.map(([x, z]) => [x, z]), [wheelHubs.reduce((a, w) => a + w[0], 0) / wheelHubs.length, wheelHubs.reduce((a, w) => a + w[1], 0) / wheelHubs.length]];
  const base = [];
  for (const [x, z] of pts) base.push(await shadowAt(page, x, z));
  let worst = 0, worstStep = 0, prev = base, frameChanges = 0, lastFrame = JSON.stringify((await info(page)).frame), jumpAtChange = 0;
  const STEP = 0.37;
  for (let k = 1; k * STEP <= 300; k++) {
    const dx = k * STEP;
    await K(page, ([ids, dx]) => { for (const id of ids) window.__knap.setPartTransform(id, [dx, 0, 0]); }, [ids, dx]);
    const v = [];
    for (const [x, z] of pts) v.push(await shadowAt(page, x + dx, z));
    const f = JSON.stringify((await info(page)).frame);
    const d0 = Math.max(...v.map((q, i) => Math.abs(q - base[i])));
    const d1 = Math.max(...v.map((q, i) => Math.abs(q - prev[i])));
    worst = Math.max(worst, d0);
    worstStep = Math.max(worstStep, d1);
    if (f !== lastFrame) { frameChanges++; jumpAtChange = Math.max(jumpAtChange, d1); lastFrame = f; }
    prev = v;
    if (k % 270 === 0) { await K(page, () => window.__knap.fit()); await frames(page, 2); await shot(`roll-${Math.round(dx)}`); }
  }
  check('Cart rolled 300 units: shadow travels with it (worst |Δ| from start, step to step, at frame changes)', worst < 0.03, `worst ${worst.toFixed(4)} step ${worstStep.toFixed(4)} frame changes ${frameChanges} jump at change ${jumpAtChange.toFixed(4)}; base ${base.map((b) => b.toFixed(3))}`);
  await K(page, () => window.__knap.clearTransforms());

  // ---- 6. render counter: orbit / pan / zoom / resize / idle
  await K(page, () => window.__knap.home());
  await frames(page, 3);
  const r0 = await renders(page);
  const cv = await page.locator('canvas').first().boundingBox();
  const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
  await page.mouse.move(cx + 300, cy + 200);
  await page.mouse.down({ button: 'right' });
  for (let i = 0; i < 10; i++) { await page.mouse.move(cx + 300 + i * 8, cy + 200 + i * 3); await frames(page, 1); }
  await page.mouse.up({ button: 'right' });
  await page.mouse.move(cx + 350, cy + 250);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, i % 2 ? 120 : -120); await frames(page, 1); }
  await page.setViewportSize({ width: 1100, height: 700 });
  await frames(page, 3);
  await page.setViewportSize({ width: 1280, height: 720 });
  await frames(page, 3);
  await K(page, () => window.__knap.setView('top'));
  await frames(page, 3);
  await K(page, () => window.__knap.home());
  await frames(page, 10);
  const r1 = await renders(page);
  check('orbit / pan / zoom / resize / view snap / idle: no shadow re-render', r1 === r0, `${r0} -> ${r1}`);
  await K(page, () => window.__knap.stepSim(0));
  const r2 = await renders(page);
  await frames(page, 10);
  const r3 = await renders(page);
  await K(page, () => window.__knap.stepSim(1));
  await frames(page, 2);
  const r4 = await renders(page);
  check('paused sim idle: none; one step: ≥1', r3 === r2 && r4 > r3, `${r2} ${r3} ${r4}`);
  await K(page, () => window.__knap.setMode('edit'));

  // ---- 7. Fit bounds unchanged by the floor
  await K(page, () => window.__knap.setGround(false));
  await K(page, () => window.__knap.fit());
  const camOff = await K(page, () => window.__knap.camera());
  await K(page, () => window.__knap.setGround(true));
  await K(page, () => window.__knap.fit());
  const camOn = await K(page, () => window.__knap.camera());
  check('Fit is the same with the ground on and off', JSON.stringify(camOff) === JSON.stringify(camOn), `${JSON.stringify(camOff)} vs ${JSON.stringify(camOn)}`);

  // ---- 8. resources
  const mem0 = await K(page, () => window.__knap.glMemory());
  for (let i = 0; i < 100; i++) await K(page, (on) => window.__knap.setGround(on), i % 2 === 1);
  const mem1 = await K(page, () => window.__knap.glMemory());
  for (const ex of ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision', 'crank-wheel', 'cart']) {
    await K(page, (n) => window.__knap.loadExample(n), ex);
    await K(page, () => window.__knap.setGround(true));
    await frames(page, 1);
  }
  await K(page, () => window.__knap.loadExample('cart'));
  await K(page, () => window.__knap.setGround(true));
  await frames(page, 2);
  const mem2 = await K(page, () => window.__knap.glMemory());
  check('GL resources return to baseline (ground ×100, every example)', JSON.stringify(mem0) === JSON.stringify(mem1) && JSON.stringify(mem1) === JSON.stringify(mem2), `${JSON.stringify(mem0)} ${JSON.stringify(mem1)} ${JSON.stringify(mem2)}`);

  // ---- 9. context loss
  await K(page, () => window.__knap.home());
  await frames(page, 2);
  const wheel = wheelHubs[0];
  const sBefore = await shadowAt(page, wheel[0], wheel[1]);
  await shot('ctx-before');
  const lost = await K(page, async () => {
    const c = document.querySelector('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 800));
    return true;
  });
  ctx.errors.length = 0;
  await frames(page, 4);
  const sAfter = await shadowAt(page, wheel[0], wheel[1]);
  await shot('ctx-after');
  check('context loss + restore: shadow comes back', !lost || Math.abs(sAfter - sBefore) < 0.02, `lost=${lost} before ${sBefore} after ${sAfter}`);

  await writeFile(join(OUT_DIR, 'review-ux2-shadow.json'), JSON.stringify(out));
  await ctx.close();

  // ---- 10. look: screenshots
  for (const dpr of [1, 2]) {
    const c2 = await openPage(browser, server.url, 'ux2-look', { deviceScaleFactor: dpr });
    const p = c2.page;
    await openApp(p, server.url);
    const S = (n) => c2.shot(`review-ux2-sh-${n}-dpr${dpr}`);
    const KK = (fn, a) => p.evaluate(fn, a);
    await KK(() => window.__knap.loadExample('cart'));
    await KK(() => window.__knap.setGround(true));
    await KK(() => window.__knap.home());
    await frames(p, 3);
    await S('cart-home-edit');
    if (dpr === 1) {
      await KK(() => window.__knap.stepSim(0));
      await frames(p, 3);
      await S('cart-home-sim');
      for (const v of ['top', 'front', 'bottom']) { await KK((v) => window.__knap.setView(v), v); await frames(p, 3); await S(`cart-${v}`); }
      await KK(() => { window.__knap.home(); const c = window.__knap.camera(); window.__knap.setCamera({ ...c, pitch: 0.14 }); });
      await frames(p, 3);
      await S('cart-grazing8');
      await KK(() => { window.__knap.home(); const c = window.__knap.camera(); window.__knap.setCamera({ ...c, height: 1.2, target: [c.target[0], c.target[1] - 1, c.target[2]] }); });
      await frames(p, 3);
      await S('cart-zoomin');
      await KK(() => { window.__knap.home(); const c = window.__knap.camera(); window.__knap.setCamera({ ...c, height: 60 }); });
      await frames(p, 3);
      await S('cart-zoomout');
      await KK(() => window.__knap.setMode('edit'));
      // palette beams on the floor + ghost / highlight over the shadow
      await KK((PAL) => window.__knap.setModel({ version: 1, rootPartId: null, nextPartId: 9, ground: true, fixRoot: false, parts: PAL.map((col, i) => ({ id: i + 1, color: col, cells: Array.from({ length: 5 }, (_, k) => ({ x: k, y: 0, z: i * 2, kind: 'pinHole', axis: 1 })) })) }), PAL);
      await KK(() => window.__knap.home());
      await frames(p, 3);
      await S('palette');
      await press(p, '[data-tool=pinHole]');
      const fp = await KK(() => window.__knap.clientPosOfCellFace(5, 2, 0));
      if (fp) { await p.mouse.move(fp.x, fp.y, { steps: 2 }); await frames(p, 2); await S('palette-ghost'); }
      // empty model with ground
      await KK(() => window.__knap.setModel({ version: 1, rootPartId: null, nextPartId: 1, ground: true, fixRoot: false, parts: [] }));
      await frames(p, 3);
      await S('empty-ground');
      // pendulum high above floor: fixed root, link reaching the floor
      await KK(() => window.__knap.loadExample('triple-pendulum'));
      await KK(() => { window.__knap.setGround(true); window.__knap.setFixRoot(true); window.__knap.fit(); });
      await frames(p, 3);
      await S('triple-pendulum-ground');
      await KK(() => window.__knap.loadExample('pendulum'));
      await KK(() => { window.__knap.setGround(true); window.__knap.setFixRoot(true); window.__knap.fit(); });
      await frames(p, 3);
      await S('pendulum-ground');
      const pinf = await KK(() => window.__knap.shadowInfo());
      log('pendulum shadow frame', JSON.stringify(pinf.frame), 'floor', JSON.stringify(await KK(() => window.__knap.floor())));
      await KK(() => window.__knap.loadExample('crank-wheel'));
      await KK(() => { window.__knap.setGround(true); window.__knap.fit(); });
      await frames(p, 3);
      await S('crank-wheel-ground');
      // single wheel
      await KK(() => window.__knap.setModel({ version: 1, rootPartId: null, nextPartId: 2, ground: true, fixRoot: false, parts: [{ id: 1, color: '#3b74c4', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2, rim: 2.5 }] }] }));
      await KK(() => window.__knap.home());
      await frames(p, 3);
      await S('wheel');
    }
    await c2.close();
  }
} finally {
  await browser.close();
  await server.close();
}
