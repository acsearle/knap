// Reviewer "ux2": Back side through the real UI. Run: E2E_DIST=e2e/out/review-ux2-dist node e2e/review-ux2-back.mjs
//  A. ≥ 2000 real-mouse hovers with Alt held over 14 models × 14 fixed + random views: the app's
//     highlighted face (getState().buildHighlight) against the independent ray-marching reference
//     (review-ux2-ref.mjs), the ray rebuilt in Node from the camera state.
//  B. ≥ 200 hover-then-click trials with Alt held: built cell at C + n (or Insert / Sleeve at C),
//     the status sentence names it, one undo step restores the model exactly.
//  C. Modifiers / state checks. D. Filmstrips (DPR 1 and 2).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR, launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp, press, status } from './app-lib.mjs';
import { refBack } from './review-ux2-ref.mjs';

const C = (x, y, z, kind = 'pinHole', axis = 2, rim) => ({ x, y, z, kind, axis, ...(rim ? { rim } : {}) });
const beamX = (n, y = 0, z = 0) => Array.from({ length: n }, (_, i) => C(i, y, z));
const M = (...parts) => ({ version: 1, rootPartId: null, nextPartId: parts.length + 1, parts: parts.map((cells, i) => ({ id: i + 1, color: ['#c8433a', '#3b74c4', '#e8e8e4', '#5f6468', '#e0b43c'][i % 5], cells })) });
const CUSTOM = {
  beam7: M(beamX(7)),
  L: M([...beamX(5), C(4, 1, 0), C(4, 2, 0), C(4, 3, 0)]),
  stacked: M(beamX(7, 0, 0), beamX(7, 0, 1)),
  pinBoth: M(beamX(5), [C(2, 0, -1, 'pin'), C(2, 0, 0, 'pin'), C(2, 0, 1, 'pin')]),
  pinFlush: M(beamX(5), [C(2, 0, 0, 'pin')]),
  axleThree: M(
    [C(0, 0, 0), C(1, 0, 0), C(2, 0, 0, 'axleHole'), C(3, 0, 0)],
    [C(0, 0, 1), C(1, 0, 1), C(2, 0, 1, 'axleHole'), C(3, 0, 1)],
    [C(0, 0, 2), C(1, 0, 2), C(2, 0, 2, 'axleHole'), C(3, 0, 2)],
    [C(2, 0, -1, 'axle'), C(2, 0, 0, 'axle'), C(2, 0, 1, 'axle'), C(2, 0, 2, 'axle'), C(2, 0, 3, 'axle')],
  ),
  wheelCrank: M([C(0, 0, 1, 'pinHole', 2, 2.5), C(2, 2, 1)]),
};
const EXAMPLES = ['pendulum', 'triple-pendulum', 'four-bar', 'parallelogram', 'sliding-axle', 'weld-test', 'collision', 'crank-wheel', 'cart'];

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const rnd = lcg(424242);
const D2R = Math.PI / 180;
const VIEWS = [];
for (const yaw of [45, 135, 225, 315]) for (const pitch of [35.264, -35.264]) VIEWS.push({ yaw: yaw * D2R, pitch: pitch * D2R, name: `oct${yaw}/${pitch > 0 ? 'up' : 'dn'}` });
for (const yaw of [0, 90, 180, 270]) VIEWS.push({ yaw: yaw * D2R, pitch: 0, name: `axis${yaw}` });
VIEWS.push({ yaw: 0, pitch: 89.999 * D2R, name: 'top' }, { yaw: 0, pitch: -89.999 * D2R, name: 'bottom' });

