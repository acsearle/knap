// App e2e 3: editing through the real UI — undo/redo across build / erase / move / rotate /
// colour / root / duplicate (one history entry per action), erase splitting a part, invalid
// placements explained and changing nothing, Shift = new part, [R] changing the ghost, Shift
// re-resolving the hover without a pointer move, keys ignored in text fields.
import { clickAt, clickFace, deepEqual, facePos, frames, gridPos, hover, model, openApp, press, settle, state, status } from './app-lib.mjs';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

export default async function ({ page, url, shot, assert, step }) {
  await step('load', () => openApp(page, url));
  const hist = async () => (await state(page)).historySize;
  /** Run an action and check it added exactly one history entry and changed the model. */
  async function oneEntry(label, fn) {
    const h0 = await hist();
    const m0 = await model(page);
    await fn();
    await frames(page, 1);
    const m1 = await model(page);
    const st1 = await state(page);
    assert(st1.canUndo && !st1.canRedo, `${label}: pushed onto the history`);
    void h0; // (the stack size need not grow: a push drops any redo tail)
    assert(!deepEqual(m0, m1), `${label}: model changed`);
    // undo / redo round trip through the keyboard
    await page.keyboard.press(UNDO); // exactly one undo restores the previous model: one entry
    await frames(page, 1);
    assert(deepEqual(await model(page), m0), `${label}: one undo restores`);
    await page.keyboard.press(REDO);
    await frames(page, 1);
    assert(deepEqual(await model(page), m1), `${label}: redo re-applies`);
    return { m0, m1 };
  }

  await step('build a 5-hole beam', async () => {
    await press(page, '[data-action=new]');
    await page.keyboard.press('1');
    await hover(page, await gridPos(page, 0, 0)); // New on grid: ∥ Z by default
    await oneEntry('place on grid', async () => clickAt(page, await gridPos(page, 0, 0)));
    for (let x = 0; x < 4; x++) await oneEntry(`extend ${x}`, () => clickFace(page, 1, [x, 0, 0], 0));
    const m = await model(page);
    assert(m.parts.length === 1 && m.parts[0].cells.length === 5, '5-hole beam');
  });

  await step('[R] cycles the ghost orientation', async () => {
    const m = await model(page);
    const p = await facePos(page, 1, 4, 2); // top face of the end hole
    await hover(page, p);
    const s1 = await status(page);
    assert(/Extend part 1 · pin hole ∥ Z/.test(s1.hint) && /\[R\] 1\/3/.test(s1.aux), `natural default ∥ Z: "${s1.hint}" "${s1.aux}"`);
    await shot('app-edit-ghost-z');
    await page.keyboard.press('r');
    await frames(page, 1);
    const s2 = await status(page);
    assert(/pin hole ∥ X/.test(s2.hint) && /\[R\] 2\/3/.test(s2.aux), `[R] → ∥ X: "${s2.hint}" "${s2.aux}"`);
    await shot('app-edit-ghost-x');
    await page.keyboard.press('r');
    await frames(page, 1);
    const s3 = await status(page);
    assert(/pin hole ∥ Y/.test(s3.hint), `[R] → ∥ Y: "${s3.hint}"`);
    await page.keyboard.press('r');
    await frames(page, 1);
    assert(/pin hole ∥ Z/.test((await status(page)).hint), '[R] wraps to ∥ Z');
    assert(deepEqual(m, await model(page)), '[R] does not change the model');
  });

  await step('Shift = new part (live, and on click)', async () => {
    const p = await facePos(page, 1, 4, 0); // +X face of the end hole
    await hover(page, p);
    assert(/^Extend part 1/.test((await status(page)).hint), 'without Shift: extend');
    await page.keyboard.down('Shift');
    await frames(page, 1);
    const s = await status(page);
    assert(/^New part · pin hole ∥ Z/.test(s.hint), `Shift held, no pointer move: new adjacent part ("${s.hint}")`);
    await page.keyboard.up('Shift');
    await frames(page, 1);
    assert(/^Extend part 1/.test((await status(page)).hint), 'Shift released: extend again');
    const { m1 } = await oneEntry('shift-click new part', () => clickAt(page, p, { shift: true }));
    assert(m1.parts.length === 2 && m1.parts[1].cells.length === 1 && m1.parts[1].cells[0].x === 5, `separate part at (5,0,0): ${JSON.stringify(m1.parts.map((q) => q.cells.length))}`);
    // [N] toggle does the same
    await page.keyboard.press('n');
    assert((await state(page)).newPart, '[N] turns New part on');
    assert(await page.locator('[data-action=new-part].on').count() === 1, 'toolbar shows the toggle on');
    await page.keyboard.press('n');
    assert(!(await state(page)).newPart, '[N] turns it off');
  });

  await step('invalid placement: red ghost, reason, click changes nothing', async () => {
    await page.keyboard.press('4');
    await clickFace(page, 1, [0, 0, 0], 4); // insert a pin into the first hole
    await clickFace(page, 3, [0, 0, 0], 4); // lengthen it out of the hole → (0,0,1)
    let m = await model(page);
    const pin = m.parts.find((p) => p.id === 3);
    assert(pin && pin.cells.length === 2, `pin of 2 cells: ${JSON.stringify(m.parts)}`);
    const ci = pin.cells.findIndex((c) => c.z === 1);
    const p = await facePos(page, 3, ci, 2); // side of the pin: nothing attaches there
    await hover(page, p);
    const s = await status(page);
    assert(s.hint.includes('—'), `invalid proposal states a reason: "${s.hint}"`);
    assert(await page.locator('.st-hint.invalid').count() === 1, 'hint shown as invalid (red)');
    await shot('app-edit-invalid');
    const h0 = await hist();
    m = await model(page);
    await clickAt(page, p);
    assert(deepEqual(m, await model(page)) && (await hist()) === h0, 'invalid click changes nothing');
    const s2 = await status(page);
    assert(s2.error && /Can’t place here/.test(s2.message), `error message: "${s2.message}"`);
  });

  await step('erase splits a part; undo/redo', async () => {
    await page.keyboard.press('e');
    const p = await facePos(page, 1, 2, 2); // top of the middle hole
    await hover(page, p);
    assert(/splits into 2 parts/.test((await status(page)).hint), `erase hint: "${(await status(page)).hint}"`);
    await shot('app-edit-erase-hover');
    const { m0, m1 } = await oneEntry('erase middle', () => clickAt(page, p));
    assert(m1.parts.length === m0.parts.length + 1, `part split (${m0.parts.length} → ${m1.parts.length})`);
    const sizes = m1.parts.filter((q) => q.cells.every((c) => c.kind === 'pinHole' && c.y === 0 && c.z === 0 && c.x <= 4)).map((q) => q.cells.length).sort();
    assert(deepEqual(sizes, [2, 2]), `two 2-hole pieces: ${sizes}`);
    await page.keyboard.press(UNDO); // back to one beam for the next steps
    await frames(page, 1);
  });

  await step('select, inspector, move / rotate / colour / duplicate / root / delete', async () => {
    await page.keyboard.press('v');
    await clickAt(page, await facePos(page, 1, 2, 2));
    assert((await state(page)).selection === 1, 'part 1 selected');
    assert(await page.locator('[data-role=inspector]').isVisible(), 'inspector visible');
    const sub = await page.textContent('[data-role=inspector-sub]');
    assert(/5 cells · 5 pin holes/.test(sub), `inspector: "${sub}"`);
    await page.mouse.move(400, 650);
    await frames(page, 2);
    await shot('app-edit-inspector');

    const cellsOf = (m, id) => m.parts.find((p) => p.id === id).cells;
    // A refused move explains why: → pushes the beam's end onto the separate part at (5,0,0).
    const h0 = await hist();
    const mBefore = await model(page);
    await page.keyboard.press('ArrowRight');
    const sr = await status(page);
    assert(sr.error && /Can't move part 1/.test(sr.message) && (await hist()) === h0 && deepEqual(mBefore, await model(page)), `refused move explained, nothing changed: "${sr.message}"`);
    // Move with an arrow key: every cell shifts by one unit along one axis.
    const { m0, m1 } = await oneEntry('move ↑', () => page.keyboard.press('ArrowUp'));
    const d = cellsOf(m1, 1).map((c, i) => [c.x - cellsOf(m0, 1)[i].x, c.y - cellsOf(m0, 1)[i].y, c.z - cellsOf(m0, 1)[i].z]);
    assert(d.every((v) => deepEqual(v, d[0])) && Math.abs(d[0][0]) + Math.abs(d[0][1]) + Math.abs(d[0][2]) === 1, `moved one cell: ${JSON.stringify(d[0])}`);
    await oneEntry('move PageUp', () => page.keyboard.press('PageUp'));
    await oneEntry('rotate ]', () => page.keyboard.press(']'));
    await oneEntry('rotate [', () => page.keyboard.press('['));
    // Layouts where [ / ] need Option (Mac) or AltGr (Windows: Ctrl+Alt): matched by the character.
    const altKey = (k, extra) =>
      page.evaluate(([k, extra]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })), [k, extra]);
    await oneEntry('rotate [ with Option', () => altKey('[', { code: 'Digit5', altKey: true }));
    await oneEntry('rotate ] with AltGr', () => altKey(']', { code: 'Digit9', altKey: true, ctrlKey: true }));
    const hCmd = await hist();
    await altKey('[', { code: 'BracketLeft', metaKey: true }); // Cmd+[ is the browser's Back
    assert((await hist()) === hCmd, 'Cmd+[ is left to the browser');
    // …and buttons in the inspector
    await oneEntry('rotate button ↻', () => press(page, '[data-action=rotate-cw]'));
    await oneEntry('rotate button ↺', () => press(page, '[data-action=rotate-ccw]'));
    await oneEntry('colour', () => press(page, '[data-role=inspector] [data-color="#c8433a"]'));
    assert((await model(page)).parts.find((p) => p.id === 1).color === '#c8433a', 'recoloured red');
    const dup = await oneEntry('duplicate', () => press(page, '[data-action=duplicate]'));
    const copyId = dup.m1.parts.find((p) => !dup.m0.parts.some((q) => q.id === p.id)).id;
    assert(dup.m1.parts.length === dup.m0.parts.length + 1 && copyId !== 1, `duplicate made part ${copyId}`);
    // (undo removed the copy, so the selection was cleared; select it again by clicking it)
    let cp = null;
    for (const dir of [2, 4, 0]) cp = cp ?? (await page.evaluate(([a, d]) => window.__knap.clientPosOfCellFace(a, 2, d), [copyId, dir]));
    assert(cp, 'copy clickable');
    await clickAt(page, cp);
    assert((await state(page)).selection === copyId, `copy selected (part ${copyId})`);
    const root = await oneEntry('set root', () => press(page, '[data-action=set-root]'));
    assert(root.m1.rootPartId === copyId, `root is the copy (${root.m1.rootPartId})`);
    assert(await page.locator('[data-role=inspector] .badge:not([hidden])').count() === 1, 'inspector shows the fixed-root badge');
    await oneEntry('delete', () => page.keyboard.press('Delete'));
    assert((await state(page)).selection === null, 'selection cleared after delete');
    await page.keyboard.press('Escape');
  });

  await step('shortcuts are ignored while typing; browser shortcuts are not stolen', async () => {
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.id = 'probe';
      i.style.cssText = 'position:fixed;left:70px;bottom:40px;z-index:999';
      document.body.append(i);
    });
    await page.click('#probe');
    const t0 = (await state(page)).tool;
    await page.keyboard.type('1e4v');
    assert((await state(page)).tool === t0, 'tool keys typed into an input do nothing');
    assert((await page.inputValue('#probe')) === '1e4v', 'the text reached the input');
    await page.evaluate(() => document.getElementById('probe').remove());
    await page.evaluate(() => document.activeElement?.blur());
    // Ctrl/Cmd+digit (tab switching) must not select a tool.
    const prevented = await page.evaluate(() => {
      const e = new KeyboardEvent('keydown', { key: '2', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    assert(!prevented && (await state(page)).tool === t0, 'Ctrl/Cmd+2 is left to the browser');
    await settle(page);
  });

  await step('help popover and About', async () => {
    await page.keyboard.press('?');
    assert(await page.locator('[data-role=help]').isVisible(), '? opens the controls');
    const txt = await page.textContent('[data-role=help]');
    for (const k of ['Orbit', 'Pan', 'Zoom', 'Undo', 'Redo', 'Erase', 'Rotate', 'Step', 'Stop']) assert(txt.includes(k), `controls list "${k}"`);
    await shot('app-edit-help');
    await page.keyboard.press('Escape');
    assert(!(await page.locator('[data-role=help]').isVisible()), 'Esc closes it');
    await press(page, '[data-action=about]');
    const about = await page.textContent('[data-role=about]');
    assert(/not affiliated with/.test(about) && /LEGO/.test(about), 'About carries the disclaimer');
    await shot('app-edit-about');
    await page.keyboard.press('Escape');
    // The trademark names appear nowhere else in the UI.
    const bodyText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelector('[data-role=about]')?.remove();
      return clone.textContent + ' ' + [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).join(' ');
    });
    assert(!/LEGO|Technic/i.test(bodyText), 'no trademark names outside About');
  });
}
