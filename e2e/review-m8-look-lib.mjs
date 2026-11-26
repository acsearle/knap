// Reviewer "look" (milestone 8, gears): shared helpers. Build once with
//   E2E_DIST=e2e/out/review-m8-look-dist node spikes/review-m8/look/build.mjs
// then run e.g.  E2E_DIST=e2e/out/review-m8-look-dist node e2e/review-m8-look-static.mjs
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR, launchBrowser, openPage, startServer } from './lib.mjs';
import { frames } from './app-lib.mjs';

export { frames };
export const PAL = ['#e0b43c', '#e07b2e', '#c8433a', '#4c9a57', '#3b74c4', '#e8e8e4', '#a8adb2', '#5f6468'];
export const PAL_NAMES = ['yellow', 'orange', 'red', 'green', 'blue', 'white', 'lgrey', 'dgrey'];
export const ISO = Math.atan(1 / Math.SQRT2);
export const R = [0.5, 1, 1.5, 2.5];
export const T = { 0.5: 8, 1: 16, 1.5: 24, 2.5: 40 };

export const cell = (x, y, z, kind = 'pinHole', axis = 2, rim, teeth) => ({ x, y, z, kind, axis, ...(rim !== undefined ? { rim } : {}), ...(teeth ? { teeth: true } : {}) });
export const gear = (x, y, z, axis, r, kind = 'axleHole') => cell(x, y, z, kind, axis, r, true);
export const model = (parts, extra = {}) => ({
  version: 3,
  rootPartId: 1,
  nextPartId: parts.length + 1,
  ...extra,
  parts: parts.map((p, i) => ({ id: i + 1, color: p.color ?? '#a8adb2', cells: p.cells ?? p })),
});

export const K = (page, fn, arg) => page.evaluate(fn, arg);
export async function setModel(page, m) {
  await K(page, (m) => window.__knap.setModel(m), m);
  const got = await K(page, () => window.__knap.getModel());
  if (got.parts.length !== m.parts.length) throw new Error(`setModel kept ${got.parts.length} of ${m.parts.length} parts: ${JSON.stringify(m)}`);
  await frames(page, 2);
  return got;
}
export const setCam = (page, c) => K(page, (c) => window.__knap.setCamera(c), c);
export const cam = (page) => K(page, () => window.__knap.camera());

/** Camera looking along a grid axis (0 X, 1 Y, 2 Z) from its + side, at `target`. */
export function axisCam(axis, target, height, tilt = 0) {
  if (axis === 2) return { target, height, yaw: tilt, pitch: 0 };
  if (axis === 0) return { target, height, yaw: Math.PI / 2 + tilt, pitch: 0 };
  return { target, height, yaw: 0, pitch: Math.PI / 2 - 1e-4 - tilt };
}

const VP = `document.querySelector('canvas.kv-canvas').__knapViewport`;

/** Device-px box (CSS px) of the union of the parts' world boxes, padded; for screenshot clips. */
export function partsClip(page, ids, pad = 12) {
  return page.evaluate(
    `(() => { const vp = ${VP}; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; const r = vp.canvas.getBoundingClientRect();
      for (const id of ${JSON.stringify(ids)}) { const b = vp.partBox(id); if (!b) continue;
        for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
          const p = vp.project([x, y, z]); x0 = Math.min(x0, p.clientX); x1 = Math.max(x1, p.clientX); y0 = Math.min(y0, p.clientY); y1 = Math.max(y1, p.clientY); } }
      x0 = Math.max(r.left, x0 - ${pad}); y0 = Math.max(r.top, y0 - ${pad}); x1 = Math.min(r.right, x1 + ${pad}); y1 = Math.min(r.bottom, y1 + ${pad});
      return { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) }; })()`,
  );
}

/** Client box of a world point ± half-size (CSS px). */
export function pointClip(page, p, halfCss) {
  return page.evaluate((a) => {
    const q = window.__knap.screenPos(a.p);
    return { x: Math.round(q.x - a.h), y: Math.round(q.y - a.h), width: 2 * a.h, height: 2 * a.h };
  }, { p, h: halfCss });
}

export async function snap(page, clip) {
  await frames(page, 3);
  return page.screenshot({ clip });
}

