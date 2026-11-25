// App e2e: the joint-friction control (DESIGN §5.1 last bullet). Default level and its
// persistence across reloads (and robustness to corrupt / blocked storage); a level picked in edit
// mode is what Play uses (pendulum at rest at Realistic, still swinging at Off after the same
// deterministic number of steps); a change while simulating takes effect, also while starting;
// a level change is no undo step, does not touch the model, its autosave or the saved file; the
// control fits the top bar at 1280×720 and 1440×900 without overlap or truncation.
import { readFile } from 'node:fs/promises';
import { openPage } from './lib.mjs';
import { deepEqual, frames, model, openApp, press, state, status } from './app-lib.mjs';

const PREF_KEY = 'knap.pref.jointFriction';
const AUTOSAVE_KEY = 'knap.autosave.v1';
const LEVELS = { off: 0, low: 0.05, realistic: 0.2 };
/** Fixed steps per simulated second (1/480 s). */
const HZ = 480;
/**
 * Pendulum released horizontal at Realistic: the physics agent measured angular speed < 1e-3 rad/s
 * from 3.58 s and pose-at-rest from 4.0 s (DEVIATIONS §5 "Joint friction"; DESIGN asks for 2–6 s).
 * 6 s gives 2 s of margin.
 */
const REST_STEPS = 6 * HZ;
/** Window over which motion is measured: 0.5 s in 48 samples of 5 steps. */
const WINDOW = { samples: 48, steps: 5 };

/** Which level the top bar marks as active ([data-friction] buttons with class "on" / aria-pressed). */
const marked = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-friction]'))
      .filter((b) => b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.dataset.friction),
  );

/**
 * Motion of every part over WINDOW (deterministic stepping): the largest rotation away from the
 * window's first pose (rad) and the largest angular speed between samples (rad/s).
 */
async function motion(page) {
  const angle = (a, b) => {
    const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return 2 * Math.acos(Math.min(1, d));
  };
  const first = await page.evaluate(() => window.__knap.simTransforms());
  let prev = first;
  let maxAngle = 0;
  let maxSpeed = 0;
  for (let i = 0; i < WINDOW.samples; i++) {
    await page.evaluate((n) => window.__knap.stepSim(n), WINDOW.steps);
    const t = await page.evaluate(() => window.__knap.simTransforms());
    for (const id of Object.keys(t)) {
      if (!t[id] || !first[id]) continue;
      maxAngle = Math.max(maxAngle, angle(first[id].q, t[id].q));
      maxSpeed = Math.max(maxSpeed, angle(prev[id].q, t[id].q) / (WINDOW.steps / HZ));
    }
    prev = t;
  }
  return { maxAngle, maxSpeed };
}

/** Step `n` fixed steps in chunks (keeps each page task short). */
async function stepN(page, n) {
  for (let done = 0; done < n; ) {
    const k = Math.min(480, n - done);
    await page.evaluate((k) => window.__knap.stepSim(k), k);
    done += k;
  }
}

