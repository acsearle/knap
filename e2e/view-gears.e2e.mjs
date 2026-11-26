// Drawing gears (DESIGN.md §6.1 "Gears", §7.4 mesh glyph) in the real app, plus a pixel-for-pixel
// check that meshes without gears draw exactly as before the gear drawing work.
//
//   E2E_DIST=e2e/out/<me>-dist node e2e/run.mjs view-gears     (E2E_NO_BUILD=1 to reuse the build)
//
// 1. Unchanged look (view demo page, served from the repo by vite dev): every example, overlays,
//    tint, DPR 2 and a far zoom (where the soft-contour fade is < 1, so the fading branch of the
//    outline composite runs) are rendered by src/view as it is now and by src/view as it was at
//    VIEW_GEARS_BEFORE_REF (default 2d3372a, the commit before; mirrored into
//    e2e/out/view-gears-before/ with the same src/core, src/geometry and demo page) and compared
//    pixel for pixel on the drawing buffer.
// 2. Gear models through window.__knap.setModel (a 40 + 8 + 24 train in line, every tooth count on
//    each hub axis, gears on the ground, a gear beside a plain wheel): screenshots
//    e2e/out/view-gears-*.png at DPR 1 and 2 and three zooms (close, Home, far).
// 3. Measures: ink in the tooth band across zooms at DPR 1 and 2 (against a plain wheel of the same
//    size; ink = darkening by the outline composite, from renders with and without it), ink
//    stability under 0.25° orbit steps on the train (as view-shots), frame time of the train vs
//    plain wheels of similar triangle count, the contact shadow under a gear on the ground.
// 4. Overlays on gears: ghost of a toothed disc, hover face / erase cell / wheel-band ring, the
//    kinematics tint, the selection highlight, joint + mesh glyphs.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { OUT_DIR, ROOT, freePort, openPage } from './lib.mjs';
import { openApp } from './app-lib.mjs';

const BEFORE_REF = process.env.VIEW_GEARS_BEFORE_REF ?? '2d3372a';
const N = 'view-gears';
const log = (s) => console.log(`  [${N}] ${s}`);
const PITCH = Math.PI / 8;
const ISO_PITCH = Math.atan(1 / Math.SQRT2);

// ------------------------------------------------------------------------------------------------
// models (cells: x, y, z, kind, axis, rim, teeth)

const hub = (x, y, z, axis, r, teeth = true) => ({ x, y, z, kind: 'axleHole', axis, rim: r, ...(teeth ? { teeth: true } : {}) });
const model = (parts, extra = {}) => ({ version: 3, parts: parts.map((p, i) => ({ id: i + 1, ...p })), rootPartId: 1, nextPartId: parts.length + 1, ...extra });

/** 40 + 8 + 24 in line along X, about Z (hubs at x 0, 3, 5). */
const TRAIN = model([
  { color: '#e0b43c', cells: [hub(0, 0, 0, 2, 2.5)] },
  { color: '#c8433a', cells: [hub(3, 0, 0, 2, 0.5)] },
  { color: '#3b74c4', cells: [hub(5, 0, 0, 2, 1.5)] },
]);
const TRAIN_MESHES = [
  { hubA: [0, 0, 0], hubB: [3, 0, 0], rA: 2.5, rB: 0.5, axis: 2, followA: 1, followB: 2 },
  { hubA: [3, 0, 0], hubB: [5, 0, 0], rA: 0.5, rB: 1.5, axis: 2, followA: 2, followB: 3 },
];
/** Every tooth count (columns, x) on each hub axis (rows, z), palette colours incl. dark grey. */
const COLORS = ['#e0b43c', '#5f6468', '#3b74c4', '#c8433a'];
const SIZES = model(
  [0, 1, 2].flatMap((axis) => [0.5, 1, 1.5, 2.5].map((r, i) => ({ color: COLORS[(i + axis) % 4], cells: [hub(i * 7, 0, axis * 7, axis, r)] }))),
);
/** A 24 standing on the ground (axis X) and a 40 lying flat (axis Y) 1.1 above the floor. */
const GROUND = model([{ color: '#4c9a57', cells: [hub(0, 0, 0, 0, 1.5)] }, { color: '#e0b43c', cells: [hub(6, 0, 0, 1, 2.5)] }], { ground: true });
/** A 40-tooth gear and a plain r 2.5 wheel side by side, same colour. */
const SIDE = model([{ color: '#a8adb2', cells: [hub(0, 0, 0, 2, 2.5)] }, { color: '#a8adb2', cells: [hub(6, 0, 0, 2, 2.5, false)] }]);
/** One 40-tooth gear / one r 2.5 wheel (ink measure). */
const ONE_GEAR = model([{ color: '#e0b43c', cells: [hub(0, 0, 0, 2, 2.5)] }]);
const ONE_WHEEL = model([{ color: '#e0b43c', cells: [hub(0, 0, 0, 2, 2.5, false)] }]);
/** Plain wheels with about the train's triangle count (frame-time reference). */
const WHEELS = model([0, 6, 12, 18].map((x) => ({ color: '#e0b43c', cells: [hub(x, 0, 0, 2, 2.5, false)] })));

