// Reviewer "look" (m8): close look at a 40 gear's tooth band seen head-on (camera on the gear plane).
//   E2E_DIST=e2e/out/review-m8-look-dist node e2e/review-m8-look-edge.mjs
import { K, cell, gear, model, session, setCam, setModel, sheet, snap, VPJS } from './review-m8-look-lib.mjs';

const S = await session();
try {
  for (const dpr of [1, 2]) {
    const { page } = await S.open(`edge-${dpr}`, { width: 1280, height: 800, deviceScaleFactor: dpr });
    const tiles = [];
    for (const [lab, m] of [
      ['40 gear', model([{ color: '#e0b43c', cells: [gear(0, 0, 0, 2, 2.5)] }])],
      ['r2.5 wheel', model([{ color: '#e0b43c', cells: [cell(0, 0, 0, 'axleHole', 2, 2.5)] }], { version: 2 })],
      ['24 gear', model([{ color: '#3b74c4', cells: [gear(0, 0, 0, 2, 1.5)] }])],
    ]) {
      await setModel(page, m);
      for (const [cl, c] of [
        ['+X pitch 0 h8', { target: [2.5, 0, 0], height: 8, yaw: Math.PI / 2, pitch: 0 }],
        ['+X pitch 8.6 h8', { target: [2.5, 0, 0], height: 8, yaw: Math.PI / 2, pitch: 0.15 }],
        ['yaw 80 pitch 20 h8', { target: [2.5, 0, 0], height: 8, yaw: (80 * Math.PI) / 180, pitch: 0.35 }],
        ['+X pitch 0 h20', { target: [2.5, 0, 0], height: 20, yaw: Math.PI / 2, pitch: 0 }],
      ]) {
        await setCam(page, c);
        const clip = await page.evaluate((p) => { const q = window.__knap.screenPos(p); return { x: Math.round(q.x - 160), y: Math.round(q.y - 330), width: 320, height: 660 }; }, [2.5, 0, 0]);
        tiles.push({ label: `${lab} ${cl}`, buf: await snap(page, clip) });
      }
    }
    const info = await page.evaluate(`(() => { const vp = ${VPJS}; return vp.softFade(); })()`);
    console.log('fade at h20', info);
    console.log('sheet', await sheet(S.browser, `review-m8-look-headon-dpr${dpr}.png`, tiles, { cols: 6, title: `tooth band head-on, DPR ${dpr}` }));
  }
} finally {
  await S.close();
}
