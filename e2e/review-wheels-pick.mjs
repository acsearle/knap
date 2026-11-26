// Review (wheels UI): directed picking cases on the fixture (review-wheels-fixture.mjs): crank hole with
// and without a pin, hub with an axle through it, two touching wheels, a wheel behind a beam, a wheel
// edge-on, hole tools on the disc face (Extend, R, Shift, New part, Alt = Back side), Select +
// inspector, Erase ring. Prints the sentence, then clicks and prints what changed; screenshots each.
import { frames, model, press, settle, state, status } from './app-lib.mjs';
import { reviewSetup, findings, canon } from './review-wheels-lib.mjs';
import { FIXTURE, openModel } from './review-wheels-fixture.mjs';

const F = findings();
const R = await reviewSetup();
const { page, shot, errors } = await R.open('rw-pick');
const ev = (fn, a) => page.evaluate(fn, a);
const diff = (a, b) => {
  const out = [];
  const key = (p, c) => `${p.id}:${c.x},${c.y},${c.z}:${c.kind}`;
  const A = new Map(), B = new Map();
  for (const p of a.parts) for (const c of p.cells) A.set(key(p, c), c);
  for (const p of b.parts) for (const c of p.cells) B.set(key(p, c), c);
  for (const [k, c] of A) if (!B.has(k)) out.push(`-${k}${c.rim ? ` r${c.rim}` : ''}`);
  for (const [k, c] of B) if (!A.has(k)) out.push(`+${k}${c.rim ? ` r${c.rim}` : ''}`);
  for (const [k, c] of A) if (B.has(k) && B.get(k).rim !== c.rim) out.push(`~${k} rim ${c.rim}→${B.get(k).rim}`);
  return out.join(' ') || '(no change)';
};
async function at(label, p, { click = false, shift = false, alt = false, shotName } = {}) {
  if (!p) { F.bad(`${label}: no screen point`); return null; }
  if (shift) await page.keyboard.down('Shift');
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await frames(page, 1);
  const s = await status(page);
  if (shotName) await shot(shotName);
  let d = '';
  if (click) {
    const before = await model(page);
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 1);
    const after = await model(page);
    d = diff(before, after);
    if (alt) await page.keyboard.up('Alt');
    if (shift) await page.keyboard.up('Shift');
    if (canon(before) !== canon(after)) { await page.keyboard.press('Meta+z'); await frames(page, 1); }
    if (canon(await model(page)) !== canon(before)) F.bad(`${label}: undo did not restore`);
  } else {
    if (alt) await page.keyboard.up('Alt');
    if (shift) await page.keyboard.up('Shift');
  }
  console.log(`  [${label}] hover="${s.hover}"\n      hint="${s.hint}" aux="${s.aux}"${click ? `\n      click → ${d}  msg="${(await status(page)).message}"` : ''}`);
  return { s, d };
}
const face = (pid, ci, dir) => ev(([a, b, c]) => window.__knap.clientPosOfCellFace(a, b, c), [pid, ci, dir]);
const virt = (pid, hub, pos, dir) => ev(([a, b, c, d]) => window.__knap.clientPosOfVirtualCell(a, b, c, d), [pid, hub, pos, dir]);
const world = (w) => ev((q) => window.__knap.screenPos(q), w);

