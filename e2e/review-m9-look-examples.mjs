// Reviewer "look" (m9, Show colliders): every example with the collider view on, edit mode at Home,
// front, top-back-left close, far out, and mid-simulation; plus off/on pairs. DPR 1 at 1280x720 and
// DPR 2 at 1600x1000 (env DPR=2).
//   E2E_DIST=e2e/out/review-m9-look-dist node e2e/review-m9-look-examples.mjs
import { K, cam, frames, session, setCam } from './review-m8-look-lib.mjs';

const EX = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision', 'crank-wheel', 'cart', 'gear-train'];
const dpr = Number(process.env.DPR ?? 1);
const W = dpr === 1 ? 1280 : 1600;
const H = dpr === 1 ? 720 : 1000;
const only = process.env.ONLY ? process.env.ONLY.split(',') : EX;
const S = await session();
try {
  const ctx = await S.open(`m9look-ex-${dpr}`, { width: W, height: H, deviceScaleFactor: dpr });
  const { page, shot } = ctx;
  const away = async () => { await page.mouse.move(W / 2, H - 6); await frames(page, 2); };
  for (const name of only) {
    await K(page, (n) => window.__knap.loadExample(n), name);
    await K(page, () => window.__knap.setShowColliders(false));
    await K(page, () => window.__knap.home());
    await away();
    await shot(`review-m9-look-${name}-home-off-d${dpr}`);
    await K(page, () => window.__knap.setShowColliders(true));
    await frames(page, 3);
    await shot(`review-m9-look-${name}-home-on-d${dpr}`);
    const leg = await page.evaluate(() => {
      const el = document.querySelector('[data-role=collider-legend]');
      const b = el.getBoundingClientRect();
      const panel = el.closest('aside, .panel, .side') ?? el.parentElement;
      return { legend: [b.x, b.y, b.right, b.bottom].map(Math.round), text: el.innerText.replace(/\n/g, ' | '), panelScroll: panel ? [panel.scrollHeight, panel.clientHeight] : null };
    });
    console.log(`${name}: legend ${JSON.stringify(leg)}`);
    const c0 = await cam(page);
    await K(page, () => window.__knap.setView('front'));
    await frames(page, 3);
    await shot(`review-m9-look-${name}-front-on-d${dpr}`);
    await K(page, () => window.__knap.setView('top-back-left'));
    await setCam(page, { ...(await cam(page)), height: c0.height * 0.45 });
    await frames(page, 3);
    await shot(`review-m9-look-${name}-tbl-close-on-d${dpr}`);
    await setCam(page, { ...c0, height: c0.height * 4 });
    await frames(page, 3);
    await shot(`review-m9-look-${name}-far-on-d${dpr}`);
    await setCam(page, c0);
    await K(page, () => window.__knap.stepSim(1));
    const ids = (await K(page, () => window.__knap.getModel())).parts.map((p) => p.id);
    if (name === 'cart' || name === 'collision') for (const id of ids) await K(page, ([i]) => window.__knap.pushBody(i, [40, 0, 0]), [id]);
    await K(page, () => window.__knap.stepSim(90));
    await frames(page, 3);
    await shot(`review-m9-look-${name}-sim-on-d${dpr}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__knap.getState().mode === 'edit');
  }
} finally {
  await S.close();
}
