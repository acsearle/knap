// Reviewer "code": frame-loop discipline (idle renders) and resource release across cycles.
import { runProbes, st, sleep } from './review-code-lib.mjs';
import { frames, settle } from './app-lib.mjs';

// Instrument: live GL objects, contexts, wasm memories, rAF count.
const init = () => {
  const live = { buffers: 0, textures: 0, framebuffers: 0, renderbuffers: 0, programs: 0, vaos: 0, contexts: 0, raf: 0 };
  window.__rc = { live, memories: [] };
  const P = WebGL2RenderingContext.prototype;
  const wrap = (c, d, k) => {
    const oc = P[c], od = P[d];
    P[c] = function (...a) { live[k]++; return oc.apply(this, a); };
    P[d] = function (o) { if (o) live[k]--; return od.call(this, o); };
  };
  wrap('createBuffer', 'deleteBuffer', 'buffers');
  wrap('createTexture', 'deleteTexture', 'textures');
  wrap('createFramebuffer', 'deleteFramebuffer', 'framebuffers');
  wrap('createRenderbuffer', 'deleteRenderbuffer', 'renderbuffers');
  wrap('createProgram', 'deleteProgram', 'programs');
  wrap('createVertexArray', 'deleteVertexArray', 'vaos');
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { const r = gc.call(this, t, ...a); if (r && /webgl/.test(t) && !this.__rcCounted) { this.__rcCounted = 1; live.contexts++; } return r; };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { live.raf++; return raf(cb); };
  const rec = (res) => { try { const inst = res.instance ?? res; for (const v of Object.values(inst.exports)) if (v instanceof WebAssembly.Memory) window.__rc.memories.push(v); } catch {} return res; };
  const oi = WebAssembly.instantiate; WebAssembly.instantiate = function (...a) { return oi.apply(this, a).then(rec); };
  const ois = WebAssembly.instantiateStreaming; if (ois) WebAssembly.instantiateStreaming = function (...a) { return ois.apply(this, a).then(rec); };
};

async function snap(page, cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const r = await page.evaluate(() => ({ live: { ...window.__rc.live }, wasm: window.__rc.memories.map((m) => m.buffer.byteLength), vp: window.__knap.getState().viewport, hist: window.__knap.getState().historySize, canvases: document.querySelectorAll('canvas').length, inputs: document.querySelectorAll('input[type=file]').length }));
  return { heapMB: +(heap.usedSize / 1e6).toFixed(2), ...r };
}

const probes = {
  async idleFrames({ page }) {
    await settle(page);
    const out = {};
    const count = async (label, ms = 3000) => {
      const r0 = (await st(page)).viewport.renders;
      const f0 = await page.evaluate(() => window.__rc.live.raf);
      await sleep(ms);
      const r1 = (await st(page)).viewport.renders;
      const f1 = await page.evaluate(() => window.__rc.live.raf);
      out[label] = { renders: r1 - r0, rafs: f1 - f0 };
    };
    await count('edit-idle-no-pointer');
    const p = await page.evaluate(() => window.__knap.partScreenPos(1));
    await page.mouse.move(p.x, p.y);
    await frames(page, 2);
    await count('edit-idle-pointer-resting-on-part');
    await page.keyboard.press('1');
    await frames(page, 2);
    await count('edit-idle-build-tool-ghost');
    await page.keyboard.press('k');
    await frames(page, 2);
    await count('edit-idle-kinematics');
    await page.keyboard.press('k');
    await page.evaluate(() => window.__knap.setMode('simulate'));
    await page.keyboard.press('Space');
    await frames(page, 2);
    out.paused = (await st(page)).paused;
    await count('sim-paused');
    await page.keyboard.press('Escape');
    await frames(page, 2);
    await count('after-stop');
    await page.keyboard.press('?');
    await frames(page, 2);
    await count('help-open');
    return out;
  },

  async playStopCycles({ page }) {
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => window.__knap.loadExample('collision'));
    await settle(page);
    const s = [];
    s.push(await snap(page, cdp));
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.__knap.setMode('simulate'));
      await page.evaluate(() => window.__knap.stepSim(4));
      await frames(page, 1);
      await page.keyboard.press('Escape');
      if (i === 0 || i === 9 || i === 29) s.push(await snap(page, cdp));
    }
    return s;
  },

  async exampleLoads({ page }) {
    const cdp = await page.context().newCDPSession(page);
    const names = await page.evaluate(() => [...document.querySelectorAll('[data-example]')].map((b) => b.dataset.example));
    const s = [await snap(page, cdp)];
    for (let i = 0; i < 30; i++) {
      await page.evaluate((n) => window.__knap.loadExample(n), names[i % names.length]);
      await frames(page, 1);
      if (i === 6 || i === 13 || i === 29) s.push(await snap(page, cdp));
    }
    return { names, s };
  },
};
for (const p of Object.values(probes)) p.init = init;

await runProbes(probes);
