// Review: FatLines segment-count growth after the first render (three.js caches
// geometry._maxInstanceCount on first draw). node e2e/review-view-fatlines.mjs
import { join } from 'node:path';
import { OUT_DIR, check, harness, results } from './review-view-lib.mjs';

const H = await harness();
try {
  const c = await H.open('example=four-bar&anim=0&grid=0&root=0', { width: 900, height: 600 });
  const p = c.page;
  const countMagenta = `(() => {
    const vp = window.__view.vp; vp.renderNow();
    const gl = vp.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 150 && px[i + 1] < 90 && px[i + 2] > 90) n++;
    return n;
  })()`;
  const glyph = (x) => ({ type: 'revolute', origin: [x, 3, 0], axis: 2 });
  // all four at once (fresh FatLines): reference
  const c2 = await H.open('example=four-bar&anim=0&grid=0&root=0', { width: 900, height: 600 });
  await c2.page.evaluate((g) => window.__view.vp.setJointGlyphs(g), [glyph(-2), glyph(0), glyph(2), glyph(4)]);
  const ref = await c2.page.evaluate(countMagenta);
  await c2.close();
  // one glyph first, rendered, then four
  await p.evaluate((g) => window.__view.vp.setJointGlyphs(g), [glyph(-2)]);
  const one = await p.evaluate(countMagenta);
  await p.evaluate((g) => window.__view.vp.setJointGlyphs(g), [glyph(-2), glyph(0), glyph(2), glyph(4)]);
  const four = await p.evaluate(countMagenta);
  await p.screenshot({ path: join(OUT_DIR, 'review-view-glyphs-grow.png') });
  check('glyphs: 1 → 4 glyphs after a render draws all four rings (magenta px ≈ reference)', four > 0.9 * ref, { one, four, ref });

  // cube hover: a face first (4 segments), then a corner (12)
  const r = await p.evaluate(() => {
    const vp = window.__view.vp;
    vp.cube.setHover([0, 1, 0]); vp.renderNow();
    vp.cube.setHover([1, 1, 1]); vp.renderNow();
    const g = vp.cube.hoverEdges.geometry;
    return { instanceCount: g.instanceCount, maxInstanceCount: g._maxInstanceCount };
  });
  check('cube hover: corner outline after a face hover draws all 12 segments', r.maxInstanceCount === undefined || r.maxInstanceCount >= r.instanceCount, r);
  await p.screenshot({ path: join(OUT_DIR, 'review-view-cube-corner-after-face.png'), clip: { x: 760, y: 0, width: 140, height: 130 } });
} finally {
  await H.done();
}
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
