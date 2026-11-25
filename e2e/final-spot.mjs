// Final spot checks of claimed fixes (not part of `npm run e2e`): node e2e/final-spot.mjs (uses dist/)
import { launchBrowser, openPage, startServer } from './lib.mjs';
import { clickAt, facePos, frames, gridPos, hover, model, openApp, press, settle, state, status, summary } from './app-lib.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};
const server = await startServer();
const browser = await launchBrowser();
const fresh = async (name, vp, init) => {
  const c = await openPage(browser, server.url, name, vp);
  if (init) await c.page.addInitScript(init);
  await openApp(c.page, server.url);
  return c;
};
try {
  // ---- major 2: input during the starting window
  {
    const c = await fresh('spot-start');
    const { page } = c;
    const m0 = await model(page);
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__knap.getState().mode !== 'starting' && !window.__knap.getState().message.startsWith('Starting'), null, { timeout: 60000 }).catch(() => {});
    for (let i = 0; i < 20; i++) { await frames(page, 2); if ((await state(page)).mode === 'edit' && /cancel/i.test((await state(page)).message)) break; }
    const st = await state(page);
    check('M2: Space then Esc immediately ends in edit mode', st.mode === 'edit', `mode=${st.mode} message="${st.message?.text}"`);
    check('M2: model untouched', JSON.stringify(await model(page)) === JSON.stringify(m0));
    // two quick steps from edit
    await page.keyboard.press('.');
    await page.keyboard.press('.');
    await page.waitForFunction(() => window.__knap.simInfo() && window.__knap.simInfo().time > 0, null, { timeout: 60000 });
    await frames(page, 3);
    const t = (await page.evaluate(() => window.__knap.simInfo())).time;
    check('M2: two quick "." from edit step twice (t = 2/60)', Math.abs(t - 2 / 60) < 1e-6, `t=${t}`);
    await page.keyboard.press('Escape'); await frames(page, 1);
    // speed chosen during starting
    await page.keyboard.press('Space');
    await press(page, '[data-speed="1"]').catch(async () => { /* fall back: find speed button by text */ await page.locator('button', { hasText: '1×' }).first().click(); });
    await page.waitForFunction(() => window.__knap.simInfo(), null, { timeout: 60000 });
    await frames(page, 3);
    const info = await page.evaluate(() => window.__knap.simInfo());
    const shown = (await state(page)).speed;
    check('M2: speed picked while starting is applied', info.speed === shown, `sim speed ${info.speed}, UI speed ${shown}`);
    await page.keyboard.press('Escape');
    check('M2: no page errors', c.errors.length === 0, c.errors.join(' | '));
    await c.close();
  }

  // ---- major 3: [ ] via Option / AltGr
  {
    const c = await fresh('spot-bracket');
    const { page } = c;
    await press(page, '[data-action=new]');
    await page.keyboard.press('1');
    await clickAt(page, await gridPos(page, 0, 0));
    await page.keyboard.press('Escape');
    await hover(page, await facePos(page, 1, 0, 0));
    await page.mouse.down(); await page.mouse.up(); await frames(page, 1);
    const sel = (await state(page)).selection;
    const h0 = (await state(page)).historySize;
    const send = (key, code, mods) => page.evaluate(([key, code, mods]) => window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...mods })), [key, code, mods]);
    await send('[', 'Digit5', { altKey: true }); // German Mac: Option+5 = [
    await frames(page, 1);
    const h1 = (await state(page)).historySize;
    await send(']', 'Digit9', { altKey: true, ctrlKey: true }); // AltGr+9 on Windows DE
    await frames(page, 1);
    const h2 = (await state(page)).historySize;
    await send('[', 'BracketLeft', { metaKey: true });
    await frames(page, 1);
    const h3 = (await state(page)).historySize;
    check('M3: Option+[ rotates the selection', h1 === h0 + 1, `sel ${JSON.stringify(sel)} history ${h0}→${h1}`);
    check('M3: AltGr+] rotates the selection', h2 === h1 + 1, `${h1}→${h2}`);
    check('M3: Cmd+[ is not taken', h3 === h2, `${h2}→${h3}`);
    const btn = await page.locator('button', { hasText: '↺' }).count() + await page.locator('[title*="otate"]').count();
    check('M3: inspector rotate buttons exist', btn > 0, `${btn}`);
    await c.close();
  }

  // ---- minor 10: a press made while simulating, released after Esc, builds nothing
  {
    const c = await fresh('spot-press');
    const { page } = c;
    await page.keyboard.press('1');
    const gp = await gridPos(page, 2, 4);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    const n0 = (await model(page)).parts.length;
    await page.mouse.move(gp.x, gp.y);
    await page.mouse.down();
    await page.keyboard.press('Escape');
    await frames(page, 2);
    await page.mouse.up();
    await frames(page, 2);
    const n1 = (await model(page)).parts.length;
    check('m10: press in simulate, release after Esc builds nothing', n1 === n0 && (await state(page)).mode === 'edit', `parts ${n0}→${n1}`);
    // and a normal click now does build
    await clickAt(page, gp);
    check('m10: a normal click afterwards still builds', (await model(page)).parts.length === n0 + 1);
    await c.close();
  }

  // ---- minor 11: selection across undo of an example load
  {
    const c = await fresh('spot-sel');
    const { page } = c;
    await hover(page, await facePos(page, 3, 0, 4));
    await page.mouse.down(); await page.mouse.up(); await frames(page, 1);
    const s0 = (await state(page)).selection;
    await press(page, '[data-action=examples]');
    await press(page, '[data-example=pendulum]');
    await settle(page);
    // select part 2 in the pendulum
    await hover(page, await facePos(page, 2, 0, 4));
    await page.mouse.down(); await page.mouse.up(); await frames(page, 1);
    const s1 = (await state(page)).selection;
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await frames(page, 2);
    const s2 = (await state(page)).selection;
    const fn = (await state(page)).fileName;
    check('m11/12: undo across example load clears selection and restores file name', (s2 == null || (Array.isArray(s2) && s2.length === 0)) && fn === 'four-bar', `before ${JSON.stringify(s0)} pendulum-sel ${JSON.stringify(s1)} after undo ${JSON.stringify(s2)} file ${fn}`);
    await c.close();
  }

  // ---- minor 15: lost pointer capture ends the orbit
  {
    const c = await fresh('spot-capture');
    const { page } = c;
    const box = await page.locator('canvas').boundingBox();
    const x = box.x + box.width * 0.3, y = box.y + box.height * 0.7;
    const yaw0 = (await page.evaluate(() => window.__knap.camera())).yaw;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 4 }); await frames(page, 1);
    const yaw1 = (await page.evaluate(() => window.__knap.camera())).yaw;
    await page.evaluate(() => {
      const cv = document.querySelector('canvas');
      cv.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, pointerType: 'mouse', bubbles: true }));
    });
    await page.mouse.move(x + 200, y, { steps: 6 }); await frames(page, 1);
    const yaw2 = (await page.evaluate(() => window.__knap.camera())).yaw;
    await page.mouse.up(); await frames(page, 1);
    check('m15: orbit started', Math.abs(yaw1 - yaw0) > 1e-3, `${yaw0.toFixed(3)}→${yaw1.toFixed(3)}`);
    check('m15: after lostpointercapture further moves do not orbit', Math.abs(yaw2 - yaw1) < 1e-6, `${yaw1.toFixed(3)}→${yaw2.toFixed(3)}`);
    c.errors.length = 0;
    await c.close();
  }

  // ---- minor 16: autosave failure badge
  {
    const c = await fresh('spot-quota', undefined, () => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (String(k).includes('knap')) throw new DOMException('quota', 'QuotaExceededError'); return orig.call(this, k, v); };
    });
    const { page } = c;
    await press(page, '[data-action=examples]');
    await press(page, '[data-example=pendulum]');
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__knap.flushAutosave());
    await frames(page, 2);
    const w = await page.evaluate(() => { const e = document.querySelector('[data-role=status-warning]'); return e ? { text: e.textContent, hidden: e.hidden || getComputedStyle(e).display === 'none', title: e.title } : null; });
    check('m16: failing autosave shows a persistent "Not autosaved" badge', w && !w.hidden && /Not autosaved/.test(w.text), JSON.stringify(w));
    c.errors.length = 0;
    await c.shot('final-spot-quota');
    await c.close();
  }

  // ---- minor 1: build hint fits at 1280×720 (hole tool over a pin end, the longest hint)
  {
    const c = await fresh('spot-hint');
    const { page } = c;
    await page.keyboard.press('1');
    // four-bar: pin part 5 at (0,0,0)-(0,0,1); its end face +Z at z=1 is inside the crank hole; use the grid instead + a face
    await hover(page, await facePos(page, 3, 2, 4));
    const r = await page.evaluate(() => {
      const el = document.querySelector('[data-role=status-hint]');
      const range = document.createRange(); range.selectNodeContents(el);
      const tr = range.getBoundingClientRect(); const er = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { text: el.textContent, textRight: tr.right, contentRight: er.right - parseFloat(cs.paddingRight), sw: el.scrollWidth, cw: el.clientWidth };
    });
    check('m1: status hint not clipped at 1280×720', r.textRight <= r.contentRight + 0.5 && r.sw <= r.cw, JSON.stringify(r));
    await c.shot('final-spot-hint-1280');
    await c.close();
  }

  // ---- minor 5: Examples menu keyboard: Space on an item loads it, not Play
  {
    const c = await fresh('spot-menu');
    const { page } = c;
    await press(page, '[data-action=examples]');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-example'));
    await page.keyboard.press('Space');
    await frames(page, 3);
    const st = await state(page);
    check('m5: arrows move in the Examples menu, Space loads the item (no Play)', st.mode === 'edit' && focused && st.fileName === focused, `focused ${focused}, mode ${st.mode}, file ${st.fileName}`);
    await c.close();
  }

  // ---- major 6 check from a fresh empty model with all defaults
  {
    const c = await fresh('spot-defaults');
    const { page } = c;
    await press(page, '[data-action=new]');
    await page.keyboard.press('1');
    await clickAt(page, await gridPos(page, 0, 0));
    await page.keyboard.press('4');
    const m = await model(page);
    await hover(page, await facePos(page, 1, 0, 4));
    const h = (await status(page)).hint;
    await page.mouse.down(); await page.mouse.up(); await frames(page, 1);
    await page.keyboard.press('1');
    const pin = (await model(page)).parts.find((p) => p.cells[0].kind === 'pin');
    // click the pin's +X side → extends? we want the pin's end: lengthen first with pin tool
    await page.keyboard.press('4');
    await hover(page, await facePos(page, pin.id, 0, 4)); await page.mouse.down(); await page.mouse.up(); await frames(page, 1);
    await page.keyboard.press('1');
    const pin2 = (await model(page)).parts.find((p) => p.id === pin.id);
    await clickAt(page, await facePos(page, pin.id, pin2.cells.findIndex((q) => q.z === 1), 4));
    const link = (await model(page)).parts.at(-1);
    await clickAt(page, await facePos(page, link.id, 0, 0));
    await clickAt(page, await facePos(page, link.id, 1, 0));
    const s = await summary(page);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.evaluate(() => window.__knap.setPaused(true));
    await page.evaluate(() => window.__knap.stepSim(480));
    const t = (await page.evaluate(() => window.__knap.simTransforms()))[link.id];
    const ang = (2 * Math.acos(Math.min(1, Math.abs(t.q[3]))) * 180) / Math.PI;
    check('M6: all-defaults pendulum moves', s.revolute === 1 && ang > 20, `${s.summary}; hint "${h}"; link turned ${ang.toFixed(1)}° in 1 s; parts ${m.parts.length}`);
    await c.close();
  }
} catch (e) {
  check('spot script ran', false, e.stack ?? String(e));
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nfinal-spot: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
