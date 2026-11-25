// Review "sim" 2: playback speed vs wall clock and the can't-keep-up badge, pause / step / readout.
// Run: node e2e/review-sim-behaviour.mjs [viewportWidth viewportHeight]
import { frames, press, settle, sleep } from './app-lib.mjs';
import { check, harness, results } from './review-sim-lib.mjs';

const W = Number(process.argv[2] ?? 1280);
const H = Number(process.argv[3] ?? 720);
const h = await harness();
const c = await h.open('review-sim-behaviour', { width: W, height: H });
const { page } = c;
const k = (fn, arg) => page.evaluate(fn, arg);

/** Sample sim time / badge / readout every 50 ms of wall clock for `ms`, in the page. */
const sample = (ms) =>
  k(
    (ms) =>
      new Promise((res) => {
        const out = [];
        const t0 = performance.now();
        const tick = () => {
          const i = window.__knap.simInfo();
          out.push({
            wall: performance.now() - t0,
            sim: i ? i.time : null,
            dropped: i ? i.droppedSteps : null,
            slow: !document.querySelector('[data-role=sim-slow]').hidden,
            readout: document.querySelector('[data-role=sim-time]').textContent,
            renders: window.__knap.getState().viewport.renders,
          });
          if (performance.now() - t0 < ms) setTimeout(tick, 50);
          else res(out);
        };
        tick();
      }),
    ms,
  );

try {
  await k(() => window.__knap.loadExample('pendulum'));
  await frames(page, 2);
  console.log(`viewport ${W}×${H}; single-render timing (ms): ${JSON.stringify(await k(() => window.__knap.renderTiming(3).map((x) => +x.toFixed(0))))}`);
  for (const speed of ['1', '0.5', '0.25', '0.1']) {
    await press(page, `[data-speed="${speed}"]`);
    await press(page, '[data-action=play]');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    await sleep(600); // let the first frames pass
    const s = await sample(4000);
    const a = s[0];
    const b = s[s.length - 1];
    const ratio = (b.sim - a.sim) / ((b.wall - a.wall) / 1000);
    const frameCount = b.renders - a.renders;
    const fps = frameCount / ((b.wall - a.wall) / 1000);
    const slowFrac = s.filter((x) => x.slow).length / s.length;
    const behind = ratio < Number(speed) * 0.9;
    console.log(`speed ${speed}×: sim/wall = ${ratio.toFixed(3)} over ${((b.wall - a.wall) / 1000).toFixed(1)} s, ${fps.toFixed(1)} fps, dropped steps ${b.dropped - a.dropped}, badge shown ${(slowFrac * 100).toFixed(0)}% of samples`);
    check(`${speed}×: badge truthful (behind ⇒ shown ≥ 90% of samples; on time ⇒ shown ≤ 10%)`, behind ? slowFrac >= 0.9 : slowFrac <= 0.1, { ratio, slowFrac });
    // readout follows the simulated time (2 decimals, may lag one frame)
    const lastReadout = Number(/t = ([\d.]+) s/.exec(b.readout)?.[1]);
    check(`${speed}×: readout tracks sim time`, Math.abs(lastReadout - b.sim) < 0.05 + Number(speed) * 0.3, { readout: b.readout, sim: b.sim });
    await page.keyboard.press('Escape');
    await frames(page, 1);
  }

  // Pause / step semantics.
  await press(page, '[data-speed="0.25"]');
  await press(page, '[data-action=play]');
  await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
  await sleep(500);
  await page.keyboard.press(' ');
  await frames(page, 1);
  const p0 = await k(() => window.__knap.simInfo());
  await sleep(1500);
  const p1 = await k(() => window.__knap.simInfo());
  check('paused: sim time frozen', p0.time === p1.time && p1.paused, { p0: p0.time, p1: p1.time });
  const slowWhilePaused = await k(() => !document.querySelector('[data-role=sim-slow]').hidden);
  check('paused: badge hidden', !slowWhilePaused);
  await page.keyboard.press('.');
  await frames(page, 1);
  const p2 = await k(() => window.__knap.simInfo());
  check('Step (.) advances exactly 8 fixed steps', p2.stepCount - p1.stepCount === 8 && p2.paused, { d: p2.stepCount - p1.stepCount });
  const ro = await page.textContent('[data-role=sim-time]');
  check('readout after step', ro === `t = ${p2.time.toFixed(2)} s`, ro);
  await page.keyboard.press(' ');
  await sleep(1000);
  const p3 = await k(() => window.__knap.simInfo());
  // After a long pause the first resumed frame must not take a huge dt (no jump).
  check('resume after a 1.5 s pause: time advances, no jump bigger than one frame', p3.time > p2.time && p3.time - p2.time < 1.0 * 0.25 + 0.05, { dt: p3.time - p2.time });
  // Speed buttons while paused / running apply.
  await press(page, '[data-speed="1"]');
  check('speed change applies to running session', (await k(() => window.__knap.simInfo())).speed === 1);
  await page.keyboard.press('Escape');
  await frames(page, 1);
  // Step from edit mode starts paused and steps.
  await page.keyboard.press('.');
  await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
  await frames(page, 1);
  const s4 = await k(() => window.__knap.simInfo());
  check('Step in edit mode: starts paused and advances 1/60 s', s4.paused && s4.stepCount === 8, s4);
  await page.keyboard.press('Escape');
  if (c.errors.length) check('no page errors', false, c.errors);
} finally {
  await h.done();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
for (const r of bad) console.log(`FAILED: ${r.name}  ${JSON.stringify(r.detail)}`);
void settle;
