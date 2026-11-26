// Reviewer verify-ui: §7 editor fixes — Wheel tool on a crank hole, inspector with a free root,
// Fit / Home vs the side panel at several window sizes, the "out of view" hint while simulating.
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-editor.mjs [wheel] [inspector] [fit] [oov]
import { frames, press, status } from './app-lib.mjs';
import { C, K, M, session, setModel } from './review-m7-lib.mjs';

const want = new Set(process.argv.slice(2));
const all = want.size === 0;
const S = await session();
const log = (...a) => console.log(...a);
const model = (page) => K(page, () => window.__knap.getModel());
const clickAt = async (page, p) => {
  await page.mouse.move(p.x - 2, p.y);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await frames(page, 1);
  await page.mouse.down();
  await page.mouse.up();
  await frames(page, 1);
};
try {
  if (all || want.has('wheel')) {
    const ctx = await S.open('ed-wheel');
    const { page } = ctx;
    const wm = M([{ color: '#4c9a57', cells: [C(0, 0, 0, 'pinHole', 2, 2.5), C(1, 1, 0)] }], { ground: false });
    await setModel(page, wm);
    await K(page, () => window.__knap.home());
    await page.keyboard.press('w');
    await frames(page, 2);
    const p = await K(page, () => window.__knap.clientPosOfCellFace(1, 1, 4));
    log(`crank hole face point ${JSON.stringify(p)}`);
    await page.mouse.move(p.x - 2, p.y);
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await frames(page, 2);
    let sb = await status(page);
    log(`WHEEL on crank hole hover: "${sb.hover}" | hint "${sb.hint}"`);
    await ctx.shot('review-m7-ed-wheel-crank-hover');
    await page.mouse.down();
    await page.mouse.up();
    await frames(page, 2);
    let m = await model(page);
    log(`  after click: cells ${m.parts[0].cells.map((c) => `${c.x},${c.y},${c.z}${c.rim ? ' r' + c.rim : ''}`).join(' | ')}; history ${(await K(page, () => window.__knap.getState())).historySize}`);
    // Shift + click on the crank hole: shrink the enclosing wheel
    const p2 = await K(page, () => window.__knap.clientPosOfCellFace(1, 1, 4));
    await page.mouse.move(p2.x, p2.y, { steps: 2 });
    await page.keyboard.down('Shift');
    await page.mouse.move(p2.x + 1, p2.y);
    await frames(page, 2);
    sb = await status(page);
    log(`  Shift hover: "${sb.hint}"`);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await frames(page, 2);
    m = await model(page);
    log(`  after Shift+click: ${m.parts[0].cells.map((c) => `${c.x},${c.y},${c.z}${c.rim ? ' r' + c.rim : ''}`).join(' | ')}`);
    // a crank hole that is NOT wholly inside (at the rim edge: (2,1) of r2.5? and (0,2) of r 2)
    for (const [rim, hole] of [[2.5, [2, 1]], [2, [0, 2]], [2.5, [2, 2]], [1.5, [1, 1]]]) {
      await setModel(page, M([{ color: '#4c9a57', cells: [C(0, 0, 0, 'pinHole', 2, rim), C(hole[0], hole[1], 0)] }], { ground: false }));
      await frames(page, 1);
      const q = await K(page, () => window.__knap.clientPosOfCellFace(1, 1, 4));
      if (!q) { log(`  r ${rim} hole ${hole}: no face point`); continue; }
      await page.mouse.move(q.x - 2, q.y);
      await page.mouse.move(q.x, q.y, { steps: 2 });
      await frames(page, 1);
      sb = await status(page);
      log(`  r ${rim} hole (${hole}): "${sb.hint}"`);
    }
    // erase still erases the crank hole
    await setModel(page, wm);
    await page.keyboard.press('e');
    const pe = await K(page, () => window.__knap.clientPosOfCellFace(1, 1, 4));
    await page.mouse.move(pe.x, pe.y, { steps: 2 });
    await frames(page, 1);
    sb = await status(page);
    log(`  Erase on the crank hole: "${sb.hint}"`);
    await ctx.close();
  }

  if (all || want.has('inspector')) {
    const ctx = await S.open('ed-insp');
    const { page } = ctx;
    await K(page, () => window.__knap.loadExample('cart'));
    await K(page, () => window.__knap.home());
    await page.keyboard.press('v');
    await frames(page, 2);
    for (const pid of [1, 10]) {
      await K(page, () => window.__knap.loadExample('cart'));
      await frames(page, 1);
      const h0 = (await K(page, () => window.__knap.getState())).historySize;
      const p = await K(page, (id) => window.__knap.partScreenPos(id), pid);
      await clickAt(page, p);
      const insp = await page.locator('[data-role=inspector]').innerText();
      const btn = await page.locator('[data-action=set-root]').innerText();
      const dis = await page.locator('[data-action=set-root]').isDisabled();
      log(`INSPECTOR part ${pid} (root ${(await model(page)).rootPartId}, fixRoot ${(await model(page)).fixRoot}): text "${insp.replace(/\s+/g, ' ').slice(0, 200)}" | button "${btn}" disabled ${dis}`);
      await ctx.shot(`review-m7-ed-insp-${pid}`);
      if (!dis) {
        await press(page, '[data-action=set-root]');
        await frames(page, 1);
        const m = await model(page);
        const st = await K(page, () => window.__knap.getState());
        const insp2 = await page.locator('[data-role=inspector]').innerText();
        const fixChecked = await page.locator('[data-action=fix-root]').isChecked();
        log(`  after click: root ${m.rootPartId} fixRoot ${m.fixRoot} checkbox ${fixChecked} history +${st.historySize - h0} msg "${(await status(page)).message}" inspector "${insp2.replace(/\s+/g, ' ').slice(0, 120)}"`);
        await ctx.shot(`review-m7-ed-insp-${pid}-after`);
        const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
        await page.keyboard.press(`${mod}+z`);
        await frames(page, 1);
        const m2 = await model(page);
        log(`  one undo: root ${m2.rootPartId} fixRoot ${m2.fixRoot}`);
      }
    }
    await ctx.close();
  }

  if (all || want.has('fit')) {
    const tall = M([{ color: '#3b74c4', cells: Array.from({ length: 15 }, (_, i) => C(0, i, 0)) }], { ground: false });
    const wide = M([{ color: '#3b74c4', cells: Array.from({ length: 31 }, (_, i) => C(i, 0, 0)) }], { ground: false });
    const sizes = [[1024, 640], [1280, 720], [1280, 400], [1600, 900], [2560, 1440], [1024, 1300], [1100, 500]];
    const rows = [];
    for (const [w, h] of sizes) {
      const ctx = await S.open(`fit-${w}x${h}`, { width: w, height: h });
      const { page } = ctx;
      const vpBox = await page.locator('[data-role=viewport]').boundingBox();
      const side = await page.locator('[data-role=side-panel]').boundingBox();
      for (const [mname, setup] of [['cart', () => window.__knap.loadExample('cart')], ['tall', null], ['wide', null]]) {
        if (setup) await K(page, setup);
        else await setModel(page, mname === 'tall' ? tall : wide);
        for (const [act, sel] of [['home', false], ['fit', false], ['fit', true]]) {
          if (sel) {
            await page.keyboard.press('v');
            const p = await K(page, () => window.__knap.partScreenPos(1));
            if (p && p.x < side.x) await clickAt(page, p);
          } else {
            await page.keyboard.press('Escape');
          }
          await page.mouse.move(vpBox.x + 5, vpBox.y + vpBox.height - 5);
          await page.keyboard.press(act === 'home' ? 'Home' : 'f');
          await frames(page, 1);
          await page.waitForFunction(() => !window.__knap.getState().animating);
          await frames(page, 1);
          // screen box of the model (or the selection) from its cells' cubes
          const b = await K(page, (selOnly) => {
            const m = window.__knap.getModel();
            const sel = window.__knap.getState().selection;
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (const p of m.parts) {
              if (selOnly && sel !== null && p.id !== sel) continue;
              for (const c of p.cells) {
                const r = c.rim ?? 0.5;
                for (let i = 0; i < 8; i++) {
                  const q = window.__knap.screenPos([c.x + (i & 1 ? r : -r), c.y + (i & 2 ? r : -r), c.z + (i & 4 ? 0.5 : -0.5)]);
                  x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
                }
              }
            }
            return { x0, x1, y0, y1, sel };
          }, sel);
          const freeR = side.x - 8; // left edge of the panel (its box)
          const freeC = (vpBox.x + freeR) / 2;
          const cx = (b.x0 + b.x1) / 2;
          const row = `${w}x${h} ${mname.padEnd(4)} ${act}${sel ? '+sel' : '    '} model x ${b.x0.toFixed(0)}..${b.x1.toFixed(0)} y ${b.y0.toFixed(0)}..${b.y1.toFixed(0)} | viewport x ${vpBox.x.toFixed(0)}..${(vpBox.x + vpBox.width).toFixed(0)} panel x ${side.x.toFixed(0)}..${(side.x + side.width).toFixed(0)} y ${side.y.toFixed(0)}..${(side.y + side.height).toFixed(0)} | centre off free-centre ${(cx - freeC).toFixed(0)} px${b.x0 < vpBox.x ? ' CLIPPED-LEFT' : ''}${b.x1 > side.x && b.y1 > side.y && b.y0 < side.y + side.height ? ' UNDER-PANEL' : ''}${b.y0 < vpBox.y || b.y1 > vpBox.y + vpBox.height ? ' CLIPPED-V' : ''}`;
          rows.push(row);
          if ((w === 1024 && h === 640) || (w === 2560) || (w === 1280 && h === 400) || (w === 1024 && h === 1300)) await ctx.shot(`review-m7-fit-${w}x${h}-${mname}-${act}${sel ? '-sel' : ''}`);
        }
      }
      await ctx.close();
    }
    log(`FIT:\n  ${rows.join('\n  ')}`);
  }

  if (all || want.has('oov')) {
    const ctx = await S.open('oov');
    const { page } = ctx;
    const hint = async () => (await status(page)).hint;
    const panAway = async () => {
      for (let k = 0; k < 2; k++) {
        await page.mouse.move(1000, 660);
        await page.mouse.down({ button: 'right' });
        for (let i = 1; i <= 16; i++) await page.mouse.move(1000 - i * 58, 660 - i * 37);
        await page.mouse.up({ button: 'right' });
      }
    };
    await K(page, () => window.__knap.loadExample('cart'));
    await K(page, () => window.__knap.home());
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    await page.waitForTimeout(500);
    await page.mouse.move(150, 650);
    await frames(page, 2);
    log(`OOV running, Home, mouse on empty floor: "${await hint()}"`);
    // zoom in on one wheel (camera inside the model's box region)
    const c0 = await K(page, () => window.__knap.camera());
    await K(page, (c) => window.__knap.setCamera({ ...c, target: [8, -0.5, 3], height: 1.2 }), c0);
    await page.waitForTimeout(600);
    await page.mouse.move(160, 640);
    await frames(page, 3);
    log(`OOV zoomed on a wheel (height 1.2): "${await hint()}"`);
    await ctx.shot('review-m7-oov-zoomed');
    // zoom on an empty spot next to the chassis, inside the model's overall box but no part box there
    await K(page, (c) => window.__knap.setCamera({ ...c, target: [4, 3, 1.5], height: 0.6 }), c0);
    await page.waitForTimeout(600);
    await page.mouse.move(170, 630);
    await frames(page, 3);
    log(`OOV zoomed on empty air between parts (height 0.6, target (4,3,1.5)): "${await hint()}"`);
    await ctx.shot('review-m7-oov-air');
    // pan the model away with a right drag (real mouse)
    await K(page, () => window.__knap.home());
    await frames(page, 2);
    await panAway();
    await page.waitForTimeout(800);
    log(`OOV panned away (running), mouse still: "${await hint()}" | part 1 at ${JSON.stringify(await K(page, () => window.__knap.partScreenPos(1)))}`);
    await ctx.shot('review-m7-oov-panned');
    await page.keyboard.press('f');
    await page.waitForTimeout(800);
    log(`OOV after F: "${await hint()}"`);
    // paused: pan away, mouse not moved after the drag
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    log(`  paused? ${(await K(page, () => window.__knap.getState())).paused}`);
    await panAway();
    await page.waitForTimeout(500);
    log(`OOV paused, panned away, mouse not moved since release: "${await hint()}"`);
    await page.mouse.move(70, 60 + 5);
    await page.mouse.move(80, 70);
    await frames(page, 2);
    log(`OOV paused, after moving the mouse: "${await hint()}"`);
    // Stop while out of view, then Play again (still out of view)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    log(`  after Esc mode ${(await K(page, () => window.__knap.getState())).mode}, hint "${await hint()}"`);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    await page.waitForTimeout(700);
    log(`OOV Play again while the model is out of view (mouse still): "${await hint()}"`);
    await page.keyboard.press('Escape');
    // Home then Play, then pan out, then Esc and Play: wasOutOfView left over?
    await K(page, () => window.__knap.home());
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    await page.waitForTimeout(400);
    await panAway();
    await page.waitForTimeout(600);
    log(`OOV second run panned away: "${await hint()}"`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__knap.getState().mode === 'simulate');
    await page.waitForTimeout(700);
    log(`OOV third run started out of view: "${await hint()}"`);
    await page.keyboard.press('Escape');
    await ctx.close();
  }
} finally {
  await S.close();
}
process.exit(0);