/** Compose labelled tiles into one PNG (native pixel size, no resampling). */
export async function sheet(browser, file, tiles, { cols = 4, title = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const html = `<html><body style="margin:0;background:#fff;font:12px sans-serif">
    ${title ? `<div style="padding:6px 8px;font-weight:bold">${title}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(${cols}, max-content);gap:6px;padding:6px">
    ${tiles.map((t) => `<div style="border:1px solid #ccc"><div style="padding:2px 4px;background:#eee">${t.label}</div><img style="display:block" src="data:image/png;base64,${t.buf.toString('base64')}"></div>`).join('')}
    </div></body></html>`;
  await page.setContent(html);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const path = join(OUT_DIR, file);
  await page.screenshot({ path, fullPage: true });
  await ctx.close();
  return path;
}

/** Start server + browser; `open(name, viewport)` gives a fresh app page. */
export async function session() {
  const server = await startServer();
  const browser = await launchBrowser();
  const ctxs = [];
  return {
    browser,
    async open(name, viewport = {}) {
      const ctx = await openPage(browser, server.url, name, viewport);
      ctxs.push(ctx);
      const { openApp } = await import('./app-lib.mjs');
      await openApp(ctx.page, server.url);
      await K(ctx.page, () => window.__knap.setGround && undefined);
      return ctx;
    },
    async close() {
      for (const c of ctxs) {
        if (c.errors.length) console.log(`PAGE ERRORS in ${c.page.url()}: ${c.errors.join(' | ')}`);
        await c.close().catch(() => {});
      }
      await browser.close();
      await server.close();
    },
  };
}

export const VPJS = VP;

/**
 * Ink measure in a screen annulus about a hub seen face-on: renders with and without the outline
 * composite. Returns per-region { ink (sum of coverage), area px, density, meanL (with ink) }.
 * regions: [{name, r0, r1}] in world units about world point `c`; `ppu` device px per unit.
 */
export function annulusInk(page, c, regions) {
  return page.evaluate(
    `(() => {
    const vp = ${VP};
    vp.setGridVisible(false); vp.setRootMarkerVisible(false);
    const gl = vp.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const read = () => { vp.renderNow(); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    vp.setOutlineDebug({ ink: false }); const off = read();
    vp.setOutlineDebug({ ink: true }); const on = read();
    const d = vp.size.pixelRatio;
    const p = vp.project(${JSON.stringify(c)});
    const cx = p.x * d, cy = p.y * d;
    const ppu = vp.size.height * d / vp.getCamera().height;
    const L = (a, i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const LINK = 0.299 * 0.12 * 255 + 0.587 * 0.125 * 255 + 0.114 * 0.135 * 255;
    const out = {};
    for (const g of ${JSON.stringify(regions)}) {
      let ink = 0, area = 0, sumL = 0, dark = 0;
      const R1 = g.r1 * ppu, R0 = g.r0 * ppu;
      for (let y = Math.max(0, Math.floor(cy - R1)); y <= Math.min(H - 1, Math.ceil(cy + R1)); y++)
        for (let x = Math.max(0, Math.floor(cx - R1)); x <= Math.min(W - 1, Math.ceil(cx + R1)); x++) {
          const rr = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (rr < R0 || rr > R1) continue;
          const i = ((H - 1 - y) * W + x) * 4;
          area++;
          const lo = L(off, i), ln = L(on, i);
          sumL += ln;
          if (ln < 80) dark++;
          if (lo - LINK > 20) ink += Math.min(1, Math.max(0, (lo - ln) / (lo - LINK)));
        }
      out[g.name] = { ink: +ink.toFixed(1), area, density: +(ink / Math.max(1, area)).toFixed(4), meanL: +(sumL / Math.max(1, area)).toFixed(1), dark: +(dark / Math.max(1, area)).toFixed(4) };
    }
    vp.setGridVisible(true); vp.setRootMarkerVisible(true);
    return { ppu, pitchPx: ppu * Math.PI / 8, fade: vp.softFade(), regions: out };
  })()`,
  );
}

/** Whole drawing buffer (with ink) as luminance Uint8 (base64), for step-to-step diffs. */
export function lumaBuffer(page) {
  return page.evaluate(
    `(() => { const vp = ${VP}; vp.renderNow(); const gl = vp.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight; const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) l[i] = (0.299 * px[4*i] + 0.587 * px[4*i+1] + 0.114 * px[4*i+2]) | 0;
      let s = ''; for (let i = 0; i < l.length; i += 0x8000) s += String.fromCharCode.apply(null, l.subarray(i, i + 0x8000));
      return { W, H, b64: btoa(s) }; })()`,
  );
}

export async function save(file, text) {
  await writeFile(join(OUT_DIR, file), text);
}
