// App e2e: gears (DESIGN §2.7, §7.2 Gear tool, §7.3 Gears in picking, §7.4) with the real mouse and
// keyboard. From an empty model: two upright two-cell beams (holes ∥ Z, 3 apart); Gear tool [T]
// makes part 2's top hole an 8-tooth gear, then steps part 1's top hole 8 → 16 → 24 → 40, which
// meshes with the 8 (status says so, with the ratio); refusals at the top of the range and for
// the 8 (it cannot grow into the 40, nor lose its teeth inside it); Select hover / inspector text;
// counts with the mesh; Erase steps the 40 down; Wheel makes a gear a plain wheel; undo / redo
// through all of it; Save → reload (autosave) → Open round trip; a newer-version file is refused
// with the core message. Screenshots: e2e/out/app-gears-*.png.
import { readFile } from 'node:fs/promises';
import { clickAt, frames, gridPos, hover, model, openApp, press, settle, state, status } from './app-lib.mjs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const partOf = (m, id) => m.parts.find((p) => p.id === id);
const cellAt = (m, id, pos) => partOf(m, id)?.cells.find((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2]);

export default async function ({ page, url, shot, assert, step }) {
  const snaps = [];
  const record = async (label) => {
    const m = await model(page);
    assert(snaps.length === 0 || canon(m) !== canon(snaps[snaps.length - 1].m), `${label}: the model changed`);
    snaps.push({ label, m });
    return m;
  };
  /** Screen point on face `dir` of cell `ci` of part `id` (a real cell face, not a disc). */
  const face = async (id, ci, dir) => {
    const p = await page.evaluate(([a, b, d]) => window.__knap.clientPosOfCellFace(a, b, d), [id, ci, dir]);
    assert(p, `face ${dir} of cell ${ci} of part ${id} is clickable`);
    return p;
  };
  /** Screen point over the virtual cell `pos` of the gear / wheel hub (cell `ci` of part `id`). */
  const virtual = async (id, ci, pos, dir) => {
    const p = await page.evaluate(([a, b, q, d]) => window.__knap.clientPosOfVirtualCell(a, b, q, d), [id, ci, pos, dir]);
    assert(p, `virtual cell ${pos} of part ${id}'s disc is clickable`);
    return p;
  };
  const hint = async () => (await status(page)).hint;

  await step('load, New; two upright beams 3 apart', async () => {
    await openApp(page, url);
    await press(page, '[data-action=new]');
    await record('new');
    await page.keyboard.press('1');
    await clickAt(page, await gridPos(page, 0, 0));
    await record('beam 1');
    await clickAt(page, await face(1, 0, 4)); // extend +Z: (0, 0, 1)
    await record('beam 1 top');
    await clickAt(page, await gridPos(page, 3, 0));
    await record('beam 2');
    await clickAt(page, await face(2, 0, 4)); // (3, 0, 1)
    const m = await record('beam 2 top');
    assert(cellAt(m, 1, [0, 0, 1]) && cellAt(m, 2, [3, 0, 1]) && m.version === 1, `two beams, version 1: ${JSON.stringify(m.parts.map((p) => p.cells))}`);
    await page.keyboard.press('Home');
    await settle(page);
  });

  await step('Gear tool [T]: an 8-tooth gear on part 2', async () => {
    await page.keyboard.press('t');
    assert((await state(page)).tool === 'gear', 'T selects the gear tool');
    assert((await page.locator('[data-tool=gear].on').count()) === 1, 'its toolbar button is on');
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-tool]')].map((b) => b.dataset.tool).join(','));
    assert(order === 'select,pinHole,axleHole,axle,pin,frictionPin,wheel,gear,erase', `toolbar order: ${order}`);
    const p = await face(2, 1, 4);
    await hover(page, p);
    const st = await status(page);
    assert(st.hint === 'Gear · part 2 · 8 teeth (radius 0.5)', `hint: "${st.hint}"`);
    assert(/Shift: one size down/.test(st.aux), `aux: "${st.aux}"`);
    await shot('app-gears-ghost-8');
    await clickAt(page, p);
    const m = await record('gear 8');
    assert(canon(cellAt(m, 2, [3, 0, 1])) === canon({ x: 3, y: 0, z: 1, kind: 'pinHole', axis: 2, rim: 0.5, teeth: true }), `8-tooth gear: ${JSON.stringify(cellAt(m, 2, [3, 0, 1]))}`);
    assert(m.version === 3, `version 3 once a gear is used (${m.version})`);
  });

  await step('part 1: 8 → 16 → 24 → 40 teeth, the last meshes with the 8', async () => {
    const want = [
      [0.5, 'Gear · part 1 · 8 teeth (radius 0.5)'],
      [1, 'Gear · part 1 · 16 teeth (radius 1)'],
      [1.5, 'Gear · part 1 · 24 teeth (radius 1.5)'],
      [2.5, 'Gear · part 1 · 40 teeth (radius 2.5) · meshes with part 2 (8 teeth, 5:1)'],
    ];
    for (const [r, text] of want) {
      const p = await face(1, 1, 4);
      await hover(page, p);
      const h = await hint();
      assert(h === text, `hint before ${r * 16} teeth: "${h}"`);
      if (r === 2.5) await shot('app-gears-ghost-40');
      await clickAt(page, p);
      const m = await record(`gear ${r * 16}`);
      assert(cellAt(m, 1, [0, 0, 1]).rim === r && cellAt(m, 1, [0, 0, 1]).teeth === true, `part 1 gear ${r}: ${JSON.stringify(cellAt(m, 1, [0, 0, 1]))}`);
    }
    const msg = (await status(page)).message;
    assert(msg === 'Gear · part 1 · 40 teeth (radius 2.5) · meshes with part 2 (8 teeth, 5:1)', `message after the click: "${msg}"`);
    const counts = (await status(page)).counts;
    assert(/ · 1 mesh$/.test(counts), `counts include the mesh: "${counts}"`);
    await page.mouse.move(5, 300);
    await page.keyboard.press('Home');
    await settle(page);
    await shot('app-gears-mesh');
  });

  await step('refusals: the top of the range; the 8 cannot grow into the 40 or lose its teeth', async () => {
    const before = await model(page);
    let p = await face(1, 1, 4);
    await hover(page, p);
    assert((await hint()) === 'Gear · part 1 — largest gear has 40 teeth', `top: "${await hint()}"`);
    assert((await page.locator('.st-hint.invalid').count()) === 1, 'shown as invalid');
    await clickAt(page, p);
    assert(canon(await model(page)) === canon(before), 'the click changes nothing');
    let st = await status(page);
    assert(st.error && st.message === 'Can’t make that gear: largest gear has 40 teeth', `error: "${st.message}"`);
    p = await face(2, 1, 4);
    await hover(page, p);
    const h = await hint();
    assert(h === 'Gear · part 2 · 16 teeth (radius 1) — gears would overlap: the gear of part 1 (hub (0, 0, 1))', `8 → 16: "${h}"`);
    await shot('app-gears-invalid');
    await page.keyboard.down('Shift');
    await frames(page, 1);
    const hs = await hint();
    assert(hs === 'Gear · part 2 · back to a bare pin hole — (3, 0, 1) is inside the gear of part 1', `Shift on the 8: "${hs}"`);
    assert(/release Shift/.test((await status(page)).aux), 'aux says release Shift');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await frames(page, 1);
    assert(canon(await model(page)) === canon(before), 'Shift+click on the 8 changes nothing');
    st = await status(page);
    assert(st.error && /^Can’t step the gear down: \(3, 0, 1\) is inside the gear of part 1/.test(st.message), `error: "${st.message}"`);
  });

  await step('Select: hover text and the inspector name the gear, its teeth and its mesh', async () => {
    await page.keyboard.press('v');
    const p = await virtual(1, 1, [-2, 0, 1], 4);
    await hover(page, p);
    const st = await status(page);
    assert(st.hover === 'Part 1 · gear 40 teeth ∥ Z · meshes with part 2 (8 teeth)', `hover: "${st.hover}"`);
    await clickAt(page, p);
    assert((await state(page)).selection === 1, 'clicking the gear face selects part 1');
    const g = await page.textContent('[data-role=inspector-gears]');
    assert(g === 'Gear 40 teeth (radius 2.5) · meshes with part 2 (8 teeth, 5:1)', `inspector: "${g}"`);
    await shot('app-gears-inspector');
    await page.keyboard.press('Escape');
  });

  await step('build tools on the gear: a crank hole in the web, refused near the teeth and on the teeth', async () => {
    await page.keyboard.press('1');
    let p = await virtual(1, 1, [-1, 1, 1], 4);
    await hover(page, p);
    assert((await hint()) === 'Extend part 1 · pin hole ∥ Z in the gear', `web: "${await hint()}"`);
    p = await virtual(1, 1, [-2, 1, 1], 4);
    await hover(page, p);
    assert((await hint()) === 'Extend part 1 · pin hole ∥ Z in the gear — too close to the teeth — crank holes go on grid cells centred within 2 of the hub', `near the teeth: "${await hint()}"`);
    await shot('app-gears-crank-refused');
    // the teeth seen edge-on from the side: a tread
    await page.evaluate(() => window.__knap.setView('top'));
    await frames(page, 2);
    const side = await page.evaluate(() => window.__knap.screenPos([-2.55, 0.1, 1]));
    await hover(page, side);
    const t = await hint();
    assert(t === "Part 1 · gear teeth — point at the gear's flat face or at a hole to build on a gear", `teeth: "${t}"`);
    await page.keyboard.press('Home');
    await settle(page);
  });

  await step('Erase steps the 40 down one size; Wheel makes the 24 a plain wheel', async () => {
    await page.keyboard.press('e');
    let p = await virtual(1, 1, [-2, 0, 1], 4);
    await hover(page, p);
    assert((await hint()) === 'Erase gear teeth · part 1 · 40 → 24 teeth', `erase hint: "${await hint()}"`);
    await shot('app-gears-erase');
    await clickAt(page, p);
    let m = await record('erase 40 → 24');
    assert(cellAt(m, 1, [0, 0, 1]).rim === 1.5 && cellAt(m, 1, [0, 0, 1]).teeth === true, 'a 24 now');
    assert(!/mesh/.test((await status(page)).counts), `no mesh: "${(await status(page)).counts}"`);
    await page.keyboard.press('w');
    p = await face(1, 1, 4);
    await hover(page, p);
    assert((await hint()) === 'Plain wheel · part 1 · radius 1.5 (24 mm across) instead of the 24-tooth gear', `wheel hint: "${await hint()}"`);
    await clickAt(page, p);
    m = await record('plain wheel');
    assert(canon(cellAt(m, 1, [0, 0, 1])) === canon({ x: 0, y: 0, z: 1, kind: 'pinHole', axis: 2, rim: 1.5 }), `plain wheel: ${JSON.stringify(cellAt(m, 1, [0, 0, 1]))}`);
    // and back to the 40 with the Gear tool: wheel 1.5 → 24, then 40
    await page.keyboard.press('t');
    for (const r of [1.5, 2.5]) {
      await clickAt(page, await face(1, 1, 4));
      m = await record(`gear again ${r}`);
      assert(cellAt(m, 1, [0, 0, 1]).rim === r && cellAt(m, 1, [0, 0, 1]).teeth === true, `gear ${r} again`);
    }
  });

  await step('undo / redo through all of it', async () => {
    for (let i = snaps.length - 2; i >= 0; i--) {
      await page.keyboard.press(`${MOD}+z`);
      assert(canon(await model(page)) === canon(snaps[i].m), `undo to "${snaps[i].label}"`);
    }
    for (let i = 1; i < snaps.length; i++) {
      await page.keyboard.press(`${MOD}+Shift+z`);
      assert(canon(await model(page)) === canon(snaps[i].m), `redo to "${snaps[i].label}"`);
    }
  });

  await step('Save → reload (autosave) → Open round trip; a newer version is refused with the core message', async () => {
    const before = await model(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
    const saved = await readFile(await dl.path(), 'utf8');
    const j = JSON.parse(saved);
    assert(j.version === 3 && /"rim":2\.5,"teeth":true/.test(saved) && /"rim":0\.5,"teeth":true/.test(saved), `file: ${saved.slice(0, 200)}`);
    assert(canon(j) === canon(before), 'saved text is the model');
    await page.evaluate(() => window.__knap.flushAutosave());
    await page.reload();
    await openApp(page, url);
    assert(canon(await model(page)) === canon(before), 'the autosave restores the gears');
    assert(/ · 1 mesh$/.test((await status(page)).counts), 'counts after restore');
    await press(page, '[data-action=new]');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
    await chooser.setFiles({ name: 'gears.knap.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
    await page.waitForFunction(() => window.__knap.getModel().parts.length > 0);
    assert(canon(await model(page)) === canon(before), 'Open restores it');
    const newer = JSON.stringify({ ...j, version: 4 });
    const [ch2] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
    await ch2.setFiles({ name: 'future.knap.json', mimeType: 'application/json', buffer: Buffer.from(newer) });
    await page.waitForFunction(() => window.__knap.getState().banner !== '');
    const banner = (await state(page)).banner;
    assert(banner === 'Could not open future.knap.json: Invalid knap model (1 problem):\n  - unsupported version 4 (expected 1, 2 or 3)', `banner: "${banner}"`);
    assert(canon(await model(page)) === canon(before), 'the model is untouched');
    await shot('app-gears-newer-file');
    await press(page, '[data-role=banner] button');
    // a gear on a radius that is not a gear radius
    const bad = JSON.parse(saved);
    bad.parts[0].cells.find((q) => q.teeth).rim = 2;
    const [ch3] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
    await ch3.setFiles({ name: 'bad.knap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    await page.waitForFunction(() => window.__knap.getState().banner !== '');
    const b2 = (await state(page)).banner;
    console.log(`  [app-gears] invalid gear file: ${b2.replace(/\n/g, ' | ')}`);
    assert(/^Could not open bad\.knap\.json: Invalid knap model \(\d+ problems?\):\n {2}- /.test(b2), `banner: "${b2}"`);
    await press(page, '[data-role=banner] button');
  });

  await step('review m8 ux fixes: near gears that do not mesh say why; a beam\'s middle hole goes straight to 40; the help lists the pairs', async () => {
    const hole = (x, y, z, rim, teeth) => ({ x, y, z, kind: 'pinHole', axis: 2, ...(rim !== undefined ? { rim } : {}), ...(teeth ? { teeth: true } : {}) });
    const mk = (parts) => ({ version: 3, rootPartId: 1, nextPartId: parts.length + 1, parts: parts.map((cells, i) => ({ id: i + 1, color: '#a8adb2', cells })) });
    await page.evaluate((m) => window.__knap.setModel(m), mk([[hole(0, 0, 0, 1, true)], [hole(3, 0, 0, 1, true)]]));
    await page.keyboard.press('Home');
    await settle(page);
    await page.keyboard.press('t');
    await hover(page, await face(2, 0, 4));
    let h = await hint();
    assert(h === 'Gear · part 2 · 24 teeth (radius 1.5) · does not mesh with part 1 (16 teeth): a 16 meshes only with another 16, in line at distance 2', `near miss: "${h}"`);
    await shot('app-gears-nearmiss');
    // a 5-hole beam: the middle hole's click makes the 40 (its four beam cells are the web)
    await page.evaluate((m) => window.__knap.setModel(m), mk([[0, 1, 2, 3, 4].map((x) => hole(x, 0, 0))]));
    await page.keyboard.press('Home');
    await settle(page);
    const p = await face(1, 2, 4);
    await hover(page, p);
    h = await hint();
    assert(h === "Gear · part 1 · 40 teeth (radius 2.5) · skips 8, 16, 24: (1, 0, 0) would cut into the teeth of this part's gear (hub (2, 0, 0))", `beam middle: "${h}"`);
    assert((await page.locator('.st-hint.invalid').count()) === 0, 'shown as valid');
    await clickAt(page, p);
    const m = await model(page);
    assert(cellAt(m, 1, [2, 0, 0]).rim === 2.5 && cellAt(m, 1, [2, 0, 0]).teeth === true, `one click made the 40: ${JSON.stringify(cellAt(m, 1, [2, 0, 0]))}`);
    // the end hole of a fresh beam: no size fits, and the reason says where a gear can go
    await page.evaluate((m) => window.__knap.setModel(m), mk([[0, 1, 2, 3, 4].map((x) => hole(x, 0, 0))]));
    await settle(page);
    await hover(page, await face(1, 0, 4));
    h = await hint();
    assert(/ · a gear needs a layer to itself: sleeve a hole onto a pin, or extend a hole out of the beam along its axis$/.test(h), `beam end: "${h}"`);
    // the help dialog explains meshing
    await page.mouse.move(5, 300);
    await page.keyboard.press('?');
    await page.locator('[data-role=help]').waitFor({ state: 'visible' });
    const txt = await page.textContent('[data-role=help]');
    assert(/8\+8 at 1 · 8\+24 and 16\+16 at 2 · 8\+40 and 24\+24 at 3 · 24\+40 at 4 · 40\+40 at 5/.test(txt) && /Meshes only with another 16/.test(txt), 'help lists the meshing pairs and the 16 rule');
    await shot('app-gears-help');
    await page.keyboard.press('Escape');
  });
}
