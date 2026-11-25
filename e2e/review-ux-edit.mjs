// UX review 2: DESIGN.md §7.2–§7.4 item by item, through the real UI.
import { startUx, st, freshEmpty, parts, cubePoint, mk } from './review-ux-lib.mjs';
import { frames, gridPos, hover, clickAt, clickFace, facePos, model, summary, cellIndexAt, settle, press, state, openApp } from './app-lib.mjs';

const ux = await startUx();
const { page, shot } = await ux.page('ux-edit');
await openApp(page, ux.url);
const { log, idOf } = mk(page);
const hoverFace = async (pid, pos, dir) => {
  const m = await model(page);
  const p = await facePos(page, pid, cellIndexAt(m, pid, pos), dir);
  await hover(page, p);
  return p;
};
const loadExample = async (name) => {
  await press(page, '[data-action=examples]');
  await press(page, `[data-example=${name}]`);
  await settle(page);
};
const T = async (label, fn) => {
  console.log(`\n===== ${label}`);
  try {
    await fn();
  } catch (e) {
    ux.check(false, `${label}: threw`, e.message.split('\n')[0]);
  }
};

// ---------------------------------------------------------------------------------------------
await T('A. shared cell (pin in hole) hovered from each side', async () => {
  await loadExample('pendulum');
  for (const tool of ['v', 'e', '1', '4']) {
    await page.keyboard.press(tool);
    await hoverFace(3, [0, 0, 1], 4); // pin centre, front
    let s = await log(`tool ${tool}: front, pin end centre`);
    await hoverFace(2, [0, 0, 1], 4); // link ring, front
    s = await log(`tool ${tool}: front, link ring around the pin`);
  }
  // back side
  await page.keyboard.press('v');
  const c = await cubePoint(page, [-1, 1, -1]);
  await clickAt(page, c);
  await settle(page);
  for (const tool of ['v', 'e', '4']) {
    await page.keyboard.press(tool);
    await hoverFace(3, [0, 0, 0], 5);
    await log(`tool ${tool}: back, pin end centre`);
    await hoverFace(1, [0, 0, 0], 5);
    await log(`tool ${tool}: back, frame ring around the pin`);
  }
  await shot('review-ux-40-back-pin-hover');
  await page.keyboard.press('Home');
  await settle(page);
});

// ---------------------------------------------------------------------------------------------
await T('B. build on the far side after orbiting (drag 180°)', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('1');
  await page.mouse.move(200, 600);
  await page.mouse.down();
  await page.mouse.move(570, 600, { steps: 10 });
  await page.mouse.up();
  await frames(page, 2);
  console.log('camera', await page.evaluate(() => window.__knap.camera()));
  const before = await model(page);
  // -Z face of frame hole (-2,0,0) → pin tool insert; with hole tool: extend? (Z axial face)
  await hoverFace(1, [-2, 0, 0], 5);
  let s = await log('pin-hole tool, -Z face of frame end (-2,0,0) from behind');
  await clickFace(page, 1, [-2, 0, 0], 5);
  const after = await model(page);
  console.log(parts(after));
  const f = after.parts.find((p) => p.id === 1);
  ux.check(f.cells.some((c) => c.x === -2 && c.z === -1), 'far-side extend lands at (-2,0,-1)', parts(after));
  await page.mouse.move(600, 650);
  await frames(page, 2);
  await shot('review-ux-41-far-side');
  await page.keyboard.press('Home');
  await settle(page);
});

// ---------------------------------------------------------------------------------------------
await T('C. grid behind / next to parts', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('1');
  // grid cells near the parts: which ones are clickable?
  const res = await page.evaluate(() => {
    const out = [];
    for (let x = -4; x <= 6; x++) for (let z = -3; z <= 3; z++) out.push([x, z, !!window.__knap.clientPosOfGrid(x, z)]);
    return out;
  });
  const hidden = res.filter((r) => !r[2]).map((r) => `(${r[0]},${r[1]})`);
  console.log('grid cells not reachable from the home view:', hidden.join(' '));
  // a grid cell just behind the frame: (-1,0,-1)
  const p = await page.evaluate(() => window.__knap.clientPosOfGrid(-1, -1));
  if (p) {
    await hover(page, p);
    const s = await log('grid (-1,-1) just behind the frame');
    await clickAt(page, p);
    const m = await model(page);
    ux.check(m.parts.some((q) => q.cells.some((c) => c.x === -1 && c.y === 0 && c.z === -1)), 'grid click behind the frame places at (-1,0,-1)', parts(m));
  }
  await page.keyboard.press('Meta+z');
  await page.keyboard.press('Control+z');
});

