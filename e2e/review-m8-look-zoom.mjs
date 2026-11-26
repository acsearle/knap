// Reviewer "look" (m8): zoom sweep + orbit sweep on a 40-tooth gear.
//   E2E_DIST=e2e/out/review-m8-look-dist node e2e/review-m8-look-zoom.mjs
import { ISO, K, annulusInk, axisCam, cell, gear, lumaBuffer, model, partsClip, save, session, setCam, setModel, sheet, snap } from './review-m8-look-lib.mjs';

const S = await session();
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
try {
  for (const dpr of [1, 2]) {
    const ctx = await S.open(`look-zoom-${dpr}`, { width: 1280, height: 800, deviceScaleFactor: dpr });
    const { page } = ctx;
    // 40 gear at x=0 and plain r 2.5 wheel at x=7, same colour, axis Z
    await setModel(page, model([{ color: '#e0b43c', cells: [gear(0, 0, 0, 2, 2.5)] }, { color: '#e0b43c', cells: [cell(7, 0, 0, 'axleHole', 2, 2.5)] }]));
    const regions = (r) => [
      { name: 'band', r0: r - 5 / 32 - 0.02, r1: r + 3 / 32 + 0.02 },
      { name: 'face', r0: 0.7, r1: r - 0.35 },
    ];
    // face-on zoom sweep: heights geometric 1.5 … 900 (15 steps) + fine sweep through the fade
    const coarse = Array.from({ length: 15 }, (_, i) => 1.5 * Math.pow(900 / 1.5, i / 14));
    const H = await page.evaluate(`${'document.querySelector("canvas.kv-canvas").__knapViewport'}.size.height`); log(`canvas css height ${H}`);
    const pxPitch = (h) => (H * dpr * Math.PI) / 8 / h;
    const fine = [];
    for (let px = 9; px >= 1.9; px /= 1.04) fine.push((H * dpr * Math.PI) / 8 / px);
    log(`\n=== DPR ${dpr}: face-on zoom sweep, 40 gear vs r2.5 wheel (ink density = ink px / area px in the band annulus r-0.18..r+0.12) ===`);
    log('height  px/pitch fade  | gear band: dens  meanL  dark | wheel band: dens meanL dark | gear face dens');
    const tiles = [];
    const rows = [];
    for (const [kind, hs] of [['coarse', coarse], ['fine', fine]]) {
      for (const h of hs) {
        await setCam(page, axisCam(2, [0, 0, 0], h));
        const g = await annulusInk(page, [0, 0, 0], regions(2.5));
        await setCam(page, axisCam(2, [7, 0, 0], h));
        const w = await annulusInk(page, [7, 0, 0], regions(2.5));
        const row = { kind, h, px: g.pitchPx, fade: g.fade, g: g.regions.band, w: w.regions.band, gf: g.regions.face };
        rows.push(row);
        log(`${kind[0]} ${h.toFixed(2).padStart(7)} ${g.pitchPx.toFixed(2).padStart(6)} ${g.fade.toFixed(2)} | ${g.regions.band.density.toFixed(3)} ${g.regions.band.meanL.toFixed(0).padStart(5)} ${g.regions.band.dark.toFixed(3)} | ${w.regions.band.density.toFixed(3)} ${w.regions.band.meanL.toFixed(0).padStart(5)} ${w.regions.band.dark.toFixed(3)} | ${g.regions.face.density.toFixed(3)}`);
        if (kind === 'coarse') {
          // iso view of the same gear at this height: picture for the contact sheet
          await setCam(page, { target: [3.5, 0, 0], height: h, yaw: Math.PI / 4, pitch: ISO });
          const clip = await partsClip(page, [1, 2], 6);
          if (clip.width > 420) { clip.x += Math.floor((clip.width - 420) / 2); clip.width = 420; }
          if (clip.height > 300) { clip.y += Math.floor((clip.height - 300) / 2); clip.height = 300; }
          clip.width = Math.max(clip.width, 8); clip.height = Math.max(clip.height, 8);
          tiles.push({ label: `h ${h.toFixed(1)} px/pitch ${pxPitch(h).toFixed(1)} fade ${(g.fade).toFixed(2)}`, buf: await snap(page, clip) });
        }
      }
    }
    // step-to-step jumps on the fine sweep (normalised by the expected trend: ratio of neighbours)
    const f = rows.filter((r) => r.kind === 'fine');
    let maxJump = 0, at = 0;
    for (let i = 1; i < f.length - 1; i++) {
      const mid = (f[i - 1].g.density + f[i + 1].g.density) / 2;
      const j = Math.abs(f[i].g.density - mid) / Math.max(1e-4, mid);
      if (j > maxJump) { maxJump = j; at = f[i].px; }
    }
    log(`fine sweep: max deviation of band density from neighbours' mean ${(100 * maxJump).toFixed(1)} % at ${at.toFixed(2)} px/pitch`);
    console.log('sheet', await sheet(S.browser, `review-m8-look-zoom-dpr${dpr}.png`, tiles, { cols: 5, title: `zoom sweep (iso, 40 gear + r2.5 wheel), DPR ${dpr}` }));

    // edge-on zoom sweep pictures (barcode check): side view from +X of the 40
    const etiles = [];
    for (const px of [24, 12, 8, 6, 5, 4, 3.5, 3, 2.5, 2]) {
      const h = (H * dpr * Math.PI) / 8 / px;
      await setCam(page, { target: [0, 0, 0], height: h, yaw: Math.PI / 2, pitch: 0.15 });
      const clip = await partsClip(page, [1], 6);
      if (clip.height > 360) { clip.y += Math.floor((clip.height - 360) / 2); clip.height = 360; }
      etiles.push({ label: `edge ${px}px/p`, buf: await snap(page, clip) });
    }
    console.log('sheet', await sheet(S.browser, `review-m8-look-zoom-edge-dpr${dpr}.png`, etiles, { cols: 10, title: `edge-on (yaw 90°, pitch 8.6°) 40 gear, px per pitch, DPR ${dpr}` }));

    // orbit sweep 0.25° on the 40 alone at two zooms (Home-like 14 px/pitch and 5 px/pitch)
    await setModel(page, model([{ color: '#e0b43c', cells: [gear(0, 0, 0, 2, 2.5)] }]));
    for (const px of [14, 7, 5, 3.5]) {
      const h = (H * dpr * Math.PI) / 8 / px;
      const inks = [];
      const diffs = [];
      let prev = null;
      for (let k = 0; k <= 40; k++) {
        await setCam(page, { target: [0, 0, 0], height: h, yaw: Math.PI / 4 + (k * 0.25 * Math.PI) / 180, pitch: ISO });
        const a = await annulusInk(page, [0, 0, 0], [{ name: 'all', r0: 0, r1: 3.2 }]);
        inks.push(a.regions.all.ink);
        const L = await lumaBuffer(page);
        const buf = Buffer.from(L.b64, 'binary');
        const cur = Uint8Array.from(atob(L.b64), (c) => c.charCodeAt(0));
        if (prev) {
          let n = 0, big = 0;
          for (let i = 0; i < cur.length; i++) { const d = Math.abs(cur[i] - prev[i]); if (d > 40) big++; if (d > 0) n++; }
          diffs.push(big);
        }
        prev = cur;
        void buf;
      }
      let maxStep = 0;
      for (let i = 1; i < inks.length; i++) maxStep = Math.max(maxStep, Math.abs(inks[i] - inks[i - 1]) / inks[i - 1]);
      const mean = inks.reduce((a, b) => a + b, 0) / inks.length;
      const sd = Math.sqrt(inks.reduce((a, b) => a + (b - mean) ** 2, 0) / inks.length);
      log(`orbit 0.25° x40 at ${px} px/pitch DPR ${dpr}: ink mean ${mean.toFixed(0)} sd ${(100 * sd / mean).toFixed(2)} % max step ${(100 * maxStep).toFixed(2)} %; px changing by >40 levels per step: median ${diffs.slice().sort((a, b) => a - b)[20]} max ${Math.max(...diffs)}`);
    }
  }
} finally {
  await save('review-m8-look-zoom.txt', lines.join('\n'));
  await S.close();
}
