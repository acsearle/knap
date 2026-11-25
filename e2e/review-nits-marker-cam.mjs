// Nits review: root marker under camera moves / animations, off-screen anchor, panels, kinematics,
// idle render cost, legibility crops. Usage: node e2e/review-nits-marker-cam.mjs [dpr]
import { reviewSetup, markDiff } from './review-nits-lib.mjs';
import { frames, press } from './app-lib.mjs';
import { execFileSync } from 'node:child_process';

const DPR = Number(process.argv[2] ?? 1);
const S = await reviewSetup();
const { page, shot, errors } = await S.open('rn-cam', { deviceScaleFactor: DPR });
const out = [];
const log = (k, v) => { out.push([k, v]); console.log(k, JSON.stringify(v)); };
const hook = (probe = false) => page.evaluate((p) => window.__knap.rootMarker(p), probe);
const anchorPx = (a) => page.evaluate((a) => window.__knap.screenPos(a), a);
const crop = (name, cx, cy, w = 80, h = 50, z = 5) => {
  // crop from the last screenshot file around (cx, cy) CSS px
  execFileSync('python3', ['-c', `
from PIL import Image
im=Image.open('e2e/out/${name}.png'); d=${DPR}
box=(int((${cx}-${w}/2)*d),int((${cy}-${h}/2)*d),int((${cx}+${w}/2)*d),int((${cy}+${h}/2)*d))
c=im.crop(box); c=c.resize((int(${w}*${z}),int(${h}*${z})),Image.NEAREST); c.save('e2e/out/${name}-crop.png')`]);
};

// ---- 1. animations: per-frame offset marker − anchor must be (0, drop) and continuous
await page.evaluate(() => window.__knap.loadExample('four-bar'));
await page.evaluate(() => window.__knap.home());
await frames(page, 2);
async function trackDuring(label, act, nframes = 25) {
  const samples = [];
  const p = act();
  for (let i = 0; i < nframes; i++) {
    await frames(page, 1);
    const r = await hook(false);
    const a = await anchorPx(r.anchor);
    const cam = await page.evaluate(() => window.__knap.camera());
    const vh = await page.evaluate(() => document.querySelector('.kv-canvas').clientHeight);
    samples.push({ x: r.x, y: r.y, dx: r.x - a.x, dyErr: r.y - a.y - (0.72 * vh) / cam.height - 4 });
  }
  await p;
  let maxOffErr = 0;
  let maxStep = 0;
  for (let i = 0; i < samples.length; i++) {
    maxOffErr = Math.max(maxOffErr, Math.abs(samples[i].dx), Math.abs(samples[i].dyErr));
    if (i) maxStep = Math.max(maxStep, Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  }
  log(`anim ${label}`, { frames: samples.length, maxOffsetErrPx: +maxOffErr.toExponential(2), maxStepPx: +maxStep.toFixed(2) });
}
const cubeFront = await page.evaluate(() => {
  const r = document.querySelector('.kv-canvas').getBoundingClientRect();
  return { x: r.right - 85, y: r.top + 115 };
});
await trackDuring('view cube click', () => page.mouse.click(cubeFront.x - 20, cubeFront.y));
await trackDuring('Home key', () => page.keyboard.press('Home'));
await trackDuring('F fit', () => page.keyboard.press('f'));
await trackDuring('wheel zoom', async () => { await page.mouse.move(700, 400); for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120); }, 12);
await trackDuring('orbit drag', async () => { await page.mouse.move(900, 600); await page.mouse.down(); for (let i = 0; i < 10; i++) await page.mouse.move(900 + i * 20, 600 - i * 5); await page.mouse.up(); }, 6);
await trackDuring('pan drag', async () => { await page.mouse.move(900, 600); await page.mouse.down({ button: 'right' }); for (let i = 0; i < 10; i++) await page.mouse.move(900 - i * 10, 600 - i * 8); await page.mouse.up({ button: 'right' }); }, 6);

// ---- 2. constant screen size over zoom (pixels)
await page.evaluate(() => window.__knap.home());
const base = await page.evaluate(() => window.__knap.camera());
for (const k of [0.25, 0.5, 1, 2, 4]) {
  await page.evaluate(([c, k]) => window.__knap.setCamera({ ...c, height: c.height * k }), [base, k]);
  const d = await markDiff(page);
  log(`size at zoom height×${k}`, { bboxW: d.bbox ? +(d.bbox[2] - d.bbox[0]).toFixed(1) : null, bboxH: d.bbox ? +(d.bbox[3] - d.bbox[1]).toFixed(1) : null, n: d.n, visible: d.hook?.visible });
}