// ---------------------------------------------------------------------------------------------
await T('E. [R] with one valid orientation, and without a hover', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('4');
  await hoverFace(2, [2, 0, 1], 4); // insert into empty link hole: only ∥ Z
  let s = await log('pin tool on empty link hole (insert)');
  await page.keyboard.press('r');
  await frames(page, 1);
  s = await log('after R (only one orientation)');
  ux.check(/No other orientation/.test(s.message), 'R with one option says so', s.message);
  const rb = await page.locator('[data-action=orientation]').isDisabled();
  ux.check(rb, 'R toolbar button disabled when only one orientation', String(rb));
  await page.mouse.move(640, 690); // over the status bar (off canvas)
  await frames(page, 1);
  await page.keyboard.press('r');
  s = await log('R with pointer off the canvas');
});

// ---------------------------------------------------------------------------------------------
await T('F. [N] toggle', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('v');
  await page.keyboard.press('n');
  let s = await log('N with the Select tool');
  let stt = await state(page);
  const btnOn = await page.locator('[data-action=new-part]').evaluate((b) => b.classList.contains('on'));
  console.log('newPart state', stt.newPart, 'button on', btnOn, 'button disabled', await page.locator('[data-action=new-part]').isDisabled());
  ux.check(!(stt.newPart && !btnOn) || false, 'N with Select tool: state and button agree', `newPart=${stt.newPart}, button on=${btnOn}, message="${s.message}"`);
  await page.keyboard.press('1');
  stt = await state(page);
  console.log('after switching to pin hole tool: newPart', stt.newPart);
  await hoverFace(2, [4, 0, 1], 0);
  s = await log('hole tool on link end +X with New part on');
  await page.keyboard.press('n');
  s = await log('N toggled off');
  await page.keyboard.press('n');
  await page.keyboard.press('n');
});

// ---------------------------------------------------------------------------------------------
await T('G. erase: pin inside a hole, split', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('e');
  await hoverFace(3, [0, 0, 1], 4);
  let s = await log('erase hover on pin end in the link hole');
  await shot('review-ux-42-erase-pin-hover');
  await clickFace(page, 3, [0, 0, 1], 4);
  let m = await model(page);
  console.log(parts(m));
  s = await log('erased pin cell');
  // split the link (0..4,0,1) by erasing its middle hole (2,0,1)
  await hoverFace(2, [2, 0, 1], 4);
  s = await log('erase hover on the middle of the link');
  ux.check(/split/i.test(s.hint), 'erase hint says the part will split', s.hint);
  await clickFace(page, 2, [2, 0, 1], 4);
  m = await model(page);
  s = await log('after split');
  console.log(parts(m));
  ux.check(m.parts.filter((p) => p.cells.some((c) => c.z === 1 && c.kind === 'pinHole')).length === 2, 'link split in two', parts(m));
  // erase without a target: click empty space
  await clickAt(page, { x: 300, y: 620 });
  s = await log('erase click on empty space');
});

// ---------------------------------------------------------------------------------------------
await T('H. selection: move / rotate rejections', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('v');
  await hoverFace(2, [3, 0, 1], 4);
  await clickFace(page, 2, [3, 0, 1], 4);
  let stt = await state(page);
  console.log('selection', stt.selection);
  await shot('review-ux-43-selected');
  for (const k of ['ArrowRight', 'ArrowUp', 'PageDown', 'PageUp', 'ArrowLeft']) {
    const m0 = await model(page);
    await page.keyboard.press(k);
    await frames(page, 1);
    const m1 = await model(page);
    const s = await st(page);
    console.log(`${k}: ${JSON.stringify(m0) === JSON.stringify(m1) ? 'REJECTED' : 'moved'} — "${s.message}"${s.error ? ' [error]' : ''}`);
  }
  for (const k of [']', '[']) {
    await page.keyboard.press(k);
    await frames(page, 1);
    const s = await st(page);
    console.log(`${k}: "${s.message}"${s.error ? ' [error]' : ''}`);
  }
  await shot('review-ux-44-after-move-rotate');
});