// ------------------------------------------------------------------------------------------------
// page helpers (app)

const VP = () => document.querySelector('canvas.kv-canvas').__knapViewport;

async function setModel(page, m) {
  await page.evaluate((mm) => window.__knap.setModel(mm), m);
  const got = await page.evaluate(() => window.__knap.getModel());
  if (got.parts.length !== m.parts.length) throw new Error(`setModel kept ${got.parts.length} of ${m.parts.length} parts`);
  await page.evaluate(() => window.__knap.home());
}

/** Camera at the Home direction, centred on `target`, `height` world units tall. */
async function camAt(page, target, height, yaw = Math.PI / 4, pitch = ISO_PITCH) {
  await page.evaluate((c) => window.__knap.setCamera(c), { target, height, yaw, pitch });
}

/** Device px per world unit of the current view. */
const pxPerUnit = (page) =>
  page.evaluate(`(() => { const vp = (${VP})(); return vp.size.height * vp.size.pixelRatio / vp.getCamera().height; })()`);

/**
 * Ink measure over the screen box of part `id` (+4 device px): renders with and without the outline
 * composite; ink = Σ clamp((L_off − L_on) / (L_off − L_ink), 0, 1) over pixels, footprint = pixels
 * of the box that differ from the background without ink. `softFade` forces the soft-contour
 * strength (undefined: from the zoom).
 */
function inkOf(page, id, softFade) {
  return page.evaluate(
    `(() => {
    const vp = (${VP})();
    const id = ${id};
    vp.setGridVisible(false);
    vp.setRootMarkerVisible(false);
    vp.setOutlineDebug({ softFade: ${softFade === undefined ? 'null' : softFade} });
    const gl = vp.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const read = () => { vp.renderNow(); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    vp.setOutlineDebug({ ink: false });
    const off = read();
    vp.setOutlineDebug({ ink: true });
    const on = read();
    const fade = vp.softFade();
    vp.setOutlineDebug({ softFade: null });
    const b = vp.partBox(id);
    const d = vp.size.pixelRatio;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
      const p = vp.project([x, y, z]);
      x0 = Math.min(x0, p.x * d); x1 = Math.max(x1, p.x * d); y0 = Math.min(y0, p.y * d); y1 = Math.max(y1, p.y * d);
    }
    x0 = Math.max(0, Math.floor(x0 - 4)); x1 = Math.min(W - 1, Math.ceil(x1 + 4));
    y0 = Math.max(0, Math.floor(y0 - 4)); y1 = Math.min(H - 1, Math.ceil(y1 + 4));
    const L = (a, i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const LINK = 0.299 * 0.12 * 255 + 0.587 * 0.125 * 255 + 0.114 * 0.135 * 255;
    let ink = 0, foot = 0, dark = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = ((H - 1 - y) * W + x) * 4;
      if (Math.abs(off[i] - 247) + Math.abs(off[i + 1] - 247) + Math.abs(off[i + 2] - 245) > 24) foot++;
      const lo = L(off, i), ln = L(on, i);
      if (lo - LINK > 20) ink += Math.min(1, Math.max(0, (lo - ln) / (lo - LINK)));
      if (ln < 70) dark++;
    }
    return { ink, foot, density: ink / Math.max(1, foot), dark, fade, box: [x0, y0, x1, y1] };
  })()`,
  );
}

