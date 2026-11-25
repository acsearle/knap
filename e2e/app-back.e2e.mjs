// App e2e: Back side (DESIGN §7.3). Build on the back of a beam with the real mouse and Alt held,
// without orbiting; then with the toolbar's Back side toggle and no keyboard at all. Checks the
// resulting models exactly, that undo is one step, the toolbar button's state, the status
// sentence, that a lone Alt release is swallowed, that [R] cycles while Alt is held (also as a
// Mac Option+R, '®'), and that Option/AltGr characters still work.
import { clickAt, deepEqual, facePos, frames, hover, model, openApp, press, state, status } from './app-lib.mjs';

const cell = (x, y, z, kind, axis) => ({ x, y, z, kind, axis });
const beamCells = (n) => Array.from({ length: n }, (_, i) => cell(i, 0, 0, 'pinHole', 2));
const START = { parts: [{ id: 1, color: '#d0453b', cells: beamCells(5) }], rootPartId: null, nextPartId: 2 };

async function camera(page) {
  return page.evaluate(() => window.__knap.camera());
}

export default async function ({ page, url, shot, assert, step }) {
  await step('load a 5-hole beam, Home view', async () => {
    await openApp(page, url);
    // Record whether the app swallowed each Alt keyup (listener added after the app's).
    await page.evaluate(() => {
      window.__altUps = [];
      window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') window.__altUps.push(e.defaultPrevented);
      });
    });
    await page.evaluate((m) => window.__knap.setModel(m), START);
    await page.evaluate(() => window.__knap.home());
    await frames(page, 2);
  });

  const cam0 = await camera(page);

  await step('Alt held: the hover is re-resolved on the far side without a mouse move', async () => {
    await page.keyboard.press('1');
    await hover(page, await facePos(page, 1, 2, 4)); // front face (+Z) of the middle hole
    let st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z', `front side: "${st.hint}"`);
    assert(/Alt: back side/.test(st.aux), `the hint line mentions Alt: "${st.aux}"`);
    await page.keyboard.down('Alt');
    await frames(page, 1);
    st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z · back side (−Z)', `Alt: back side: "${st.hint}"`);
    assert(!/Alt: back side/.test(st.aux), `no Alt hint while it is held: "${st.aux}"`);
    const s = await state(page);
    assert(s.altHeld === true && s.backSide === false, `state: altHeld ${s.altHeld}, toggle ${s.backSide}`);
    await shot('app-back-alt-extend');
    await page.keyboard.up('Alt');
    await frames(page, 1);
    st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z', `Alt released: front side again: "${st.hint}"`);
    const ups = await page.evaluate(() => window.__altUps);
    assert(ups.length === 1 && ups[0] === true, `a lone Alt release is preventDefault'ed (${JSON.stringify(ups)})`);
    assert(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.tagName === 'CANVAS'), 'focus did not move');
  });

  await step('Alt held: R cycles the back-side orientation (also as a Mac Option+R, "®")', async () => {
    await page.keyboard.down('Alt');
    await frames(page, 1);
    let st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z · back side (−Z)' && /\[R\] 1\/3/.test(st.aux), `before R: "${st.hint}" "${st.aux}"`);
    assert(/Shift: .* · back side \(−Z\)/.test(st.aux), `the Shift hint says back side: "${st.aux}"`);
    await page.keyboard.press('r');
    await frames(page, 1);
    st = await status(page);
    assert(/∥ [XY] · back side \(−Z\)$/.test(st.hint) && /\[R\] 2\/3/.test(st.aux), `Alt+R cycles: "${st.hint}" "${st.aux}"`);
    // macOS Option+R types '®': matched by the physical key
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '®', code: 'KeyR', altKey: true, bubbles: true, cancelable: true })));
    await frames(page, 1);
    st = await status(page);
    assert(/\[R\] 3\/3/.test(st.aux) && / · back side \(−Z\)$/.test(st.hint), `Option+R ("®") cycles: "${st.hint}" "${st.aux}"`);
    await page.keyboard.press('r'); // back to the first orientation
    await frames(page, 1);
    st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z · back side (−Z)', `cycled round: "${st.hint}"`);
    await page.keyboard.up('Alt');
    await frames(page, 1);
  });

  await step('Alt + click builds on the back; undo is one step', async () => {
    const before = await state(page);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await frames(page, 1);
    const m = await model(page);
    const want = { ...START, nextPartId: 2, parts: [{ ...START.parts[0], cells: [...beamCells(5), cell(2, 0, -1, 'pinHole', 2)] }] };
    assert(deepEqual(m.parts, want.parts) && m.nextPartId === 2, `a hole behind (2,0,0): ${JSON.stringify(m.parts)}`);
    assert(deepEqual(await camera(page), cam0), 'the camera never moved');
    const after = await state(page);
    assert(after.historySize === before.historySize + 1, `one history step (${before.historySize} → ${after.historySize})`);
    assert(/^Extend part 1 · pin hole ∥ Z · back side \(−Z\) → part 1$/.test(after.message.text), `message: "${after.message.text}"`);
    await page.keyboard.press('Control+z');
    await frames(page, 1);
    const u = await model(page);
    assert(deepEqual(u.parts, START.parts), `one undo restores the beam: ${JSON.stringify(u.parts)}`);
  });

  await step('Alt + click on the end face extends the far end (5 cells away)', async () => {
    await hover(page, await facePos(page, 1, 4, 0)); // +X end face of (4,0,0)
    await page.keyboard.down('Alt');
    await frames(page, 1);
    const st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z · back side (−X)', `far end: "${st.hint}"`);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await frames(page, 1);
    const m = await model(page);
    assert(deepEqual(m.parts[0].cells, [...beamCells(5), cell(-1, 0, 0, 'pinHole', 2)]), `a hole at (-1,0,0): ${JSON.stringify(m.parts[0].cells)}`);
    await page.keyboard.press('Control+z');
  });

  await step('the Back side toggle, mouse only: build, undo with the toolbar', async () => {
    await page.evaluate((m) => window.__knap.setModel(m), START);
    await frames(page, 1);
    const btn = '[data-action=back-side]';
    assert((await page.getAttribute(btn, 'aria-pressed')) === 'false', 'toggle starts off');
    assert(/\(B\)/.test((await page.getAttribute(btn, 'title')) ?? ''), 'the button shows its shortcut');
    await press(page, btn);
    assert((await page.getAttribute(btn, 'aria-pressed')) === 'true', 'toggle on');
    assert(await page.locator(btn).evaluate((e) => e.classList.contains('on')), 'button drawn on');
    assert((await state(page)).backSide === true, 'getState().backSide');
    const before = (await state(page)).historySize;
    const p = await facePos(page, 1, 4, 4); // front face of the last hole
    await hover(page, p);
    const st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z · back side (−Z)', `toggle: back side: "${st.hint}"`);
    await shot('app-back-toggle');
    await clickAt(page, p);
    let m = await model(page);
    assert(deepEqual(m.parts[0].cells, [...beamCells(5), cell(4, 0, -1, 'pinHole', 2)]), `a hole behind (4,0,0): ${JSON.stringify(m.parts[0].cells)}`);
    assert((await state(page)).historySize === before + 1, 'one history step');
    await press(page, '[data-action=undo]');
    m = await model(page);
    assert(deepEqual(m.parts, START.parts), `toolbar undo restores the beam in one step: ${JSON.stringify(m.parts)}`);
  });

  await step('pin tool with the toggle: insert a pin from behind', async () => {
    await press(page, '[data-tool=pin]');
    const p = await facePos(page, 1, 1, 4);
    await hover(page, p);
    const st = await status(page);
    assert(st.hint === 'New part · insert pin ∥ Z into part 1 · back side (−Z)', `insert from behind: "${st.hint}"`);
    await clickAt(page, p);
    const m = await model(page);
    assert(m.parts.length === 2 && deepEqual(m.parts[1].cells, [cell(1, 0, 0, 'pin', 2)]), `a pin in (1,0,0): ${JSON.stringify(m.parts)}`);
    await press(page, '[data-action=undo]');
  });

  await step('Select / Erase: the button is disabled; the toggle is kept, like New part', async () => {
    const btn = '[data-action=back-side]';
    await press(page, '[data-tool=select]');
    assert(await page.locator(btn).isDisabled(), 'disabled with Select');
    assert((await state(page)).backSide === true, 'toggle kept');
    await page.keyboard.press('b');
    assert(/Back side applies to the build tools/.test((await status(page)).message), `B with Select explains: "${(await status(page)).message}"`);
    await page.keyboard.press('e');
    assert(await page.locator(btn).isDisabled(), 'disabled with Erase');
    await page.keyboard.press('1');
    assert(!(await page.locator(btn).isDisabled()) && (await page.getAttribute(btn, 'aria-pressed')) === 'true', 'enabled and on again with a build tool');
    await page.keyboard.press('b');
    assert((await state(page)).backSide === false && (await page.getAttribute(btn, 'aria-pressed')) === 'false', 'B turns it off');
    assert(/Back side: off/.test((await status(page)).message), 'message');
    await page.keyboard.press('b');
    assert((await state(page)).backSide === true, 'B turns it on');
    await page.keyboard.press('b');
  });

  await step('Option / AltGr characters still work: [ rotates the selection with Alt held', async () => {
    await page.keyboard.press('v');
    const p = await facePos(page, 1, 2, 4);
    await clickAt(page, p);
    assert((await state(page)).selection === 1, 'beam selected');
    const m0 = await model(page);
    await page.keyboard.down('Alt');
    await page.keyboard.press('BracketLeft');
    await page.keyboard.up('Alt');
    await frames(page, 1);
    const m1 = await model(page);
    assert(!deepEqual(m0.parts[0].cells, m1.parts[0].cells), 'the beam rotated');
    await page.keyboard.press('Control+z');
  });
}
