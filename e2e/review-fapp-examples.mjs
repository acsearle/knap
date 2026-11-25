// Review fapp: every example at every level — numeric traces (30 s) and montages (0..6 s, 0.25 s).
// Usage: node e2e/review-fapp-examples.mjs [example ...]   (MONTAGE=0 to skip images)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { harness, ev, EXAMPLES, HZ, OUT_DIR, qAngle } from './review-fapp-lib.mjs';
import { frames } from './app-lib.mjs';

const want = process.argv.slice(2).length ? process.argv.slice(2) : EXAMPLES;
const MONT = new Set(['pendulum', 'triple-pendulum', 'four-bar', 'sliding-axle', 'parallelogram', 'collision']);
const h = await harness();
const summary = {};

async function montage(page, bufs, labels, file) {
  const b64 = await page.evaluate(async ([imgs, labels]) => {
    const bms = [];
    for (const s of imgs) bms.push(await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob()));
    const cols = 6, sc = 0.25, w = bms[0].width * sc, hh = bms[0].height * sc;
    const rows = Math.ceil(bms.length / cols);
    const c = new OffscreenCanvas(cols * w, rows * hh);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    bms.forEach((bm, i) => {
      const x = (i % cols) * w, y = Math.floor(i / cols) * hh;
      g.drawImage(bm, x, y, w, hh);
      g.strokeStyle = '#999'; g.strokeRect(x, y, w, hh);
      g.fillStyle = '#000'; g.font = '14px sans-serif'; g.fillText(labels[i], x + 4, y + 16);
    });
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, [bufs.map((b) => b.toString('base64')), labels]);
  writeFileSync(join(OUT_DIR, `${file}.png`), Buffer.from(b64, 'base64'));
}

try {
  const c = await h.open('fapp-ex', { width: 1280, height: 720 });
  const p = c.page;
  const vbox = await p.locator('[data-role=viewport]').boundingBox();
  for (const ex of want) {
    for (const lvl of ['off', 'low', 'realistic']) {
      await ev(p, () => window.__knap.setMode('edit'));
      await ev(p, (n) => { window.__knap.loadExample(n); window.__knap.home(); }, ex);
      await ev(p, (l) => window.__knap.setFriction(l), lvl);
      await ev(p, () => window.__knap.stepSim(0));
      const shots = [], labels = [];
      const doShot = process.env.MONTAGE !== '0' && MONT.has(ex) && lvl !== 'low' || (process.env.MONTAGE !== '0' && ex === 'pendulum');
      let prev = await ev(p, () => window.__knap.simTransforms());
      const start = prev;
      const trace = []; // per 0.25 s: max angle moved since previous sample, max translation
      const range = {}; // per part max rotation from start in first 3 s
      for (let k = 1; k <= 120; k++) { // 30 s
        await ev(p, (n) => window.__knap.stepSim(n), HZ / 4);
        const t = await ev(p, () => window.__knap.simTransforms());
        let da = 0, dp = 0;
        for (const id of Object.keys(t)) {
          if (!t[id] || !prev[id]) continue;
          da = Math.max(da, qAngle(prev[id].q, t[id].q));
          dp = Math.max(dp, Math.hypot(...[0, 1, 2].map((i) => t[id].p[i] - prev[id].p[i])));
          if (k <= 12) range[id] = Math.max(range[id] ?? 0, qAngle(start[id].q, t[id].q));
        }
        trace.push({ t: k / 4, da, dp });
        prev = t;
        if (doShot && k <= 24) {
          await frames(p, 2);
          shots.push(await p.screenshot({ clip: vbox }));
          labels.push(`${ex} ${lvl} t=${(k / 4).toFixed(2)}`);
        }
      }
      // at rest from: first sample after which every 0.25 s step moves < 1e-3 rad and 1e-3 u
      let restFrom = null;
      for (let i = trace.length - 1; i >= 0; i--) {
        if (trace[i].da < 1e-3 && trace[i].dp < 1e-3) restFrom = trace[i].t - 0.25; else break;
      }
      const info = await ev(p, () => window.__knap.simInfo());
      const last = trace.slice(-8);
      const maxLate = Math.max(...last.map((x) => x.da));
      const final = await ev(p, () => window.__knap.simTransforms());
      // drift over the last 20 s of rest (from 10 s if at rest by then)
      summary[`${ex}/${lvl}`] = {
        restFrom,
        movedLast2s_rad: +maxLate.toExponential(2),
        rangeFirst3s_deg: Object.fromEntries(Object.entries(range).map(([k, v]) => [k, +(v * 180 / Math.PI).toFixed(1)])),
        finalRotFromBuild_deg: Object.fromEntries(Object.entries(final).filter(([, v]) => v).map(([k, v]) => [k, +(qAngle([0, 0, 0, 1], v.q) * 180 / Math.PI).toFixed(2)])),
        jointError: info.jointError,
        traceDeg: trace.filter((_, i) => i % 2 === 1).map((x) => +(x.da * 180 / Math.PI).toFixed(2)),
      };
      console.log(ex, lvl, JSON.stringify({ restFrom, late: maxLate, range: summary[`${ex}/${lvl}`].rangeFirst3s_deg, final: summary[`${ex}/${lvl}`].finalRotFromBuild_deg }));
      if (shots.length) await montage(p, shots, labels, `review-fapp-montage-${ex}-${lvl}`);
    }
  }
  writeFileSync(join(OUT_DIR, `review-fapp-examples-${want.join('_').slice(0, 60)}.json`), JSON.stringify(summary, null, 1));
} finally {
  await h.done();
}
