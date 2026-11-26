// Reviewer "look" (m8): dashed tooth contours under orbit (40 gear, band crop).
//   E2E_DIST=e2e/out/review-m8-look-dist node e2e/review-m8-look-dash.mjs
import { gear, model, session, setCam, setModel, sheet, snap } from './review-m8-look-lib.mjs';
const S = await session();
try {
  for (const dpr of [1, 2]) {
    const { page } = await S.open(`dash-${dpr}`, { width: 1280, height: 800, deviceScaleFactor: dpr });
    await setModel(page, model([{ color: '#e0b43c', cells: [gear(0, 0, 0, 2, 2.5)] }]));
    const tiles = [];
    const yaws = [];
    for (let y = 50; y <= 90; y += 4) yaws.push(y);
    for (let y = 79; y <= 81.01; y += 0.25) yaws.push(+y.toFixed(2));
    for (const yaw of yaws) {
      for (const pitch of dpr === 1 ? [10, 20, 35] : [20]) {
        await setCam(page, { target: [2.5, 0, 0], height: 8, yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 });
        const clip = await page.evaluate((p) => { const q = window.__knap.screenPos(p); return { x: Math.round(q.x - 70), y: Math.round(q.y - 200), width: 140, height: 400 }; }, [2.5, 0, 0]);
        tiles.push({ label: `y${yaw} p${pitch}`, buf: await snap(page, clip) });
      }
    }
    console.log('sheet', await sheet(S.browser, `review-m8-look-dash-dpr${dpr}.png`, tiles, { cols: dpr === 1 ? 15 : 10, title: `40 gear band, yaw/pitch sweep (deg), height 8, DPR ${dpr}` }));
  }
} finally { await S.close(); }