// ------------------------------------------------------------------------------------------------
// 1. before / after (view demo page)

async function mirrorBefore() {
  const dir = join(OUT_DIR, 'view-gears-before');
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'src', 'view'), { recursive: true });
  await mkdir(join(dir, 'e2e'), { recursive: true });
  const files = execFileSync('git', ['ls-tree', '--name-only', BEFORE_REF, 'src/view/'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of files) await writeFile(join(dir, f), execFileSync('git', ['show', `${BEFORE_REF}:${f}`], { cwd: ROOT }));
  for (const d of ['core', 'geometry']) await symlink(join(ROOT, 'src', d), join(dir, 'src', d), 'dir');
  for (const f of ['view-demo.html', 'view-demo-page.ts']) await copyFile(join(ROOT, 'e2e', f), join(dir, 'e2e', f));
  return dir;
}

async function devServer(root) {
  const port = await freePort();
  const server = await createServer({
    root,
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'warn',
    server: { host: '127.0.0.1', port, strictPort: true, open: false, hmr: false, fs: { allow: [ROOT] } },
  });
  await server.listen();
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}

/** The demo page's drawing buffer as a base64 string (after a synchronous render). */
const demoPixels = (page) =>
  page.evaluate(() => {
    window.__view.renderNow();
    const gl = window.__view.vp.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = '';
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
    return { w, h, b64: btoa(s) };
  });

// ------------------------------------------------------------------------------------------------

