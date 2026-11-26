// Reviewer "truth": frame rate while simulating, colliders off vs on (SwiftShader: ratio only).
//   E2E_DIST=e2e/out/review-m9-truth-dist node e2e/review-m9-truth-fps.mjs
import { launchBrowser, openPage, startServer } from './lib.mjs';
import { openApp } from './app-lib.mjs';
const server = await startServer();
const browser = await launchBrowser();
const ctx = await openPage(browser, server.url, 'review-m9-truth-fps', { width: 1280, height: 720 });
const { page } = ctx;
await openApp(page, ctx.url);
const K = (fn, a) => page.evaluate(fn, a);
for (const name of ['cart', 'collision', 'gear-train']) {
  await K((n) => window.__knap.loadExample(n), name);
  await K(() => window.__knap.setMode('simulate'));
  const r = {};
  for (const on of [false, true, false, true]) {
    await K((on) => window.__knap.setShowColliders(on), on);
    const f = await K(() => window.__knap.frameRate(3000));
    (r[on ? 'on' : 'off'] ??= []).push(+(f.frames / (f.ms / 1000)).toFixed(1));
  }
  await K(() => window.__knap.setMode('edit'));
  console.log(name, JSON.stringify(r), 'fps ratio off/on', (r.off.reduce((a, b) => a + b) / r.on.reduce((a, b) => a + b)).toFixed(2));
}
await ctx.close(); await browser.close(); await server.close();
