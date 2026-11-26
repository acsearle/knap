// Reviewer verify-ui: Back side (Alt) in practice. (1) A sweep of Alt-hovers over models with pins
// and axles through beams and with wheels, from many views: every highlighted back face must
// contain the cursor (screen-space test of the face square's projection); tread refusals counted
// and their hint checked. (2) Real building sessions with mouse + Alt.
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-back.mjs [sweep] [build]
import { frames, status } from './app-lib.mjs';
import { C, K, M, session, setModel } from './review-m7-lib.mjs';

const want = new Set(process.argv.slice(2));
const all = want.size === 0;
const S = await session();
const log = (...a) => console.log(...a);

/** In the page: state after a hover + is the cursor inside the highlighted face's projection. */
const probe = (page, x, y) =>
  page.evaluate(([x, y]) => {
    const st = window.__knap.getState();
    const hl = st.buildHighlight;
    const hint = document.querySelector('[data-role=status-hint]')?.textContent ?? '';
    const hover = document.querySelector('[data-role=status-hover]')?.textContent ?? '';
    const red = !!document.querySelector('.st-hint.invalid');
    if (!hl) return { hl: null, hint, hover, red };
    const D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][hl.dir];
    const a = hl.dir >> 1;
    const t1 = (a + 1) % 3, t2 = (a + 2) % 3;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
      const w = [0, 1, 2].map((i) => hl.pos[i] + 0.5 * D[i]);
      w[t1] += 0.5 * u;
      w[t2] += 0.5 * v;
      return window.__knap.screenPos(w);
    });
    // signed distance outside the convex quad (px; ≤ 0 inside)
    let out = -Infinity;
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      area += p.x * q.y - q.x * p.y;
    }
    const s = Math.sign(area) || 1;
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      const ex = q.x - p.x, ey = q.y - p.y;
      const len = Math.hypot(ex, ey) || 1;
      const d = (-(s) * (ex * (y - p.y) - ey * (x - p.x))) / len;
      out = Math.max(out, d);
    }
    return { hl, hint, hover, red, out, degenerate: Math.abs(area) < 4 };
  }, [x, y]);