async function cam(page) {
  return page.evaluate(() => window.__knap.camera());
}
/** The pick ray at a client point, rebuilt from the camera state and three projections. */
async function rayAt(page, x, y) {
  const c = await cam(page);
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const back = [cp * sy, sp, cp * cy];
  const right = [cy, 0, -sy];
  const up = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
  const T = c.target;
  const add = (a, b, s) => a.map((v, i) => v + s * b[i]);
  const [p0, pr, pu] = await page.evaluate((pts) => pts.map((p) => window.__knap.screenPos(p)), [T, add(T, right, 1), add(T, up, 1)]);
  const a11 = pr.x - p0.x, a21 = pr.y - p0.y, a12 = pu.x - p0.x, a22 = pu.y - p0.y;
  const det = a11 * a22 - a12 * a21;
  const dx = x - p0.x, dy = y - p0.y;
  const u = (a22 * dx - a12 * dy) / det;
  const v = (-a21 * dx + a11 * dy) / det;
  const P = add(add(T, right, u), up, v);
  return { origin: add(P, back, 300), dir: back.map((q) => -q) };
}

function modelRect(page) {
  return page.evaluate(() => {
    const m = window.__knap.getModel();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of m.parts)
      for (const c of p.cells) {
        const r = c.rim ?? 0.5;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const e = [0, 1, 2].map((a) => (a === c.axis ? 0.5 : Math.max(0.5, r)));
          const s = window.__knap.screenPos([c.x + sx * e[0], c.y + sy * e[1], c.z + sz * e[2]]);
          x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
        }
      }
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x0: Math.max(x0, r.left + 2), x1: Math.min(x1, r.right - 2), y0: Math.max(y0, r.top + 2), y1: Math.min(y1, r.bottom - 2) };
  });
}
const onCanvas = (page, x, y) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', [x, y]);
const hl = (page) => page.evaluate(() => window.__knap.getState().buildHighlight);
const st = (page) => page.evaluate(() => window.__knap.getState());

async function setModelAndView(page, name, view) {
  if (CUSTOM[name]) await page.evaluate((m) => window.__knap.setModel(m), CUSTOM[name]);
  else await page.evaluate((n) => window.__knap.loadExample(n), name);
  await page.evaluate((v) => {
    const c = window.__knap.camera();
    window.__knap.setCamera({ ...c, yaw: v.yaw, pitch: v.pitch });
    window.__knap.fit();
  }, view);
}

