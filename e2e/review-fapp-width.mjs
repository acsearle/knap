// Review fapp: top-bar overflow vs window width (run with FAPP_DIST=<head build> to compare).
import { harness, ev } from './review-fapp-lib.mjs';
const h = await harness();
try {
  for (const w of [1024, 1100, 1200, 1240, 1280, 1366]) {
    const c = await h.open(`w${w}`, { width: w, height: 768 });
    const r = await ev(c.page, () => { const t = document.querySelector('.topbar'); const sp = document.querySelector('.topbar .spacer'); return { overflow: t.scrollWidth - t.clientWidth, spacer: sp?.getBoundingClientRect().width, about: document.querySelector('[data-action=about]').getBoundingClientRect().right, ovx: getComputedStyle(t).overflowX }; });
    console.log(w, JSON.stringify(r));
    if (w === 1024) await c.shot(`review-fapp-1024${process.env.FAPP_DIST ? '-head' : ''}`, { clip: { x: 0, y: 0, width: 1024, height: 60 } });
    await c.close();
  }
} finally { await h.done(); }
