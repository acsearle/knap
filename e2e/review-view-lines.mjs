// Review: outline line width (device px) across DPR / zoom / slope, and shimmer under tiny orbits.
//   node e2e/review-view-lines.mjs [width] [shimmer]
// Parts are made flat white on a white background (lighting uniforms overridden) so every
// non-white pixel is ink; coverage = (255 − L) / (255 − L_ink).
import { harness, check, results } from './review-view-lib.mjs';

const want = new Set(process.argv.slice(2));
const run = (s) => want.size === 0 || want.has(s);
const H = await harness();

const FLATTEN = `(() => {
  const vp = window.__view.vp;
  vp.opts.background = '#ffffff';
  vp.setPartColors(null);
  for (const pv of vp.views.values()) {
    const u = pv.colorMesh.material.uniforms;
    u.uColor.value.set('#ffffff'); u.uKeyStrength.value = 0; u.uAmbTop.value = 1; u.uAmbBottom.value = 1;
  }
})()`;

/** In-page: coverage image (Float32 0..1) top-down. */
const COVER = `(() => {
  const vp = window.__view.vp;
  vp.renderNow();
  const gl = vp.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const ink = 0.299 * 0.12 * 255 + 0.587 * 0.125 * 255 + 0.114 * 0.135 * 255;
  const cov = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((h - 1 - y) * w + x) * 4;
    const L = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    cov[y * w + x] = Math.max(0, Math.min(1, (255 - L) / (255 - ink)));
  }
  return { w, h, cov };
})()`;

/** In-page analysis: per-column runs → width = sum / sqrt(1+slope²) for well-isolated runs. */
const ANALYZE = `((img) => {
  const { w, h, cov } = img;
  const C = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : cov[y * w + x]);
  function runs(x) {
    const out = [];
    let y = 0;
    while (y < h) {
      if (C(x, y) > 0.03) {
        let s = 0, m = 0, y0 = y;
        while (y < h && C(x, y) > 0.03) { s += C(x, y); m += C(x, y) * y; y++; }
        // isolated: 4 clean px on both sides
        let clean = true;
        for (let k = 1; k <= 4; k++) if (C(x, y0 - k) > 0.03 || C(x, y - 1 + k) > 0.03) clean = false;
        if (clean) out.push({ s, c: m / s, len: y - y0 });
      } else y++;
    }
    return out;
  }
  const cols = [];
  for (let x = 0; x < w; x++) cols.push(runs(x));
  const widths = [];
  for (let x = 2; x < w - 2; x++) {
    for (const r of cols[x]) {
      const a = cols[x - 2].find((q) => Math.abs(q.c - r.c) < 6);
      const b = cols[x + 2].find((q) => Math.abs(q.c - r.c) < 6);
      if (!a || !b) continue;
      const slope = (b.c - a.c) / 4;
      if (Math.abs(slope) > 1.2) continue;
      // straight locally?
      if (Math.abs((b.c + a.c) / 2 - r.c) > 0.15) continue;
      widths.push({ wd: r.s / Math.sqrt(1 + slope * slope), slope: Math.abs(slope), peak: r.len });
    }
  }
  const q = (arr, p) => { const s = [...arr].sort((u, v) => u - v); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
  const flat = widths.filter((o) => o.slope < 0.05).map((o) => o.wd);
  const diag = widths.filter((o) => o.slope > 0.4 && o.slope < 1.2).map((o) => o.wd);
  return {
    n: widths.length,
    flat: { n: flat.length, p10: q(flat, 0.1), med: q(flat, 0.5), p90: q(flat, 0.9) },
    diag: { n: diag.length, p10: q(diag, 0.1), med: q(diag, 0.5), p90: q(diag, 0.9) },
  };
})`;

try {
  if (run('width')) {
    for (const dpr of [1, 2]) {
      for (const [view, zoom] of [['front', 1], ['front', 0.4], ['front', 3], ['iso', 1], ['iso', 0.35], ['iso', 4]]) {
        const c = await H.open(`example=four-bar&grid=0&root=0&cube=0&anim=0&view=${view}`, { width: 900, height: 600, deviceScaleFactor: dpr });
        await c.page.evaluate(FLATTEN);
        await c.page.evaluate((z) => { const v = window.__view.vp; const cm = v.getCamera(); v.setCamera({ ...cm, height: cm.height * z }, { animate: false }); }, zoom);
        const r = await c.page.evaluate(`${ANALYZE}(${COVER})`);
        const want = 1.25 * dpr;
        // A category needs ≥ 10 samples: with fewer (iso close-ups have almost no horizontal
        // lines) the few "flat" runs are merged double lines, not single lines (engineer's fix).
        const okCat = (cat) => cat.n < 10 || Math.abs(cat.med - want) < 0.2 * want;
        const ok = r.flat.n + r.diag.n >= 10 && okCat(r.flat) && okCat(r.diag);
        check(`width dpr${dpr} ${view} zoom×${zoom}: median ink width ≈ ${want} device px (flat / diagonal lines)`, ok, r);
        await c.close();
      }
    }
  }

  if (run('shimmer')) {
    for (const [ex, yaw, pitch, h, dpr] of [['four-bar', 35, 30, null, 1], ['pendulum', 25, 30, 1.6, 1], ['sliding-axle', -35, 28, null, 1], ['four-bar', 35, 30, null, 2], ['four-bar', 40, 3, null, 1]]) {
      const c = await H.open(`example=${ex}&grid=0&root=0&cube=0&anim=0`, { width: 900, height: 600, deviceScaleFactor: dpr });
      await c.page.evaluate(FLATTEN);
      const r = await c.page.evaluate(`(async () => {
        const vp = window.__view.vp;
        const base = vp.getCamera();
        const yaw0 = ${yaw} * Math.PI / 180, pitch0 = ${pitch} * Math.PI / 180;
        ${h ? `base.height = ${h}; base.target = [0, 0, 0.5];` : ''}
        const frames = [];
        for (let k = 0; k < 12; k++) {
          vp.setCamera({ ...base, yaw: yaw0 + k * 0.05 * Math.PI / 180, pitch: pitch0 }, { animate: false });
          frames.push(${COVER});
        }
        const totals = frames.map((f) => f.cov.reduce((a, b) => a + b, 0));
        // pixels whose coverage jumps by > 0.6 between consecutive frames 0.05° apart
        const jumps = [];
        for (let k = 1; k < frames.length; k++) {
          let n = 0, ink = 0;
          const a = frames[k - 1].cov, b = frames[k].cov;
          for (let i = 0; i < a.length; i++) { if (Math.abs(a[i] - b[i]) > 0.6) n++; ink += b[i] > 0.5 ? 1 : 0; }
          jumps.push(n / Math.max(1, ink));
        }
        const mean = totals.reduce((a, b) => a + b) / totals.length;
        const dev = Math.max(...totals.map((t) => Math.abs(t - mean))) / mean;
        return { totalInkDev: dev, maxJumpFrac: Math.max(...jumps), jumps: jumps.map((j) => +j.toFixed(4)) };
      })()`);
      check(`shimmer ${ex} yaw ${yaw} pitch ${pitch}${h ? ' close-up' : ''} dpr${dpr}: total ink stable (<2 %) and < 3 % of ink px jump >0.6 per 0.05° step`, r.totalInkDev < 0.02 && r.maxJumpFrac < 0.03, r);
      await c.close();
    }
  }
} finally {
  await H.done();
}
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
