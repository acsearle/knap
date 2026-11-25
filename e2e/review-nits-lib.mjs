// Review helpers (nits review): serve the review build (e2e/out/review-nits-dist), open pages with
// a three.js devtools observer installed so the root marker's own line meshes can be found, and
// measure the marker FROM PIXELS (render with / without the marker, diff the drawing buffer).
import { join } from 'node:path';
import { preview } from 'vite';
import { ROOT, freePort, launchBrowser, openPage } from './lib.mjs';
import { openApp } from './app-lib.mjs';

export const DIST = 'e2e/out/review-nits-dist';

export async function startReviewServer() {
  const port = await freePort();
  const server = await preview({
    root: ROOT,
    logLevel: 'warn',
    build: { outDir: join(ROOT, DIST) },
    preview: { host: '127.0.0.1', port, strictPort: true, open: false },
  });
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.httpServer.close(() => r(undefined))) };
}

/** Installed before the app: collect renderers and scenes three.js announces. */
const OBSERVER = () => {
  const t = new EventTarget();
  window.__obs = { renderers: [], scenes: [] };
  t.addEventListener('observe', (e) => {
    const d = e.detail;
    if (d && d.isWebGLRenderer) window.__obs.renderers.push(d);
    else if (d && d.isScene) window.__obs.scenes.push(d);
  });
  window.__THREE_DEVTOOLS__ = t;
};

export async function reviewSetup() {
  const server = await startReviewServer();
  const browser = await launchBrowser();
  const open = async (name, viewport = {}) => {
    const ctx = await openPage(browser, server.url, name, viewport);
    await ctx.page.addInitScript(OBSERVER);
    await openApp(ctx.page, server.url);
    await ctx.page.evaluate(installMarkerProbe);
    return ctx;
  };
  return { server, browser, open, close: async () => { await browser.close(); await server.close(); } };
}

/** In page: window.__markDiff() → pixel measurement of the root marker as drawn. */
function installMarkerProbe() {
  const findMarkMeshes = () => {
    const out = [];
    for (const s of window.__obs.scenes)
      s.traverse((o) => {
        if (o.material && o.material.uniforms && o.material.uniforms.uFadeTex) out.push(o);
      });
    return out;
  };
  window.__markDiff = (opts = {}) => {
    const r = window.__obs.renderers.find((x) => x.domElement && x.domElement.classList.contains('kv-canvas')) ?? window.__obs.renderers[0];
    const gl = r.getContext();
    const meshes = findMarkMeshes();
    const canvas = r.domElement;
    const W = canvas.width;
    const H = canvas.height;
    const read = () => {
      r.setRenderTarget(null);
      const buf = new Uint8Array(W * H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    };
    const info = window.__knap.rootMarker(true); // renders now (marker on)
    const A = read();
    const saved = meshes.map((m) => m.material.uniforms.uOpacity.value);
    meshes.forEach((m) => (m.material.uniforms.uOpacity.value = 0));
    window.__knap.rootMarker(true); // render again, marker transparent
    const B = read();
    meshes.forEach((m, i) => (m.material.uniforms.uOpacity.value = saved[i]));
    window.__knap.rootMarker(true);
    const dpr = W / canvas.clientWidth;
    const rect = canvas.getBoundingClientRect();
    let n = 0, dark = 0, light = 0, sx = 0, sy = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    let darkSum = 0, lightSum = 0, maxDark = 0;
    const L = (b, i) => 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d < 24) continue;
        const cx = x / dpr;
        const cy = (H - 1 - y) / dpr;
        n++;
        sx += cx;
        sy += cy;
        x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
        const dl = L(A, i) - L(B, i);
        if (dl < -20) { dark++; darkSum += -dl; maxDark = Math.max(maxDark, -dl); }
        if (dl > 20) { light++; lightSum += dl; }
      }
    const px = (v) => Math.round(v * 100) / 100;
    return {
      hook: info,
      n: Math.round(n / (dpr * dpr)),
      dark: Math.round(dark / (dpr * dpr)),
      light: Math.round(light / (dpr * dpr)),
      meanDark: dark ? px(darkSum / dark) : 0,
      maxDark: px(maxDark),
      meanLight: light ? px(lightSum / light) : 0,
      cx: n ? px(rect.left + sx / n) : null,
      cy: n ? px(rect.top + sy / n) : null,
      bbox: n ? [px(rect.left + x0), px(rect.top + y0), px(rect.left + x1), px(rect.top + y1)] : null,
    };
  };
}

export const markDiff = (page) => page.evaluate(() => window.__markDiff());
