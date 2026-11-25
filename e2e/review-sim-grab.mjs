// Review "sim" 3: grabbing bodies with the real mouse in simulate mode (light, heavy, closed loop,
// prismatic, fixed), dragging far outside the window and releasing outside, grabbing while paused.
// Run: node e2e/review-sim-grab.mjs
import { frames, settle, sleep } from './app-lib.mjs';
import { MODELS, check, harness, results, viewShot } from './review-sim-lib.mjs';

const h = await harness();
const c = await h.open('review-sim-grab');
const { page } = c;
const k = (fn, arg) => page.evaluate(fn, arg);
const mechs = MODELS();
const info = () => k(() => window.__knap.simInfo());

async function load(name) {
  const st = await k(() => window.__knap.getState());
  if (st.mode !== 'edit') await k(() => window.__knap.setMode('edit'));
  if (mechs[name]) await k((m) => window.__knap.setModel(m), mechs[name]);
  else await k((n) => window.__knap.loadExample(n), name);
  await k(() => window.__knap.home());
  await settle(page);
  // start paused at t = 0
  await k(() => window.__knap.stepSim(0));
  await frames(page, 1);
}

/** Press on cell `cell` of `part`, move past the click slop, then along `path` (client points), stepping `steps` fixed steps after each move. */
async function grabDrag(part, cell, path, { steps = 60, release = true } = {}) {
  const p = await k(([a, b]) => window.__knap.cellScreenPos(a, b), [part, cell]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 8, p.y + 3, { steps: 3 });
  const g = (await info()).grabbed;
  let maxErr = 0;
  for (const q of path) {
    await page.mouse.move(q.x, q.y, { steps: 3 });
    await k((n) => window.__knap.stepSim(n), steps);
    const i = await info();
    if (!i) break;
    maxErr = Math.max(maxErr, i.jointError);
  }
  if (release) await page.mouse.up();
  return { start: p, grabbed: g, maxErr };
}

