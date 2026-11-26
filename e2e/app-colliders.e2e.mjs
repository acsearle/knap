// App e2e: Show colliders (DESIGN §7.4) with the real mouse and keyboard.
//  - Top bar at 1280×720: "Show" + kinematics + colliders checkboxes visible, unclipped, nothing in
//    the bar clipped or wrapped (bounding boxes); tooltips name the key; the ? help lists [C].
//  - Cart and Gear train: toggle by click and by key in edit mode and in simulate mode; the drawn
//    colliders per part equal colliderSpecs (__knap.colliderSpecCounts) and the totals recorded in
//    tests/physics/colliderspecs.test.ts; the legend lists the kinds with those totals (+ Floor, + the joined-parts note);
//    a view preference: no undo step, the model untouched.
//  - Off again: the canvas is pixel-identical to before it was turned on (same camera, edit mode).
//  - Simulating, after steps: every part's collider overlay has exactly its solid's matrix, and that
//    matrix is the simulated pose (rotation = q, translation = R·origin + p with an integer origin);
//    a hidden (removed) part's colliders hide with it.
//  - Combined with Show kinematics, a selection and a build ghost.
//  - Screenshots at DPR 1 and 2: Cart, Gear train, Collision, a wheel and a liftarm close up, in edit
//    mode and mid-simulation: e2e/out/app-colliders-*.png. Render time on / off (SwiftShader: ratio only).
import { openPage } from './lib.mjs';
import { frames, openApp, press, settle, state } from './app-lib.mjs';

const ROLES = ['part', 'round', 'hull', 'guard'];
/** Collider totals of the examples (tests/physics/colliderspecs.test.ts EXAMPLE_COUNTS, as built). */
const TOTALS = {
  cart: { part: 37, round: 4, hull: 256, guard: 4 },
  'gear-train': { part: 34, round: 4, hull: 256, guard: 0 },
  collision: { part: 16, round: 0, hull: 0, guard: 0 },
};

/** Render now and keep (or compare with) the whole drawing buffer. */
async function grab(page, mode) {
  return page.evaluate((mode) => {
    const c = document.querySelector('canvas');
    const vp = c.__knapViewport;
    vp.renderNow();
    const gl = vp.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    if (mode === 'keep') {
      window.__collRef = buf;
      return { w, h, diff: 0 };
    }
    const ref = window.__collRef;
    let diff = 0;
    let maxd = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const d = Math.max(Math.abs(buf[i] - ref[i]), Math.abs(buf[i + 1] - ref[i + 1]), Math.abs(buf[i + 2] - ref[i + 2]));
      if (d > 0) diff++;
      maxd = Math.max(maxd, d);
    }
    return { w, h, diff, maxd };
  }, mode);
}

const info = (page) => page.evaluate(() => window.__knap.colliderInfo());
const totals = (inf) => {
  const t = { part: 0, round: 0, hull: 0, guard: 0 };
  for (const p of inf.parts) for (const r of ROLES) t[r] += p[r];
  return t;
};

