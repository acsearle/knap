// Review (wheels UI): Model settings — Ground [G] / Fix root: state, disabled logic, tooltips, undo/redo,
// autosave + reload, Save / Open (and a pre-wheels file), New, examples, simulate-mode look, layout at
// 1280×720 and 1024×720, counts and root marker.
import { readFile } from 'node:fs/promises';
import { frames, model, press, settle, state, status, openApp } from './app-lib.mjs';
import { reviewSetup, findings, canon } from './review-wheels-lib.mjs';
import { openModel } from './review-wheels-fixture.mjs';

const F = findings();
const R = await reviewSetup();
const { page, shot, errors } = await R.open('rw-settings');
const ui = async () =>
  page.evaluate(() => {
    const g = document.querySelector('[data-action=ground]');
    const f = document.querySelector('[data-action=fix-root]');
    return { g: g.checked, gd: g.disabled, f: f.checked, fd: f.disabled, ftip: f.parentElement.title, gtip: g.parentElement.title };
  });
const clickSel = async (sel) => {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 1);
};
const marker = () => page.evaluate(() => window.__knap.rootMarker(false));
async function loadExample(name) {
  await press(page, '[data-action=examples]');
  await press(page, `[data-example=${name}]`);
  await settle(page);
}

try {
  await loadExample('pendulum');
  let u = await ui();
  F.check(!u.g && u.f && u.fd && !u.gd, `pendulum: ground off, fix root checked+disabled ${JSON.stringify(u)}`);
  F.note(`counts "${(await status(page)).counts}"`);
  // click the disabled Fix root label (a user would try)
  await clickSel('[data-action=fix-root]');
  F.note(`clicking disabled Fix root → msg "${(await status(page)).message}"`);
  const h0 = (await state(page)).historySize;
  await page.keyboard.press('g');
  await frames(page, 1);
  u = await ui();
  let s = await status(page);
  F.check(u.g && !u.fd && u.f, `G: ground on, fix root enabled+checked (${JSON.stringify(u)}) msg "${s.message}"`);
  F.check((await state(page)).historySize === h0 + 1, 'G is one undo step');
  F.note(`floor ${JSON.stringify(await page.evaluate(() => window.__knap.floor()))}`);
  await shot('rw-settings-pendulum-ground');
  await clickSel('[data-action=fix-root]');
  u = await ui();
  s = await status(page);
  F.check(!u.f, `Fix root off by click (${JSON.stringify(u)}) msg "${s.message}"`);
  F.check(/none fixed/.test(s.counts), `counts say none fixed: "${s.counts}"`);
  F.check((await marker()) === null, 'no root marker with a free root');
  await shot('rw-settings-free-root');
  // undo / redo
  await page.keyboard.press('Meta+z');
  await frames(page, 1);
  u = await ui();
  F.check(u.f && u.g, `undo → fix root back on ${JSON.stringify(u)}`);
  F.check((await marker()) !== null, 'root marker back when fixed');
  await page.keyboard.press('Meta+z');
  await frames(page, 1);
  u = await ui();
  F.check(!u.g && u.fd, `undo → ground off ${JSON.stringify(u)}`);
  await page.keyboard.press('Meta+Shift+z');
  await page.keyboard.press('Meta+Shift+z');
  await frames(page, 1);
  u = await ui();
  F.check(u.g && !u.f, `redo ×2 → ground on, fix root off ${JSON.stringify(u)}`);
  // turn ground off while fix root is off: what does Fix root show?
  await clickSel('[data-action=ground]');
  u = await ui();
  const m1 = await model(page);
  F.note(`ground off with fixRoot=false in the model: UI fix=${u.f} disabled=${u.fd}; model.fixRoot=${m1.fixRoot}; counts "${(await status(page)).counts}"; marker ${!!(await marker())}`);
  await clickSel('[data-action=ground]');
  u = await ui();
  F.note(`ground on again: fix root shows ${u.f} (model remembers off)`);
  // focus is on the Ground checkbox now: press G and Space
  const before = (await model(page)).ground;
  await page.keyboard.press('g');
  await frames(page, 1);
  F.check(!!(await model(page)).ground === !before, `G with focus on the Ground checkbox toggles once (${before} → ${(await model(page)).ground})`);
  await page.keyboard.press('g');
  // G with help open
  await page.keyboard.press('?');
  await frames(page, 1);
  const g1 = (await model(page)).ground;
  await page.keyboard.press('g');
  await frames(page, 1);
  F.check((await model(page)).ground === g1, 'G does nothing while the help dialog is open');
  await page.keyboard.press('Escape');
  // G with the Examples menu open
  await press(page, '[data-action=examples]');
  await page.keyboard.press('g');
  await frames(page, 1);
  F.check((await model(page)).ground === g1, 'G does nothing while the Examples menu is open');
  await page.keyboard.press('Escape');
  await frames(page, 1);
  // Alt+G (Option+G types © on a Mac layout), Ctrl+G, Meta+G
  for (const combo of ['Alt+g', 'Control+g', 'Meta+g', 'Shift+g']) {
    const a = (await model(page)).ground;
    await page.keyboard.press(combo);
    await frames(page, 1);
    const b = (await model(page)).ground;
    F.note(`${combo}: ground ${a} → ${b}`);
    if (a !== b) { await page.keyboard.press('Meta+z'); await frames(page, 1); }
  }
  // W with modifiers
  await page.keyboard.press('v');
  for (const combo of ['Alt+w', 'Control+w', 'Shift+w']) {
    await page.keyboard.press('v');
    await page.keyboard.press(combo).catch(() => {});
    await frames(page, 1);
    F.note(`${combo}: tool ${(await state(page)).tool}`);
  }
  await page.keyboard.press('v');

  // Fix root off, then autosave + reload
  if (!(await model(page)).ground) await page.keyboard.press('g');
  await frames(page, 1);
  if ((await ui()).f) await clickSel('[data-action=fix-root]');
  const want = await model(page);
  F.note(`before reload: ground=${want.ground} fixRoot=${want.fixRoot} version=${want.version}`);
  await page.waitForTimeout(1500); // autosave debounce (not a correctness timing: flush below)
  await page.evaluate(() => window.__knap.flushAutosave());
  await page.reload();
  await openApp(page, page.url());
  const got = await model(page);
  u = await ui();
  F.check(canon(got) === canon(want), `reload restores the model incl. ground/fixRoot (${got.ground}/${got.fixRoot})`);
  F.check(u.g && !u.f, `reload: UI ${JSON.stringify(u)}`);
  F.check(/none fixed/.test((await status(page)).counts), `counts after reload "${(await status(page)).counts}"`);
  // Save
  const sb = await page.locator('[data-action=save]').boundingBox();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => { await page.mouse.move(sb.x + 10, sb.y + 10); await page.mouse.down(); await page.mouse.up(); })(),
  ]);
  const saved = JSON.parse(await readFile(await dl.path(), 'utf8'));
  F.check(saved.ground === true && saved.fixRoot === false && saved.version === 2, `saved file: version ${saved.version} ground ${saved.ground} fixRoot ${saved.fixRoot} (${dl.suggestedFilename()})`);
  // Open a pre-wheels file (version 1)
  await openModel(page, { version: 1, parts: [{ id: 1, color: '#e2b53a', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2 }, { x: 1, y: 0, z: 0, kind: 'pinHole', axis: 2 }] }], rootPartId: 1, nextPartId: 2 }, 'rw-v1.knap.json');
  u = await ui();
  const mv1 = await model(page);
  F.check(!u.g && u.f && u.fd && mv1.version === 1 && mv1.ground === undefined, `v1 file: ground off, fix root checked/disabled; model ${JSON.stringify({ v: mv1.version, g: mv1.ground, f: mv1.fixRoot })} msg "${(await status(page)).message}"`);
  // re-open the saved file
  await openModel(page, saved, 'rw-saved.knap.json');
  u = await ui();
  F.check(u.g && !u.f, `re-opened saved file: ${JSON.stringify(u)}`);
  // New
  await press(page, '[data-action=new]');
  u = await ui();
  F.check(!u.g && u.f && u.fd, `New resets: ${JSON.stringify(u)}`);
  await page.keyboard.press('g');
  await frames(page, 1);
  F.note(`G on an empty model: ground=${(await model(page)).ground} floor=${JSON.stringify(await page.evaluate(() => window.__knap.floor()))} msg "${(await status(page)).message}"`);
  await shot('rw-settings-empty-ground');
  // examples reset them
  await loadExample('cart');
  u = await ui();
  F.check(u.g && !u.f, `Cart: ground on, fix root off ${JSON.stringify(u)} counts "${(await status(page)).counts}"`);
  F.check((await marker()) === null, 'Cart: no root marker');
  await shot('rw-settings-cart');
  await loadExample('crank-wheel');
  u = await ui();
  F.check(!u.g && u.f && u.fd, `Crank wheel: ground off ${JSON.stringify(u)}`);
  await loadExample('cart');
  // simulate mode
  await press(page, '[data-action=play]');
  await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
  await page.evaluate(() => window.__knap.setPaused(true));
  u = await ui();
  F.check(u.gd && u.fd, `simulating: both disabled ${JSON.stringify(u)}`);
  const cls = await page.locator('[data-role=model-settings]').getAttribute('class');
  F.note(`Model block class while simulating: "${cls}"`);
  await page.keyboard.press('g');
  await clickSel('[data-action=ground]');
  await frames(page, 1);
  F.check((await state(page)).mode === 'simulate' && (await ui()).g, `G / click while simulating change nothing (msg "${(await status(page)).message}")`);
  await shot('rw-settings-sim');
  await page.keyboard.press('Escape'); // Stop
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');
  // layout: select a part so the inspector shows, at 1280×720 then 1024×720
  await page.keyboard.press('v');
  const pp = await page.evaluate(() => window.__knap.partScreenPos(1));
  await page.mouse.move(pp.x, pp.y);
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 2);
  await shot('rw-settings-1280-inspector');
  const boxes = async () =>
    page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
      return { ms: r('[data-role=model-settings]'), insp: r('.inspector') ?? r('[data-role=inspector]'), cube: r('.viewcube') ?? r('[data-role=viewcube]'), status: r('.statusbar') ?? r('[data-role=status-hint]'), body: [document.documentElement.scrollWidth, document.documentElement.clientWidth] };
    });
  F.note(`1280 boxes ${JSON.stringify(await boxes())}`);
  await page.setViewportSize({ width: 1024, height: 720 });
  await frames(page, 3);
  await shot('rw-settings-1024-inspector');
  F.note(`1024 boxes ${JSON.stringify(await boxes())}`);
  await page.setViewportSize({ width: 1280, height: 720 });
  F.check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} catch (e) {
  F.bad(`script error: ${e.stack}`);
  await shot('rw-settings-error').catch(() => {});
} finally {
  await R.close();
  console.log(`\n${F.list.length} BAD`);
}
