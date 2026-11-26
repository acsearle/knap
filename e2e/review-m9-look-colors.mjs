// Reviewer "look" (m9): how much a part's own colour (the 0.3 ghost) bleeds into the collider fill.
// One 5-long beam per palette colour, and one r1.5 wheel per palette colour, view on, top view;
// samples the centre of each beam's top face / wheel face and prints sRGB + CIELAB L*a*b*, and the
// ΔE76 to each role's legend swatch fill. Screenshot e2e/out/review-m9-look-colors-*.png.
//   E2E_DIST=e2e/out/review-m9-look-dist node e2e/review-m9-look-colors.mjs
import { K, PAL, PAL_NAMES, cell, model, session, setCam, setModel, frames } from './review-m8-look-lib.mjs';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function lab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(lin);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ROLE = { part: '#9ec0e3', hull: '#f9d796', round: '#a8648f', guard: '#4fb084' };
const roleLab = Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [k, lab(hex(v))]));

const S = await session();
try {
  const { page, shot } = await S.open('m9look-colors', { width: 1280, height: 720, deviceScaleFactor: 1 });
  for (const kind of ['beam', 'wheel']) {
    const parts = PAL.map((color, i) =>
      kind === 'beam'
        ? { color, cells: [0, 1, 2, 3, 4].map((x) => cell(x, 0, i * 2, 'pinHole', 1)) }
        : { color, cells: [cell(i * 4, 0, 0, 'axleHole', 1, 1.5)] },
    );
    await setModel(page, model(parts));
    await K(page, () => window.__knap.setShowColliders(true));
    await setCam(page, { target: kind === 'beam' ? [2, 0, 7] : [14, 0, 0], height: kind === 'beam' ? 18 : 12, yaw: 0, pitch: Math.PI / 2 - 1e-4 });
    await page.mouse.move(640, 714);
    await frames(page, 4);
    await shot(`review-m9-look-colors-${kind}`);
    const pts = await K(page, ([kind, n]) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        // beam: between holes (x=1.5) on the top face; wheel: on the face at 0.9 from the hub
        const p = kind === 'beam' ? window.__knap.screenPos([1.5, 0.5, i * 2 + 0.3]) : window.__knap.screenPos([i * 4 + 0.95, 0.5, 0.3]);
        out.push(p);
      }
      return out;
    }, [kind, PAL.length]);
    const buf = await page.screenshot();
    const { PNG } = await import('pngjs').catch(() => ({ PNG: null }));
    let px;
    if (PNG) {
      const png = PNG.sync.read(buf);
      px = pts.map((p) => { const i = (Math.round(p.y) * png.width + Math.round(p.x)) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; });
    } else {
      px = await page.evaluate(async ([b64, pts]) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        return pts.map((p) => Array.from(g.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data.slice(0, 3)));
      }, [buf.toString('base64'), pts]);
    }
    console.log(`\n${kind} (sample point → sRGB, L*a*b*, ΔE to role swatch fills part/hull/round/guard):`);
    for (let i = 0; i < PAL.length; i++) {
      const L = lab(px[i]);
      const d = Object.fromEntries(Object.entries(roleLab).map(([k, v]) => [k, dE(L, v).toFixed(0)]));
      console.log(`  ${PAL_NAMES[i].padEnd(7)} rgb(${px[i].join(',')}) L*${L[0].toFixed(0)} a*${L[1].toFixed(0)} b*${L[2].toFixed(0)}  ΔE ${JSON.stringify(d)}`);
    }
  }
} finally {
  await S.close();
}
