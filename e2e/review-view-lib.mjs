// Shared helpers for the independent review scripts e2e/review-view*.mjs (not part of `npm run e2e`).
// Serves the repo with a Vite dev server and opens e2e/view-demo.html.
import { OUT_DIR, launchBrowser, openPage } from './lib.mjs';
import { startDevServer } from './geom-gallery.mjs';

export { OUT_DIR };

export async function harness() {
  const server = await startDevServer();
  const browser = await launchBrowser();
  const opened = [];
  async function open(query, viewport = {}) {
    const c = await openPage(browser, server.url, 'review-view', viewport);
    opened.push(c);
    await c.page.goto(`${server.url}e2e/view-demo.html?${query}`);
    await c.page.waitForFunction(() => window.__view?.ready || window.__viewError, null, { timeout: 90000 });
    const err = await c.page.evaluate(() => window.__viewError);
    if (err) throw new Error(`demo error for ${query}: ${err}`);
    return c;
  }
  async function done() {
    for (const c of opened) await c.close().catch(() => {});
    await browser.close();
    await server.close();
  }
  return { server, browser, open, done };
}

/** In-page: read the drawing buffer (after a synchronous render) as {w,h,px} with y flipped to top-down. */
export const READBACK = `(() => {
  const vp = window.__view.vp;
  vp.renderNow();
  const gl = vp.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return { w, h, px: Array.from(out) };
})()`;

export const results = [];
export function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}