// ---------------------------------------------------------------------------------------------
await T('I. duplicate, colour, set root', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('v');
  await clickFace(page, 2, [3, 0, 1], 4);
  const n0 = (await model(page)).parts.length;
  await page.keyboard.press('d');
  await frames(page, 2);
  let m = await model(page);
  let s = await log('D duplicate');
  const stt = await state(page);
  ux.check(m.parts.length === n0 + 1 && stt.selection === m.parts[m.parts.length - 1].id, 'D duplicates and selects the copy', `${n0}→${m.parts.length}, sel ${stt.selection}`);
  await page.mouse.move(300, 650);
  await frames(page, 2);
  await shot('review-ux-45-duplicate');
  const copy = stt.selection;
  // top palette while a part is selected
  const c0 = m.parts.find((p) => p.id === copy).color;
  await press(page, '.topbar [data-color="#3a75c4"]').catch(async () => {
    const cols = await page.$$eval('.topbar .swatch', (bs) => bs.map((b) => b.dataset.color));
    console.log('top swatches', cols);
    await press(page, `.topbar [data-color="${cols[4]}"]`);
  });
  m = await model(page);
  s = await log('clicked a TOP palette swatch with a part selected');
  console.log('selected part colour', c0, '→', m.parts.find((p) => p.id === copy).color);
  // inspector swatch
  const insCols = await page.$$eval('[data-role=inspector] .swatch', (bs) => bs.map((b) => b.dataset.color));
  await press(page, `[data-role=inspector] [data-color="${insCols[2]}"]`);
  m = await model(page);
  s = await log('inspector swatch');
  ux.check(m.parts.find((p) => p.id === copy).color === insCols[2], 'inspector swatch recolours', m.parts.find((p) => p.id === copy).color);
  // set root
  const r0 = await summary(page);
  const marker0 = await page.evaluate(() => window.__knap.getState().viewport);
  await press(page, '[data-action=set-root]');
  m = await model(page);
  const r1 = await summary(page);
  s = await log('set as fixed root');
  console.log('root', m.rootPartId, r0.summary, '→', r1.summary);
  ux.check(m.rootPartId === copy, 'root set', String(m.rootPartId));
  await page.mouse.move(300, 650);
  await frames(page, 2);
  await shot('review-ux-46-set-root');
  const insTxt = await page.locator('[data-role=inspector]').innerText();
  console.log('inspector:', insTxt.replace(/\n/g, ' | '));
});

// ---------------------------------------------------------------------------------------------
await T('J. undo / redo granularity, redo dropped after a new edit', async () => {
  await loadExample('pendulum');
  const h0 = (await state(page)).historySize;
  await page.keyboard.press('1');
  // (Since N is ignored with Select, section F's second N turned New part on: switch it off.)
  if ((await state(page)).newPart) await page.keyboard.press('n');
  await clickFace(page, 2, [4, 0, 1], 0);
  await clickFace(page, 2, [5, 0, 1], 0);
  let m = await model(page);
  const s1 = await state(page);
  console.log('history', h0, '→', s1.historySize);
  await page.keyboard.press('Meta+z');
  await frames(page, 1);
  let mm = await model(page);
  ux.check(mm.parts.find((p) => p.id === 2).cells.length === 6, 'one undo removes exactly one click', String(mm.parts.find((p) => p.id === 2).cells.length));
  await page.keyboard.press('Control+z');
  await frames(page, 1);
  mm = await model(page);
  console.log('after Control+z on mac platform:', mm.parts.find((p) => p.id === 2).cells.length);
  await page.keyboard.press('Meta+Shift+z');
  await frames(page, 1);
  mm = await model(page);
  console.log('after redo:', mm.parts.find((p) => p.id === 2).cells.length, 'canRedo', (await state(page)).canRedo);
  await page.keyboard.press('Control+y');
  await frames(page, 1);
  console.log('after Ctrl+Y:', (await model(page)).parts.find((p) => p.id === 2).cells.length);
  await page.keyboard.press('Meta+z');
  await frames(page, 1);
  // new edit drops redo
  await clickFace(page, 1, [-2, 0, 0], 1).catch(() => null);
  await clickFace(page, 2, [0, 0, 1], 2).catch((e) => console.log('click failed', e.message));
  const s2 = await state(page);
  ux.check(!s2.canRedo, 'redo dropped after a new edit', `canRedo=${s2.canRedo}`);
  // selection changes are not undo steps
  await page.keyboard.press('v');
  await clickFace(page, 2, [3, 0, 1], 4);
  const s3 = await state(page);
  await page.keyboard.press('Escape');
  const s4 = await state(page);
  console.log('history size select/deselect', s3.historySize, s4.historySize, 'selection', s3.selection, s4.selection);
});

