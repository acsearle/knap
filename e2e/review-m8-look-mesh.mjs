// Reviewer "look" (m8): meshed pairs at rest (every pair x axis, zoomed to the mesh point) and the
// Gear train example while it runs (frames every 1/60 s at the default 1/4x speed and at 1x).
//   E2E_DIST=e2e/out/review-m8-look-dist node e2e/review-m8-look-mesh.mjs [dpr]
import { ISO, K, T, axisCam, gear, model, pointClip, save, session, setCam, setModel, sheet, snap, VPJS } from './review-m8-look-lib.mjs';

const PAIRS = [[0.5, 0.5], [0.5, 1.5], [1, 1], [0.5, 2.5], [1.5, 1.5], [1.5, 2.5], [2.5, 2.5]];
const AX = ['X', 'Y', 'Z'];
// in-plane direction of the line of centres per axis (world)
const DIR = { 0: [0, 0, 1], 1: [1, 0, 0], 2: [1, 0, 0] };
const S = await session();
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };

/** Colours (rgb) at world points, from one fresh render of the drawing buffer. */
const colorsAt = (page, pts) =>
  page.evaluate(
    `(() => { const vp = ${VPJS}; vp.renderNow(); const gl = vp.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight; const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); const d = vp.size.pixelRatio;
    return ${JSON.stringify(pts)}.map((p) => { const q = vp.project(p); const x = Math.round(q.x * d), y = Math.round(q.y * d);
      const i = ((H - 1 - y) * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; }); })()`,
  );
const near = (c, ref) => Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) + Math.abs(c[2] - ref[2]);

