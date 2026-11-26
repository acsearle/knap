// Reviewer verify-ui: contact shadow cost (A/B, interleaved), the >128-unit frame (clusterWindow)
// under motion, and the shadow after a WebGL context loss / restore.
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-shadow.mjs [perf] [cluster] [ctx] [roll]
import { frames } from './app-lib.mjs';
import { C, K, M, setModel, session } from './review-m7-lib.mjs';

const want = new Set(process.argv.slice(2));
const all = want.size === 0;
const S = await session();
const log = (...a) => console.log(...a);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const info = (page) => K(page, () => window.__knap.shadowInfo());
const at = (page, x, z) => K(page, ([x, z]) => window.__knap.groundShadowAt(x, z), [x, z]);

function twoCarts(cart, dx) {
  const n = cart.parts.length;
  const parts = [...cart.parts.map((p) => structuredClone(p)), ...cart.parts.map((p) => ({ ...structuredClone(p), id: p.id + 100, cells: p.cells.map((c) => ({ ...c, x: c.x + dx })) }))];
  return { ...structuredClone(cart), parts, nextPartId: 200, rootPartId: cart.rootPartId, ground: true, fixRoot: false, _n: n };
}

try {
  const ctx = await S.open('shadow', { width: 1280, height: 720 });
  const { page } = ctx;
  await K(page, () => window.__knap.loadExample('cart'));
  await frames(page, 2);
  const cart = await K(page, () => window.__knap.getModel());
  log(`cart: parts ${cart.parts.map((p) => `${p.id}:${p.cells.length}${p.cells.some((c) => c.rim) ? 'w' : ''}`).join(' ')} root ${cart.rootPartId} fixRoot ${cart.fixRoot} ground ${cart.ground}`);

  if (all || want.has('perf')) {
    // A: ground on, stepping 1 step each render (pose changes → shadow re-rendered every frame);
    // B: ground on, no stepping (shadow not re-rendered, floor drawn);  C: ground off, stepping.
    // Each sample: stepSim(1) (or not) then one synchronous render + gl.finish. Interleaved blocks.
    const res = { A: [], B: [], C: [], lastMsA: [] };
    for (let round = 0; round < 8; round++) {
      for (const mode of round % 2 ? ['C', 'A', 'B'] : ['A', 'B', 'C']) {
        await K(page, () => window.__knap.setMode('edit'));
        await K(page, (on) => window.__knap.setGround(on), mode !== 'C');
        await K(page, () => window.__knap.home());
        await K(page, () => window.__knap.stepSim(0));
        await frames(page, 2);
        const t = await K(page, async (step) => {
          const out = [];
          const ms = [];
          for (let i = 0; i < 25; i++) {
            const t0 = performance.now();
            if (step) window.__knap.stepSim(1);
            window.__knap.pixelAt(400, 400); // render + readPixels (blocks until the GPU is done)
            out.push(performance.now() - t0);
            ms.push(window.__knap.shadowInfo().lastMs);
          }
          return { out, ms };
        }, mode !== 'B');
        res[mode].push(...t.out.slice(3));
        if (mode === 'A') res.lastMsA.push(...t.ms.slice(3));
      }
    }
    const a = med(res.A), b = med(res.B), c = med(res.C);
    log(`PERF (step +) render + readPixels median ms: A ground+shadow re-render ${a.toFixed(1)}, B ground no re-render ${b.toFixed(1)}, C ground off ${c.toFixed(1)}; A/C ${(a / c).toFixed(2)}, B/C ${(b / c).toFixed(2)}, (A−B)/C ${((a - b) / c).toFixed(2)}; shadow lastMs (CPU side) median ${med(res.lastMsA).toFixed(2)}`);
    // live frame rate while simulating, interleaved 4 × 2 s each
    const fr = { on: [], off: [] };
    for (let round = 0; round < 4; round++) {
      for (const on of round % 2 ? [false, true] : [true, false]) {
        await K(page, () => window.__knap.setMode('edit'));
        await K(page, (on) => window.__knap.setGround(on), on);
        await K(page, () => window.__knap.home());
        await K(page, () => window.__knap.setMode('simulate'));
        await page.waitForTimeout(300);
        const r = await K(page, () => window.__knap.frameRate(2000));
        const sh = await info(page);
        fr[on ? 'on' : 'off'].push(r.frames / (r.ms / 1000));
        if (on) log(`  live sim ground on: ${(r.frames / (r.ms / 1000)).toFixed(1)} fps, shadow lastMs ${sh.lastMs.toFixed(2)}, renders ${sh.renders}`);
      }
    }
    log(`PERF live sim fps (interleaved, 4×2 s): on ${fr.on.map((v) => v.toFixed(1))} off ${fr.off.map((v) => v.toFixed(1))}; median ratio on/off ${(med(fr.on) / med(fr.off)).toFixed(2)}`);
    await K(page, () => window.__knap.setMode('edit'));
    await K(page, () => window.__knap.setGround(true));
  }

  if (all || want.has('roll')) {
    // a cart rolling 300 units: shadow under the wheels the whole way, frame re-centres, any pop?
    await K(page, () => window.__knap.loadExample('cart'));
    await K(page, () => window.__knap.setFriction('off'));
    await K(page, () => window.__knap.stepSim(0));
    const samples = [];
    let lastFrame = null;
    let recentres = 0;
    for (let i = 0; i < 400; i++) {
      await K(page, () => {
        window.__knap.pushBody(1, [60, 0, 0]);
      });
      await K(page, () => window.__knap.stepSim(8));
      const t = await K(page, () => window.__knap.simTransforms());
      const f = (await info(page)).frame;
      if (lastFrame && (f.x0 !== lastFrame.x0 || f.w !== lastFrame.w)) recentres++;
      lastFrame = f;
      // the wheel at edit (0,0,-1) (part with rim) — find wheels by cells with rim
      const wheels = cart.parts.filter((p) => p.cells.some((c) => c.rim));
      const vals = [];
      for (const w of wheels) {
        const tr = t[w.id];
        const hub = w.cells.find((c) => c.rim);
        const q = tr.q;
        // rotate hub by q
        const [x, y, z, ww] = q;
        const v = [hub.x, hub.y, hub.z];
        const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
        const p = [v[0] + ww * tx + (y * tz - z * ty) + tr.p[0], v[1] + ww * ty + (z * tx - x * tz) + tr.p[1], v[2] + ww * tz + (x * ty - y * tx) + tr.p[2]];
        vals.push(await at(page, p[0], p[2]));
      }
      const cx = t[1].p[0];
      samples.push({ cx, min: Math.min(...vals), max: Math.max(...vals) });
      if (cx > 300) break;
    }
    const mins = samples.map((s) => s.min);
    let maxJump = 0;
    for (let i = 1; i < samples.length; i++) maxJump = Math.max(maxJump, Math.abs(samples[i].min - samples[i - 1].min));
    log(`ROLL cart to x ${samples.at(-1).cx.toFixed(1)} in ${samples.length} samples: wheel-contact shadow min ${Math.min(...mins).toFixed(3)} max ${Math.max(...samples.map((s) => s.max)).toFixed(3)}, largest step-to-step change of the weakest wheel ${maxJump.toFixed(3)}, frame re-centres ${recentres}, final frame ${JSON.stringify(lastFrame)}`);
    await K(page, () => window.__knap.setView('top'));
    await frames(page, 2);
    await K(page, () => window.__knap.fit());
    await frames(page, 2);
    await ctx.shot('review-m7-roll-end-top');
    await K(page, () => window.__knap.setMode('edit'));
    await K(page, () => window.__knap.setFriction('realistic'));
  }

  if (all || want.has('cluster')) {
    // 1. two equal carts driving apart (simulated, friction off), frame and both carts' shadow
    const m2 = twoCarts(cart, 12);
    delete m2._n;
    await setModel(page, m2);
    await K(page, () => window.__knap.setFriction('off'));
    await K(page, () => window.__knap.stepSim(0));
    const rows = [];
    let flips = 0;
    let prevX0 = null;
    for (let i = 0; i < 260; i++) {
      await K(page, () => {
        window.__knap.pushBody(1, [-45, 0, 0]);
        window.__knap.pushBody(101, [45, 0, 0]);
      });
      await K(page, () => window.__knap.stepSim(6));
      const t = await K(page, () => window.__knap.simTransforms());
      const ax = t[1].p[0], bx = t[101].p[0] + 12;
      const f = (await info(page)).frame;
      // shadow at a point under each cart's chassis (edit (4,0) moved by its transform x)
      const sa = await at(page, 4 + ax, -1);
      const sb = await at(page, 4 + bx, -1);
      rows.push({ sep: bx - ax, x0: f.x0, w: f.w, sa, sb });
      if (prevX0 !== null && Math.abs(f.x0 - prevX0) > 20) flips++;
      prevX0 = f.x0;
      if (bx - ax > 260) break;
    }
    const pick = rows.filter((_, i) => i % 10 === 0 || i === rows.length - 1);
    log(`CLUSTER two carts apart: ${rows.length} samples, frame jumps >20 units: ${flips}`);
    for (const r of pick) log(`  sep ${r.sep.toFixed(1)} frame x0 ${r.x0} w ${r.w} | A ${r.sa.toFixed(3)} B ${r.sb.toFixed(3)}`);
    // where did A or B lose its shadow, and was it gradual?
    let lostA = rows.findIndex((r) => r.sa < 0.05), lostB = rows.findIndex((r) => r.sb < 0.05);
    log(`  first sample A < 0.05: ${lostA} (sep ${rows[lostA]?.sep.toFixed(1)}), B < 0.05: ${lostB} (sep ${rows[lostB]?.sep.toFixed(1)})`);
    for (const k of [lostA, lostB].filter((k) => k > 0)) log(`  around ${k}: ${rows.slice(Math.max(0, k - 3), k + 2).map((r) => `${r.sep.toFixed(1)}:${r.sa.toFixed(2)}/${r.sb.toFixed(2)}@${r.x0}`).join('  ')}`);
    await K(page, () => window.__knap.setView('top'));
    await K(page, () => window.__knap.fit());
    await frames(page, 2);
    await ctx.shot('review-m7-cluster-apart-top');
    await K(page, () => window.__knap.setMode('edit'));
    await K(page, () => window.__knap.setFriction('realistic'));

    // 2. equal static groups 200 apart (exact tie), then nudge each one by sub-texel steps
    const beam = (x0, z0, id) => ({ id, color: '#3b74c4', cells: Array.from({ length: 5 }, (_, i) => C(x0 + i, 0, z0, 'pinHole', 1)) });
    const mt = M([beam(0, 0), beam(200, 0)]);
    mt.parts = [beam(0, 0, 1), beam(200, 0, 2)];
    await setModel(page, mt);
    await frames(page, 2);
    const f0 = (await info(page)).frame;
    const seq = [];
    for (let i = 0; i < 40; i++) {
      const who = i % 2 ? 1 : 2;
      await K(page, ([who, d]) => window.__knap.setPartTransform(who, [d, 0, 0]), [who, (i % 4) * 0.03]);
      await frames(page, 1);
      await at(page, 0, 0);
      seq.push((await info(page)).frame.x0);
    }
    log(`TIE two equal beams 200 apart: initial frame x0 ${f0.x0}; frame x0 over 40 alternating nudges: distinct ${[...new Set(seq)].join(',')}`);
    // 3. one small group (beam 5) slowly crossing the window edge of a big group (plate)
    await K(page, () => window.__knap.clearTransforms());
    const plate = { id: 1, color: '#a8adb2', cells: Array.from({ length: 64 }, (_, i) => C(i % 8, 0, Math.floor(i / 8), 'pinHole', 1)) };
    const small = { id: 2, color: '#c8433a', cells: Array.from({ length: 3 }, (_, i) => C(i, 0, 0, 'pinHole', 1)) };
    const far = { id: 3, color: '#4c9a57', cells: [C(300, 0, 0, 'pinHole', 1)] };
    const mc = M([]);
    mc.parts = [plate, small, far];
    mc.nextPartId = 4;
    await setModel(page, mc);
    await frames(page, 2);
    const cross = [];
    for (let x = 100; x <= 130; x += 0.25) {
      await K(page, (x) => window.__knap.setPartTransform(2, [x, 0, 3]), x);
      const s = await at(page, x + 1, 3);
      const f = (await info(page)).frame;
      cross.push([x, s, f.x0]);
    }
    let maxStep = 0;
    for (let i = 1; i < cross.length; i++) maxStep = Math.max(maxStep, Math.abs(cross[i][1] - cross[i - 1][1]));
    log(`CROSS small beam moved x 100→130 in 0.25 steps near a big plate (window x0 ${cross[0][2]}): shadow ${cross.filter((_, i) => i % 8 === 0).map((c) => `${c[0]}:${c[1].toFixed(2)}`).join(' ')}; largest step change ${maxStep.toFixed(3)}; frame x0 values ${[...new Set(cross.map((c) => c[2]))].join(',')}`);
    await K(page, () => window.__knap.setPartTransform(2, [118, 0, 3]));
    await K(page, () => window.__knap.setView('top'));
    await K(page, () => window.__knap.setCamera({ target: [118, -0.5, 3], yaw: 0, pitch: Math.PI / 2 - 0.001, height: 14 }));
    await frames(page, 3);
    await ctx.shot('review-m7-cluster-edge-top');
    await K(page, () => window.__knap.clearTransforms());
  }

  if (all || want.has('ctx')) {
    await K(page, () => window.__knap.loadExample('cart'));
    await K(page, () => window.__knap.home());
    await frames(page, 2);
    const lose = () => K(page, () => {
      const c = document.querySelector('[data-role=viewport] canvas');
      const gl = c.getContext('webgl2');
      window.__lc = gl.getExtension('WEBGL_lose_context');
      window.__lc.loseContext();
    });
    const restore = () => K(page, () => window.__lc.restoreContext());
    const wheelPix = async () => {
      // floor pixel just in front of the front-left wheel's contact (Home view)
      const p = await K(page, () => window.__knap.screenPos([8.4, -1.46, 4.1]));
      return K(page, (p) => window.__knap.pixelAt(p.x, p.y), p);
    };
    const report = async (label) => {
      await frames(page, 3);
      const px = await wheelPix();
      const dirty = (await info(page)).dirty;
      const s = await at(page, 0, -1);
      const i = await info(page);
      log(`CTX ${label}: shadow under wheel ${s?.toFixed(3)} floor pixel ${px} renders ${i.renders} dirty-before-readback ${dirty}`);
      return s;
    };
    await report('edit before');
    await lose();
    await page.waitForTimeout(300);
    await restore();
    await page.waitForTimeout(500);
    await report('edit after restore');
    await ctx.shot('review-m7-ctx-edit-after');
    // during simulation (running)
    await K(page, () => window.__knap.setMode('simulate'));
    await page.waitForTimeout(800);
    await lose();
    await page.waitForTimeout(400);
    await restore();
    await page.waitForTimeout(800);
    await report('running sim after restore');
    await ctx.shot('review-m7-ctx-sim-after');
    // paused
    await K(page, () => window.__knap.setPaused(true));
    await frames(page, 2);
    await lose();
    await page.waitForTimeout(300);
    await restore();
    await page.waitForTimeout(600);
    await report('paused sim after restore');
    await ctx.shot('review-m7-ctx-paused-after');
    await K(page, () => window.__knap.setMode('edit'));
    await frames(page, 2);
    // ground toggled off and on (real clicks) while lost
    const toggle = async () => {
      const b = await page.locator('[data-action=ground]').boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(150);
    };
    await lose();
    await page.waitForTimeout(200);
    await toggle();
    await toggle();
    log(`  ground after two toggles while lost: ${(await K(page, () => window.__knap.getState())).ground}`);
    await restore();
    await page.waitForTimeout(600);
    await report('edit, ground toggled off+on while lost, after restore');
    await ctx.shot('review-m7-ctx-toggle-after');
    // ground turned on while lost (was off)
    await toggle();
    await frames(page, 2);
    await lose();
    await page.waitForTimeout(200);
    await toggle();
    await restore();
    await page.waitForTimeout(600);
    await report('edit, ground turned on while lost');
    // lost during sim, Stop while lost, restore in edit
    await K(page, () => window.__knap.setMode('simulate'));
    await page.waitForTimeout(500);
    await lose();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await restore();
    await page.waitForTimeout(600);
    log(`  mode after Esc while lost: ${(await K(page, () => window.__knap.getState())).mode}`);
    await report('stopped while lost, restored in edit');
    await ctx.shot('review-m7-ctx-stop-after');
    log(`CTX page errors: ${ctx.errors.length ? ctx.errors.join(' | ') : 'none'}`);
  }
} finally {
  await S.close();
}
process.exit(0);
