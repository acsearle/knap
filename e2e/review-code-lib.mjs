// Reviewer "code" harness: builds the app into a private outDir (so parallel reviewers'
// builds of dist/ do not interfere), serves it, and runs probe functions.
import { join } from 'node:path';
import { build, preview } from 'vite';
import { ROOT, OUT_DIR, freePort, launchBrowser, openPage } from './lib.mjs';
import { openApp } from './app-lib.mjs';

export const DIST = join(OUT_DIR, 'review-code-dist');

export async function buildPrivate() {
  if (process.env.RC_NO_BUILD) return;
  await build({ root: ROOT, logLevel: 'warn', build: { outDir: DIST, emptyOutDir: true } });
}

export async function serve() {
  const port = await freePort();
  const server = await preview({ root: ROOT, logLevel: 'warn', build: { outDir: DIST }, preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.httpServer.close(() => r())) };
}

/** Run named probes: each gets a fresh page with the app open. Prints JSON results. */
export async function runProbes(probes, only = process.argv.slice(2)) {
  await buildPrivate();
  const server = await serve();
  const browser = await launchBrowser();
  const results = {};
  try {
    for (const [name, fn] of Object.entries(probes)) {
      if (only.length && !only.includes(name)) continue;
      const ctx = await openPage(browser, server.url, `rc-${name}`, fn.viewport ?? {});
      try {
        if (fn.init) await ctx.page.addInitScript(fn.init);
        if (!fn.noOpen) await openApp(ctx.page, ctx.url);
        const t0 = Date.now();
        results[name] = await fn(ctx);
        console.log(`[${name}] (${Date.now() - t0} ms)`, JSON.stringify(results[name]));
        if (ctx.errors.length) console.log(`[${name}] page errors:`, ctx.errors.slice(0, 5));
      } catch (e) {
        results[name] = { probeError: String(e && e.stack ? e.stack : e) };
        console.log(`[${name}] PROBE ERROR`, e);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return results;
}

export const st = (page) => page.evaluate(() => window.__knap.getState());
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
