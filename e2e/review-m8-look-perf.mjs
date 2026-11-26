// Reviewer "look" (m8): frame time and triangle counts, gears vs plain wheels (SwiftShader).
//   E2E_DIST=e2e/out/review-m8-look-dist node e2e/review-m8-look-perf.mjs
import { K, cell, gear, model, save, session, setModel, VPJS } from './review-m8-look-lib.mjs';
import { frames } from './app-lib.mjs';

const S = await session();
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
const tris = (page) => page.evaluate(`(() => { const vp = ${VPJS}; const r = vp.renderer; r.info.autoReset = false; r.info.reset(); vp.renderNow(); const t = r.info.render.triangles; const c = r.info.render.calls; r.info.autoReset = true; return t + ' tris / ' + c + ' calls'; })()`);
const timing = async (page) => {
  const meds = [];
  for (let r = 0; r < 3; r++) {
    const t = await page.evaluate(`(() => { const vp = ${VPJS}; const gl = vp.renderer.getContext(); const px = new Uint8Array(4); const out = [];
      vp.renderNow(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < 9; i++) { const t0 = performance.now(); vp.renderNow(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(performance.now() - t0); } return out; })()`);
    t.sort((a, b) => a - b);
    meds.push(t[4]);
  }
  return Math.min(...meds);
};
try {
  for (const dpr of [1, 2]) {
    const { page } = await S.open(`look-perf-${dpr}`, { width: 1280, height: 800, deviceScaleFactor: dpr });
    const res = {};
    const run = async (name, setup) => {
      await setup();
      await K(page, () => window.__knap.home());
      await frames(page, 3);
      res[name] = { ms: await timing(page), tri: await tris(page) };
      log(`DPR ${dpr} ${name}: ${res[name].ms.toFixed(1)} ms/frame (min of 3 medians of 9 sync renders), ${res[name].tri} drawn per render (all passes)`);
    };
    await run('gear-train (edit)', async () => { await K(page, () => window.__knap.loadExample('gear-train')); });
    await run('gear-train no teeth (8s bare, others plain wheels)', async () => {
      const m = await K(page, () => { window.__knap.loadExample('gear-train'); return window.__knap.getModel(); });
      for (const p of m.parts) for (const c of p.cells) if (c.teeth) { delete c.teeth; if (c.rim === 0.5) delete c.rim; }
      m.version = 2;
      await setModel(page, m);
    });
    await run('gear-train sim t=0.5', async () => { await K(page, () => window.__knap.loadExample('gear-train')); await K(page, () => window.__knap.stepSim(240)); });
    await K(page, () => window.__knap.setMode('edit'));
    const grid = (f) => Array.from({ length: 12 }, (_, i) => ({ color: '#e0b43c', cells: [f((i % 4) * 6, 0, Math.floor(i / 4) * 6)] }));
    await run('12 x 40-tooth gears', () => setModel(page, model(grid((x, y, z) => gear(x, y, z, 2, 2.5)))));
    await run('12 x r2.5 plain wheels', () => setModel(page, model(grid((x, y, z) => cell(x, y, z, 'axleHole', 2, 2.5)), { version: 2 })));
    const mix = [0.5, 1, 1.5, 2.5];
    await run('12 gears mixed 8/16/24/40', () => setModel(page, model(grid((x, y, z) => gear(x, y, z, 2, mix[(x / 6) | 0])))));
    await run('12 plain wheels mixed r1/1/1.5/2.5', () => setModel(page, model(grid((x, y, z) => cell(x, y, z, 'axleHole', 2, Math.max(1, mix[(x / 6) | 0]))), { version: 2 })));
    await run('empty', () => setModel(page, model([{ color: '#e0b43c', cells: [cell(0, 0, 0)] }], { version: 1 })));
    log(`DPR ${dpr} ratios: train/no-teeth ${(res['gear-train (edit)'].ms / res['gear-train no teeth (8s bare, others plain wheels)'].ms).toFixed(2)}, 12x40/12 wheels ${(res['12 x 40-tooth gears'].ms / res['12 x r2.5 plain wheels'].ms).toFixed(2)}, mixed ${(res['12 gears mixed 8/16/24/40'].ms / res['12 plain wheels mixed r1/1/1.5/2.5'].ms).toFixed(2)}`);
  }
} finally {
  await save('review-m8-look-perf.txt', lines.join('\n'));
  await S.close();
}
