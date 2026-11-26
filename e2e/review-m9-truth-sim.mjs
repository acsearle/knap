// Reviewer "truth" (milestone 9, Show colliders), browser side. Run:
//   E2E_DIST=e2e/out/review-m9-truth-dist node spikes/review-m9/truth/build.mjs     (once)
//   E2E_DIST=e2e/out/review-m9-truth-dist node e2e/review-m9-truth-sim.mjs
// Independent of the builder's hook comparisons: a hook on renderer.render checks, at EVERY render
// of the colour scene, that each part's collider meshes (pre-pass, fills, lines, hidden lines) carry
// in matrixWorld exactly the simulation's current pose of the part (Simulation.partTransform read at
// that moment through __knap.simTransforms, composed with the part origin), are hidden iff the body
// is gone, and agree with the solid. Then staleness after edits, removal, and cost.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR, launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp } from './app-lib.mjs';

const results = {};
const fails = [];
const check = (cond, msg) => {
  if (!cond) fails.push(msg);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const server = await startServer();
const browser = await launchBrowser();
const ctx = await openPage(browser, server.url, 'review-m9-truth-sim', { width: 1280, height: 720 });
const { page } = ctx;
await openApp(page, ctx.url);

// ---- the render hook --------------------------------------------------------------------------
await page.evaluate(() => {
  const vp = document.querySelector('canvas.kv-canvas').__knapViewport;
  const orig = vp.renderer.render.bind(vp.renderer);
  const S = (window.__truth = { renders: 0, checked: 0, maxErr: 0, maxSolidErr: 0, visBad: [], missing: [], stray: [], worst: null, log: [] });
  const compose = (t, o) => {
    // world = R(q)·(local + o) + p  → column-major 4×4
    const [x, y, z, w] = t.q;
    const R = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
    const tr = [0, 1, 2].map((i) => R[i][0] * o[0] + R[i][1] * o[1] + R[i][2] * o[2] + t.p[i]);
    return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, tr[0], tr[1], tr[2], 1];
  };
  window.__truthCheck = () => {
    const layer = vp.colliderLayer;
    if (!vp.collidersOn || !layer) return;
    const T = window.__knap.simTransforms();
    const model = vp.getModel();
    const ids = new Set(model.parts.map((p) => p.id));
    S.checked++;
    for (const p of model.parts) {
      const pc = layer.parts.get(p.id);
      const pv = vp.views.get(p.id);
      if (!pc) {
        S.missing.push(p.id);
        continue;
      }
      const t = T[p.id];
      const meshes = [pc.prepass, ...pc.fills, pc.lines, pc.hidden];
      if (!t) {
        if (meshes.some((m) => m.visible)) S.visBad.push({ id: p.id, why: 'body gone but collider visible' });
        continue;
      }
      if (meshes.some((m) => !m.visible) && !vp.hidden.has(p.id)) S.visBad.push({ id: p.id, why: 'body alive but collider hidden' });
      const want = compose(t, pv.origin);
      for (const m of meshes) {
        let e = 0;
        for (let k = 0; k < 16; k++) e = Math.max(e, Math.abs(m.matrixWorld.elements[k] - want[k]));
        if (e > S.maxErr) {
          S.maxErr = e;
          S.worst = { id: p.id, e, render: S.renders };
        }
        let es = 0;
        for (let k = 0; k < 16; k++) es = Math.max(es, Math.abs(m.matrixWorld.elements[k] - pv.colorMesh.matrixWorld.elements[k]));
        S.maxSolidErr = Math.max(S.maxSolidErr, es);
      }
    }
    for (const id of layer.parts.keys()) if (!ids.has(id)) S.stray.push(id);
  };
  vp.renderer.render = (scene, cam) => {
    orig(scene, cam);
    if (scene !== vp.colorScene) return;
    S.renders++;
    window.__truthCheck();
  };
});
const truth = () => page.evaluate(() => ({ ...window.__truth, visBad: window.__truth.visBad.slice(0, 5), missing: window.__truth.missing.slice(0, 5), stray: window.__truth.stray.slice(0, 5), nVisBad: window.__truth.visBad.length, nMissing: window.__truth.missing.length, nStray: window.__truth.stray.length }));
const resetTruth = () => page.evaluate(() => Object.assign(window.__truth, { renders: 0, checked: 0, maxErr: 0, maxSolidErr: 0, visBad: [], missing: [], stray: [], worst: null }));
const K = (fn, arg) => page.evaluate(fn, arg);
const realFrames = async (ms) => {
  await page.waitForTimeout(ms);
  await frames(page, 2);
};

