// Iteration helper: node e2e/view-quick.mjs name 'query' [w h dpr] ...  -> e2e/out/view-q-<name>.png
// Several shots: pass groups separated by '--'.
import { join } from 'node:path';
import { OUT_DIR, launchBrowser, openPage } from './lib.mjs';
import { startDevServer } from './geom-gallery.mjs';

const args = process.argv.slice(2);
const groups = [];
let cur = [];
for (const a of args) { if (a === '--') { groups.push(cur); cur = []; } else cur.push(a); }
if (cur.length) groups.push(cur);
const server = await startDevServer();
const browser = await launchBrowser();
try {
  for (const [name, query, w, h, dpr] of groups) {
    const ctx = await openPage(browser, server.url, 'quick', { width: +(w ?? 900), height: +(h ?? 600), deviceScaleFactor: +(dpr ?? 1) });
    await ctx.page.goto(`${server.url}e2e/view-demo.html?${query}`);
    await ctx.page.waitForFunction(() => window.__view?.ready || window.__viewError, null, { timeout: 60000 });
    const err = await ctx.page.evaluate(() => window.__viewError);
    if (err) console.error(err);
    const path = join(OUT_DIR, `view-q-${name}.png`);
    await ctx.page.screenshot({ path });
    if (ctx.errors.length) console.error(ctx.errors.join('\n'));
    console.log(path);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
