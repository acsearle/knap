// Final verifier: arrow keys on a focused speed/friction button must not move the selected part.
import { preview } from 'vite';
import { ROOT, freePort, launchBrowser, openPage } from './lib.mjs';
import { openApp, frames } from './app-lib.mjs';

const port = await freePort();
const srv = await preview({ root: ROOT, logLevel: 'warn', build: { outDir: 'e2e/out/final-friction-dist' }, preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
const url = `http://127.0.0.1:${port}/`;
const browser = await launchBrowser();
try {
  const ctx = await openPage(browser, url, 'keys');
  const { page } = ctx;
  await openApp(page, url);
  await page.evaluate(() => window.__knap.loadExample('pendulum'));
  await frames(page, 2);
  // select part 2 via api if available, else click on it
  const p = await page.evaluate(() => window.__knap.partScreenPos(2));
  await page.mouse.click(p.x, p.y);
  await frames(page, 2);
  const s0 = await page.evaluate(() => window.__knap.getState());
  const m0 = await page.evaluate(() => JSON.stringify(window.__knap.getModel()));
  await page.focus('[data-friction=low]');
  for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight']) await page.keyboard.press(k);
  const focused = await page.evaluate(() => document.activeElement?.dataset?.friction ?? document.activeElement?.textContent);
  const s1 = await page.evaluate(() => window.__knap.getState());
  const m1 = await page.evaluate(() => JSON.stringify(window.__knap.getModel()));
  console.log('selection', JSON.stringify(s0.selection), 'history', s0.historySize, '->', s1.historySize, 'model same', m0 === m1, 'friction', s1.friction, 'focused', focused);
  await page.keyboard.press('Space');
  console.log('after Space friction', (await page.evaluate(() => window.__knap.getState())).friction);
  await page.focus('[data-friction=low]');
  // speed seg
  const sp = await page.$$('.seg button');
  console.log('seg buttons', sp.length, 'errors', ctx.errors);
} finally {
  await browser.close();
  await new Promise((r) => srv.httpServer.close(() => r()));
}
