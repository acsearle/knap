// App e2e 4: default start-up scene, Save → New → Open round trip (download + file picker),
// Ctrl/Cmd+S, autosave restore after a reload, a corrupt file shows a readable error.
import { readFile } from 'node:fs/promises';
import { deepEqual, frames, model, openApp, press, sleep, state, status, summary } from './app-lib.mjs';

/** JSON with sorted keys, to compare models independent of key order. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

export default async function ({ page, url, shot, assert, step }) {
  await step('fresh start shows the four-bar', async () => {
    await openApp(page, url);
    const s = await summary(page);
    assert(s.parts === 8 && s.bodies === 4 && s.revolute === 4, `default scene is the four-bar: ${s.summary}`);
    assert((await state(page)).fileName === 'four-bar', 'named four-bar');
  });

  let saved;
  await step('Save downloads the model', async () => {
    // make it the user's own: recolour part 2 via select + inspector
    const before = await model(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), press(page, '[data-action=save]')]);
    assert(dl.suggestedFilename() === 'four-bar.knap.json', `file name ${dl.suggestedFilename()}`);
    saved = await readFile(await dl.path(), 'utf8');
    assert(canon(JSON.parse(saved)) === canon(before), 'saved text is the model');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
    assert(dl2.suggestedFilename() === 'four-bar.knap.json', `${MOD}+S saves too`);
  });

  await step('New → Open round-trips the model', async () => {
    const before = await model(page);
    await press(page, '[data-action=new]');
    assert((await model(page)).parts.length === 0, 'New empties the model');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
    await chooser.setFiles({ name: 'my-linkage.knap.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await page.waitForFunction(() => window.__knap.getModel().parts.length > 0);
    await frames(page, 2);
    assert(canon(await model(page)) === canon(before), 'opened model equals the saved one');
    assert((await state(page)).fileName === 'my-linkage.knap.json', 'file name remembered');
    assert(/Opened my-linkage/.test((await status(page)).message), 'status says it opened');
    // Undo goes back across Open and New (they are history entries).
    await page.keyboard.press(`${MOD}+z`);
    assert((await model(page)).parts.length === 0, 'undo Open → empty model');
    await page.keyboard.press(`${MOD}+z`);
    assert(deepEqual(await model(page), before), 'undo New → four-bar');
  });

  await step('a corrupt file shows an error and changes nothing', async () => {
    const before = await model(page);
    for (const [name, text] of [
      ['broken.knap.json', '{"version":1,"parts":[{"id":1,'],
      ['invalid.knap.json', JSON.stringify({ version: 1, parts: [{ id: 1, color: '#ff0000', cells: [{ x: 0, y: 0, z: 0, kind: 'pin', axis: 2 }, { x: 0, y: 0, z: 0, kind: 'pin', axis: 2 }] }], rootPartId: null, nextPartId: 2 })],
    ]) {
      // Cmd/Ctrl+O: what the app is responsible for is calling click() on its file input inside the
      // key's user activation; the file then arrives through that input's change event. Playwright's
      // filechooser event is not used here: after an earlier intercepted chooser it is sometimes not
      // emitted although click() ran with activation (review-m7-flake.mjs: 2 in 65 runs, every time
      // the first Cmd+O after the Open button's chooser). The click is recorded and swallowed (no
      // native chooser), and the file is set on the very input that was clicked.
      await page.evaluate(() => {
        const w = window;
        w.__openClicks = [];
        if (!w.__origInputClick) w.__origInputClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
          if (this.type === 'file') {
            w.__openClicks.push({ role: this.dataset.role ?? null, accept: this.accept, active: navigator.userActivation?.isActive ?? null, connected: this.isConnected });
            this.dataset.e2eClicked = '1';
            return;
          }
          return w.__origInputClick.call(this);
        };
      });
      await page.keyboard.press(`${MOD}+o`);
      await page.waitForFunction(() => window.__openClicks.length > 0, null, { timeout: 5000 });
      const clicks = await page.evaluate(() => {
        const c = window.__openClicks;
        HTMLInputElement.prototype.click = window.__origInputClick;
        return c;
      });
      assert(clicks.length === 1, `${MOD}+O clicks one file input (${JSON.stringify(clicks)})`);
      assert(clicks[0].active === true, `${MOD}+O clicks it with user activation (${JSON.stringify(clicks[0])})`);
      assert(clicks[0].connected && /json/.test(clicks[0].accept), `the input is in the page and accepts JSON (${JSON.stringify(clicks[0])})`);
      const input = page.locator('input[type=file][data-e2e-clicked="1"]');
      assert((await input.count()) === 1, 'the clicked input is found');
      await input.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
      await input.evaluate((el) => delete el.dataset.e2eClicked);
      await page.waitForFunction(() => window.__knap.getState().banner !== '');
      const st = await state(page);
      console.log(`  [app-files] ${name}: ${st.banner.split('\n')[0]}`);
      assert(st.banner.startsWith(`Could not open ${name}:`), `banner explains: "${st.banner}"`);
      assert((await status(page)).error, 'status shows the error');
      assert(deepEqual(await model(page), before), 'model unchanged');
      if (name === 'invalid.knap.json') await shot('app-files-corrupt');
      await press(page, '[data-role=banner] button');
      assert((await state(page)).banner === '', 'banner dismissed');
    }
  });

  await step('autosave restores after a reload', async () => {
    await press(page, '[data-action=examples]');
    await press(page, '[data-example=sliding-axle]');
    const m = await model(page);
    await sleep(700); // autosave debounce
    await openApp(page, url);
    assert(canon(await model(page)) === canon(m), 'model restored from the autosave');
    assert(/Restored the autosaved model/.test((await status(page)).message), 'status says so');
  });

  await step('a corrupt autosave is set aside with a message', async () => {
    // Written before the app's scripts run on the next load (the leaving page flushes its own
    // autosave on pagehide, which would overwrite a value set now).
    await page.addInitScript(() => {
      if (sessionStorage.getItem('corrupted')) return;
      sessionStorage.setItem('corrupted', '1');
      localStorage.setItem('knap.autosave.v1', '{not json');
    });
    await openApp(page, url);
    const s = await summary(page);
    assert(s.parts === 8, 'falls back to the four-bar');
    assert(/autosaved model could not be restored/.test((await state(page)).banner), `banner: ${(await state(page)).banner}`);
    assert((await page.evaluate(() => localStorage.getItem('knap.autosave.v1.corrupt'))) === '{not json', 'bad text kept aside');
  });
}
