// UX reviewer harness (reviewer "ux"). Builds the app once into a private dist directory (so the
// parallel reviewers' builds of dist/ do not interfere), serves it with vite preview, and opens
// pages. Scripts: e2e/review-ux-*.mjs, run with `node e2e/review-ux-<name>.mjs`.
// Screenshots go to e2e/out/review-ux-*.png. Set UX_REBUILD=1 to force a rebuild.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build, preview } from 'vite';
import { ROOT, freePort, launchBrowser, openPage } from './lib.mjs';
import { frames, openApp, settle } from './app-lib.mjs';

const OUT = 'e2e/out/review-ux-dist';

export async function startUx() {
  if (process.env.UX_REBUILD || !existsSync(join(ROOT, OUT, 'index.html'))) {
    await build({ root: ROOT, logLevel: 'warn', build: { outDir: OUT, emptyOutDir: true } });
  }
  const port = await freePort();
  const server = await preview({ root: ROOT, logLevel: 'warn', build: { outDir: OUT }, preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
  const url = `http://127.0.0.1:${port}/`;
  const browser = await launchBrowser();
  const findings = [];
  const notes = [];
  return {
    url,
    browser,
    findings,
    notes,
    /** Record a check: prints PASS/FAIL, collects failures. */
    check(cond, label, detail = '') {
      const line = `${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`;
      console.log(line);
      if (!cond) findings.push(line);
      return cond;
    },
    note(s) {
      console.log(`NOTE  ${s}`);
      notes.push(s);
    },
    async page(name, viewport = {}) {
      const ctx = await openPage(browser, url, name, viewport);
      return ctx;
    },
    async close() {
      await browser.close();
      await new Promise((res) => server.httpServer.close(() => res(undefined)));
      console.log(`\n==== ${findings.length} failing checks ====`);
      for (const f of findings) console.log(f);
    },
  };
}

/** Open a fresh app page with an empty localStorage, then New (empty model). */
export async function freshEmpty(page, url) {
  await openApp(page, url);
  await page.locator('[data-action=new]').click();
  await frames(page, 2);
  await settle(page);
}

export const st = (page) =>
  page.evaluate(() => ({
    hover: document.querySelector('[data-role=status-hover]')?.textContent ?? '',
    hint: document.querySelector('[data-role=status-hint]')?.textContent ?? '',
    aux: document.querySelector('[data-role=status-aux]')?.textContent ?? '',
    message: document.querySelector('[data-role=status-message]')?.textContent ?? '',
    error: document.querySelector('[data-role=status-message]')?.classList.contains('error') ?? false,
    invalid: document.querySelector('.st-hint')?.classList.contains('invalid') ?? false,
    counts: document.querySelector('[data-role=status-counts]')?.textContent ?? '',
  }));

export const parts = (m) => m.parts.map((p) => `${p.id}:[${p.cells.map((c) => `${c.kind}${'XYZ'[c.axis]}@${c.x},${c.y},${c.z}`).join(' ')}]`).join('  ');

/** Client point of a view-cube region (face [1,0,0], edge [1,1,0], corner [1,1,1]) from the current camera. */
export async function cubePoint(page, dir) {
  return page.evaluate((dir) => {
    const cam = window.__knap.camera();
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const back = [cp * sy, sp, cp * cy];
    const right = [cy, 0, -sy];
    const up = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
    const canvas = document.querySelector('[data-role=viewport] canvas');
    const r = canvas.getBoundingClientRect();
    const size = 112, margin = 10, F = 1.9;
    const rx = r.width - margin - size, ry = margin;
    let best = null, bf = 0.05;
    for (let k = 0; k < 3; k++) {
      if (!dir[k]) continue;
      const p = [0, 1, 2].map((j) => (j === k ? dir[j] : dir[j] * 0.8));
      const facing = dir[k] * back[k];
      if (facing <= bf) continue;
      const sx = (p[0] * right[0] + p[1] * right[1] + p[2] * right[2]) / F;
      const syy = (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) / F;
      best = { x: r.left + rx + ((sx + 1) / 2) * size, y: r.top + ry + ((1 - syy) / 2) * size };
      bf = facing;
    }
    return best;
  }, dir);
}

export function mk(page) {
  const out = {
    async log(label) {
      const s = await st(page);
      console.log(`-- ${label}\n   hover: ${s.hover}\n   hint: ${s.hint}${s.aux ? ` | aux: ${s.aux}` : ''}${s.invalid ? ' [INVALID]' : ''}\n   msg: ${s.message}${s.error ? ' [ERROR]' : ''}\n   counts: ${s.counts}`);
      return s;
    },
    async idOf(pos, kindRe) {
      const m = await page.evaluate(() => window.__knap.getModel());
      const p = m.parts.find((q) => q.cells.some((c) => c.x === pos[0] && c.y === pos[1] && c.z === pos[2] && kindRe.test(c.kind)));
      return p?.id;
    },
  };
  return out;
}