try {
  const ctx = await S.open('back', { width: 1280, height: 720 });
  const { page } = ctx;

  if (all || want.has('sweep')) {
    const pinBeam = M([
      { color: '#a8adb2', cells: Array.from({ length: 7 }, (_, i) => C(i, 0, 0)) },
      { color: '#3b74c4', cells: [C(3, 0, 0, 'pin', 2), C(3, 0, 1, 'pin', 2)] },
      { color: '#c8433a', cells: [C(5, 0, -1, 'pin', 2), C(5, 0, 0, 'pin', 2)] },
      { color: '#e0b43c', cells: [C(1, 0, -1, 'axle', 2), C(1, 0, 0, 'axle', 2), C(1, 0, 1, 'axle', 2), C(1, 0, 2, 'axle', 2)] },
      { color: '#4c9a57', cells: Array.from({ length: 5 }, (_, i) => C(i, 0, 2)) },
    ], { ground: false });
    await K(page, () => window.__knap.loadExample('cart'));
    const cart = await K(page, () => window.__knap.getModel());
    await K(page, () => window.__knap.loadExample('crank-wheel'));
    const crank = await K(page, () => window.__knap.getModel());
    const views = [[45, 35], [20, 25], [120, 30], [200, 40], [300, 20], [60, -30]];
    for (const [name, m] of [['pins+axle', pinBeam], ['cart', cart], ['crank', crank]]) {
      await setModel(page, m);
      const tot = { n: 0, back: 0, outside: 0, worst: 0, tread: 0, treadNotOnWheel: 0, front: 0, none: 0, redValid: 0 };
      const bad = [];
      for (const [yd, pd] of views) {
        await K(page, ([y, p]) => {
          window.__knap.home();
          const c = window.__knap.camera();
          window.__knap.setCamera({ ...c, yaw: (y * Math.PI) / 180, pitch: (p * Math.PI) / 180 });
          window.__knap.fit();
        }, [yd, pd]);
        await page.keyboard.press('1');
        await frames(page, 2);
        await page.mouse.move(70, 690);
        await page.keyboard.down('Alt');
        for (let y = 80; y <= 660; y += 28)
          for (let x = 100; x <= 1040; x += 28) {
            await page.mouse.move(x, y);
            const r = await probe(page, x, y);
            if (!/Part \d+/.test(r.hover)) continue; // only hovers on a part
            tot.n++;
            if (/tread/.test(r.hint)) {
              tot.tread++;
              if (!/wheel|tread/.test(r.hover)) { tot.treadNotOnWheel++; if (bad.length < 12) bad.push(`tread hint but hover "${r.hover}" at (${x},${y}) view ${yd}/${pd}`); }
              continue;
            }
            if (!r.hl) { tot.none++; continue; }
            if (!r.hl.backSide) { tot.front++; continue; }
            tot.back++;
            if (r.hl.valid && r.red) tot.redValid++;
            if (r.out > 1.5 && !r.degenerate) {
              tot.outside++;
              tot.worst = Math.max(tot.worst, r.out);
              if (bad.length < 12) bad.push(`(${x},${y}) view ${yd}/${pd}: face ${r.hl.pos}/${r.hl.dir} ${r.out.toFixed(1)} px outside | ${r.hover} | ${r.hint.slice(0, 80)}`);
            }
          }
        await page.keyboard.up('Alt');
      }
      log(`SWEEP ${name}: ${tot.n} Alt-hovers on parts, back-face highlights ${tot.back}, cursor outside the highlighted face ${tot.outside} (worst ${tot.worst.toFixed(1)} px), tread refusals ${tot.tread} (hover not a wheel: ${tot.treadNotOnWheel}), front highlight with Alt ${tot.front}, no highlight ${tot.none}, valid but red hint ${tot.redValid}`);
      for (const b of bad) log(`   ${b}`);
    }
  }

  if (all || want.has('build')) {
    const face = (part, cell, d) => K(page, ([a, b, c]) => window.__knap.clientPosOfCellFace(a, b, c), [part, cell, d]);
    const altClick = async (p) => {
      await page.mouse.move(p.x - 2, p.y);
      await page.keyboard.down('Alt');
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await frames(page, 1);
      const r = await probe(page, p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await frames(page, 1);
      return r;
    };
    // (a) a second layer behind a beam: Alt + pin hole tool on each front hole, Home view
    await setModel(page, M([{ color: '#3b74c4', cells: Array.from({ length: 5 }, (_, i) => C(i, 0, 0)) }], { ground: false }));
    await K(page, () => window.__knap.home());
    await page.keyboard.press('1');
    await frames(page, 2);
    const resA = [];
    for (let i = 0; i < 5; i++) {
      const p = await face(1, i, 4);
      if (!p) { resA.push(`cell ${i}: no front point`); continue; }
      const r = await altClick(p);
      resA.push(`${i}: ${r.hl ? `${r.hl.pos}/${r.hl.dir}` : 'none'} "${r.hint.slice(0, 60)}"`);
    }
    let m = await K(page, () => window.__knap.getModel());
    log(`BUILD (a) layer behind a beam, Home view, Alt+1 on each front hole:\n   ${resA.join('\n   ')}\n   → parts ${m.parts.map((p) => `${p.id}:[${p.cells.map((c) => `${c.x},${c.y},${c.z}`).join(' ')}]`).join(' ')}`);
    await ctx.shot('review-m7-back-layer');
    // same with N (new part) and from a FRONT view
    await setModel(page, M([{ color: '#3b74c4', cells: Array.from({ length: 5 }, (_, i) => C(i, 0, 0)) }], { ground: false }));
    await K(page, () => { window.__knap.setView('front'); window.__knap.fit(); });
    await page.keyboard.press('n');
    await frames(page, 2);
    const resA2 = [];
    for (let i = 0; i < 5; i++) {
      const p = await face(1, i, 4);
      if (!p) { resA2.push(`${i}: no point`); continue; }
      const r = await altClick(p);
      resA2.push(`${i}: ${r.hl ? `${r.hl.pos}/${r.hl.dir}` : 'none'} "${r.hint.slice(0, 70)}"`);
    }
    await page.keyboard.press('n');
    m = await K(page, () => window.__knap.getModel());
    log(`BUILD (a2) FRONT view, N + Alt+1 on each hole:\n   ${resA2.join('\n   ')}\n   → parts ${m.parts.map((p) => `${p.id}:[${p.cells.map((c) => `${c.x},${c.y},${c.z}`).join(' ')}]`).join(' ')}`);

    // (b) extend the far end of an axle through a beam: axle (2,0,-1..1) in beam z = 0
    const axleModel = M([
      { color: '#a8adb2', cells: Array.from({ length: 5 }, (_, i) => C(i, 0, 0)) },
      { color: '#e0b43c', cells: [C(2, 0, -1, 'axle', 2), C(2, 0, 0, 'axle', 2), C(2, 0, 1, 'axle', 2)] },
    ], { ground: false });
    for (const [vname, setup] of [['Home', () => window.__knap.home()], ['front', () => { window.__knap.setView('front'); window.__knap.fit(); }], ['top-front-right', () => { window.__knap.setView('top-front-right'); window.__knap.fit(); }]]) {
      await setModel(page, axleModel);
      await K(page, setup);
      await page.keyboard.press('3');
      await frames(page, 2);
      // hover the near end (+Z face of (2,0,1)) and, separately, where the far end lies behind the beam
      const near = await face(2, 2, 4);
      const farW = await K(page, () => window.__knap.screenPos([2, 0, -1.5]));
      const out = [];
      for (const [lbl, p] of [['near end', near], ['over far end', farW]]) {
        if (!p) { out.push(`${lbl}: no point`); continue; }
        await page.mouse.move(p.x - 2, p.y);
        await page.keyboard.down('Alt');
        await page.mouse.move(p.x, p.y, { steps: 2 });
        await frames(page, 1);
        const r = await probe(page, p.x, p.y);
        await page.keyboard.up('Alt');
        out.push(`${lbl}: ${r.hl ? `${r.hl.pos}/${r.hl.dir}${r.hl.valid ? '' : ' INVALID'} out ${r.out?.toFixed(1)}px` : 'none'} "${r.hint.slice(0, 70)}"`);
      }
      log(`BUILD (b) axle far end, ${vname}: ${out.join(' | ')}`);
      if (vname === 'Home') {
        // try clicking over the far end with Alt and see what was built
        const r = await altClick(farW);
        const mm = await K(page, () => window.__knap.getModel());
        log(`   click over far end → ${mm.parts.map((p) => `${p.id}:[${p.cells.map((c) => `${c.x},${c.y},${c.z}${c.kind[0]}`).join(' ')}]`).join(' ')} (${r.hint.slice(0, 60)})`);
        await ctx.shot('review-m7-back-axle-home');
      }
    }

    // (c) a crank hole on the back of a wheel; then the same wheel seen from behind with Alt
    const wheelModel = M([{ color: '#3b74c4', cells: [C(0, 0, 0, 'pinHole', 2, 2.5)] }], { ground: false });
    await setModel(page, wheelModel);
    await K(page, () => window.__knap.home());
    await page.keyboard.press('1');
    await frames(page, 2);
    const out = [];
    for (const g of [[1, 1], [-1, 1], [1, -1], [0, 2], [2, 0]]) {
      await setModel(page, wheelModel);
      await frames(page, 1);
      const p = await K(page, (g) => window.__knap.clientPosOfVirtualCell(1, 0, [g[0], g[1], 0], 4), g);
      if (!p) { out.push(`${g}: no point`); continue; }
      const r = await altClick(p);
      const mm = await K(page, () => window.__knap.getModel());
      out.push(`G ${g}: ${r.hl ? `${r.hl.pos}/${r.hl.dir} out ${r.out?.toFixed(1)}px` : 'none'} "${r.hint.slice(0, 70)}" → cells ${mm.parts.map((q) => q.cells.map((c) => `${c.x},${c.y},${c.z}`).join(' ')).join(' | ')}`);
    }
    log(`BUILD (c) Alt+1 on the wheel's front face over virtual cells:\n   ${out.join('\n   ')}`);
    await ctx.shot('review-m7-back-wheel');
    // tread: Alt + 1 over the tread, front and with B toggled
    await setModel(page, wheelModel);
    const tread = await K(page, () => window.__knap.screenPos([2.5, 0, 0]));
    await page.mouse.move(tread.x + 3, tread.y);
    await page.mouse.move(tread.x - 2, tread.y, { steps: 2 });
    await frames(page, 1);
    const t0 = await probe(page, tread.x - 2, tread.y);
    await page.keyboard.down('Alt');
    await page.mouse.move(tread.x - 1, tread.y);
    await frames(page, 1);
    const t1 = await probe(page, tread.x - 1, tread.y);
    await page.keyboard.up('Alt');
    log(`TREAD front: hover "${t0.hover}" hint "${t0.hint}" red ${t0.red} hl ${JSON.stringify(t0.hl)}; Alt: hint "${t1.hint}" red ${t1.red} hl ${JSON.stringify(t1.hl)}`);
    await ctx.shot('review-m7-back-tread');
  }
  log(`page errors: ${ctx.errors.join(' | ') || 'none'}`);
} finally {
  await S.close();
}
process.exit(0);
