// Orbit stability: Home view, yaw stepped by 0.25° (21 frames); ink-pixel count (luma < 70) in the
// 40-tooth gear's crop, for 'all' vs 'band, no fallback'. Reports mean, and the mean |Δ| between
// consecutive frames relative to the mean (a smooth orbit gives a small, steady Δ; shimmer shows as spikes).
import { launchBrowser } from '../../e2e/lib.mjs';
import { startServer, open } from './shots.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const T = '/private/tmp/claude-501/-Users-antony-Desktop-knap-nosync/7e685b98-2385-4c25-8c1e-9d77a71d1d8f/scratchpad/spike-look/orbit/';
mkdirSync(T, { recursive: true });
const srv = await startServer();
const b = await launchBrowser();
for (const [n, q] of [['all', ''], ['band', '&treat=band&fallback=0']]) {
  const { page, ctx } = await open(b, srv.url, 'scene=beam&B=0.05&ub=parallel&colors=%23e0b43c' + q, { w: 900, h: 600 });
  const files = [];
  for (let k = 0; k <= 20; k++) {
    await page.evaluate((d) => { const vp = window.__vp; const c = vp.getCamera(); if (!window.__y0) window.__y0 = c.yaw; vp.setCamera({ ...c, yaw: window.__y0 + d }, { animate: false }); vp.renderNow(); }, (k * 0.25 * Math.PI) / 180);
    const f = `${T}${n}-${k}.png`;
    await page.screenshot({ path: f, clip: { x: 120, y: 40, width: 220, height: 280 } });
    files.push(f);
  }
  await ctx.close();
  const r = execFileSync('python3', ['-c', `
import sys
from PIL import Image
c=[]
for f in sys.argv[1:]:
  im=Image.open(f).convert('L'); c.append(sum(1 for p in im.getdata() if p<70))
m=sum(c)/len(c); d=[abs(c[i+1]-c[i]) for i in range(len(c)-1)]
print('mean ink px %.0f, mean |d| %.1f (%.2f%%), max |d| %.0f (%.2f%%)'%(m,sum(d)/len(d),100*sum(d)/len(d)/m,max(d),100*max(d)/m))
`, ...files]).toString();
  console.log(n, r.trim());
}
await b.close(); await srv.close(); process.exit(0);
