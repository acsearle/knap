// Temporal aliasing filmstrips: one 40-tooth gear (+ the train for context) at 60 fps for several
// speeds; rows = ω, columns = 6 consecutive frames (Δt = 1/60 s). Writes e2e/out/gearlook-strobe-*.png
//   node spikes/gearlook/anim.mjs
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { OUT_DIR, launchBrowser } from '../../e2e/lib.mjs';
import { startServer, open } from './shots.mjs';

const TMP = '/private/tmp/claude-501/-Users-antony-Desktop-knap-nosync/7e685b98-2385-4c25-8c1e-9d77a71d1d8f/scratchpad/spike-look/frames';
mkdirSync(TMP, { recursive: true });
const OMEGAS = [1, 4.71, 8.95, 9.42, 30, 50];
const VARIANTS = [
  ['plain', 'scene=single&r=2.5&view=front&zoom=0.5'],
  ['markholes', 'scene=single&r=2.5&view=front&zoom=0.5&mark=1&holes=1'],
];
const srv = await startServer();
const browser = await launchBrowser();
for (const [vn, query] of VARIANTS) {
  const { page, ctx } = await open(browser, srv.url, query, { w: 420, h: 420 });
  const files = [];
  for (const w of OMEGAS) {
    for (let k = 0; k < 6; k++) {
      await page.evaluate((t) => window.__setAngle(t), (w * k) / 60);
      const f = join(TMP, `${vn}-${w}-${k}.png`);
      await page.screenshot({ path: f, clip: { x: 60, y: 60, width: 300, height: 300 } });
      files.push(f);
    }
  }
  await ctx.close();
  // compose with python/PIL
  const out = join(OUT_DIR, `gearlook-strobe-${vn}.png`);
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs=sys.argv[2:]; om=${JSON.stringify(OMEGAS)}
W=300; S=Image.new('RGB',(6*W+110,len(om)*W),'white'); d=ImageDraw.Draw(S)
for i,f in enumerate(fs):
  r,c=divmod(i,6); S.paste(Image.open(f).convert('RGB'),(110+c*W,r*W))
for r,w in enumerate(om): d.text((8,r*W+140),'w=%s rad/s'%w,fill='black')
S.save(sys.argv[1])
`, out, ...files]);
  console.log(out);
}
await browser.close();
await srv.close();
process.exit(0);
