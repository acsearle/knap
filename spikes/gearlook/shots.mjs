// gearlook screenshots: node spikes/gearlook/shots.mjs [filter]
// Vite dev server (spikes/gearlook/vite.gearlook.config.mjs) + headless Chromium (SwiftShader).
// Writes e2e/out/gearlook-<name>.png.
import { createServer } from 'vite';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ROOT, OUT_DIR, freePort, launchBrowser } from '../../e2e/lib.mjs';
import cfg from './vite.gearlook.config.mjs';

export async function startServer() {
  const port = await freePort();
  const server = await createServer({ ...cfg, configFile: false, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  return { url: `http://127.0.0.1:${port}/spikes/gearlook/harness.html`, close: () => server.close() };
}

export async function open(browser, url, query, { w = 900, h = 600, dpr = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`${url}?${query}`);
  await page.waitForFunction(() => window.__ready || window.__err, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__err);
  if (err) throw new Error(err);
  return { page, ctx, errs };
}

const SHOTS = [
  // name, query, opts
  ['train-home', 'scene=beam'],
  ['train-home-dpr2', 'scene=beam', { dpr: 2 }],
  ['train-far', 'scene=beam&zoom=0.35'],
  ['train-home-band', 'scene=beam&treat=band'],
  ['train-home-band-nofb', 'scene=beam&treat=band&fallback=0'],
  ['train-home-flat-nofb', 'scene=beam&treat=flat&fallback=0'],
  ['train-home-sine', 'scene=beam&kind=sine'],
  ['train-home-trap', 'scene=beam&kind=trapezoid'],
  ['train-home-draw20', 'scene=beam&draw=20'],
  ['train-home-ch', 'scene=beam&chamfer=0.03'],
  ['train-home-mark-holes', 'scene=beam&mark=1&holes=1'],
  ['train-front', 'scene=beam&view=front&mark=1&holes=1'],
  ['train-top-edge', 'scene=beam&view=top&mark=1&holes=1'],
  ['pair-close', 'scene=pair&sizes=0.5,1.5&zoom=1.6&mark=1'],
  ['pair-close-front', 'scene=pair&sizes=0.5,1.5&zoom=1.6&view=front&mark=1'],
  ['pair-close-sine', 'scene=pair&sizes=0.5,1.5&zoom=1.6&kind=sine&mark=1'],
  ['pair-close-band-nofb', 'scene=pair&sizes=0.5,1.5&zoom=1.6&treat=band&fallback=0&mark=1'],
  ['pair-diag', 'scene=pair&sizes=2.5,2.5&diag=1&view=front&zoom=3&holes=1'],
  ['single40-closeup', 'scene=single&r=2.5&zoom=3.5&mark=1&holes=1'],
  ['single40-closeup-dpr2', 'scene=single&r=2.5&zoom=3.5&mark=1&holes=1', { dpr: 2 }],
  ['sizes-home', 'scene=sizes&mark=1&holes=1'],
  ['sizes-colors-dark', 'scene=sizes&mark=1&holes=1&colors=%235f6468,%233b74c4,%23c8433a,%234c9a57'],
  ['sizes-colors-light', 'scene=sizes&mark=1&holes=1&colors=%23e8e8e4,%23e0b43c,%23a8adb2,%23e07b2e'],
  ['sizes-thin', 'scene=sizes&mark=1&holes=1&bandH=0.3'],
];

async function main() {
  const filter = process.argv[2];
  mkdirSync(OUT_DIR, { recursive: true });
  const srv = await startServer();
  const browser = await launchBrowser();
  const stats = {};
  try {
    for (const [name, query, opts] of SHOTS) {
      if (filter && !name.includes(filter)) continue;
      const t0 = Date.now();
      const { page, ctx, errs } = await open(browser, srv.url, query, opts);
      await page.waitForTimeout(150);
      const path = join(OUT_DIR, `gearlook-${name}.png`);
      await page.screenshot({ path });
      stats[name] = await page.evaluate(() => ({ gears: window.__gearStats, vp: window.__vp.stats() }));
      console.log(`${name}: ${Date.now() - t0} ms ${errs.length ? 'ERR ' + errs.join(' | ') : ''}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  writeFileSync(join(ROOT, 'spikes/gearlook/out', `shots-stats${filter ? '-' + filter : ''}.json`), JSON.stringify(stats, null, 1));
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
