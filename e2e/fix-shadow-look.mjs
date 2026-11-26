// Fixer's look check for the contact shadow: Cart at Home (edit), palette beams lying on the floor,
// screenshots e2e/out/fix-sh-*.png. `node e2e/fix-shadow-look.mjs [tag]`.
import { launchBrowser, openPage, startServer } from './lib.mjs';
import { frames, openApp } from './app-lib.mjs';
const tag = process.argv[2] ?? 'a';
const server = await startServer();
const browser = await launchBrowser();
const ctx = await openPage(browser, server.url, 'fix-shadow-look');
const { page } = ctx;
const k = (fn, a) => page.evaluate(fn, a);
try {
  await openApp(page, ctx.url);
  await k(() => window.__knap.loadExample('cart'));
  await k(() => window.__knap.home());
  await frames(page, 3);
  await ctx.shot(`fix-sh-${tag}-cart`);
  const cols = ['#555a60', '#9ea3a8', '#f2f2ee', '#3b74c4', '#3f9a52', '#c8403a', '#e07b2a', '#e2b23a'];
  const parts = cols.map((color, i) => ({ id: i + 1, color, cells: [0, 1, 2, 3, 4].map((x) => ({ x, y: 0, z: i * 2, kind: 'pinHole', axis: 1 })) }));
  await k((m) => window.__knap.setModel(m), { version: 2, rootPartId: 1, nextPartId: 9, ground: true, fixRoot: true, parts });
  await k(() => window.__knap.home());
  await frames(page, 3);
  await ctx.shot(`fix-sh-${tag}-palette`);
  const samples = [];
  for (const d of [0, 0.47, 0.8, 1.2, 2, 3]) samples.push((await k(([x, z]) => window.__knap.groundShadowAt(x, z), [2, d])).toFixed(3));
  console.log('beam (z=0) strength at z offsets 0,.47,.8,1.2,2,3:', samples.join(' '));
} finally {
  await ctx.close();
  await browser.close();
  await server.close();
}
