// e2e runner: `npm run e2e [-- name ...]`. See e2e/lib.mjs for how to write scripts.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, buildApp, launchBrowser, openPage, startServer } from './lib.mjs';

const dir = join(ROOT, 'e2e');
const wanted = process.argv.slice(2);
const all = (await readdir(dir)).filter((f) => f.endsWith('.e2e.mjs')).sort();
const scripts = wanted.length
  ? wanted.map((w) => {
      const f = w.endsWith('.e2e.mjs') ? w : `${w}.e2e.mjs`;
      if (!all.includes(f)) throw new Error(`no such e2e script: e2e/${f}`);
      return f;
    })
  : all;

if (!process.env.E2E_NO_BUILD) {
  console.log('e2e: building…');
  await buildApp();
}
const server = await startServer();
const browser = await launchBrowser();
console.log(`e2e: serving ${server.url}`);

let failed = 0;
try {
  for (const file of scripts) {
    const name = file.replace(/\.e2e\.mjs$/, '');
    console.log(`e2e: ${name}`);
    const ctx = await openPage(browser, server.url, name);
    try {
      const mod = await import(pathToFileURL(join(dir, file)).href);
      await mod.default(ctx);
      if (ctx.errors.length) throw new Error(`page errors:\n    ${ctx.errors.join('\n    ')}`);
      console.log(`e2e: ${name} PASS`);
    } catch (err) {
      failed++;
      console.error(`e2e: ${name} FAIL\n  ${err instanceof Error ? err.stack ?? err.message : err}`);
      try {
        await ctx.shot(`${name}-FAILED`);
      } catch {
        /* ignore */
      }
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`e2e: ${scripts.length - failed}/${scripts.length} passed`);
process.exit(failed ? 1 : 0);
