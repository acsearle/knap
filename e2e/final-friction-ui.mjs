// Final verifier's own UI probe (not part of the suite): node e2e/final-friction-ui.mjs [--no-build]
// Builds into e2e/out/final-friction-dist and serves that.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build, preview } from 'vite';
import { ROOT, OUT_DIR, freePort, launchBrowser, openPage } from './lib.mjs';
import { openApp, frames } from './app-lib.mjs';

const OUT = 'e2e/out/final-friction-dist';
if (!process.argv.includes('--no-build')) await build({ root: ROOT, logLevel: 'warn', build: { outDir: OUT, emptyOutDir: true } });
const port = await freePort();
const srv = await preview({ root: ROOT, logLevel: 'warn', build: { outDir: OUT }, preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
const url = `http://127.0.0.1:${port}/`;
const browser = await launchBrowser();
const log = (...a) => console.log(...a);
const marked = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-friction]')).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.friction));
const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const st = (page) => page.evaluate(() => window.__knap.getState());

try {
  // ---- 1280x720: default, persistence, live change, undo/file, top bar shot
  const ctx = await openPage(browser, url, 'final', { width: 1280, height: 720 });
  const { page } = ctx;
  await openApp(page, url);
  log('fresh default friction:', (await st(page)).friction, 'marked:', await marked(page), 'pref:', await page.evaluate(() => localStorage.getItem('knap.pref.jointFriction')));
  log('control texts:', await page.evaluate(() => document.querySelector('[data-role=friction]').innerText.replace(/\n/g, ' | ')));
  await page.evaluate(() => window.__knap.loadExample('pendulum'));
  await frames(page, 3);
  const h0 = await st(page);
  const m0 = await page.evaluate(() => JSON.stringify(window.__knap.getModel()));
  await page.click('[data-friction=low]');
  await frames(page, 2);
  const h1 = await st(page);
  log('after clicking Low: friction', h1.friction, 'marked', await marked(page), 'historySize', h0.historySize, '->', h1.historySize, 'canUndo', h0.canUndo, '->', h1.canUndo, 'model same', m0 === (await page.evaluate(() => JSON.stringify(window.__knap.getModel()))), 'msg:', h1.message);
  await page.evaluate(() => window.__knap.flushAutosave?.());
  const auto = await page.evaluate(() => localStorage.getItem('knap.autosave.v1'));
  log('autosave mentions friction:', /friction/i.test(auto ?? ''));
  const dl = page.waitForEvent('download');
  await page.click('[data-action=save]');
  const d = await dl;
  const txt = await readFile(await d.path(), 'utf8');
  log('saved file mentions friction:', /friction|jointFriction|mu/i.test(txt), 'keys:', Object.keys(JSON.parse(txt)));
  await page.reload();
  await openApp(page, url);
  log('after reload: friction', (await st(page)).friction, 'marked', await marked(page));
  // undo after reload must not revert friction
  await page.keyboard.press('Control+z').catch(() => {});
  await page.keyboard.press('Meta+z').catch(() => {});
  log('after undo: friction', (await st(page)).friction);

  // live change while simulating
  await page.click('[data-friction=realistic]');
  await page.evaluate(() => window.__knap.loadExample('pendulum'));
  await frames(page, 2);
  await page.evaluate(() => window.__knap.stepSim(480)); // 1 s at realistic
  const amp = async (sec) => {
    let mx = 0;
    let prev = await page.evaluate(() => window.__knap.simTransforms());
    const first = prev;
    for (let i = 0; i < sec * 10; i++) {
      await page.evaluate(() => window.__knap.stepSim(48));
      const t = await page.evaluate(() => window.__knap.simTransforms());
      for (const id of Object.keys(t)) if (t[id] && first[id]) mx = Math.max(mx, ang(prev[id].q, t[id].q));
      prev = t;
    }
    return mx / 0.1; // rad/s max over 0.1 s windows
  };
  log('sim jointFriction (realistic):', (await page.evaluate(() => window.__knap.simInfo())).jointFriction);
  const r1 = await amp(1);
  log('realistic t=1..2 s max ang speed (rad/s):', r1.toFixed(3));
  await page.click('[data-friction=off]');
  const sOff = await page.evaluate(() => window.__knap.simInfo());
  log('after clicking Off while simulating: jointFriction', sOff.jointFriction, 'mode', (await st(page)).mode, 't', sOff.time.toFixed(3));
  const r2 = await amp(4);
  log('off t=2..6 s max ang speed:', r2.toFixed(3));
  const r2b = await amp(1);
  log('off t=6..7 s max ang speed (should stay high, no friction):', r2b.toFixed(3));
  await page.click('[data-friction=realistic]');
  log('after clicking Real: jointFriction', (await page.evaluate(() => window.__knap.simInfo())).jointFriction);
  const r3 = await amp(6);
  const r4 = await amp(1);
  log('realistic t=7..13 max', r3.toFixed(3), 't=13..14 max (should be ~0):', r4.toFixed(4));
  await page.evaluate(() => window.__knap.setMode('edit'));
  await frames(page, 2);
  await ctx.shot('final-friction-topbar-1280', { clip: { x: 0, y: 0, width: 1280, height: 60 } });
  await ctx.shot('final-friction-full-1280');

  // ---- montage: pendulum at Realistic, every 0.5 s
  await page.evaluate(() => window.__knap.loadExample('pendulum'));
  await page.evaluate(() => { window.__knap.setView?.('front'); window.__knap.fit(); });
  await frames(page, 3);
  await page.evaluate(() => window.__knap.stepSim(0));
  await page.evaluate(() => window.__knap.fit());
  await frames(page, 3);
  const canvas = await page.evaluate(() => { const b = document.querySelector('canvas').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  const imgs = [];
  let restCount = 0;
  let prev = await page.evaluate(() => window.__knap.simTransforms());
  for (let k = 0; k <= 20; k++) {
    if (k > 0) await page.evaluate(() => window.__knap.stepSim(240));
    await frames(page, 2);
    const info = await page.evaluate(() => window.__knap.simInfo());
    const t = await page.evaluate(() => window.__knap.simTransforms());
    let mv = 0;
    for (const id of Object.keys(t)) if (t[id] && prev[id]) mv = Math.max(mv, ang(prev[id].q, t[id].q));
    prev = t;
    const buf = await page.screenshot({ clip: canvas });
    imgs.push({ t: info.time, mv, b64: buf.toString('base64') });
    log(`montage t=${info.time.toFixed(2)} moved since prev ${(mv * 180 / Math.PI).toFixed(3)}°`);
    if (k > 0 && mv < 1e-3) restCount++;
    if (restCount >= 2) break;
  }
  const mp = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const cols = 5;
  const w = Math.floor(1600 / cols);
  await mp.setContent(`<body style="margin:0;background:#fff;font:14px sans-serif"><div style="display:grid;grid-template-columns:repeat(${cols},${w}px)">${imgs.map((i) => `<div style="position:relative"><img style="width:${w}px" src="data:image/png;base64,${i.b64}"><div style="position:absolute;left:4px;top:4px;background:#ffe;padding:1px 4px">t=${i.t.toFixed(2)} s, Δ=${(i.mv * 180 / Math.PI).toFixed(2)}°</div></div>`).join('')}</div></body>`);
  await mp.screenshot({ path: join(OUT_DIR, 'final-friction-montage.png'), fullPage: true });
  await mp.close();
  await ctx.close();

  // ---- 1920x1080 @2x top bar while simulating
  const c2 = await openPage(browser, url, 'final2', { width: 1920, height: 1080, deviceScaleFactor: 2 });
  await openApp(c2.page, url);
  await c2.page.evaluate(() => window.__knap.loadExample('pendulum'));
  await c2.page.click('[data-action=play]');
  await frames(c2.page, 5);
  await c2.shot('final-friction-topbar-1920', { clip: { x: 0, y: 0, width: 1920, height: 60 } });
  log('1920 sim info', JSON.stringify(await c2.page.evaluate(() => window.__knap.simInfo())), 'errors', c2.errors);
  await c2.close();
  log('page errors 1280:', ctx.errors);
} finally {
  await browser.close();
  await new Promise((r) => srv.httpServer.close(() => r()));
}
