// Review fapp: stepSim cost (ms per simulated second) in the page, per example and level.
// FAPP_DIST=<head build> measures HEAD (no friction API: level column "head").
import { harness, ev, EXAMPLES, HZ } from './review-fapp-lib.mjs';

const h = await harness();
try {
  const c = await h.open('fapp-perf', { width: 1280, height: 720 });
  const p = c.page;
  const hasF = await ev(p, () => typeof window.__knap.setFriction === 'function');
  const levels = hasF ? ['off', 'realistic'] : ['head'];
  const rows = {};
  for (let rep = 0; rep < 3; rep++) {
    for (const ex of EXAMPLES) {
      for (const lvl of levels) {
        await ev(p, () => window.__knap.setMode('edit'));
        await ev(p, (n) => window.__knap.loadExample(n), ex);
        if (lvl !== 'head') await ev(p, (l) => window.__knap.setFriction(l), lvl);
        await ev(p, () => window.__knap.stepSim(0));
        // 0..3 s (moving) and 6..9 s (Real: at rest) separately
        const ms = await ev(p, async (HZ) => {
          const out = [];
          for (const seg of [[0, 3], [3, 6], [6, 9]]) {
            const t0 = performance.now();
            for (let i = 0; i < 3; i++) await window.__knap.stepSim(HZ);
            out.push((performance.now() - t0) / 3);
          }
          return out;
        }, HZ);
        const k = `${ex}/${lvl}`;
        rows[k] = rows[k] ? rows[k].map((v, i) => Math.min(v, ms[i])) : ms;
      }
    }
  }
  for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(28), v.map((x) => x.toFixed(0).padStart(5)).join(' '), ' ms per simulated s (0-3 s, 3-6 s, 6-9 s), best of 3');
} finally {
  await h.done();
}