async function simPhase(name, { grabPart } = {}) {
  await resetTruth();
  await K((n) => window.__knap.loadExample(n), name);
  await frames(page, 3);
  await page.keyboard.press('c'); // the real key
  await frames(page, 2);
  const on = await K(() => window.__knap.colliderInfo().on);
  check(on, `${name}: C turns the view on`);
  await K(() => window.__knap.setMode('simulate'));
  await realFrames(2500); // running at the default speed
  const s1 = await K(() => window.__knap.simInfo());
  await K(() => window.__knap.setPaused(true));
  await realFrames(400); // paused: poses re-applied, nothing moves
  for (let i = 0; i < 20; i++) {
    await K(() => window.__knap.stepSim(1)); // single steps
    await frames(page, 1);
  }
  await K(() => window.__knap.stepSim(300));
  await frames(page, 2);
  await K(() => window.__knap.setPaused(false));
  if (grabPart !== undefined) {
    const p = await K((id) => window.__knap.partScreenPos(id), grabPart);
    if (p) {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(p.x + 4 * i, p.y - 3 * i);
        await frames(page, 1);
      }
      const g = await K(() => window.__knap.simInfo().grabbed);
      results[`${name}-grabbed`] = g;
      await page.mouse.up();
    }
  }
  await realFrames(1000);
  const s2 = await K(() => window.__knap.simInfo());
  await K(() => window.__knap.setMode('edit')); // Stop
  await frames(page, 3);
  const afterStop = await truth();
  await K(() => window.__knap.setMode('simulate')); // Play again
  await realFrames(1500);
  await K(() => window.__knap.setMode('edit'));
  await frames(page, 2);
  const t = await truth();
  results[name] = { steps: s2.stepCount, timeAtPause: s1.time, ...t, afterStopChecked: afterStop.checked };
  check(t.checked > 50, `${name}: ${t.checked} renders checked (${s2.stepCount} steps before Stop)`);
  check(t.maxErr < 1e-5, `${name}: collider matrixWorld = simulated pose at every render (max |Δ| ${t.maxErr.toExponential(2)})`);
  check(t.maxSolidErr < 1e-6, `${name}: collider matrixWorld = solid matrixWorld (max |Δ| ${t.maxSolidErr.toExponential(2)})`);
  check(t.nVisBad === 0 && t.nMissing === 0 && t.nStray === 0, `${name}: visibility / missing / stray ${t.nVisBad}/${t.nMissing}/${t.nStray} ${JSON.stringify(t.visBad)}`);
  await page.keyboard.press('c');
  await frames(page, 2);
}

await simPhase('cart', { grabPart: 1 });
await simPhase('gear-train');
await simPhase('collision', { grabPart: 2 });

// ---- removal: a free part falls out of the world (ground off) ----------------------------------
{
  await resetTruth();
  const m = {
    version: 1,
    rootPartId: 1,
    nextPartId: 3,
    parts: [
      { id: 1, color: '#a8adb2', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2 }, { x: 1, y: 0, z: 0, kind: 'pinHole', axis: 2 }] },
      { id: 2, color: '#c8433a', cells: [{ x: 6, y: 3, z: 0, kind: 'pinHole', axis: 2 }, { x: 7, y: 3, z: 0, kind: 'pinHole', axis: 2 }, { x: 8, y: 3, z: 0, kind: 'pinHole', axis: 2 }] },
    ],
  };
  await K((m) => window.__knap.setModel(m), m);
  await K(() => window.__knap.setShowColliders(true));
  await K(() => window.__knap.setMode('simulate'));
  await K(() => window.__knap.setPaused(true));
  await K(() => window.__knap.stepSim(1200));
  await frames(page, 3);
  const T = await K(() => window.__knap.simTransforms());
  const inf = await K(() => window.__knap.colliderInfo());
  const legend = await K(() => [...document.querySelectorAll('[data-role=collider-legend] li')].map((li) => li.textContent));
  const t = await truth();
  results.removal = { transform2: T[2], vis: inf.parts.map((p) => [p.partId, p.visible]), legend, ...t };
  check(T[2] === null, 'removal: part 2 body removed after 1200 steps (2.5 s) of free fall');
  check(inf.parts.find((p) => p.partId === 2)?.visible === false, 'removal: its colliders are hidden');
  check(t.nVisBad === 0, `removal: no render showed a removed body's colliders (${t.nVisBad})`);
  results.removalLegend = legend;
  await K(() => window.__knap.setMode('edit'));
  await frames(page, 2);
  const back = await K(() => window.__knap.colliderInfo().parts.map((p) => [p.partId, p.visible]));
  check(back.every(([, v]) => v), `removal: after Stop every part's colliders are visible again ${JSON.stringify(back)}`);
  await K(() => window.__knap.setShowColliders(false));
}

