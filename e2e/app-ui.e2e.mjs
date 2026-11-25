// App e2e: UI details found by the review round (minor findings). Start-up camera, the status
// bar at 1280×720, messages after Stop / for N / for the top palette, keyboard focus (checkbox,
// buttons, the Examples menu, the modal Controls dialog, F / Home), a press made while simulating
// and released after Stop, undo / redo across an example load (selection, Save's file name), the
// "Not autosaved" indicator, the banner across a WebGL context loss, and a lost pointer capture.
import { openPage } from './lib.mjs';
import { clickAt, facePos, frames, gridPos, hover, model, openApp, press, settle, state, status } from './app-lib.mjs';

const cam = (page) => page.evaluate(() => window.__knap.camera());
const active = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName ?? '', inDialog: !!a?.closest('[role=dialog]'), example: a?.getAttribute('data-example') ?? null, action: a?.getAttribute('data-action') ?? null };
  });

export default async function ({ page, url, shot, assert, step }) {
  await step('the start-up view is fitted like Home', async () => {
    await openApp(page, url);
    const c0 = await cam(page);
    await page.evaluate(() => window.__knap.home());
    const c1 = await cam(page);
    assert(Math.abs(c0.height - c1.height) / c1.height < 0.01, `start-up height ${c0.height.toFixed(3)} = Home's ${c1.height.toFixed(3)}`);
    assert(Math.hypot(...c0.target.map((v, i) => v - c1.target[i])) < 1e-3, 'same pivot as Home');
  });

  await step('1280×720: the build hint with its [R] / Shift alternatives fits', async () => {
    await page.keyboard.press('1');
    await hover(page, await facePos(page, 3, 4, 2));
    // (scrollWidth misses a sub-pixel overflow, which still draws an ellipsis: compare the text's
    // right edge with the cell's content edge instead.)
    const r = await page.evaluate(() => {
      const e = document.querySelector('.st-hint');
      const range = document.createRange();
      range.selectNodeContents(e);
      const end = Math.max(...[...range.getClientRects()].map((q) => q.right));
      const box = e.getBoundingClientRect().right - parseFloat(getComputedStyle(e).paddingRight);
      return { text: e.textContent, end, box };
    });
    assert(/Shift: /.test(r.text) && /\[R\]/.test(r.text), `hint has both alternatives: "${r.text}"`);
    assert(r.end <= r.box + 0.001, `hint not truncated (text ends at ${r.end}, cell at ${r.box}): "${r.text}"`);
    await shot('app-ui-status-1280');
  });

  await step('the ∥ in status sentences is drawn full height', async () => {
    const r = await page.evaluate(async () => {
      const loaded = await document.fonts.load('12px knap-parallel', '∥');
      const ctx = document.createElement('canvas').getContext('2d');
      const ink = (font) => {
        ctx.font = font;
        const m = ctx.measureText('∥');
        return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      };
      return { available: loaded.length > 0, page: ink(`100px ${getComputedStyle(document.body).fontFamily}`), system: ink('100px system-ui') };
    });
    console.log(`  [app-ui] ∥ ink height per 100 px: page font ${r.page.toFixed(1)}, system-ui ${r.system.toFixed(1)}, symbol font available: ${r.available}`);
    // Only checkable where one of the fonts named in styles.css is installed (it is on macOS).
    if (r.available) assert(r.page >= 65, `∥ is at least cap height (${r.page.toFixed(1)} px per 100 px)`);
  });

  await step('a press made while simulating and released after Stop edits nothing', async () => {
    let g = null;
    for (const [x, z] of [[-3, 3], [-2, 4], [0, 5], [6, -3], [7, 0], [-4, -2]]) {
      g = await gridPos(page, x, z).catch(() => null);
      if (g) break;
    }
    assert(g, 'an empty grid cell on screen');
    await hover(page, g);
    assert(/^New part on grid/.test((await status(page)).hint), 'in edit mode a click here would build');
    const n0 = (await model(page)).parts.length;
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.mouse.down();
    await page.keyboard.press('Escape');
    await frames(page, 1);
    assert((await state(page)).mode === 'edit', 'Esc stopped');
    await page.mouse.up();
    await frames(page, 1);
    assert((await model(page)).parts.length === n0, 'no part built by the release');
  });

  await step('after Stop the status bar no longer says Space pauses', async () => {
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    assert(/Space pauses/.test((await state(page)).message.text), 'simulating message');
    await page.keyboard.press('Escape');
    await frames(page, 1);
    const m = (await state(page)).message.text;
    assert(/^Stopped/.test(m) && !/Space pauses|Esc stops|Running/.test(m), `message after Stop: "${m}"`);
  });

  await step('F / Home work right after clicking Show kinematics; Space then plays', async () => {
    await page.keyboard.press('v');
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -300);
    await settle(page);
    const c0 = await cam(page);
    await page.locator('label.toggle').click();
    await frames(page, 2);
    assert((await state(page)).showKinematics, 'kinematics shown');
    assert((await active(page)).tag !== 'INPUT', 'the clicked checkbox does not keep focus');
    await page.keyboard.press('Home');
    await settle(page);
    const c1 = await cam(page);
    assert(Math.abs(c1.height - c0.height) > 1e-3, `Home acted (${c0.height} → ${c1.height})`);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    assert((await state(page)).showKinematics, 'Space played and did not toggle the checkbox');
    await page.keyboard.press('Escape');
    await page.keyboard.press('k');
    await frames(page, 1);
  });

  await step('keyboard-focused controls: Space activates them', async () => {
    await page.focus('[data-action=kinematics]');
    await page.keyboard.press('Space');
    await frames(page, 1);
    let s = await state(page);
    assert(s.showKinematics && s.mode === 'edit', `Space toggled the focused checkbox (kin ${s.showKinematics}, mode ${s.mode})`);
    await page.keyboard.press('Space');
    await frames(page, 1);
    assert(!(await state(page)).showKinematics, 'and back');
    await page.focus('[data-action=help]');
    await page.keyboard.press('Space');
    await frames(page, 1);
    s = await state(page);
    assert((await page.locator('[data-role=help]').isVisible()) && s.mode === 'edit', 'Space on the focused ? button opens the controls, no Play');
  });

  await step('Controls dialog: Tab stays inside, F / Home do nothing behind it', async () => {
    // (open from the previous step)
    await page.evaluate(() => window.__knap.setView('front'));
    const c0 = await cam(page);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const a = await active(page);
      assert(a.inDialog, `Tab ${i + 1}: focus stays in the dialog (${a.tag})`);
    }
    await page.keyboard.press('Shift+Tab');
    assert((await active(page)).inDialog, 'Shift+Tab too');
    await page.keyboard.press('f');
    await page.keyboard.press('Home');
    await settle(page);
    const c1 = await cam(page);
    assert(c1.yaw === c0.yaw && c1.pitch === c0.pitch && c1.height === c0.height, 'camera untouched while the dialog is open');
    await page.keyboard.press('Escape');
    assert(!(await page.locator('[data-role=help]').isVisible()), 'Esc closes it');
    await page.keyboard.press('Home');
    await settle(page);
    assert((await cam(page)).yaw !== c0.yaw, 'Home works again after closing');
  });

  await step('Examples menu: arrows move, other keys wait, Space loads the focused item', async () => {
    await page.keyboard.press('1');
    await press(page, '[data-action=examples]');
    const first = (await active(page)).example;
    assert(first, 'opening focuses the first item');
    await page.keyboard.press('ArrowDown');
    const second = (await active(page)).example;
    assert(second && second !== first, `ArrowDown moves (${first} → ${second})`);
    await page.keyboard.press('ArrowUp');
    assert((await active(page)).example === first, 'ArrowUp moves back');
    await page.keyboard.press('End');
    const last = (await active(page)).example;
    await page.keyboard.press('ArrowDown');
    assert((await active(page)).example === first && last !== first, 'End, then ArrowDown wraps to the first');
    await page.keyboard.press('v');
    let s = await state(page);
    assert(s.tool === 'pinHole' && (await page.locator('[data-role=examples-menu]').isVisible()), 'a tool key does nothing behind the open menu');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await frames(page, 2);
    s = await state(page);
    assert(s.mode === 'edit' && s.fileName === second, `Space loaded "${second}" (mode ${s.mode}, file ${s.fileName})`);
    assert(!(await page.locator('[data-role=examples-menu]').isVisible()), 'menu closed');
    await press(page, '[data-action=examples]');
    await page.keyboard.press('Escape');
    assert(!(await page.locator('[data-role=examples-menu]').isVisible()), 'Esc closes the menu');
    assert((await state(page)).tool === 'pinHole', '… without changing the tool');
  });

  await step('N without a build tool says so and changes nothing', async () => {
    await page.keyboard.press('v');
    await page.keyboard.press('n');
    const s = await state(page);
    assert(!s.newPart && /build tools/.test(s.message.text), `N with Select: newPart ${s.newPart}, "${s.message.text}"`);
  });

  await step('top palette with a part selected: says it is the colour for new parts', async () => {
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await settle(page);
    const p = await page.evaluate(() => window.__knap.partScreenPos(2));
    await clickAt(page, p);
    assert((await state(page)).selection === 2, 'part 2 selected');
    const before = (await model(page)).parts.find((q) => q.id === 2).color;
    const color = await page.evaluate(
      (partColor) => [...document.querySelectorAll('[data-role=palette] [data-color]')].map((b) => b.dataset.color).find((c) => c !== partColor && c !== window.__knap.getState().color),
      before,
    );
    const swatch = page.locator(`[data-role=palette] [data-color="${color}"]`);
    const name = await swatch.getAttribute('aria-label');
    await swatch.click();
    const s = await state(page);
    assert((await model(page)).parts.find((q) => q.id === 2).color === before, 'the selected part keeps its colour');
    assert(new RegExp(`^Colour for new parts: ${name} · to recolour part 2`).test(s.message.text), `message: "${s.message.text}"`);
  });

  await step('undo / redo across an example load: selection dropped, file name follows', async () => {
    const one = JSON.stringify({ version: 1, parts: [{ id: 1, color: '#c8433a', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2 }] }] });
    await page.evaluate((t) => window.__knap.openText('mine.knap.json', t), one);
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await settle(page);
    await page.keyboard.press('v');
    await clickAt(page, await page.evaluate(() => window.__knap.partScreenPos(2)));
    // within one document, undo keeps the selection
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Control+z');
    let s = await state(page);
    assert(s.selection === 2, `undoing a move keeps the selection (${s.selection})`);
    await page.keyboard.press('Control+z');
    s = await state(page);
    assert((await model(page)).parts.length === 1, 'back to the opened 1-part model');
    assert(s.selection === null, `selection dropped (${s.selection})`);
    assert(s.fileName === 'mine.knap.json', `Save's name restored (${s.fileName})`);
    assert(await page.locator('[data-role=inspector]').isHidden(), 'inspector hidden');
    await page.keyboard.press('Control+Shift+z');
    s = await state(page);
    assert(s.fileName === 'pendulum' && s.selection === null, `redo: name ${s.fileName}, selection ${s.selection}`);
  });

  await step('a failing autosave shows a lasting "Not autosaved"', async () => {
    const warn = () => page.evaluate(() => document.querySelector('[data-role=status-warning]')?.textContent ?? '');
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      window.__origSetItem = orig;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'knap.autosave.v1') throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press('d'); // nothing selected: a message only
    await page.evaluate(() => window.__knap.loadExample('four-bar'));
    await page.evaluate(() => window.__knap.flushAutosave());
    assert((await warn()) === 'Not autosaved', `indicator shown ("${await warn()}")`);
    await page.evaluate(() => window.__knap.loadExample('pendulum'));
    await page.evaluate(() => window.__knap.flushAutosave());
    await page.keyboard.press('n');
    assert((await warn()) === 'Not autosaved', 'still shown after later edits and messages');
    await page.evaluate(() => {
      Storage.prototype.setItem = window.__origSetItem;
    });
    await page.evaluate(() => window.__knap.flushAutosave());
    assert((await warn()) === '', 'gone once a write succeeds');
  });

  await step('an error banner survives a WebGL context loss', async () => {
    await page.evaluate(() => window.__knap.openText('bad.json', '{'));
    const r = await page.evaluate(async () => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const ext = gl.getExtension('WEBGL_lose_context');
      ext.loseContext();
      await new Promise((res) => setTimeout(res, 100));
      const during = window.__knap.getState().banner;
      ext.restoreContext();
      await new Promise((res) => setTimeout(res, 300));
      return { during, after: window.__knap.getState().banner };
    });
    assert(/graphics context was lost/.test(r.during), `during: "${r.during}"`);
    assert(/^Could not open bad\.json/.test(r.after), `after restore the earlier banner is back: "${r.after}"`);
    await page.locator('[data-role=banner] button').click();
  });

  await step('a gesture whose release is lost does not keep orbiting or eat the next click', async () => {
    await page.keyboard.press('v');
    await page.evaluate(() => window.__knap.home());
    const synthDown = (withLost) =>
      page.evaluate((lost) => {
        const c = document.querySelector('canvas');
        const r = c.getBoundingClientRect();
        const o = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + 200, clientY: r.top + 500, bubbles: true, cancelable: true };
        c.dispatchEvent(new PointerEvent('pointerdown', o));
        if (lost) c.dispatchEvent(new PointerEvent('lostpointercapture', { ...o, buttons: 0 }));
      }, withLost);
    for (const lost of [true, false]) {
      await page.mouse.move(200, 560);
      await synthDown(lost);
      const c0 = await cam(page);
      await page.mouse.move(320, 560, { steps: 6 });
      const c1 = await cam(page);
      assert(c1.yaw === c0.yaw, `${lost ? 'lostpointercapture' : 'button-less move'}: no orbit (${c0.yaw} → ${c1.yaw})`);
      await page.keyboard.press('Escape'); // deselect
      await clickAt(page, await page.evaluate(() => window.__knap.partScreenPos(2)));
      assert((await state(page)).selection === 2, `${lost ? 'lostpointercapture' : 'button-less move'}: the next click selects`);
    }
  });

  await step('blocked storage: the app says autosave is off', async () => {
    const browser = page.context().browser();
    const c = await openPage(browser, url, 'app-ui-nostorage');
    try {
      await c.page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('blocked', 'SecurityError');
          },
        });
      });
      await openApp(c.page, url);
      const s = await state(c.page);
      const warn = await c.page.evaluate(() => document.querySelector('[data-role=status-warning]')?.textContent ?? '');
      assert(warn === 'Not autosaved' && /autosave is off/.test(s.message.text), `warning "${warn}", message "${s.message.text}"`);
      assert(c.errors.length === 0, `no errors: ${c.errors.join(' | ')}`);
    } finally {
      await c.close();
    }
  });
}
