// Files: broken v3 files through the real Open dialog; v1 / v2 files; autosave restore.
import { readFile } from 'node:fs/promises';
import { session, model, frames, K, canon, status, state } from './review-m8-ux-lib.mjs';
import { press, openApp } from './app-lib.mjs';
const s = await session();
const ctx = await s.open('files');
const { page, errors, snap } = ctx;
const log = (...a) => console.log(...a);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
await K(page, () => window.__knap.loadExample('gear-train'));
await frames(page, 2);
const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
const saved = await readFile(await dl.path(), 'utf8');
const good = JSON.parse(saved);
log('saved version', good.version, 'parts', good.parts.length);
async function open(name, text) {
  const before = canon(await model(page));
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), press(page, '[data-action=open]')]);
  await ch.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.waitForTimeout(400); await frames(page, 2);
  const st = await state(page);
  const after = canon(await model(page));
  log(`${name}: banner="${st.banner.replace(/\n/g, ' | ')}" model ${after === before ? 'unchanged' : 'REPLACED'} msg="${st.message}" fileName=${st.fileName}`);
  if (st.banner) { await snap('files-' + name.replace(/\W+/g, '_')); await press(page, '[data-role=banner] button').catch(() => {}); }
  return after !== before;
}
const mut = (f) => { const j = JSON.parse(saved); f(j); return JSON.stringify(j); };
const gearCells = (j) => j.parts.flatMap((p) => p.cells.filter((c) => c.teeth));
await open('teeth-on-pin.knap.json', mut((j) => { const pin = j.parts.flatMap((p) => p.cells).find((c) => c.kind === 'pin'); pin.teeth = true; pin.rim = 0.5; }));
await open('teeth-no-rim.knap.json', mut((j) => { const c = j.parts[0].cells[0]; c.teeth = true; }));
await open('rim2-teeth.knap.json', mut((j) => { gearCells(j)[0].rim = 2; }));
await open('teeth-false.knap.json', mut((j) => { gearCells(j)[0].teeth = false; }));
await open('rim-half-no-teeth.knap.json', mut((j) => { delete gearCells(j)[0].teeth; }));
await open('version2-with-teeth.knap.json', mut((j) => { j.version = 2; }));
await open('version4.knap.json', mut((j) => { j.version = 4; }));
await open('teeth-string.knap.json', mut((j) => { gearCells(j)[0].teeth = 'yes'; }));
await open('overlapping-gears.knap.json', mut((j) => { const g = gearCells(j); g[1].rim = 2.5; }));
await open('same-part-mesh.knap.json', JSON.stringify({ version: 3, rootPartId: 1, nextPartId: 2, parts: [{ id: 1, color: '#a8adb2', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2, rim: 1, teeth: true }, { x: 1, y: 0, z: 0, kind: 'pinHole', axis: 2 }, { x: 2, y: 0, z: 0, kind: 'pinHole', axis: 2, rim: 1, teeth: true }] }] }));
await open('teeth-on-axle-hole-ok.knap.json', mut((j) => { gearCells(j)[0].kind = 'axleHole'; }));
// v1 and v2 examples as the old code saved them (the examples are unchanged since 2d3372a)
for (const ex of ['pendulum', 'crank-wheel', 'cart']) {
  const j = await K(page, (n) => { window.__knap.loadExample(n); return window.__knap.getModel(); }, ex);
  await K(page, () => window.__knap.loadExample('gear-train'));
  const changed = await open(`${ex}.knap.json`, JSON.stringify(j));
  const m = await model(page);
  log(`  ${ex}: file version ${j.version}, loaded version ${m.version}, equal ${canon(m) === canon(j)}`);
}
// autosave restore of the gear train
await K(page, () => window.__knap.loadExample('gear-train'));
await frames(page, 2);
const g = await model(page);
await K(page, () => window.__knap.flushAutosave());
await page.reload(); await openApp(page, ctx.url);
log('autosave restore equal', canon(await model(page)) === canon(g), 'counts', (await status(page)).counts);
// autosave while simulating: reload mid-simulation restores the edit model
await page.keyboard.press('Space'); await page.waitForTimeout(1500);
log('mode', (await state(page)).mode);
await K(page, () => window.__knap.flushAutosave());
await page.reload(); await openApp(page, ctx.url);
log('autosave restore after sim reload equal', canon(await model(page)) === canon(g));
log('errors', errors);
await s.close();