// ---- staleness under edits ---------------------------------------------------------------------
{
  // Snapshot of what is drawn per part: key, vertex count, a hash of positions and edges, origin.
  const snap = () =>
    K(() => {
      const vp = document.querySelector('canvas.kv-canvas').__knapViewport;
      const layer = vp.colliderLayer;
      const out = {};
      if (!layer || !vp.collidersOn) return null;
      for (const [id, pc] of layer.parts) {
        const pos = pc.entry.fill.attributes.position.array;
        let h = 0;
        for (let i = 0; i < pos.length; i++) h = (h * 31 + Math.round(pos[i] * 1e5)) | 0;
        out[id] = { key: pc.key, n: pos.length / 3, h, edges: pc.entry.data.ends.length / 6, origin: [...vp.views.get(id).origin], m: [...pc.prepass.matrix.elements].map((x) => +x.toFixed(9)) };
      }
      return out;
    });
  const fresh = async () => {
    await K(() => window.__knap.setShowColliders(false));
    await K(() => window.__knap.setShowColliders(true));
    await frames(page, 1);
    return snap();
  };
  const counts = () => K(() => ({ drawn: window.__knap.colliderInfo().parts.map((p) => [p.partId, p.part, p.round, p.hull, p.guard]), spec: window.__knap.colliderSpecCounts() }));
  let stale = 0;
  const steps = [];
  const verify = async (label) => {
    await frames(page, 2);
    const a = await snap();
    const c = await counts();
    const b = await fresh();
    const same = JSON.stringify(a) === JSON.stringify(b);
    const cOk = c.drawn.every(([id, ...n]) => JSON.stringify(n) === JSON.stringify([c.spec[id].part, c.spec[id].round, c.spec[id].hull, c.spec[id].guard])) && c.drawn.length === Object.keys(c.spec).length;
    const t = await truth();
    if (!same || !cOk || t.nStray || t.nMissing) stale++;
    steps.push(`${label}: ${same && cOk ? 'ok' : 'STALE'} parts=${Object.keys(a ?? {}).length}`);
  };
  await resetTruth();
  await K(() => window.__knap.loadExample('cart'));
  await K(() => window.__knap.setShowColliders(true));
  await verify('load cart');
  await K(() => window.__knap.setGround(false));
  await verify('ground off');
  const g0 = await K(() => window.__knap.colliderInfo().parts.reduce((s, p) => s + p.guard, 0));
  await K(() => window.__knap.setGround(true));
  await verify('ground on');
  const g1 = await K(() => window.__knap.colliderInfo().parts.reduce((s, p) => s + p.guard, 0));
  check(g0 === 0 && g1 === 4, `guards only with the ground: off ${g0}, on ${g1}`);
  // move, rotate, grow a wheel, make a gear, erase, add: through setModel (every edit ends in vp.setModel)
  let m = await K(() => window.__knap.getModel());
  const p0 = m.parts[0];
  m = { ...m, parts: m.parts.map((p) => (p.id === p0.id ? { ...p, cells: p.cells.map((c) => ({ ...c, x: c.x + 3 })) } : p)) };
  await K((m) => window.__knap.setModel(m), m);
  await verify('move part');
  const wheelPart = m.parts.find((p) => p.cells.some((c) => c.rim !== undefined));
  m = { ...m, parts: m.parts.map((p) => (p.id === wheelPart.id ? { ...p, cells: p.cells.map((c) => (c.rim !== undefined ? { ...c, rim: c.rim + 0.5 } : c)) } : p)) };
  await K((m) => window.__knap.setModel(m), m);
  await verify('grow wheel');
  m = { ...m, parts: m.parts.map((p) => (p.id === wheelPart.id ? { ...p, cells: p.cells.map((c) => (c.rim !== undefined ? { ...c, rim: 1.5, teeth: true } : c)) } : p)) };
  await K((m) => window.__knap.setModel(m), m);
  await verify('wheel → gear');
  m = { ...m, parts: m.parts.filter((p) => p.id !== m.parts[m.parts.length - 1].id) };
  await K((m) => window.__knap.setModel(m), m);
  await verify('erase part');
  await page.keyboard.press('Meta+z');
  await verify('undo');
  await page.keyboard.press('Meta+Shift+z');
  await verify('redo');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Meta+z');
  await verify('undo ×4');
  await K(() => window.__knap.loadExample('gear-train'));
  await verify('load gear-train');
  const text = JSON.stringify(await K(() => window.__knap.getModel()));
  await K(() => window.__knap.loadExample('collision'));
  await verify('load collision');
  await K((t) => window.__knap.openText('x.json', t), text);
  await verify('open file');
  await K(() => window.__knap.setModel({ version: 1, rootPartId: null, nextPartId: 1, parts: [] }));
  await verify('empty model');
  results.staleness = steps;
  check(stale === 0, `staleness: ${stale} of ${steps.length} edits left the overlay different from a fresh build or from colliderSpecs: ${steps.join('; ')}`);
}

