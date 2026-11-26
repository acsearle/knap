// App e2e: Back side (DESIGN §7.3) — the build tools pick the BACK FACE UNDER THE CURSOR: the face
// the mouse ray would hit if front faces were culled and back faces drawn.
//
// With the real mouse and Alt held (and with the [B] toggle) it
//  - sweeps the cursor across a 1×7 beam seen from Home and records, per position, the highlighted
//    back face and the status sentence (e2e/out/app-back-sweep.json);
//  - makes ≥ 200 seeded random hovers over three models (the beam, the four-bar example, the Cart)
//    from three views and asserts that the highlighted face is a back face whose projected quad
//    contains the cursor (tread hits on wheels, which by §7.3 highlight the hub's lateral face, are
//    counted separately), and that clicks build on that face (the new cell is at C + n);
//  - checks Alt re-resolving without a mouse move, [R] with Alt (also Option+R = '®'), one undo
//    step, the toggle button, a pin inserted from behind, Select / Erase, Option characters;
//  - takes screenshots of the highlight and the ghost seen through the part.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR } from './lib.mjs';
import { clickAt, deepEqual, frames, hover, model, openApp, press, state, status } from './app-lib.mjs';

const cell = (x, y, z, kind, axis) => ({ x, y, z, kind, axis });
const beamCells = (n) => Array.from({ length: n }, (_, i) => cell(i, 0, 0, 'pinHole', 2));
const START = { parts: [{ id: 1, color: '#d0453b', cells: beamCells(7) }], rootPartId: null, nextPartId: 2 };
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const LABEL = ['+X', '−X', '+Y', '−Y', '+Z', '−Z'];

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const camera = (page) => page.evaluate(() => window.__knap.camera());
const highlight = (page) => page.evaluate(() => window.__knap.getState().buildHighlight);

/** Client corners of face `dir` of the cell at `pos`, ordered counter-clockwise about the outward normal. */
async function faceQuad(page, pos, dir) {
  return page.evaluate(
    ([pos, dir]) => {
      const a = dir >> 1;
      const s = dir & 1 ? -1 : 1;
      const t1 = (a + 1) % 3;
      const t2 = (a + 2) % 3;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      if (s < 0) corners.reverse();
      return corners.map(([u, v]) => {
        const p = [...pos];
        p[a] += 0.5 * s;
        p[t1] += 0.5 * u;
        p[t2] += 0.5 * v;
        return window.__knap.screenPos(p);
      });
    },
    [pos, dir],
  );
}

/** Signed area of a client-space polygon (client y points down). */
const signedArea = (q) => q.reduce((s, p, i) => s + p.x * q[(i + 1) % q.length].y - q[(i + 1) % q.length].x * p.y, 0) / 2;

/** Distance (px) of p inside the convex quad (positive inside, negative outside), any winding. */
function insideDepth(q, p) {
  const sgn = Math.sign(signedArea(q)) || 1;
  let d = Infinity;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    d = Math.min(d, (sgn * (ex * (p.y - a.y) - ey * (p.x - a.x))) / len);
  }
  return d;
}

/** Client bounding box of the model (cell cubes and rim discs), clipped to the canvas. */
async function modelBox(page) {
  return page.evaluate(() => {
    const k = window.__knap;
    const m = k.getModel();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (p) => {
      const s = k.screenPos(p);
      x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
    };
    for (const part of m.parts)
      for (const c of part.cells) {
        for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) add([c.x + dx, c.y + dy, c.z + dz]);
        if (c.rim) {
          const a = c.axis, u = (a + 1) % 3, v = (a + 2) % 3;
          for (let i = 0; i < 16; i++)
            for (const s of [-0.5, 0.5]) {
              const p = [c.x, c.y, c.z];
              p[a] += s;
              p[u] += c.rim * Math.cos((i * Math.PI) / 8);
              p[v] += c.rim * Math.sin((i * Math.PI) / 8);
              add(p);
            }
        }
      }
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x0: Math.max(x0, r.left + 2), y0: Math.max(y0, r.top + 2), x1: Math.min(x1, r.right - 2), y1: Math.min(y1, r.bottom - 2) };
  });
}

/** The cell (or wheel) the highlight belongs to in the model, for classifying tread hits. */
function hubAt(m, pos) {
  for (const p of m.parts) for (const c of p.cells) if (c.x === pos[0] && c.y === pos[1] && c.z === pos[2] && c.rim) return c;
  return null;
}

/** The back-face sign of a quad: back faces (normal away from the viewer) have the opposite winding to front ones. */
let FRONT_SIGN = 0;

