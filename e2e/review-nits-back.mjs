// Nits review: Back side (DESIGN §7.3) through the real UI (mouse + keyboard). window.__knap only
// reads state and finds screen points. Usage: node e2e/review-nits-back.mjs [hoverCount]
import { reviewSetup } from './review-nits-lib.mjs';
import { deepEqual, facePos, frames, hover, model, state, status } from './app-lib.mjs';

const N = Number(process.argv[2] ?? 200);
const S = await reviewSetup();
const { page, shot, errors } = await S.open('rn-back');
const results = [];
const fail = (what, detail) => results.push({ ok: false, what, detail });
const pass = (what, detail) => results.push({ ok: true, what, detail });
const check = (cond, what, detail) => (cond ? pass(what, detail) : fail(what, detail));

const cell = (x, y, z, kind, axis) => ({ x, y, z, kind, axis });
const beam = { parts: [{ id: 1, color: '#d0453b', cells: [0, 1, 2, 3, 4].map((x) => cell(x, 0, 0, 'pinHole', 2)) }], rootPartId: null, nextPartId: 2 };
const camera = () => page.evaluate(() => window.__knap.camera());

// ---- 1. Alt held + R cycles the back-side ghost's orientation ([R] "same behaviour")
await page.evaluate((m) => window.__knap.setModel(m), beam);
await page.evaluate(() => window.__knap.home());
await page.keyboard.press('1');
await hover(page, await facePos(page, 1, 2, 2)); // +Y face of the middle hole
let st0 = await status(page);
await page.keyboard.down('Alt');
await frames(page, 1);
const a1 = await status(page);
await page.keyboard.press('r');
await frames(page, 1);
const a2 = await status(page);
await page.keyboard.up('Alt');
await frames(page, 1);
check(a1.hint !== a2.hint || a1.aux !== a2.aux, 'Alt held + R cycles the back-side orientation', { front: st0, beforeR: a1, afterR: a2 });
// the same with the [B] toggle
await page.keyboard.press('b');
await frames(page, 1);
const b1 = await status(page);
await page.keyboard.press('r');
await frames(page, 1);
const b2 = await status(page);
check(b1.hint !== b2.hint, '[B] on + R cycles the back-side orientation', { b1, b2 });
await page.keyboard.press('b');
await frames(page, 1);

// ---- 2. Alt held + other edit keys (B, N, tool digits)
await page.keyboard.down('Alt');
await page.keyboard.press('n');
await page.keyboard.press('2');
await page.keyboard.up('Alt');
await frames(page, 1);
const s2 = await state(page);
pass('info: Alt+N / Alt+2 while Alt held', { newPart: s2.newPart, tool: s2.tool });

// ---- 3. [B] toggled while hovering: re-resolved without a mouse move
await page.keyboard.press('1');
await hover(page, await facePos(page, 1, 2, 4));
const h0 = (await status(page)).hint;
await page.keyboard.press('b');
await frames(page, 1);
const h1 = (await status(page)).hint;
await page.keyboard.press('b');
await frames(page, 1);
check(h0 !== h1 && /back side \(−Z\)/.test(h1), '[B] while hovering re-resolves', { h0, h1 });

// ---- 4. Alt during an orbit drag and Shift+Alt pan drag: no placement
for (const [label, mods] of [['Alt+drag orbit', ['Alt']], ['Shift+Alt+drag pan', ['Shift', 'Alt']], ['Alt+right-drag pan', ['Alt']]]) {
  const m0 = await model(page);
  const c0 = await camera(page);
  const p = await facePos(page, 1, 2, 4);
  await page.mouse.move(p.x, p.y);
  for (const k of mods) await page.keyboard.down(k);
  const button = label.includes('right') ? 'right' : 'left';
  await page.mouse.down({ button });
  for (let i = 1; i <= 6; i++) await page.mouse.move(p.x + i * 15, p.y + i * 6);
  await page.mouse.up({ button });
  for (const k of mods.reverse()) await page.keyboard.up(k);
  await frames(page, 2);
  const m1 = await model(page);
  const c1 = await camera(page);
  check(deepEqual(m0, m1) && !deepEqual(c0, c1), `${label}: camera moves, model unchanged`, { camMoved: !deepEqual(c0, c1), modelSame: deepEqual(m0, m1) });
  await page.evaluate(() => window.__knap.home());
  await frames(page, 1);
}

