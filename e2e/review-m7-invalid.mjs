// Reviewer verify-ui: invalid (red) hovers on every palette colour — the colour the overlay switches
// to, crops into e2e/out/review-m7-ov/inv-*.png. Model: a beam with a pin in hole 2, a wheel next
// to another part (growing it collides).
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-invalid.mjs
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR } from './lib.mjs';
import { frames, status } from './app-lib.mjs';
import { C, K, M, PAL, PAL_NAMES, session, setModel } from './review-m7-lib.mjs';

const S = await session();
const log = (...a) => console.log(...a);
const dir = join(OUT_DIR, 'review-m7-ov');
const labels = {};
try {
  for (const dpr of process.env.ONLY1 ? [1] : [1, 2]) {
    const ctx = await S.open(`inv-dpr${dpr}`, { width: 1280, height: 720, deviceScaleFactor: dpr });
    const { page } = ctx;
    for (let k = 0; k < (process.env.ONLY1 ? 1 : PAL.length); k++) {
      const col = PAL[k];
      const m = M([
        { color: col, cells: Array.from({ length: 5 }, (_, i) => C(i, 0, 0)) },
        { color: col, cells: [C(8, 0, 0, 'pinHole', 2, 2)] },
        { color: col, cells: [C(10, 2, 0), C(11, 2, 0)] },
        { color: col, cells: [C(2, 0, 0, 'pin', 2), C(2, 0, 1, 'pin', 2)] },
        // (fixer) beams right behind and under part 1's last holes: a Back side build off them is
        // refused (red, through the part)
        { color: col, cells: [C(3, 0, -1), C(4, 0, -1)] },
        { color: col, cells: [C(2, -1, 0), C(3, -1, 0), C(4, -1, 0)] },
      ], { ground: false });
      await setModel(page, m);
      await K(page, () => window.__knap.setCamera({ target: [5, 0, 0], yaw: Math.PI / 4, pitch: 0.55, height: 14 }));
      await frames(page, 2);
      const face = (part, cell, d) => K(page, ([a, b, c]) => window.__knap.clientPosOfCellFace(a, b, c), [part, cell, d]);
      const cases = [
        ['w', 'wheel grow hits', 2, 0, 4, {}],
        ['4', 'pin on wheel face', 2, 0, 4, {}],
        ['4', 'Alt pin on wheel', 2, 0, 4, { alt: true }],
        ['1', 'hole on wheel face', 2, 0, 4, {}],
        ['1', 'Alt hole behind', 1, 4, 4, { alt: true }],
      ];
      for (let ci = 0; ci < cases.length; ci++) {
        const [key, name, part, cell, d, o] = cases[ci];
        await page.mouse.move(20, 400);
        await page.keyboard.press(key);
        let p = await face(part, cell, d);
        if (!p && part === 2) p = await K(page, () => window.__knap.partScreenPos(2));
        if (!p) { log(`no point for ${name}`); continue; }
        if (part === 2) p = { x: p.x + 25, y: p.y - 25 };
        if (o.alt) await page.keyboard.down('Alt');
        await page.mouse.move(p.x - 3, p.y, { steps: 1 });
        await page.mouse.move(p.x, p.y, { steps: 2 });
        await frames(page, 2);
        const st = await K(page, () => window.__knap.getState());
        const sb = await status(page);
        const r = 75;
        await page.screenshot({ path: join(dir, `inv-dpr${dpr}-${k}-${ci}.png`), clip: { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r } });
        if (process.env.ONLY1 && o.alt) { await ctx.shot('review-m7-alt-valid-red-hint'); log(await page.evaluate(() => document.querySelector('[data-role=status-hint]').outerHTML)); }
        if (o.alt) await page.keyboard.up('Alt');
        labels[`inv-dpr${dpr}-${k}-${ci}`] = `${PAL_NAMES[k]} ${name} ${st.buildHighlight ? (st.buildHighlight.valid ? 'ok' : 'INV') : sb.error ? 'INV' : '?'}`;
        if (dpr === 1) log(`${PAL_NAMES[k].padEnd(6)} ${name.padEnd(18)} hl ${JSON.stringify(st.buildHighlight)} hintRed ${(await page.locator('.st-hint.invalid').count()) > 0} msgRed ${sb.error} msg "${sb.message.slice(0, 60)}" | ${sb.hint.slice(0, 100)}`);
      }
    }
    await ctx.close();
  }
  await writeFile(join(dir, 'inv-labels.json'), JSON.stringify(labels));
} finally {
  await S.close();
}
process.exit(0);
