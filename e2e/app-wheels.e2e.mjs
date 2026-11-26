// App e2e: wheels, ground and a free root (DESIGN §2.6, §6.1, §7.2–§7.5) with the real mouse and
// keyboard. From an empty model: a beam, an axle through it (one end built with Alt = Back side),
// axle-hole sleeves on both axle ends, grown into wheels with the Wheel tool [W]; Shift shrinks
// one, Erase removes a rim's outer half-unit; a crank hole is added to the r 2.5 wheel by clicking
// its face and a pin goes into it; growth into a neighbouring beam is refused with the reason;
// Ground [G] and Fix root; undo / redo through all of it; Save → reload → Open round trip; then
// deterministic simulation (stepSim): a wheel dropped onto the floor comes to rest on it, and a
// pushed cart rolls (pushBody). Screenshots of each stage (e2e/out/app-wheels-*.png).
import { readFile } from 'node:fs/promises';
import { applyT, clickAt, clickFace, dist, frames, gridPos, hover, model, openApp, press, settle, state, status } from './app-lib.mjs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
/** JSON with sorted keys, to compare models independent of key order. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const partOf = (m, id) => m.parts.find((p) => p.id === id);
const cellAt = (m, id, pos) => partOf(m, id)?.cells.find((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);

export default async function ({ page, url, shot, assert, step }) {
  /** The model after every undoable action, in order (snaps[0] = the empty model). */
  const snaps = [];
  const record = async (label) => {
    const m = await model(page);
    assert(snaps.length === 0 || canon(m) !== canon(snaps[snaps.length - 1].m), `${label}: the model changed`);
    snaps.push({ label, m });
    return m;
  };
  const hubPos = async (partId, dir) => {
    const p = await page.evaluate(([a, d]) => window.__knap.clientPosOfCellFace(a, 0, d), [partId, dir]);
    assert(p, `face ${dir} of part ${partId}'s hub is clickable`);
    return p;
  };
  const virtualPos = async (partId, pos, dir) => {
    const p = await page.evaluate(([a, q, d]) => window.__knap.clientPosOfVirtualCell(a, 0, q, d), [partId, pos, dir]);
    assert(p, `virtual cell ${pos} of part ${partId}'s wheel is clickable`);
    return p;
  };
  /**
   * Back side (§7.3: the back face under the cursor): with Alt held, move the mouse over face `dir`
   * of the cell at `pos` (as seen through the parts) until the highlight is that back face and the
   * status sentence matches `want`, as a user aims; then click.
   */
  const altAimClick = async (pos, dir, want) => {
    const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][dir];
    const a = dir >> 1;
    const t1 = (a + 1) % 3;
    const t2 = (a + 2) % 3;
    await page.keyboard.down('Alt');
    const tried = [];
    let hit = false;
    for (const u of [0, -0.2, 0.2, -0.38]) {
      for (const v of [0, -0.2, 0.2, -0.38, 0.38]) {
        const w = [pos[0] + n[0] * 0.5, pos[1] + n[1] * 0.5, pos[2] + n[2] * 0.5];
        w[t1] += u;
        w[t2] += v;
        await hover(page, await page.evaluate((q) => window.__knap.screenPos(q), w));
        const h = await page.evaluate(() => window.__knap.getState().buildHighlight);
        const hint = (await status(page)).hint;
        tried.push(hint);
        if (h && h.backSide && h.dir === dir && h.pos.join() === pos.join() && want.test(hint)) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    assert(hit, `Alt: face ${dir} of (${pos}) "${want}" under the cursor somewhere (${[...new Set(tried)].slice(0, 4).join(' | ')})`);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await frames(page, 1);
  };

  await step('load, New', async () => {
    await openApp(page, url);
    await press(page, '[data-action=new]');
    const m = await record('new');
    assert(m.parts.length === 0, 'empty model');
    assert(await page.locator('[data-role=model-settings]').isVisible(), 'the Model block is always visible');
  });

  await step('a beam and an axle through it (Alt builds on the far end, seen through the beam)', async () => {
    await page.keyboard.press('1');
    await clickAt(page, await gridPos(page, 0, 0));
    await record('beam 1');
    await clickFace(page, 1, [0, 0, 0], 0);
    await record('beam 2');
    await clickFace(page, 1, [1, 0, 0], 0);
    await record('beam 3');
    await page.keyboard.press('3');
    await clickFace(page, 1, [0, 0, 0], 4); // insert an axle
    let m = await record('axle');
    assert(partOf(m, 2)?.cells.length === 1 && cellAt(m, 2, [0, 0, 0])?.kind === 'axle', `axle in the beam: ${JSON.stringify(partOf(m, 2))}`);
    await clickFace(page, 2, [0, 0, 0], 4); // extend it to +Z
    await record('axle +Z');
    // Alt over the axle's far end (−Z), seen through the beam: Back side extends the axle out the back
    await altAimClick([0, 0, 0], 5, /^Extend part 2 · axle ∥ Z · back side \(−Z\)$/);
    m = await record('axle −Z');
    assert(partOf(m, 2).cells.length === 3 && cellAt(m, 2, [0, 0, -1]), `axle runs z −1..1: ${JSON.stringify(partOf(m, 2).cells)}`);
  });

  await step('axle-hole sleeves on both axle ends', async () => {
    await page.keyboard.press('2');
    const m0 = await model(page);
    const ci = partOf(m0, 2).cells.findIndex((c) => c.z === 1);
    const end = await page.evaluate(([a, b]) => window.__knap.clientPosOfCellFace(a, b, 4), [2, ci]);
    await hover(page, end);
    assert(/^New part · sleeve axle hole ∥ Z onto part 2/.test((await status(page)).hint), `sleeve offered: "${(await status(page)).hint}"`);
    await clickAt(page, end);
    await record('sleeve +Z');
    // Alt over the axle's far end (−Z, behind the beam): sleeve a hole onto it from behind
    await altAimClick([0, 0, -1], 5, /^New part · sleeve axle hole ∥ Z onto part 2 · back side \(−Z\)$/);
    const m = await record('sleeve −Z');
    assert(cellAt(m, 3, [0, 0, 1])?.kind === 'axleHole' && cellAt(m, 4, [0, 0, -1])?.kind === 'axleHole', `sleeves are parts 3 and 4: ${JSON.stringify(m.parts.slice(2))}`);
  });

  await step('a neighbouring beam in the front wheel’s layer', async () => {
    await page.keyboard.press('1');
    await clickAt(page, await gridPos(page, 3, 1));
    await record('neighbour 1');
    await clickFace(page, 5, [3, 0, 1], 0);
    const m = await record('neighbour 2');
    assert(partOf(m, 5)?.cells.length === 2 && cellAt(m, 5, [3, 0, 1]), `part 5 at (3..4, 0, 1): ${JSON.stringify(partOf(m, 5))}`);
    await page.keyboard.press('Home');
    await settle(page);
  });

  await step('Wheel tool [W]: grow the front sleeve to radius 2.5, half a unit per click', async () => {
    await page.keyboard.press('w');
    assert((await state(page)).tool === 'wheel', 'W selects the wheel tool');
    assert(await page.locator('[data-tool=wheel].on').count() === 1, 'its toolbar button is on');
    for (const r of [1, 1.5, 2, 2.5]) {
      const p = await hubPos(3, 4);
      await hover(page, p);
      const st = await status(page);
      assert(st.hint === `Grow wheel · part 3 · radius ${r} (${r * 16} mm across)`, `hint before growing to ${r}: "${st.hint}"`);
      assert(/Shift: shrink/.test(st.aux), `aux mentions Shift: "${st.aux}"`);
      if (r === 1) await shot('app-wheels-ghost-r1');
      await clickAt(page, p);
      const m = await record(`grow ${r}`);
      assert(cellAt(m, 3, [0, 0, 1]).rim === r, `rim ${r}: ${JSON.stringify(cellAt(m, 3, [0, 0, 1]))}`);
      assert(m.version === 2, 'version 2 once a rim is used');
    }
    await page.keyboard.press('Home');
    await settle(page);
    await shot('app-wheels-r2.5');
  });

  await step('growth into the neighbouring beam is refused with the reason', async () => {
    const before = await model(page);
    const p = await hubPos(3, 4);
    await hover(page, p);
    const st = await status(page);
    assert(/^Grow wheel · part 3 · radius 3 \(48 mm across\) — wheel would hit part 5 at \(3, 0, 1\)/.test(st.hint), `invalid hint: "${st.hint}"`);
    assert(await page.locator('.st-hint.invalid').count() === 1, 'the hint is shown as invalid (red)');
    await shot('app-wheels-invalid');
    await clickAt(page, p);
    assert(canon(await model(page)) === canon(before), 'the click changes nothing');
    const s2 = await status(page);
    assert(s2.error && /wheel would hit part 5/.test(s2.message), `error message: "${s2.message}"`);
  });

  await step('the back wheel: radius 1.5 from behind', async () => {
    await page.evaluate(() => {
      window.__knap.setView('back');
      window.__knap.fit();
    });
    await frames(page, 2);
    for (const r of [1, 1.5]) {
      await clickAt(page, await hubPos(4, 5));
      const m = await record(`back grow ${r}`);
      assert(cellAt(m, 4, [0, 0, -1]).rim === r, `back rim ${r}`);
    }
    await page.keyboard.press('Home');
    await settle(page);
  });

  await step('Shift+click shrinks; Erase removes the outer half-unit (ring highlight)', async () => {
    const p = await hubPos(3, 4);
    await hover(page, p);
    await page.keyboard.down('Shift');
    await frames(page, 1);
    let st = await status(page);
    assert(st.hint === 'Shrink wheel · part 3 · radius 2 (32 mm across)', `Shift hint: "${st.hint}"`);
    await shot('app-wheels-shrink');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await frames(page, 1);
    let m = await record('shrink 2');
    assert(cellAt(m, 3, [0, 0, 1]).rim === 2, 'rim 2 after Shift+click');
    await page.keyboard.press('e');
    const v = await virtualPos(3, [1, 1, 1], 4);
    await hover(page, v);
    st = await status(page);
    assert(st.hint === 'Erase the wheel’s outer half-unit · part 3 · radius 2 → 1.5', `erase hint: "${st.hint}"`);
    assert(/wheel radius 2 .* at \(1, 1, 1\)/.test(st.hover), `hover info names the wheel: "${st.hover}"`);
    await shot('app-wheels-erase-ring');
    await clickAt(page, v);
    m = await record('erase rim');
    assert(cellAt(m, 3, [0, 0, 1]).rim === 1.5, 'rim 1.5 after Erase');
    assert(m.parts.length === 5, 'no cell erased');
    await page.keyboard.press('w');
    for (const r of [2, 2.5]) {
      await clickAt(page, await hubPos(3, 4));
      await record(`regrow ${r}`);
    }
  });

  await step('a crank hole by clicking the wheel’s face; a male tool there is refused; a pin goes in', async () => {
    await page.keyboard.press('4');
    const v = await virtualPos(3, [-1, 1, 1], 4);
    await hover(page, v);
    let st = await status(page);
    assert(/— add a hole here first$/.test(st.hint), `male tool on the disc: "${st.hint}"`);
    await page.keyboard.press('1');
    const c = await virtualPos(3, [1, 1, 1], 4);
    await hover(page, c);
    st = await status(page);
    assert(st.hint === 'Extend part 3 · pin hole ∥ Z in the wheel', `crank-hole hint: "${st.hint}"`);
    await shot('app-wheels-crank-ghost');
    await clickAt(page, c);
    let m = await record('crank hole');
    assert(cellAt(m, 3, [1, 1, 1])?.kind === 'pinHole' && cellAt(m, 3, [1, 1, 1]).axis === 2, `crank hole in part 3: ${JSON.stringify(partOf(m, 3).cells)}`);
    await page.keyboard.press('4');
    await clickFace(page, 3, [1, 1, 1], 4);
    m = await record('crank pin');
    const pin = m.parts.find((p) => p.cells.some((q) => q.kind === 'pin' && q.x === 1 && q.y === 1 && q.z === 1));
    assert(pin, `a pin in the crank hole: ${JSON.stringify(m.parts.map((p) => p.cells.length))}`);
    await page.keyboard.press('v');
    await clickAt(page, await virtualPos(3, [-2, 0, 1], 4));
    const s = await state(page);
    assert(s.selection === 3, `clicking the disc selects the wheel's part (${s.selection})`);
    const w = await page.textContent('[data-role=inspector-wheels]');
    assert(w === 'Wheel radius 2.5 (40 mm across)', `inspector shows the radius: "${w}"`);
    await shot('app-wheels-crank');
    await page.keyboard.press('Escape');
  });

  await step('Ground [G] and Fix root (Model block); counts say "(none fixed)"; no root marker', async () => {
    assert(await page.locator('[data-action=fix-root]').isDisabled(), 'Fix root is disabled while the ground is off');
    assert(await page.locator('[data-action=fix-root]').isChecked(), '…and shown checked');
    await page.keyboard.press('g');
    let m = await record('ground');
    let s = await state(page);
    assert(s.ground && m.ground === true, 'G turns the ground on');
    const floor = await page.evaluate(() => window.__knap.floor());
    assert(floor && Math.abs(floor.y - (-2.5 + 0.04)) < 1e-9 && Object.keys(floor).join() === 'y', `floor at the lowest point (+0.04), no lines: ${JSON.stringify(floor)}`);
    // the wheel (hub (0, 0, 1), r 2.5, axis Z) touches the floor under its hub: a contact shadow there
    const sh = await page.evaluate(() => [window.__knap.groundShadowAt(0, 1), window.__knap.groundShadowAt(0, 14)]);
    assert(sh[0] > 0.5 && sh[1] === 0, `contact shadow under the wheel's contact line ${sh[0]}, none 13 units away ${sh[1]}`);
    assert(await page.evaluate(() => window.__knap.rootMarker(false)) !== null, 'root marker shown with a fixed root');
    await press(page, '[data-action=fix-root]');
    m = await record('free root');
    s = await state(page);
    assert(s.fixRoot === false && m.fixRoot === false && !s.rootFixed, 'Fix root off');
    assert(/\(none fixed\)/.test((await status(page)).counts), `counts: "${(await status(page)).counts}"`);
    assert(await page.evaluate(() => window.__knap.rootMarker(false)) === null, 'no root marker with a free root');
    await page.keyboard.press('Home');
    await settle(page);
    await shot('app-wheels-ground');
  });

  await step('undo / redo through all of it', async () => {
    for (let i = snaps.length - 2; i >= 0; i--) {
      await page.keyboard.press(`${MOD}+z`);
      assert(canon(await model(page)) === canon(snaps[i].m), `undo to "${snaps[i].label}"`);
    }
    assert((await model(page)).parts.length === 0, 'back to the empty model');
    for (let i = 1; i < snaps.length; i++) {
      await page.keyboard.press(`${MOD}+Shift+z`);
      assert(canon(await model(page)) === canon(snaps[i].m), `redo to "${snaps[i].label}"`);
    }
    const s = await state(page);
    assert(s.ground && !s.fixRoot, 'settings back after redo');
  });

  let saved;
  await step('Save → reload (autosave) → Open round trip; a version-1 file still opens', async () => {
    const before = await model(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
    saved = await readFile(await dl.path(), 'utf8');
    const j = JSON.parse(saved);
    assert(j.version === 2 && j.ground === true && j.fixRoot === false, `file header: ${saved.slice(0, 120)}`);
    assert(/"rim":2\.5/.test(saved) && /"rim":1\.5/.test(saved), 'rims are in the file');
    assert(canon(j) === canon(before), 'saved text is the model');
    await page.evaluate(() => window.__knap.flushAutosave());
    await page.reload();
    await openApp(page, url);
    assert(canon(await model(page)) === canon(before), 'the autosave restores rims, ground and fixRoot');
    await press(page, '[data-action=new]');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
    await chooser.setFiles({ name: 'cart.knap.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await page.waitForFunction(() => window.__knap.getModel().parts.length > 0);
    assert(canon(await model(page)) === canon(before), 'Open restores it');
    const v1 = JSON.stringify({ version: 1, rootPartId: null, nextPartId: 2, parts: [{ id: 1, color: '#c8433a', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2 }] }] });
    const [ch2] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
    await ch2.setFiles({ name: 'old.knap.json', mimeType: 'application/json', buffer: Buffer.from(v1) });
    await page.waitForFunction(() => window.__knap.getState().fileName === 'old.knap.json');
    const m1 = await model(page);
    const s = await state(page);
    assert(m1.version === 1 && !('ground' in m1) && s.ground === false && s.fixRoot === true, `version 1 file opens unchanged: ${JSON.stringify(m1)}`);
    assert(await page.evaluate(() => window.__knap.floor()) === null, 'no floor for a version-1 model');
  });

  await step('simulate the built model: the same floor at sim.groundY (no lines); Stop restores', async () => {
    await page.evaluate((t) => window.__knap.openText('cart.knap.json', t), saved);
    await frames(page, 2);
    const before = await model(page);
    await page.evaluate(() => window.__knap.stepSim(1));
    const info = await page.evaluate(() => window.__knap.simInfo());
    const floor = await page.evaluate(() => window.__knap.floor());
    assert(floor && Object.keys(floor).join() === 'y' && Math.abs(floor.y - info.groundY) < 1e-9, `sim floor ${JSON.stringify(floor)} at groundY ${info.groundY}, as in edit mode`);
    assert(Math.abs(info.groundY - (-2.5 + 0.04)) < 1e-6, `groundY = groundLevel + ½ − HC: ${info.groundY}`);
    await page.evaluate(() => window.__knap.stepSim(240));
    await frames(page, 2);
    await shot('app-wheels-sim');
    await page.keyboard.press('Escape');
    await frames(page, 1);
    assert((await state(page)).mode === 'edit', 'stopped');
    assert(canon(await model(page)) === canon(before), 'Stop: the model as edited');
    const f2 = await page.evaluate(() => window.__knap.floor());
    assert(f2 && Object.keys(f2).join() === 'y' && Math.abs(f2.y - (-2.46)) < 1e-9, `edit floor back: ${JSON.stringify(f2)}`);
  });

  await step('a wheel dropped onto the floor comes to rest on it', async () => {
    // fixed beam (root, lowest point → floor at y = −½), a loose r 1.5 wheel 2 units above the floor
    const m = {
      version: 2,
      rootPartId: 1,
      nextPartId: 3,
      ground: true,
      parts: [
        { id: 1, color: '#3b74c4', cells: [0, 1, 2].map((x) => ({ x, y: 0, z: 0, kind: 'pinHole', axis: 2 })) },
        { id: 2, color: '#e0b43c', cells: [{ x: 6, y: 3, z: 0, kind: 'axleHole', axis: 2, rim: 1.5 }] },
      ],
    };
    await page.evaluate((mm) => window.__knap.setModel(mm), m);
    await page.evaluate(() => window.__knap.stepSim(1));
    const info = await page.evaluate(() => window.__knap.simInfo());
    assert(Math.abs(info.groundY - (-0.5 + 0.04)) < 1e-9, `floor under the beam: groundY ${info.groundY}`);
    await page.evaluate(() => window.__knap.stepSim(960)); // 2 s
    const hubAt = async () => applyT((await page.evaluate(() => window.__knap.simTransforms()))[2], [6, 3, 0]);
    const a = await hubAt();
    await page.evaluate(() => window.__knap.stepSim(480)); // 1 s more
    const b = await hubAt();
    console.log(`  [app-wheels] dropped wheel: hub y ${a[1].toFixed(4)} → ${b[1].toFixed(4)} (rest height ${(-0.5 + 1.5).toFixed(2)}), moved ${dist(a, b).toFixed(4)} in the last second`);
    assert(Math.abs(b[1] - 1.0) < 0.05, `wheel rests on the floor: hub y ${b[1]} (expected ≈ 1.0)`);
    assert(dist(a, b) < 0.05, `and stays there (${dist(a, b)})`);
    await frames(page, 2);
    await shot('app-wheels-drop');
    await page.keyboard.press('Escape');
  });

  await step('pushBody rolls a free cart', async () => {
    // chassis beam (x 0..4), axles ∥ Z at x 0 and 4, four r 1.5 wheels (axle holes) on z = ±1
    const axle = (x) => [-1, 0, 1].map((z) => ({ x, y: 0, z, kind: 'axle', axis: 2 }));
    const wheel = (x, z) => [{ x, y: 0, z, kind: 'axleHole', axis: 2, rim: 1.5 }];
    const m = {
      version: 2,
      rootPartId: 1,
      nextPartId: 8,
      ground: true,
      fixRoot: false,
      parts: [
        { id: 1, color: '#3b74c4', cells: [0, 1, 2, 3, 4].map((x) => ({ x, y: 0, z: 0, kind: 'pinHole', axis: 2 })) },
        { id: 2, color: '#a8adb2', cells: axle(0) },
        { id: 3, color: '#a8adb2', cells: axle(4) },
        { id: 4, color: '#5f6468', cells: wheel(0, 1) },
        { id: 5, color: '#5f6468', cells: wheel(0, -1) },
        { id: 6, color: '#5f6468', cells: wheel(4, 1) },
        { id: 7, color: '#5f6468', cells: wheel(4, -1) },
      ],
    };
    await page.evaluate((mm) => window.__knap.setModel(mm), m);
    await page.keyboard.press('Home');
    await settle(page);
    const an = await page.evaluate(() => window.__knap.analyze());
    assert(an.fixedBodies === 0 && an.bodies === 3 && an.revolute === 2, `cart: 3 bodies, none fixed, 2 revolute: ${an.summary}`);
    await page.evaluate(() => window.__knap.stepSim(120));
    // Every body of the cart: the chassis, and each axle + wheels with the matching rolling spin
    // (ω_z = −v / r), so the cart starts rolling at 30 units/s (the chassis alone is light: a push
    // of it only would be shared with the heavy wheels).
    const pushed = await page.evaluate(() => [window.__knap.pushBody(1, [30, 0, 0]), window.__knap.pushBody(4, [30, 0, 0], [0, 0, -20]), window.__knap.pushBody(6, [30, 0, 0], [0, 0, -20])].every(Boolean));
    assert(pushed === true, 'pushBody accepted the chassis and both wheel bodies');
    const at = async () => applyT((await page.evaluate(() => window.__knap.simTransforms()))[1], [2, 0, 0]);
    const a = await at();
    await page.evaluate(() => window.__knap.stepSim(240)); // 0.5 s
    const b = await at();
    const wq = (await page.evaluate(() => window.__knap.simTransforms()))[4].q;
    console.log(`  [app-wheels] cart: chassis centre ${a.map((v) => v.toFixed(3))} → ${b.map((v) => v.toFixed(3))} in 0.5 s; front wheel q ${wq.map((v) => v.toFixed(3))}`);
    assert(b[0] - a[0] > 10, `the cart rolled forward (${(b[0] - a[0]).toFixed(3)} units in 0.5 s)`);
    assert(Math.abs(b[1] - a[1]) < 0.1, `on the floor (Δy ${(b[1] - a[1]).toFixed(4)})`);
    assert(Math.abs(wq[3]) < 0.999, 'the wheels turned');
    // rolled out of view: the status bar says how to get it back (review finding); F brings it back
    await page.evaluate(() => window.__knap.stepSim(1200)); // 2.5 s more, ≈ 60 units on
    const gone = (await status(page)).hint;
    assert(/out of view · press F/.test(gone), `out of view: "${gone}"`);
    await page.evaluate(() => window.__knap.fit());
    await page.evaluate(() => window.__knap.stepSim(1));
    await frames(page, 2);
    const back = (await status(page)).hint;
    assert(!/out of view/.test(back), `back in view after Fit: "${back}"`);
    await shot('app-wheels-cart');
    await page.keyboard.press('Escape');
    await settle(page);
  });

  await step('a free root: no part is called the fixed root; Set as fixed root turns Fix root on (one undo step)', async () => {
    await page.keyboard.press('Home');
    await page.keyboard.press('v');
    await settle(page);
    const p = await page.evaluate(() => window.__knap.screenPos([2, 0.45, 0]));
    await page.mouse.click(p.x, p.y);
    await frames(page, 1);
    assert((await state(page)).selection === 1, `chassis selected: ${(await state(page)).selection}`);
    const insp = () =>
      page.evaluate(() => {
        const b = document.querySelector('[data-action=set-root]');
        return { badge: !document.querySelector('.inspector .badge').hidden, label: b.textContent, disabled: b.disabled };
      });
    let i = await insp();
    assert(!i.badge && i.label === 'Set as fixed root' && !i.disabled, `free root: ${JSON.stringify(i)}`);
    const before = await model(page);
    await press(page, '[data-action=set-root]');
    const after = await model(page);
    i = await insp();
    assert(after.fixRoot !== false && after.rootPartId === 1 && i.badge && i.label === 'Fixed root' && i.disabled, `after: fixRoot ${after.fixRoot}, root ${after.rootPartId}, ${JSON.stringify(i)}`);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await settle(page);
    assert(JSON.stringify(await model(page)) === JSON.stringify(before), 'one undo restores the free root');
    // [R] with a non-build tool
    await page.keyboard.press('w');
    await page.keyboard.press('r');
    await frames(page, 1);
    const msg = (await status(page)).message;
    assert(/Orientation applies to the build tools/.test(msg), `W + R: "${msg}"`);
  });
}