// ---- 5. Alt + Erase / Select are ignored
await page.keyboard.press('e');
await hover(page, await facePos(page, 1, 1, 4));
const e0 = await status(page);
await page.keyboard.down('Alt');
await frames(page, 1);
const e1 = await status(page);
await page.mouse.down();
await page.mouse.up();
await page.keyboard.up('Alt');
await frames(page, 1);
const em = await model(page);
check(e0.hint === e1.hint && em.parts.length === 2 && !em.parts.some((p) => p.cells.some((c) => c.x === 1 && c.z === 0 && p.cells.length === 5)), 'Erase ignores Alt (erases the hovered cell)', { e0: e0.hint, e1: e1.hint, parts: em.parts.map((p) => p.cells.map((c) => c.x)) });
await page.keyboard.press('Control+z');
await page.keyboard.press('v');
await hover(page, await facePos(page, 1, 1, 4));
await page.keyboard.down('Alt');
await page.mouse.down();
await page.mouse.up();
await page.keyboard.up('Alt');
await frames(page, 1);
check((await state(page)).selection === 1, 'Select ignores Alt (selects)', { sel: (await state(page)).selection });

// ---- 6. focus after a lone Alt; keys still work
await page.keyboard.press('Alt');
await page.keyboard.press('3');
const s6 = await state(page);
check(s6.tool !== 'select' && (await page.evaluate(() => document.activeElement === document.body || document.activeElement?.tagName === 'CANVAS')), 'after a lone Alt, focus kept and keys work', { tool: s6.tool, active: await page.evaluate(() => document.activeElement?.tagName) });

// ---- 7. simulate mode: Alt has no effect, B explains
await page.evaluate(() => window.__knap.loadExample('pendulum'));
const m7 = await model(page);
await page.evaluate(() => window.__knap.setMode('simulate'));
await page.keyboard.down('Alt');
await page.mouse.move(640, 360, { steps: 3 });
await page.mouse.down();
await page.mouse.up();
await page.keyboard.up('Alt');
await page.keyboard.press('b');
await frames(page, 1);
const st7 = await status(page);
const s7 = await state(page);
await page.evaluate(() => window.__knap.setMode('edit'));
check(deepEqual(m7, await model(page)) && !s7.backSide, 'simulate: Alt click / B do nothing', { message: st7.message, backSide: s7.backSide });

