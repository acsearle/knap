// Review (wheels UI): discoverability — from an empty model build a wheel on an axle on a beam with the
// real mouse and keyboard, reading what the toolbar / status bar / help say at each step.
import { clickAt, clickFace, frames, gridPos, hover, model, press, settle, state, status } from './app-lib.mjs';
import { reviewSetup, findings, canon } from './review-wheels-lib.mjs';

const F = findings();
const R = await reviewSetup();
const { page, shot, errors } = await R.open('rw-build');
const partOf = (m, id) => m.parts.find((p) => p.id === id);
const say = async (label) => {
  const s = await status(page);
  console.log(`  [${label}] hover="${s.hover}" hint="${s.hint}" aux="${s.aux}" msg="${s.message}"${s.error ? ' (error)' : ''}`);
  return s;
};

try {
  await press(page, '[data-action=new]');
  const tip = await page.getAttribute('[data-tool=wheel]', 'title');
  F.note(`Wheel tooltip: "${tip}"`);
  const gtip = await page.getAttribute('[data-action=ground]', 'title').catch(() => null);
  const glabel = await page.locator('[data-action=ground]').evaluate((e) => e.parentElement.title);
  F.note(`Ground tooltip: "${glabel}" fixRoot: "${await page.locator('[data-action=fix-root]').evaluate((e) => e.parentElement.title)}"`);

  // help dialog
  await page.keyboard.press('?');
  await frames(page, 1);
  const help = await page.locator('[data-role=help]').innerText().catch(async () => await page.locator('.dialog').first().innerText());
  F.note(`help mentions wheel: ${/wheel/i.test(help)}, ground: ${/ground/i.test(help)}, fix root: ${/fix root/i.test(help)}, G key: ${/\bG\b/.test(help)}`);
  console.log(help.split('\n').filter((l) => /wheel|ground|root|vehicle|G\b/i.test(l)).map((l) => '     | ' + l).join('\n'));
  await shot('rw-build-help');
  await page.keyboard.press('Escape');
  await frames(page, 1);

  // W on an empty model
  await page.keyboard.press('w');
  await hover(page, await gridPos(page, 0, 0));
  let s = await say('W over empty grid');
  await clickAt(page, await gridPos(page, 0, 0));
  F.check((await model(page)).parts.length === 0, 'W click on the grid creates nothing');
  s = await say('after W click on grid');

  // beam of 3 pin holes
  await page.keyboard.press('1');
  await clickAt(page, await gridPos(page, 0, 0));
  await clickFace(page, 1, [0, 0, 0], 0);
  await clickFace(page, 1, [1, 0, 0], 0);
  // W on the beam's middle hole: what does it offer?
  await page.keyboard.press('w');
  const mid = await page.evaluate(() => window.__knap.clientPosOfCellFace(1, 1, 4));
  await hover(page, mid);
  s = await say('W on beam middle hole +Z');
  await shot('rw-build-beam-ghost');
  // axle through the first hole (insert), extend +Z twice
  await page.keyboard.press('3');
  await clickFace(page, 1, [0, 0, 0], 4);
  s = await say('after axle insert');
  await clickFace(page, 2, [0, 0, 0], 4);
  await clickFace(page, 2, [0, 0, 1], 4);
  let m = await model(page);
  F.note(`axle part: ${JSON.stringify(partOf(m, 2)?.cells.map((c) => [c.x, c.y, c.z, c.kind]))}`);
  // W on the axle end (not in a hole)
  await page.keyboard.press('w');
  const axEnd = await page.evaluate(() => {
    const m = window.__knap.getModel();
    const p = m.parts.find((q) => q.id === 2);
    const i = p.cells.findIndex((c) => c.z === 2);
    return window.__knap.clientPosOfCellFace(2, i, 4);
  });
  await hover(page, axEnd);
  s = await say('W on axle end');
  F.check(/wheels grow from pin holes and axle holes/.test(s.hint), 'W on a lone axle says why');
  await shot('rw-build-w-on-axle');
  // W on the axle cell inside the beam's hole (its −Z mouth isn't visible; try +X side of axle mid cell? use the beam hole face)
  // sleeve an axle hole on the axle end
  await page.keyboard.press('2');
  await hover(page, axEnd);
  s = await say('axle-hole tool on axle end');
  await clickAt(page, axEnd);
  m = await model(page);
  const sleeve = m.parts.find((p) => p.cells.length === 1 && p.cells[0].kind === 'axleHole');
  F.check(!!sleeve, `sleeve created (part ${sleeve?.id}) "${(await status(page)).message}"`);
  await page.keyboard.press('Home');
  await settle(page);
  // Now W: grow the sleeve
  await page.keyboard.press('w');
  const sid = sleeve.id;
  for (let k = 0; k < 9; k++) {
    const p = await page.evaluate((id) => window.__knap.clientPosOfCellFace(id, 0, 4), sid);
    if (!p) { F.bad(`hub +Z face of part ${sid} not clickable at step ${k}`); break; }
    await hover(page, p);
    s = await say(`W on sleeve hub, step ${k}`);
    if (k === 0 || k === 3 || k === 7) await shot(`rw-build-grow-${k}`);
    const before = await model(page);
    await clickAt(page, p);
    const after = await model(page);
    const r0 = partOf(before, sid).cells[0].rim, r1 = partOf(after, sid).cells[0].rim;
    const msg = (await status(page)).message;
    console.log(`     rim ${r0} -> ${r1}  msg="${msg}"`);
    if (k === 8) F.check(r1 === 4 && /largest wheel is radius 4/.test(s.hint), `growth stops at 4 with a reason ("${s.hint}")`);
  }
  await page.keyboard.press('Home');
  await settle(page);
  await shot('rw-build-r4');
  // Is the axle long enough? the sleeve at z=2: r4 wheel next to beam layer z=0 — fine. Collides with beam? no (other layer)
  // shrink with Shift
  const p = await page.evaluate((id) => window.__knap.clientPosOfCellFace(id, 0, 4), sid);
  await hover(page, p);
  await page.keyboard.down('Shift');
  await frames(page, 1);
  s = await say('Shift held on r4 hub');
  await shot('rw-build-shrink');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await frames(page, 1);
  m = await model(page);
  F.check(partOf(m, sid).cells[0].rim === 3.5, `Shift+click shrinks to 3.5 (${partOf(m, sid).cells[0].rim})`);
  // Shift on a bare hole (beam hole 2)
  const bh = await page.evaluate(() => window.__knap.clientPosOfCellFace(1, 2, 4));
  if (bh) {
    await hover(page, bh);
    await page.keyboard.down('Shift');
    await frames(page, 1);
    s = await say('Shift on bare beam hole');
    await page.keyboard.up('Shift');
    await frames(page, 1);
  }
  // Hover over the disc (virtual cell) with W: grows the same wheel?
  const v = await page.evaluate((id) => window.__knap.clientPosOfVirtualCell(id, 0, [2, 2, 2], 4), sid);
  if (v) {
    await hover(page, v);
    s = await say('W on disc face (2,2,2)');
  } else F.note('virtual cell (2,2,2) not clickable');
  // grow the beam's own hole (middle) to show a wheel in the beam
  if (mid) {
    const mm = await page.evaluate(() => window.__knap.clientPosOfCellFace(1, 1, 4));
    if (mm) {
      await hover(page, mm);
      s = await say('W on beam middle hole (sleeve wheel r3.5 is in another layer)');
    }
  }
  // Grow the wheel so that it would hit the beam: put a second sleeve-wheel at z=0? Use beam hole 0 (has axle): hover axle mouth = beam hole
  const ax0 = await page.evaluate(() => window.__knap.clientPosOfCellFace(1, 0, 4));
  F.note(`beam hole 0 (+Z face) clickable directly: ${!!ax0}`);
  await shot('rw-build-final');
  // Stats
  F.note(`final summary: ${(await page.evaluate(() => window.__knap.analyze())).summary}; counts "${(await status(page)).counts}"`);
  F.check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} catch (e) {
  F.bad(`script error: ${e.stack}`);
  await shot('rw-build-error').catch(() => {});
} finally {
  await R.close();
  console.log(`\n${F.list.length} BAD`);
}
