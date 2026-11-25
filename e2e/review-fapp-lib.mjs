// Review "fapp" helpers (not part of `npm run e2e`). Serves a prebuilt dist directory
// (default e2e/out/fapp-dist; FAPP_DIST env overrides, e.g. a HEAD build) with vite preview.
import { join } from 'node:path';
import { preview } from 'vite';
import { OUT_DIR, ROOT, freePort, launchBrowser, openPage } from './lib.mjs';
import { openApp } from './app-lib.mjs';

export { OUT_DIR };
export const DIST = process.env.FAPP_DIST || join(OUT_DIR, 'fapp-dist');
export const EXAMPLES = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision'];
export const HZ = 480;

export async function harness() {
  const port = await freePort();
  const server = await preview({ root: ROOT, logLevel: 'warn', build: { outDir: DIST }, preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
  const url = `http://127.0.0.1:${port}/`;
  const browser = await launchBrowser();
  const opened = [];
  async function open(name = 'review-fapp', viewport = {}, { init } = {}) {
    const c = await openPage(browser, url, name, viewport);
    if (init) await c.page.addInitScript(init);
    opened.push(c);
    await openApp(c.page, url);
    return c;
  }
  async function done() {
    for (const c of opened) await c.close().catch(() => {});
    await browser.close();
    await new Promise((res) => server.httpServer.close(() => res(undefined)));
  }
  return { url, browser, open, done };
}

export const results = [];
export function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

export const ev = (page, fn, arg) => page.evaluate(fn, arg);

/** Step n fixed steps in chunks. */
export async function stepN(page, n) {
  for (let done = 0; done < n; ) {
    const k = Math.min(480, n - done);
    await page.evaluate((k) => window.__knap.stepSim(k), k);
    done += k;
  }
}

export const qAngle = (a, b) => {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
};
