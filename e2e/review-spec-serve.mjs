// Review (spec / deliverable): load the production build from a sub-path with a plain static
// server, via `vite preview`, and (optionally) the dev server, recording every network request.
// Checks: app becomes ready, no request leaves the page's origin, WASM loads, no console errors.
//
//   KNAP_ROOT=<project dir with dist/> DEV_URL=http://127.0.0.1:5199/ node e2e/review-spec-serve.mjs
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.KNAP_ROOT ?? join(HERE, '..'));
const DIST = join(ROOT, 'dist');
const OUT = join(HERE, 'out');
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };

function staticServer(prefix) {
  const served = [];
  const srv = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    served.push(u.pathname);
    if (!u.pathname.startsWith(prefix)) {
      res.writeHead(404).end('outside prefix');
      return;
    }
    let p = u.pathname.slice(prefix.length) || 'index.html';
    if (p.endsWith('/')) p += 'index.html';
    const f = join(DIST, p);
    try {
      await stat(f);
      res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
      res.end(await readFile(f));
    } catch {
      res.writeHead(404).end('nf');
    }
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, served, port: srv.address().port })));
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];

async function probe(label, url, shot) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const reqs = [];
  const errors = [];
  page.on('request', (r) => reqs.push(r.url()));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`failed ${r.url()}`));
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.body.dataset.ready === 'error', null, { timeout: 120000 });
  const ready = await page.evaluate(() => document.body.dataset.ready);
  const loadMs = Date.now() - t0;
  // exercise geometry (manifold WASM) and physics (rapier WASM)
  await page.evaluate(() => window.__knap.loadExample('collision'));
  await page.evaluate(() => window.__knap.stepSim(60));
  const sim = await page.evaluate(() => window.__knap.simInfo());
  await page.evaluate(() => window.__knap.setMode('edit'));
  if (shot) await page.screenshot({ path: join(OUT, `${shot}.png`) });
  const origin = new URL(url).origin;
  const foreign = reqs.filter((r) => !r.startsWith(origin) && !r.startsWith('data:') && !r.startsWith('blob:'));
  const text = await page.evaluate(() => document.body.innerText);
  results.push({ label, url, ready, loadMs, requests: reqs.map((r) => r.replace(origin, '')), foreign, errors, simTime: sim?.time, brandInUI: /LEGO|Technic/i.test(text) });
  await ctx.close();
}

// 1. static server, sub-path
const s = await staticServer('/some/sub/path/');
await probe('static sub-path', `http://127.0.0.1:${s.port}/some/sub/path/`, 'review-spec-subpath');
results.push({ label: 'static sub-path: paths requested from server', served: s.served });
s.srv.close();

// 2. vite preview
const port = 4000 + Math.floor(Math.random() * 2000);
const pv = await preview({ root: ROOT, logLevel: 'warn', preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
await probe('vite preview', `http://127.0.0.1:${port}/`, 'review-spec-preview');
await new Promise((r) => pv.httpServer.close(r));

// 3. dev server (started separately)
if (process.env.DEV_URL) await probe('npm run dev', process.env.DEV_URL, 'review-spec-dev');

await browser.close();
console.log(JSON.stringify(results, null, 2));
