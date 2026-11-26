// Reviewer verify-ui: chase the app-files flake ("a corrupt file shows an error and changes
// nothing" timed out waiting for the file chooser after Meta+O). Replays the app-files sequence up
// to that step N times in fresh pages, with page-side instrumentation (keydown seen? user
// activation at keydown? input.click() called? chooser intercepted?) and a 10 s chooser timeout.
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-flake.mjs <runs> [label]
import { launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp, press } from './app-lib.mjs';

const RUNS = +(process.argv[2] ?? 20);
const LABEL = process.argv[3] ?? '';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const server = await startServer();
const browser = await launchBrowser();
const log = (...a) => console.log(...a);
let fails = 0, opens = 0;
const t0 = Date.now();
const times = [];
try {
  for (let run = 0; run < RUNS; run++) {
    const ctx = await openPage(browser, server.url, 'flake');
    const { page } = ctx;
    await page.addInitScript(() => {
      window.__diag = [];
      window.addEventListener('keydown', (e) => {
        if (e.key === 'o' || e.key === 'O') window.__diag.push(`keydown o meta=${e.metaKey} ctrl=${e.ctrlKey} act=${navigator.userActivation?.isActive} target=${e.target?.tagName}${e.target?.dataset?.action ? '[' + e.target.dataset.action + ']' : ''} focus=${document.activeElement?.tagName}${document.activeElement?.dataset?.action ? '[' + document.activeElement.dataset.action + ']' : ''} t=${performance.now().toFixed(0)}`);
      }, true);
      const orig = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type === 'file') window.__diag.push(`input.click act=${navigator.userActivation?.isActive} t=${performance.now().toFixed(0)}`);
        return orig.call(this);
      };
    });
    try {
      await openApp(page, server.url);
      const [dl] = await Promise.all([page.waitForEvent('download'), press(page, '[data-action=save]')]);
      const saved = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
      await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
      await press(page, '[data-action=new]');
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
      await chooser.setFiles({ name: 'my-linkage.knap.json', mimeType: 'application/json', buffer: Buffer.from(saved) });
      await page.waitForFunction(() => window.__knap.getModel().parts.length > 0);
      await frames(page, 2);
      await page.keyboard.press(`${MOD}+z`);
      await page.keyboard.press(`${MOD}+z`);
      for (const [name, text] of [
        ['broken.knap.json', '{"version":1,"parts":[{"id":1,'],
        ['invalid.knap.json', JSON.stringify({ version: 1, parts: [{ id: 1, color: '#ff0000', cells: [{ x: 0, y: 0, z: 0, kind: 'pin', axis: 2 }, { x: 0, y: 0, z: 0, kind: 'pin', axis: 2 }] }], rootPartId: null, nextPartId: 2 })],
      ]) {
        await page.evaluate(() => (window.__diag.length = 0));
        if (process.env.FLAKE_DELAY) await page.waitForTimeout(+process.env.FLAKE_DELAY);
        const tk = Date.now();
        let chooser;
        try {
          [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.keyboard.press(`${MOD}+o`)]);
        } catch (e) {
          fails++;
          const diag = await page.evaluate(() => window.__diag);
          const st = await page.evaluate(() => ({ mode: window.__knap.getState().mode, banner: window.__knap.getState().banner, active: document.activeElement?.outerHTML.slice(0, 80), hidden: document.hidden, focus: document.hasFocus() }));
          log(`run ${run} ${name}: NO CHOOSER in 10 s. diag ${JSON.stringify(diag)} state ${JSON.stringify(st)}`);
          await ctx.shot(`review-m7-flake-fail-${run}`);
          break;
        }
        times.push(Date.now() - tk);
        opens++;
        await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
        await page.waitForFunction(() => window.__knap.getState().banner !== '');
        await press(page, '[data-role=banner] button');
      }
    } catch (e) {
      log(`run ${run}: other error ${e.message.split('\n')[0]}`);
      fails++;
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
times.sort((a, b) => a - b);
log(`FLAKE ${LABEL}: ${RUNS} runs, ${opens} choosers opened by ${MOD}+O, ${fails} failures; chooser latency median ${times[times.length >> 1]} ms, max ${times.at(-1)} ms; wall ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(0);