export default async function ({ page, url, shot, assert, step }) {
  await step('load a 7-hole beam, Home view', async () => {
    await openApp(page, url);
    await page.evaluate(() => {
      window.__altUps = [];
      window.addEventListener('keyup', (e) => {
        if (e.key === 'Alt') window.__altUps.push(e.defaultPrevented);
      });
    });
    await page.evaluate((m) => window.__knap.setModel(m), START);
    await page.evaluate(() => window.__knap.home());
    await frames(page, 2);
    await page.keyboard.press('1');
    // calibrate the front-face winding: the +Z face of the middle cell faces the Home camera
    FRONT_SIGN = Math.sign(signedArea(await faceQuad(page, [3, 0, 0], 4)));
    assert(FRONT_SIGN !== 0, 'front winding');
  });

  const cam0 = await camera(page);

  await step('sweep across the beam with Alt held: the highlight walks over the back faces under the cursor', async () => {
    // two lines along the beam, off its centre line (which from Home projects onto the back edge
    // where the −Y and −Z faces meet): one on each side of that edge (y − z = +0.2 and −0.4)
    await page.keyboard.down('Alt');
    const rows = [];
    for (let i = 0; i <= 120; i++) {
      const off = i <= 60 ? [0.3, 0.1] : [-0.3, 0.1];
      const f = (i % 61) / 60;
      const a = await page.evaluate((o) => window.__knap.screenPos([-1.2, o[0], o[1]]), off);
      const b = await page.evaluate((o) => window.__knap.screenPos([7.2, o[0], o[1]]), off);
      const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      await page.mouse.move(p.x, p.y);
      const h = await highlight(page);
      const st = await status(page);
      const row = { x: Math.round(p.x), y: Math.round(p.y), face: h && h.backSide ? `(${h.pos.join(',')}) ${LABEL[h.dir]}` : null, hint: st.hint };
      if (h && h.backSide) {
        const q = await faceQuad(page, h.pos, h.dir);
        row.depth = +insideDepth(q, p).toFixed(2);
        assert(row.depth > -1, `sweep ${i}: the highlighted face (${row.face}) does not contain the cursor (${row.depth} px)`);
        assert(Math.sign(signedArea(q)) === -FRONT_SIGN, `sweep ${i}: ${row.face} is not a back face`);
        assert(st.hint.endsWith(`· back side (${LABEL[h.dir]})`), `sweep ${i}: the sentence names the face: "${st.hint}"`);
      }
      rows.push(row);
    }
    await page.keyboard.up('Alt');
    await writeFile(join(OUT_DIR, 'app-back-sweep.json'), JSON.stringify(rows, null, 1));
    const faces = new Set(rows.map((r) => r.face).filter(Boolean));
    assert(faces.size >= 12, `the highlight walks over several back faces (${faces.size}: ${[...faces].join(' | ')})`);
    assert(rows.filter((r) => r.face).length >= 80, 'most of the sweep is over the beam');
  });

  await step('Alt held: the hover is re-resolved without a mouse move; a lone Alt release is swallowed', async () => {
    await hover(page, await page.evaluate(() => window.__knap.screenPos([3.2, 0.1, 0.5])));
    let st = await status(page);
    assert(/^Extend part 1 · pin hole ∥ Z$/.test(st.hint), `front side: "${st.hint}"`);
    assert(/Alt: back side \(the back face under the cursor\)/.test(st.aux), `the hint line explains Alt: "${st.aux}"`);
    assert((await highlight(page)).backSide === false, 'front highlight');
    await page.evaluate(() => (window.__altUps = []));
    await page.keyboard.down('Alt');
    await frames(page, 1);
    st = await status(page);
    const h = await highlight(page);
    assert(h.backSide === true && st.hint === `Extend part 1 · pin hole ∥ Z · back side (${LABEL[h.dir]})`, `Alt: "${st.hint}" ${JSON.stringify(h)}`);
    assert(!/Alt: back side/.test(st.aux), `no Alt hint while it is held: "${st.aux}"`);
    const s = await state(page);
    assert(s.altHeld === true && s.backSide === false, `state: altHeld ${s.altHeld}, toggle ${s.backSide}`);
    await shot('app-back-alt-beam');
    await page.keyboard.up('Alt');
    await frames(page, 1);
    st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z', `Alt released: front side again: "${st.hint}"`);
    const ups = await page.evaluate(() => window.__altUps);
    assert(ups.length === 1 && ups[0] === true, `a lone Alt release is preventDefault'ed (${JSON.stringify(ups)})`);
  });

  await step('Alt held: R cycles the back-side orientation (also as a Mac Option+R, "®")', async () => {
    await page.keyboard.down('Alt');
    await frames(page, 1);
    let st = await status(page);
    const lab = LABEL[(await highlight(page)).dir];
    const n = Number(/\[R\] 1\/(\d)/.exec(st.aux)?.[1]);
    assert(n >= 2 && st.hint.endsWith(` · back side (${lab})`), `before R: "${st.hint}" "${st.aux}"`);
    assert(/Shift: .* · back side \(/.test(st.aux), `the Shift hint says back side: "${st.aux}"`);
    await page.keyboard.press('r');
    await frames(page, 1);
    st = await status(page);
    assert(new RegExp(`\\[R\\] 2/${n}`).test(st.aux) && st.hint.endsWith(` · back side (${lab})`), `Alt+R cycles: "${st.hint}" "${st.aux}"`);
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '®', code: 'KeyR', altKey: true, bubbles: true, cancelable: true })));
    await frames(page, 1);
    st = await status(page);
    assert(new RegExp(`\\[R\\] ${n >= 3 ? 3 : 1}/${n}`).test(st.aux), `Option+R ("®") cycles: "${st.hint}" "${st.aux}"`);
    for (let k = n >= 3 ? 3 : 1; k !== 1 && k <= n; k++) await page.keyboard.press('r'); // back to the first
    await frames(page, 1);
    st = await status(page);
    assert(/\[R\] 1\//.test(st.aux), `cycled round: "${st.aux}"`);
    await page.keyboard.up('Alt');
    await frames(page, 1);
  });

  await step('Alt + click builds on the highlighted back face (C + n); undo is one step', async () => {
    const before = await state(page);
    await page.keyboard.down('Alt');
    await frames(page, 1);
    const h = await highlight(page);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await frames(page, 1);
    const m = await model(page);
    const n = DIRS[h.dir];
    const want = cell(h.pos[0] + n[0], h.pos[1] + n[1], h.pos[2] + n[2], 'pinHole', 2);
    assert(deepEqual(m.parts[0].cells, [...beamCells(7), want]), `a hole at C + n = ${JSON.stringify(want)}: ${JSON.stringify(m.parts[0].cells.slice(7))}`);
    assert(deepEqual(await camera(page), cam0), 'the camera never moved');
    const after = await state(page);
    assert(after.historySize === before.historySize + 1, `one history step (${before.historySize} → ${after.historySize})`);
    assert(new RegExp(`^Extend part 1 · pin hole ∥ Z · back side \\(${LABEL[h.dir]}\\) → part 1$`).test(after.message.text), `message: "${after.message.text}"`);
    await page.keyboard.press('Control+z');
    await frames(page, 1);
    assert(deepEqual((await model(page)).parts, START.parts), 'one undo restores the beam');
  });

  // -------------------------------------------------------------------------------------------
  // Random hovers: three models × three views

  const R = lcg(20261126);
  const totals = { hovers: 0, back: 0, grid: 0, tread: 0, edge: 0, clicks: 0, invalidClicks: 0 };
  const log = [];
  const setups = [
    { name: 'beam', load: (p) => p.evaluate((m) => window.__knap.setModel(m), START), tool: '1' },
    { name: 'four-bar', load: (p) => p.evaluate(() => window.__knap.loadExample('four-bar')), tool: '1' },
    { name: 'cart', load: (p) => p.evaluate(() => window.__knap.loadExample('cart')), tool: '2' },
  ];
  const views = ['home', 'top-back-right', 'bottom-front-left'];
  for (const su of setups)
    for (const view of views)
      await step(`random hovers with Alt: ${su.name}, ${view}`, async () => {
        await su.load(page);
        await page.evaluate((v) => (v === 'home' ? window.__knap.home() : (window.__knap.setView(v), window.__knap.fit())), view);
        await frames(page, 2);
        await page.keyboard.press(su.tool);
        const m = await model(page);
        const box = await modelBox(page);
        await page.keyboard.down('Alt');
        let shotTaken = false;
        let clicks = 0;
        const cells = m.parts.flatMap((x) => x.cells);
        for (let k = 0; k < 28; k++) {
          // 3 in 4 aimed at a random point of a random cell (or wheel disc), the rest anywhere in the box
          let p;
          if (R() < 0.75) {
            const c = cells[Math.floor(R() * cells.length)];
            const w = [c.x + (R() - 0.5) * 0.9, c.y + (R() - 0.5) * 0.9, c.z + (R() - 0.5) * 0.9];
            if (c.rim && R() < 0.6) {
              const a = c.axis, u = (a + 1) % 3, v = (a + 2) % 3;
              const ang = R() * 2 * Math.PI, rad = Math.sqrt(R()) * c.rim * 0.97;
              w[u] = [c.x, c.y, c.z][u] + rad * Math.cos(ang);
              w[v] = [c.x, c.y, c.z][v] + rad * Math.sin(ang);
            }
            p = await page.evaluate((w) => window.__knap.screenPos(w), w);
            if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) p = { x: Math.min(box.x1, Math.max(box.x0, p.x)), y: Math.min(box.y1, Math.max(box.y0, p.y)) };
          } else p = { x: box.x0 + R() * (box.x1 - box.x0), y: box.y0 + R() * (box.y1 - box.y0) };
          await page.mouse.move(p.x, p.y);
          totals.hovers++;
          const h = await highlight(page);
          const st = await status(page);
          if (!h && /wheel tread · back side \((\+|−)[XYZ]\) — /.test(st.hint)) {
            // a ray leaving through a wheel's tread: refused, with the way to do it (fixer's ruling,
            // DEVIATIONS §7; was: the hub's lateral face, not under the cursor)
            totals.treadRefused = (totals.treadRefused ?? 0) + 1;
            continue;
          }
          if (!h || !h.backSide) {
            // nothing under the cursor: New on grid as usual (or no proposal)
            assert(!h || (h.dir === 3 && !h.backSide), `${su.name}/${view} #${k}: front highlight with Alt held ${JSON.stringify(h)}`);
            assert(!/back side/.test(st.hint), `${su.name}/${view} #${k}: "${st.hint}"`);
            totals.grid++;
            continue;
          }
          totals.back++;
          const q = await faceQuad(page, h.pos, h.dir);
          const depth = insideDepth(q, p);
          const hub = hubAt(m, h.pos);
          const rec = { model: su.name, view, x: +p.x.toFixed(1), y: +p.y.toFixed(1), face: `(${h.pos.join(',')}) ${LABEL[h.dir]}`, depth: +depth.toFixed(2), hint: st.hint };
          log.push(rec);
          if (depth < 1.5) totals.edge++;
          // (was: a tread exit could highlight the hub's lateral face away from the cursor; tread
          // exits are now refused, so every highlighted back face contains the cursor)
          void hub;
          assert(depth >= -1, `${su.name}/${view} #${k}: the highlighted face ${rec.face} does not contain the cursor (${rec.depth} px)`);
          assert(Math.sign(signedArea(q)) === -FRONT_SIGN, `${su.name}/${view} #${k}: ${rec.face} faces the viewer`);
          assert(st.hint.includes(`· back side (${LABEL[h.dir]})`), `${su.name}/${view} #${k}: "${st.hint}"`);
          if (!shotTaken && depth > 6) {
            await frames(page, 1);
            await shot(`app-back-${su.name}-${view}`);
            shotTaken = true;
          }
          // click on a few: the new cell is at C + n
          if (clicks < 3 && h.valid && /^Extend part \d+/.test(st.hint)) {
            clicks++;
            const before = await model(page);
            await page.mouse.down();
            await page.mouse.up();
            await frames(page, 1);
            const after = await model(page);
            const n = DIRS[h.dir];
            const want = [h.pos[0] + n[0], h.pos[1] + n[1], h.pos[2] + n[2]];
            const pid = Number(/^Extend part (\d+)/.exec(st.hint)[1]);
            const added = after.parts.find((x) => x.id === pid).cells.filter((c) => !before.parts.find((x) => x.id === pid).cells.some((d) => d.x === c.x && d.y === c.y && d.z === c.z));
            // a virtual cell of a wheel: the crank hole goes AT G (§7.3) when the face is the disc's own
            const atG = added.length === 1 && added[0].x === h.pos[0] && added[0].y === h.pos[1] && added[0].z === h.pos[2];
            assert(added.length === 1 && ((added[0].x === want[0] && added[0].y === want[1] && added[0].z === want[2]) || atG), `${rec.face}: added ${JSON.stringify(added)}, want ${JSON.stringify(want)}`);
            totals.clicks++;
            await page.keyboard.up('Alt');
            await page.keyboard.press('Control+z');
            await page.keyboard.down('Alt');
            await frames(page, 1);
            assert(deepEqual(await model(page), before), 'undo');
          }
        }
        await page.keyboard.up('Alt');
        await frames(page, 1);
      });

  await step('a wheel of the Cart from Home: the far flat face of the disc (screenshot)', async () => {
    await page.evaluate(() => window.__knap.loadExample('cart'));
    await page.evaluate(() => window.__knap.home());
    await frames(page, 2);
    await page.keyboard.press('2');
    const m = await model(page);
    let hub = null;
    for (const part of m.parts) for (const c of part.cells) if (c.rim && c.axis === 2 && (!hub || c.z > hub.z || (c.z === hub.z && c.x > hub.x))) hub = c;
    assert(hub, 'a wheel ∥ Z');
    // aim at a point of the disc's far (−Z) flat face, off the hub on the upper right (the pin head in front of the hub is not crossed)
    const off = 0.7 * hub.rim * Math.SQRT1_2;
    const p = await page.evaluate((w) => window.__knap.screenPos(w), [hub.x + off, hub.y + off + 0.15, hub.z - 0.5]);
    await page.keyboard.down('Alt');
    await hover(page, p);
    const h = await highlight(page);
    const st = await status(page);
    await shot('app-back-cart-wheel');
    await page.keyboard.up('Alt');
    assert(h && h.backSide && h.dir === 5 && h.pos[2] === hub.z, `the wheel's far flat face: ${JSON.stringify(h)} "${st.hint}"`);
    assert(/in the wheel · back side \(−Z\)$/.test(st.hint), `"${st.hint}"`);
    assert(insideDepth(await faceQuad(page, h.pos, h.dir), p) > -1, 'the cursor is over the highlighted virtual cell');
  });

  await step('random-hover totals', async () => {
    await writeFile(join(OUT_DIR, 'app-back-hovers.json'), JSON.stringify({ totals, log }, null, 1));
    console.log(`    hovers ${totals.hovers}: back ${totals.back}, grid ${totals.grid}, tread refused ${totals.treadRefused ?? 0}, within 1.5 px of an edge ${totals.edge}, clicks ${totals.clicks}`);
    assert(totals.hovers >= 200, `${totals.hovers} hovers`);
    assert(totals.back >= 150, `${totals.back} back-face hovers`);
    assert(totals.clicks >= 10, `${totals.clicks} clicks`);
  });

  // -------------------------------------------------------------------------------------------

  await step('front view: the Back side toggle, mouse only — a hole behind, then a pin inserted from behind', async () => {
    await page.evaluate((m) => window.__knap.setModel(m), START);
    await page.evaluate(() => (window.__knap.setView('front'), window.__knap.fit()));
    await frames(page, 2);
    await press(page, '[data-tool=pinHole]');
    const btn = '[data-action=back-side]';
    assert((await page.getAttribute(btn, 'aria-pressed')) === 'false', 'toggle starts off');
    assert(/\(B\)/.test((await page.getAttribute(btn, 'title')) ?? '') && /back face under the cursor/.test((await page.getAttribute(btn, 'title')) ?? ''), 'the button explains itself');
    await press(page, btn);
    assert((await page.getAttribute(btn, 'aria-pressed')) === 'true', 'toggle on');
    assert((await state(page)).backSide === true, 'getState().backSide');
    const before = (await state(page)).historySize;
    const p = await page.evaluate(() => window.__knap.cellScreenPos(1, 4));
    await hover(page, p);
    let st = await status(page);
    assert(st.hint === 'Extend part 1 · pin hole ∥ Z · back side (−Z)', `toggle: back side: "${st.hint}"`);
    assert(deepEqual(await highlight(page), { pos: [4, 0, 0], dir: 5, backSide: true, valid: true }), 'highlight: the back of (4,0,0)');
    await shot('app-back-toggle-front');
    await clickAt(page, p);
    let m = await model(page);
    assert(deepEqual(m.parts[0].cells, [...beamCells(7), cell(4, 0, -1, 'pinHole', 2)]), `a hole behind (4,0,0): ${JSON.stringify(m.parts[0].cells.slice(7))}`);
    assert((await state(page)).historySize === before + 1, 'one history step');
    await press(page, '[data-action=undo]');
    m = await model(page);
    assert(deepEqual(m.parts, START.parts), 'toolbar undo restores the beam in one step');
    await press(page, '[data-tool=pin]');
    const q = await page.evaluate(() => window.__knap.cellScreenPos(1, 1));
    await hover(page, q);
    st = await status(page);
    assert(st.hint === 'New part · insert pin ∥ Z into part 1 · back side (−Z)', `insert from behind: "${st.hint}"`);
    await clickAt(page, q);
    m = await model(page);
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
    assert(/back face under the cursor/.test((await status(page)).message), `on message: "${(await status(page)).message}"`);
    await page.keyboard.press('b');
  });

  await step('Option / AltGr characters still work: [ rotates the selection with Alt held', async () => {
    await page.keyboard.press('v');
    const p = await page.evaluate(() => window.__knap.cellScreenPos(1, 3));
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
