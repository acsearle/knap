// Labelled comparison sheets (several harness queries, same crop) → e2e/out/gearlook-cmp-<name>.png
//   node spikes/gearlook/compare.mjs [sheet]
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { OUT_DIR, launchBrowser } from '../../e2e/lib.mjs';
import { startServer, open } from './shots.mjs';

const TMP = '/private/tmp/claude-501/-Users-antony-Desktop-knap-nosync/7e685b98-2385-4c25-8c1e-9d77a71d1d8f/scratchpad/spike-look/cmp';
mkdirSync(TMP, { recursive: true });
const T = ['all (repo creases)', ''], B = ['band one patch, no fallback', '&treat=band&fallback=0'], F = ['band+faces one patch, no fallback', '&treat=flat&fallback=0'];
const S = ['sine teeth', '&kind=sine'], D = ['20 drawn teeth on the 40', '&draw=20'], P = ['trapezoid teeth', '&kind=trapezoid'];
const L = ['LOD: plain disc at pitch r', '&kind=sine&ha=0.001&hf=0.001'];
const SHEETS = {
  far: { base: 'scene=beam&zoom=0.35&mark=1&holes=1', crop: [320, 190, 260, 220], opts: {}, rows: [T, B, F, S, D, L] },
  fardpr2: { base: 'scene=beam&zoom=0.35&mark=1&holes=1', crop: [320, 190, 260, 220], opts: { dpr: 2 }, rows: [T, B, S, D] },
  home: { base: 'scene=beam&mark=1&holes=1', crop: [120, 40, 420, 330], opts: {}, rows: [T, B, F, S, D, P] },
  edge: { base: 'scene=beam&view=top&mark=1&holes=1&zoom=1.6', crop: [0, 200, 900, 200], opts: {}, rows: [T, B, F, S] },
  close: { base: 'scene=pair&sizes=0.5,2.5&mark=1&holes=1&fitzoom=1.3', crop: [150, 50, 600, 500], opts: {}, rows: [T, ['chamfer 0.03', '&chamfer=0.03'], B, S, P, ['thin teeth (band ±0.3) on full web', '&bandH=0.3']] },
  small: { base: 'scene=pair&sizes=0.5,1.5&view=front&fitzoom=1.2&B=0.05', crop: [180, 130, 540, 340], opts: {}, rows: [['8t radial below base circle', ''], ['8t parallel below base circle', '&ub=parallel']] },
  final: { base: 'scene=beam&mark=1&holes=1&B=0.05&ub=parallel', crop: [0, 0, 900, 600], opts: {}, rows: [['final profile, ink all', ''], ['final profile, band one patch, no fallback', '&treat=band&fallback=0']] },
  finaldpr2: { base: 'scene=beam&mark=1&holes=1&B=0.05&ub=parallel&treat=band&fallback=0', crop: [100, 30, 500, 350], opts: { dpr: 2 }, rows: [['final, band, DPR 2', ''], ['final, band, DPR 2, dark palette', '&colors=%235f6468,%233b74c4,%23c8433a,%234c9a57,%23e8e8e4']] },
  tooth: { base: 'scene=beam&holes=1&B=0.05&ub=parallel&treat=band&fallback=0&mtooth=1&mark=1', crop: [0, 0, 900, 600], opts: {}, rows: [['painted index tooth + face groove, iso', ''], ['front', '&view=front'], ['edge-on (top)', '&view=top&zoom=1.6'], ['dark palette iso', '&colors=%235f6468,%233b74c4,%23c8433a,%234c9a57,%23e8e8e4']] },
  colors: { base: 'scene=sizes&mark=1&holes=1', crop: [0, 120, 900, 330], opts: {}, rows: [
    ['yellow/grey/blue/red', ''], ['dark grey/blue/red/green', '&colors=%235f6468,%233b74c4,%23c8433a,%234c9a57'], ['white/yellow/light grey/orange', '&colors=%23e8e8e4,%23e0b43c,%23a8adb2,%23e07b2e'],
  ] },
};
const want = process.argv[2];
const srv = await startServer();
const browser = await launchBrowser();
for (const [name, sh] of Object.entries(SHEETS)) {
  if (want && want !== name) continue;
  const files = [];
  const labels = [];
  const dpr = sh.opts.dpr ?? 1;
  for (const [label, q] of sh.rows) {
    const { page, ctx } = await open(browser, srv.url, sh.base + q, sh.opts);
    await page.waitForTimeout(100);
    const f = join(TMP, `${name}-${files.length}.png`);
    const [x, y, w, h] = sh.crop;
    await page.screenshot({ path: f, clip: { x, y, width: w, height: h } });
    files.push(f);
    labels.push(label);
    await ctx.close();
  }
  const out = join(OUT_DIR, `gearlook-cmp-${name}.png`);
  const [, , w, h] = sh.crop;
  const cols = w * dpr > 700 ? 1 : w * dpr > 400 ? 2 : 3;
  execFileSync('python3', ['-c', `
import sys, json
from PIL import Image, ImageDraw
out=sys.argv[1]; labels=json.loads(sys.argv[2]); fs=sys.argv[3:]; cols=${cols}
ims=[Image.open(f).convert('RGB') for f in fs]; W,Hh=ims[0].size; LB=18
rows=(len(ims)+cols-1)//cols
S=Image.new('RGB',(cols*W+(cols-1)*6,rows*(Hh+LB)+(rows-1)*6),'white'); d=ImageDraw.Draw(S)
for i,im in enumerate(ims):
  r,c=divmod(i,cols); x=c*(W+6); y=r*(Hh+LB+6)
  d.text((x+4,y+3),labels[i],fill='black'); S.paste(im,(x,y+LB))
S.save(out)
`, out, JSON.stringify(labels), ...files]);
  console.log(out);
}
await browser.close();
await srv.close();
process.exit(0);
