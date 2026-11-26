// Owner-style play through the real UI: build a cart from nothing, ground on, root free, Play, grab
// the chassis with the mouse and drag it; then a wheel on a pin of a fixed upright, spun by its rim.
// Drags happen with the simulation paused and stepped by the hook between mouse moves (deterministic
// pacing); one drag runs in real time for the feel. Screenshots: e2e/out/owner-*.png.
// Exploration, not a pass/fail test: it prints measurements. Run: node e2e/owner-play.mjs (serves dist/,
// or $E2E_DIST; build first). ONLY=front|iso|lift runs one cart drag and stops.
const R = './';
const { startServer, launchBrowser, openPage } = await import(R + 'lib.mjs');
const L = await import(R + 'app-lib.mjs');
const { openApp, press, frames, clickAt, clickFace, gridPos, hover, model, state, status, settle, applyT, dist } = L;
const server = await startServer();
const browser = await launchBrowser();
const ctx = await openPage(browser, server.url, 'owner');
const { page, shot } = ctx;
const log = (...a) => console.log('  [owner]', ...a);
const ev = (fn, arg) => page.evaluate(fn, arg);
const partOf = (m, id) => m.parts.find((p) => p.id === id);
const idxAt = (m, id, pos) => partOf(m, id).cells.findIndex((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);
const facePt = async (id, pos, dir) => {
  const m = await model(page);
  const p = await ev(([a, b, d]) => window.__knap.clientPosOfCellFace(a, b, d), [id, idxAt(m, id, pos), dir]);
  if (!p) throw new Error(`face ${dir} of part ${id} at ${pos} not clickable`);
  return p;
};
const altClick = async (p) => {
  await hover(page, p);
  await page.keyboard.down('Alt');
  await frames(page, 1);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await frames(page, 1);
};
const hint = async () => (await status(page)).hint;

try {
  await openApp(page, ctx.url);
  await press(page, '[data-action=new]');

  // ---- build the cart ------------------------------------------------------------------------
  await page.keyboard.press('1');
  await clickAt(page, await gridPos(page, 0, 0));
  for (let x = 0; x < 6; x++) await clickFace(page, 1, [x, 0, 0], 0);
  let m = await model(page);
  log('beam:', partOf(m, 1).cells.length, 'cells, axis', partOf(m, 1).cells[0].axis);
  await page.keyboard.press('Home');
  await settle(page);
  // axles: insert at x = 0 and 6, extend +Z, Alt-click the far end
  for (const x of [0, 6]) {
    await page.keyboard.press('3');
    await hover(page, await facePt(1, [x, 0, 0], 4));
    log('axle hover:', await hint());
    await clickAt(page, await facePt(1, [x, 0, 0], 4));
    m = await model(page);
    const ax = m.parts[m.parts.length - 1].id;
    await clickFace(page, ax, [x, 0, 0], 4);
    await altClick(await facePt(ax, [x, 0, 1], 4));
    m = await model(page);
    log(`axle part ${ax}:`, JSON.stringify(partOf(m, ax).cells.map((c) => [c.x, c.y, c.z, c.kind])));
    // axle-hole hubs on both ends
    await page.keyboard.press('2');
    const end = await facePt(ax, [x, 0, 1], 4);
    await hover(page, end);
    log('sleeve hover:', await hint());
    await clickAt(page, end);
    await altClick(end);
  }
  m = await model(page);
  log('parts:', m.parts.map((p) => `${p.id}:${p.cells.map((c) => `${c.kind}@${c.x},${c.y},${c.z}`).join('+')}`).join('  '));
  const hubs = m.parts.filter((p) => p.cells.length === 1 && p.cells[0].kind === 'axleHole').map((p) => ({ id: p.id, pos: [p.cells[0].x, p.cells[0].y, p.cells[0].z] }));
  log('hubs:', JSON.stringify(hubs));
  // grow the wheels: front ones from the default view, back ones from BACK
  await page.keyboard.press('w');
  for (const h of hubs.filter((q) => q.pos[2] > 0)) for (let k = 0; k < 2; k++) await clickAt(page, await facePt(h.id, h.pos, 4));
  await ev(() => { window.__knap.setView('back'); window.__knap.fit(); });
  await frames(page, 2);
  for (const h of hubs.filter((q) => q.pos[2] < 0)) for (let k = 0; k < 2; k++) await clickAt(page, await facePt(h.id, h.pos, 5));
  await page.keyboard.press('Home');
  await settle(page);
  m = await model(page);
  log('rims:', JSON.stringify(m.parts.flatMap((p) => p.cells.filter((c) => c.rim).map((c) => [p.id, c.z, c.rim]))));
  await page.mouse.move(1, 360);
  await frames(page, 2);
  await shot('owner-cart-built');
  // ground on, root free (through the Model block)
  await page.keyboard.press('g');
  await press(page, '[data-action=fix-root]');
  log('state:', JSON.stringify((({ ground, fixRoot, rootFixed }) => ({ ground, fixRoot, rootFixed }))(await state(page))), 'counts:', (await status(page)).counts);
  const an = await ev(() => window.__knap.analyze());
  log('analysis:', an.summary);
  await page.mouse.move(1, 360);
  await frames(page, 2);
  await shot('owner-cart-ground');
  const cartModel = await model(page);

  // ---- play, grab the chassis, drag it (paused + stepped) --------------------------------------
  const runDrag = async (label, view, worldDelta, steps = 40, perMove = 24) => {
    await ev((mm) => window.__knap.setModel(mm), cartModel);
    await ev((v) => { window.__knap.setView(v); window.__knap.fit(); }, view);
    await frames(page, 2);
    await ev(() => window.__knap.stepSim(0));
    const groundY = (await ev(() => window.__knap.simInfo())).groundY;
    await ev(() => window.__knap.stepSim(240)); // settle 0.5 s
    // grab the chassis at the top of its middle cell (3, 0, 0)
    const gp = view === 'front' ? [3, 0.2, 0.5] : [3, 0.5, 0];
    const s0 = await ev((p) => window.__knap.screenPos(p), gp);
    const s1 = await ev((p) => window.__knap.screenPos(p), [gp[0] + worldDelta[0], gp[1] + worldDelta[1], gp[2] + worldDelta[2]]);
    await page.mouse.move(s0.x, s0.y);
    await frames(page, 1);
    await page.mouse.down();
    await frames(page, 1);
    await page.mouse.move(s0.x + 3 * Math.sign(s1.x - s0.x || 1), s0.y + 3 * Math.sign(s1.y - s0.y));
    await page.mouse.move(s0.x, s0.y);
    await frames(page, 1);
    const grabbed = (await ev(() => window.__knap.simInfo())).grabbed;
    const tr0 = await ev(() => window.__knap.simTransforms());
    const chassis0 = applyT(tr0[1], [3, 0, 0]);
    let minY = Infinity;
    let maxTilt = 0;
    const lowPts = (tr) => {
      // lowest point of every cell cube / wheel disc under its body's rotation
      let lo = Infinity;
      for (const p of cartModel.parts) {
        const t = tr[p.id];
        const ax = (k) => { const e = [0, 0, 0]; e[k] = 1; const o = applyT({ p: [0, 0, 0], q: t.q }, e); return o; };
        const ex = [ax(0), ax(1), ax(2)];
        for (const c of p.cells) {
          const w = applyT(t, [c.x, c.y, c.z]);
          if (c.rim) {
            const ay = Math.abs(ex[c.axis][1]);
            lo = Math.min(lo, w[1] - c.rim * Math.sqrt(Math.max(0, 1 - ay * ay)) - 0.5 * ay);
          } else lo = Math.min(lo, w[1] - 0.5 * (Math.abs(ex[0][1]) + Math.abs(ex[1][1]) + Math.abs(ex[2][1])));
        }
      }
      return lo;
    };
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      await page.mouse.move(s0.x + (s1.x - s0.x) * f, s0.y + (s1.y - s0.y) * f);
      await ev((n) => window.__knap.stepSim(n), perMove);
      const tr = await ev(() => window.__knap.simTransforms());
      minY = Math.min(minY, lowPts(tr));
      const q = tr[1].q;
      maxTilt = Math.max(maxTilt, 2 * Math.asin(Math.min(1, Math.hypot(q[0], q[2]))));
      if (i === steps / 2) { await frames(page, 2); await shot(`owner-${label}-drag`); }
    }
    const trA = await ev(() => window.__knap.simTransforms());
    const chassisA = applyT(trA[1], [3, 0, 0]);
    await page.mouse.up();
    await frames(page, 1);
    // after release: coast / settle 3 s, sample
    const samples = [];
    for (let i = 0; i < 30; i++) {
      await ev(() => window.__knap.stepSim(48));
      const tr = await ev(() => window.__knap.simTransforms());
      minY = Math.min(minY, lowPts(tr));
      samples.push(applyT(tr[1], [3, 0, 0]));
    }
    const trB = await ev(() => window.__knap.simTransforms());
    const chassisB = applyT(trB[1], [3, 0, 0]);
    // wheel rotation vs travel: body of the first front hub
    const hubId = hubs[0].id;
    const wq = trB[hubId].q;
    const wheelAngle = 2 * Math.atan2(wq[2], wq[3]);
    // jitter: last 10 samples (1 s) spread
    const last = samples.slice(-10);
    const spread = Math.max(...last.map((p) => dist(p, last[0])));
    const info = await ev(() => window.__knap.simInfo());
    log(`${label}: grabbed body ${grabbed}; chassis ${chassis0.map((v) => v.toFixed(2))} → ${chassisA.map((v) => v.toFixed(2))} at release → ${chassisB.map((v) => v.toFixed(2))} 3 s later; wheel ${hubId} turned ${((wheelAngle * 180) / Math.PI).toFixed(0)}° net (pure rolling over Δx ${(chassisB[0] - chassis0[0]).toFixed(2)} would be ${((-(chassisB[0] - chassis0[0]) / 1.46) * 180 / Math.PI).toFixed(0)}° mod 360); lowest point ${(minY - groundY).toFixed(3)} rel. floor; chassis tilt max ${maxTilt.toFixed(3)} rad, final ${(2 * Math.asin(Math.min(1, Math.hypot(trB[1].q[0], trB[1].q[2])))).toFixed(3)} rad; last-second spread ${spread.toExponential(1)}; jointError ${info.jointError.toExponential(1)}; t ${info.time.toFixed(2)}`);
    await frames(page, 2);
    await shot(`owner-${label}-after`);
    await page.keyboard.press('Escape');
    await frames(page, 1);
  };
  const only = process.env.ONLY;
  if (!only || only === 'front') await runDrag('cart-front', 'front', [8, 0, 0]);
  if (!only || only === 'iso') await runDrag('cart-iso', 'home', [8, 0, 0]);
  if (!only || only === 'iso') await runDrag('cart-iso-fast', 'home', [10, 0, 0], 10, 24);
  if (!only || only === 'lift') await runDrag('cart-lift', 'front', [3, 4, 0]);
  if (only) throw new Error('ONLY: done');

  // ---- real-time drag for the feel ---------------------------------------------------------------
  {
    await ev((mm) => window.__knap.setModel(mm), cartModel);
    await ev(() => { window.__knap.setView('front'); window.__knap.fit(); });
    await frames(page, 2);
    await press(page, '[data-action=play]');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    const s0 = await ev((p) => window.__knap.screenPos(p), [3, 0.2, 0.5]);
    const s1 = await ev((p) => window.__knap.screenPos(p), [9, 0.2, 0.5]);
    await page.mouse.move(s0.x, s0.y);
    await page.mouse.down();
    const tA = (await ev(() => window.__knap.simInfo())).time;
    const w0 = Date.now();
    let gb = null;
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(s0.x + ((s1.x - s0.x) * i) / 20, s0.y);
      await frames(page, 1);
      gb ??= (await ev(() => window.__knap.simInfo())).grabbed;
    }
    await page.mouse.up();
    const tB = (await ev(() => window.__knap.simInfo())).time;
    const st = await state(page);
    log(`real-time drag: ${((Date.now() - w0) / 1000).toFixed(1)} s wall for ${(tB - tA).toFixed(3)} s simulated at speed ${st.speed} (slow badge ${st.slow}); grabbed ${gb}; chassis x now ${(await ev(() => window.__knap.simTransforms()))[1].p[0].toFixed(2)} (moved)`);
    await frames(page, 3);
    await shot('owner-cart-realtime');
    await press(page, '[data-action=stop]');
  }

  // ---- fixed root: a wheel on a pin of a fixed upright, spun by its rim --------------------------
  await press(page, '[data-action=new]');
  await page.keyboard.press('1');
  await clickAt(page, await gridPos(page, 0, 0));
  for (let y = 0; y < 3; y++) await clickFace(page, 1, [0, y, 0], 2);
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press('4');
  await clickAt(page, await facePt(1, [0, 3, 0], 4)); // pin into the top hole
  m = await model(page);
  const pinId = m.parts[m.parts.length - 1].id;
  await clickFace(page, pinId, [0, 3, 0], 4); // extend the pin to z = 1
  await page.keyboard.press('1');
  const pend = await facePt(pinId, [0, 3, 1], 4);
  await hover(page, pend);
  log('wheel sleeve hover:', await hint());
  await clickAt(page, pend);
  m = await model(page);
  const wheelId = m.parts[m.parts.length - 1].id;
  await page.keyboard.press('w');
  for (let k = 0; k < 4; k++) {
    await hover(page, await facePt(wheelId, [0, 3, 1], 4));
    const h = await hint();
    await clickAt(page, await facePt(wheelId, [0, 3, 1], 4));
    if (k === 3) log('last grow hint:', h);
  }
  await page.keyboard.press('g');
  m = await model(page);
  log('spinner model:', JSON.stringify(m.parts.map((p) => [p.id, p.cells.map((c) => `${c.kind}@${c.x},${c.y},${c.z}${c.rim ? ' r' + c.rim : ''}`)])), 'ground', m.ground, 'counts', (await status(page)).counts);
  await page.keyboard.press('Home');
  await settle(page);
  await page.mouse.move(1, 360);
  await frames(page, 2);
  await shot('owner-spinner-built');
  // play paused; grab the rim on the front face at (+2, 0) from the hub and drag it round a circle
  await ev(() => { window.__knap.setView('front'); window.__knap.fit(); });
  await frames(page, 2);
  await ev(() => window.__knap.stepSim(0));
  const hub = [0, 3, 1];
  const rimPt = (a, r = 2) => [hub[0] + r * Math.cos(a), hub[1] + r * Math.sin(a), hub[2] + 0.5];
  const sp0 = await ev((p) => window.__knap.screenPos(p), rimPt(0));
  await page.mouse.move(sp0.x, sp0.y);
  await frames(page, 1);
  await page.mouse.down();
  await frames(page, 1);
  let grabbedW = null;
  const ang = () => ev((id) => { const q = window.__knap.simTransforms()[id].q; return 2 * Math.atan2(q[2], q[3]); }, wheelId);
  let a = 0;
  let prev = 0;
  const unwrap = (p, x) => p + Math.atan2(Math.sin(x - p), Math.cos(x - p));
  for (let i = 1; i <= 24; i++) {
    const sp = await ev((p) => window.__knap.screenPos(p), rimPt((i * Math.PI) / 8));
    await page.mouse.move(sp.x, sp.y);
    await ev(() => window.__knap.stepSim(8));
    grabbedW ??= (await ev(() => window.__knap.simInfo())).grabbed;
    a = unwrap(a, await ang());
    if (i === 12) { await frames(page, 2); await shot('owner-spinner-drag'); }
  }
  const aRel = a;
  // fling: release after the last move
  await page.mouse.up();
  const sp1 = [];
  for (let i = 0; i < 40; i++) {
    const before = a;
    await ev(() => window.__knap.stepSim(48));
    a = unwrap(a, await ang());
    sp1.push((a - before) / 0.1);
    if (i === 2) { await frames(page, 2); await shot('owner-spinner-spinning'); }
  }
  const info = await ev(() => window.__knap.simInfo());
  log(`spinner: grabbed body ${grabbedW}; wheel turned ${((aRel * 180) / Math.PI).toFixed(0)}° during a 3-turn circular drag (mouse went +1080°); after release ω (rad/s, 0.1 s means): ${sp1.slice(0, 40).filter((_, i) => i % 4 === 0).map((v) => v.toFixed(2)).join(' ')}; jointError ${info.jointError.toExponential(1)}`);
  await frames(page, 2);
  await shot('owner-spinner-after');
  // tangential flick (a straight fast drag across the top of the rim)
  await page.keyboard.press('Escape');
  await ev(() => window.__knap.stepSim(0));
  const top = await ev((p) => window.__knap.screenPos(p), rimPt(Math.PI / 2, 2.2));
  const topR = await ev((p) => window.__knap.screenPos(p), [hub[0] + 4, hub[1] + 2.2, hub[2] + 0.5]);
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(top.x + ((topR.x - top.x) * i) / 4, top.y);
    await ev(() => window.__knap.stepSim(8));
  }
  await page.mouse.up();
  a = 0;
  const w = [];
  for (let i = 0; i < 60; i++) {
    const before = a;
    await ev(() => window.__knap.stepSim(48));
    a = unwrap(a, await ang());
    w.push((a - before) / 0.1);
  }
  log(`flick: ω after release ${w.filter((_, i) => i % 6 === 0).map((v) => v.toFixed(2)).join(' ')} rad/s; turned ${((a * 180) / Math.PI).toFixed(0)}° in 6 s`);
  await page.keyboard.press('Escape');
  log('console errors:', JSON.stringify(ctx.errors));
} catch (e) {
  console.error(e);
  await shot('owner-FAILED');
} finally {
  await ctx.close();
  await browser.close();
  await server.close();
}