try {
  // 1. Light pin-sized body (part 2 of light-body: one pin hole on the pin).
  await load('light-body');
  await k(() => window.__knap.setView('top'));
  await frames(page, 1);
  {
    const bodyOf = (await k(() => window.__knap.analyze())).bodyOfPart;
    const r = await grabDrag(2, 0, [{ x: 640, y: 150 }, { x: 640, y: 150 }, { x: 640, y: 150 }]);
    const after = await k(() => window.__knap.cellScreenPos(2, 0));
    check('light one-hole body: grabbed', r.grabbed === bodyOf[2], r);
    check('light one-hole body: rotates about its pin toward the cursor (stays on the pin, joint error < 0.02)', r.maxErr < 0.02, r);
    console.log(`  light body: cell centre ${JSON.stringify(r.start)} → ${JSON.stringify(after)} (pin at the hole: centre cannot move)`);
    await viewShot(page, 'review-sim-grab-light');
  }

  // 2. Body in a closed loop: the crank-slider's conrod (part 3), dragged around.
  await load('crank-slider');
  {
    const r = await grabDrag(3, 3, [{ x: 500, y: 250 }, { x: 800, y: 500 }, { x: 300, y: 500 }, { x: 900, y: 200 }], { steps: 120 });
    const i = await info();
    check('closed loop (crank-slider conrod): joints hold while dragged (< 0.05)', r.maxErr < 0.05 && i && (await k(() => window.__knap.getState())).mode === 'simulate', r);
    await viewShot(page, 'review-sim-grab-loop');
  }

  // 3. Prismatic sled pulled hard sideways (perpendicular to its slide) and far below its stop.
  await load('prismatic-sled');
  {
    const r = await grabDrag(2, 15, [{ x: 1200, y: 300 }, { x: 100, y: 650 }, { x: 640, y: 50 }], { steps: 120 });
    const st = await k(() => window.__knap.getState());
    const slide = await k(() => window.__knap.simTransforms()[2].p);
    check('prismatic sled: joint holds against a sideways pull (< 0.05)', r.maxErr < 0.05 && st.mode === 'simulate', { ...r, banner: st.banner, p: slide });
    await viewShot(page, 'review-sim-grab-prismatic');
  }

  // 4. Fixed body: press + drag orbits, grabs nothing.
  await load('pendulum');
  {
    const cam0 = await k(() => window.__knap.camera());
    const r = await grabDrag(1, 0, [{ x: 500, y: 400 }], { steps: 1 });
    const cam1 = await k(() => window.__knap.camera());
    check('fixed body: drag grabs nothing and orbits', r.grabbed === null && cam1.yaw !== cam0.yaw, r);
    await k(() => window.__knap.home());
    await settle(page);
  }

  // 5. Grab while paused, drag far outside the window, release outside.
  await load('pendulum');
  {
    const t0 = (await info()).time;
    const p = await k(() => window.__knap.cellScreenPos(2, 4));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 10, p.y, { steps: 3 });
    const g = (await info()).grabbed;
    check('paused: grab works (body grabbed, time does not advance)', g !== null && (await info()).time === t0, { g });
    const shotBefore = await viewShot(page);
    await page.mouse.move(p.x + 300, p.y + 200, { steps: 4 });
    await frames(page, 2);
    const shotAfter = await viewShot(page);
    check('paused: dragging moves nothing until stepped', shotBefore.equals(shotAfter));
    // far outside the window (left/up), then step: target is far away, force capped
    await page.mouse.move(-3000, -2000, { steps: 6 });
    let maxErr = 0;
    for (let i = 0; i < 8; i++) {
      await k(() => window.__knap.stepSim(60));
      const ii = await info();
      if (!ii) break;
      maxErr = Math.max(maxErr, ii.jointError);
    }
    const st = await k(() => window.__knap.getState());
    check('dragged far outside the window: still simulating, joint holds', st.mode === 'simulate' && maxErr < 0.05, { maxErr, banner: st.banner, grabbed: (await info())?.grabbed });
    await viewShot(page, 'review-sim-grab-outside');
    await page.mouse.up(); // released outside the window
    await frames(page, 1);
    const i2 = await info();
    check('released outside the window: grab ends', i2 && i2.grabbed === null, i2);
    // pointer back in: hover must not drag anything
    await page.mouse.move(640, 360, { steps: 3 });
    await k(() => window.__knap.stepSim(60));
    check('after release outside: no lingering grab', (await info()).grabbed === null);
  }

  // 6. Grab while running in real time, then Stop while still holding the mouse.
  await load('four-bar');
  {
    await page.keyboard.press(' '); // run
    await sleep(300);
    const p = await k(() => window.__knap.cellScreenPos(3, 2));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y - 20, { steps: 4 });
    const g = (await info()).grabbed;
    await page.keyboard.press('Escape');
    await frames(page, 1);
    const st = await k(() => window.__knap.getState());
    await page.mouse.move(p.x + 200, p.y + 100, { steps: 4 });
    const cam0 = await k(() => window.__knap.camera());
    await page.mouse.up();
    const st2 = await k(() => window.__knap.getState());
    check('Stop while dragging: back in edit mode, nothing edited, no error', st.mode === 'edit' && st2.mode === 'edit' && !st2.banner, { g, mode: st.mode, msg: st2.message });
    console.log('  camera after stop-while-drag', JSON.stringify(cam0));
  }

  // 7. Heavy free body: the collision example's loose beam, grabbed mid-fall and held.
  await load('collision');
  {
    await k(() => window.__knap.stepSim(60));
    const r = await grabDrag(6, 1, [{ x: 640, y: 200 }, { x: 640, y: 200 }, { x: 640, y: 200 }, { x: 640, y: 200 }], { steps: 120, release: false });
    const cs = await k(() => window.__knap.cellScreenPos(6, 1));
    const d = Math.hypot(cs.x - 640, cs.y - 200);
    check('free loose beam: grabbed and hangs near the cursor (≤ 60 px after 1 s; it hangs from the grab point)', r.grabbed !== null && d <= 60, { ...r, d });
    await page.mouse.up();
    await viewShot(page, 'review-sim-grab-free');
  }
  if (c.errors.length) check('no page errors', false, c.errors);
} finally {
  await h.done();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
for (const r of bad) console.log(`FAILED: ${r.name}  ${JSON.stringify(r.detail)}`);