/** Layout of the friction control: inside the top bar, no overflow, no overlap, no truncation. */
async function checkControl(page, assert, label) {
  const r = await page.evaluate(() => {
    const box = (e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height };
    };
    const top = document.querySelector('.topbar');
    const ctl = document.querySelector('[data-role=friction]');
    const items = Array.from(ctl.querySelectorAll('.seg-caption, button')).map((e) => ({ text: e.textContent, sw: e.scrollWidth, cw: e.clientWidth, ...box(e), cell: getComputedStyle(e).borderRightWidth !== '0px' || getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' }));
    const names = Array.from(ctl.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    // Every other top-bar control (leaf-level boxes) must not intersect the friction control.
    const others = Array.from(top.querySelectorAll('button, label, .brand, .sep, .seg, .palette'))
      .filter((e) => !ctl.contains(e) && !e.contains(ctl) && e.getClientRects().length)
      .map((e) => ({ name: e.dataset.action || e.dataset.speed || e.className, ...box(e) }));
    return { top: box(top), topOverflow: top.scrollWidth - top.clientWidth, ctl: box(ctl), ctlOverflow: ctl.scrollWidth - ctl.clientWidth, items, others, title: ctl.getAttribute('title'), aria: ctl.getAttribute('aria-label'), names, captionInSeg: !!ctl.querySelector('.seg .seg-caption') };
  });
  assert(r.topOverflow <= 0, `${label}: top bar fits (${r.topOverflow} px overflow)`);
  assert(r.ctl.x >= r.top.x && r.ctl.r <= r.top.r && r.ctl.y >= r.top.y && r.ctl.b <= r.top.b, `${label}: friction control inside the top bar ${JSON.stringify(r.ctl)}`);
  assert(r.ctlOverflow <= 0, `${label}: friction control not clipped (${r.ctlOverflow} px)`);
  for (const it of r.items) assert(it.sw <= it.cw + 0.5 && it.w > 10, `${label}: "${it.text}" not truncated (${it.sw} > ${it.cw})`);
  assert(deepEqual(r.items.map((i) => i.text), ['Friction', 'Off', 'Low', 'Real']), `${label}: captions ${r.items.map((i) => i.text)}`);
  // The caption is plain text beside the buttons, not a (disabled-looking) cell of the group.
  assert(!r.captionInSeg && !r.items[0].cell, `${label}: "Friction" is plain text outside the segmented group`);
  assert(deepEqual(r.names, ['Off', 'Low', 'Realistic']), `${label}: accessible names use the level names (${r.names})`);
  for (const o of r.others) {
    const overlap = Math.min(o.r, r.ctl.r) - Math.max(o.x, r.ctl.x) > 0.5 && Math.min(o.b, r.ctl.b) - Math.max(o.y, r.ctl.y) > 0.5;
    assert(!overlap, `${label}: ${o.name} does not overlap the friction control`);
  }
  assert(/^Joint friction: how quickly pins and axles lose motion/.test(r.title) && r.aria === r.title, `${label}: title / aria-label say what it does ("${r.title}")`);
}

export default async function ({ page, url, shot, assert, step, errors }) {
  await step('default level is Realistic, marked in the top bar', async () => {
    await openApp(page, url);
    const st = await state(page);
    assert(st.friction === 'realistic', `default level (${st.friction})`);
    assert(deepEqual(await marked(page), ['realistic']), `Real is marked (${await marked(page)})`);
    assert((await page.evaluate((k) => localStorage.getItem(k), PREF_KEY)) === null, 'nothing stored until the user picks a level');
  });

  await step('layout at 1280×720 and 1440×900', async () => {
    await checkControl(page, assert, '1280×720');
    await shot('app-friction-topbar-1280', { clip: { x: 0, y: 0, width: 1280, height: 40 } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await frames(page, 3);
    await checkControl(page, assert, '1440×900');
    await shot('app-friction-topbar-1440', { clip: { x: 0, y: 0, width: 1440, height: 40 } });
    await page.setViewportSize({ width: 1280, height: 720 });
    await frames(page, 3);
  });

  await step('a level change in edit mode: status says what it means; no undo step, model / autosave untouched', async () => {
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await page.evaluate(() => window.__knap.flushAutosave());
    const m0 = await model(page);
    const st0 = await state(page);
    const saved0 = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);
    await press(page, '[data-friction=off]');
    let st = await state(page);
    assert(st.friction === 'off' && deepEqual(await marked(page), ['off']), `Off picked and marked (${st.friction}, ${await marked(page)})`);
    assert(/^Joint friction: Off — ideal joints, motion never dies down/.test((await status(page)).message), `status: "${(await status(page)).message}"`);
    assert(st.historySize === st0.historySize && st.canUndo === st0.canUndo && st.canRedo === st0.canRedo, `no undo step (history ${st0.historySize} → ${st.historySize})`);
    assert(deepEqual(await model(page), m0), 'model unchanged');
    await press(page, '[data-friction=low]');
    assert(/^Joint friction: Low/.test((await status(page)).message), `status for Low: "${(await status(page)).message}"`);
    await press(page, '[data-friction=off]');
    await page.evaluate(() => window.__knap.flushAutosave());
    const saved1 = await page.evaluate((k) => localStorage.getItem(k), AUTOSAVE_KEY);
    assert(saved1 === saved0 && !/friction/i.test(saved1), 'the autosaved model is unchanged and holds no friction level');
    assert((await page.evaluate((k) => localStorage.getItem(k), PREF_KEY)) === 'off', 'level stored as a UI preference');
    // Save: the downloaded file holds no friction level either.
    const dl = page.waitForEvent('download');
    await press(page, '[data-action=save]');
    const text = await readFile(await (await dl).path(), 'utf8');
    assert(!/friction/i.test(text) && deepEqual(JSON.parse(text).parts, m0.parts), 'saved file: the model only, no friction level');
    st = await state(page);
    assert(st.historySize === st0.historySize, 'still no undo step');
  });

  await step('Play uses the level picked in edit mode: Off keeps swinging after 6 s', async () => {
    await page.evaluate(() => window.__knap.stepSim(0)); // Play, paused at t = 0 (same path as the button)
    const info = await page.evaluate(() => window.__knap.simInfo());
    assert(info.jointFriction === LEVELS.off && info.time === 0, `simulation μ = ${info.jointFriction}`);
    await stepN(page, REST_STEPS);
    const mo = await motion(page);
    console.log(`  [app-friction] Off, t = 6.0–6.5 s: max rotation ${mo.maxAngle.toFixed(4)} rad, max angular speed ${mo.maxSpeed.toFixed(3)} rad/s`);
    assert(mo.maxSpeed > 1 && mo.maxAngle > 0.2, `at Off the pendulum still swings at 6 s (${mo.maxSpeed} rad/s, ${mo.maxAngle} rad)`);
    await page.keyboard.press('Escape');
    await frames(page, 1);
  });

  await step('Realistic, picked in edit mode: the pendulum is at rest after 6 s', async () => {
    await press(page, '[data-friction=realistic]');
    // Through the real Play button (then paused by key) to check the session start path…
    await press(page, '[data-action=play]');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    assert((await page.evaluate(() => window.__knap.simInfo())).jointFriction === LEVELS.realistic, 'Play button: μ = 0.2');
    await page.keyboard.press('Escape');
    await frames(page, 1);
    // …and deterministically from t = 0.
    await page.evaluate(() => window.__knap.stepSim(0));
    assert((await page.evaluate(() => window.__knap.simInfo())).jointFriction === LEVELS.realistic, 'μ = 0.2');
    await stepN(page, REST_STEPS);
    const mo = await motion(page);
    console.log(`  [app-friction] Realistic, t = 6.0–6.5 s: max rotation ${mo.maxAngle.toExponential(2)} rad, max angular speed ${mo.maxSpeed.toExponential(2)} rad/s`);
    assert(mo.maxAngle < 1e-3 && mo.maxSpeed < 0.01, `at Realistic the pendulum is at rest at 6 s (${mo.maxAngle} rad, ${mo.maxSpeed} rad/s)`);
    await shot('app-friction-rest');
    await page.keyboard.press('Escape');
    await frames(page, 1);
  });

  await step('a change while simulating takes effect: Off → Realistic mid-swing brings it to rest', async () => {
    await press(page, '[data-friction=off]');
    await page.evaluate(() => window.__knap.stepSim(0));
    await stepN(page, 2 * HZ);
    const h0 = (await state(page)).historySize;
    // Paused: the control is enabled and acts.
    assert(!(await page.locator('[data-friction=realistic]').isDisabled()), 'enabled while simulating');
    await press(page, '[data-friction=realistic]');
    const info = await page.evaluate(() => window.__knap.simInfo());
    assert(info.jointFriction === LEVELS.realistic && (await state(page)).friction === 'realistic', `μ now ${info.jointFriction}`);
    assert((await state(page)).mode === 'simulate' && (await state(page)).historySize === h0, 'still simulating; no undo step');
    assert(/^Joint friction: Realistic/.test((await status(page)).message), 'status says so');
    // From t = 2 s the swing is still large (frictionless so far); with friction it stops within 6 s.
    await stepN(page, REST_STEPS);
    const mo = await motion(page);
    assert(mo.maxAngle < 1e-3 && mo.maxSpeed < 0.01, `at rest after switching to Realistic (${mo.maxAngle} rad, ${mo.maxSpeed} rad/s)`);
    // Running (not paused): a click applies to the live simulation.
    await page.keyboard.press(' ');
    await frames(page, 2);
    assert(!(await state(page)).paused, 'running');
    await press(page, '[data-friction=low]');
    assert((await page.evaluate(() => window.__knap.simInfo())).jointFriction === LEVELS.low, 'running: μ = 0.05 applied');
    await page.keyboard.press('Escape');
    await frames(page, 1);
    assert((await state(page)).mode === 'edit' && (await state(page)).friction === 'low', 'Stop keeps the level');
  });

  await step('a level picked while the simulation is starting is the level it runs with', async () => {
    const key = (k) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }));`;
    const r = await page.evaluate(`(() => { ${key(' ')} const m = window.__knap.getState().mode; document.querySelector('[data-friction="off"]').click(); return m; })()`);
    await page.waitForFunction(() => window.__knap.getState().mode !== 'starting', null, { timeout: 60000 });
    assert(r === 'starting', `the click arrived while starting (${r})`);
    const info = await page.evaluate(() => window.__knap.simInfo());
    assert((await state(page)).mode === 'simulate' && info.jointFriction === LEVELS.off && (await state(page)).friction === 'off', `level set while starting applies (sim μ ${info.jointFriction})`);
    await page.keyboard.press('Escape');
    await frames(page, 1);
    // And the test hook's setter.
    await page.evaluate(() => window.__knap.setFriction('realistic'));
    assert((await state(page)).friction === 'realistic' && deepEqual(await marked(page), ['realistic']), 'setFriction() picks and marks the level');
  });

  await step('the level survives a reload; corrupt storage falls back to the default', async () => {
    await page.evaluate(() => window.__knap.setFriction('low'));
    await openApp(page, url);
    assert((await state(page)).friction === 'low' && deepEqual(await marked(page), ['low']), `reload keeps Low (${(await state(page)).friction})`);
    await page.evaluate((k) => localStorage.setItem(k, '{"not":"a level"}'), PREF_KEY);
    await openApp(page, url);
    assert((await state(page)).friction === 'realistic' && deepEqual(await marked(page), ['realistic']), 'corrupt value → Realistic');
    await page.evaluate((k) => localStorage.setItem(k, 'toString'), PREF_KEY);
    await openApp(page, url);
    assert((await state(page)).friction === 'realistic', 'prototype key name → Realistic');
    await page.evaluate(() => window.__knap.stepSim(0));
    assert((await page.evaluate(() => window.__knap.simInfo())).jointFriction === LEVELS.realistic, 'and the simulation uses it');
    await page.keyboard.press('Escape');
    await frames(page, 1);
  });

  await step('blocked storage: default level, picking still works, no errors', async () => {
    const browser = page.context().browser();
    const c = await openPage(browser, url, 'app-friction-blocked');
    try {
      await c.page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get() {
            throw new DOMException('blocked', 'SecurityError');
          },
        });
      });
      await openApp(c.page, url);
      assert((await state(c.page)).friction === 'realistic', 'default level without storage');
      await press(c.page, '[data-friction=off]');
      assert((await state(c.page)).friction === 'off' && /^Joint friction: Off/.test((await status(c.page)).message), 'Off picked without storage');
      await c.page.evaluate(() => window.__knap.stepSim(1));
      assert((await c.page.evaluate(() => window.__knap.simInfo())).jointFriction === 0, 'simulation uses it');
      assert(c.errors.length === 0, `no errors: ${c.errors.join(' | ')}`);
    } finally {
      await c.close();
    }
  });

  await step('arrow keys on a focused speed / friction button move the focus within the group, never the selected part', async () => {
    await openApp(page, url);
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await frames(page, 2);
    await page.keyboard.press('v');
    const id = await page.evaluate(() => window.__knap.getModel().parts[1].id);
    const pos = await page.evaluate((id) => window.__knap.partScreenPos(id), id);
    await page.mouse.click(pos.x, pos.y);
    await frames(page, 2);
    assert((await state(page)).selection !== null, 'a part is selected');
    for (const [sel, keys, focusAfter] of [
      ['[data-friction=off]', ['ArrowLeft'], '[data-friction=realistic]'],
      ['[data-friction=low]', ['ArrowRight', 'ArrowDown'], '[data-friction=off]'],
      ['[data-speed="1"]', ['ArrowUp'], '[data-speed="0.1"]'],
    ]) {
      const m0 = await model(page);
      const st0 = await state(page);
      await page.locator(sel).focus();
      for (const k of keys) await page.keyboard.press(k);
      await frames(page, 2);
      const st = await state(page);
      assert(deepEqual(await model(page), m0) && st.historySize === st0.historySize, `${sel} + ${keys}: the model is unchanged`);
      assert(st.friction === st0.friction && st.speed === st0.speed, `${sel} + ${keys}: no level changed by the arrows`);
      assert(await page.evaluate((s) => document.activeElement === document.querySelector(s), focusAfter), `${sel} + ${keys}: focus moved to ${focusAfter}`);
    }
    await page.keyboard.press('Space');
    await frames(page, 2);
    assert((await state(page)).speed === 0.1, 'Space activates the focused button');
  });

  assert(errors.length === 0, `no console errors: ${errors.join(' | ')}`);
}
