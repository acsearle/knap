// Shared helpers for the "sim" review scripts (e2e/review-sim-*.mjs; not part of `npm run e2e`).
// Builds the app into e2e/out/review-sim-dist (so it never touches dist/), serves it with vite
// preview, opens it in headless Chromium (SwiftShader). Screenshots: e2e/out/review-sim-*.png.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, preview } from 'vite';
import { OUT_DIR, ROOT, freePort, launchBrowser, openPage } from './lib.mjs';
import { openApp } from './app-lib.mjs';

export { OUT_DIR };

export async function harness({ noBuild = !!process.env.REVIEW_SIM_NO_BUILD } = {}) {
  const outDir = join(OUT_DIR, 'review-sim-dist');
  if (!noBuild) await build({ root: ROOT, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  const port = await freePort();
  const server = await preview({ root: ROOT, logLevel: 'warn', build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
  const url = `http://127.0.0.1:${port}/`;
  const browser = await launchBrowser();
  const opened = [];
  async function open(name = 'review-sim', viewport = {}) {
    const c = await openPage(browser, url, name, viewport);
    opened.push(c);
    // No autosave carry-over between pages: every context is fresh anyway.
    await openApp(c.page, url);
    return c;
  }
  async function done() {
    for (const c of opened) await c.close().catch(() => {});
    await browser.close();
    await new Promise((res) => server.httpServer.close(() => res(undefined)));
  }
  return { url, browser, open, done };
}

export const MODELS = () => JSON.parse(readFileSync(join(OUT_DIR, 'review-sim-models.json'), 'utf8'));

export const results = [];
export function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

/** Screenshot of the 3D view element only, as a PNG buffer (optionally saved). */
export async function viewShot(page, file) {
  const box = await page.locator('[data-role=viewport]').boundingBox();
  const buf = await page.screenshot({ clip: box, ...(file ? { path: join(OUT_DIR, `${file}.png`) } : {}) });
  return buf;
}

/**
 * Pixel diff of two PNG buffers (decoded in the page). Returns {n, w, h, bbox, maxd}; with
 * `diffFile`, writes a PNG where differing pixels are red over a faded copy of a.
 */
export async function pixelDiff(page, a, b, { thresh = 8, diffFile } = {}) {
  const r = await page.evaluate(
    async ([a64, b64, thresh, wantImg]) => {
      const dec = async (s) => {
        const blob = await (await fetch(`data:image/png;base64,${s}`)).blob();
        const bm = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bm.width, bm.height);
        const g = c.getContext('2d');
        g.drawImage(bm, 0, 0);
        return g.getImageData(0, 0, bm.width, bm.height);
      };
      const A = await dec(a64);
      const B = await dec(b64);
      if (A.width !== B.width || A.height !== B.height) return { n: -1 };
      const w = A.width, h = A.height;
      let n = 0, maxd = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      const out = new ImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const d = Math.max(Math.abs(A.data[4 * i] - B.data[4 * i]), Math.abs(A.data[4 * i + 1] - B.data[4 * i + 1]), Math.abs(A.data[4 * i + 2] - B.data[4 * i + 2]));
        maxd = Math.max(maxd, d);
        const on = d > thresh;
        if (on) {
          n++;
          const x = i % w, y = (i / w) | 0;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
        out.data[4 * i] = on ? 255 : 128 + (A.data[4 * i] >> 1);
        out.data[4 * i + 1] = on ? 0 : 128 + (A.data[4 * i + 1] >> 1);
        out.data[4 * i + 2] = on ? 0 : 128 + (A.data[4 * i + 2] >> 1);
        out.data[4 * i + 3] = 255;
      }
      let img = null;
      if (wantImg) {
        const c = new OffscreenCanvas(w, h);
        c.getContext('2d').putImageData(out, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/png' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        img = btoa(s);
      }
      return { n, w, h, maxd, bbox: n ? [x0, y0, x1, y1] : null, img };
    },
    [a.toString('base64'), b.toString('base64'), thresh, !!diffFile],
  );
  if (diffFile && r.img) writeFileSync(join(OUT_DIR, `${diffFile}.png`), Buffer.from(r.img, 'base64'));
  delete r.img;
  return r;
}

/** Rotate v by quaternion q = [x,y,z,w] and translate by p. */
export function applyT(t, v) {
  const [x, y, z, w] = t.q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty) + t.p[0], vy + w * ty + (z * tx - x * tz) + t.p[1], vz + w * tz + (x * ty - y * tx) + t.p[2]];
}

/**
 * In-page: for every joint of the analysed graph, the screen-space separation (px) of the joint
 * origin carried by a part of body A and by a part of body B, and the same for a second point one
 * unit along the joint axis (pin tilt). Uses only the test hook.
 */
export async function jointScreenErrors(page) {
  return page.evaluate(() => {
    const k = window.__knap;
    const a = k.analyze();
    const T = k.simTransforms();
    const partOf = {};
    for (const [pid, b] of Object.entries(a.bodyOfPart)) if (partOf[b] === undefined) partOf[b] = Number(pid);
    const ap = (t, v) => {
      const [x, y, z, w] = t.q;
      const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
      return [v[0] + w * tx + (y * tz - z * ty) + t.p[0], v[1] + w * ty + (z * tx - x * tz) + t.p[1], v[2] + w * tz + (x * ty - y * tx) + t.p[2]];
    };
    return a.jointList.map((j) => {
      const ta = T[partOf[j.bodyA]];
      const tb = T[partOf[j.bodyB]];
      if (!ta || !tb) return { joint: `${j.bodyA}-${j.bodyB}`, removed: true };
      const o2 = [...j.origin];
      o2[j.axis] += 1;
      const res = {};
      for (const [key, o] of [['px', j.origin], ['px2', o2]]) {
        const sa = k.screenPos(ap(ta, o));
        const sb = k.screenPos(ap(tb, o));
        res[key] = Math.hypot(sa.x - sb.x, sa.y - sb.y);
      }
      // For sliding joints only the perpendicular part matters; report raw and let the caller decide.
      return { joint: `${j.bodyA}-${j.bodyB}`, type: j.type, ...res };
    });
  });
}

/** Tile PNG buffers (scaled by `scale`, `cols` per row, with labels) into one PNG file. */
export async function montage(page, bufs, labels, file, { cols = 4, scale = 0.5 } = {}) {
  const b64 = await page.evaluate(
    async ([list, labels, cols, scale]) => {
      const bms = [];
      for (const s of list) bms.push(await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob()));
      const w = Math.round(bms[0].width * scale), h = Math.round(bms[0].height * scale);
      const rows = Math.ceil(bms.length / cols);
      const c = new OffscreenCanvas(w * Math.min(cols, bms.length), h * rows);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      bms.forEach((bm, i) => {
        const x = (i % cols) * w, y = Math.floor(i / cols) * h;
        g.drawImage(bm, x, y, w, h);
        g.strokeStyle = '#888';
        g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        g.fillStyle = '#000';
        g.font = '14px sans-serif';
        g.fillText(labels[i] ?? '', x + 6, y + 18);
      });
      const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [bufs.map((b) => b.toString('base64')), labels, cols, scale],
  );
  writeFileSync(join(OUT_DIR, `${file}.png`), Buffer.from(b64, 'base64'));
  console.log(`  montage e2e/out/${file}.png`);
}
