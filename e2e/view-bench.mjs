// Frame-time benchmark of the view demo on the machine's real GPU (headless Chromium, ANGLE/Metal on
// macOS; drop --use-angle=metal elsewhere). Not part of npm run e2e.   node e2e/view-bench.mjs
import { chromium } from 'playwright';
import { startDevServer } from './geom-gallery.mjs';
const server = await startDevServer();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [q, w, h, d] of [['example=four-bar&glyphs=1&sel=3', 1280, 720, 1], ['example=all&glyphs=1', 1280, 720, 1], ['example=all&glyphs=1', 1280, 720, 2], ['example=all&glyphs=1', 1920, 1080, 2]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: d });
  const page = await ctx.newPage();
  await page.goto(`${server.url}e2e/view-demo.html?${q}`);
  await page.waitForFunction(() => window.__view?.ready, null, { timeout: 60000 });
  const r = await page.evaluate(() => {
    const gl = window.__view.vp.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    window.__view.benchmark(5);
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?', ms: window.__view.benchmark(40), sel: window.__view.stats() };
  });
  console.log(q, `${w}x${h}@${d}`, r.gpu, r.ms.toFixed(2), 'ms/frame', 'ss', r.sel.supersample, 'parts', r.sel.parts);
  await ctx.close();
}
await browser.close(); await server.close();