const server = await startServer();
const browser = await launchBrowser();
const out = { A: {}, B: {}, C: [], notes: [] };
const log = (...a) => console.log(...a);
try {
  const ctx = await openPage(browser, server.url, 'ux2-back');
  const { page } = ctx;
  await openApp(page, server.url);
  // pick the pin-hole tool
  await press(page, '[data-tool=pinHole]');

  // ---------------- A. hovers vs reference
  const A = { n: 0, compared: 0, ambiguous: 0, agree: 0, grid: 0, mism: [] };
  const models = [...Object.keys(CUSTOM), ...EXAMPLES];
  let vi = 0;
  for (const name of models) {
    const views = [...VIEWS, ...Array.from({ length: 2 }, () => ({ yaw: rnd() * 2 * Math.PI, pitch: (rnd() * 170 - 85) * D2R, name: 'random' }))];
    for (const view of views) {
      vi++;
      await setModelAndView(page, name, view);
      await page.mouse.move(5, 5);
      await page.keyboard.down('Alt');
      const R = await modelRect(page);
      const m = await page.evaluate(() => window.__knap.getModel());
      for (let k = 0; k < 10; k++) {
        const x = Math.round(R.x0 + rnd() * (R.x1 - R.x0));
        const y = Math.round(R.y0 + rnd() * (R.y1 - R.y0));
        if (!(await onCanvas(page, x, y))) continue;
        await page.mouse.move(x, y);
        const h = await hl(page);
        const ray = await rayAt(page, x, y);
        const ref = refBack(m, ray);
        A.n++;
        if (ref.status === 'ambiguous') { A.ambiguous++; continue; }
        A.compared++;
        if (ref.status === 'none') {
          if (!h || !h.backSide) { A.agree++; A.grid++; } else A.mism.push({ name, view: view.name, x, y, ref: 'none', h });
          continue;
        }
        const exp = { pos: ref.virtual ?? ref.pos, dir: ref.dir };
        // insert/sleeve resolutions may highlight the male in the same cell: compare pos + dir only
        if (h && h.backSide && h.pos.join() === exp.pos.join() && h.dir === exp.dir) A.agree++;
        else if (A.mism.length < 60) A.mism.push({ name, view: view.name, cam: await cam(page), x, y, ref: { ...exp, partId: ref.partId, tread: ref.tread, virtual: ref.virtual, t: ref.t }, h, hint: (await status(page)).hint });
      }
      await page.keyboard.up('Alt');
      if (vi % 20 === 0) log(`A progress: ${vi} views, ${A.n} hovers, ${A.agree} agree, ${A.mism.length} mism`);
    }
  }
  out.A = A;
  log(`A: ${A.n} hovers in ${vi} (model, view) pairs; ${A.compared} compared, ${A.ambiguous} ambiguous, ${A.agree} agree (${A.grid} over nothing), ${A.mism.length} mismatches`);
  for (const x of A.mism.slice(0, 10)) log('  mismatch', JSON.stringify(x));

  // ---------------- B. hover-then-click trials
  const B = { trials: 0, built: 0, invalid: 0, grid: 0, bad: [] };
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const tools = ['pinHole', 'axleHole', 'pin', 'axle', 'frictionPin'];
  const bmodels = ['beam7', 'L', 'pinBoth', 'axleThree', 'wheelCrank', 'four-bar', 'cart', 'crank-wheel'];
  let trial = 0;
  for (const name of bmodels) {
    for (let v = 0; v < 4; v++) {
      const view = v < 2 ? VIEWS[(trial * 3 + v) % 8] : { yaw: rnd() * 6.28, pitch: (rnd() * 140 - 70) * D2R, name: 'random' };
      await setModelAndView(page, name, view);
      for (let k = 0; k < 7; k++) {
        const tool = tools[trial++ % 5];
        await page.keyboard.up('Alt');
        await press(page, `[data-tool=${tool}]`);
        const R = await modelRect(page);
        const x = Math.round(R.x0 + rnd() * (R.x1 - R.x0));
        const y = Math.round(R.y0 + rnd() * (R.y1 - R.y0));
        if (!(await onCanvas(page, x, y))) continue;
        await page.keyboard.down('Alt');
        await page.mouse.move(x, y, { steps: 2 });
        const h = await hl(page);
        const s0 = await st(page);
        const hint = (await status(page)).hint;
        const m0 = await page.evaluate(() => window.__knap.getModel());
        B.trials++;
        await page.mouse.down();
        await page.mouse.up();
        await page.keyboard.up('Alt');
        const m1 = await page.evaluate(() => window.__knap.getModel());
        const s1 = await st(page);
        const msg = (await status(page)).message;
        if (!h || !h.backSide) { B.grid++; continue; } // nothing under the cursor: New on grid, not a Back side trial
        if (!h.valid) {
          B.invalid++;
          if (JSON.stringify(m0) !== JSON.stringify(m1)) B.bad.push({ name, tool, why: 'invalid but model changed', hint });
          if (!/back side/.test(hint) && h.backSide) B.bad.push({ name, tool, why: 'invalid hint lacks back side', hint });
          continue;
        }
        if (JSON.stringify(m0) === JSON.stringify(m1)) { B.bad.push({ name, tool, why: 'valid but nothing built', hint, msg }); continue; }
        B.built++;
        // new cells
        const key = (c) => `${c.x},${c.y},${c.z},${c.kind}`;
        const before = new Set(m0.parts.flatMap((p) => p.cells.map(key)));
        const added = m1.parts.flatMap((p) => p.cells.filter((c) => !before.has(key(c))).map((c) => [c.x, c.y, c.z]));
        const n = DIRS[h.dir];
        const Cn = [h.pos[0] + n[0], h.pos[1] + n[1], h.pos[2] + n[2]].join();
        const Cp = h.pos.join();
        const action = /^Extend/.test(hint) ? 'extend' : /insert/.test(hint) ? 'insert' : /sleeve/.test(hint) ? 'sleeve' : /^New part/.test(hint) ? 'new' : '?';
        const virtualExtend = action === 'extend' && added.some((a) => a.join() === Cp);
        const ok =
          (action === 'extend' && (added.some((a) => a.join() === Cn) || virtualExtend)) ||
          ((action === 'insert' || action === 'sleeve') && added.some((a) => a.join() === Cp)) ||
          (action === 'new' && added.some((a) => a.join() === Cn));
        if (!ok) B.bad.push({ name, tool, hint, h, added, why: 'built cell not at C+n / C' });
        if (!/back side \((\+|−)[XYZ]\)/.test(hint)) B.bad.push({ name, tool, hint, why: 'hint lacks back side' });
        if (!msg.startsWith(hint.replace(/ — .*$/, '').slice(0, 20))) B.bad.push({ name, tool, hint, msg, why: 'message differs from hint' });
        if (!s1.canUndo) B.bad.push({ name, tool, why: 'no undo step' });
        await page.keyboard.press('ControlOrMeta+z');
        await frames(page, 1);
        const m2 = await page.evaluate(() => window.__knap.getModel());
        const strip = (m) => JSON.stringify({ ...m, version: 0 });
        if (strip(m2) !== strip(m0)) B.bad.push({ name, tool, why: 'one undo did not restore the model' });
      }
    }
  }
  out.B = B;
  log(`B: ${B.trials} click trials: ${B.built} built, ${B.invalid} invalid (nothing changed), ${B.grid} empty; ${B.bad.length} bad`);
  for (const x of B.bad.slice(0, 10)) log('  bad', JSON.stringify(x));

  // ---------------- C. modifiers / state
  const c = (label, ok, extra = '') => { out.C.push({ label, ok, extra }); log(`C: ${ok ? 'ok  ' : 'FAIL'} ${label} ${extra}`); };
  await page.keyboard.up('Alt');
  await page.evaluate((m) => window.__knap.setModel(m), CUSTOM.beam7);
  await page.evaluate(() => { window.__knap.home(); });
  await press(page, '[data-tool=pinHole]');
  await frames(page, 2);
  const mid = await page.evaluate(() => window.__knap.screenPos([3.2, 0.1, 0.5]));
  await page.mouse.move(mid.x, mid.y, { steps: 3 });
  const hFront = await hl(page);
  await page.keyboard.down('Alt');
  const hAlt = await hl(page);
  c('Alt down without a mouse move re-resolves', hAlt && hAlt.backSide && !hFront.backSide, JSON.stringify({ hFront, hAlt }));
  await page.keyboard.up('Alt');
  const hUp = await hl(page);
  c('Alt up without a mouse move returns to the front face', hUp && !hUp.backSide && hUp.dir === hFront.dir, JSON.stringify(hUp));
  // Alt-tab: Alt down then window blur
  await page.keyboard.down('Alt');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const sBlur = await st(page);
  c('window blur with Alt held clears the held state', !sBlur.altHeld && !sBlur.buildHighlight?.backSide, JSON.stringify(sBlur.buildHighlight));
  await page.keyboard.up('Alt');
  // Alt held while pointer re-enters (keydown went elsewhere): pointer event altKey
  await page.mouse.move(mid.x + 1, mid.y);
  await page.keyboard.down('Alt');
  await page.keyboard.up('Alt');
  // Alt + Shift
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.mouse.move(mid.x, mid.y);
  const hAS = await hl(page);
  const tAS = (await status(page)).hint;
  c('Alt+Shift: back face + New part', hAS?.backSide && /New part/.test(tAS) && /back side/.test(tAS), tAS);
  await page.keyboard.up('Shift');
  // Alt + R
  const t0 = (await status(page)).hint;
  await page.keyboard.press('r');
  const t1 = (await status(page)).hint;
  c('[R] while Alt is held cycles the orientation', t0 !== t1, `${t0} -> ${t1}`);
  await page.keyboard.up('Alt');
  // toggle [B] + [N]
  await page.keyboard.press('b');
  const sb = await st(page);
  const btn = await page.evaluate(() => { const b = document.querySelector('[data-action=back-side]'); return { pressed: b.getAttribute('aria-pressed'), on: b.classList.contains('on'), title: b.title }; });
  c('[B] toggles back side and the button shows pressed', sb.backSide && btn.pressed === 'true' && btn.on, JSON.stringify(btn));
  await page.keyboard.press('n');
  await page.mouse.move(mid.x + 1, mid.y);
  const tBN = (await status(page)).hint;
  c('[B]+[N] hint', /back side/.test(tBN) && /New part/.test(tBN), tBN);
  await page.keyboard.press('n');
  const msgB = (await status(page)).message;
  // Erase / Select / Wheel ignore it
  for (const tool of ['erase', 'select', 'wheel']) {
    await press(page, `[data-tool=${tool}]`);
    await page.mouse.move(mid.x, mid.y, { steps: 2 });
    const s = await st(page);
    const dis = await page.evaluate(() => document.querySelector('[data-action=back-side]').disabled);
    c(`${tool} ignores Back side (button disabled, no back highlight)`, dis && !s.buildHighlight?.backSide, (await status(page)).hint);
  }
  await press(page, '[data-tool=pinHole]');
  await page.keyboard.press('b');
  // Option characters in a text field still type (ALT_BUILD_CODES rule)
  // simulate mode: Alt does nothing to the grab / hover
  await page.evaluate(() => window.__knap.stepSim(0));
  await page.keyboard.down('Alt');
  await page.mouse.move(mid.x, mid.y, { steps: 2 });
  const sSim = await st(page);
  c('simulate mode: no build highlight with Alt', !sSim.buildHighlight, JSON.stringify(sSim.buildHighlight));
  await page.keyboard.up('Alt');
  await page.evaluate(() => window.__knap.setMode('edit'));

  // ---------------- D. filmstrips
  await writeFile(join(OUT_DIR, 'review-ux2-back.json'), JSON.stringify(out, null, 1));
  await ctx.close();

  for (const dpr of [1, 2]) {
    const ctx2 = await openPage(browser, server.url, 'ux2-film', { deviceScaleFactor: dpr });
    const p2 = ctx2.page;
    await openApp(p2, server.url);
    await press(p2, '[data-tool=pinHole]');
    const films = dpr === 1 ? ['beam7', 'L', 'four-bar', 'cart', 'pinBoth'] : ['beam7', 'cart'];
    for (const name of films) {
      await setModelAndView(p2, name, { yaw: 45 * D2R, pitch: 35.264 * D2R });
      if (name === 'cart') await p2.evaluate(() => window.__knap.home());
      await frames(p2, 2);
      const R = await modelRect(p2);
      const yLine = R.y0 + (R.y1 - R.y0) * 0.45;
      await p2.mouse.move(R.x0, yLine);
      await p2.keyboard.down('Alt');
      const strip = [];
      const N = dpr === 1 ? 8 : 4;
      for (let i = 0; i <= N; i++) {
        const x = R.x0 + ((R.x1 - R.x0) * (i + 0.3)) / (N + 0.6);
        await p2.mouse.move(x, yLine, { steps: 2 });
        await frames(p2, 2);
        const h = await hl(p2);
        const hint = (await status(p2)).hint;
        strip.push({ i, x: Math.round(x), y: Math.round(yLine), h, hint });
        await ctx2.shot(`review-ux2-film-${name}-dpr${dpr}-${i}`, { clip: { x: Math.max(0, R.x0 - 40), y: Math.max(0, R.y0 - 40), width: Math.min(1200, R.x1 - R.x0 + 80), height: Math.min(640, R.y1 - R.y0 + 80) } });
      }
      await p2.keyboard.up('Alt');
      await writeFile(join(OUT_DIR, `review-ux2-film-${name}-dpr${dpr}.json`), JSON.stringify(strip, null, 1));
      log(`D: film ${name} dpr${dpr}: ` + strip.map((s) => (s.h ? `${s.h.pos}${['+X', '−X', '+Y', '−Y', '+Z', '−Z'][s.h.dir]}${s.h.backSide ? '' : '(front)'}` : '-')).join(' | '));
    }
    await ctx2.close();
  }
} finally {
  await browser.close();
  await server.close();
}
