// Review (wheels UI): ≥100 random hovers with the Wheel and Erase tools (and Shift for Wheel) on models
// with wheels; the status sentence is compared with what the click then does (model diff), then undone
// with ⌘Z. Usage: node e2e/review-wheels-hover.mjs [samplesPerCase=40] [seed=7]
import { frames, model, press, settle, status } from './app-lib.mjs';
import { reviewSetup, findings, canon, rng } from './review-wheels-lib.mjs';
import { FIXTURE, openModel } from './review-wheels-fixture.mjs';

const N = Number(process.argv[2] ?? 40);
const rand = rng(Number(process.argv[3] ?? 7));
const F = findings();
const R = await reviewSetup();
const { page, shot, errors } = await R.open('rw-hover');
const MOD = 'Meta';

async function loadExample(name) {
  await press(page, '[data-action=examples]');
  await press(page, `[data-example=${name}]`);
  await settle(page);
}

/** Screen bbox of the model's cells (incl. rims) in the current view. */
async function screenBox() {
  return page.evaluate(() => {
    const m = window.__knap.getModel();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of m.parts)
      for (const c of p.cells) {
        const r = Math.max(0.5, c.rim ?? 0);
        for (const dx of [-r, r]) for (const dy of [-r, r]) for (const dz of [-r, r]) {
          const s = window.__knap.screenPos([c.x + dx, c.y + dy, c.z + dz]);
          x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
        }
      }
    return { x0: Math.max(66, x0), y0: Math.max(46, y0), x1: Math.min(1040, x1), y1: Math.min(690, y1) };
  });
}

const cellsOf = (m) => {
  const out = new Map();
  for (const p of m.parts) for (const c of p.cells) out.set(`${p.id}:${c.x},${c.y},${c.z}`, c);
  return out;
};
/** Rim changes between two models (by position+kind, ignoring part ids, which can split). */
function rimChanges(a, b) {
  const pos = (m) => {
    const o = new Map();
    for (const p of m.parts) for (const c of p.cells) if (c.kind.endsWith('Hole')) o.set(`${c.x},${c.y},${c.z}:${p.id}`, { rim: c.rim, part: p.id, c });
    return o;
  };
  const A = pos(a), B = pos(b);
  const ch = [];
  const posOnly = (m) => {
    const o = new Map();
    for (const p of m.parts) for (const c of p.cells) if (c.kind.endsWith('Hole')) o.set(`${c.x},${c.y},${c.z}:${c.kind}:${c.axis}`, c.rim);
    return o;
  };
  const PA = posOnly(a), PB = posOnly(b);
  for (const [k, r] of PA) if (PB.has(k) && PB.get(k) !== r) ch.push({ k, from: r, to: PB.get(k) });
  return ch;
}
function cellCount(m) { return m.parts.reduce((s, p) => s + p.cells.length, 0); }

const stats = { total: 0, idle: 0, valid: 0, invalid: 0, mismatch: 0, byKind: {} };
const bump = (k) => (stats.byKind[k] = (stats.byKind[k] ?? 0) + 1);

