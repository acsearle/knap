// Review fapp: poses after 3 s at Off (new build) vs HEAD build, every example (printed as JSON).
import { harness, ev, EXAMPLES } from './review-fapp-lib.mjs';
const h = await harness();
try {
  const c = await h.open('fapp-offhead');
  const p = c.page; const out = {};
  for (const ex of EXAMPLES) {
    await ev(p, () => window.__knap.setMode('edit'));
    await ev(p, (n) => window.__knap.loadExample(n), ex);
    await ev(p, () => window.__knap.setFriction?.('off'));
    for (let i = 0; i < 3; i++) await ev(p, () => window.__knap.stepSim(480));
    out[ex] = await ev(p, () => window.__knap.simTransforms());
  }
  console.log('JSON' + JSON.stringify(out));
} finally { await h.done(); }
