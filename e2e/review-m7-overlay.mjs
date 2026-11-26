// (Adapted by the fixer for DESIGN §7.3 "Hue keeps its meaning": the expected label is now the
// semantic colour plus "bold" where the white-fill / double-width treatment applies.)
// Reviewer verify-ui: overlay contrast (hover face, ghost, erase cell / ring, wheel band) on every
// palette colour, valid and invalid, front and Back side, DPR 1 and 2. Crops around the cursor go
// into contact sheets e2e/out/review-m7-overlay-sheet-dpr{1,2}.png (built by the python helper in
// the scratchpad from e2e/out/review-m7-ov/*.png + labels.json). Then a sweep across the Cart that
// counts overlay colour switches.
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-overlay.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR } from './lib.mjs';
import { frames, status } from './app-lib.mjs';
import { C, K, M, PAL, PAL_NAMES, session, setModel } from './review-m7-lib.mjs';

const S = await session();
const log = (...a) => console.log(...a);
const dir = join(OUT_DIR, 'review-m7-ov');
await mkdir(dir, { recursive: true });

// same rule as viewport.ts overlayStyle (§7.3: the hue never changes; over a close part colour the
// fill turns white and the outline bold), to report what is expected: "<line colour>[ bold]"
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function overlayColor(color, over) {
  if (!over) return color;
  const a = rgb(color), b = rgb(over);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.3 ? `${color} bold` : color;
}
const ACCENT = '#1f7ae0', RED = '#e0322b';

const labels = {};
try {
  for (const dpr of process.env.OV_DPR ? [+process.env.OV_DPR] : [1, 2]) {
    const ctx = await S.open(`ov-dpr${dpr}`, { width: 1280, height: 720, deviceScaleFactor: dpr });
    const { page } = ctx;
    for (let k = 0; k < PAL.length; k++) {
      if (process.env.OV_COLORS && !process.env.OV_COLORS.split(',').includes(String(k))) continue;
      const col = PAL[k];
      const m = M([
        { color: col, cells: Array.from({ length: 5 }, (_, i) => C(i, 0, 0)) },
        { color: col, cells: [C(8, 0, 0, 'pinHole', 2, 2)] },
      ], { ground: false });
      await setModel(page, m);
      await K(page, () => window.__knap.setCamera({ target: [4, 0, 0], yaw: Math.PI / 4, pitch: 0.55, height: 12 }));
      await frames(page, 2);
      const face = (part, cell, d) => K(page, ([a, b, c]) => window.__knap.clientPosOfCellFace(a, b, c), [part, cell, d]);
      const cases = [
        ['1', 'top', 1, 2, 2, {}],
        ['4', 'pin front', 1, 2, 4, {}],
        ['3', 'axle top', 1, 2, 2, {}],
        ['4', 'pin top', 1, 2, 2, {}],
        ['1', 'Alt front', 1, 2, 4, { alt: true }],
        ['w', 'wheel on hole', 1, 2, 4, {}],
        ['w', 'wheel on wheel', 2, 0, 4, {}],
        ['w', 'Shift wheel', 2, 0, 4, { shift: true }],
        ['e', 'erase cell', 1, 2, 4, {}],
        ['e', 'erase wheel', 2, 0, 4, {}],
      ];
      for (let ci = 0; ci < cases.length; ci++) {
        const [key, name, part, cell, d, o] = cases[ci];
        await page.mouse.move(20, 400);
        await page.keyboard.press(key);
        let p = await face(part, cell, d);
        if (!p && part === 2) p = await K(page, () => window.__knap.partScreenPos(2));
        if (!p) { log(`no point for ${name}`); continue; }
        if (part === 2) p = { x: p.x + 25, y: p.y - 25 }; // on the flat face, off the hub hole
        if (o.alt) await page.keyboard.down('Alt');
        if (o.shift) await page.keyboard.down('Shift');
        await page.mouse.move(p.x - 3, p.y, { steps: 1 });
        await page.mouse.move(p.x, p.y, { steps: 2 });
        await frames(page, 2);
        const st = await K(page, () => window.__knap.getState());
        const sb = await status(page);
        const hl = st.buildHighlight;
        const valid = hl ? hl.valid : !sb.error && !/^(Can|Cannot|No )/.test(sb.hint);
        const file = join(dir, `dpr${dpr}-${k}-${ci}.png`);
        const r = 75;
        await page.screenshot({ path: file, clip: { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r } });
        if (o.alt) await page.keyboard.up('Alt');
        if (o.shift) await page.keyboard.up('Shift');
        const exp = key === 'e' || o.shift ? overlayColor(RED, col) : overlayColor(valid ? ACCENT : RED, col);
        labels[`dpr${dpr}-${k}-${ci}`] = `${PAL_NAMES[k]} ${name} ${valid ? 'ok' : 'INV'} ${exp}`;
        if (dpr === 1) log(`${PAL_NAMES[k].padEnd(6)} ${name.padEnd(15)} valid ${String(valid).padEnd(5)} expect ${exp} | hint: ${sb.hint.slice(0, 90)}${sb.error ? ' [red]' : ''}`);
      }
    }
    await ctx.close();
  }
  await writeFile(join(dir, 'labels.json'), JSON.stringify(labels));
  // OV_COLORS=0,1,… (and OV_DPR=1|2): only those palette colours, no Cart sweep
  if (process.env.OV_COLORS) { await S.close(); process.exit(0); }

  // sweep across the Cart (pin tool, then Alt) counting overlay colour changes with the same highlight
  const ctx = await S.open('ov-sweep', { width: 1280, height: 720 });
  const { page } = ctx;
  await K(page, () => window.__knap.loadExample('cart'));
  await K(page, () => window.__knap.home());
  await frames(page, 2);
  const cart = await K(page, () => window.__knap.getModel());
  const colOf = Object.fromEntries(cart.parts.map((p) => [p.id, p.color]));
  for (const [key, alt] of [['1', false], ['4', false], ['1', true], ['e', false]]) {
    await page.keyboard.press(key);
    if (alt) await page.keyboard.down('Alt');
    let prev = null, switches = 0, sameCellSwitches = 0, n = 0;
    const examples = [];
    for (let y = 250; y <= 620; y += 30)
      for (let x = 260; x <= 860; x += 6) {
        await page.mouse.move(x, y);
        await frames(page, 1);
        const st = await K(page, () => window.__knap.getState());
        const sb = await status(page);
        const pid = +(sb.hover.match(/Part (\d+)/)?.[1] ?? 0);
        const hl = st.buildHighlight;
        if (!pid || (key !== 'e' && !hl)) { prev = null; continue; }
        n++;
        const base = key === 'e' ? RED : hl.valid ? ACCENT : RED;
        const c = overlayColor(base, colOf[pid]);
        const cellKey = hl ? `${hl.pos}/${hl.dir}` : `${pid}`;
        if (prev && prev.c !== c) {
          switches++;
          if (prev.cell === cellKey) { sameCellSwitches++; if (examples.length < 4) examples.push(`(${x},${y}) ${prev.c}->${c} part ${prev.pid}->${pid} face ${cellKey}`); }
        }
        prev = { c, cell: cellKey, pid };
      }
    if (alt) await page.keyboard.up('Alt');
    log(`SWEEP Cart tool ${key}${alt ? '+Alt' : ''}: ${n} hovers, colour changes between neighbouring samples ${switches}, of which the highlighted face stayed the same ${sameCellSwitches}; ${examples.join(' | ')}`);
  }
} finally {
  await S.close();
}
process.exit(0);