const dprs = process.argv[2] ? [Number(process.argv[2])] : [1, 2];
try {
  for (const dpr of dprs) {
    const ctx = await S.open(`look-mesh-${dpr}`, { width: 1280, height: 800, deviceScaleFactor: dpr });
    const { page } = ctx;
    const tiles = [];
    log(`\n=== DPR ${dpr}: pairs at rest; samples along the pitch-circle tangent through the pitch point (A = yellow, B = blue, . = background, ? = other/ink) ===`);
    for (const axis of process.env.SKIP_PAIRS ? [] : [0, 1, 2]) {
      for (const [ra, rb] of PAIRS) {
        const d = DIR[axis];
        const hb = d.map((x) => x * (ra + rb));
        await setModel(page, model([{ color: '#e0b43c', cells: [gear(0, 0, 0, axis, ra)] }, { color: '#3b74c4', cells: [gear(hb[0], hb[1], hb[2], axis, rb)] }]));
        const meshes = await K(page, () => window.__knap.analyze().meshes);
        const pp = d.map((x) => x * ra);
        await setCam(page, axisCam(axis, pp, 1.6));
        // tangent direction: axis x d
        const ax = [0, 0, 0]; ax[axis] = 1;
        const tg = [ax[1] * d[2] - ax[2] * d[1], ax[2] * d[0] - ax[0] * d[2], ax[0] * d[1] - ax[1] * d[0]];
        // sample along the tangent offset to the near-face plane (+0.4 along axis so it is the front face)
        const pts = [];
        for (let s = -0.6; s <= 0.6001; s += 0.01) pts.push(pp.map((x, i) => x + s * tg[i] + 0.45 * ax[i]));
        const cols = await colorsAt(page, pts);
        const A = cols[0], Bc = [59, 116, 196];
        const str = cols.map((c) => (near(c, [247, 247, 245]) < 20 ? '.' : c[2] > c[0] + 40 ? 'B' : c[0] > c[2] + 60 ? 'A' : '?')).join('');
        const runs = str.replace(/\?/g, '').replace(/\.+/g, '.').replace(/A+/g, 'A').replace(/B+/g, 'B');
        log(`${T[ra]}+${T[rb]} axis ${AX[axis]} meshes=${meshes}: ${str}  -> ${runs}`);
        void A; void Bc;
        tiles.push({ label: `${T[ra]}+${T[rb]} ${AX[axis]} face`, buf: await snap(page, await pointClip(page, pp, 110)) });
        await setCam(page, { ...axisCam(axis, pp, 2.4, 0.5), pitch: axis === 1 ? 1.0 : 0.45 });
        tiles.push({ label: `${T[ra]}+${T[rb]} ${AX[axis]} oblique`, buf: await snap(page, await pointClip(page, pp, 110)) });
      }
    }
    if (tiles.length) console.log('sheet', await sheet(S.browser, `review-m8-look-pairs-dpr${dpr}.png`, tiles, { cols: 6, title: `meshed pairs at rest, edit mode, camera height 1.6 face-on / 2.4 oblique, DPR ${dpr}` }));

    // ---- the Gear train example running
    await K(page, () => window.__knap.loadExample('gear-train'));
    await K(page, () => window.__knap.home());
    const home = await K(page, () => window.__knap.camera());
    log(`gear-train home camera ${JSON.stringify(home)}`);
    const m = await K(page, () => window.__knap.getModel());
    const gears = [];
    for (const p of m.parts) p.cells.forEach((c, i) => c.teeth && gears.push({ part: p.id, i, c }));
    log(`gears: ${gears.map((g) => `part ${g.part} T${T[g.c.rim]} at ${g.c.x},${g.c.y},${g.c.z}`).join('; ')}`);
    const mp1 = [0, 2.5, 1];
    const mp2 = [0.5, 3, 2];
    for (const [label, perFrame, n] of [['quarter', 2, 48], ['full', 8, 48]]) {
      await K(page, () => window.__knap.setMode('edit'));
      await K(page, () => window.__knap.loadExample('gear-train'));
      await K(page, () => window.__knap.stepSim(0));
      const ft = [];
      const strip = [];
      let prevQ = null;
      for (let f = 0; f < n; f++) {
        if (f) await K(page, (k) => window.__knap.stepSim(k), perFrame);
        const info = await K(page, () => window.__knap.simInfo());
        const tf = await K(page, () => window.__knap.simTransforms());
        // rotation angle about Z of each gear part
        const ang = Object.fromEntries(gears.map((g) => { const q = tf[g.part].q; return [g.part, 2 * Math.atan2(q[2], q[3])]; }));
        let dTeeth = '';
        if (prevQ) dTeeth = gears.map((g) => { let da = ang[g.part] - prevQ[g.part]; da = Math.atan2(Math.sin(da), Math.cos(da)); return `${T[g.c.rim]}:${((da * gears.find((x) => x.part === g.part).c.rim * 16) / (2 * Math.PI)).toFixed(2)}`; }).join(' ');
        prevQ = ang;
        ft.push(`t=${info.time.toFixed(4)} k=${info.substeps} meshes=${JSON.stringify(info.meshes)} teeth/frame ${dTeeth}`);
        if (f % 2 === 0 || label === 'full') {
          await setCam(page, { ...home, target: [0.6, 2.4, 1], height: 5 });
          const a = await snap(page, await pointClip(page, [0.6, 2.4, 1.2], 150));
          await setCam(page, { target: [0.4, 2.7, 1.5], height: 3.2, yaw: -0.9, pitch: -0.25 });
          const b = await snap(page, await pointClip(page, [0.4, 2.7, 1.5], 120));
          if (strip.length < 48) strip.push({ label: `${label} f${f} t=${info.time.toFixed(3)}`, buf: a }, { label: `below-left f${f}`, buf: b });
        }
      }
      log(`\n-- gear train at ${label} speed, ${perFrame} fixed steps per 1/60 s frame:`);
      for (const s of ft) log(s);
      console.log('sheet', await sheet(S.browser, `review-m8-look-trainsim-${label}-dpr${dpr}.png`, strip, { cols: 8, title: `Gear train running, ${label} speed (${perFrame} fixed steps per frame); iso-direction close and front close, DPR ${dpr}` }));
    }
    // Whole-view frames at Home at 1x
    await K(page, () => window.__knap.setMode('edit'));
    await K(page, () => window.__knap.loadExample('gear-train'));
    await K(page, () => window.__knap.home());
    const wt = [];
    for (let f = 0; f < 12; f++) {
      await K(page, (n) => window.__knap.stepSim(n), f ? 40 : 0);
      const t = await K(page, () => window.__knap.simInfo().time);
      wt.push({ label: `Home t=${t.toFixed(3)}`, buf: await page.screenshot({ clip: { x: 200, y: 60, width: 760, height: 700 } }) });
    }
    console.log('sheet', await sheet(S.browser, `review-m8-look-trainhome-dpr${dpr}.png`, wt, { cols: 4, title: `Gear train at Home, every 40 fixed steps (1/12 s), DPR ${dpr}` }));
  }
} finally {
  await save(`review-m8-look-mesh${process.argv[2] ? '-' + process.argv[2] : ''}.txt`, lines.join('\n'));
  await S.close();
}
