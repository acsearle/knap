/**
 * e2e/lib.mjs — tiny helpers for browser end-to-end scripts (Playwright + vite preview).
 *
 * HOW TO ADD A SCRIPT
 *   Create `e2e/<name>.e2e.mjs` exporting a default async function. `npm run e2e` builds the app
 *   once, serves dist/ with `vite preview` on a free port, launches one headless Chromium (with
 *   SwiftShader WebGL2) and calls every script in turn with a fresh page:
 *
 *     // e2e/example.e2e.mjs
 *     export default async function ({ page, url, shot, assert, step }) {
 *       await step('load', () => page.goto(url));          // labelled step (shown in output)
 *       await page.waitForFunction(() => window.__knap);    // wait for app readiness
 *       assert(await page.title() === 'knap', 'title');     // throws with message on failure
 *       await shot('example-loaded');                       // -> e2e/out/example-loaded.png
 *     }
 *
 *   The run fails if a script throws, or if the page logs any console.error / uncaught
 *   exception (collected in `errors`; call `errors.length = 0` inside a script to forgive
 *   expected ones). Warnings are printed but do not fail.
 *
 *   Run all:          npm run e2e
 *   Run some:         npm run e2e -- smoke example     (matches e2e/<name>.e2e.mjs)
 *   Skip the build:   E2E_NO_BUILD=1 npm run e2e        (reuse existing dist/)
 *   Own build dir:    E2E_DIST=e2e/out/me-dist npm run e2e   (build into / serve that directory instead
 *                     of dist/, so concurrent runs on one machine do not overwrite each other's build)
 *   Watch it:         E2E_HEADED=1 npm run e2e
 *
 * USING THE HELPERS DIRECTLY (e.g. a one-off script run with `node e2e/foo.mjs`):
 *
 *     import { buildApp, startServer, launchBrowser, openPage } from './lib.mjs';
 *     await buildApp();
 *     const server = await startServer();            // { url, close() }
 *     const browser = await launchBrowser();
 *     const ctx = await openPage(browser, server.url, 'foo');   // { page, url, errors, shot, assert, step, close }
 *     await ctx.page.goto(ctx.url); await ctx.shot('foo');
 *     await ctx.close(); await browser.close(); await server.close();
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'e2e', 'out');
/** The build that is served: dist/, or $E2E_DIST (relative to the project root). */
export const DIST_DIR = process.env.E2E_DIST ? resolve(ROOT, process.env.E2E_DIST) : join(ROOT, 'dist');

/** Production build of the app into DIST_DIR (quiet). */
export async function buildApp() {
  await build({ root: ROOT, logLevel: 'warn', build: { outDir: DIST_DIR, emptyOutDir: true } });
}

/** Find a free TCP port on 127.0.0.1. */
export function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

/** Serve DIST_DIR with vite preview on a free port. Returns { url, close }. */
export async function startServer() {
  const port = await freePort();
  const server = await preview({
    root: ROOT,
    logLevel: 'warn',
    build: { outDir: DIST_DIR },
    preview: { host: '127.0.0.1', port, strictPort: true, open: false },
  });
  const url = `http://127.0.0.1:${port}/`;
  return {
    url,
    close: () => new Promise((res) => server.httpServer.close(() => res(undefined))),
  };
}

/** Headless Chromium with a software WebGL2 implementation (SwiftShader via ANGLE). */
export async function launchBrowser({ headed = !!process.env.E2E_HEADED } = {}) {
  return chromium.launch({
    headless: !headed,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

/**
 * Open a fresh page (own context) with console/pageerror collection and helpers.
 * @param {import('playwright').Browser} browser
 * @param {string} url  server base url
 * @param {string} name used to prefix log lines
 * @param {{ width?: number, height?: number, deviceScaleFactor?: number }} [viewport]
 */
export async function openPage(browser, url, name, viewport = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width ?? 1280, height: viewport.height ?? 720 },
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
  });
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') errors.push(`console.error: ${msg.text()}`);
    // SwiftShader emits "GPU stall due to ReadPixels" performance notes on every readback.
    else if (type === 'warning' && !/GPU stall due to ReadPixels/.test(msg.text()))
      console.log(`  [${name}] console.warn: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) =>
    errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`),
  );

  await mkdir(OUT_DIR, { recursive: true });
  return {
    page,
    url,
    errors,
    /** Screenshot the viewport (or pass Playwright options) to e2e/out/<file>.png. */
    async shot(file, options = {}) {
      const path = join(OUT_DIR, `${file}.png`);
      await page.screenshot({ path, ...options });
      console.log(`  [${name}] screenshot ${path}`);
      return path;
    },
    /** Throw with a message unless cond is truthy. */
    assert(cond, message) {
      if (!cond) throw new Error(`assertion failed: ${message}`);
    },
    /** Run a labelled step, printing its name and duration. */
    async step(label, fn) {
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        console.log(`  [${name}] ${label} (${Date.now() - t0} ms)`);
      }
    },
    close: () => context.close(),
  };
}
