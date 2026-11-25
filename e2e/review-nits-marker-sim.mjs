// Nits review: is the root marker stable and always visible while simulating?
// Every built-in example + 3 own models, 10 simulated seconds, 6 views (camera fixed per view at t=0),
// sampled every 1 s. Measured FROM PIXELS (review-nits-lib markDiff) and from the hook.
// Usage: node e2e/review-nits-marker-sim.mjs [dpr] [modelFilter]
import { writeFileSync } from 'node:fs';
import { reviewSetup, markDiff } from './review-nits-lib.mjs';

const DPR = Number(process.argv[2] ?? 1);
const FILTER = process.argv[3] ?? '';
const S = await reviewSetup();
const { page, shot, errors } = await S.open('rn-sim', { deviceScaleFactor: DPR });

const pinHole = (x, y, z, axis = 2) => ({ x, y, z, kind: 'pinHole', axis });
const pin = (x, y, z, axis = 2) => ({ x, y, z, kind: 'pin', axis });
const CUSTOM = {
  // root beam in layer 0, swinging arms in front (z=1, z=2) and behind (z=-1) on its middle hole
  deep: {
    parts: [
      { id: 1, color: '#5c6168', cells: [0, 1, 2].map((x) => pinHole(x, 0, 0)) },
      { id: 2, color: '#d9cba3', cells: [pin(1, 0, -1), pin(1, 0, 0), pin(1, 0, 1)] },
      { id: 3, color: '#c9413a', cells: [1, 2, 3, 4, 5].map((x) => pinHole(x, 0, 1)) },
      { id: 4, color: '#3b74c4', cells: [-3, -2, -1, 0, 1].map((x) => pinHole(x, 0, -1)) },
      { id: 5, color: '#d9cba3', cells: [pin(5, 0, 1), pin(5, 0, 2)] },
      { id: 6, color: '#e0b43c', cells: [5, 4, 3, 2, 1, 0, -1].map((x) => pinHole(x, 0, 2)) },
    ],
    rootPartId: 1,
    nextPartId: 7,
  },
  // root = a pin; a beam and an arm both swing on it
  pinroot: {
    parts: [
      { id: 1, color: '#e0b43c', cells: [0, 1, 2, 3].map((x) => pinHole(x, 0, 0)) },
      { id: 2, color: '#d9cba3', cells: [pin(1, 0, 0), pin(1, 0, 1)] },
      { id: 3, color: '#c9413a', cells: [1, 2, 3, 4].map((x) => pinHole(x, 0, 1)) },
    ],
    rootPartId: 2,
    nextPartId: 4,
  },
  // tall root (10 high), arms swinging at the top and the bottom
  tall: {
    parts: [
      { id: 1, color: '#4e9a52', cells: Array.from({ length: 10 }, (_, y) => pinHole(0, y, 0)) },
      { id: 2, color: '#d9cba3', cells: [pin(0, 9, 0), pin(0, 9, 1)] },
      { id: 3, color: '#c9413a', cells: [0, 1, 2, 3, 4].map((x) => pinHole(x, 9, 1)) },
      { id: 4, color: '#d9cba3', cells: [pin(0, 0, 0), pin(0, 0, 1)] },
      { id: 5, color: '#3b74c4', cells: [0, 1, 2, 3].map((x) => pinHole(x, 0, 1)) },
    ],
    rootPartId: 1,
    nextPartId: 6,
  },
};
const EXAMPLES = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision'];
const VIEWS = ['home', 'front', 'back', 'left', 'right', 'top'];
const rows = [];
const problems = [];
for (const name of [...EXAMPLES, ...Object.keys(CUSTOM)]) {
  if (FILTER && !name.includes(FILTER)) continue;
  const t0 = Date.now();
  await page.evaluate(([n, m]) => (m ? window.__knap.setModel(m) : window.__knap.loadExample(n)), [name, CUSTOM[name] ?? null]);
  const sum = await page.evaluate(() => window.__knap.analyze().summary);
  // camera per view (fit at edit time), kept fixed for the whole run
  const cams = {};
  const ref = {};
  for (const v of VIEWS) {
    await page.evaluate((v) => (v === 'home' ? window.__knap.home() : (window.__knap.setView(v), window.__knap.fit())), v);
    cams[v] = await page.evaluate(() => window.__knap.camera());
    ref[v] = await markDiff(page);
    if (v === 'home' || v === 'front') await shot(`review-nits-sim-${name}-${v}-edit-dpr${DPR}`);
  }
  const stat = Object.fromEntries(VIEWS.map((v) => [v, { minN: 1e9, minAlpha: 1, maxHookMove: 0, maxBoxMove: 0, minDark: 1e9, invisible: 0 }]));
  for (let s = 0; s <= 10; s++) {
    if (s > 0) await page.evaluate(() => window.__knap.stepSim(480));
    else await page.evaluate(() => window.__knap.stepSim(0));
    for (const v of VIEWS) {
      await page.evaluate((c) => window.__knap.setCamera(c), cams[v]);
      const d = await markDiff(page);
      const st = stat[v];
      const r0 = ref[v];
      if (!d.hook || !r0.hook) {
        st.invisible++;
        continue;
      }
      st.maxHookMove = Math.max(st.maxHookMove, Math.hypot(d.hook.x - r0.hook.x, d.hook.y - r0.hook.y));
      if (d.bbox && r0.bbox) st.maxBoxMove = Math.max(st.maxBoxMove, ...d.bbox.map((b, i) => Math.abs(b - r0.bbox[i])));
      if (d.n < 15) st.invisible++;
      st.minN = Math.min(st.minN, d.n);
      st.minDark = Math.min(st.minDark, d.dark);
      st.minAlpha = Math.min(st.minAlpha, d.hook.alpha);
      if (s === 10 && (v === 'home' || v === 'front')) await shot(`review-nits-sim-${name}-${v}-t10-dpr${DPR}`);
    }
  }
  await page.evaluate(() => window.__knap.setMode('edit'));
  // Stop restores exactly
  for (const v of ['home']) {
    await page.evaluate((c) => window.__knap.setCamera(c), cams[v]);
    const d = await markDiff(page);
    if (JSON.stringify(d.bbox) !== JSON.stringify(ref[v].bbox) || d.hook.x !== ref[v].hook.x) problems.push(`${name}: after Stop marker differs ${JSON.stringify(d.bbox)} vs ${JSON.stringify(ref[v].bbox)}`);
  }
  for (const v of VIEWS) {
    const st = stat[v];
    const r0 = ref[v];
    rows.push({ name, v, sum, edit: r0.hook ? { x: +r0.hook.x.toFixed(1), y: +r0.hook.y.toFixed(1), alpha: +r0.hook.alpha.toFixed(2), n: r0.n, dark: r0.dark, meanDark: r0.meanDark, light: r0.light, centroidVsHook: r0.cx === null ? null : [+(r0.cx - r0.hook.x).toFixed(1), +(r0.cy - r0.hook.y).toFixed(1)] } : null, ...st });
    if (st.maxHookMove > 0) problems.push(`${name}/${v}: hook moved ${st.maxHookMove} px`);
    if (st.maxBoxMove > 1.01) problems.push(`${name}/${v}: drawn mark bbox moved ${st.maxBoxMove} px`);
    if (st.invisible) problems.push(`${name}/${v}: invisible in ${st.invisible} of 11 samples (min ${st.minN} px changed)`);
  }
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
writeFileSync(`e2e/out/review-nits-sim-dpr${DPR}${FILTER ? '-' + FILTER : ''}.json`, JSON.stringify({ rows, problems }, null, 1));
for (const r of rows) console.log(JSON.stringify(r));
console.log('PROBLEMS', problems.length);
for (const p of problems) console.log(' ', p);
console.log('errors', errors);
await S.close();
