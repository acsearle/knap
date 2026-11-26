// Reviewer "verify-ui" (milestone 7 fixes): shared helpers. Run scripts with
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-<name>.mjs
// (build first with the helper in the scratchpad, or E2E_DIST=… and buildApp()).
import { launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp } from './app-lib.mjs';

export const C = (x, y, z, kind = 'pinHole', axis = 2, rim) => ({ x, y, z, kind, axis, ...(rim ? { rim } : {}) });
export const beamX = (n, y = 0, z = 0, x0 = 0) => Array.from({ length: n }, (_, i) => C(x0 + i, y, z));
export const PAL = ['#e0b43c', '#e07b2e', '#c8433a', '#4c9a57', '#3b74c4', '#e8e8e4', '#a8adb2', '#5f6468'];
export const PAL_NAMES = ['yellow', 'orange', 'red', 'green', 'blue', 'white', 'lgrey', 'dgrey'];
export const M = (parts, extra = {}) => ({
  version: 1,
  rootPartId: null,
  nextPartId: parts.length + 1,
  ground: true,
  fixRoot: false,
  ...extra,
  parts: parts.map((p, i) => ({ id: i + 1, color: p.color ?? '#a8adb2', cells: p.cells ?? p })),
});
export const K = (page, fn, arg) => page.evaluate(fn, arg);
export const setModel = (page, m) => K(page, (m) => window.__knap.setModel(m), m);
export const setCam = (page, c) => K(page, (c) => window.__knap.setCamera(c), c);
export const cam = (page) => K(page, () => window.__knap.camera());

/** Start the server + browser once; `open(name, viewport)` gives a fresh app page. */
export async function session() {
  const server = await startServer();
  const browser = await launchBrowser();
  const ctxs = [];
  return {
    server,
    browser,
    async open(name, viewport = {}) {
      const ctx = await openPage(browser, server.url, name, viewport);
      ctxs.push(ctx);
      await openApp(ctx.page, server.url);
      await frames(ctx.page, 2);
      return ctx;
    },
    async close() {
      for (const c of ctxs) await c.close().catch(() => {});
      await browser.close();
      await server.close();
    },
  };
}

/** Pixel colour statistics of a client rectangle (from a fresh render), via the test hook. */
export async function pixels(page, pts) {
  return K(page, (pts) => pts.map(([x, y]) => window.__knap.pixelAt(x, y)), pts);
}

export const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