async function sample(tool, shift, caseName, i, box) {
  const p = { x: box.x0 + rand() * (box.x1 - box.x0), y: box.y0 + rand() * (box.y1 - box.y0) };
  const base = await model(page);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await frames(page, 1);
  const st = await status(page);
  await page.mouse.down();
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await frames(page, 1);
  const after = await model(page);
  const st2 = await status(page);
  const changed = canon(after) !== canon(base);
  stats.total++;
  const hint = st.hint;
  const tag = `${caseName} ${tool}${shift ? '+Shift' : ''} #${i} @(${p.x.toFixed(0)},${p.y.toFixed(0)}) hover="${st.hover}" hint="${hint}"`;
  let ok = true, why = '';
  const invalid = / — (.+)$/.exec(hint);
  if (!changed) {
    if (invalid) {
      stats.invalid++; bump(`${tool}-invalid`);
      if (!(st2.error && st2.message.includes(invalid[1]))) { ok = false; why = `invalid click message "${st2.message}"`; }
    } else if (/^(Grow wheel|Shrink wheel|Erase)/.test(hint)) { ok = false; why = 'a valid sentence but the click changed nothing'; }
    else { stats.idle++; bump(`${tool}-idle`); }
  } else {
    stats.valid++;
    if (invalid) { ok = false; why = 'invalid sentence but the model changed'; }
    const ch = rimChanges(base, after);
    let m;
    if ((m = /^Grow wheel · part (\d+) · radius ([\d.]+) \(/.exec(hint))) {
      bump('wheel-grow');
      const r = Number(m[2]);
      if (!(ch.length === 1 && ch[0].to === r && (ch[0].from === undefined ? r === 1 : ch[0].from === r - 0.5))) { ok = false; why = `rim changes ${JSON.stringify(ch)}`; }
      const hub = /hub \((-?\d+), (-?\d+), (-?\d+)\)/.exec(st.hover) ?? /at \((-?\d+), (-?\d+), (-?\d+)\)/.exec(st.hover);
      if (ok && hub && !st.hover.includes(' · in ') && !ch[0].k.startsWith(`${hub[1]},${hub[2]},${hub[3]}:`)) { ok = false; why = `grew ${ch[0].k} but the hover names ${hub[0]}`; }
      if (ok && !/^Grew wheel/.test(st2.message)) { ok = false; why = `message "${st2.message}"`; }
    } else if ((m = /^Shrink wheel · part (\d+) · (?:radius ([\d.]+)|back to a bare)/.exec(hint))) {
      bump('wheel-shrink');
      const r = m[2] === undefined ? undefined : Number(m[2]);
      if (!(ch.length === 1 && ch[0].to === r)) { ok = false; why = `rim changes ${JSON.stringify(ch)}`; }
    } else if ((m = /^Erase the wheel’s outer half-unit · part (\d+) · radius ([\d.]+) → (bare .*|[\d.]+)/.exec(hint))) {
      bump('erase-ring');
      const to = /^bare/.test(m[3]) ? undefined : Number(m[3]);
      if (!(ch.length === 1 && ch[0].from === Number(m[2]) && ch[0].to === to && cellCount(after) === cellCount(base))) { ok = false; why = `rim changes ${JSON.stringify(ch)} cells ${cellCount(base)}→${cellCount(after)}`; }
    } else if ((m = /^Erase (.+?) at \((-?\d+), (-?\d+), (-?\d+)\) from part (\d+)/.exec(hint))) {
      bump('erase-cell');
      const key = `${m[5]}:${m[2]},${m[3]},${m[4]}`;
      const A = cellsOf(base);
      const still = [...cellsOf(after).keys()].some((k) => k.endsWith(`:${m[2]},${m[3]},${m[4]}`) && cellsOf(after).get(k).kind === A.get(key)?.kind);
      if (!A.has(key) || still || cellCount(after) !== cellCount(base) - 1 || ch.length) { ok = false; why = `cell ${key} had=${A.has(key)} still=${still} cells ${cellCount(base)}→${cellCount(after)} rims ${JSON.stringify(ch)}`; }
    } else if ((m = /^Erase part (\d+) \(last cell\)/.exec(hint))) {
      bump('erase-part');
      if (after.parts.some((q) => q.id === Number(m[1])) || after.parts.length !== base.parts.length - 1) { ok = false; why = 'part not removed'; }
    } else { ok = false; why = `unrecognised sentence for a change; msg "${st2.message}"`; }
    await page.keyboard.press(`${MOD}+z`);
    await frames(page, 1);
    const back = await model(page);
    if (canon(back) !== canon(base)) { F.bad(`${tag}: undo did not restore the model`); }
  }
  if (!ok) {
    stats.mismatch++;
    F.bad(`${tag} → ${why}`);
    await shot(`rw-hover-mismatch-${stats.mismatch}`);
  }
}

try {
  const cases = [
    ['crank-wheel', async () => loadExample('crank-wheel')],
    ['cart', async () => loadExample('cart')],
    ['fixture', async () => openModel(page, FIXTURE)],
  ];
  for (const [name, load] of cases) {
    await load();
    const m = await model(page);
    F.note(`${name}: ${m.parts.length} parts, msg "${(await status(page)).message}"`);
    for (const view of ['home', 'front']) {
      if (view === 'front') await page.evaluate(() => { window.__knap.setView('front'); window.__knap.fit(); });
      else await page.evaluate(() => window.__knap.home());
      await frames(page, 2);
      const box = await screenBox();
      await page.keyboard.press('w');
      for (let i = 0; i < N; i++) await sample('wheel', i % 3 === 2, `${name}/${view}`, i, box);
      await page.keyboard.press('e');
      for (let i = 0; i < N; i++) await sample('erase', false, `${name}/${view}`, i, box);
    }
    await shot(`rw-hover-${name}-end`);
  }
  F.note(`stats ${JSON.stringify(stats)}`);
  F.check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
} catch (e) {
  F.bad(`script error: ${e.stack}`);
  await shot('rw-hover-error').catch(() => {});
} finally {
  await R.close();
  console.log(`\n${F.list.length} BAD`);
}
