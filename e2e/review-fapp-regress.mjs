// Review fapp: simulate-mode regressions — Stop restores the picture pixel-exactly, kinematics
// overlay, speed, pause/step, time readout. Run against fapp-dist and (FAPP_DIST=…) a HEAD build.
import { harness, check, ev, EXAMPLES } from './review-fapp-lib.mjs';
import { pixelDiff } from './review-sim-lib.mjs';
import { frames, press, state, status } from './app-lib.mjs';

const tag = process.env.FAPP_DIST ? 'head' : 'new';
const h = await harness();
try {
  const c = await h.open('fapp-regress', { width: 1280, height: 720 });
  const p = c.page;
  const vshot = async () => p.screenshot({ clip: await p.locator('[data-role=viewport]').boundingBox() });
  for (const ex of EXAMPLES) {
    await ev(p, (n) => { window.__knap.loadExample(n); window.__knap.home(); }, ex);
    await frames(p, 3);
    const before = await vshot();
    await press(p, '[data-action=play]');
    await p.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await press(p, '[data-action=pause]');
    await ev(p, () => window.__knap.stepSim(480));
    // toggle kinematics on/off, change speed, step
    await p.keyboard.press('k');
    await frames(p, 2);
    if (ex === 'four-bar') await c.shot(`review-fapp-kin-sim-${tag}`);
    await p.keyboard.press('k');
    await press(p, '[data-speed="1"]');
    const t0 = (await ev(p, () => window.__knap.simInfo())).time;
    await press(p, '[data-action=step]');
    const t1 = (await ev(p, () => window.__knap.simInfo())).time;
    const readout = await ev(p, () => document.querySelector('[data-role=sim-time]').textContent);
    await press(p, '[data-speed="0.25"]');
    await press(p, '[data-action=stop]');
    await frames(p, 3);
    const after = await vshot();
    const d = await pixelDiff(p, before, after, { thresh: 0, diffFile: `review-fapp-stopdiff-${ex}-${tag}` });
    check(`[${tag}] ${ex}: Stop restores picture pixel-exactly; step = 1/60 s; readout`, d.n === 0 && Math.abs(t1 - t0 - 1 / 60) < 1e-9 && readout === `t = ${t1.toFixed(2)} s`, { diffPx: d.n, dt: t1 - t0, readout });
  }
  // speed: wall-clock run of the pendulum for ~3 s real at 1x, report sim time advance and slow flag
  for (const sp of ['1', '0.25']) {
    await ev(p, () => window.__knap.loadExample('pendulum'));
    await press(p, `[data-speed="${sp}"]`);
    await press(p, '[data-action=play]');
    await p.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    const w0 = Date.now(); const s0 = (await ev(p, () => window.__knap.simInfo())).time;
    let slowSeen = false;
    for (let i = 0; i < 12; i++) { await p.waitForTimeout(250); slowSeen ||= (await state(p)).slow; }
    const s1 = (await ev(p, () => window.__knap.simInfo()));
    console.log(`[${tag}] speed ${sp}: sim advanced ${(s1.time - s0).toFixed(2)} s in ${((Date.now() - w0) / 1000).toFixed(2)} s wall; slow pill seen: ${slowSeen}; droppedSteps ${s1.droppedSteps}`);
    await press(p, '[data-action=stop]');
  }
  await press(p, '[data-speed="0.25"]');
} finally {
  await h.done();
}
