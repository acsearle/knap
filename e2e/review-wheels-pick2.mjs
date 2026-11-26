// Review (wheels UI): follow-ups — the hub with an axle flush in it, a crank hole without a pin (Wheel
// tool), a crank hole with the Erase tool, Wheel ghost legibility on a blue wheel.
import { frames, model, settle, state, status } from './app-lib.mjs';
import { reviewSetup, findings, canon } from './review-wheels-lib.mjs';
import { FIXTURE, openModel } from './review-wheels-fixture.mjs';

const F = findings();
const R = await reviewSetup();
const { page, shot, errors } = await R.open('rw-pick2');
const ev = (fn, a) => page.evaluate(fn, a);
const world = (w) => ev((q) => window.__knap.screenPos(q), w);
async function probe(label, p, click = false, shotName) {
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await frames(page, 1);
  const s = await status(page);
  if (shotName) await shot(shotName);
  let d = '';
  if (click) {
    const b = await model(page);
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 1);
    const a = await model(page);
    d = JSON.stringify(a.parts.map((q) => [q.id, q.cells.filter((c) => c.rim).map((c) => [c.x, c.y, c.z, c.rim])]).filter((q) => q[1].length));
    d += `  msg="${(await status(page)).message}"`;
  }
  console.log(`  [${label}] hover="${s.hover}" hint="${s.hint}"${click ? `\n      after: rims ${d}` : ''}`);
  return s;
}
try {
  const m = JSON.parse(JSON.stringify(FIXTURE));
  m.parts = m.parts.filter((p) => p.id !== 4); // no pin in the crank hole
  await openModel(page, m, 'rw-fixture-nopin.knap.json');
  await ev(() => window.__knap.home());
  await frames(page, 2);
  await page.keyboard.press('w');
  await probe('W hub+axle (0.3,0.3,1.5)', await world([0.3, 0.3, 1.5]));
  await probe('W hub+axle (-0.3,-0.3,1.5)', await world([-0.3, -0.3, 1.5]));
  const s = await probe('W crank hole (1,1,1) face (1.35,1.35,1.5)', await world([1.35, 1.35, 1.5]), false, 'rw-pick2-w-crankhole');
  F.check(!/^Grow wheel · part 3 · radius 1 /.test(s.hint), `W on a crank hole inside a wheel should act on the wheel, not start a hidden radius-1 disc on the crank hole ("${s.hint}")`);
  await probe('… click', await world([1.35, 1.35, 1.5]), true, null);
  await shot('rw-pick2-w-crankhole-after');
  // after growing the crank hole's own rim, what does hovering the wheel's disc there say?
  await probe('W disc next to it (-1,-1,1.5)', await world([-1, -1, 1.5]));
  await page.keyboard.press('Meta+z');
  await frames(page, 1);
  // Erase on the crank hole
  await page.keyboard.press('e');
  await probe('E crank hole', await world([1.35, 1.35, 1.5]), false, 'rw-pick2-e-crankhole');
  // a blue wheel's grow ghost
  await page.keyboard.press('w');
  await probe('W blue wheel 3 shrink? no: grow on part 7 (green)', await world([3, 0, -0.5]));
  F.check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} catch (e) {
  F.bad(`script error: ${e.stack}`);
} finally {
  await R.close();
  console.log(`\n${F.list.length} BAD`);
}
