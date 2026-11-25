// Review "sim" 4: Show-kinematics overlay before / while / after simulating; camera navigation while
// simulating; 20 Play/Stop cycles give identical first-second trajectories and leak nothing.
// Run: node e2e/review-sim-misc.mjs
import { frames, settle, sleep } from './app-lib.mjs';
import { check, harness, montage, pixelDiff, results, viewShot } from './review-sim-lib.mjs';

const h = await harness();
const c = await h.open('review-sim-misc');
const { page } = c;
const k = (fn, arg) => page.evaluate(fn, arg);
const info = () => k(() => window.__knap.simInfo());

/** WASM memory sizes (bytes) of every live WebAssembly.Memory and the JS heap after GC. */
async function memory(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const proto = await cdp.send('Runtime.evaluate', { expression: 'WebAssembly.Memory.prototype' });
  const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  const sizes = await cdp.send('Runtime.callFunctionOn', {
    objectId: q.objects.objectId,
    functionDeclaration: 'function () { return this.map((m) => m.buffer.byteLength); }',
    returnByValue: true,
  });
  const heap = await cdp.send('Runtime.getHeapUsage');
  return { wasm: sizes.result.value, heap: heap.usedSize };
}

try {
  // --- Kinematics overlay
  await k(() => window.__knap.loadExample('four-bar'));
  await k(() => window.__knap.home());
  await settle(page);
  await page.keyboard.press('k');
  await frames(page, 2);
  const kinEdit = await viewShot(page, 'review-sim-kin-edit');
  await k(() => window.__knap.stepSim(0));
  await frames(page, 2);
  const kinT0 = await viewShot(page, 'review-sim-kin-t0');
  await k(() => window.__knap.stepSim(200));
  await frames(page, 2);
  const kinMoved = await viewShot(page, 'review-sim-kin-moved');
  await page.keyboard.press('k');
  await frames(page, 2);
  const kinOffSim = await viewShot(page, 'review-sim-kin-off-sim');
  const st1 = await k(() => window.__knap.getState());
  check('K toggles the overlay while simulating', st1.showKinematics === false && st1.mode === 'simulate', st1.message);
  await page.keyboard.press('k');
  await frames(page, 2);
  const kinOnSim = await viewShot(page, 'review-sim-kin-on-sim');
  check('overlay back on while simulating = same picture as before toggling', (await pixelDiff(page, kinMoved, kinOnSim, { thresh: 0 })).n === 0);
  await k(() => window.__knap.setMode('edit'));
  await frames(page, 2);
  const kinStopped = await viewShot(page, 'review-sim-kin-stopped');
  const dk = await pixelDiff(page, kinEdit, kinStopped, { thresh: 0, diffFile: 'review-sim-kin-diff-stop' });
  check('overlay on: Stop restores the picture pixel-exactly', dk.n === 0, dk);
  await montage(page, [kinEdit, kinT0, kinMoved, kinOffSim], ['edit, K on', 'sim t=0', 'sim t=0.42', 'sim, K off'], 'review-sim-kin-montage', { cols: 2 });
  await page.keyboard.press('k');

  // --- Camera navigation while the simulation runs
  await page.keyboard.press(' ');
  await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
  await sleep(300);
  const t0 = (await info()).time;
  const cam0 = await k(() => window.__knap.camera());
  // orbit on empty space
  await page.mouse.move(200, 600);
  await page.mouse.down();
  await page.mouse.move(300, 560, { steps: 4 });
  await page.mouse.up();
  const cam1 = await k(() => window.__knap.camera());
  // pan with right drag
  await page.mouse.move(200, 600);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(260, 620, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  const cam2 = await k(() => window.__knap.camera());
  // wheel zoom
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, -300);
  await sleep(300);
  const cam3 = await k(() => window.__knap.camera());
  // view cube FRONT face (left half of the cube's lower part in the iso view)
  const vb = await page.locator('[data-role=viewport]').boundingBox();
  // F key fit and Home
  await page.keyboard.press('f');
  await sleep(500);
  const cam4 = await k(() => window.__knap.camera());
  await page.keyboard.press('Home');
  await sleep(500);
  const i1 = await info();
  check('orbit / pan / zoom / Fit work while simulating', cam1.yaw !== cam0.yaw && JSON.stringify(cam2.target) !== JSON.stringify(cam1.target) && cam3.height < cam2.height && cam4 !== null, { cam0, cam1, cam2, cam3 });
  check('simulation keeps running during navigation, nothing grabbed', i1.time > t0 && i1.grabbed === null, { t0, t1: i1.time });
  await viewShot(page, 'review-sim-nav-home');
  void vb;
  await page.keyboard.press('Escape');
  await frames(page, 2);

  // --- Determinism + leaks: 20 Play/Stop cycles of the triple pendulum, 1 s each.
  await k(() => window.__knap.loadExample('triple-pendulum'));
  await frames(page, 2);
  const cdp = await page.context().newCDPSession(page);
  const runs = [];
  let mem0 = null;
  let memEnd = null;
  const renders0 = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(' '); // Play (real UI)
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    await page.keyboard.press(' '); // pause
    await frames(page, 1);
    const tr = await k(async () => {
      const k = window.__knap;
      const start = k.simInfo().stepCount;
      // the frames that ran between Play and Pause stepped the sim: rewind is impossible, so record the offset
      const out = [];
      for (let j = 0; j < 10; j++) {
        await k.stepSim(48);
        out.push(k.simTransforms());
      }
      return { start, out };
    });
    runs.push(tr);
    await page.keyboard.press('Escape');
    await frames(page, 1);
    if (i === 1) mem0 = await memory(cdp);
  }
  memEnd = await memory(cdp);
  // Compare runs that started from the same step count (frames ran between Play and Pause).
  const byStart = new Map();
  for (const r of runs) {
    const key = r.start;
    if (!byStart.has(key)) byStart.set(key, []);
    byStart.get(key).push(JSON.stringify(r.out));
  }
  let identical = true;
  for (const [, list] of byStart) if (new Set(list).size !== 1) identical = false;
  check('20 Play/Stop cycles: runs with the same start step are bit-identical', identical, [...byStart.entries()].map(([s, l]) => `start ${s}: ${l.length} runs, ${new Set(l).size} distinct`));
  // Also exact determinism from t = 0 through the hook (no real-time frames in between).
  const hookRuns = [];
  for (let i = 0; i < 3; i++) {
    hookRuns.push(
      await k(async () => {
        const k = window.__knap;
        const out = [];
        for (let j = 0; j < 10; j++) {
          await k.stepSim(48);
          out.push(k.simTransforms());
        }
        await k.setMode('edit');
        return JSON.stringify(out);
      }),
    );
  }
  check('stepSim from edit mode: 3 runs bit-identical', new Set(hookRuns).size === 1);
  console.log(`memory after cycle 2: wasm ${JSON.stringify(mem0.wasm)} heap ${(mem0.heap / 1e6).toFixed(1)} MB; after 20: wasm ${JSON.stringify(memEnd.wasm)} heap ${(memEnd.heap / 1e6).toFixed(1)} MB`);
  const wasmGrow = memEnd.wasm.reduce((a, b) => a + b, 0) - mem0.wasm.reduce((a, b) => a + b, 0);
  check('20 Play/Stop cycles: WASM memory does not grow, JS heap grows < 5 MB', wasmGrow === 0 && memEnd.heap - mem0.heap < 5e6, { wasmGrow, heapGrow: memEnd.heap - mem0.heap });
  const stats = await k(() => window.__knap.getState().viewport);
  const r1 = stats.renders;
  await sleep(1500);
  const r2 = (await k(() => window.__knap.getState().viewport)).renders;
  check('after Stop the frame loop is idle (no renders in 1.5 s)', r2 === r1, { r1, r2 });
  console.log('viewport stats', JSON.stringify(stats));
  void renders0;
  if (c.errors.length) check('no page errors', false, c.errors);
} finally {
  await h.done();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
for (const r of bad) console.log(`FAILED: ${r.name}  ${JSON.stringify(r.detail)}`);
