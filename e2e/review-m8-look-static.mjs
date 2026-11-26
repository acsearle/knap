// Reviewer "look" (m8): still contact sheets. E2E_DIST=e2e/out/review-m8-look-dist node e2e/review-m8-look-static.mjs
import { ISO, K, PAL, PAL_NAMES, R, T, axisCam, cell, gear, model, partsClip, session, setCam, setModel, sheet, snap } from './review-m8-look-lib.mjs';

const S = await session();
const AX = ['X', 'Y', 'Z'];
try {
  for (const dpr of [1, 2]) {
    const ctx = await S.open(`look-static-${dpr}`, { width: 1280, height: 800, deviceScaleFactor: dpr });
    const { page } = ctx;
    const iso = (target, height) => setCam(page, { target, height, yaw: Math.PI / 4, pitch: ISO });

    // 1. every tooth count x hub kind x axis, alone, iso view at a fixed zoom (height 8 units)
    let tiles = [];
    for (const axis of [0, 1, 2])
      for (const kind of ['axleHole', 'pinHole'])
        for (const r of R) {
          await setModel(page, model([{ color: '#a8adb2', cells: [gear(0, 0, 0, axis, r, kind)] }]));
          await iso([0, 0, 0], 8);
          tiles.push({ label: `${T[r]}t ${kind} axis ${AX[axis]}`, buf: await snap(page, await partsClip(page, [1])) });
        }
    console.log('sheet', await sheet(S.browser, `review-m8-look-alone-dpr${dpr}.png`, tiles, { cols: 8, title: `each gear alone, iso, camera height 8, DPR ${dpr}` }));

    // face-on views of each size (axis Z, front) and edge-on (from +X)
    tiles = [];
    for (const r of R) {
      await setModel(page, model([{ color: '#e0b43c', cells: [gear(0, 0, 0, 2, r)] }]));
      await setCam(page, axisCam(2, [0, 0, 0], 8));
      tiles.push({ label: `${T[r]}t face-on`, buf: await snap(page, await partsClip(page, [1])) });
      await setCam(page, axisCam(0, [0, 0, 0], 8));
      tiles.push({ label: `${T[r]}t edge-on`, buf: await snap(page, await partsClip(page, [1])) });
      await setCam(page, { target: [0, 0, 0], height: 8, yaw: 1.2, pitch: 0.25 });
      tiles.push({ label: `${T[r]}t grazing`, buf: await snap(page, await partsClip(page, [1])) });
    }
    console.log('sheet', await sheet(S.browser, `review-m8-look-faces-dpr${dpr}.png`, tiles, { cols: 6, title: `face-on, edge-on, grazing, height 8, DPR ${dpr}` }));

    // 2. 40 + 8 + 24 train (Z) at Home, front, top, close, and the compound gear
    tiles = [];
    const train = model([
      { color: '#e0b43c', cells: [gear(0, 0, 0, 2, 2.5)] },
      { color: '#c8433a', cells: [gear(3, 0, 0, 2, 0.5)] },
      { color: '#3b74c4', cells: [gear(5, 0, 0, 2, 1.5)] },
    ]);
    await setModel(page, train);
    await K(page, () => window.__knap.home());
    tiles.push({ label: 'train Home', buf: await snap(page, await partsClip(page, [1, 2, 3])) });
    await setCam(page, axisCam(2, [2.5, 0, 0], 8));
    tiles.push({ label: 'train front h8', buf: await snap(page, await partsClip(page, [1, 2, 3])) });
    await setCam(page, axisCam(1, [2.5, 0, 0], 8));
    tiles.push({ label: 'train top h8', buf: await snap(page, await partsClip(page, [1, 2, 3])) });
    await iso([2.5, 0, 0], 14);
    tiles.push({ label: 'train iso h14', buf: await snap(page, await partsClip(page, [1, 2, 3])) });
    // compound: 40 (z 0) + 8 (z 1) on one part, meshing a 24-something? keep alone + with a 24 driven by the 8
    const compound = model([
      { color: '#4c9a57', cells: [gear(0, 0, 0, 2, 2.5), gear(0, 0, 1, 2, 0.5)] },
      { color: '#e07b2e', cells: [gear(2, 0, 1, 2, 1.5)] },
      { color: '#5f6468', cells: [gear(3, 0, 0, 2, 0.5)] },
    ]);
    await setModel(page, compound);
    await K(page, () => window.__knap.home());
    tiles.push({ label: 'compound 40+8 Home', buf: await snap(page, await partsClip(page, [1, 2, 3])) });
    await iso([1, 0, 0.5], 8);
    tiles.push({ label: 'compound iso h8', buf: await snap(page, await partsClip(page, [1, 2, 3])) });
    await setCam(page, { target: [1, 0, 0.5], height: 8, yaw: -0.6, pitch: 0.35 });
    tiles.push({ label: 'compound back-left h8', buf: await snap(page, await partsClip(page, [1, 2, 3])) });
    console.log('sheet', await sheet(S.browser, `review-m8-look-train-dpr${dpr}.png`, tiles, { cols: 4, title: `train 40+8+24 and compound, DPR ${dpr}` }));

    // 3. crank pin + web holes; gear vs plain wheel of the same radius
    tiles = [];
    const crank40 = model([
      {
        color: '#e8e8e4',
        cells: [gear(0, 0, 0, 2, 2.5), cell(1, 0, 0, 'pinHole', 2), cell(1, 1, 0, 'pinHole', 2), cell(0, -2, 0, 'axleHole', 2), cell(-2, 0, 0, 'pin', 2), cell(-2, 0, 1, 'pin', 2)],
      },
    ]);
    await setModel(page, crank40);
    for (const [lab, c] of [
      ['crank40 front', axisCam(2, [0, 0, 0], 7)],
      ['crank40 iso', { target: [0, 0, 0.3], height: 7, yaw: Math.PI / 4, pitch: ISO }],
      ['crank40 back', { target: [0, 0, 0.3], height: 7, yaw: Math.PI, pitch: 0.3 }],
    ]) {
      await setCam(page, c);
      tiles.push({ label: lab, buf: await snap(page, await partsClip(page, [1])) });
    }
    const crank24 = model([{ color: '#3b74c4', cells: [gear(0, 0, 0, 2, 1.5), cell(1, 0, 0, 'pinHole', 2), cell(0, 1, 0, 'pin', 2), cell(0, 1, 1, 'pin', 2)] }]);
    await setModel(page, crank24);
    await iso([0, 0, 0.3], 5);
    tiles.push({ label: 'crank24 iso h5', buf: await snap(page, await partsClip(page, [1])) });
    await setCam(page, axisCam(2, [0, 0, 0], 5));
    tiles.push({ label: 'crank24 front h5', buf: await snap(page, await partsClip(page, [1])) });
    for (const r of [1, 1.5, 2.5]) {
      await setModel(page, model([{ color: '#a8adb2', cells: [gear(0, 0, 0, 2, r)] }, { color: '#a8adb2', cells: [cell(Math.ceil(2 * r) + 2, 0, 0, 'axleHole', 2, r)] }]));
      await iso([(Math.ceil(2 * r) + 2) / 2, 0, 0], 2 * r + 4);
      tiles.push({ label: `${T[r]}t vs wheel r${r} iso`, buf: await snap(page, await partsClip(page, [1, 2])) });
      await setCam(page, axisCam(2, [(Math.ceil(2 * r) + 2) / 2, 0, 0], 2 * r + 4));
      tiles.push({ label: `${T[r]}t vs wheel r${r} front`, buf: await snap(page, await partsClip(page, [1, 2])) });
    }
    console.log('sheet', await sheet(S.browser, `review-m8-look-crank-wheel-dpr${dpr}.png`, tiles, { cols: 4, title: `crank pin + web holes; gear vs plain wheel; DPR ${dpr}` }));

    // 4. each of the 8 colours: a 24 meshing an 8 of the next colour, iso
    tiles = [];
    for (let k = 0; k < 8; k++) {
      await setModel(page, model([{ color: PAL[k], cells: [gear(0, 0, 0, 2, 1.5)] }, { color: PAL[(k + 1) % 8], cells: [gear(2, 0, 0, 2, 0.5)] }, { color: PAL[k], cells: [gear(6, 0, 0, 2, 2.5)] }]));
      await iso([3, 0, 0], 9);
      tiles.push({ label: `${PAL_NAMES[k]} 24 + ${PAL_NAMES[(k + 1) % 8]} 8, ${PAL_NAMES[k]} 40`, buf: await snap(page, await partsClip(page, [1, 2, 3])) });
    }
    console.log('sheet', await sheet(S.browser, `review-m8-look-colours-dpr${dpr}.png`, tiles, { cols: 2, title: `palette colours, iso h9, DPR ${dpr}` }));
  }
} finally {
  await S.close();
}
