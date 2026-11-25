// Geometry gallery screenshots: e2e/out/geom-*.png.
//
//   node e2e/geom-gallery.mjs          (standalone; also run by `npm run e2e` via geom-gallery.e2e.mjs)
//   GEOM_GALLERY_PROD=1 node e2e/geom-gallery.mjs   (production bundle instead of the dev server)
//
// Serves the repo with a Vite *dev* server (so e2e/geom-gallery.html needs no build entry in
// vite.config.ts), or builds the gallery page alone into e2e/out/geom-dist and serves that with
// `vite preview` (proves the manifold WASM loads from the bundle). Renders
// e2e/geom-gallery-page.ts in headless Chromium and writes one PNG per view.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, createServer, preview } from 'vite';
import { OUT_DIR, ROOT, freePort, launchBrowser, openPage } from './lib.mjs';

export const SHOTS = [
  { file: 'geom-gallery-iso', query: 'view=iso' },
  { file: 'geom-gallery-back', query: 'view=back' },
  { file: 'geom-gallery-noedges', query: 'view=iso&edges=0' },
  {
    file: 'geom-detail-holes',
    query: 'view=iso&tile=420&cols=3&only=' +
      encodeURIComponent('5-hole liftarm,2×2 block,double-thick beam,perp. connector ring↔wall,perp. connector wall↔wall,blind hole (T of holes)'),
  },
  {
    file: 'geom-detail-males',
    query: 'view=oblique&tile=420&cols=3&only=' +
      encodeURIComponent('4-long axle,2-long pin,2-long friction pin,axle-pin,liftarm + side pin,axle hole + pin hole coaxial'),
  },
  {
    file: 'geom-detail-ends',
    query: 'view=front&tile=420&cols=3&edges=0&only=' +
      encodeURIComponent('axle hole,axle,friction pin,axle hole + pin hole coaxial,axle hole liftarm,3-axis hub'),
  },
];

/** Start a Vite dev server on the repo root. Returns { url, close }. */
export async function startDevServer() {
  const port = await freePort();
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port, strictPort: true, open: false, hmr: false },
  });
  await server.listen();
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}

/** Build only the gallery page into e2e/out/geom-dist and serve it with vite preview. */
export async function startProdServer() {
  const outDir = join(OUT_DIR, 'geom-dist');
  await build({
    root: ROOT,
    logLevel: 'warn',
    build: { outDir, emptyOutDir: true, rollupOptions: { input: join(ROOT, 'e2e', 'geom-gallery.html') } },
  });
  const port = await freePort();
  const server = await preview({
    root: ROOT,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', port, strictPort: true, open: false },
  });
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((res) => server.httpServer.close(() => res(undefined))),
  };
}

/** Render every shot with the given page context (from lib.openPage). */
export async function renderGallery(ctx, baseUrl) {
  const { page, assert, step } = ctx;
  const stats = [];
  for (const s of SHOTS) {
    await step(`render ${s.file}`, async () => {
      await page.goto(`${baseUrl}e2e/geom-gallery.html?${s.query}`);
      await page.waitForFunction(() => window.__galleryReady || window.__galleryError, null, { timeout: 60000 });
      const err = await page.evaluate(() => window.__galleryError);
      assert(!err, `gallery error: ${err}`);
      const size = await page.evaluate(() => {
        const w = document.getElementById('wrap');
        return { w: w.offsetWidth, h: w.offsetHeight };
      });
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.screenshot({ path: join(OUT_DIR, `${s.file}.png`), clip: { x: 0, y: 0, width: size.w, height: size.h } });
      console.log(`  [geom-gallery] screenshot ${join(OUT_DIR, `${s.file}.png`)}`);
      if (s.file === 'geom-gallery-iso') stats.push(...(await page.evaluate(() => window.__galleryStats)));
    });
  }
  for (const st of stats) console.log(`  [geom-gallery] ${st.name}: ${st.triangles} tri, ${st.vertices} vert, ${st.ms.toFixed(1)} ms`);
  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = process.env.GEOM_GALLERY_PROD ? await startProdServer() : await startDevServer();
  const browser = await launchBrowser();
  const ctx = await openPage(browser, server.url, 'geom-gallery');
  let code = 0;
  try {
    await renderGallery(ctx, server.url);
    if (ctx.errors.length) throw new Error(`page errors:\n    ${ctx.errors.join('\n    ')}`);
  } catch (err) {
    console.error(err);
    code = 1;
  } finally {
    await ctx.close();
    await browser.close();
    await server.close();
  }
  process.exit(code);
}
