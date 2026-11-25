// Review screenshots for configurations the geometry gallery misses: e2e/out/review-geom-*.png
//   node e2e/review-geom.mjs
import { join } from 'node:path';
import { OUT_DIR, launchBrowser, openPage } from './lib.mjs';
import { startDevServer } from './geom-gallery.mjs';

const SHOTS = [
  { file: 'review-geom-iso', query: 'view=iso&tile=300&cols=4' },
  { file: 'review-geom-back', query: 'view=back&tile=300&cols=4' },
  { file: 'review-geom-under', query: 'view=under&tile=300&cols=4' },
  { file: 'review-geom-side', query: 'view=side&tile=300&cols=4&edges=0' },
  { file: 'review-geom-front-noedges', query: 'view=front&tile=300&cols=4&edges=0' },
];
const server = await startDevServer();
const browser = await launchBrowser();
const ctx = await openPage(browser, server.url, 'review-geom');
let code = 0;
try {
  for (const s of SHOTS) {
    await ctx.page.goto(`${server.url}e2e/review-geom.html?${s.query}`);
    await ctx.page.waitForFunction(() => window.__galleryReady || window.__galleryError, null, { timeout: 60000 });
    const err = await ctx.page.evaluate(() => window.__galleryError);
    if (err) throw new Error(err);
    const size = await ctx.page.evaluate(() => { const w = document.getElementById('wrap'); return { w: w.offsetWidth, h: w.offsetHeight }; });
    await ctx.page.setViewportSize({ width: size.w, height: size.h });
    await ctx.page.screenshot({ path: join(OUT_DIR, `${s.file}.png`), clip: { x: 0, y: 0, width: size.w, height: size.h } });
    console.log(`  ${join(OUT_DIR, `${s.file}.png`)}`);
  }
  if (ctx.errors.length) throw new Error(ctx.errors.join('\n'));
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await ctx.close();
  await browser.close();
  await server.close();
}
process.exit(code);
