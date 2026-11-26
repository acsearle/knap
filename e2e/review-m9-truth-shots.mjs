// Reviewer "truth": screenshots of overlaps the view draws that the simulation ignores.
//   E2E_DIST=e2e/out/review-m9-truth-dist node e2e/review-m9-truth-shots.mjs  → e2e/out/review-m9-truth-*.png
import { launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp } from './app-lib.mjs';
const server = await startServer();
const browser = await launchBrowser();
const ctx = await openPage(browser, server.url, 'review-m9-truth-shots', { width: 1280, height: 720 });
const { page } = ctx;
await openApp(page, ctx.url);
const K = (fn, a) => page.evaluate(fn, a);
for (const [name, file] of [['gear-train', 'geartrain'], ['four-bar', 'fourbar'], ['crank-wheel', 'crankwheel']]) {
  await K((n) => window.__knap.loadExample(n), name);
  await K(() => window.__knap.setShowColliders(true));
  await K(() => window.__knap.setView('front'));
  await K(() => window.__knap.fit());
  await page.mouse.move(700, 712);
  await frames(page, 4);
  await ctx.shot(`review-m9-truth-${file}-front`);
  await K(() => window.__knap.home());
  await frames(page, 4);
  await ctx.shot(`review-m9-truth-${file}-home`);
}
console.log(ctx.errors.join('\n') || 'no page errors');
await ctx.close(); await browser.close(); await server.close();