// ---- 3. anchor off-screen while the root is on screen (tall root, zoomed on its top)
const cell = (x, y, z, kind = 'pinHole', axis = 2) => ({ x, y, z, kind, axis });
await page.evaluate((m) => window.__knap.setModel(m), {
  parts: [
    { id: 1, color: '#4c9a57', cells: Array.from({ length: 12 }, (_, y) => cell(0, y, 0)) },
    { id: 2, color: '#d9cba3', cells: [cell(0, 11, 0, 'pin'), cell(0, 11, 1, 'pin')] },
    { id: 3, color: '#c8433a', cells: [0, 1, 2, 3].map((x) => cell(x, 11, 1)) },
  ],
  rootPartId: 1,
  nextPartId: 4,
});
await page.evaluate(() => { window.__knap.setView('front'); window.__knap.fit(); });
const fitCam = await page.evaluate(() => window.__knap.camera());
await page.evaluate((c) => window.__knap.setCamera({ ...c, target: [1.5, 9, 0], height: 8 }), fitCam);
let d = await markDiff(page);
await shot(`review-nits-cam-offscreen-dpr${DPR}`);
log('tall root zoomed on its top (root fills the view, anchor below)', { hook: d.hook, drawnPixels: d.n });
// anchor under the left toolbar / inspector (canvas spans under the panels?)
await page.evaluate(() => { window.__knap.loadExample('pendulum'); window.__knap.home(); });
const cam0 = await page.evaluate(() => window.__knap.camera());
const r0 = await hook(false);
const canvasRect = await page.evaluate(() => { const r = document.querySelector('.kv-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
log('canvas rect', canvasRect);
// pan so that the marker sits under the toolbar at x≈25 (if the canvas extends there) or at the left edge
const shiftPx = r0.x - (canvasRect.l + 6);
const wpp = cam0.height / (canvasRect.b - canvasRect.t);
const right = [Math.cos(cam0.yaw), 0, -Math.sin(cam0.yaw)];
await page.evaluate(([c, s]) => window.__knap.setCamera({ ...c, target: [c.target[0] + s[0], c.target[1], c.target[2] + s[2]] }), [cam0, right.map((v) => v * shiftPx * wpp)]);
const r1 = await hook(false);
const onTop = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.className || e.tagName) : null; }, [r1.x, r1.y + 2]);
d = await markDiff(page);
await shot(`review-nits-cam-edge-dpr${DPR}`);
log('marker moved to the canvas left edge', { hook: r1, elementAtMark: onTop, drawn: d.n });

// ---- 4. Show kinematics on
await page.evaluate(() => { window.__knap.loadExample('four-bar'); window.__knap.home(); });
const k0 = await markDiff(page);
await page.keyboard.press('k');
await frames(page, 2);
const k1 = await markDiff(page);
await shot(`review-nits-cam-kinematics-dpr${DPR}`);
log('show kinematics', { off: { n: k0.n, cx: k0.cx, cy: k0.cy }, on: { n: k1.n, cx: k1.cx, cy: k1.cy } });
await page.keyboard.press('k');

// ---- 5. idle renders (no rendering cost when idle)
await page.mouse.move(5, 700);
await frames(page, 5);
const rA = await page.evaluate(() => window.__knap.getState().viewport.renders);
await new Promise((r) => setTimeout(r, 3000));
const rB = await page.evaluate(() => window.__knap.getState().viewport.renders);
log('idle renders over 3 s (edit, marker shown)', rB - rA);
// play then stop then idle
await page.evaluate(() => window.__knap.stepSim(240));
await page.evaluate(() => window.__knap.setMode('edit'));
await frames(page, 5);
const rC = await page.evaluate(() => window.__knap.getState().viewport.renders);
await new Promise((r) => setTimeout(r, 3000));
const rD = await page.evaluate(() => window.__knap.getState().viewport.renders);
log('idle renders over 3 s after Stop', rD - rC);

// ---- 6. legibility crops
const legCases = [
  ['four-bar-home', async () => page.evaluate(() => { window.__knap.loadExample('four-bar'); window.__knap.home(); })],
  ['pendulum-home', async () => page.evaluate(() => { window.__knap.loadExample('pendulum'); window.__knap.home(); })],
  ['pendulum-front', async () => page.evaluate(() => { window.__knap.loadExample('pendulum'); window.__knap.setView('front'); window.__knap.fit(); })],
  ['dark-arm-front', async () => page.evaluate((m) => { window.__knap.setModel(m); window.__knap.home(); }, {
    parts: [
      { id: 1, color: '#e0b43c', cells: [0, 1, 2].map((x) => cell(x, 0, 0)) },
      { id: 2, color: '#d9cba3', cells: [cell(1, 0, 0, 'pin'), cell(1, 0, 1, 'pin')] },
      { id: 3, color: '#5f6468', cells: [cell(1, 0, 1), cell(1, -1, 1), cell(1, -2, 1)] },
    ],
    rootPartId: 1, nextPartId: 4 })],
  ['blue-arm-front', async () => page.evaluate((m) => { window.__knap.setModel(m); window.__knap.home(); }, {
    parts: [
      { id: 1, color: '#e0b43c', cells: [0, 1, 2].map((x) => cell(x, 0, 0)) },
      { id: 2, color: '#d9cba3', cells: [cell(1, 0, 0, 'pin'), cell(1, 0, 1, 'pin')] },
      { id: 3, color: '#3b74c4', cells: [cell(1, 0, 1), cell(1, -1, 1), cell(1, -2, 1)] },
    ],
    rootPartId: 1, nextPartId: 4 })],
];
for (const [name, fn] of legCases) {
  await fn();
  await frames(page, 2);
  const m = await markDiff(page);
  const file = `review-nits-leg-${name}-dpr${DPR}`;
  await shot(file);
  crop(file, m.hook.x, m.hook.y, 80, 50, 5);
  log(`legibility ${name}`, { alpha: +m.hook.alpha.toFixed(2), n: m.n, darkPx: m.dark, meanDark: m.meanDark, lightPx: m.light, meanLight: m.meanLight });
}
console.log('errors', errors);
await S.close();
