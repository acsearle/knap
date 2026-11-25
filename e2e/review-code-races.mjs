// Reviewer "code": state-machine races and keyboard probes. Run: node e2e/review-code-races.mjs [probe...]
import { runProbes, st, sleep } from './review-code-lib.mjs';
import { frames, press } from './app-lib.mjs';

const probes = {
  // Space, then Esc immediately while the mode is still 'starting'.
  async escDuringStarting({ page }) {
    await page.mouse.move(5, 300);
    await page.keyboard.press('Space');
    const m1 = (await st(page)).mode;
    await page.keyboard.press('Escape');
    const m2 = (await st(page)).mode;
    await page.waitForFunction(() => window.__knap.getState().mode !== 'starting', null, { timeout: 60000 });
    const s = await st(page);
    return { afterSpace: m1, afterEsc: m2, final: s.mode, message: s.message.text };
  },

  // Change speed while 'starting'.
  async speedDuringStarting({ page }) {
    await page.keyboard.press('Space');
    const m1 = (await st(page)).mode;
    await page.evaluate(() => document.querySelector('[data-speed="1"]').click());
    const s0 = await st(page);
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    const info = await page.evaluate(() => window.__knap.simInfo());
    const on = await page.evaluate(() => document.querySelector('.seg .on')?.dataset.speed);
    return { modeWhenClicked: m1, appSpeed: s0.speed, buttonShownOn: on, simSpeed: info.speed };
  },

  // Double-click Play.
  async doubleClickPlay({ page }) {
    const b = await page.locator('[data-action=play]').boundingBox();
    await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForFunction(() => window.__knap.getState().mode !== 'starting', null, { timeout: 60000 });
    await frames(page, 2);
    return { mode: (await st(page)).mode, info: await page.evaluate(() => window.__knap.simInfo()) };
  },

  // Press in simulate on empty space with a build tool armed before? (tools disabled) -> instead: edit mode
  // pointer down, Space (play), wait for simulate, release => is anything edited / does click fire?
  // And: simulate, press, Esc (stop), release on grid with pinHole tool => does it build?
  async releaseAfterStop({ page }) {
    await page.keyboard.press('1'); // pin hole tool
    const pos = await page.evaluate(() => window.__knap.clientPosOfGrid(-6, -6) ?? window.__knap.clientPosOfGrid(8, 8));
    if (!pos) return { skipped: 'no grid pos' };
    const before = (await page.evaluate(() => window.__knap.getModel())).parts.length;
    await page.evaluate(() => window.__knap.setMode('simulate'));
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await frames(page, 1);
    const after = (await page.evaluate(() => window.__knap.getModel())).parts.length;
    return { mode: (await st(page)).mode, partsBefore: before, partsAfter: after, msg: (await st(page)).message.text };
  },

  // Rotation keys on layouts where [ ] need AltGr / Option.
  async bracketWithAlt({ page }) {
    const m = await page.evaluate(() => window.__knap.getModel());
    const id = m.parts[1].id;
    // select via test-free path: click its face
    const p = await page.evaluate((id) => window.__knap.partScreenPos(id), id);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 1);
    const sel = (await st(page)).selection;
    const h0 = (await st(page)).historySize;
    // German Mac: Option+5 => key '[' with altKey; Windows AltGr+8 => key '[' with ctrlKey+altKey.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', code: 'Digit5', altKey: true, bubbles: true })));
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', code: 'Digit9', altKey: true, ctrlKey: true, bubbles: true })));
    const h1 = (await st(page)).historySize;
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', code: 'BracketLeft', bubbles: true })));
    const h2 = (await st(page)).historySize;
    return { selection: sel, historyBefore: h0, afterAltBrackets: h1, afterPlainBracket: h2, msg: (await st(page)).message.text };
  },

  // Keyboard user: Tab to the "Show kinematics" checkbox and press Space.
  async spaceOnFocusedCheckbox({ page }) {
    await page.focus('[data-action=kinematics]');
    await page.keyboard.press('Space');
    await sleep(300);
    const s = await st(page);
    return { showKinematics: s.showKinematics, mode: s.mode };
  },

  // Keyboard user: focus the "New" button and press Space (button activation).
  async spaceOnFocusedButton({ page }) {
    await page.evaluate(() => window.__knap.setModel({ version: 1, parts: [] }));
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await page.focus('[data-action=new]');
    await page.keyboard.press('Space');
    await sleep(300);
    const s = await st(page);
    const parts = (await page.evaluate(() => window.__knap.getModel())).parts.length;
    return { mode: s.mode, parts };
  },

  // F while the help dialog is open (modal) — does the camera move?
  async fWithHelpOpen({ page }) {
    await page.evaluate(() => window.__knap.setView('front'));
    await page.keyboard.press('?');
    const open = await page.evaluate(() => !document.querySelector('[data-role=help]').closest('.overlay').hidden);
    const c0 = await page.evaluate(() => window.__knap.camera());
    await page.keyboard.press('Home');
    await sleep(600);
    const c1 = await page.evaluate(() => window.__knap.camera());
    return { helpOpen: open, camBefore: { yaw: c0.yaw, pitch: c0.pitch }, camAfter: { yaw: c1.yaw, pitch: c1.pitch } };
  },

  // Arrow auto-repeat: 40 repeated keydowns -> 40 history entries?
  async arrowRepeat({ page }) {
    const m = await page.evaluate(() => window.__knap.getModel());
    const id = m.parts[1].id;
    const p = await page.evaluate((id) => window.__knap.partScreenPos(id), id);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    const h0 = (await st(page)).historySize;
    for (let i = 0; i < 20; i++) await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: true, bubbles: true })));
    const s = await st(page);
    return { selection: s.selection, h0, h1: s.historySize, msg: s.message.text };
  },

  // Undo while simulating via the Undo button state & keyboard; Open via Ctrl+O during simulation.
  async editsBlockedInSim({ page }) {
    await page.evaluate(() => window.__knap.setMode('simulate'));
    const h0 = (await st(page)).historySize;
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Meta+z');
    const ok = await page.evaluate(() => window.__knap.openText('x.json', JSON.stringify({ version: 1, parts: [] })));
    const s = await st(page);
    return { h0, h1: s.historySize, openTextAccepted: ok, msg: s.message.text, mode: s.mode };
  },

  // Step pressed twice quickly from edit mode ('.' '.').
  async stepTwiceFromEdit({ page }) {
    await page.keyboard.press('.');
    await page.keyboard.press('.');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await sleep(200);
    return await page.evaluate(() => window.__knap.simInfo());
  },

  // Pause -> Stop -> Play: new session state; and step while running.
  async pauseStopPlay({ page }) {
    await page.evaluate(() => window.__knap.setMode('simulate'));
    await page.keyboard.press('Space'); // pause
    const p1 = (await st(page)).paused;
    await page.keyboard.press('Escape');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    const s = await st(page);
    return { pausedBeforeStop: p1, pausedAfterReplay: s.paused, mode: s.mode, pauseBtnLabel: await page.getAttribute('[data-action=pause]', 'aria-label'), pauseBtnTitle: await page.getAttribute('[data-action=pause]', 'title') };
  },

  async pauseButtonA11y({ page }) {
    await page.evaluate(() => window.__knap.setMode('simulate'));
    await page.keyboard.press('Space');
    return {
      paused: (await st(page)).paused,
      ariaLabel: await page.getAttribute('[data-action=pause]', 'aria-label'),
      ariaPressed: await page.getAttribute('[data-action=pause]', 'aria-pressed'),
      speedPressed: await page.evaluate(() => [...document.querySelectorAll('[data-speed]')].map((b) => b.getAttribute('aria-pressed'))),
      menuItemsRoleOk: await page.evaluate(() => document.querySelector('[data-role=examples-menu]').getAttribute('role')),
    };
  },
};

await runProbes(probes);