try {
  await openModel(page, FIXTURE);
  await ev(() => window.__knap.home());
  await frames(page, 2);
  await shot('rw-pick-home');
  // --- Wheel tool
  await page.keyboard.press('w');
  let r = await at('W: crank pin (part 4) end face +Z at (1,1,2)', await face(4, 1, 4), { click: true, shotName: 'rw-pick-w-crankpin' });
  r = await at('W: crank-hole mouth (pin in it), world (1,1,1.5)+(0.3,0.3)', await world([1.3, 1.3, 1.5]), { click: true, shotName: 'rw-pick-w-crankhole' });
  r = await at('W: hub with axle (hub +Z face; the axle end is flush)', await face(3, 0, 4), { click: true });
  r = await at('W: disc face of part 3 at (-1,-1,1)', await virt(3, 0, [-1, -1, 1], 4), { click: true, shotName: 'rw-pick-w-disc3' });
  r = await at('W: disc of part 5 at (6,1,1) (touching part 3)', await virt(5, 0, [6, 1, 1], 4), { click: true, shotName: 'rw-pick-w-disc5' });
  F.check(/wheels would overlap|would hit/.test(r?.s.hint ?? ''), `growing a wheel into a touching wheel is refused: "${r?.s.hint}"`);
  r = await at('W: tread of part 3 (top), world (0,2.5,1)+', await world([0.2, 2.5, 0.8]), { click: true });
  // wheel behind the beam (part 7, z -1): visible part of its disc below the beam
  const behind = await ev(() => {
    for (let x = 1.6; x <= 4.4; x += 0.2) for (let y = -1.4; y <= 1.4; y += 0.2) for (const z of [-0.5, -1]) {
      const s = window.__knap.screenPos([x, y, z]);
      if (document.elementFromPoint(s.x, s.y)?.tagName !== 'CANVAS') continue;
      return null && s;
    }
    return null;
  });
  // search the screen around part 7 for a point whose hover names part 7
  let p7 = null;
  {
    const c = await world([3, 0, -1]);
    outer: for (let dy = -90; dy <= 90; dy += 10) for (let dx = -90; dx <= 90; dx += 10) {
      await page.mouse.move(c.x + dx, c.y + dy);
      await frames(page, 1);
      if (/^Part 7 /.test((await status(page)).hover)) { p7 = { x: c.x + dx, y: c.y + dy }; break outer; }
    }
  }
  F.note(`a point over part 7 (behind the beam) from Home: ${JSON.stringify(p7)}`);
  if (p7) r = await at('W: wheel behind beam (part 7)', p7, { click: true, shotName: 'rw-pick-w-behind' });
  // --- Erase
  await page.keyboard.press('e');
  r = await at('E: hub of part 3 (+Z face, axle flush)', await face(3, 0, 4), { click: true });
  r = await at('E: disc face (part 3) (-1,-1,1)', await virt(3, 0, [-1, -1, 1], 4), { click: true, shotName: 'rw-pick-e-ring' });
  r = await at('E: crank pin end', await face(4, 1, 4), { click: true });
  r = await at('E: crank-hole mouth', await world([1.3, 1.3, 1.5]), { click: true });
  r = await at('E: tread of part 5 (top)', await world([5.2, 2.5, 0.8]), { click: true, shotName: 'rw-pick-e-tread' });
  // --- Select
  await page.keyboard.press('v');
  await at('V: disc of part 5', await virt(5, 0, [6, 1, 1], 4), { click: false });
  const p5 = await virt(5, 0, [6, 1, 1], 4);
  await page.mouse.click(p5.x, p5.y);
  await frames(page, 2);
  F.note(`selection ${(await state(page)).selection}; inspector wheels "${await page.textContent('[data-role=inspector-wheels]').catch(() => '?')}"`);
  await shot('rw-pick-select5');
  await page.keyboard.press('Escape');
  // --- Hole tools on the disc face
  await page.keyboard.press('1');
  r = await at('1: disc face (part 3) (-1,-1,1) +Z', await virt(3, 0, [-1, -1, 1], 4), { click: true, shotName: 'rw-pick-1-disc' });
  r = await at('1+Shift: disc face (-1,-1,1)', await virt(3, 0, [-1, -1, 1], 4), { click: true, shift: true, shotName: 'rw-pick-1-shift' });
  await page.keyboard.press('n');
  r = await at('1 + New part on: disc face (-1,-1,1)', await virt(3, 0, [-1, -1, 1], 4), { click: true });
  await page.keyboard.press('n');
  // R cycling on the disc face
  const vp = await virt(3, 0, [-1, -1, 1], 4);
  await page.mouse.move(vp.x, vp.y, { steps: 2 });
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('r');
    await frames(page, 1);
    const s = await status(page);
    console.log(`  [R ×${k + 1}] hint="${s.hint}" aux="${s.aux}" msg="${s.message}"`);
  }
  await shot('rw-pick-1-r');
  await page.keyboard.press('2');
  r = await at('2: on the tread (top of part 3)', await world([0.2, 2.5, 0.8]), { click: true, shotName: 'rw-pick-2-tread' });
  r = await at('3 (axle tool): disc face (-1,-1,1)', null);
  await page.keyboard.press('3');
  r = await at('3: disc face (-1,-1,1)', await virt(3, 0, [-1, -1, 1], 4), { click: true });
  // Alt = Back side over a wheel with a hole tool
  await page.keyboard.press('1');
  r = await at('1+Alt: over disc of part 5 at (6,1,1)', await virt(5, 0, [6, 1, 1], 4), { alt: true, click: true, shotName: 'rw-pick-alt-disc5' });
  F.note(`buildHighlight ${JSON.stringify(await ev(() => window.__knap.getState().buildHighlight))}`);
  r = await at('1+Alt: over the hub of part 5', await world([5, 0, 1.5]), { alt: true, click: false, shotName: 'rw-pick-alt-hub5' });
  // edge-on wheel (part 8, axis X) from FRONT
  await ev(() => { window.__knap.setView('front'); window.__knap.fit(); });
  await frames(page, 2);
  await page.keyboard.press('w');
  r = await at('W FRONT: edge-on wheel part 8 (9, 1.2, 0.5)', await world([9, 1.2, 0.5]), { click: true, shotName: 'rw-pick-w-edgeon' });
  r = await at('W FRONT: edge-on wheel part 8 tread edge (9.4, 1.95, 0.5)', await world([9.45, 1.9, 0.5]), { click: true });
  await page.keyboard.press('e');
  r = await at('E FRONT: edge-on wheel part 8', await world([9, 1.2, 0.5]), { click: false, shotName: 'rw-pick-e-edgeon' });
  F.check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} catch (e) {
  F.bad(`script error: ${e.stack}`);
  await shot('rw-pick-error').catch(() => {});
} finally {
  await R.close();
  console.log(`\n${F.list.length} BAD`);
}
