// Nits review: is the Back side ghost / face highlight legible through the part? Screenshots with
// Alt held (real keyboard + mouse). Usage: node e2e/review-nits-ghost.mjs [dpr]
import { execFileSync } from 'node:child_process';
import { reviewSetup } from './review-nits-lib.mjs';
import { facePos, frames, hover, status } from './app-lib.mjs';

const DPR = Number(process.argv[2] ?? 1);
const S = await reviewSetup();
const { page, shot, errors } = await S.open('rn-ghost', { deviceScaleFactor: DPR });
const cell = (x, y, z, kind = 'pinHole', axis = 2) => ({ x, y, z, kind, axis });
const cases = [
  // [name, model|example, view, tool key, partId, cellIndex, dir]
  ['beam-top-hole', { parts: [{ id: 1, color: '#c8433a', cells: [0, 1, 2, 3, 4].map((x) => cell(x, 0, 0)) }], rootPartId: null, nextPartId: 2 }, 'home', '1', 1, 2, 2],
  ['beam-front-pin', { parts: [{ id: 1, color: '#3b74c4', cells: [0, 1, 2, 3, 4].map((x) => cell(x, 0, 0)) }], rootPartId: null, nextPartId: 2 }, 'home', '4', 1, 2, 4],
  ['thick-block', { parts: [{ id: 1, color: '#5f6468', cells: [0, 1, 2].flatMap((x) => [0, 1, 2].map((z) => cell(x, 0, z, 'pinHole', 1))) }], rootPartId: null, nextPartId: 2 }, 'home', '3', 1, 5, 4],
  ['fourbar-coupler', 'four-bar', 'home', '1', null, 0, 4],
  ['side-face-oblique', { parts: [{ id: 1, color: '#e0b43c', cells: [0, 1, 2, 3, 4].map((x) => cell(x, 0, 0)) }], rootPartId: null, nextPartId: 2 }, 'top-front-right', '1', 1, 4, 0],
];
for (const [name, m, view, tool, pid, ci, dir] of cases) {
  await page.evaluate(([m, view]) => {
    if (typeof m === 'string') window.__knap.loadExample(m);
    else window.__knap.setModel(m);
    if (view === 'home') window.__knap.home();
    else { window.__knap.setView(view); window.__knap.fit(); }
  }, [m, view]);
  let partId = pid;
  if (partId === null) {
    const mm = await page.evaluate(() => window.__knap.getModel());
    partId = mm.parts.find((p) => p.color.toLowerCase() === '#e0b43c' || p.cells.length === 5)?.id ?? mm.parts[1].id;
  }
  await page.keyboard.press(tool);
  const p = await facePos(page, partId, ci, dir);
  await hover(page, p);
  const front = await status(page);
  await shot(`review-nits-ghost-${name}-front-dpr${DPR}`);
  await page.keyboard.down('Alt');
  await frames(page, 2);
  const back = await status(page);
  const file = `review-nits-ghost-${name}-back-dpr${DPR}`;
  await shot(file);
  await page.keyboard.up('Alt');
  await frames(page, 1);
  console.log(name, JSON.stringify({ front: front.hint, back: back.hint, aux: back.aux }));
  execFileSync('python3', ['-c', `
from PIL import Image
im=Image.open('e2e/out/${file}.png'); d=${DPR}
x,y=${p.x},${p.y}
c=im.crop((int((x-160)*d),int((y-110)*d),int((x+160)*d),int((y+110)*d))); c=c.resize((640,440)); c.save('e2e/out/${file}-crop.png')`]);
}
console.log('errors', errors);
await S.close();
