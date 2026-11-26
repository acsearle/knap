// Reviewer verify-ui: the two-lobe contact shadow, by eye and by pixel. Screenshots
// e2e/out/review-m7-look-*.png, numbers on stdout.
//   E2E_DIST=e2e/out/review-m7-dist node e2e/review-m7-look.mjs
import { frames } from './app-lib.mjs';
import { C, K, M, PAL, PAL_NAMES, beamX, lum, session, setCam, setModel } from './review-m7-lib.mjs';

const S = await session();
const log = (...a) => console.log(...a);
try {
  for (const dpr of [1, 2]) {
    const ctx = await S.open(`look-dpr${dpr}`, { width: 1280, height: 720, deviceScaleFactor: dpr });
    const { page } = ctx;
    const shot = async (n) => {
      await frames(page, 3);
      return ctx.shot(`review-m7-look-${n}-dpr${dpr}`);
    };
    const views = async (tag, homeCam) => {
      await K(page, () => window.__knap.home());
      await shot(`${tag}-home`);
      const h = await K(page, () => window.__knap.camera());
      await K(page, () => window.__knap.setView('top'));
      await shot(`${tag}-top`);
      await K(page, () => window.__knap.setView('front'));
      await shot(`${tag}-front`);
      // grazing: 10°, 6° above the floor
      for (const deg of [10, 6]) {
        await setCam(page, { ...h, pitch: (deg * Math.PI) / 180 });
        await shot(`${tag}-graze${deg}`);
      }
      await setCam(page, { ...h, height: h.height * 8 });
      await shot(`${tag}-far`);
      await setCam(page, { ...(homeCam ?? h), height: 3 });
      await shot(`${tag}-near`);
    };

    // Cart (ground on in the example)
    await K(page, () => window.__knap.loadExample('cart'));
    await frames(page, 2);
    log(`dpr${dpr} cart ground=${(await K(page, () => window.__knap.getState())).ground} floor=${JSON.stringify(await K(page, () => window.__knap.floor()))}`);
    await views('cart', { target: [0, -1, -1], yaw: Math.PI / 4, pitch: 0.6155, height: 3 });

    // Crank wheel, ground switched on with the real checkbox
    await K(page, () => window.__knap.loadExample('crank-wheel'));
    await frames(page, 2);
    if (!(await K(page, () => window.__knap.getState().ground))) {
      const b = await page.locator('[data-action=ground]').boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await frames(page, 2);
    }
    log(`dpr${dpr} crank ground=${(await K(page, () => window.__knap.getState())).ground} floor=${JSON.stringify(await K(page, () => window.__knap.floor()))}`);
    await views('crank');

    if (dpr === 1) {
      // single beam lying flat (holes vertical), beam on edge (holes along z), beam on end
      await setModel(page, M([{ cells: Array.from({ length: 7 }, (_, i) => C(i, 0, 0, 'pinHole', 1)) }]));
      await views('beamflat');
      await setModel(page, M([{ cells: beamX(7) }]));
      await K(page, () => window.__knap.home());
      await shot('beamedge-home');
      await setModel(page, M([{ cells: Array.from({ length: 7 }, (_, i) => C(0, i, 0, 'pinHole', 2)) }]));
      await views('beamend');
    }

    // eight palette beams lying flat, 2 apart, plus a wide white plate and a wide yellow plate
    const pal = PAL.map((c, k) => ({ color: c, cells: Array.from({ length: 7 }, (_, i) => C(i, 0, 3 * k, 'pinHole', 1)) }));
    const plate = (x0, color) => ({ color, cells: Array.from({ length: 36 }, (_, i) => C(x0 + (i % 6), 0, 2 + Math.floor(i / 6) * 2 + -2, 'pinHole', 1)) });
    await setModel(page, M(pal));
    await views('palette');
    // wide plates: a 6x6 "plate" made of one part, holes vertical, contiguous along x and z
    const plateCells = (x0, z0) => Array.from({ length: 36 }, (_, i) => C(x0 + (i % 6), 0, z0 + Math.floor(i / 6), 'pinHole', 1));
    await setModel(page, M([{ color: '#e8e8e4', cells: plateCells(0, 0) }, { color: '#e0b43c', cells: plateCells(8, 0) }, { color: '#5f6468', cells: plateCells(16, 0) }]));
    await views('plates');
    void plate;
    // two parts side by side touching (do their shades add?) vs one wide plate
    await setModel(page, M([{ color: '#e8e8e4', cells: Array.from({ length: 7 }, (_, i) => C(i, 0, 0, 'pinHole', 1)) }, { color: '#e8e8e4', cells: Array.from({ length: 7 }, (_, i) => C(i, 0, 1, 'pinHole', 1)) }, { color: '#e8e8e4', cells: Array.from({ length: 14 }, (_, i) => C(i % 7, 0, 5 + Math.floor(i / 7), 'pinHole', 1)) }]));
    const pair = await K(page, () => [0, 0.5, 1, 1.6, 2.2].map((dz) => window.__knap.groundShadowAt(3, 0.5 + dz)));
    const one = await K(page, () => [0, 0.5, 1, 1.6, 2.2].map((dz) => window.__knap.groundShadowAt(3, 5.5 + dz)));
    log(`dpr${dpr} two 1-wide parts vs one 2-wide part, strength at centre..2.2 out: pair ${pair.map((v) => v.toFixed(3))} one ${one.map((v) => v.toFixed(3))}`);
    await K(page, () => window.__knap.home());
    await shot('pair-home');

    // floor pixel darkness next to plates, Home view: walk away from the white plate's -z edge
    if (dpr === 1) {
      await setModel(page, M([{ color: '#e8e8e4', cells: plateCells(0, 0) }]));
      await K(page, () => window.__knap.home());
      await frames(page, 2);
      const bgFar = await K(page, () => {
        const p = window.__knap.screenPos([2.5, -0.46, -12]);
        return window.__knap.pixelAt(p.x, p.y);
      });
      const rows = [];
      for (const d of [0.05, 0.25, 0.5, 1, 1.5, 2, 3, 4]) {
        const px = await K(page, (d) => {
          const p = window.__knap.screenPos([2.5, -0.46, 5.5 + d]); // +z edge (toward the camera)
          return [p, window.__knap.pixelAt(p.x, p.y), window.__knap.groundShadowAt(2.5, 5.5 + d)];
        }, d);
        rows.push(`${d}:L${lum(px[1]).toFixed(0)}/s${px[2].toFixed(2)}`);
      }
      log(`white plate +z edge, floor luminance (bg far ${lum(bgFar).toFixed(0)}): ${rows.join(' ')}`);
      // plate's top face luminance vs plate without ground (darkening of parts?)
      const topPt = await K(page, () => {
        const p = window.__knap.screenPos([2.5, 0.5, 2.5]);
        return [p, window.__knap.pixelAt(p.x, p.y)];
      });
      await K(page, () => window.__knap.setGround(false));
      await frames(page, 2);
      const topOff = await K(page, (p) => window.__knap.pixelAt(p.x, p.y), topPt[0]);
      const sideOn = topPt[1];
      log(`white plate top face pixel: ground on ${JSON.stringify(sideOn)} off ${JSON.stringify(topOff)}`);
      await K(page, () => window.__knap.setGround(true));
      // every palette beam lying flat: luminance of the part's side face with ground on vs off
      await setModel(page, M(pal));
      await K(page, () => window.__knap.home());
      await frames(page, 2);
      const pts = await K(page, (n) => Array.from({ length: n }, (_, k) => window.__knap.screenPos([3, 0.2, 3 * k + 0.5])), PAL.length);
      const on = await K(page, (pts) => pts.map((p) => window.__knap.pixelAt(p.x, p.y)), pts);
      await K(page, () => window.__knap.setGround(false));
      await frames(page, 2);
      const off = await K(page, (pts) => pts.map((p) => window.__knap.pixelAt(p.x, p.y)), pts);
      log(`palette beam near-bottom side pixel on/off: ${PAL_NAMES.map((n, k) => `${n} ${on[k]}/${off[k]}`).join('  ')}`);
    }
  }
} finally {
  await S.close();
}
process.exit(0);
