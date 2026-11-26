// Review helpers (wheels UI review): serve the review build (e2e/out/review-wheels-dist), open pages,
// small utilities. Run scripts with `node e2e/review-wheels-<name>.mjs`.
import { join } from 'node:path';
import { preview } from 'vite';
import { ROOT, freePort, launchBrowser, openPage } from './lib.mjs';
import { openApp } from './app-lib.mjs';

export const DIST = 'e2e/out/review-wheels-dist';

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

export async function reviewSetup() {
  const server = await startReviewServer();
  const browser = await launchBrowser();
  const open = async (name, viewport = {}, { app = true } = {}) => {
    const ctx = await openPage(browser, server.url, name, viewport);
    if (app) await openApp(ctx.page, server.url);
    return ctx;
  };
  return { server, browser, open, close: async () => { await browser.close(); await server.close(); } };
}

export const canon = (v) =>
  JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** Finding log: print and collect. */
export function findings() {
  const list = [];
  return {
    list,
    ok: (msg) => console.log(`  OK   ${msg}`),
    bad: (msg) => { list.push(msg); console.log(`  BAD  ${msg}`); },
    note: (msg) => console.log(`  ..   ${msg}`),
    check(cond, msg) { if (cond) this.ok(msg); else this.bad(msg); return cond; },
  };
}

/** Deterministic PRNG. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