// ---- 8. random hovers with Back side on: sentence vs what the click does
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const LABEL = ['+X', '−X', '+Y', '−Y', '+Z', '−Z'];
let seed = 4242;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
const exs = ['four-bar', 'collision', 'sliding-axle', 'triple-pendulum', 'parallelogram'];
const views = ['home', 'top-front-right', 'bottom-back-left', 'front', 'top-back-left'];
let done = 0;
let tries = 0;
const bad = [];
const kinds = { 1: 'pin hole', 2: 'axle hole', 3: 'axle', 4: 'pin', 5: 'friction pin' };
let toggled = false;
while (done < N && tries < N * 12) {
  tries++;
  if (done % 20 === 0 && tries > 1 && !results.find((r) => r.what === `ex${done}`)) {
    results.push({ ok: true, what: `ex${done}` });
  }
  const ex = exs[Math.floor(done / 40) % exs.length];
  const view = views[tries % views.length];
  const cur = await model(page);
  if (!cur.__ex || true) {
    await page.evaluate(([ex, view]) => {
      window.__knap.loadExample(ex);
      if (view === 'home') window.__knap.home();
      else { window.__knap.setView(view); window.__knap.fit(); }
    }, [ex, view]);
  }
  const m = await model(page);
  const part = m.parts[rnd(m.parts.length)];
  const ci = rnd(part.cells.length);
  const dir = rnd(6);
  const tool = 1 + rnd(5);
  const p = await page.evaluate(([a, b, c]) => window.__knap.clientPosOfCellFace(a, b, c), [part.id, ci, dir]);
  if (!p) continue;
  await page.keyboard.press(String(tool));
  if (!toggled) {
    await page.click('[data-action=back-side]');
    toggled = true;
  }
  if (!(await state(page)).backSide) {
    await page.keyboard.press('b');
  }
  await hover(page, p);
  const st = await status(page);
  const hint = st.hint;
  // independent far side
  const own = new Set(part.cells.map((c) => `${c.x},${c.y},${c.z}`));
  const n = DIRS[dir];
  let C = [part.cells[ci].x, part.cells[ci].y, part.cells[ci].z];
  for (;;) {
    const q = [C[0] - n[0], C[1] - n[1], C[2] - n[2]];
    if (!own.has(q.join(','))) break;
    C = q;
  }
  const farDir = dir ^ 1;
  const beyond = [C[0] - n[0], C[1] - n[1], C[2] - n[2]];
  const rec = { ex, view, part: part.id, cell: [part.cells[ci].x, part.cells[ci].y, part.cells[ci].z], dir: LABEL[dir], tool, hint, far: C, beyond };
  if (!hint) { bad.push({ ...rec, why: 'no sentence' }); done++; continue; }
  if (!hint.includes(`back side (${LABEL[farDir]})`)) bad.push({ ...rec, why: 'direction label' });
  const invalid = / — /.test(hint);
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 1);
  const after = await model(page);
  const key = (q) => `${q.x},${q.y},${q.z},${q.kind},${q.axis}`;
  const beforeSet = new Map(m.parts.map((q) => [q.id, new Set(q.cells.map(key))]));
  const added = [];
  for (const q of after.parts) for (const c of q.cells) if (!beforeSet.get(q.id)?.has(key(c))) added.push({ part: q.id, newPart: !beforeSet.has(q.id), ...c });
  if (invalid) {
    if (added.length) bad.push({ ...rec, why: 'invalid sentence but the click changed the model', added });
  } else {
    if (!added.length) bad.push({ ...rec, why: 'valid sentence but no change' });
    else {
      const atFar = added.some((c) => (c.x === C[0] && c.y === C[1] && c.z === C[2]) || (c.x === beyond[0] && c.y === beyond[1] && c.z === beyond[2]));
      if (!atFar) bad.push({ ...rec, why: 'placed not at the far side', added });
      const isNew = added[0].newPart;
      if (/^New part/.test(hint) !== isNew) bad.push({ ...rec, why: 'New part vs extend mismatch', added });
      const mExt = /^Extend part (\d+)/.exec(hint);
      if (mExt && Number(mExt[1]) !== added[0].part) bad.push({ ...rec, why: 'wrong part extended', added });
      const ax = /∥ ([XYZ])/.exec(hint);
      if (ax && !added.some((c) => 'XYZ'[c.axis] === ax[1])) bad.push({ ...rec, why: 'axis mismatch', added });
      const kl = kinds[tool];
      if (!hint.includes(kl)) bad.push({ ...rec, why: 'kind not in sentence' });
      // undo is one step
      await page.keyboard.press('Control+z');
      await frames(page, 1);
      if (!deepEqual(await model(page), m)) bad.push({ ...rec, why: 'one undo does not restore' });
    }
  }
  if (done < 6) await shot(`review-nits-back-r${done}`);
  done++;
}
check(bad.length === 0, `random Back side hovers: sentence matches the click (${done} hovers, ${tries} tries)`, bad.slice(0, 15));
for (const r of results) console.log(r.ok ? 'PASS' : 'FAIL', r.what, JSON.stringify(r.detail ?? ''));
console.log('bad count', bad.length);
console.log('errors', errors);
await S.close();