/** Rotation matrix (row-major 3×3) of a unit quaternion [x, y, z, w]. */
function rot(q) {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

/** Move the mouse off the canvas (onto the status bar): no hover overlays. */
async function mouseAway(page) {
  await page.mouse.move(700, 712);
  await frames(page, 2);
}

/** The drawn colliders per part equal colliderSpecs, and the totals the unit test records. */
async function checkCounts(page, assert, name) {
  const inf = await info(page);
  const spec = await page.evaluate(() => window.__knap.colliderSpecCounts());
  const m = await page.evaluate(() => window.__knap.getModel());
  assert(inf.on && inf.parts.length === m.parts.length, `${name}: colliders drawn for every part (${inf.parts.length}/${m.parts.length})`);
  for (const p of inf.parts) for (const r of ROLES) assert(p[r] === spec[p.partId][r], `${name}: part ${p.partId} ${r}: drawn ${p[r]}, colliderSpecs ${spec[p.partId][r]}`);
  const t = totals(inf);
  assert(JSON.stringify(t) === JSON.stringify(TOTALS[name]), `${name}: totals ${JSON.stringify(t)} = ${JSON.stringify(TOTALS[name])}`);
  // The legend: one row per role present, with its total; the floor with the ground on.
  const legend = await page.evaluate(() => {
    const el = document.querySelector('[data-role=collider-legend]');
    return {
      visible: !!el && !el.hidden && el.getBoundingClientRect().height > 0,
      rows: Array.from(el?.querySelectorAll('li') ?? []).map((li) => ({ role: li.dataset.legendRole, count: li.querySelector('.cl-count')?.textContent ?? '', text: li.textContent })),
    };
  });
  assert(legend.visible, `${name}: legend shown`);
  // Wheel discs and gear discs are separate lines (a gear's disc never meets another gear's).
  const gearRound = inf.parts.reduce((a, p) => a + p.gearRound, 0);
  const want = { part: t.part, hull: t.hull, round: t.round - gearRound, gearRound, guard: t.guard };
  const wantRoles = Object.keys(want).filter((r) => want[r] > 0);
  const floor = (await state(page)).ground;
  const expectRoles = [...wantRoles, ...(floor ? ['floor'] : []), 'joined'];
  assert(
    JSON.stringify(legend.rows.map((r) => r.role)) === JSON.stringify(expectRoles),
    `${name}: legend rows ${legend.rows.map((r) => r.role)} = ${expectRoles} (ground ${floor})`,
  );
  for (const r of legend.rows) if (want[r.role] !== undefined) assert(Number(r.count) === want[r.role], `${name}: legend ${r.role} count ${r.count} = ${want[r.role]}`);
  for (const r of legend.rows) assert(!/group|LEGO|Technic/i.test(r.text), `${name}: plain legend words (${r.text})`);
  return inf;
}

/** Simulating: every part's colliders carry exactly its solid's matrix, which is its simulated pose. */
async function checkPoses(page, assert, name) {
  const inf = await info(page);
  const tf = await page.evaluate(() => window.__knap.simTransforms());
  let moved = 0;
  for (const p of inf.parts) {
    assert(p.matrix.every((x, i) => x === p.partMatrix[i]), `${name}: part ${p.partId}'s colliders have its solid's matrix`);
    const t = tf[p.partId];
    if (!t) continue; // removed body
    const R = rot(t.q);
    const M = p.matrix; // column-major
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert(Math.abs(M[j * 4 + i] - R[i][j]) < 1e-6, `${name}: part ${p.partId} rotation = the simulated q`);
    // translation = R·origin + p → origin = Rᵀ(translation − p) is the part's integer origin.
    const d = [M[12] - t.p[0], M[13] - t.p[1], M[14] - t.p[2]];
    const o = [0, 1, 2].map((j) => R[0][j] * d[0] + R[1][j] * d[1] + R[2][j] * d[2]);
    assert(o.every((x) => Math.abs(x - Math.round(x)) < 1e-4), `${name}: part ${p.partId} translation = R·origin + p (origin ${o.map((x) => x.toFixed(5))})`);
    if (Math.hypot(...t.p) > 0.05 || Math.abs(t.q[3]) < 0.9999) moved++;
  }
  assert(moved > 0, `${name}: some part moved (${moved})`);
  return moved;
}

/** A fixed camera on the whole model (so screenshots and the pixel check are reproducible). */
async function homeView(page) {
  await page.evaluate(() => window.__knap.home());
  await settle(page);
}

async function closeUps(page, shot, tag) {
  const m = await page.evaluate(() => window.__knap.getModel());
  const cam = await page.evaluate(() => window.__knap.camera());
  const wheel = m.parts.find((p) => p.cells.some((c) => c.rim));
  const hub = wheel.cells.find((c) => c.rim);
  const tf = await page.evaluate(() => window.__knap.simTransforms());
  const at = (id, c) => {
    const t = tf[id];
    if (!t) return [c.x, c.y, c.z];
    const R = rot(t.q);
    return [0, 1, 2].map((i) => R[i][0] * c.x + R[i][1] * c.y + R[i][2] * c.z + t.p[i]);
  };
  await page.evaluate((c) => window.__knap.setCamera(c), { ...cam, target: at(wheel.id, hub), height: 5.5 });
  await frames(page, 3);
  await shot(`app-colliders-${tag}-wheel`);
  const arm = m.parts.filter((p) => !p.cells.some((c) => c.rim) && p.cells.every((c) => /Hole/.test(c.kind))).sort((a, b) => b.cells.length - a.cells.length)[0];
  const mid = arm.cells[Math.floor(arm.cells.length / 2)];
  await page.evaluate((c) => window.__knap.setCamera(c), { ...cam, target: at(arm.id, mid), height: 4.5 });
  await frames(page, 3);
  await shot(`app-colliders-${tag}-liftarm`);
  await page.evaluate((c) => window.__knap.setCamera(c), cam);
  await frames(page, 2);
}

/** Load an example, turn colliders on, screenshot edit mode and mid-simulation (one DPR). */
async function exampleShots(page, shot, name, dpr, assert) {
  await page.evaluate((n) => window.__knap.loadExample(n), name);
  await homeView(page);
  await mouseAway(page);
  if (!(await state(page)).showColliders) await page.keyboard.press('c');
  await frames(page, 3);
  await shot(`app-colliders-${name}-edit-dpr${dpr}`);
  if (name === 'cart') await closeUps(page, shot, `cart-edit-dpr${dpr}`);
  await page.evaluate(() => window.__knap.stepSim(1));
  if (name === 'cart') {
    const ids = (await page.evaluate(() => window.__knap.getModel())).parts.map((p) => p.id);
    for (const id of ids) await page.evaluate(([i]) => window.__knap.pushBody(i, [60, 0, 0]), [id]);
  }
  await page.evaluate(() => window.__knap.stepSim(150));
  await frames(page, 3);
  if (assert) await checkPoses(page, assert, `${name} dpr${dpr}`);
  await shot(`app-colliders-${name}-sim-dpr${dpr}`);
  if (name === 'cart') await closeUps(page, shot, `cart-sim-dpr${dpr}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__knap.getState().mode === 'edit');
}

export default async function ({ page, url, shot, assert, step }) {
  await step('load', () => openApp(page, url));

  await step('top bar at 1280×720: both Show toggles visible and unclipped, nothing clipped or wrapped', async () => {
    const r = await page.evaluate(() => {
      const top = document.querySelector('.topbar');
      const tb = top.getBoundingClientRect();
      const box = (e) => {
        const b = e.getBoundingClientRect();
        return { x: b.x, r: b.right, y: b.y, b: b.bottom, w: b.width, h: b.height };
      };
      const kin = document.querySelector('[data-action=kinematics]').closest('label');
      const col = document.querySelector('[data-action=colliders]').closest('label');
      const items = Array.from(top.children).filter((e) => !e.classList.contains('spacer') && e.getClientRects().length);
      return {
        bar: box(top),
        overflow: top.scrollWidth - top.clientWidth,
        kin: { ...box(kin), text: kin.textContent, title: kin.title, clipped: kin.scrollWidth > kin.clientWidth + 0.5 },
        col: { ...box(col), text: col.textContent, title: col.title, clipped: col.scrollWidth > col.clientWidth + 0.5 },
        group: box(document.querySelector('[data-role=show-group]')),
        caption: document.querySelector('[data-role=show-group] .seg-caption').textContent,
        items: items.map((e) => ({ name: e.dataset.action || e.dataset.role || e.className, ...box(e) })),
        clipped: Array.from(top.querySelectorAll('button, label, .seg-caption, .brand')).filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 0.5).map((e) => e.textContent),
        rows: tb.height,
        // Slack: the spacer is wider than its minimum only when everything fits.
        spacer: document.querySelector('.topbar > .spacer').getBoundingClientRect().width,
        spacerMin: parseFloat(getComputedStyle(document.querySelector('.topbar > .spacer')).minWidth),
      };
    });
    console.log(`  top bar: overflow ${r.overflow}px; Show group x ${r.group.x.toFixed(0)}–${r.group.r.toFixed(0)}; kinematics ${r.kin.x.toFixed(0)}–${r.kin.r.toFixed(0)}, colliders ${r.col.x.toFixed(0)}–${r.col.r.toFixed(0)}; last item ends at ${Math.max(...r.items.map((i) => i.r)).toFixed(0)} of ${r.bar.r}`);
    assert(r.overflow <= 0, `top bar does not overflow (${r.overflow})`);
    console.log(`  top bar slack: spacer ${r.spacer.toFixed(1)} px (minimum ${r.spacerMin})`);
    assert(r.spacer > r.spacerMin + 2, `the bar has slack (spacer ${r.spacer} > min ${r.spacerMin})`);
    assert(r.clipped.length === 0, `no clipped top-bar text: ${r.clipped}`);
    for (const t of [r.kin, r.col]) {
      assert(t.w > 40 && !t.clipped && t.x >= r.bar.x && t.r <= r.bar.r && t.y >= r.bar.y && t.b <= r.bar.b, `${t.text} visible inside the bar ${JSON.stringify(t)}`);
    }
    assert(r.caption === 'Show' && /kinematics/.test(r.kin.text) && /colliders/.test(r.col.text), `"Show" kinematics colliders (${r.caption} / ${r.kin.text} / ${r.col.text})`);
    assert(/\(K\)/.test(r.kin.title) && /\(C\)/.test(r.col.title), `tooltips name the keys (${r.kin.title} / ${r.col.title})`);
    const cy = r.bar.y + r.bar.h / 2;
    for (let i = 0; i < r.items.length; i++) {
      const it = r.items[i];
      assert(it.y >= r.bar.y - 0.5 && it.b <= r.bar.b + 0.5 && Math.abs((it.y + it.b) / 2 - cy) < 4, `${it.name} on the bar's one row`);
      if (i > 0) assert(it.x >= r.items[i - 1].r - 0.5, `${r.items[i - 1].name} and ${it.name} do not overlap`);
    }
    await shot('app-colliders-topbar', { clip: { x: 0, y: 0, width: 1280, height: 40 } });
  });

  await step('? help lists Show colliders [C]', async () => {
    await page.keyboard.press('?');
    await frames(page, 1);
    const t = await page.locator('[data-role=help]').textContent();
    assert(/Show colliders/.test(t), 'help mentions Show colliders');
    await page.keyboard.press('Escape');
    await frames(page, 1);
  });

  let refShot;
  await step('Cart, edit mode: click on, counts and legend, key C off → pixel-identical', async () => {
    await page.evaluate(() => window.__knap.loadExample('cart'));
    await homeView(page);
    await mouseAway(page);
    const s0 = await state(page);
    const m0 = JSON.stringify(await page.evaluate(() => window.__knap.getModel()));
    refShot = await grab(page, 'keep');
    const off = await info(page);
    assert(!off.on && off.parts.length === 0, 'off at start');
    assert(await page.locator('[data-role=collider-legend]').isHidden(), 'legend hidden while off');
    await press(page, '[data-action=colliders]');
    await mouseAway(page);
    let s = await state(page);
    assert(s.showColliders && (await page.locator('[data-action=colliders]').isChecked()), 'the click turned it on');
    assert((await page.evaluate(() => document.activeElement?.tagName)) !== 'INPUT', 'the clicked checkbox does not keep focus');
    await checkCounts(page, assert, 'cart');
    const on = await grab(page, 'cmp');
    assert(on.diff > 0.05 * on.w * on.h, `the picture changed (${on.diff} px)`);
    await shot('app-colliders-cart-edit-on');
    // A view preference: no undo step, the model (and so the file) untouched.
    assert(s.historySize === s0.historySize && s.canUndo === s0.canUndo, 'not an undo step');
    assert(JSON.stringify(await page.evaluate(() => window.__knap.getModel())) === m0, 'model unchanged');
    // Render time, on vs off (SwiftShader: compare only the ratio).
    const tOn = await page.evaluate(() => window.__knap.renderTiming(6));
    await page.keyboard.press('c');
    await frames(page, 2);
    s = await state(page);
    assert(!s.showColliders && !(await page.locator('[data-action=colliders]').isChecked()), 'C turned it off');
    assert(await page.locator('[data-role=collider-legend]').isHidden(), 'legend hidden again');
    const back = await grab(page, 'cmp');
    assert(back.diff === 0, `off: pixel-identical to before (${back.diff} px differ, max ${back.maxd})`);
    const tOff = await page.evaluate(() => window.__knap.renderTiming(6));
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    console.log(`  render ms (SwiftShader, ratio only): off ${med(tOff).toFixed(1)}, on ${med(tOn).toFixed(1)} → ×${(med(tOn) / med(tOff)).toFixed(2)}`);
    // Key on again: the same state as the click.
    await page.keyboard.press('c');
    await frames(page, 2);
    assert((await state(page)).showColliders, 'C turns it on');
    await checkCounts(page, assert, 'cart');
  });

  await step('Cart, edit mode: works with Show kinematics, a selection and a build ghost', async () => {
    await page.keyboard.press('k');
    await page.keyboard.press('v');
    const wheel = (await page.evaluate(() => window.__knap.getModel())).parts.find((p) => p.cells.some((c) => c.rim));
    const p = await page.evaluate((id) => window.__knap.partScreenPos(id), wheel.id);
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 2);
    assert((await state(page)).selection === wheel.id, `selected the wheel by clicking it (selection ${(await state(page)).selection})`);
    await shot('app-colliders-cart-kinematics-selection');
    // The inspector sits above the legend: its Delete button stays inside the side panel's view.
    const fit = await page.evaluate(() => {
      const panel = document.querySelector('[data-role=side-panel]').getBoundingClientRect();
      const del = document.querySelector('[data-role=side-panel] [data-action=delete]').getBoundingClientRect();
      return { panelBottom: panel.bottom, delBottom: del.bottom, vh: innerHeight };
    });
    assert(fit.delBottom <= fit.panelBottom + 0.5, `Delete visible with the legend shown (Delete bottom ${fit.delBottom}, panel bottom ${fit.panelBottom}, viewport ${fit.vh})`);
    console.log(`  selection + legend: Delete bottom ${fit.delBottom.toFixed(0)} px, panel bottom ${fit.panelBottom.toFixed(0)} px`);
    // A build ghost over the colliders (pin hole tool over a beam face).
    await page.keyboard.press('1');
    const beam = (await page.evaluate(() => window.__knap.getModel())).parts.filter((q) => !q.cells.some((c) => c.rim)).sort((a, b) => b.cells.length - a.cells.length)[0];
    const fp = await page.evaluate(([id]) => {
      for (let ci = 0; ci < 8; ci++) for (const d of [2, 4, 0]) {
        const q = window.__knap.clientPosOfCellFace(id, ci, d);
        if (q) return q;
      }
      return null;
    }, [beam.id]);
    if (fp) {
      await page.mouse.move(fp.x, fp.y, { steps: 2 });
      await frames(page, 2);
      const hl = (await state(page)).buildHighlight;
      assert(hl, 'a build proposal is shown over the colliders');
      await shot('app-colliders-cart-ghost');
    }
    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    await page.keyboard.press('k');
    await mouseAway(page);
  });

  await step('Cart, simulate mode: key and click toggles, poses follow the bodies, hidden parts', async () => {
    await page.keyboard.press('c'); // off
    await frames(page, 1);
    await page.evaluate(() => window.__knap.stepSim(1));
    assert((await state(page)).mode === 'simulate', 'simulating');
    await page.keyboard.press('c'); // on, while simulating
    await frames(page, 2);
    assert((await state(page)).showColliders, 'C works while simulating');
    await checkCounts(page, assert, 'cart');
    const ids = (await page.evaluate(() => window.__knap.getModel())).parts.map((p) => p.id);
    for (const id of ids) await page.evaluate(([i]) => window.__knap.pushBody(i, [80, 0, 0]), [id]);
    await page.evaluate(() => window.__knap.stepSim(120));
    await frames(page, 2);
    const moved = await checkPoses(page, assert, 'cart sim');
    console.log(`  cart: ${moved} parts moved; their colliders carry their solids' matrices`);
    await shot('app-colliders-cart-sim-on');
    // A removed body's part is hidden by the session (setPartVisible): its colliders hide with it.
    await page.evaluate(([i]) => window.__knap.setPartVisible(i, false), [ids[0]]);
    await frames(page, 1);
    let p0 = (await info(page)).parts.find((p) => p.partId === ids[0]);
    assert(p0 && !p0.visible, 'a hidden part’s colliders are hidden');
    // …and the legend no longer counts them (it matches what the simulation still has).
    const legendCount = () =>
      page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-role=collider-legend] li')).map((li) => [li.dataset.legendRole, li.querySelector('.cl-count')?.textContent ?? ''])));
    const lc = await legendCount();
    const t0 = TOTALS.cart;
    assert(Number(lc.part) === t0.part - p0.part, `legend part count ${lc.part} = ${t0.part} − ${p0.part} after hiding part ${ids[0]}`);
    await page.evaluate(([i]) => window.__knap.setPartVisible(i, true), [ids[0]]);
    await frames(page, 1);
    p0 = (await info(page)).parts.find((p) => p.partId === ids[0]);
    assert(p0 && p0.visible, 'and shown again');
    assert(Number((await legendCount()).part) === t0.part, 'and counted again');
    // Off by click while simulating; on again by click.
    await press(page, '[data-action=colliders]');
    await mouseAway(page);
    assert(!(await state(page)).showColliders && !(await info(page)).on, 'the click turned it off while simulating');
    await press(page, '[data-action=colliders]');
    await mouseAway(page);
    assert((await state(page)).showColliders, 'and on');
    await page.evaluate(() => window.__knap.stepSim(30));
    await frames(page, 2);
    await checkPoses(page, assert, 'cart sim after re-toggle');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__knap.getState().mode === 'edit');
    assert((await state(page)).showColliders, 'the toggle survives Stop');
    await checkCounts(page, assert, 'cart');
  });

  await step('Gear train: click / key in edit mode, key in simulate mode, poses', async () => {
    await page.keyboard.press('c'); // off
    await page.evaluate(() => window.__knap.loadExample('gear-train'));
    await homeView(page);
    await mouseAway(page);
    await grab(page, 'keep');
    await press(page, '[data-action=colliders]');
    await mouseAway(page);
    assert((await state(page)).showColliders, 'click on');
    await checkCounts(page, assert, 'gear-train');
    await page.keyboard.press('c');
    await frames(page, 2);
    const back = await grab(page, 'cmp');
    assert(back.diff === 0, `gear train off: pixel-identical (${back.diff} px)`);
    await page.evaluate(() => window.__knap.stepSim(1));
    await page.keyboard.press('c');
    await frames(page, 2);
    assert((await state(page)).showColliders && (await state(page)).mode === 'simulate', 'C on while simulating');
    await checkCounts(page, assert, 'gear-train');
    await page.evaluate(() => window.__knap.stepSim(240));
    await frames(page, 2);
    await checkPoses(page, assert, 'gear-train sim');
    await page.keyboard.press('c');
    await frames(page, 1);
    assert(!(await info(page)).on, 'C off while simulating');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__knap.getState().mode === 'edit');
  });

  await step('New (empty model) with the view on: the legend says there is nothing to collide', async () => {
    await page.evaluate(() => window.__knap.setShowColliders(true));
    await page.evaluate(() => window.__knap.setModel({ version: 1, parts: [], rootPartId: null, nextPartId: 1 }));
    await frames(page, 1);
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-role=collider-legend] li')).map((li) => li.dataset.legendRole));
    const parts = (await page.evaluate(() => window.__knap.getModel())).parts.length;
    assert(parts === 0, `model empty (${parts} parts)`);
    assert(JSON.stringify(rows) === '["none"]', `empty legend rows ${rows}`);
  });

  await step('screenshots at DPR 1: Cart, Gear train, Collision, close-ups; edit and mid-simulation', async () => {
    for (const name of ['cart', 'gear-train', 'collision']) await exampleShots(page, shot, name, 1, assert);
    await page.keyboard.press('c');
  });

  await step('screenshots at DPR 2', async () => {
    const browser = page.context().browser();
    const ctx2 = await openPage(browser, url, 'app-colliders-dpr2', { deviceScaleFactor: 2 });
    try {
      await openApp(ctx2.page, url);
      for (const name of ['cart', 'gear-train', 'collision']) await exampleShots(ctx2.page, ctx2.shot, name, 2, assert);
      assert(ctx2.errors.length === 0, `DPR 2 page errors: ${ctx2.errors.join('; ')}`);
    } finally {
      await ctx2.close();
    }
  });
}
