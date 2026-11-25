// Reviewer "code": error paths (sim failure, WebGL unavailable, corrupt autosave, context loss),
// and how long the 'starting' window lasts on a cold first Play.
import { runProbes, st, sleep } from './review-code-lib.mjs';
import { frames } from './app-lib.mjs';

const probes = {
  async coldStartWindow({ page }) {
    return page.evaluate(async () => {
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      while (window.__knap.getState().mode === 'starting') await new Promise((r) => setTimeout(r, 1));
      return { startingMs: Math.round(performance.now() - t0) };
    });
  },

  async simFailure({ page, shot }) {
    await page.evaluate(() => window.__knap.setMode('simulate'));
    const injected = await page.evaluate(() => window.__knap.injectSimFault());
    await frames(page, 3);
    const s = await st(page);
    await shot('review-code-simfail');
    const tr = await page.evaluate(() => window.__knap.simTransforms());
    // Play again after a failure
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode !== 'starting');
    const s2 = await st(page);
    return { injected, mode: s.mode, banner: s.banner, msg: s.message, grid: null, transformsIdentity: Object.values(tr).every((t) => t && t.p.join() === '0,0,0'), replayMode: s2.mode, bannerAfterReplay: s2.banner };
  },

  async simFailureOnStep({ page }) {
    await page.keyboard.press('.');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    await page.evaluate(() => window.__knap.injectSimFault());
    await page.keyboard.press('.');
    await sleep(50);
    const s = await st(page);
    return { mode: s.mode, banner: s.banner, readout: await page.textContent('[data-role=sim-time]') };
  },

  async contextLossDuringFailureBanner({ page }) {
    await page.evaluate(() => window.__knap.openText('bad.json', '{'));
    const b0 = (await st(page)).banner;
    const r = await page.evaluate(async () => {
      const c = document.querySelector('canvas');
      const gl = c.getContext('webgl2');
      const ext = gl.getExtension('WEBGL_lose_context');
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 100));
      const during = window.__knap.getState().banner;
      ext.restoreContext();
      await new Promise((r) => setTimeout(r, 300));
      return { during, after: window.__knap.getState().banner, msg: window.__knap.getState().message.text };
    });
    return { bannerBefore: b0, ...r };
  },
};

const noWebgl = async ({ page }) => {
  await page.goto(page.url().startsWith('http') ? page.url() : '');
  return {};
};
void noWebgl;

const webglUnavailable = async ({ page, url, shot }) => {
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  await shot('review-code-nowebgl');
  return { ready: await page.evaluate(() => document.body.dataset.ready), text: (await page.textContent('#app')).slice(0, 400) };
};
webglUnavailable.noOpen = true;
webglUnavailable.init = () => {
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/.test(t)) return null; return gc.call(this, t, ...a); };
};
probes.webglUnavailable = webglUnavailable;

const corrupt = async ({ page, url }) => {
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  const s = await st(page);
  return { ready: await page.evaluate(() => document.body.dataset.ready), banner: s.banner, msg: s.message, parts: (await page.evaluate(() => window.__knap.getModel())).parts.length, corruptKept: await page.evaluate(() => localStorage.getItem('knap.autosave.v1.corrupt')) };
};
corrupt.noOpen = true;
corrupt.init = () => {
  if (!sessionStorage.getItem('rc-once')) {
    sessionStorage.setItem('rc-once', '1');
    localStorage.setItem('knap.autosave.v1', '{"version":1,"parts":[{"id":1}]}');
  }
};
probes.corruptAutosave = corrupt;

await runProbes(probes);