// ---- cost: toggle time, render ratio, memory over 200 toggles and 200 edits ---------------------
{
  const toggleTime = async (name) => {
    await K((n) => window.__knap.loadExample(n), name);
    await K(() => window.__knap.setShowColliders(false));
    await frames(page, 2);
    return K(() => {
      const vp = document.querySelector('canvas.kv-canvas').__knapViewport;
      const t0 = performance.now();
      window.__knap.setShowColliders(true);
      vp.renderNow();
      const t1 = performance.now();
      window.__knap.setShowColliders(false);
      vp.renderNow();
      const t2 = performance.now();
      window.__knap.setShowColliders(true);
      vp.renderNow();
      const t3 = performance.now();
      const on = window.__knap.renderTiming(10);
      window.__knap.setShowColliders(false);
      const off = window.__knap.renderTiming(10);
      const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
      return { firstOnMs: t1 - t0, offMs: t2 - t1, againOnMs: t3 - t2, renderOn: med(on), renderOff: med(off), ratio: med(on) / med(off) };
    });
  };
  results.costCart = await toggleTime('cart');
  results.costCollision = await toggleTime('collision');
  console.log('cost (SwiftShader: ratios only)', JSON.stringify({ cart: results.costCart, collision: results.costCollision }));

  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    return usedSize;
  };
  const stat = () =>
    K(() => {
      const vp = document.querySelector('canvas.kv-canvas').__knapViewport;
      return { gl: window.__knap.glMemory(), children: vp.colorScene.children.length, layerGeoms: vp.colliderLayer ? vp.colliderLayer.geometries : 0, progs: vp.renderer.info.programs.length };
    });
  await K(() => window.__knap.loadExample('cart'));
  await K(() => window.__knap.setShowColliders(true));
  await frames(page, 2);
  await K(() => window.__knap.setShowColliders(false));
  await frames(page, 2);
  const a0 = await stat();
  const h0 = await heap();
  for (let i = 0; i < 200; i++) {
    await K(() => {
      window.__knap.setShowColliders(true);
      document.querySelector('canvas.kv-canvas').__knapViewport.renderNow();
      window.__knap.setShowColliders(false);
      document.querySelector('canvas.kv-canvas').__knapViewport.renderNow();
    });
  }
  const a1 = await stat();
  const h1 = await heap();
  // 200 edits with the view on: grow / shrink the wheels (new signatures each time) and move a part.
  await K(() => window.__knap.setShowColliders(true));
  const base = await K(() => window.__knap.getModel());
  for (let i = 0; i < 200; i++) {
    const rim = [1.5, 2, 2.5, 3, 3.5][i % 5];
    const m = { ...base, parts: base.parts.map((p) => ({ ...p, cells: p.cells.map((c) => (c.rim !== undefined ? { ...c, rim } : { ...c, y: c.y + (i % 3) })) })) };
    await K((m) => {
      window.__knap.setModel(m);
      document.querySelector('canvas.kv-canvas').__knapViewport.renderNow();
    }, m);
  }
  await K((m) => window.__knap.setModel(m), base);
  await frames(page, 2);
  const a2 = await stat();
  const h2 = await heap();
  await K(() => window.__knap.setShowColliders(false));
  await frames(page, 2);
  const a3 = await stat();
  results.memory = { before: a0, after200Toggles: a1, after200Edits: a2, afterOff: a3, heapMB: [h0, h1, h2].map((x) => +(x / 1048576).toFixed(1)) };
  console.log('memory', JSON.stringify(results.memory));
  check(a1.gl.geometries <= a0.gl.geometries + 2 && a1.children === a0.children, `memory: 200 toggles keep GL geometries ${a0.gl.geometries}→${a1.gl.geometries}, scene children ${a0.children}→${a1.children}`);
  check(a3.gl.geometries <= a0.gl.geometries + 2 && a3.layerGeoms === 0, `memory: 200 edits then off: GL geometries ${a0.gl.geometries}→${a2.gl.geometries} (on)→${a3.gl.geometries} (off), layer geometries ${a3.layerGeoms}`);
}

await writeFile(join(OUT_DIR, 'review-m9-truth-sim.json'), JSON.stringify(results, null, 1));
console.log(`page errors: ${ctx.errors.length ? ctx.errors.join(' | ') : 'none'}`);
await ctx.close();
await browser.close();
await server.close();
console.log(fails.length ? `FAILED ${fails.length}:\n  ${fails.join('\n  ')}` : 'ALL OK');
process.exit(fails.length ? 1 : 0);