// ---------------------------------------------------------------------------------------------
await T('K. keys while the Examples menu / Help dialog is open', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('v');
  await press(page, '[data-action=examples]');
  let stt = await state(page);
  console.log('menu open; focused:', await page.evaluate(() => document.activeElement?.textContent?.slice(0, 30)));
  await page.keyboard.press('1');
  stt = await state(page);
  const menuOpen = await page.locator('[data-role=examples-menu]').isVisible();
  console.log('pressed 1 with menu open → tool', stt.tool, 'menu still open', menuOpen);
  ux.check(!(stt.tool === 'pinHole' && menuOpen), '1 while the menu is open does not change the tool behind an open menu', `tool=${stt.tool}, menuOpen=${menuOpen}`);
  await page.keyboard.press('ArrowDown');
  const foc = await page.evaluate(() => document.activeElement?.dataset?.example ?? document.activeElement?.tagName);
  console.log('ArrowDown in menu → focus', foc);
  ux.check(foc !== 'pendulum', 'ArrowDown moves through the menu', `focus=${foc}`);
  await page.keyboard.press('Space');
  await frames(page, 3);
  stt = await state(page);
  console.log('Space in open menu → mode', stt.mode, 'model parts', (await model(page)).parts.length);
  ux.check(stt.mode === 'edit', 'Space on a focused menu item does not start the simulation', `mode=${stt.mode}`);
  if (stt.mode !== 'edit') {
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.keyboard.press('Escape');
    await frames(page, 2);
  }
  await page.keyboard.press('Escape');
  // help dialog (Space above now loads an example, whose Home animation must finish first)
  await settle(page);
  await page.keyboard.press('?');
  const cam0 = await page.evaluate(() => window.__knap.camera());
  await page.keyboard.press('1');
  await page.keyboard.press('f');
  await frames(page, 2);
  await settle(page);
  const cam1 = await page.evaluate(() => window.__knap.camera());
  stt = await state(page);
  console.log('help open: 1 → tool', stt.tool, '; F → camera changed', JSON.stringify(cam0) !== JSON.stringify(cam1));
  ux.check(JSON.stringify(cam0) === JSON.stringify(cam1), 'F with the Help dialog open does nothing behind the modal', 'camera moved');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focTag = await page.evaluate(() => (document.activeElement?.closest('.dialog') ? 'in dialog' : document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName));
  console.log('Tab twice inside the modal → focus', focTag);
  ux.check(focTag === 'in dialog', 'focus stays inside the modal dialog', focTag);
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------------------------
await T('N. Show kinematics checkbox keeps focus', async () => {
  await loadExample('pendulum');
  const box = await page.locator('[data-action=kinematics]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await frames(page, 2);
  const cam0 = await page.evaluate(() => window.__knap.camera());
  // pan a bit then F
  await page.mouse.move(600, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(700, 450, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await frames(page, 1);
  const camPanned = await page.evaluate(() => window.__knap.camera());
  await page.keyboard.press('Home');
  await frames(page, 2);
  await settle(page);
  const camHome = await page.evaluate(() => window.__knap.camera());
  console.log('focused', await page.evaluate(() => document.activeElement?.tagName + ' ' + document.activeElement?.type));
  ux.check(JSON.stringify(camHome.target) !== JSON.stringify(camPanned.target), 'Home key works after clicking the Show kinematics checkbox', 'Home ignored (focus on checkbox)');
  const kin0 = (await state(page)).showKinematics;
  await page.keyboard.press('Space');
  await frames(page, 3);
  const stt = await state(page);
  console.log('Space after clicking the checkbox → mode', stt.mode, 'kinematics', kin0, '→', stt.showKinematics);
  ux.check(stt.showKinematics === kin0, 'Space does not also toggle the focused checkbox', `${kin0}→${stt.showKinematics}`);
  if (stt.mode !== 'edit') {
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate', null, { timeout: 60000 });
    await page.keyboard.press('Escape');
    await frames(page, 2);
  }
});

// ---------------------------------------------------------------------------------------------
await T('L/M. Esc behaviour; tool state after Stop; Esc during start', async () => {
  await loadExample('pendulum');
  await page.keyboard.press('4');
  await page.keyboard.press('Escape');
  let stt = await state(page);
  console.log('Esc in pin tool → tool', stt.tool);
  await clickFace(page, 2, [3, 0, 1], 4);
  await page.keyboard.press('Escape');
  stt = await state(page);
  console.log('Esc with selection → selection', stt.selection, 'tool', stt.tool);
  await page.keyboard.press('1');
  await hoverFace(2, [4, 0, 1], 0);
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape'); // immediately, while "Starting…"
  await frames(page, 2);
  await page.waitForTimeout(3000);
  stt = await state(page);
  console.log('Space then Esc immediately → mode', stt.mode);
  ux.check(stt.mode === 'edit', 'Esc pressed while the simulation is starting cancels it', `mode=${stt.mode}`);
  if (stt.mode === 'simulate') {
    await page.keyboard.press('Escape');
    await frames(page, 2);
  }
  stt = await state(page);
  const s = await log('after Stop, pointer still on the link end');
  console.log('tool after stop', stt.tool);
  await page.mouse.move(700, 420);
  await page.mouse.move(705, 422);
  await frames(page, 2);
  await shot('review-ux-47-after-stop');
});

await ux.close();
