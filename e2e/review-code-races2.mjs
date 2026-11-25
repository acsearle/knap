// Reviewer "code": races forced by dispatching keys synchronously (no await between them).
import { runProbes, st, sleep } from './review-code-lib.mjs';
import { frames, settle } from './app-lib.mjs';

const key = (k, extra = {}) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true, ...${JSON.stringify(extra)} }));`;

const probes = {
  async escDuringStartingSync({ page }) {
    const r = await page.evaluate(`(() => { ${key(' ')} const a = window.__knap.getState().mode; ${key('Escape')} return [a, window.__knap.getState().mode, window.__knap.getState().message.text]; })()`);
    await page.waitForFunction(() => window.__knap.getState().mode !== 'starting', null, { timeout: 60000 });
    await sleep(300);
    const s = await st(page);
    return { atSpace: r[0], afterEsc: r[1], msgAfterEsc: r[2], final: s.mode, time: (await page.evaluate(() => window.__knap.simInfo()))?.time };
  },

  async speedDuringStartingSync({ page }) {
    const r = await page.evaluate(`(() => { ${key(' ')} const a = window.__knap.getState().mode; document.querySelector('[data-speed="1"]').click(); return a; })()`);
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    const info = await page.evaluate(() => window.__knap.simInfo());
    const s = await st(page);
    return { modeWhenClicked: r, appSpeed: s.speed, buttonShownOn: await page.evaluate(() => document.querySelector('.seg .on')?.dataset.speed), simSpeed: info.speed };
  },

  async kinematicsDuringStarting({ page }) {
    const r = await page.evaluate(`(() => { ${key(' ')} const a = window.__knap.getState().mode; ${key('k')} return a; })()`);
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    return { modeWhenK: r, showKinematics: (await st(page)).showKinematics };
  },

  async homeWithHelpOpen({ page }) {
    await page.evaluate(() => window.__knap.setView('front'));
    await page.keyboard.press('?');
    const open = await page.evaluate(() => !document.querySelector('[data-role=help]').closest('.overlay').hidden);
    await page.keyboard.press('f');
    await page.keyboard.press('Home');
    await sleep(1500);
    await settle(page);
    const c1 = await page.evaluate(() => window.__knap.camera());
    await page.keyboard.press('Escape');
    await page.keyboard.press('Home');
    await sleep(1500);
    await settle(page);
    const c2 = await page.evaluate(() => window.__knap.camera());
    return { helpOpen: open, withDialog: { yaw: c1.yaw, pitch: c1.pitch }, withoutDialog: { yaw: c2.yaw, pitch: c2.pitch } };
  },

  async bracketWithAlt({ page }) {
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await settle(page);
    const m = await page.evaluate(() => window.__knap.getModel());
    const out = { parts: m.parts.map((p) => p.id) };
    for (const part of m.parts) {
      const p = await page.evaluate((id) => window.__knap.partScreenPos(id), part.id);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
      await frames(page, 1);
      const sel = (await st(page)).selection;
      if (sel === null) continue;
      const h0 = (await st(page)).historySize;
      await page.evaluate(`(() => { ${key('[', { code: 'Digit5', altKey: true })} ${key(']', { code: 'Digit9', altKey: true, ctrlKey: true })} })()`);
      const h1 = (await st(page)).historySize;
      await page.evaluate(`(() => { ${key('[', { code: 'BracketLeft' })} })()`);
      const s = await st(page);
      out[`part${sel}`] = { h0, afterAlt: h1, afterPlain: s.historySize, msg: s.message.text };
      if (s.historySize > h1) break;
    }
    return out;
  },

  async releaseAfterStop({ page }) {
    await page.keyboard.press('1');
    let pos = null;
    for (const [x, z] of [[-4, 4], [4, 4], [-4, -4], [2, 6], [6, 2], [-2, 6], [0, 6]]) {
      pos = await page.evaluate(([x, z]) => window.__knap.clientPosOfGrid(x, z), [x, z]);
      if (pos) break;
    }
    if (!pos) return { skipped: 'no grid pos' };
    const before = (await page.evaluate(() => window.__knap.getModel())).parts.length;
    await page.evaluate(() => window.__knap.setMode('simulate'));
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await frames(page, 1);
    const after = (await page.evaluate(() => window.__knap.getModel())).parts.length;
    const s = await st(page);
    return { mode: s.mode, partsBefore: before, partsAfter: after, msg: s.message.text };
  },

  // A press in edit mode, Space (play) while held, release: click in simulate is ignored? and press in sim
  async pressInEditReleaseInSim({ page }) {
    await page.keyboard.press('1');
    let pos = null;
    for (const [x, z] of [[-4, 4], [4, 4], [-4, -4], [2, 6]]) {
      pos = await page.evaluate(([x, z]) => window.__knap.clientPosOfGrid(x, z), [x, z]);
      if (pos) break;
    }
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.mouse.up();
    // now mouse is up; next presses must work
    await page.keyboard.press('Escape');
    const before = (await page.evaluate(() => window.__knap.getModel())).parts.length;
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 1);
    const after = (await page.evaluate(() => window.__knap.getModel())).parts.length;
    return { before, after };
  },
};

await runProbes(probes);