export default async function (ctx) {
  const { assert, step } = ctx;
  const browser = ctx.page.context().browser();
  const report = [];
  const rec = (s) => {
    report.push(s);
    log(s);
  };

  // ---------------------------------------------------------------- 1. unchanged look
  await step('meshes without gears draw exactly as before (pixel compare against ' + BEFORE_REF + ')', async () => {
    const beforeRoot = await mirrorBefore();
    const before = await devServer(beforeRoot);
    const after = await devServer(ROOT);
    const cases = [
      ['four-bar', 'example=four-bar&sel=3&glyphs=1', {}],
      ['cart', 'example=cart', {}],
      ['crank-wheel', 'example=crank-wheel&glyphs=1', {}],
      ['all-tinted', 'example=all&gears=0&tint=1&glyphs=1', { width: 1600, height: 600 }],
      ['overlays', 'example=four-bar&sel=3&hoverFace=4,2,2,4&ghost=7,0,1,pinHole,2,1&glyphs=1', {}],
      ['far (fade < 1)', 'example=four-bar&target=2,1,0&height=60', {}],
      ['farther (fade 0)', 'example=cart&target=0,0,0&height=150', {}],
      ['dpr2', 'example=four-bar&sel=3&glyphs=1', { width: 1000, height: 600, deviceScaleFactor: 2 }],
      ['dpr2 far', 'example=cart&target=0,0,0&height=110', { width: 1000, height: 600, deviceScaleFactor: 2 }],
      ['closeup', 'example=four-bar&target=0,2,1.4&height=2.6&yaw=32&pitch=24', {}],
      // control: the comparison does see a difference (after gets a selection the before lacks)
      ['CONTROL (must differ)', 'example=four-bar', {}, '&sel=3'],
    ];
    try {
      for (const [label, query, vpOpts, afterExtra] of cases) {
        const shots = [];
        for (const srv of [before, after]) {
          const q = srv === after && afterExtra ? query + afterExtra : query;
          const c = await openPage(browser, srv.url, N, { width: 1280, height: 720, ...vpOpts });
          await c.page.goto(`${srv.url}e2e/view-demo.html?${q}&anim=0`);
          await c.page.waitForFunction(() => window.__view?.ready || window.__viewError, null, { timeout: 120000 });
          const err = await c.page.evaluate(() => window.__viewError);
          assert(!err, `demo error (${label}): ${err}`);
          shots.push(await demoPixels(c.page));
          if (c.errors.length) throw new Error(`page errors (${label}): ${c.errors.join('; ')}`);
          await c.close();
        }
        const [a, b] = shots.map((s) => Buffer.from(s.b64, 'base64'));
        assert(a.length === b.length && a.length > 0, `${label}: same buffer size`);
        let diff = 0;
        let maxd = 0;
        for (let i = 0; i < a.length; i += 4) {
          const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
          if (d) diff++;
          maxd = Math.max(maxd, d);
        }
        rec(`unchanged ${label} (${shots[0].w}×${shots[0].h}): ${diff} px differ (max channel diff ${maxd})`);
        if (afterExtra) assert(diff > 1000, `${label}: the pixel compare detects a real change (${diff} px)`);
        else assert(diff === 0, `${label}: ${diff} pixels differ from ${BEFORE_REF}`);
      }
    } finally {
      await before.close();
      await after.close();
    }
  });

  // ---------------------------------------------------------------- 2. screenshots in the app
  /** Open the app at a DPR. */
  async function app(dpr = 1, size = { width: 1280, height: 720 }) {
    const c = await openPage(browser, ctx.url, N, { ...size, deviceScaleFactor: dpr });
    await openApp(c.page, ctx.url);
    return c;
  }

  await step('screenshots: train, sizes, ground, gear beside wheel at DPR 1 and 2, three zooms', async () => {
    for (const dpr of [1, 2]) {
      const c = await app(dpr);
      const { page } = c;
      await setModel(page, TRAIN);
      await c.shot(`${N}-train-home-dpr${dpr}`);
      const home = await page.evaluate(() => window.__knap.camera());
      await camAt(page, [0, 0, 0], 4.2);
      await c.shot(`${N}-train-close-dpr${dpr}`);
      // far zooms by CSS px per tooth pitch (the same view at both DPRs): 10, 4.5 and 2.5 CSS px
      const cssH = await page.evaluate(`(${VP})().size.height`);
      for (const [name, cssPx] of [['midfar', 10], ['far', 4.5], ['farthest', 2.5]]) {
        await camAt(page, home.target, (PITCH * cssH) / cssPx, home.yaw, home.pitch);
        rec(`train ${name} DPR ${dpr}: ${((await pxPerUnit(page)) * PITCH).toFixed(2)} device px per tooth pitch, soft fade ${(await page.evaluate(`(${VP})().softFade()`)).toFixed(2)}`);
        await c.shot(`${N}-train-${name}-dpr${dpr}`);
      }
      await page.evaluate(() => window.__knap.home());
      rec(`train Home DPR ${dpr}: ${((await pxPerUnit(page)) * PITCH).toFixed(2)} px per pitch`);
      for (const v of ['front', 'top', 'right']) {
        await page.evaluate((n) => window.__knap.setView(n), v);
        await page.evaluate(() => window.__knap.fit());
        await c.shot(`${N}-train-${v}-dpr${dpr}`);
      }

      await setModel(page, SIZES);
      await c.shot(`${N}-sizes-home-dpr${dpr}`);
      const sh = await page.evaluate(() => window.__knap.camera());
      await camAt(page, sh.target, sh.height * 2.5, sh.yaw, sh.pitch);
      rec(`sizes far DPR ${dpr}: ${((await pxPerUnit(page)) * PITCH).toFixed(2)} device px per tooth pitch, soft fade ${(await page.evaluate(`(${VP})().softFade()`)).toFixed(2)}`);
      await c.shot(`${N}-sizes-far-dpr${dpr}`);
      await camAt(page, [21, 0, 7], 6.5);
      await c.shot(`${N}-sizes-close-dpr${dpr}`);

      await setModel(page, GROUND);
      const st = await page.evaluate(() => window.__knap.getState());
      assert(st.ground === true, 'ground model has the ground on');
      await c.shot(`${N}-ground-home-dpr${dpr}`);

      await setModel(page, SIDE);
      await c.shot(`${N}-side-home-dpr${dpr}`);
      await page.evaluate(() => window.__knap.setView('front'));
      await page.evaluate(() => window.__knap.fit());
      await c.shot(`${N}-side-front-dpr${dpr}`);
      const sd = await page.evaluate(() => window.__knap.camera());
      await camAt(page, sd.target, (PITCH * (await page.evaluate(`(${VP})().size.height`))) / 4, sd.yaw, sd.pitch);
      rec(`side far DPR ${dpr}: ${((await pxPerUnit(page)) * PITCH).toFixed(2)} device px per tooth pitch, soft fade ${(await page.evaluate(`(${VP})().softFade()`)).toFixed(2)}`);
      await c.shot(`${N}-side-far-dpr${dpr}`);
      if (c.errors.length) throw new Error(c.errors.join('; '));
      await c.close();
    }
  });

  // ---------------------------------------------------------------- 3a. ink across zooms
  await step('ink in the tooth band across zooms (40-tooth gear vs r 2.5 wheel), DPR 1 and 2', async () => {
    const pitches = [20, 14, 10, 8, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2];
    for (const dpr of [1, 2]) {
      const c = await app(dpr);
      const { page } = c;
      const H = await page.evaluate(`(${VP})().size.height * (${VP})().size.pixelRatio`);
      const rows = [];
      for (const [label, m] of [['gear', ONE_GEAR], ['wheel', ONE_WHEEL]]) {
        await setModel(page, m);
        for (const p of pitches) {
          await camAt(page, [0, 0, 0], (PITCH * H) / p);
          const now = await inkOf(page, 1);
          const full = label === 'gear' ? await inkOf(page, 1, 1) : now;
          rows.push({ label, p, now, full });
        }
      }
      const g = rows.filter((r) => r.label === 'gear');
      const w = rows.filter((r) => r.label === 'wheel');
      const lines = [];
      const band = [];
      for (let i = 0; i < pitches.length; i++) {
        const b = g[i].now.density - w[i].now.density;
        const bFull = g[i].full.density - w[i].now.density;
        band.push(b);
        lines.push(
          `${pitches[i].toFixed(1).padStart(4)} px/pitch  fade ${g[i].now.fade.toFixed(2)}  gear ${(g[i].now.density * 100).toFixed(1).padStart(5)} %  wheel ${(w[i].now.density * 100).toFixed(1).padStart(5)} %  band (gear − wheel) ${(b * 100).toFixed(1).padStart(5)} %  band without fade ${(bFull * 100).toFixed(1).padStart(5)} %  footprint ${g[i].now.foot} px`,
        );
      }
      rec(`ink density (ink px / footprint px) at DPR ${dpr}:\n      ${lines.join('\n      ')}`);
      // The fade must never make the band darker than it is at full strength: every zoom below
      // SOFT_FULL_PX has at most the band ink of the 6 px zoom (and of every closer zoom's max).
      const i6 = pitches.indexOf(6);
      const atFull = Math.max(...band.slice(0, i6 + 1));
      const worst = Math.max(...band.slice(i6 + 1));
      rec(`DPR ${dpr}: band ink max at ≥ 6 px/pitch ${(atFull * 100).toFixed(1)} %, max below ${(worst * 100).toFixed(1)} %; at Home-like 14 px ${(band[1] * 100).toFixed(1)} %`);
      assert(worst <= atFull + 0.005, `DPR ${dpr}: the tooth band is never darker below 6 px/pitch than at full strength (${(worst * 100).toFixed(1)} % vs ${(atFull * 100).toFixed(1)} %)`);
      // gone at ≤ 3 px: the gear is no darker than the wheel by more than its toothed silhouette
      const i3 = pitches.indexOf(3);
      for (let i = i3; i < pitches.length; i++) assert(g[i].now.fade === 0, `fade 0 at ${pitches[i]} px/pitch`);
      await c.close();
    }
  });

  // ---------------------------------------------------------------- 3b. orbit stability
  await step('ink stability under 0.25° orbit steps on the train', async () => {
    // Home, and a far zoom at 4.5 device px per tooth pitch (soft fade 0.5)
    for (const [label, cssPx] of [['Home', 0], ['far (fade < 1)', 4.5]]) {
      const c = await app(1, { width: 900, height: 600 });
      const { page } = c;
      await setModel(page, TRAIN);
      await page.evaluate(`(${VP})().setGridVisible(false)`);
      const base = await page.evaluate(() => window.__knap.camera());
      const counts = [];
      for (let i = 0; i < 12; i++) {
        const height = cssPx ? (PITCH * (await page.evaluate(`(${VP})().size.height`))) / cssPx : base.height;
        await page.evaluate((s) => window.__knap.setCamera(s), { ...base, height, yaw: base.yaw + (i * 0.25 * Math.PI) / 180 });
        counts.push(
          await page.evaluate(`(() => {
            const vp = (${VP})(); vp.renderNow();
            const gl = vp.renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
            const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
            let ink = 0; for (let i = 0; i < px.length; i += 4) if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 70) ink++;
            return ink; })()`),
        );
      }
      const fade = await page.evaluate(`(${VP})().softFade()`);
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const maxStep = Math.max(...counts.slice(1).map((v, i) => Math.abs(v - counts[i]) / mean));
      rec(`orbit ${label} (fade ${fade.toFixed(2)}): ink px ${counts.join(' ')}; max step ${(maxStep * 100).toFixed(2)} %`);
      assert(maxStep < 0.04, `train ink changes smoothly under orbit at ${label} (max step ${(maxStep * 100).toFixed(2)} %)`);
      await c.close();
    }
  });

  // ---------------------------------------------------------------- 3c. frame time
  await step('frame time: train vs plain wheels of similar triangle count, 1280×720', async () => {
    const c = await app(1);
    const { page } = c;
    const res = {};
    for (const [label, m] of [['wheels', WHEELS], ['train', TRAIN], ['wheels', WHEELS], ['train', TRAIN]]) {
      await setModel(page, m);
      // ms per synchronous render, GPU-synchronised by a 1-px readback (as view-demo benchmark)
      const t = await page.evaluate(`(() => {
        const vp = (${VP})(); const gl = vp.renderer.getContext(); const px = new Uint8Array(4); const out = [];
        vp.renderNow(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let i = 0; i < 15; i++) { const t0 = performance.now(); vp.renderNow(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(performance.now() - t0); }
        return out; })()`);
      t.sort((a, b) => a - b);
      (res[label] ??= []).push({ median: t[Math.floor(t.length / 2)] });
    }
    const med = (l) => Math.min(...res[l].map((r) => r.median));
    rec(`frame time (SwiftShader, best of 2 medians of 15 synchronous renders + 1-px readback): train ${med('train').toFixed(1)} ms, 4 plain r 2.5 wheels ${med('wheels').toFixed(1)} ms; ratio ${(med('train') / med('wheels')).toFixed(2)}`);
    await c.close();
  });

  // ---------------------------------------------------------------- 3d. contact shadow, 4. overlays
  await step('contact shadow under gears on the ground', async () => {
    const c = await app(1);
    const { page } = c;
    await setModel(page, GROUND);
    await page.evaluate(() => window.__knap.renderTiming(1));
    const under24 = await page.evaluate(() => window.__knap.groundShadowAt(0, 0));
    const under40 = await page.evaluate(() => window.__knap.groundShadowAt(6, 0));
    const away = await page.evaluate(() => window.__knap.groundShadowAt(30, 30));
    const fl = await page.evaluate(() => window.__knap.floor());
    rec(`ground: floor y ${fl?.y}; shadow under the standing 24 ${under24?.toFixed(3)}, under the flat 40 (1.1 up) ${under40?.toFixed(3)}, far away ${away?.toFixed(3)}`);
    assert(under24 > 0.5 && under40 > 0.15 && under40 < under24 && (away ?? 0) < 0.02, 'contact shadow: dark under the gear touching the floor, fainter under the raised one, none far away');
    await camAt(page, [3, -0.5, 0], 9, Math.PI / 4, 0.5);
    await c.shot(`${N}-ground-close-dpr1`);
    await c.close();
  });

  await step('overlays on gears: ghost, hover face, erase cell, band ring, tint, selection, glyphs', async () => {
    for (const dpr of [1, 2]) {
      const c = await app(dpr);
      const { page } = c;
      await setModel(page, TRAIN);
      await camAt(page, [2.5, 0, 0], 9);
      const vpEval = (body) => page.evaluate(`(() => { const vp = (${VP})(); ${body} })()`);
      // ghost of a toothed disc (valid / invalid) + hover face on the gear
      await vpEval(`vp.setGhost({ cell: { x: 5, y: 0, z: 3, kind: 'axleHole', axis: 2, rim: 1.5, teeth: true }, valid: true });
        vp.setHoverFace({ cell: [0, 0, 0], dir: 4 }); vp.renderNow();`);
      await c.shot(`${N}-overlay-ghost-dpr${dpr}`);
      await vpEval(`vp.setGhost({ cell: { x: 0, y: 0, z: 0, kind: 'axleHole', axis: 2, rim: 2.5, teeth: true }, extra: [], valid: false, over: '#e0b43c' });
        vp.setHoverFace(null); vp.renderNow();`);
      await c.shot(`${N}-overlay-ghost-over-dpr${dpr}`);
      // erase: the band ring a click removes (40 → 24: r 1.5 … tip of 2.5) and an erase cell on the 8
      await vpEval(`vp.setGhost(null); vp.setHoverRing({ hub: [0, 0, 0], axis: 2, r0: 1.5, r1: 2.5 + 3 / 32, over: '#e0b43c' });
        vp.setHoverCell({ cell: [3, 0, 0], over: '#c8433a' }); vp.renderNow();`);
      await c.shot(`${N}-overlay-erase-dpr${dpr}`);
      // kinematics: tint + joint and mesh glyphs; selection on the 24
      await vpEval(`vp.setHoverRing(null); vp.setHoverCell(null);
        vp.setPartColors(new Map([[1, '#5f6468'], [2, '#c8433a'], [3, '#3b74c4']]));
        vp.setMeshGlyphs(${JSON.stringify(TRAIN_MESHES)}); vp.setGlyphsVisible(true); vp.setSelection([3]); vp.renderNow();`);
      await c.shot(`${N}-overlay-kinematics-dpr${dpr}`);
      await page.evaluate(() => window.__knap.home());
      await c.shot(`${N}-overlay-kinematics-home-dpr${dpr}`);
      // the glyph follows simulated transforms: turn the train's gears and shift part 3 (it stays between the hubs)
      const q = [0, 0, Math.sin(0.3), Math.cos(0.3)];
      await page.evaluate((qq) => window.__knap.setPartTransform(1, [0, 0, 0], qq), q);
      await c.shot(`${N}-overlay-kinematics-turned-dpr${dpr}`);
      if (c.errors.length) throw new Error(c.errors.join('; '));
      await c.close();
    }
  });

  await writeFile(join(OUT_DIR, `${N}-report.txt`), report.join('\n') + '\n');
  log(`report in ${join(OUT_DIR, `${N}-report.txt`)}`);
  void dirname;
}
